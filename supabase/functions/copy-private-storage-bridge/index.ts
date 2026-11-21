// TEMPORARY. Copies private Storage objects of this project into the
// "копия gorbova.by" project for the supervised migration test copy
// (new.gorbova.by), then is removed. Read-only for this project.
//
// Safety model: the caller supplies, per object, a signed *upload* URL issued
// by the copy project for exactly the same bucket and path. Only the copy
// project can issue such tokens, and the destination origin and path are
// pinned below, so this endpoint cannot send bytes anywhere else, cannot
// rename objects and cannot read or change anything in this project.
// Nothing is logged except aggregate counts; no object names, no URLs.

import { ALLOWED_BUCKETS, encodePath, type Item, MAX_ITEMS, validUploadUrl } from "./validate.ts";

async function copyOne(item: Item, base: string, key: string) {
  if (!ALLOWED_BUCKETS.has(item.bucket) || typeof item.name !== "string" || !item.name || item.name.includes("..")) {
    return { ok: false, error: "item_not_allowed" };
  }
  const destination = validUploadUrl(item);
  if (!destination) return { ok: false, error: "upload_url_not_allowed" };

  const source = await fetch(
    `${base}/storage/v1/object/authenticated/${encodeURIComponent(item.bucket)}/${encodePath(item.name)}`,
    { headers: { Authorization: `Bearer ${key}`, apikey: key } },
  );
  if (!source.ok || !source.body) {
    await source.body?.cancel();
    return { ok: false, error: `source_http_${source.status}` };
  }
  const length = source.headers.get("content-length");
  const upload = await fetch(destination, {
    method: "PUT",
    headers: {
      "Content-Type": source.headers.get("content-type") ?? "application/octet-stream",
      ...(source.headers.get("cache-control") ? { "cache-control": source.headers.get("cache-control")! } : {}),
      ...(length ? { "Content-Length": length } : {}),
      "x-upsert": "false",
    },
    body: source.body,
    // @ts-ignore Deno streaming request body
    duplex: "half",
  });
  const status = upload.status;
  await upload.body?.cancel();
  if (!upload.ok) return { ok: false, error: `copy_http_${status}` };
  return { ok: true, bytes: length ? Number(length) : null };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });
  const base = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !key) return new Response("not_configured", { status: 500 });

  let items: Item[];
  try {
    const body = await req.json();
    items = body?.items;
  } catch {
    return new Response("invalid_json", { status: 400 });
  }
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) {
    return new Response("invalid_items", { status: 400 });
  }

  const results = [];
  for (const item of items) {
    try {
      results.push(await copyOne(item, base, key));
    } catch {
      results.push({ ok: false, error: "copy_exception" });
    }
  }
  const copied = results.filter((r) => r.ok).length;
  console.log(JSON.stringify({ event: "copy_private_storage_bridge", requested: items.length, copied }));
  return new Response(JSON.stringify({ results }), {
    headers: { "Content-Type": "application/json" },
  });
});
