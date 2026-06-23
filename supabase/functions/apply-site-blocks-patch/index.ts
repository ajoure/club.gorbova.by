import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Accepts { id, blocks_b64 } where blocks_b64 is base64 of JSON string of blocks array.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { id, blocks_b64 } = await req.json();
  const bin = Uint8Array.from(atob(blocks_b64), c => c.charCodeAt(0));
  const text = new TextDecoder().decode(bin);
  const blocks = JSON.parse(text);
  const { error } = await supabase.from("site_pages").update({ blocks }).eq("id", id);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  return new Response(JSON.stringify({ ok: true, len: text.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
