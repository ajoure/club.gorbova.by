import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "Supabase configuration unavailable" }, 500);

    const authorization = request.headers.get("Authorization") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: userData, error: authError } = await userClient.auth.getUser();
    if (authError || !userData.user) return json({ error: "Unauthorized" }, 401);

    const serviceClient = createClient(supabaseUrl, serviceKey);
    const [{ data: isAdmin }, { data: isSuperAdmin }] = await Promise.all([
      serviceClient.rpc("has_role_v2", { _user_id: userData.user.id, _role_code: "admin" }),
      serviceClient.rpc("has_role_v2", { _user_id: userData.user.id, _role_code: "super_admin" }),
    ]);
    if (!isAdmin && !isSuperAdmin) return json({ error: "Admin access required" }, 403);

    const body = await request.json().catch(() => ({}));
    const sourceUrl = String(body?.sheet_url ?? "").trim();
    const sheetName = String(body?.sheet_name ?? "База для обзвона").trim();
    const match = sourceUrl.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)(?:\/|$)/);
    if (!match || !sheetName || sheetName.length > 120) return json({ error: "Only a valid Google Sheets URL is allowed" }, 400);

    const exportUrl = `https://docs.google.com/spreadsheets/d/${match[1]}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
    const upstream = await fetch(exportUrl, { redirect: "follow" });
    if (!upstream.ok) return json({ error: `Google Sheets returned ${upstream.status}` }, 502);
    const csv = await upstream.text();
    if (!csv.trim()) return json({ error: "Google Sheet is empty" }, 422);
    return json({ csv, spreadsheet_id: match[1], sheet_name: sheetName });
  } catch (error) {
    console.error("[company-sheet-fetch]", error);
    return json({ error: error instanceof Error ? error.message : "Unable to fetch Google Sheet" }, 500);
  }
});
