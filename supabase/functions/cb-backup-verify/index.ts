// One-shot: verify (GET) or write (POST) /cb AFTER-backup via service role.
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
    if (!path) throw new Error("path required");
    const admin = createClient(url, key);

    if (req.method === "DELETE") {
      const { error } = await admin.storage.from(bucket).remove([path]);
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, deleted: path }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (req.method === "POST") {
      const buf = new Uint8Array(await req.arrayBuffer());
      const ct = params.get("contentType") ?? "text/html; charset=utf-8";
      const { error } = await admin.storage.from(bucket).upload(path, buf, {
        contentType: ct, upsert: true, cacheControl: "no-cache",
      });
      if (error) throw error;
      const digest = await crypto.subtle.digest("SHA-256", buf);
      const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      return new Response(JSON.stringify({ ok: true, bucket, path, bytes: buf.byteLength, sha256: hex }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data, error } = await admin.storage.from(bucket).download(path);
    if (error || !data) throw error ?? new Error("no data");
    const buf = new Uint8Array(await data.arrayBuffer());
    const digest = await crypto.subtle.digest("SHA-256", buf);
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    return new Response(JSON.stringify({ bucket, path, bytes: buf.byteLength, sha256: hex }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message ?? e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
