/**
 * rr-fulfill-order (Sprint C1 — admin retry / backfill)
 *
 * Admin-only. Принимает { order_id } и вызывает promoteAuthorizedRRPayment
 * с source='rr-fulfill-order'. Используется для:
 *   - controlled backfill существующих authorized-заказов, у которых
 *     webhook пришёл до включения Sprint C1;
 *   - ручного retry, если grant-access-for-order упал.
 *
 * Идемпотентно: если orders_v2.status='paid' и fulfillment.status='completed'
 * — RPC вернёт already_promoted, grant-access не вызывается.
 *
 * Auth: Bearer JWT + has_role('admin' | 'superadmin').
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { createServiceClient } from "../_shared/rr/rr-config.ts";
import { promoteAuthorizedRRPayment } from "../_shared/rr/rr-promote-order.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Admin-only function: restrict CORS to known operator origins. Browser
// callers from other origins are denied at preflight; server-to-server calls
// (curl/CLI) ignore CORS entirely.
const ALLOWED_ORIGINS = new Set<string>([
  "https://gorbova.by",
  "https://cb.gorbova.by",
  "https://gorbova.lovable.app",
]);

function buildCors(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : "null";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
  };
}


function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function json(status: number, body: unknown, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" }, cors);


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

  let body: {
    order_id?: string;
    rr_status_override?: string; // для backfill, если у заказа нет last_notification
  } = {};
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }
  const orderId = String(body.order_id ?? "").trim();
  if (!UUID_RE.test(orderId)) return json(400, { error: "order_id_invalid" });

  // Прочитать заказ, чтобы взять rr_status_raw из last_notification (если override не задан).
  const { data: order, error: readErr } = await supabaseAdmin
    .from("orders_v2")
    .select("id, provider, status, meta")
    .eq("id", orderId)
    .maybeSingle();
  if (readErr) return json(500, { error: "read_failed", detail: readErr.message });
  if (!order) return json(404, { error: "order_not_found" });
  if (order.provider !== "rr") return json(400, { error: "wrong_provider" });
  const meta = (order.meta ?? {}) as any;
  if (meta?.flow !== "rr_installment") return json(400, { error: "wrong_flow" });

  const rrStatusRaw = String(
    body.rr_status_override ??
      meta?.rr?.last_notification?.new_status_raw ??
      "",
  ).trim();
  if (!rrStatusRaw) {
    return json(400, {
      error: "no_rr_status_available",
      hint: "no meta.rr.last_notification and no rr_status_override provided",
    });
  }

  const signHashShort = String(
    meta?.rr?.last_notification?.sign_hash_short ?? "manual",
  );

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const result = await promoteAuthorizedRRPayment(
    { supabaseAdmin, supabaseUrl, serviceRoleKey },
    {
      orderId,
      source: "rr-fulfill-order",
      rrStatusRaw,
      signHashShort,
    },
  );

  return json(200, { ok: true, actor_user_id: userId, result });
});
