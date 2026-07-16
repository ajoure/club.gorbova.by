// One-shot: verify /cb AFTER-backup SHA-256 by reading storage object with service role.
// To be deleted together with cb-guarded-write in the final cleanup pass.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const url = Deno.env.get("SUPABASE_URL")!;
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const params = new URL(req.url).searchParams;
    const bucket = params.get("bucket") ?? "documents";
    const path = params.get("path") ?? "";
    if (!path) {
      return new Response(JSON.stringify({ error: "path required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const admin = createClient(url, key);
    const { data, error } = await admin.storage.from(bucket).download(path);
    if (error || !data) throw error ?? new Error("no data");
    const buf = new Uint8Array(await data.arrayBuffer());
    const digest = await crypto.subtle.digest("SHA-256", buf);
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    return new Response(
      JSON.stringify({ bucket, path, bytes: buf.byteLength, sha256: hex }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
