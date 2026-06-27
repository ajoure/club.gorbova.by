// Preorder writer (thin wrapper). Calls RPC create_preorder_deal_atomic
// which atomically creates course_preregistrations + draft orders_v2.
// No payments / subscriptions / access grants are created.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const offer_id = String(payload?.offer_id || "").trim();
  const name = String(payload?.name || "").trim();
  const email = String(payload?.email || "").trim();
  const phone = payload?.phone ? String(payload.phone).trim() : null;
  const consent = payload?.consent === true;
  const idempotency_key = payload?.idempotency_key
    ? String(payload.idempotency_key).slice(0, 128)
    : null;

  if (!UUID_RE.test(offer_id)) return json(400, { error: "invalid_offer_id" });
  if (!name || name.length > 255) return json(400, { error: "invalid_name" });
  if (!EMAIL_RE.test(email) || email.length > 320)
    return json(400, { error: "invalid_email" });
  if (!consent) return json(400, { error: "consent_required" });
  if (phone && phone.length > 64) return json(400, { error: "invalid_phone" });

  // Resolve user from Authorization (do NOT trust body-supplied user_id)
  let user_id: string | null = null;
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data } = await userClient.auth.getUser();
      user_id = data.user?.id ?? null;
    } catch (_) {
      user_id = null;
    }
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await admin.rpc("create_preorder_deal_atomic", {
    p_offer_id: offer_id,
    p_name: name,
    p_email: email,
    p_phone: phone,
    p_consent: true,
    p_user_id: user_id,
    p_idempotency_key: idempotency_key,
  });

  if (error) {
    console.error("[preorder-create-deal] RPC error:", error);
    return json(400, { error: error.message || "rpc_failed" });
  }

  const result = data as {
    deduped: boolean;
    preregistration_id: string;
    order_id: string;
  };

  // Fire-and-forget notification (do not block / do not rollback)
  if (!result.deduped) {
    try {
      admin.functions
        .invoke("course-prereg-notify", {
          body: {
            id: result.preregistration_id,
            name,
            email,
            phone,
            offer_id,
            order_id: result.order_id,
          },
        })
        .catch((e) => console.warn("[preorder-create-deal] notify failed:", e?.message));
    } catch (e) {
      console.warn("[preorder-create-deal] notify dispatch failed:", e);
    }
  }

  return json(200, { success: true, ...result });
});
