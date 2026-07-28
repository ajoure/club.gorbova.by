import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import JSZip from "https://esm.sh/jszip@3.10.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = !!body.dry_run;
    const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

    // 1. Download v9
    const { data: dl, error: dlErr } = await supa.storage.from("documents").download("templates/1785213900308-otchet-v9.docx");
    if (dlErr) throw new Error("download: " + dlErr.message);
    const buf = new Uint8Array(await dl.arrayBuffer());

    // 2. Load DOCX, patch document.xml header date token
    const zip = await JSZip.loadAsync(buf);
    const docXml = await zip.file("word/document.xml")!.async("string");

    // Find header pattern: "№ {{field:FLD-000069}} от {{...}}"
    // Replace the date token that follows "от " with pf-000032|format=long_ru
    // We need to find the specific location.
    const headerRe = /(№\s*\{\{field:FLD-000069\}\}\s*от\s*)\{\{[^}]+\}\}/;
    const match = docXml.match(headerRe);
    // Also might be split across runs. Search plain string tokens first.
    let newXml = docXml;
    let replacedCount = 0;
    if (match) {
      newXml = docXml.replace(headerRe, `$1{{pf-000032|format=long_ru}}`);
      replacedCount = 1;
    }

    // If no match found in plain text, search for FLD-000069 context
    if (replacedCount === 0) {
      const idx = docXml.indexOf("FLD-000069");
      const snippet = idx >= 0 ? docXml.slice(idx, idx + 2000) : "NOT_FOUND";
      return new Response(JSON.stringify({ ok: false, reason: "header_regex_no_match", snippet }), {
        headers: { "content-type": "application/json" },
      });
    }

    if (dryRun) {
      const idx = newXml.indexOf("FLD-000069");
      return new Response(JSON.stringify({ ok: true, dry_run: true, replaced: replacedCount, snippet: newXml.slice(Math.max(0,idx-50), idx + 400) }), {
        headers: { "content-type": "application/json" },
      });
    }

    zip.file("word/document.xml", newXml);
    const outBuf = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });

    // 3. Upload v10
    const newPath = `templates/${Date.now()}-otchet-v10.docx`;
    const { error: upErr } = await supa.storage.from("documents").upload(newPath, outBuf, {
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: false,
    });
    if (upErr) throw new Error("upload: " + upErr.message);

    // sha256
    const hashBuf = await crypto.subtle.digest("SHA-256", outBuf);
    const sha = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, "0")).join("");

    return new Response(JSON.stringify({
      ok: true,
      storage_path: newPath,
      file_size: outBuf.byteLength,
      sha256: sha,
    }), { headers: { "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }), {
      status: 500, headers: { "content-type": "application/json" },
    });
  }
});
