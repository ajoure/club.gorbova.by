// admin-create-manual-payment (Stage 3R)
//
// Регистрирует ручной платёж непосредственно в public.payments_v2 через
// SECURITY DEFINER RPC public.admin_create_manual_payment_v1 (origin='manual_admin').
// Никаких записей в payment_reconcile_queue, никаких provider_events.
//
// - RBAC: has_admin_section_access(actor, 'payments','manage')
// - Provider allowlist: bepaid | stripe | rr | bank
// - Currency allowlist: BYN | RUB | USD | EUR | KZT | UAH | PLN
// - Idempotent: atomic INSERT ... ON CONFLICT в RPC по meta.idempotency_key.
//   Клиент передаёт случайный idempotencyKey (crypto.randomUUID()), сервер
//   вычисляет request_hash (SHA-256 нормализованного payload).

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

interface Body {
  provider: "bepaid" | "stripe" | "rr" | "bank";
  amount: number;
  currency: string;
  paidAt: string; // ISO
  profileId?: string | null;
  relatedOrderId?: string | null;
  customerEmail?: string | null;
  bankName?: string | null;
  bankDocumentNo?: string | null;
  externalId?: string | null;
  purpose?: string | null;
  note?: string | null;
  idempotencyKey: string;
}

const CURRENCIES = ["BYN", "RUB", "USD", "EUR", "KZT", "UAH", "PLN"];
const PROVIDERS = ["bepaid", "stripe", "rr", "bank"];

function bad(status: number, error: string, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ ok: false, error, ...extra }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return bad(405, "method_not_allowed");

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return bad(401, "unauthorized");

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authed = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const token = authHeader.replace("Bearer ", "");
  const { data: claims, error: claimsErr } = await authed.auth.getClaims(token);
  if (claimsErr || !claims?.claims?.sub) return bad(401, "invalid_jwt");
  const actorUserId = claims.claims.sub as string;

  const { data: hasAccess, error: rbacErr } = await admin.rpc("has_admin_section_access", {
    _user_id: actorUserId,
    _section_code: "payments",
    _min_level: "manage",
  });
  if (rbacErr) return bad(500, "rbac_check_failed", { detail: rbacErr.message });
  if (!hasAccess) return bad(403, "forbidden");

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return bad(400, "invalid_json");
  }

  const provider = String(body.provider || "").toLowerCase();
  if (!PROVIDERS.includes(provider)) return bad(400, "invalid_provider");

  if (typeof body.amount !== "number" || !isFinite(body.amount) || body.amount <= 0) {
    return bad(400, "invalid_amount");
  }
  const currency = String(body.currency || "").toUpperCase();
  if (!CURRENCIES.includes(currency)) return bad(400, "invalid_currency");

  if (!body.paidAt || Number.isNaN(Date.parse(body.paidAt))) return bad(400, "invalid_paid_at");
  const paidAtIso = new Date(body.paidAt).toISOString();

  if (!body.idempotencyKey || body.idempotencyKey.length < 8) {
    return bad(400, "missing_idempotency_key");
  }

  const requestId = crypto.randomUUID();

  // Стабильный нормализованный payload для request_hash.
  const normalized = JSON.stringify({
    v: 1,
    provider,
    amount: body.amount,
    currency,
    paidAt: paidAtIso,
    profileId: body.profileId ?? null,
    relatedOrderId: body.relatedOrderId ?? null,
    customerEmail: (body.customerEmail || "").trim().toLowerCase() || null,
    bankName: (body.bankName || "").trim() || null,
    bankDocumentNo: (body.bankDocumentNo || "").trim() || null,
    externalId: (body.externalId || "").trim() || null,
    purpose: (body.purpose || "").trim() || null,
    note: (body.note || "").trim() || null,
  });
  const requestHash = await sha256Hex(normalized);

  const { data: rpcResult, error: rpcErr } = await admin.rpc("admin_create_manual_payment_v1", {
    p_actor_user_id: actorUserId,
    p_provider: provider,
    p_amount: body.amount,
    p_currency: currency,
    p_paid_at: paidAtIso,
    p_profile_id: body.profileId ?? null,
    p_customer_email: body.customerEmail ?? null,
    p_bank_name: body.bankName ?? null,
    p_bank_document_no: body.bankDocumentNo ?? null,
    p_external_id: body.externalId ?? null,
    p_purpose: body.purpose ?? null,
    p_note: body.note ?? null,
    p_related_order_id: body.relatedOrderId ?? null,
    p_idempotency_key: body.idempotencyKey,
    p_request_hash: requestHash,
  });

  if (rpcErr) {
    return bad(500, "rpc_failed", { detail: rpcErr.message, request_id: requestId });
  }
  if (!rpcResult || rpcResult.ok !== true) {
    const err = String(rpcResult?.error || "rpc_error");
    const status =
      err === "idempotency_conflict"
        ? 409
        : err === "profile_not_found"
        ? 404
        : ["invalid_provider", "invalid_amount", "invalid_currency", "invalid_paid_at", "invalid_request_hash", "missing_idempotency_key"].includes(err)
        ? 400
        : 500;
    return bad(status, err, { detail: rpcResult, request_id: requestId });
  }

  // Audit — правильное имя колонки `meta`.
  const { error: auditErr } = await admin.from("audit_logs").insert({
    actor_user_id: actorUserId,
    action: "admin_manual_payment_created",
    entity_type: "payments_v2",
    entity_id: String(rpcResult.payment_id),
    meta: {
      request_id: requestId,
      payment_id: rpcResult.payment_id,
      provider,
      origin: "manual_admin",
      idempotency_key: body.idempotencyKey,
      request_hash: requestHash,
      amount: body.amount,
      currency,
      paid_at: paidAtIso,
      idempotent_replay: rpcResult.idempotent_replay === true,
      external_id: (body.externalId || "").trim() || null,
      bank_name: (body.bankName || "").trim() || null,
      bank_document_no: (body.bankDocumentNo || "").trim() || null,
      purpose: (body.purpose || "").trim() || null,
      related_order_id: body.relatedOrderId ?? null,
    },
  });
  if (auditErr) {
    // Не блокируем платёж, но логируем.
    console.error("[admin-create-manual-payment] audit insert failed", auditErr);
  }

  return new Response(
    JSON.stringify({
      ok: true,
      request_id: requestId,
      idempotent_replay: rpcResult.idempotent_replay === true,
      payment_id: rpcResult.payment_id,
      provider,
      amount: rpcResult.amount,
      currency: rpcResult.currency,
      paid_at: rpcResult.paid_at,
      origin: "manual_admin",
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
