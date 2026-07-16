// One-shot guarded HTML write for site_pages.id=d5a5c2e0-... (страница /cb).
// Требует admin/super_admin JWT. Выполняет UPDATE только при совпадении
// updated_at, длины blocks и BEFORE_SHA. Возвращает postflight-метрики.
//
// Удалить сразу после успешного cutover.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const PAGE_ID = "d5a5c2e0-9e4c-4e6c-b9bc-1e4bd264d656";
const BEFORE_SHA = "3e5f0d734f9e5e26dc0536d1454b057397347942beffd12e83fd3c648b80e5e7";
const EXPECTED_UPDATED_AT = "2026-07-15T14:09:21.302256+00:00";
const EXPECTED_AFTER_SHA = "f045f2b7d653bd0910d853761d13e90eb336936468bb21b96a4d678da4b144f1";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sha256hex(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function countMarker(html: string, needle: string): number {
  let n = 0, i = 0;
  while ((i = html.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "missing_jwt" }), { status: 401, headers: { ...CORS, "content-type": "application/json" } });
  }

  const authed = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: userRes, error: userErr } = await authed.auth.getUser();
  if (userErr || !userRes?.user) {
    return new Response(JSON.stringify({ error: "invalid_jwt" }), { status: 401, headers: { ...CORS, "content-type": "application/json" } });
  }
  const uid = userRes.user.id;

  const admin = createClient(url, service);
  const { data: isAdmin, error: aErr } = await admin.rpc("has_role_v2", { _user_id: uid, _role_code: "admin" });
  const { data: isSuper, error: sErr } = await admin.rpc("has_role_v2", { _user_id: uid, _role_code: "super_admin" });
  if (aErr || sErr) {
    return new Response(JSON.stringify({ error: "role_check_failed", detail: aErr?.message ?? sErr?.message }), { status: 500, headers: { ...CORS, "content-type": "application/json" } });
  }
  if (!isAdmin && !isSuper) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...CORS, "content-type": "application/json" } });
  }

  // Загружаем целевой HTML из Storage.
  const dl = await admin.storage.from("documents").download("cb-cutover/cb.rewritten.html");
  if (dl.error || !dl.data) {
    return new Response(JSON.stringify({ error: "html_download_failed", detail: dl.error?.message }), { status: 500, headers: { ...CORS, "content-type": "application/json" } });
  }
  const newCode = await dl.data.text();
  const newSha = await sha256hex(newCode);
  if (newSha !== EXPECTED_AFTER_SHA) {
    return new Response(JSON.stringify({ error: "bundle_sha_mismatch", got: newSha }), { status: 500, headers: { ...CORS, "content-type": "application/json" } });
  }

  // Preflight — читаем текущее состояние.
  const { data: page, error: readErr } = await admin
    .from("site_pages")
    .select("id, updated_at, blocks")
    .eq("id", PAGE_ID)
    .maybeSingle();
  if (readErr || !page) {
    return new Response(JSON.stringify({ error: "page_not_found", detail: readErr?.message }), { status: 404, headers: { ...CORS, "content-type": "application/json" } });
  }
  const blocks = page.blocks as unknown as Array<{ type: string; content: { code: string } }>;
  if (!Array.isArray(blocks) || blocks.length !== 1) {
    return new Response(JSON.stringify({ error: "blocks_len_mismatch", len: Array.isArray(blocks) ? blocks.length : null }), { status: 409, headers: { ...CORS, "content-type": "application/json" } });
  }
  const beforeCode = blocks[0]?.content?.code ?? "";
  const beforeSha = await sha256hex(beforeCode);
  if (beforeSha !== BEFORE_SHA) {
    return new Response(JSON.stringify({ error: "before_sha_mismatch", got: beforeSha }), { status: 409, headers: { ...CORS, "content-type": "application/json" } });
  }
  if (page.updated_at !== EXPECTED_UPDATED_AT) {
    return new Response(JSON.stringify({ error: "updated_at_mismatch", got: page.updated_at }), { status: 409, headers: { ...CORS, "content-type": "application/json" } });
  }

  // Guarded UPDATE. Second WHERE-clause on updated_at is the optimistic lock —
  // если строка изменится между read и write, UPDATE вернёт 0 строк.
  const newBlocks = [{ ...blocks[0], content: { ...blocks[0].content, code: newCode } }];
  const { data: updRows, error: updErr } = await admin
    .from("site_pages")
    .update({ blocks: newBlocks })
    .eq("id", PAGE_ID)
    .eq("updated_at", EXPECTED_UPDATED_AT)
    .select("id, updated_at, blocks");
  if (updErr) {
    return new Response(JSON.stringify({ error: "update_failed", detail: updErr.message }), { status: 500, headers: { ...CORS, "content-type": "application/json" } });
  }
  if (!updRows || updRows.length !== 1) {
    return new Response(JSON.stringify({ error: "guard_failed_zero_or_multi_rows", rows: updRows?.length ?? 0 }), { status: 409, headers: { ...CORS, "content-type": "application/json" } });
  }

  const updBlocks = updRows[0].blocks as unknown as Array<{ type: string; content: { code: string } }>;
  const afterCode = updBlocks[0]?.content?.code ?? "";
  const afterSha = await sha256hex(afterCode);

  const counters = {
    "offer-wrapper": countMarker(afterCode, 'data-lovable-offer-wrapper="'),
    "position-variant": countMarker(afterCode, 'data-lovable-position-variant="'),
    "product-lead-cta": countMarker(afterCode, 'data-lovable-product-lead-cta="'),
    "slot-group": countMarker(afterCode, 'data-lovable-slot-group="'),
    "slot-extra": countMarker(afterCode, 'data-lovable-slot-extra="'),
    "slot-template": countMarker(afterCode, 'data-lovable-slot-template="'),
    "offer-label": countMarker(afterCode, 'data-lovable-offer-label="'),
    "lovable-action": countMarker(afterCode, 'data-lovable-action="'),
    "tariff-key": countMarker(afterCode, 'data-tariff-key="'),
  };

  const elemIdRe = /data-elem-id="([^"]+)"/g;
  const elemIds = new Set<string>();
  let dup = 0;
  let m: RegExpExecArray | null;
  while ((m = elemIdRe.exec(afterCode)) !== null) {
    if (elemIds.has(m[1])) dup++;
    else elemIds.add(m[1]);
  }

  return new Response(
    JSON.stringify({
      ok: true,
      page_id: PAGE_ID,
      before_sha: beforeSha,
      after_sha: afterSha,
      after_sha_match: afterSha === EXPECTED_AFTER_SHA,
      blocks_len: updBlocks.length,
      block_type: updBlocks[0]?.type,
      counters,
      elem_ids_total: elemIds.size,
      elem_ids_duplicates: dup,
      new_updated_at: updRows[0].updated_at,
    }, null, 2),
    { status: 200, headers: { ...CORS, "content-type": "application/json" } },
  );
});
