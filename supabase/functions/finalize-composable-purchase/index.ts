import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { finalizeComposablePurchase } from "../_shared/finalize-composable-purchase.ts";
import { requestHasServiceRoleKey } from "../_shared/service-request-auth.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return respond(405, { error: "method_not_allowed" });

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!requestHasServiceRoleKey(req, serviceRoleKey)) {
    return respond(403, { error: "service_role_required" });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return respond(400, { error: "invalid_json" });
  }
  const primaryOrderId = String(body.primary_order_id ?? body.order_id ?? "").trim();
  const paymentId = body.payment_id == null ? null : String(body.payment_id).trim();
  if (!UUID_RE.test(primaryOrderId)) {
    return respond(400, { error: "primary_order_id_invalid" });
  }
  if (paymentId && !UUID_RE.test(paymentId)) {
    return respond(400, { error: "payment_id_invalid" });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    serviceRoleKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  try {
    const result = await finalizeComposablePurchase(admin, {
      primaryOrderId,
      paymentId,
      source: String(body.source ?? "finalize-composable-purchase"),
    });
    return respond(200, result);
  } catch (error) {
    console.error("[finalize-composable-purchase]", error);
    return respond(500, {
      error: "finalization_failed",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});
