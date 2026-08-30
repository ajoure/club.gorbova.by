/**
 * public-rr-installment-initiate (Sprint B / Gate A.1 v3.1 hardened)
 *
 * Инвариант fail-closed: НИКОГДА не отдавать клиенту "безопасный" статус
 * без подтверждённой durable записи. Если БД не отвечает — HTTP 500
 * local_state_unconfirmed, а не 502/503/504.
 *
 * v3.1 отличия от v3:
 *  1) Post-call marker RPC явно переводят upstream_call_state в семантику:
 *     - unknown_marked        → outcome_unknown
 *     - persist_failed_marked → completed_unpersisted
 *     - rejected/finalized/not_created → completed
 *     Порядок reuse-веток теперь строго различает эти состояния и не
 *     заворачивает recovery/ambiguous в rr_call_in_flight.
 *  2) Проверки RPC-результатов расширены: не только ok+error, но и
 *     ожидаемый typed state. Любой другой state → fail-closed reread.
 *  3) Recovered URL валидируется тем же способом, что happy path.
 *  4) operator_resolution='allow_new_order' не входит в reuse-ветку
 *     (RPC уже переводит заказ в terminal 'failed' и исключает его из
 *     reuse-кандидатов).
 *
 * Приоритет reuse-веток (rr_get_or_create_pending_order → was_reused=true):
 *   1. initiation_status='created' + валидный payment_url → 200 (существующий URL)
 *   2. operator_resolution='confirm_created' + URL → 200; 'keep_blocked' → 503
 *   3. local_persist_failed=true → recovery finalize → 200
 *   4. upstream_outcome='unknown' → 503 rr_reconciliation_pending
 *   5. upstream_call_state='started' (в этом порядке — только оставшийся in-flight) → 503 rr_call_in_flight
 *   6. concurrency happy-path pending → polling
 *
 * Ветки нового заказа (was_reused=false):
 *   1. rr_mark_call_started (1 retry). Ожидаемый state='call_started'.
 *      Любой другой → rrCreateOrder НЕ вызывается, fail-closed reread.
 *   2. rrCreateOrder → outcomeClass:
 *      upstream_created  → rr_finalize_created_order (retry + persist_failed marker) → 200
 *      upstream_rejected → rr_finalize_order_rejected (retry) → 502 или 500
 *      upstream_outcome_unknown → rr_mark_upstream_unknown (retry) → 504 или 500
 */
import {
  handleCorsPreflightRequest,
  jsonResponse,
  errorResponse,
} from "../_shared/cors.ts";
import {
  createServiceClient,
  loadRRConfig,
} from "../_shared/rr/rr-config.ts";
import { redactRRResponse, rrCreateOrder } from "../_shared/rr/rr-adapter.ts";
import {
  applyCrmStageOnTerminal,
  auditNegativeSnapshot,
  buildNegativeSnapshot,
  resolveOrderRouting,
} from "../_shared/crm-routing.ts";
import { ComposableCheckoutError, resolveComposableCheckout } from "../_shared/resolve-composable-checkout.ts";
import { materializeComposableOrderGroup } from "../_shared/materialize-composable-order-group.ts";
import { allocateComposablePayableTotal } from "../_shared/composable-checkout.ts";
import { referralDiscountMeta, resolveReferralCheckoutDiscount } from "../_shared/referral-checkout-discount.ts";
import { reserveReferralCustomerCredit } from "../_shared/referral-customer-credit.ts";
import { requirePaymentsEdit } from "../_shared/admin-section-auth.ts";
import { resolveSalesManagerForCreation, SalesManagerSelectionError } from "../_shared/sales-manager-attribution.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface InitiatePayload {
  tariff_offer_id?: string;
  addon_offer_ids?: string[];
  target_user_id?: string;
  adjustment_amount?: number;
  adjustment_reason?: string | null;
  name?: string;
  phone?: string;
  email?: string;
  comment?: string | null;
  website?: string;
  customer_credit_requested_minor?: number;
  partner_bonus_requested_minor?: number;
  partner_bonus_checkout_key?: string;
  responsible_user_id?: string | null;
}

function normalizePhone(raw: string): string {
  return raw.replace(/\D+/g, "");
}
function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, "").slice(0, 2000);
}
async function sha256Hex(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
function getClientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") || "unknown";
}

/**
 * Единый валидатор payment_url. Используется как для happy path (в adapter),
 * так и для recovered URL перед canonical finalize.
 * Правила: непустая строка, https, без basic-auth (user:pass@host).
 */
function isSafePaymentUrl(u: unknown): u is string {
  if (typeof u !== "string" || u.length === 0) return false;
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== "https:") return false;
    if (parsed.username.length > 0 || parsed.password.length > 0) return false;
    return true;
  } catch {
    return false;
  }
}

type SbAdmin = ReturnType<typeof createServiceClient>;

async function rateLimitOrDeny(
  supabaseAdmin: SbAdmin,
  buckets: { key: string; window: number; max: number }[],
): Promise<{ ok: true } | { ok: false; bucket: string }> {
  for (const b of buckets) {
    const { data, error } = await supabaseAdmin.rpc(
      "rr_public_rate_limit_hit",
      { _key: b.key, _window_seconds: b.window, _max: b.max },
    );
    if (error) continue;
    if (data === false) return { ok: false, bucket: b.key.split(":")[1] || "?" };
  }
  return { ok: true };
}

// Небольшая controlled retry для критических marker RPC.
// Одна повторная попытка через 150 мс. Возвращает финальный error (или null).
async function callWithSingleRetry<T = unknown>(
  fn: () => Promise<{ data: T | null; error: { message: string } | null }>,
): Promise<{ data: T | null; error: { message: string } | null }> {
  const first = await fn();
  if (!first.error) return first;
  await new Promise((r) => setTimeout(r, 150));
  return await fn();
}

// Best-effort идемпотентный аудит через RPC.
// Не блокирует ответ; ошибки только логируются.
async function auditEvent(
  supabaseAdmin: SbAdmin,
  orderId: string,
  eventType:
    | "recovery_blocked_no_url"
    | "create_order_recovered"
    | "local_state_unconfirmed"
    | "audit_write_failed"
    | "composable_materialization_failed",
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabaseAdmin.rpc(
    "rr_insert_idempotent_audit_event",
    { _order_id: orderId, _event_type: eventType, _payload: payload },
  );
  if (error) {
    console.error(JSON.stringify({
      stage: "audit_event_write_failed",
      order_id: orderId, event_type: eventType, error: error.message,
    }));
  }
}

// Redacted ALERT log. Никаких PII / полных URL / raw response.
function alertLocalStateUnconfirmed(
  orderId: string, correlationId: string, stage: string,
  failureKind: string | null, httpStatus: number | null,
  providerRequestId: string | null, errorMsg: string,
): void {
  console.error(JSON.stringify({
    metric: "rr_local_state_unconfirmed", level: "ALERT",
    order_id: orderId, correlation_id: correlationId, stage,
    failure_kind: failureKind, http_status: httpStatus,
    provider_request_id: providerRequestId,
    error_short: (errorMsg || "").slice(0, 200),
  }));
}

/**
 * Fail-closed reread: когда любая RPC вернула неожиданный typed state,
 * читаем актуальное состояние заказа и возвращаем клиенту ответ,
 * соответствующий фактическому durable состоянию. rrCreateOrder больше НЕ
 * вызывается в текущем запросе.
 */
async function failClosedReread(
  supabaseAdmin: SbAdmin, orderId: string, correlationId: string, stage: string,
): Promise<Response> {
  const { data: row, error } = await supabaseAdmin
    .from("orders_v2").select("meta").eq("id", orderId).maybeSingle();
  if (error || !row) {
    alertLocalStateUnconfirmed(
      orderId, correlationId, `${stage}:reread`,
      null, null, null, error?.message ?? "row_not_found",
    );
    return errorResponse("rr_state_recheck_failed", 500);
  }
  const rr = ((row.meta as any)?.rr ?? {}) as Record<string, unknown>;
  const initStatus = rr.initiation_status as string | undefined;
  const url = rr.payment_url as string | undefined;
  const upstream = rr.upstream_outcome as string | undefined;
  const persistFailed = rr.local_persist_failed === true ||
    rr.local_persist_failed === "true";
  const callState = rr.upstream_call_state as string | undefined;

  if (initStatus === "created" && isSafePaymentUrl(url)) {
    return jsonResponse({
      payment_url: url, order_id: orderId, reused: true,
      source: "reread_created",
    });
  }
  if (initStatus === "failed" && upstream === "rejected") {
    return errorResponse("rr_create_order_rejected", 502);
  }
  if (initStatus === "failed" && upstream === "not_created") {
    return errorResponse("rr_create_order_not_created", 502);
  }
  if (persistFailed) {
    return errorResponse("rr_recovery_pending", 503);
  }
  if (upstream === "unknown") {
    return errorResponse("rr_reconciliation_pending", 503);
  }
  if (callState === "started") {
    return errorResponse("rr_call_in_flight", 503);
  }
  alertLocalStateUnconfirmed(
    orderId, correlationId, `${stage}:unknown_state`, null, null, null,
    `initiation_status=${initStatus} upstream=${upstream} callState=${callState}`,
  );
  return errorResponse("local_state_unconfirmed", 500);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCorsPreflightRequest();
  if (req.method !== "POST") return errorResponse("method_not_allowed", 405);

  let body: InitiatePayload = {};
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid_json", 400);
  }

  if (body.website && String(body.website).trim() !== "") {
    console.info(JSON.stringify({ metric: "rr_initiate_honeypot_blocked" }));
    return jsonResponse({ success: true });
  }

  const offerId = String(body.tariff_offer_id ?? "").trim();
  const commentRaw = body.comment == null ? null : String(body.comment);
  const comment = commentRaw == null ? null : stripHtml(commentRaw);
  const addonOfferIds = Array.isArray(body.addon_offer_ids)
    ? body.addon_offer_ids.map((id) => String(id).trim())
    : [];

  if (!UUID_RE.test(offerId)) return errorResponse("tariff_offer_id_invalid", 400);
  if (addonOfferIds.some((id) => !UUID_RE.test(id))) {
    return errorResponse("addon_offer_id_invalid", 400);
  }
  const supabaseAdmin = createServiceClient();
  const ip = getClientIp(req);
  const hasTargetUserField = Object.prototype.hasOwnProperty.call(body, "target_user_id");
  const hasAdjustmentAmountField = Object.prototype.hasOwnProperty.call(body, "adjustment_amount");
  const hasAdjustmentReasonField = Object.prototype.hasOwnProperty.call(body, "adjustment_reason");
  const hasResponsibleUserField = Object.prototype.hasOwnProperty.call(body, "responsible_user_id");
  const adminMode = hasTargetUserField
    || hasAdjustmentAmountField
    || hasAdjustmentReasonField
    || hasResponsibleUserField;

  let adminActorId: string | null = null;
  let responsibleUserId: string | null = null;
  let userId: string | null = null;
  let nameRaw = String(body.name ?? "").trim().slice(0, 200);
  let phoneRaw = String(body.phone ?? "").trim().slice(0, 64);
  let email = String(body.email ?? "").trim().toLowerCase();

  if (adminMode) {
    const access = await requirePaymentsEdit(req, supabaseAdmin);
    if (!access.ok) {
      return access.status === 500
        ? errorResponse(access.error, 500)
        : errorResponse("admin_fields_forbidden", 403);
    }
    adminActorId = access.actor.id;
    try {
      responsibleUserId = await resolveSalesManagerForCreation(
        supabaseAdmin,
        access.actor.id,
        body.responsible_user_id,
      );
    } catch (error) {
      if (error instanceof SalesManagerSelectionError) return errorResponse(error.code, error.status);
      return errorResponse("sales_manager_rbac_check_failed", 500);
    }
    const targetUserId = String(body.target_user_id ?? "").trim();
    if (!UUID_RE.test(targetUserId)) return errorResponse("target_user_id_invalid", 400);

    const { data: targetProfile, error: targetProfileError } = await supabaseAdmin
      .from("profiles")
      .select("user_id, full_name, email, phone")
      .eq("user_id", targetUserId)
      .maybeSingle();
    if (targetProfileError) return errorResponse("target_profile_lookup_failed", 500);
    if (!targetProfile) return errorResponse("target_profile_not_found", 404);

    userId = targetUserId;
    nameRaw = String(targetProfile.full_name ?? "").trim().slice(0, 200);
    phoneRaw = String(targetProfile.phone ?? "").trim().slice(0, 64);
    email = String(targetProfile.email ?? "").trim().toLowerCase();
  } else {
    const authHeader = req.headers.get("Authorization") ?? "";
    const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    if (tokenMatch?.[1]) {
      const { data, error } = await supabaseAdmin.auth.getUser(tokenMatch[1]);
      if (!error) userId = data.user?.id ?? null;
    }
  }

  if (nameRaw.length < 1) return errorResponse("name_invalid", 400);
  const phoneNorm = normalizePhone(phoneRaw);
  if (phoneNorm.length < 9 || phoneNorm.length > 15) {
    return errorResponse("phone_invalid", 400);
  }
  if (!EMAIL_RE.test(email) || email.length > 200) {
    return errorResponse("email_invalid", 400);
  }

  const contactHash = await sha256Hex(`${phoneNorm}|${email}`);
  const ipHash = await sha256Hex(ip);
  const requestedFingerprint = await sha256Hex([offerId, ...addonOfferIds.slice().sort()].join("|"));
  const offerContactHash = await sha256Hex(`${requestedFingerprint}|${phoneNorm}|${email}`);
  const rl = await rateLimitOrDeny(supabaseAdmin, [
    { key: `rr_initiate:ip:${ipHash}`, window: 60, max: 20 },
    { key: `rr_initiate:contact:${contactHash}`, window: 60, max: 5 },
    { key: `rr_initiate:offer_contact:${offerContactHash}`, window: 60, max: 5 },
  ]);
  if (!rl.ok) return errorResponse(`rate_limited:${rl.bucket}`, 429);

  const { data: offer, error: offerErr } = await supabaseAdmin
    .from("tariff_offers")
    .select(
      "id, tariff_id, offer_type, amount, meta, is_active, tariffs:tariff_id(id, name, is_active, product_id, products_v2:product_id(id, name, public_title, is_active, currency))",
    )

    .eq("id", offerId)
    .maybeSingle();

  if (offerErr) return errorResponse("offer_lookup_failed", 500);
  if (!offer) return errorResponse("offer_not_found", 404);
  if (!offer.is_active) return errorResponse("offer_inactive", 403);
  if ((offer as any).offer_type === "invoice") {
    return errorResponse("offer_type_invoice_not_chargeable", 400);
  }
  if (offer.offer_type !== "bank_installment") {
    return errorResponse("offer_not_bank_installment", 403);
  }
  const rrRuntime = (offer.meta as any)?.bank_installment?.rr_runtime ?? null;
  if (!rrRuntime?.enabled || rrRuntime.provider !== "rr") {
    return errorResponse("rr_runtime_disabled", 403);
  }

  const tariff = (offer as any).tariffs;
  const product = tariff?.products_v2;
  if (!tariff?.is_active) return errorResponse("tariff_inactive", 403);
  if (!product?.is_active) return errorResponse("product_inactive", 403);

  let composableQuote;
  try {
    composableQuote = await resolveComposableCheckout(supabaseAdmin, {
      parentOfferId: offerId,
      addonOfferIds,
    });
  } catch (error) {
    if (error instanceof ComposableCheckoutError) {
      return errorResponse(error.code, error.status);
    }
    return errorResponse("quote_failed", 500);
  }
  let amountNumeric = Number(composableQuote.total);
  if (!Number.isFinite(amountNumeric) || amountNumeric <= 0) {
    return errorResponse("amount_invalid", 500);
  }
  const currency = composableQuote.currency;
  let amountMinor = Math.round(amountNumeric * 100);
  let referralCreditMeta: Record<string, unknown> = {};
  let allocationReason = "referral_discount_or_customer_credit";
  if (adminMode) {
    const requestedAdjustment = Number(body.adjustment_amount ?? 0);
    const requestedReason = String(body.adjustment_reason ?? "").trim();
    if (
      !Number.isFinite(requestedAdjustment) ||
      Math.abs(Math.round(requestedAdjustment * 100) - requestedAdjustment * 100) > 1e-7
    ) {
      return errorResponse("invalid_adjustment_amount", 400);
    }
    if (requestedAdjustment !== 0 && !requestedReason) {
      return errorResponse("adjustment_reason_required", 400);
    }
    amountNumeric = Math.round((Number(composableQuote.subtotal) + requestedAdjustment) * 100) / 100;
    if (!Number.isFinite(amountNumeric) || amountNumeric <= 0) {
      return errorResponse("adjusted_total_invalid", 400);
    }
    amountMinor = Math.round(amountNumeric * 100);
    allocationReason = "admin_adjustment";
    referralCreditMeta = {
      payment_type: "one_time",
      admin_adjustment_amount: requestedAdjustment,
      admin_adjustment_reason: requestedAdjustment === 0 ? null : requestedReason,
      admin_actor_id: adminActorId,
    };
  } else if (userId) {
    const referralQuote = await resolveReferralCheckoutDiscount({
      supabase: supabaseAdmin, userId, productId: product.id, amountMinor, allowImmediateDiscount: true,
    });
    amountMinor = referralQuote.finalAmountMinor;
    const reservation = await reserveReferralCustomerCredit({
      supabase: supabaseAdmin,
      userId,
      chargeAmountMinor: amountMinor,
      requestedMinor: Math.max(0, Math.round(Number(body.customer_credit_requested_minor ?? 0))),
      checkoutKey: `rr:${offerContactHash}`,
    });
    amountMinor -= reservation.appliedMinor;
    amountNumeric = amountMinor / 100;
    referralCreditMeta = {
      payment_type: 'one_time',
      ...referralDiscountMeta(referralQuote),
      ...(reservation.appliedMinor > 0 ? {
        referral_customer_credit_applied_minor: reservation.appliedMinor,
        referral_customer_credit_reservation_id: reservation.reservationId,
      } : {}),
    };
    const bonusReservation = await supabaseAdmin.rpc('referral_reserve_partner_bonus', {
      p_user_id: userId,
      p_requested_minor: Math.max(0, Math.round(Number(body.partner_bonus_requested_minor ?? 0))),
      p_charge_amount_minor: amountMinor,
      p_checkout_key: `rr:partner-bonus:${body.partner_bonus_checkout_key || offerContactHash}`,
      p_product_id: product.id,
    });
    if (bonusReservation.error) return errorResponse('partner_bonus_reservation_failed', 400);
    const bonusAppliedMinor = Math.max(0, Math.round(Number(bonusReservation.data?.applied_minor ?? 0)));
    amountMinor = Math.max(100, amountMinor - bonusAppliedMinor);
    amountNumeric = amountMinor / 100;
    if (bonusAppliedMinor > 0) {
      referralCreditMeta.referral_partner_bonus_applied_minor = bonusAppliedMinor;
      referralCreditMeta.referral_partner_bonus_reservation_id = bonusReservation.data?.reservation_id;
    }
  }
  if (!Number.isFinite(amountNumeric) || amountNumeric <= 0) {
    return errorResponse("amount_fully_covered_or_invalid", 400);
  }
  const checkoutFingerprint = await sha256Hex(JSON.stringify({
    request_mode: adminMode ? "admin" : "public",
    parent_offer_id: offerId,
    selected_addon_offer_ids: composableQuote.selected_addon_offer_ids.slice().sort(),
    quoted_total: composableQuote.total,
    payable_total: amountNumeric,
    currency: composableQuote.currency,
    responsible_user_id: responsibleUserId,
  }));
  const materializationQuote = allocateComposablePayableTotal(
    composableQuote,
    amountNumeric,
    allocationReason,
  );

  let cfg;
  try {
    cfg = await loadRRConfig(supabaseAdmin);
  } catch (e) {
    return errorResponse((e as Error).message, 503);
  }

  const correlationId = crypto.randomUUID();

  // Sprint C2 / Stage E.1 v2 — DURABLE CRM routing snapshot BEFORE order INSERT.
  // B.0 invariant: every new RR order must carry crm_routing_snapshot atomically at INSERT time.
  // We resolve routing server-side and embed positive/negative snapshot into initialMeta.
  // If resolver itself throws (network/DB), we fail-closed: rrCreateOrder is NOT called.
  let crmSnapshot: any;
  let crmRoutingOk = false;
  let crmRoutingContext: {
    reason?: string; resolved_via?: string; candidates_count?: number; primary_reason?: string | null;
  } = {};
  try {
    const routing = await resolveOrderRouting(supabaseAdmin, {
      offer_id: offerId,
      tariff_id: tariff.id,
      product_id: product.id,
    });
    crmRoutingContext = {
      reason: routing.reason,
      resolved_via: routing.resolved_via ?? "none",
      candidates_count: routing.candidates_count ?? 0,
      primary_reason: routing.primary_reason ?? null,
    };
    if (routing.ok && routing.snapshot) {
      crmSnapshot = routing.snapshot;
      crmRoutingOk = true;
      if (routing.resolved_via === "product_binding_fallback") {
        // observability: mark compatibility-layer usage
        await supabaseAdmin.from("audit_logs").insert({
          actor_type: "system",
          actor_label: "public-rr-installment-initiate",
          action: "rr.create_order.routing_fallback_used",
          meta: {
            offer_id: offerId,
            tariff_id: tariff.id,
            product_id: product.id,
            pipeline_id: routing.snapshot.pipeline_id,
            pipeline_name: routing.snapshot.pipeline_name,
            stage_id: routing.snapshot.stage_on_pending,
            stage_name: routing.snapshot.stage_names?.pending ?? null,
            binding_id: routing.snapshot.binding_id ?? null,
          },
        });
      }
    } else {
      crmSnapshot = buildNegativeSnapshot({
        reason: routing.reason || "unknown",
        offer_id: offerId,
        tariff_id: tariff.id,
        product_id: product.id,
        resolved_via: routing.resolved_via ?? "none",
        candidates_count: routing.candidates_count ?? 0,
        primary_reason: routing.primary_reason ?? null,
      });
    }
  } catch (e) {
    // Fail-closed: cannot guarantee B.0 invariant → do not call RR.
    await supabaseAdmin.from("audit_logs").insert({
      actor_type: "system",
      actor_label: "public-rr-installment-initiate",
      action: "rr.create_order.crm_snapshot_resolver_error",
      meta: { offer_id: offerId, tariff_id: tariff.id, error: (e as Error).message },
    });
    return errorResponse("crm_snapshot_resolver_failed", 503);
  }

  // Sprint C2 / Этап C: разделение владельца аккаунта и заявителя.
  // - Владелец покупки и получатель доступа = auth user (user_id / profile).
  // - Заявитель РР — данные из формы; могут отличаться (супруг/родственник).
  // - Профиль владельца НЕ перезаписывается: applicant хранится только в meta.rr.applicant.
  // `contact` оставлен для обратной совместимости с уже задеплоенным кодом чтения.
  const applicantEmailNorm = email;
  const applicantPhoneNorm = phoneNorm;

  const initialMeta = {
    flow: "rr_installment",
    ...(adminMode ? {
      admin_actor_id: adminActorId,
      admin_target_user_id: userId,
      responsible_user_id: responsibleUserId,
    } : {}),
    grant_access_skip: true,
    notification_skip: true,
    crm_success_skip: true,
    // B.0 invariant: snapshot embedded atomically at INSERT.
    crm_routing_snapshot: crmSnapshot,
    checkout_fingerprint: checkoutFingerprint,
    composable_checkout: materializationQuote,
    ...referralCreditMeta,
    rr: {
      runtime: "sprintB",
      mode: cfg.mode,
      initiation_status: "pending",
      upstream_call_state: "not_started",
      correlation_id: correlationId,
      ...(adminMode ? { admin_actor_id: adminActorId } : {}),
      contact: { name: nameRaw, phone: phoneRaw, email, phone_norm: phoneNorm },
      applicant: {
        name: nameRaw,
        email,
        phone: phoneRaw,
        email_norm: applicantEmailNorm,
        phone_norm: applicantPhoneNorm,
        account_user_id: userId,
        // is_third_party проставит backend-flow post-create, сравнив с профилем владельца.
        is_third_party: null,
        source: "public-rr-installment-initiate",
        captured_at: new Date().toISOString(),
      },
      comment,
    },
  };

  // Sprint C2 / Stage E.1 v3 — pass CRM snapshot + pipeline columns to RPC so they
  // are persisted ATOMICALLY within the same INSERT transaction as the order itself.
  // On was_reused=true the RPC ignores these params (existing snapshot untouched).
  const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc(
    "rr_get_or_create_pending_order",
    {
      _offer_id: offerId, _user_id: userId,
      _email_norm: email, _phone_norm: phoneNorm,
      _product_id: product.id, _tariff_id: tariff.id,
      _amount: amountNumeric, _currency: currency,
      _customer_email: email, _customer_phone: phoneRaw,
      _customer_ip: ip, _meta: initialMeta,
      _crm_routing_snapshot: crmSnapshot,
      _pipeline_id: crmRoutingOk ? crmSnapshot.pipeline_id : null,
      _pipeline_stage_id: crmRoutingOk ? crmSnapshot.stage_on_pending : null,
      _checkout_fingerprint: checkoutFingerprint,
    },
  );

  if (rpcErr || !rpcData || rpcData.length === 0) {
    return errorResponse(
      `order_create_failed:${rpcErr?.message ?? "no_rpc_data"}`, 500,
    );
  }
  const { order_id: externalId, was_reused: wasReused } = rpcData[0] as any;
  if (adminMode) {
    const { error: managerError } = await supabaseAdmin.rpc("set_deal_responsible_v1", {
      p_deal_id: externalId,
      p_responsible_user_id: responsibleUserId,
      p_reason: "Назначено при создании RR-ссылки",
      p_source: "manual_reassignment",
      p_batch_id: null,
    });
    if (managerError) {
      console.error(JSON.stringify({ stage: "sales_manager_assignment", order_id: externalId, error: managerError.message }));
      return errorResponse("sales_manager_assignment_failed", 500);
    }
    const { error: adminAuditError } = await supabaseAdmin.from("audit_logs").insert({
      action: "rr.admin_payment_link_initiated",
      actor_type: "user",
      actor_user_id: adminActorId,
      target_user_id: userId,
      entity_type: "orders_v2",
      entity_id: externalId,
      meta: {
        offer_id: offerId,
        checkout_fingerprint: checkoutFingerprint,
        adjustment_amount: Number(body.adjustment_amount ?? 0),
        adjustment_reason: String(body.adjustment_reason ?? "").trim() || null,
        was_reused: wasReused,
      },
    });
    if (adminAuditError) {
      console.error(JSON.stringify({
        stage: "admin_audit", order_id: externalId, error: adminAuditError.message,
      }));
      return errorResponse("admin_audit_failed", 500);
    }
  }
  try {
    await materializeComposableOrderGroup(supabaseAdmin, {
      primaryOrderId: externalId,
      quote: materializationQuote,
      source: "rr_installment",
      idempotencyKey: `rr:${externalId}:${checkoutFingerprint}`,
    });
  } catch (error) {
    await auditEvent(supabaseAdmin, externalId, "composable_materialization_failed", {
      error: (error as Error).message,
      checkout_fingerprint: checkoutFingerprint,
    });
    return errorResponse("composable_order_materialization_failed", 500);
  }


  // ============== REUSE ==============
  if (wasReused) {
    const { data: reusedOrder, error: reuseReadErr } = await supabaseAdmin
      .from("orders_v2").select("meta").eq("id", externalId).maybeSingle();
    if (reuseReadErr) {
      console.error(JSON.stringify({
        stage: "reuse_state_read", order_id: externalId,
        error: reuseReadErr.message,
      }));
      return errorResponse("rr_reuse_state_read_failed", 500);
    }
    const rr = ((reusedOrder?.meta as any)?.rr ?? {}) as Record<string, unknown>;
    const initStatus = rr.initiation_status as string | undefined;
    const url = rr.payment_url as string | undefined;
    const localPersistFailed = rr.local_persist_failed === true ||
      rr.local_persist_failed === "true";
    const upstreamOutcome = rr.upstream_outcome as string | undefined;
    const reconStatus = rr.reconciliation_status as string | undefined;
    const operatorResolution = rr.operator_resolution as string | undefined;
    const callState = rr.upstream_call_state as string | undefined;

    // Приоритет v3.1 (Блокеры №1, №2):
    // 1) created + валидный URL
    if (initStatus === "created" && isSafePaymentUrl(url)) {
      return jsonResponse({
        payment_url: url, order_id: externalId, reused: true,
      });
    }

    // 2) operator resolution (allow_new_order уже не reuse — заказ terminal failed)
    if (reconStatus === "resolved") {
      if (operatorResolution === "confirm_created" && isSafePaymentUrl(url)) {
        return jsonResponse({
          payment_url: url, order_id: externalId, reused: true,
          source: "operator_confirm_created",
        });
      }
      if (operatorResolution === "keep_blocked") {
        return errorResponse("rr_blocked_by_operator", 503);
      }
      return errorResponse("rr_operator_pending", 503);
    }

    // 3) recovery flow (Блокер №1: НЕ должно перехватываться rr_call_in_flight)
    if (localPersistFailed) {
      const recoveredUrl = rr.rr_payment_url_recovered as string | undefined;
      const recoveredReqId = rr.rr_request_id_recovered as string | null | undefined;
      // Амандмент №8: recovered URL валидируется тем же helper.
      if (!isSafePaymentUrl(recoveredUrl)) {
        await auditEvent(supabaseAdmin, externalId, "recovery_blocked_no_url", {
          correlation_id: correlationId,
          reason: recoveredUrl ? "invalid_url" : "no_url",
        });
        return errorResponse("rr_recovery_pending", 503);
      }
      const { data: finData, error: finErr } = await callWithSingleRetry(async () =>
        await supabaseAdmin.rpc("rr_finalize_created_order", {
          _order_id: externalId,
          _payment_url: recoveredUrl,
          _rr_request_id: recoveredReqId ?? null,
          _rr_status_raw: null,
          _raw_last: { source: "recovery" },
          _correlation_id: correlationId,
        })
      );
      if (finErr) {
        alertLocalStateUnconfirmed(
          externalId, correlationId, "recovery_finalize",
          null, null, recoveredReqId ?? null, finErr.message,
        );
        await auditEvent(supabaseAdmin, externalId, "local_state_unconfirmed", {
          correlation_id: correlationId, stage: "recovery_finalize",
        });
        return errorResponse("local_state_unconfirmed", 500);
      }
      // Typed-state check: expect finalized | already_created.
      const finState = (finData as any)?.state as string | undefined;
      if (finState !== "finalized" && finState !== "already_created") {
        return await failClosedReread(
          supabaseAdmin, externalId, correlationId, "recovery_finalize_state",
        );
      }
      await auditEvent(supabaseAdmin, externalId, "create_order_recovered", {
        correlation_id: correlationId,
      });
      return jsonResponse({
        payment_url: recoveredUrl, order_id: externalId,
        reused: true, recovered: true,
      });
    }

    // 4) ambiguous → reconciliation pending
    if (upstreamOutcome === "unknown") {
      return errorResponse("rr_reconciliation_pending", 503);
    }

    // 5) pre-call marker всё ещё активен без пост-call outcome — call in-flight
    if (
      callState === "started" &&
      initStatus !== "created" && initStatus !== "failed"
    ) {
      return errorResponse("rr_call_in_flight", 503);
    }

    // 6) concurrency happy-path poll
    const deadline = Date.now() + 15_000;
    let curUrl = url;
    let curStatus = initStatus;
    while (Date.now() < deadline && (curStatus !== "created" || !isSafePaymentUrl(curUrl))) {
      await new Promise((r) => setTimeout(r, 400));
      const { data: pollOrder, error: pollErr } = await supabaseAdmin
        .from("orders_v2").select("meta").eq("id", externalId).maybeSingle();
      if (pollErr) {
        console.error(JSON.stringify({
          stage: "reuse_poll", order_id: externalId, error: pollErr.message,
        }));
        return errorResponse("rr_reuse_poll_read_failed", 500);
      }
      const pr = ((pollOrder?.meta as any)?.rr ?? {}) as Record<string, unknown>;
      curUrl = pr.payment_url as string | undefined;
      curStatus = pr.initiation_status as string | undefined;
      if (curStatus === "failed") {
        return errorResponse("rr_create_order_failed_upstream", 502);
      }
      if ((pr.upstream_outcome as string | undefined) === "unknown") {
        return errorResponse("rr_reconciliation_pending", 503);
      }
      if (pr.local_persist_failed === true || pr.local_persist_failed === "true") {
        return errorResponse("rr_recovery_pending", 503);
      }
    }
    if (!isSafePaymentUrl(curUrl)) return errorResponse("rr_reuse_wait_timeout", 504);
    return jsonResponse({ payment_url: curUrl, order_id: externalId, reused: true });
  }

  // ============== NEW ORDER ==============
  // Sprint C2 / Stage E.1 v3 — snapshot + pipeline_id + pipeline_stage_id уже записаны
  // АТОМАРНО внутри той же INSERT-транзакции rr_get_or_create_pending_order. Никаких
  // post-insert CAS/UPDATE не выполняем: успешный возврат RPC ⇒ CRM-маршрутизация
  // durable для этого заказа.
  if (!crmRoutingOk) {
    // Negative snapshot — no pipeline columns were set (both NULL by design). Audit only.
    await auditNegativeSnapshot(supabaseAdmin, {
      order_id: externalId,
      offer_id: offerId,
      tariff_id: tariff.id,
      product_id: product.id,
      reason: crmRoutingContext.reason || "unknown",
      resolved_via: (crmRoutingContext.resolved_via as any) ?? "none",
      candidates_count: crmRoutingContext.candidates_count ?? 0,
      primary_reason: crmRoutingContext.primary_reason ?? null,
    });
  }



  // 1. Идемпотентный create_order_requested (fail-fast: 503).
  const reqInsert = await supabaseAdmin.from("provider_events").insert({
    provider: "rr", account_code: "rr", signature_valid: true,
    event_id: `${externalId}:create_order_requested`,
    event_type: "create_order_requested",
    idempotency_key: `${externalId}:create_order_requested`,
    payload: {
      amount_minor: amountMinor, currency, offer_id: offerId,
      correlation_id: correlationId, mode: cfg.mode,
    },
    processing_status: "pending",
    related_order_id: externalId,
  });
  if (reqInsert.error) {
    const msg = reqInsert.error.message || "";
    if (!/duplicate key|idempotency_key/i.test(msg)) {
      console.error(JSON.stringify({
        stage: "create_order_requested_persist",
        order_id: externalId, error: msg,
      }));
      return errorResponse("persist_failed_pre_call", 503);
    }
  }

  // 2. Pre-call durable marker — ОБЯЗАТЕЛЬНО ДО rrCreateOrder.
  const { data: callStartData, error: callStartErr } = await callWithSingleRetry(
    async () => await supabaseAdmin.rpc("rr_mark_call_started", {
      _order_id: externalId, _correlation_id: correlationId,
    }),
  );
  if (callStartErr) {
    alertLocalStateUnconfirmed(
      externalId, correlationId, "mark_call_started",
      null, null, null, callStartErr.message,
    );
    return errorResponse("persist_failed_pre_call", 503);
  }
  const callStartResult = (callStartData ?? {}) as Record<string, unknown>;
  // Блокер №4: строгая typed-state проверка. Продолжаем ТОЛЬКО при state='call_started'.
  // Любой другой (terminal, already_started, произвольный) → fail-closed reread,
  // rrCreateOrder НЕ вызывается.
  if (callStartResult.ok !== true || callStartResult.state !== "call_started") {
    return await failClosedReread(
      supabaseAdmin, externalId, correlationId, "mark_call_started_state",
    );
  }

  const projectRef = (Deno.env.get("SUPABASE_URL") ?? "").match(
    /https:\/\/([^.]+)\.supabase\.co/,
  )?.[1];
  const notificationUrl = projectRef
    ? `https://${projectRef}.supabase.co/functions/v1/rr-webhook`
    : `${Deno.env.get("SUPABASE_URL")}/functions/v1/rr-webhook`;

  // 3. Вызов РР (pre-call marker уже durable записан).
  // Blocker ORD-26-02829 (B): RR provider description строим из canonical
  // composition snapshot — primary отдельной строкой, затем ВСЕ addons в
  // стабильном порядке sort_order / позиции. Никакого items[0]/find/legacy.
  // Provider ограничивает name 128 символами: используем короткие имена
  // модулей (после последнего "|", без префикса "Модуль:"), чтобы уместить
  // все аддоны и не терять их визуально в описании платежа.
  const compItems = Array.isArray(composableQuote.items) ? composableQuote.items : [];
  const primaryItem =
    compItems.find((i: any) => i?.role === "primary") ?? compItems[0];
  const addonItems = compItems
    .filter((i: any) => i && i !== primaryItem)
    .slice()
    .sort(
      (a: any, b: any) =>
        Number(a?.sort_order ?? 0) - Number(b?.sort_order ?? 0),
    );

  const shortenAddonName = (full: string | null | undefined): string => {
    const raw = (full ?? "").trim();
    if (!raw) return "";
    const parts = raw.split("|").map((p) => p.trim()).filter(Boolean);
    const tail = parts.length > 0 ? parts[parts.length - 1] : raw;
    return tail.replace(/^Модуль\s*[:\-–]?\s*/i, "").trim() || tail;
  };

  const primaryLabel = (() => {
    const pn = (primaryItem?.product_name ?? "").toString().trim();
    const tn = (primaryItem?.tariff_name ?? "").toString().trim();
    if (!pn) return "";
    return tn ? `${pn} — ${tn}` : pn;
  })();
  const addonShortLabels = addonItems
    .map((i: any) => shortenAddonName(i?.product_name))
    .filter((n: string) => n.length > 0);

  const MAX = 128;
  const buildItemName = (): string => {
    if (!primaryLabel && addonShortLabels.length === 0) return "Оплата заказа";
    // «<primary>. Модули: <n1>, <n2>, ...» — оба addon-а обязаны быть видны.
    let name = primaryLabel;
    if (addonShortLabels.length > 0) {
      const joined = addonShortLabels.join(", ");
      const withAll = name
        ? `${name}. Модули: ${joined}`
        : `Модули: ${joined}`;
      if (withAll.length <= MAX) return withAll;
      // Не помещается: усечём primary, но оба модуля оставим целиком.
      const suffix = `. Модули: ${joined}`;
      if (suffix.length + 4 <= MAX && name) {
        const budget = MAX - suffix.length - 1; // -1 для «…»
        if (budget > 8) {
          return `${name.slice(0, budget).trimEnd()}…${suffix}`;
        }
      }
      // Аварийный минимум: без primary, только модули.
      return suffix.slice(0, MAX);
    }
    return name.slice(0, MAX);
  };
  const itemName = buildItemName();


  const rrRes = await rrCreateOrder(cfg, {
    externalId, amountMinor, currency, notificationUrl, correlationId, itemName,
  });

  const redacted = redactRRResponse(rrRes.http.json);

  // 4. Классификация исхода.
  if (rrRes.outcomeClass === "upstream_rejected") {
    const { data: rejData, error: rejErr } = await callWithSingleRetry(async () =>
      await supabaseAdmin.rpc("rr_finalize_order_rejected", {
        _order_id: externalId,
        _reason_code: rrRes.errorText ?? "rr_upstream_rejected",
        _http_status: rrRes.status,
        _response_snippet: redacted,
      })
    );
    if (rejErr) {
      alertLocalStateUnconfirmed(
        externalId, correlationId, "reject_finalize",
        rrRes.failureKind, rrRes.status, rrRes.providerRequestId, rejErr.message,
      );
      await auditEvent(supabaseAdmin, externalId, "local_state_unconfirmed", {
        correlation_id: correlationId, stage: "reject_finalize",
      });
      return errorResponse("local_state_unconfirmed", 500);
    }
    const rejState = (rejData as any)?.state as string | undefined;
    if (rejState !== "rejected" && rejState !== "already_rejected") {
      return await failClosedReread(
        supabaseAdmin, externalId, correlationId, "reject_finalize_state",
      );
    }
    // Sprint C2 / Stage E.2 — universal CRM terminal 'failed' on canonical rejection.
    // Non-fatal: applyCrmStageOnTerminal is idempotent + manual-override guarded.
    try {
      await applyCrmStageOnTerminal(
        supabaseAdmin, externalId, "failed", "rr.initiate.upstream_rejected",
      );
    } catch (e) {
      console.error("[rr-initiate] crm-routing apply failed:", (e as Error).message);
    }
    return errorResponse("rr_create_order_rejected", 502);
  }

  if (rrRes.outcomeClass === "upstream_outcome_unknown") {
    const { data: unkData, error: unkErr } = await callWithSingleRetry(async () =>
      await supabaseAdmin.rpc("rr_mark_upstream_unknown", {
        _order_id: externalId,
        _provider_request_id: rrRes.providerRequestId,
        _failure_kind: rrRes.failureKind,
        _http_status: rrRes.status,
        _correlation_id: correlationId,
      })
    );
    if (unkErr) {
      alertLocalStateUnconfirmed(
        externalId, correlationId, "mark_unknown",
        rrRes.failureKind, rrRes.status, rrRes.providerRequestId, unkErr.message,
      );
      await auditEvent(supabaseAdmin, externalId, "local_state_unconfirmed", {
        correlation_id: correlationId, stage: "mark_unknown",
      });
      return errorResponse("local_state_unconfirmed", 500);
    }
    const unkState = (unkData as any)?.state as string | undefined;
    if (unkState !== "unknown_marked" && unkState !== "already_unknown") {
      return await failClosedReread(
        supabaseAdmin, externalId, correlationId, "mark_unknown_state",
      );
    }
    return errorResponse("rr_upstream_unknown", 504);
  }

  // upstream_created — payment_url валиден (adapter гарантирует; дублируем check).
  const paymentUrl = rrRes.paymentUrl!;
  if (!isSafePaymentUrl(paymentUrl)) {
    alertLocalStateUnconfirmed(
      externalId, correlationId, "adapter_returned_unsafe_url",
      rrRes.failureKind, rrRes.status, rrRes.providerRequestId, "unsafe_url",
    );
    return await failClosedReread(
      supabaseAdmin, externalId, correlationId, "unsafe_url",
    );
  }
  const providerRequestId = rrRes.providerRequestId;

  const { data: finData, error: finalizeErr } = await callWithSingleRetry(async () =>
    await supabaseAdmin.rpc("rr_finalize_created_order", {
      _order_id: externalId, _payment_url: paymentUrl,
      _rr_request_id: providerRequestId,
      _rr_status_raw: rrRes.rrStatusRaw ?? null,
      _raw_last: redacted, _correlation_id: correlationId,
    })
  );

  if (finalizeErr) {
    // РР создал заявку с валидным URL — локальная финализация упала.
    // Пробуем поставить local_persist_failed marker с 1 retry.
    console.error(JSON.stringify({
      stage: "finalize_persist", order_id: externalId,
      provider_request_id: providerRequestId,
      payment_url_present: true, error: finalizeErr.message,
    }));

    const { data: markData, error: markErr } = await callWithSingleRetry(async () =>
      await supabaseAdmin.rpc("rr_mark_local_persist_failed", {
        _order_id: externalId, _payment_url: paymentUrl,
        _rr_request_id: providerRequestId,
        _error_text: finalizeErr.message.slice(0, 500),
      })
    );

    if (markErr) {
      // Ни canonical finalize, ни recovery marker не подтверждены.
      // Pre-call marker сохранён (upstream_call_state='started') — reuse вернёт этот заказ
      // как rr_call_in_flight, пока reconciler/оператор не разрешит.
      alertLocalStateUnconfirmed(
        externalId, correlationId, "persist_failed_marker",
        rrRes.failureKind, rrRes.status, providerRequestId,
        `finalize:${finalizeErr.message}|mark:${markErr.message}`,
      );
      await auditEvent(supabaseAdmin, externalId, "local_state_unconfirmed", {
        correlation_id: correlationId, stage: "persist_failed_marker",
      });
      return errorResponse("local_state_unconfirmed", 500);
    }
    const markState = (markData as any)?.state as string | undefined;
    if (markState !== "persist_failed_marked" && markState !== "already_persist_failed") {
      return await failClosedReread(
        supabaseAdmin, externalId, correlationId, "persist_failed_marker_state",
      );
    }
    return errorResponse("local_persist_failed", 502);
  }

  const finState = (finData as any)?.state as string | undefined;
  if (finState !== "finalized" && finState !== "already_created") {
    return await failClosedReread(
      supabaseAdmin, externalId, correlationId, "finalize_state",
    );
  }

  return jsonResponse({
    payment_url: paymentUrl, order_id: externalId, reused: false,
  });
});
