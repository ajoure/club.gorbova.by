import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// One-shot QA helper. Resets passwords of two known QA accounts.
// Auth: requires header x-qa-key matching env QA_RESET_KEY.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const key = req.headers.get("x-qa-key") ?? "";
  if (key !== Deno.env.get("QA_RESET_KEY")) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const TARGETS = [
    { id: "913bc4cf-c68c-4a1b-a98d-adf778ef02d1", email: "qa.admin@gorbova.test" },
    { id: "638a13ec-62a8-47b3-90d9-bc3a4e22c174", email: "qa.user@gorbova.test" },
  ];
  const NEW_PASSWORD = "QATest2026!";

  const results: any[] = [];
  for (const t of TARGETS) {
    const { data, error } = await admin.auth.admin.updateUserById(t.id, {
      password: NEW_PASSWORD,
      email_confirm: true,
    });
    results.push({ email: t.email, ok: !error, error: error?.message ?? null, user_id: data?.user?.id });
  }

  return new Response(JSON.stringify({ results, password: NEW_PASSWORD }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
