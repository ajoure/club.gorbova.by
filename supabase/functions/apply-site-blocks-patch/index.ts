import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decodeBase64 as b64decode } from "https://deno.land/std@0.224.0/encoding/base64.ts";
Deno.serve(async (req) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { id, blocks_b64 } = await req.json();
  const blocks = JSON.parse(new TextDecoder().decode(b64decode(blocks_b64)));
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { error } = await sb.from("site_pages").update({ blocks }).eq("id", id);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: cors });
  return new Response(JSON.stringify({ ok: true }), { headers: cors });
});
