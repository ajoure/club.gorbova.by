import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleRepair } from "./handler.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  // Authentication precedes client creation and every database call.
  return handleRepair(req, {
    serviceKey,
    rpc: (args) =>
      createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      }).rpc("referral_retime_historical_sales", args),
  });
});
