/**
 * rr-reconcile-order (Sprint B / Gate A.2)
 *
 * Admin-only reconciler для заявок РР с неопределённым исходом.
 * Читает актуальное состояние заявки в РР через rrGetOrderStatus и
 * обновляет локальное состояние ЧЕРЕЗ RPC — никогда не пишет напрямую.
 *
 * Разрешённые входные состояния (v_status = meta.rr.initiation_status):
 *   - pending + upstream_outcome='unknown'
 *   - pending + local_persist_failed=true
 * Любое terminal (created / failed) → 200 no_op.
 *
 * НИКОГДА не вызывает rrCreateOrder. Reconciler только читает статус
 * существующего externalId.
 *
 * Auth: Bearer JWT + has_role('admin' | 'superadmin').
 * CORS: только для того же origin (не публичный CORS).
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { createServiceClient, loadRRConfig } from "../_shared/rr/rr-config.ts";
import { rrGetOrderStatus } from "../_shared/rr/rr-adapter.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// РР статусы, которые считаем "заказ существует и валиден в РР".
const RR_STATUS_ORDER_EXISTS = new Set<string>([
  "NEW",
  "FORMED",
  "PROCESSED_TO_INSTALLMENT_COMPANY",
  "APPROVED",
  "PROCESSED_BY_INSTALLMENT_COMPANY",
]);
// РР статусы terminal-успеха/отказа.
const RR_STATUS_TERMINAL_REJECT = new Set<string>([
  "REJECTED",
  "CANCELLED",
  "EXPIRED",
]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json(401, { error: "unauthorized" });
  }
  const supabaseAdmin = createServiceClient();
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const token = authHeader.slice("Bearer ".length);
  const { data: userData, error: userErr } = await userClient.auth.getUser(token);
  if (userErr || !userData?.user) return json(401, { error: "unauthorized" });
  const userId = userData.user.id;

  const [{ data: isAdmin }, { data: isSuperAdmin }] = await Promise.all([
    supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "superadmin" }),
  ]);
  if (!isAdmin && !isSuperAdmin) return json(403, { error: "forbidden" });

  let body: { order_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }
  const orderId = String(body.order_id ?? "").trim();
  if (!UUID_RE.test(orderId)) return json(400, { error: "order_id_invalid" });

  // 1. Прочитать заявку.
  const { data: row, error: readErr } = await supabaseAdmin
    .from("orders_v2")
    .select("id, provider, status, meta")
    .eq("id", orderId)
    .maybeSingle();
  if (readErr) return json(500, { error: "read_failed", detail: readErr.message });
  if (!row) return json(404, { error: "order_not_found" });
  if (row.provider !== "rr") return json(400, { error: "wrong_provider" });
  const rr = (row.meta as any)?.rr ?? {};
  if ((row.meta as any)?.flow !== "rr_installment") {
    return json(400, { error: "wrong_flow" });
  }

  const initStatus: string | undefined = rr.initiation_status;
  const upstream: string | undefined = rr.upstream_outcome;
  const persistFailed = rr.local_persist_failed === true ||
    rr.local_persist_failed === "true";

  // 2. Terminal — не трогаем.
  if (initStatus === "created" || initStatus === "failed") {
    return json(200, { ok: true, action: "no_op_terminal", initiation_status: initStatus });
  }
  if (!(upstream === "unknown" || persistFailed)) {
    return json(200, {
      ok: true,
      action: "no_op_not_ambiguous",
      initiation_status: initStatus,
      upstream,
    });
  }

  // 3. Спрашиваем РР.
  let cfg;
  try {
    cfg = await loadRRConfig(supabaseAdmin);
  } catch (e) {
    return json(503, { error: "rr_config_unavailable", detail: (e as Error).message });
  }
  const status = await rrGetOrderStatus(cfg, orderId);
  const correlationId = crypto.randomUUID();

  // 4. Классификация ответа РР.
  // 4a. РР сообщает, что заказа нет (404 / errorCode === "1" в РР) → not_created.
  const notFound = (status.status === 404) ||
    (status.errorCode === "1" && !status.rrStatusRaw);
  if (notFound) {
    // Помечаем как not_created + terminal failed через reject wrapper.
    const { data: rejData, error: rejErr } = await supabaseAdmin.rpc(
      "rr_finalize_order_rejected",
      {
        _order_id: orderId,
        _reason_code: "rr_not_created_confirmed_by_status",
        _http_status: status.status,
        _response_snippet: {
          reconciler: true,
          rr_status_raw: status.rrStatusRaw ?? null,
          error_code: status.errorCode ?? null,
        },
      },
    );
    if (rejErr) return json(500, { error: "reject_persist_failed", detail: rejErr.message });
    return json(200, {
      ok: true,
      action: "reconciled_not_created",
      state: (rejData as any)?.state,
      correlation_id: correlationId,
    });
  }

  // 4b. Заказ существует + вернулся link → finalize как created через reconciler wrapper.
  if (status.paymentUrl && status.ok) {
    const { data: finData, error: finErr } = await supabaseAdmin.rpc(
      "rr_reconcile_confirm_created",
      {
        _order_id: orderId,
        _payment_url: status.paymentUrl,
        _rr_request_id: null,
        _rr_status_raw: status.rrStatusRaw ?? null,
        _raw_last: { reconciler: true, source: "getOrderStatus" },
        _correlation_id: correlationId,
      },
    );
    if (finErr) {
      return json(500, { error: "reconcile_persist_failed", detail: finErr.message });
    }
    return json(200, {
      ok: true,
      action: "reconciled_created",
      state: (finData as any)?.state,
      correlation_id: correlationId,
    });
  }

  // 4c. Заказ terminal-rejected в РР → also reject локально.
  if (status.rrStatusRaw && RR_STATUS_TERMINAL_REJECT.has(status.rrStatusRaw)) {
    const { data: rejData, error: rejErr } = await supabaseAdmin.rpc(
      "rr_finalize_order_rejected",
      {
        _order_id: orderId,
        _reason_code: `rr_status_${status.rrStatusRaw.toLowerCase()}`,
        _http_status: status.status,
        _response_snippet: {
          reconciler: true,
          rr_status_raw: status.rrStatusRaw,
        },
      },
    );
    if (rejErr) return json(500, { error: "reject_persist_failed", detail: rejErr.message });
    return json(200, {
      ok: true,
      action: "reconciled_rejected",
      state: (rejData as any)?.state,
      correlation_id: correlationId,
    });
  }

  // 4d. Заказ существует, но нет link (например NEW без сформированной ссылки)
  // либо неопределённый ответ РР → остаётся unknown, требуется operator.
  const operatorRequired = status.rrStatusRaw &&
    RR_STATUS_ORDER_EXISTS.has(status.rrStatusRaw);
  return json(200, {
    ok: true,
    action: operatorRequired ? "operator_required" : "still_unknown",
    rr_status_raw: status.rrStatusRaw ?? null,
    http_status: status.status,
    correlation_id: correlationId,
  });
});
