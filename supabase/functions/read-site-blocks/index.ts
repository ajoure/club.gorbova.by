import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { id } = await req.json();
  const { data, error } = await supabase.from("site_pages").select("blocks").eq("id", id).maybeSingle();
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
