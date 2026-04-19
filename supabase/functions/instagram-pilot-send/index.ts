// One-shot pilot: signed URL из telegram-media → ManyChat sendContent (image)
// Используется только для proof Step C/D. Защищено JWT + admin/super_admin role.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
  const SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;

  // ── auth: only admin/super_admin
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) return j({ error: 'Unauthorized' }, 401);
  const anonClient = createClient(SUPA_URL, ANON, { global: { headers: { Authorization: auth } } });
  const { data: claims } = await anonClient.auth.getClaims(auth.slice(7));
  if (!claims?.claims?.sub) return j({ error: 'Unauthorized' }, 401);
  const userId = claims.claims.sub as string;

  const sr = createClient(SUPA_URL, SR);
  const { data: isAdmin } = await sr.rpc('has_role_v2', { _user_id: userId, _role_code: 'admin' });
  const { data: isSA } = await sr.rpc('has_role_v2', { _user_id: userId, _role_code: 'super_admin' });
  if (!isAdmin && !isSA) return j({ error: 'Forbidden' }, 403);

  const body = await req.json().catch(() => ({}));
  const {
    integration_instance_id,
    subscriber_id,
    bucket = 'telegram-media',
    object_path = 'instagram-pilot/test.png',
    media_type = 'image',
    ttl_seconds = 86400,
    override_url, // если задан — используем как есть, без signed URL
  } = body;

  if (!integration_instance_id || !subscriber_id) {
    return j({ error: 'integration_instance_id, subscriber_id required' }, 400);
  }

  let signedUrl: string;
  if (override_url) {
    signedUrl = override_url;
  } else {
    const { data: signed, error: signErr } = await sr.storage
      .from(bucket)
      .createSignedUrl(object_path, ttl_seconds);
    if (signErr || !signed?.signedUrl) {
      return j({ ok: false, step: 'signed_url', error: signErr?.message || 'no signed url' }, 200);
    }
    signedUrl = signed.signedUrl;
  }

  // 2) load api_key
  const { data: instance } = await sr
    .from('integration_instances')
    .select('config_secrets')
    .eq('id', integration_instance_id)
    .maybeSingle();
  const apiKey = (instance?.config_secrets as any)?.api_key;
  if (!apiKey) return j({ ok: false, step: 'api_key', error: 'api_key missing' }, 200);

  // 3) call ManyChat sendContent (image)
  const subIdNum = /^\d+$/.test(String(subscriber_id)) ? Number(subscriber_id) : subscriber_id;
  const block: Record<string, unknown> =
    media_type === 'image' ? { type: 'image', url: signedUrl }
    : media_type === 'audio' ? { type: 'audio', url: signedUrl }
    : media_type === 'video' ? { type: 'video', url: signedUrl }
    : { type: 'file', url: signedUrl };

  const buildPayload = (tag?: string) => {
    const p: Record<string, unknown> = {
      subscriber_id: subIdNum,
      data: { version: 'v2', content: { type: 'instagram', messages: [block] } },
    };
    if (tag) p.message_tag = tag;
    return p;
  };

  const callMc = async (tag?: string) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    try {
      const r = await fetch('https://api.manychat.com/fb/sending/sendContent', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload(tag)),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      const txt = await r.text();
      let parsed: any = null; try { parsed = JSON.parse(txt); } catch {}
      return { httpOk: r.ok, status: r.status, parsed, raw: txt.slice(0, 1500) };
    } catch (e: any) {
      clearTimeout(t);
      return { httpOk: false, status: 0, parsed: null, raw: e?.message || String(e) };
    }
  };

  const a1 = await callMc();
  const ok1 = a1.httpOk && (!a1.parsed?.status || a1.parsed.status === 'success');
  if (ok1) {
    return j({ ok: true, attempt: 1, signed_url: signedUrl, http_status: a1.status, response: a1.parsed }, 200);
  }
  const a2 = await callMc('HUMAN_AGENT');
  const ok2 = a2.httpOk && (!a2.parsed?.status || a2.parsed.status === 'success');
  return j({
    ok: ok2,
    pilot_summary: {
      media_type,
      signed_url_ok: true,
      attempt_1: { http_status: a1.status, body: a1.raw },
      attempt_2_human_agent: { http_status: a2.status, body: a2.raw },
    },
  }, 200);
});

function j(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
