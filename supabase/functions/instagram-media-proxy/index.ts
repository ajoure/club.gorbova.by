// PATCH: Instagram inbound media playback fix
// Server-side proxy/rehost для нестабильных Instagram CDN URL (lookaside, fbcdn, cdninstagram).
// Скачивает media → кладёт в storage telegram-media → возвращает stable signed URL (TTL 7d).
//
// Контракт:
//   POST { message_id: uuid, source_url: string, media_type?: string }
//   → { ok: true, stable_url: string, content_type, bytes, rehosted: true }
//
//   Если URL уже стабильный (наш storage / явно стабильный CDN), возвращаем как есть.
//
// Используется:
//  1. instagram-webhook (fire-and-forget после insert) — auto-rehost при поступлении
//  2. Frontend (lazy-rehost) — если bubble не смог проиграть встроенно

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const BUCKET = 'telegram-media';
const SIGN_TTL = 60 * 60 * 24 * 7; // 7 days

const UNSTABLE_HOST_RE = /(lookaside\.fbsbx\.com|fbcdn\.net|cdninstagram\.com)/i;

function pickExt(contentType: string, srcUrl: string): string {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
  if (ct.includes('png')) return 'png';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('gif')) return 'gif';
  if (ct.includes('mp4')) return 'mp4';
  if (ct.includes('webm')) return 'webm';
  if (ct.includes('quicktime') || ct.includes('mov')) return 'mov';
  if (ct.includes('mpeg') && ct.includes('audio')) return 'mp3';
  if (ct.includes('mp3')) return 'mp3';
  if (ct.includes('m4a') || ct.includes('mp4a')) return 'm4a';
  if (ct.includes('ogg')) return 'ogg';
  if (ct.includes('wav')) return 'wav';
  if (ct.includes('pdf')) return 'pdf';
  // Try from URL path
  try {
    const pathname = new URL(srcUrl).pathname.toLowerCase();
    const m = pathname.match(/\.([a-z0-9]{2,5})(?:$|[?#])/);
    if (m) return m[1];
  } catch { /* noop */ }
  return 'bin';
}

function inferMediaType(contentType: string): string {
  const ct = (contentType || '').toLowerCase();
  if (ct.startsWith('image/')) return 'image';
  if (ct.startsWith('video/')) return 'video';
  if (ct.startsWith('audio/')) return 'audio';
  if (ct.includes('pdf')) return 'file';
  return 'file';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const body = await req.json().catch(() => ({}));
    const message_id: string | undefined = body.message_id;
    const source_url: string | undefined = body.source_url;
    const requested_media_type: string | undefined = body.media_type;

    if (!source_url || typeof source_url !== 'string') {
      return new Response(
        JSON.stringify({ ok: false, error: 'missing_source_url' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Если уже наш storage URL → отдаём как есть (idempotent)
    if (source_url.includes('/storage/v1/object/sign/telegram-media/')) {
      return new Response(
        JSON.stringify({ ok: true, stable_url: source_url, rehosted: false, reason: 'already_stable' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Если message_id передан и в БД уже стабильный URL — возвращаем его
    if (message_id) {
      const { data: existing } = await supabase
        .from('instagram_messages')
        .select('media_url, raw_payload')
        .eq('id', message_id)
        .single();

      const rehostedUrl = existing?.raw_payload?.rehosted_media_url as string | undefined;
      if (rehostedUrl) {
        // Перевыпускаем signed URL если нужно (тот же объект)
        const pathMatch = rehostedUrl.match(/telegram-media\/([^?]+)/);
        if (pathMatch) {
          const { data: signed } = await supabase.storage
            .from(BUCKET)
            .createSignedUrl(pathMatch[1], SIGN_TTL);
          if (signed?.signedUrl) {
            return new Response(
              JSON.stringify({ ok: true, stable_url: signed.signedUrl, rehosted: false, reason: 'cached' }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
          }
        }
      }
    }

    // ── Нестабильный CDN → fetch + rehost
    const isUnstable = UNSTABLE_HOST_RE.test(source_url);
    if (!isUnstable) {
      // Стабильный URL (наш storage уже отсеяли) — отдаём как есть, не rehost
      return new Response(
        JSON.stringify({ ok: true, stable_url: source_url, rehosted: false, reason: 'stable_external' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const fetchRes = await fetch(source_url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (LovableMediaProxy/1.0)' },
    });
    if (!fetchRes.ok) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'fetch_failed',
          status: fetchRes.status,
          stable_url: source_url, // graceful fallback to original
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // PATCH: priority for content-type detection:
    //   1) HTTP Content-Type header (если адекватный, не octet-stream)
    //   2) extension URL (.mp4/.mov/.webm/.mp3/.m4a/.ogg/.wav/.jpg/.png/...)
    //   3) fallback application/octet-stream
    const headerCT = (fetchRes.headers.get('content-type') || '').toLowerCase();
    const headerCTUseful =
      headerCT && !headerCT.includes('octet-stream') && !headerCT.includes('binary');

    function ctFromUrlExt(u: string): string | null {
      try {
        const p = new URL(u).pathname.toLowerCase();
        const m = p.match(/\.([a-z0-9]{2,5})(?:$|[?#])/);
        if (!m) return null;
        switch (m[1]) {
          case 'mp4':  return 'video/mp4';
          case 'mov':  return 'video/quicktime';
          case 'webm': return 'video/webm';
          case 'm4v':  return 'video/x-m4v';
          case 'mp3':  return 'audio/mpeg';
          case 'm4a':  return 'audio/mp4';
          case 'ogg':  return 'audio/ogg';
          case 'opus': return 'audio/ogg';
          case 'wav':  return 'audio/wav';
          case 'aac':  return 'audio/aac';
          case 'jpg':
          case 'jpeg': return 'image/jpeg';
          case 'png':  return 'image/png';
          case 'gif':  return 'image/gif';
          case 'webp': return 'image/webp';
          case 'pdf':  return 'application/pdf';
          default:     return null;
        }
      } catch { return null; }
    }
    const urlCT = ctFromUrlExt(source_url);
    const contentType = headerCTUseful ? headerCT : (urlCT || headerCT || 'application/octet-stream');

    const arrayBuf = await fetchRes.arrayBuffer();
    const bytes = arrayBuf.byteLength;

    // safety: не закидываем огромные файлы (>50MB)
    if (bytes > 50 * 1024 * 1024) {
      return new Response(
        JSON.stringify({ ok: false, error: 'too_large', bytes, stable_url: source_url }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const ext = pickExt(contentType, source_url);
    const path = `instagram-inbound/${message_id || 'orphan'}/${Date.now()}_${crypto
      .randomUUID()
      .slice(0, 8)}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, new Uint8Array(arrayBuf), {
        contentType,
        upsert: false,
      });
    if (upErr) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'upload_failed',
          detail: upErr.message,
          stable_url: source_url,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const { data: signed, error: signErr } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGN_TTL);
    if (signErr || !signed?.signedUrl) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'sign_failed',
          stable_url: source_url,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const stableUrl = signed.signedUrl;
    // PATCH: media_type ALWAYS derived from real contentType (которому мы доверяем),
    // НЕ от requested_media_type — ManyChat шлёт "image" для всего подряд.
    const finalMediaType = inferMediaType(contentType);

    // ── Patch back into instagram_messages: media_url + raw_payload.rehosted_media_url
    if (message_id) {
      const { data: existing } = await supabase
        .from('instagram_messages')
        .select('raw_payload')
        .eq('id', message_id)
        .single();

      const newPayload = {
        ...(existing?.raw_payload as Record<string, unknown> || {}),
        rehosted_media_url: stableUrl,
        rehosted_storage_path: path,
        rehosted_at: new Date().toISOString(),
        rehosted_content_type: contentType,
      };

      await supabase
        .from('instagram_messages')
        .update({
          media_url: stableUrl,
          media_type: finalMediaType,
          raw_payload: newPayload,
        })
        .eq('id', message_id);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        stable_url: stableUrl,
        rehosted: true,
        content_type: contentType,
        media_type: finalMediaType,
        bytes,
        path,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: 'unexpected', detail: String((e as any)?.message ?? e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
