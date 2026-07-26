import { createClient } from "npm:@supabase/supabase-js@2.108.2";

type SharePreview = {
  external_id: string;
  slug: string;
  title: string;
  doc_date: string | null;
  doc_number: string | null;
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const markers = ["/functions/v1/l/", "/l/"];
  const marker = markers.find((candidate) => url.pathname.includes(candidate));
  const tail = marker
    ? url.pathname.slice(url.pathname.indexOf(marker) + marker.length)
    : "";
  const [rawRef, rawAnchor] = tail.split("/");
  const ref = rawRef ? decodeURIComponent(rawRef) : "";
  const anchor = rawAnchor ? decodeURIComponent(rawAnchor) : null;
  if (!ref) return new Response("Missing document reference", { status: 400 });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabase = createClient(
    supabaseUrl,
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { auth: { persistSession: false } },
  );
  const { data, error } = await supabase.rpc(
    "get_legal_document_share_preview",
    { p_ref: ref },
  );
  const preview = (data?.[0] ?? null) as SharePreview | null;
  if (error || !preview) return new Response("Document not found", { status: 404 });

  const anchorMatch = anchor?.match(/^art-([^-]+(?:-[^-]+)*?)(?:-par-(\d+))?$/);
  const anchorLabel = anchorMatch
    ? `Статья ${anchorMatch[1].replaceAll("-", ".")}${
        anchorMatch[2] ? `, абзац ${anchorMatch[2]}` : ""
      }`
    : null;
  const title = `${anchorLabel ? `${anchorLabel} — ` : ""}${preview.title}`;
  const description = [
    "Актуальная редакция нормативного правового акта Республики Беларусь.",
    preview.doc_date,
    preview.doc_number ? `№ ${preview.doc_number}` : null,
  ].filter(Boolean).join(" ");
  const canonical = `https://gorbova.by/knowledge/laws/${encodeURIComponent(preview.slug)}${
    anchor ? `#${encodeURIComponent(anchor)}` : ""
  }`;
  const shareUrl = `${supabaseUrl}/functions/v1/l/${encodeURIComponent(preview.external_id)}${
    anchor ? `/${encodeURIComponent(anchor)}` : ""
  }`;
  const imageUrl = `${supabaseUrl}/functions/v1/legal-og-image?${new URLSearchParams({
    ref: preview.external_id,
    ...(anchor ? { anchor } : {}),
  }).toString()}`;

  const html = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)} | Буква закона</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="Буква закона">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(shareUrl)}">
  <meta property="og:image" content="${escapeHtml(imageUrl)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(imageUrl)}">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <meta http-equiv="refresh" content="0;url=${escapeHtml(canonical)}">
</head>
<body>
  <p><a href="${escapeHtml(canonical)}">Открыть документ на gorbova.by</a></p>
  <script>window.location.replace(${JSON.stringify(canonical)});</script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
