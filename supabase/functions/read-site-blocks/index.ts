import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
Deno.serve(async (req) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { id } = await req.json();
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await sb.from("site_pages").select("blocks").eq("id", id).single();
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: cors });
  return new Response(JSON.stringify({ blocks: data.blocks }), { headers: cors });
});
