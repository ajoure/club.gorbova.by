// PATCH: Instagram inbound media playback fix + SSRF hardening (A″).
// Server-side proxy/rehost для нестабильных Instagram CDN URL (lookaside, fbcdn, cdninstagram).
// Скачивает media → кладёт в storage telegram-media → возвращает stable signed URL (TTL 7d).
//
// Контракт:
//   POST { message_id: uuid, source_url: string, media_type?: string }
//   → { ok: true, stable_url: string, content_type, bytes, rehosted: true }
//
// SSRF-guard:
//   - только https, стандартный порт
//   - hostname строго в allowlist Instagram/Meta CDN
//   - DNS-resolve с блокировкой loopback/private/link-local/metadata IP
//   - каждый redirect проверяется отдельно, max 3 hop
//   - timeout 15s, max response 50MB
//   - только image/*, video/*, audio/*, application/pdf

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const BUCKET = 'telegram-media';
const SIGN_TTL = 60 * 60 * 24 * 7; // 7 days
const MAX_BYTES = 50 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

// Строгий allowlist доверенных Instagram/Meta CDN хостов.
// Совпадение выполняется по hostname (после new URL()), не по подстроке.
const ALLOWED_HOST_SUFFIXES = [
  'cdninstagram.com',
  'fbcdn.net',
  'fbsbx.com', // lookaside.fbsbx.com
];

const ALLOWED_CT_PREFIXES = ['image/', 'video/', 'audio/'];
const ALLOWED_CT_EXACT = ['application/pdf', 'application/octet-stream'];

function hostAllowed(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return ALLOWED_HOST_SUFFIXES.some(
    (suf) => h === suf || h.endsWith('.' + suf),
  );
}

function ipIsBlocked(ip: string): boolean {
  // IPv6
  if (ip.includes(':')) {
    const lo = ip.toLowerCase();
    if (lo === '::1' || lo === '::') return true;
    if (lo.startsWith('fc') || lo.startsWith('fd')) return true; // ULA
    if (lo.startsWith('fe80')) return true; // link-local
    if (lo.startsWith('::ffff:')) {
      // IPv4-mapped
      return ipIsBlocked(lo.slice('::ffff:'.length));
    }
    return false;
  }
  const parts = ip.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true; // не парсится — блокируем
  }
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true; // loopback
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local + metadata 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

async function assertUrlSafe(rawUrl: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error('bad_url');
  }
  if (u.protocol !== 'https:') throw new Error('bad_protocol');
  if (u.port && u.port !== '' && u.port !== '443') throw new Error('bad_port');
  if (u.username || u.password) throw new Error('bad_userinfo');
  if (!hostAllowed(u.hostname)) throw new Error('host_not_allowed');

  // DNS resolve + block private / loopback / metadata
  const ips: string[] = [];
  for (const kind of ['A', 'AAAA'] as const) {
    try {
      const r = await Deno.resolveDns(u.hostname, kind);
      ips.push(...r);
    } catch { /* ignore per-family failure */ }
  }
  if (ips.length === 0) throw new Error('dns_failed');
  for (const ip of ips) {
    if (ipIsBlocked(ip)) throw new Error('blocked_ip');
  }
  return u;
}

async function safeFetch(startUrl: string): Promise<Response> {
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertUrlSafe(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (LovableMediaProxy/1.0)' },
      });
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error('redirect_without_location');
      try { await res.body?.cancel(); } catch { /* noop */ }
      current = new URL(loc, current).toString();
      continue;
    }
    return res;
  }
  throw new Error('too_many_redirects');
}

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

function ctAllowed(ct: string): boolean {
  const c = (ct || '').toLowerCase().split(';')[0].trim();
  if (ALLOWED_CT_EXACT.includes(c)) return true;
  return ALLOWED_CT_PREFIXES.some((p) => c.startsWith(p));
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

    if (!source_url || typeof source_url !== 'string') {
      return new Response(
        JSON.stringify({ ok: false, error: 'missing_source_url' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Если уже наш storage URL → отдаём как есть (idempotent)
    if (source_url.includes('/storage/v1/object/sign/telegram-media/')) {
      return new Response(
        JSON.stringify({ ok: true, stable_url: source_url, rehosted: false, reason: 'already_stable' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Валидируем URL до любых DB/сетевых операций (fail-closed SSRF guard).
    let parsedUrl: URL;
    try {
      parsedUrl = await assertUrlSafe(source_url);
    } catch (e) {
      return new Response(
        JSON.stringify({ ok: false, error: 'url_rejected', reason: String((e as any)?.message ?? e) }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Если message_id передан и в БД уже стабильный URL — возвращаем его
    if (message_id) {
      const { data: existing } = await supabase
        .from('instagram_messages')
        .select('media_url, raw_payload')
        .eq('id', message_id)
        .single();

      const rehostedUrl = existing?.raw_payload?.rehosted_media_url as string | undefined;
      if (rehostedUrl) {
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

    let fetchRes: Response;
    try {
      fetchRes = await safeFetch(parsedUrl.toString());
    } catch (e) {
      return new Response(
        JSON.stringify({ ok: false, error: 'fetch_rejected', reason: String((e as any)?.message ?? e) }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    if (!fetchRes.ok) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'fetch_failed',
          status: fetchRes.status,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

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

    if (!ctAllowed(contentType)) {
      try { await fetchRes.body?.cancel(); } catch { /* noop */ }
      return new Response(
        JSON.stringify({ ok: false, error: 'content_type_not_allowed', content_type: contentType }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Content-Length pre-check
    const cl = parseInt(fetchRes.headers.get('content-length') || '', 10);
    if (Number.isFinite(cl) && cl > MAX_BYTES) {
      try { await fetchRes.body?.cancel(); } catch { /* noop */ }
      return new Response(
        JSON.stringify({ ok: false, error: 'too_large', bytes: cl }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const arrayBuf = await fetchRes.arrayBuffer();
    const bytes = arrayBuf.byteLength;

    if (bytes > MAX_BYTES) {
      return new Response(
        JSON.stringify({ ok: false, error: 'too_large', bytes }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
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
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const { data: signed, error: signErr } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGN_TTL);
    if (signErr || !signed?.signedUrl) {
      return new Response(
        JSON.stringify({ ok: false, error: 'sign_failed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const stableUrl = signed.signedUrl;
    const finalMediaType = inferMediaType(contentType);

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
