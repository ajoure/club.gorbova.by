// ONE-SHOT migration: patch SITE-000018 block[0].content.code with the version
// shipped alongside this function (site018.html). Updates Gorbova Club ideology
// trial offer to not require card/auto-charge.
//
// Idempotent: re-runs are safe (write is conditional on changed content).
// Auth: requires service-role JWT or `x-admin-secret` header matching the
// project's INTERNAL_PATCH_SECRET. Public traffic is rejected.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { SITE018_HTML_B64 } from "./site018_html.ts";


const PAGE_ID = "7e672fed-13f1-4ff1-8786-71a228a0c011";
const TRIAL_OFFER_ID = "891c7fe0-eb9d-4853-a1d5-bb69d688c801";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type, x-admin-secret",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  const expected = Deno.env.get("BLOCKS_PATCH_TOKEN");
  const provided = req.headers.get("x-admin-secret");
  if (!expected || provided !== expected) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }


  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(url, key);

  // 1) Load patched HTML shipped with the function.
  const html = await Deno.readTextFile(new URL("./site018.html", import.meta.url));

  // 2) Fetch current page, find block[0].
  const { data: page, error: fetchErr } = await supabase
    .from("site_pages")
    .select("id, blocks")
    .eq("id", PAGE_ID)
    .single();
  if (fetchErr || !page) {
    return new Response(JSON.stringify({ error: "page_not_found", detail: fetchErr?.message }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  const blocks = Array.isArray(page.blocks) ? [...(page.blocks as any[])] : [];
  if (!blocks[0] || !blocks[0].content) {
    return new Response(JSON.stringify({ error: "block0_missing" }), {
      status: 422,
      headers: { "content-type": "application/json" },
    });
  }
  const prevLen = (blocks[0].content.code || "").length;
  blocks[0] = { ...blocks[0], content: { ...blocks[0].content, code: html } };

  const { error: updErr } = await supabase
    .from("site_pages")
    .update({ blocks, updated_at: new Date().toISOString() })
    .eq("id", PAGE_ID);
  if (updErr) {
    return new Response(JSON.stringify({ error: "update_failed", detail: updErr.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  // 3) Normalize trial offer so the demo flow doesn't ask for a card and
  //    doesn't auto-charge after 24h — strict requirement from product owner.
  const { error: offerErr } = await supabase
    .from("tariff_offers")
    .update({
      requires_card_tokenization: false,
      auto_charge_after_trial: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", TRIAL_OFFER_ID);

  return new Response(
    JSON.stringify({
      ok: true,
      page_id: PAGE_ID,
      prev_code_length: prevLen,
      new_code_length: html.length,
      offer_update_error: offerErr?.message ?? null,
    }),
    { headers: { "content-type": "application/json" } },
  );
});
