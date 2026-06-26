// Temporary one-shot: apply PATCH-SITE018-HTML-CTA-HOTFIX
// Downloads corrected HTML from prompt-attachments bucket and updates site_pages
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: fileData, error: dlErr } = await supabase.storage
    .from("prompt-attachments")
    .download("hotfix/site018-hotfix.html");
  if (dlErr || !fileData) {
    return new Response(JSON.stringify({ ok: false, step: "download", error: dlErr?.message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  const code = await fileData.text();
  if (code.includes("openModal(\\\\'access\\\\')")) {
    return new Response(JSON.stringify({ ok: false, step: "guard", error: "double-escape still present" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const { data: page, error: selErr } = await supabase
    .from("site_pages")
    .select("id, blocks")
    .eq("slug", "ideologicheskaya-rabota")
    .single();
  if (selErr || !page) {
    return new Response(JSON.stringify({ ok: false, step: "select", error: selErr?.message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const blocks = Array.isArray(page.blocks) ? [...(page.blocks as any[])] : [];
  if (!blocks[0] || !blocks[0].content) {
    return new Response(JSON.stringify({ ok: false, step: "validate-blocks" }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  const beforeLen = (blocks[0].content.code || "").length;
  blocks[0] = { ...blocks[0], content: { ...blocks[0].content, code } };

  const { error: updErr } = await supabase
    .from("site_pages")
    .update({ blocks, updated_at: new Date().toISOString() })
    .eq("id", page.id);
  if (updErr) {
    return new Response(JSON.stringify({ ok: false, step: "update", error: updErr.message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({ ok: true, page_id: page.id, before_len: beforeLen, after_len: code.length }),
    { headers: { ...cors, "Content-Type": "application/json" } },
  );
});
