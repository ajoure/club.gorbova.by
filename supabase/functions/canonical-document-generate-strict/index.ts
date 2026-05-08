// ============================================================================
// canonical-document-generate-strict (Sprint 11 C3)
// ----------------------------------------------------------------------------
// Strict ID-first DOCX generator.
//
// Single contract:
//   - Template: document_templates.current_version_id (must be is_current=true,
//     validation_status='valid').
//   - Placeholders in DOCX: ONLY `{{field:FLD-XXXXXX}}`. Anything else → error.
//   - Values: orders_v2.meta.document_data.fields[FLD-XXXXXX].value.
//   - Required check: token_manifest entries with required=true must have
//     non-empty values; otherwise generation is blocked (required_empty).
//
// Modes:
//   - 'preview'  → resolved_tokens, missing[], required_empty[], source_trace.
//   - 'generate' → renders DOCX, uploads to documents bucket,
//                  inserts ai_generated_documents, returns signed URL,
//                  writes audit_logs.document.generated.
//
// Email/Telegram/auto-generation NOT triggered.
// ============================================================================

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2';
import Docxtemplater from 'npm:docxtemplater@3.47.1';
import PizZip from 'npm:pizzip@3.1.6';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const RESOLVER_VERSION = 'strict-1.1.0-c4b';
const FLD_RE = /^FLD-\d+$/;
const ALLOWED_CASES = new Set([
  'nominative', 'genitive', 'dative', 'accusative', 'instrumental', 'prepositional',
]);
const ALLOWED_FORMATS = new Set(['words', 'text']);
const STRICT_FIELD_RE = /^field:(FLD-\d+)((?:\|[a-z_]+=[a-z_]+)*)$/;
const ANY_TOKEN_RE = /\{\{([^}]+)\}\}/g;

interface ParsedToken {
  raw_inside: string;            // 'field:FLD-1|format=words|case=genitive'
  field_public_id: string;
  format: string | null;         // 'words' | 'text' | null
  case_modifier: string | null;
}

function parseStrictTokenInside(inside: string): ParsedToken | { error: string; raw_inside: string } {
  const m = inside.match(STRICT_FIELD_RE);
  if (!m) return { error: 'legacy_or_invalid', raw_inside: inside };
  const fld = m[1];
  let format: string | null = null;
  let cs: string | null = null;
  const tail = (m[2] || '').split('|').filter(Boolean);
  for (const part of tail) {
    const [k, v] = part.split('=');
    if (k === 'format') {
      if (!ALLOWED_FORMATS.has(v)) return { error: 'unknown_modifier', raw_inside: inside };
      format = v;
    } else if (k === 'case') {
      if (!ALLOWED_CASES.has(v)) return { error: 'unknown_modifier', raw_inside: inside };
      cs = v;
    } else {
      return { error: 'unknown_modifier', raw_inside: inside };
    }
  }
  return { raw_inside: inside, field_public_id: fld, format, case_modifier: cs };
}

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function extractDocumentXmlText(zip: PizZip): string {
  const file = zip.file('word/document.xml');
  if (!file) return '';
  return file.asText();
}

function stripXml(xml: string): string {
  return xml.replace(/<[^>]+>/g, '');
}

function fmtVal(v: any): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try { return JSON.stringify(v); } catch { return ''; }
}

const TEXT_DT = new Set(['string', 'text', 'email', 'phone']);
const NUM_DT = new Set(['number', 'money', 'date', 'datetime']);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const auth = req.headers.get('Authorization');
    if (!auth?.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401);
    const { data: ud } = await supabase.auth.getUser(auth.slice(7));
    if (!ud?.user) return json({ error: 'unauthorized' }, 401);
    const userId = ud.user.id;

    const { data: roleRows } = await supabase
      .from('user_roles_v2')
      .select('roles!inner(code)')
      .eq('user_id', userId);
    const codes = (roleRows || []).map((r: any) => r.roles?.code);
    const isAdmin = codes.includes('admin') || codes.includes('super_admin') || codes.includes('owner');
    if (!isAdmin) return json({ error: 'forbidden' }, 403);

    const { data: prof } = await supabase.from('profiles').select('id').eq('user_id', userId).maybeSingle();
    if (!prof) return json({ error: 'profile_not_found' }, 400);

    const body = await req.json().catch(() => ({}));
    const mode: 'preview' | 'generate' = body?.mode === 'generate' ? 'generate' : 'preview';
    const orderId: string | null = body?.order_id || null;
    const templateId: string | null = body?.template_id || null;
    if (!orderId) return json({ error: 'order_id_required' }, 400);
    if (!templateId) return json({ error: 'template_id_required' }, 400);

    // Load template + active version
    const { data: tpl } = await supabase
      .from('document_templates')
      .select('id, name, current_version_id')
      .eq('id', templateId)
      .maybeSingle();
    if (!tpl) return json({ error: 'template_not_found' }, 404);
    if (!tpl.current_version_id) return json({ error: 'no_active_version' }, 400);

    const { data: ver } = await supabase
      .from('document_template_versions')
      .select('id, version_number, storage_bucket, storage_path, validation_status, token_manifest')
      .eq('id', tpl.current_version_id)
      .maybeSingle();
    if (!ver) return json({ error: 'active_version_missing' }, 500);
    if (ver.validation_status !== 'valid') {
      return json({ error: 'active_version_invalid', validation_status: ver.validation_status }, 400);
    }

    // Load order + snapshot
    const { data: order } = await supabase
      .from('orders_v2')
      .select('id, order_number, profile_id, meta, final_price, currency')
      .eq('id', orderId)
      .maybeSingle();
    if (!order) return json({ error: 'order_not_found' }, 404);

    const docFields = (((order.meta as any)?.document_data?.fields) || {}) as Record<string, any>;

    // Download DOCX from storage
    const dl = await supabase.storage.from(ver.storage_bucket).download(ver.storage_path);
    if (dl.error) return json({ error: `download_failed:${dl.error.message}` }, 500);
    const buf = await dl.data.arrayBuffer();

    // Parse tokens
    const zip = new PizZip(buf);
    const rawXml = extractDocumentXmlText(zip);
    const flat = stripXml(rawXml);
    const foundIds = new Set<string>();
    const legacyTokens: string[] = [];
    for (const m of flat.matchAll(ANY_TOKEN_RE)) {
      const inside = m[1].trim();
      const sm = inside.match(/^field:(FLD-\d+)$/);
      if (sm) foundIds.add(sm[1]);
      else legacyTokens.push(`{{${inside}}}`);
    }

    if (legacyTokens.length > 0) {
      return json({
        error: 'legacy_placeholders_in_active_version',
        legacy_tokens: Array.from(new Set(legacyTokens)),
      }, 400);
    }

    // Required map from token_manifest (если задано)
    const manifest = (Array.isArray(ver.token_manifest) ? ver.token_manifest : []) as any[];
    const requiredIds = new Set<string>(
      manifest
        .filter((m: any) => m?.required === true && typeof m?.field_public_id === 'string')
        .map((m: any) => m.field_public_id),
    );

    // Resolve fields
    const allIds = Array.from(foundIds);
    const resolved: Record<string, string> = {};
    const sourceTrace: Record<string, any> = {};
    const missing: string[] = [];
    const requiredEmpty: string[] = [];

    // Load registry labels (for source_trace richness)
    const { data: regRows } = await supabase
      .from('fields_registry')
      .select('public_id, label, entity_type, data_type')
      .in('public_id', allIds.length > 0 ? allIds : ['__none__']);
    const regMap = new Map((regRows || []).map((r: any) => [r.public_id, r]));

    for (const fid of allIds) {
      const entry = docFields[fid];
      const reg = regMap.get(fid);
      const required = requiredIds.has(fid);
      if (!entry) {
        resolved[`field:${fid}`] = '';
        sourceTrace[fid] = {
          status: 'missing',
          source: 'none',
          field_public_id: fid,
          label: reg?.label ?? null,
          required,
        };
        missing.push(fid);
        if (required) requiredEmpty.push(fid);
        continue;
      }
      const val = fmtVal(entry.value);
      resolved[`field:${fid}`] = val;
      sourceTrace[fid] = {
        status: val === '' ? 'empty' : 'resolved',
        source: entry.source ?? 'manual_override',
        manual_override: !!entry.manual_override,
        updated_at: entry.updated_at ?? null,
        updated_by: entry.updated_by ?? null,
        field_public_id: fid,
        label: reg?.label ?? null,
        required,
      };
      if (required && val === '') requiredEmpty.push(fid);
    }

    if (mode === 'preview') {
      return json({
        success: true,
        mode: 'preview',
        template: { id: tpl.id, name: tpl.name, version_id: ver.id, version_number: ver.version_number },
        resolver_version: RESOLVER_VERSION,
        found_field_ids: allIds,
        resolved_tokens: resolved,
        missing_field_ids: missing,
        required_empty_field_ids: requiredEmpty,
        source_trace: sourceTrace,
        can_generate: requiredEmpty.length === 0,
      });
    }

    // ── generate ─────────────────────────────────────────
    if (requiredEmpty.length > 0) {
      return json({
        error: 'required_fields_empty',
        required_empty_field_ids: requiredEmpty,
      }, 400);
    }

    const docx = new Docxtemplater(zip, {
      delimiters: { start: '{{', end: '}}' },
      paragraphLoop: true,
      linebreaks: true,
    });
    try {
      docx.render(resolved);
    } catch (e: any) {
      return json({ error: `render_failed:${e?.message || 'unknown'}` }, 500);
    }
    const out = docx.getZip().generate({ type: 'uint8array' });

    const ts = Date.now();
    const outPath = `generated/${order.id}/${ts}-${tpl.id.slice(0, 8)}.docx`;
    const upRes = await supabase.storage.from('documents').upload(outPath, out, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      upsert: false,
    });
    if (upRes.error) return json({ error: `upload_failed:${upRes.error.message}` }, 500);

    const idemKey = `strict:${tpl.id}:${ver.id}:${order.id}:${ts}`;
    const { data: insRow, error: insErr } = await supabase
      .from('ai_generated_documents')
      .insert({
        profile_id: order.profile_id,
        template_id: tpl.id,
        template_name: tpl.name,
        template_source_path: ver.storage_path,
        template_version_id: ver.id,
        template_version: ver.version_number,
        title: `${tpl.name} — ${order.order_number || order.id.slice(0, 8)}`,
        status: 'generated',
        file_path: outPath,
        file_name: `${tpl.name}.docx`,
        file_mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        storage_bucket: 'documents',
        snapshot: { fields: docFields },
        missing_tokens: missing,
        token_manifest_snapshot: manifest,
        template_tokens_snapshot: allIds.map((f) => `field:${f}`),
        warnings_snapshot: [],
        source_trace: sourceTrace,
        resolver_version: RESOLVER_VERSION,
        context_type: 'order',
        context_id: order.id,
        idempotency_key: idemKey,
        created_by: userId,
        meta: { strict: true },
      })
      .select('id')
      .single();
    if (insErr) return json({ error: `insert_failed:${insErr.message}` }, 500);

    const sig = await supabase.storage.from('documents').createSignedUrl(outPath, 3600);

    await supabase.from('audit_logs').insert({
      actor_user_id: userId,
      actor_type: 'user',
      action: 'document.generated',
      meta: {
        document_id: insRow.id,
        order_id: order.id,
        template_id: tpl.id,
        template_version_id: ver.id,
        version_number: ver.version_number,
        field_ids: allIds,
        resolver_version: RESOLVER_VERSION,
      },
    });

    return json({
      success: true,
      mode: 'generate',
      document_id: insRow.id,
      storage_path: outPath,
      download_url: sig.data?.signedUrl || null,
      template: { id: tpl.id, version_id: ver.id, version_number: ver.version_number },
      resolver_version: RESOLVER_VERSION,
    });
  } catch (e: any) {
    console.error('canonical-document-generate-strict error:', e);
    return json({ error: e?.message || 'internal_error' }, 500);
  }
});
