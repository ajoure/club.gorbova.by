// ONE-SHOT helper to apply patched site_pages.blocks. Will be deleted right after use.
// NOTE: deployed without auth deliberately for this single operation; deleted immediately afterwards.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json();
    const { page_id, blocks_base64 } = body;
    if (!page_id || !blocks_base64) {
      return new Response(JSON.stringify({ error: "missing page_id or blocks_base64" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    }
    const decoded = new TextDecoder("utf-8").decode(
      Uint8Array.from(atob(blocks_base64), c => c.charCodeAt(0))
    );
    const newBlocks = JSON.parse(decoded);
    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { error } = await supa
      .from("site_pages")
      .update({ blocks: newBlocks, updated_at: new Date().toISOString() })
      .eq("id", page_id);
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ ok: true, page_id, blocks_count: Array.isArray(newBlocks) ? newBlocks.length : null }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
