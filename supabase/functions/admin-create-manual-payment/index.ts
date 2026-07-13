// admin-create-manual-payment (Stage 3)
// Creates a canonical row in public.payment_reconcile_queue for a manually-recorded
// payment (e.g. bank transfer or RR receipt). The queue row can then be linked to
// an order via the existing admin-create-deal-from-payment flow.
//
// - RBAC: has_admin_section_access(actor, 'payments','manage')
// - Provider allowlist: bepaid | stripe | rr | bank
// - Idempotent: uses (provider, external_id) uniqueness where present, plus optional
//   idempotencyKey stored in meta.idempotency_key. Replay returns the existing row.
// - Amount / currency validated server-side; status is fixed to 'successful'.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

interface Body {
  provider: "bepaid" | "stripe" | "rr" | "bank";
  amount: number;
  currency: string;
  paidAt: string;              // ISO
  externalId?: string | null;  // e.g. bank receipt number
  note?: string | null;
  profileId?: string | null;
  customerEmail?: string | null;
  idempotencyKey: string;
}

const CURRENCIES = ["BYN","RUB","USD","EUR","KZT","UAH","PLN"];
const PROVIDERS = ["bepaid","stripe","rr","bank"];

function bad(status: number, error: string, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ ok: false, error, ...extra }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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
  try { body = await req.json(); } catch { return bad(400, "invalid_json"); }

  if (!PROVIDERS.includes(body.provider)) return bad(400, "invalid_provider");
  if (typeof body.amount !== "number" || !isFinite(body.amount) || body.amount <= 0) {
    return bad(400, "invalid_amount");
  }
  const currency = String(body.currency || "").toUpperCase();
  if (!CURRENCIES.includes(currency)) return bad(400, "invalid_currency");
  if (!body.paidAt || Number.isNaN(Date.parse(body.paidAt))) return bad(400, "invalid_paid_at");
  if (!body.idempotencyKey || body.idempotencyKey.length < 8) {
    return bad(400, "missing_idempotency_key");
  }

  // Idempotency lookup: same key stored in meta.idempotency_key ⇒ return existing row.
  const { data: existing } = await admin
    .from("payment_reconcile_queue")
    .select("id, matched_order_id, amount, currency, provider, paid_at, external_id")
    .eq("meta->>idempotency_key", body.idempotencyKey)
    .maybeSingle();

  if (existing) {
    return new Response(JSON.stringify({
      ok: true,
      idempotent_replay: true,
      queue_row_id: existing.id,
      matched_order_id: existing.matched_order_id ?? null,
      provider: existing.provider,
      amount: existing.amount,
      currency: existing.currency,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const externalId = body.externalId?.trim() || `manual-${crypto.randomUUID()}`;

  const insertRow: Record<string, unknown> = {
    provider: body.provider,
    status: "successful",
    status_normalized: "successful",
    amount: body.amount,
    currency,
    paid_at: body.paidAt,
    created_at: new Date().toISOString(),
    external_id: externalId,
    customer_email: body.customerEmail?.trim() || null,
    matched_profile_id: body.profileId ?? null,
    meta: {
      source: "admin_manual",
      created_by: actorUserId,
      idempotency_key: body.idempotencyKey,
      note: body.note ?? null,
    },
  };

  const { data: inserted, error: insErr } = await admin
    .from("payment_reconcile_queue")
    .insert(insertRow)
    .select("id, provider, amount, currency, paid_at, external_id")
    .single();

  if (insErr) {
    // Уникальный (provider, external_id) — если был передан пользователем и уже есть.
    if ((insErr as any).code === "23505") {
      return bad(409, "duplicate_external_id", { detail: insErr.message });
    }
    return bad(500, "insert_failed", { detail: insErr.message });
  }

  // Audit
  await admin.from("audit_logs").insert({
    actor_user_id: actorUserId,
    action: "admin_manual_payment_created",
    entity_type: "payment_reconcile_queue",
    entity_id: inserted!.id,
    metadata: {
      provider: body.provider,
      amount: body.amount,
      currency,
      external_id: externalId,
      idempotency_key: body.idempotencyKey,
    },
  }).catch(() => { /* audit failure must not block */ });

  return new Response(JSON.stringify({
    ok: true,
    idempotent_replay: false,
    queue_row_id: inserted!.id,
    provider: inserted!.provider,
    amount: inserted!.amount,
    currency: inserted!.currency,
    paid_at: inserted!.paid_at,
    external_id: inserted!.external_id,
  }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
