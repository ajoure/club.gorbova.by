import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { handleRepair } from "./handler.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const db = () =>
    createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  const response = await handleRepair(req, {
    serviceKey,
    authorizeAdmin: async (request) => {
      const bearer = request.headers.get("authorization")?.match(
        /^Bearer (.+)$/i,
      )?.[1];
      if (!bearer || !serviceKey) return false;
      const client = db();
      const { data, error } = await client.auth.getUser(bearer);
      if (error || !data.user) return false;
      for (const role of ["admin", "super_admin"]) {
        const check = await client.rpc("has_role_v2", {
          _user_id: data.user.id,
          _role_code: role,
        });
        if (check.error) return false;
        if (check.data === true) return true;
      }
      return false;
    },
    rpc: (args) => db().rpc("referral_retime_historical_sales", args),
  });
  for (const [name, value] of Object.entries(corsHeaders)) {
    response.headers.set(name, value);
  }
  return response;
});
