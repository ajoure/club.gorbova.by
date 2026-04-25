// One-shot QA test account seeder. Service-role only via secret header.
// Creates qa.admin@gorbova.test (admin) and qa.user@gorbova.test (user).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-qa-secret, x-cron-secret",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ACCOUNTS = [
  { email: "qa.admin@gorbova.test", password: "QaAdmin!2026", full_name: "QA Admin", role: "admin" },
  { email: "qa.user@gorbova.test",  password: "QaUser!2026",  full_name: "QA User",  role: "user"  },
];

const ROLE_IDS: Record<string,string> = {
  admin: "16c9cefc-60a3-4edd-a421-46d556e80257",
  user:  "159eceef-5cd8-46d5-b238-ddf0c5cf77fa",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const expectedSecret = Deno.env.get("CRON_SECRET");
  const providedSecret =
    req.headers.get("x-qa-secret") ||
    req.headers.get("x-cron-secret") ||
    req.headers.get("authorization")?.replace("Bearer ", "");

  if (!expectedSecret || providedSecret !== expectedSecret) {
    console.error("[qa-seed-accounts] Unauthorized: invalid or missing secret");
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const out: any[] = [];
  for (const a of ACCOUNTS) {
    // Check if user already exists
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    let user = list?.users?.find(u => u.email === a.email) || null;
    if (!user) {
      const { data: created, error } = await admin.auth.admin.createUser({
        email: a.email,
        password: a.password,
        email_confirm: true,
        user_metadata: { full_name: a.full_name, qa_account: true },
        app_metadata: { qa_account: true },
      });
      if (error) { out.push({ email: a.email, error: error.message }); continue; }
      user = created.user;
    } else {
      // Ensure password and qa_account flag are set
      await admin.auth.admin.updateUserById(user.id, {
        password: a.password,
        user_metadata: { ...(user.user_metadata||{}), full_name: a.full_name, qa_account: true },
        app_metadata: { ...(user.app_metadata||{}), qa_account: true },
      });
    }
    // Upsert profile
    await admin.from("profiles").upsert({
      user_id: user!.id,
      full_name: a.full_name,
      meta: { qa_account: true, exclude_from_broadcasts: true, exclude_from_analytics: true },
    } as any, { onConflict: "user_id" });
    // Assign role
    await admin.from("user_roles_v2").upsert({
      user_id: user!.id,
      role_id: ROLE_IDS[a.role],
    } as any, { onConflict: "user_id,role_id" });
    out.push({ email: a.email, user_id: user!.id, role: a.role, status: "ok" });
  }
  return new Response(JSON.stringify({ accounts: out }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
