// ⚠️ TEMPORARY QA HELPER — DO NOT KEEP.
// Resets passwords for the two QA test accounts only. Hardcoded allow-list.
// Will be deleted immediately after the PATCH 3-6 runtime pass completes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED = new Set(["qa.admin@gorbova.test", "qa.user@gorbova.test"]);
const FIXED_PASSWORD = "QATest2026!";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const out: Record<string, string> = {};
    for (const email of ALLOWED) {
      const { data: list, error: listErr } = await admin.auth.admin.listUsers();
      if (listErr) throw listErr;
      const u = list.users.find((x) => x.email === email);
      if (!u) { out[email] = "not_found"; continue; }
      const { error } = await admin.auth.admin.updateUserById(u.id, { password: FIXED_PASSWORD });
      out[email] = error ? `error: ${error.message}` : "ok";
    }
    return new Response(JSON.stringify({ ok: true, password: FIXED_PASSWORD, results: out }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e?.message ?? String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
