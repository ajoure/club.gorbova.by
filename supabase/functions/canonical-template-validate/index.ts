// ============================================================================
// canonical-template-validate — Sprint 2
// ----------------------------------------------------------------------------
// Назначение: распарсить DOCX версии шаблона, сопоставить токены с registry,
// сохранить detected_tokens/token_manifest/validation_status/validation_errors.
//
// Body:
//   { template_version_id: uuid }      — конкретная версия
//   ИЛИ { template_id: uuid }          — текущая версия шаблона (current_version_id),
//                                         либо последняя по version_number, либо
//                                         fallback на template_path шаблона
//
// Side effects:
//   • Обновляет document_template_versions row (если она есть).
//   • Пишет audit_logs (event: document.template_tokens_parsed,
//     document.template_version_validation_failed).
//   • НЕ создаёт новые registry tokens.
// ============================================================================

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2';
import { extractDocxTokensWithLocations } from '../_shared/docx-helpers.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function audit(supabase: any, userId: string | null, event: string, payload: any) {
  return supabase.from('audit_logs').insert({
    actor_user_id: userId,
    actor_type: userId ? 'user' : 'system',
    action: event,
    meta: payload,
  }).then(() => undefined).catch(() => undefined);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const { data: authData } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    const userId = authData?.user?.id || null;
    if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { data: roleRows } = await supabase.from('user_roles_v2').select('roles!inner(code)').eq('user_id', userId);
    const codes = (roleRows || []).map((r: any) => r.roles?.code);
    if (!codes.some((c: string) => ['admin', 'super_admin', 'owner'].includes(c))) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = await req.json().catch(() => ({}));
    const versionId: string | null = body.template_version_id || null;
    const templateId: string | null = body.template_id || null;
    if (!versionId && !templateId) {
      return new Response(JSON.stringify({ error: 'template_version_id or template_id required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Resolve version row (or fallback to template.template_path)
    let version: any = null;
    if (versionId) {
      const { data } = await supabase.from('document_template_versions').select('*').eq('id', versionId).maybeSingle();
      version = data;
    } else if (templateId) {
      const { data: tpl } = await supabase.from('document_templates').select('current_version_id').eq('id', templateId).maybeSingle();
      if (tpl?.current_version_id) {
        const { data } = await supabase.from('document_template_versions').select('*').eq('id', tpl.current_version_id).maybeSingle();
        version = data;
      }
      if (!version) {
        const { data } = await supabase.from('document_template_versions')
          .select('*').eq('template_id', templateId)
          .order('version_number', { ascending: false }).limit(1).maybeSingle();
        version = data;
      }
    }

    let storageBucket = version?.storage_bucket || 'documents-templates';
    let storagePath: string | null = version?.storage_path || null;
    if (!storagePath && templateId) {
      const { data: tpl } = await supabase.from('document_templates')
        .select('template_path').eq('id', templateId).maybeSingle();
      storagePath = tpl?.template_path || null;
      if (storagePath && storagePath.startsWith('documents/')) {
        storageBucket = 'documents';
        storagePath = storagePath.replace(/^documents\//, '');
      }
    }
    if (!storagePath) {
      return new Response(JSON.stringify({ error: 'no_storage_path' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: file, error: dlErr } = await supabase.storage.from(storageBucket).download(storagePath);
    if (dlErr || !file) {
      return new Response(JSON.stringify({ error: `download_failed:${dlErr?.message || 'no_file'}` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const buf = new Uint8Array(await file.arrayBuffer());
    const parsed = extractDocxTokensWithLocations(buf);

    // Map against registry
    const { data: registry } = await supabase.from('document_token_registry').select('token_key, is_required, ui_label, category').is('archived_at', null);
    const regSet = new Map<string, any>();
    for (const r of (registry || [])) regSet.set(r.token_key, r);

    // Aliases: alias_token -> canonical_token_key, scoped to (global | this template | this version)
    const aliasMap = new Map<string, { canonical_token_key: string; scope: 'global' | 'template' | 'version' }>();
    try {
      const tplId = version?.template_id || templateId;
      const verId = version?.id || null;
      let q = supabase.from('document_token_aliases').select('alias_token, canonical_token_key, template_id, template_version_id');
      if (tplId) q = q.or(`template_id.is.null,template_id.eq.${tplId}`);
      else q = q.is('template_id', null);
      const { data: aliasRows } = await q;
      const score = (a: any) => (a.template_version_id ? 4 : 0) + (a.template_id ? 2 : 0);
      const byAlias = new Map<string, any>();
      for (const a of (aliasRows || [])) {
        if (a.template_version_id && a.template_version_id !== verId) continue;
        const ex = byAlias.get(a.alias_token);
        if (!ex || score(a) > score(ex)) byAlias.set(a.alias_token, a);
      }
      for (const [k, v] of byAlias) {
        if (regSet.has(v.canonical_token_key)) {
          aliasMap.set(k, {
            canonical_token_key: v.canonical_token_key,
            scope: v.template_version_id ? 'version' : v.template_id ? 'template' : 'global',
          });
        }
      }
    } catch (_e) { /* aliases optional */ }

    let mapped = 0, unmapped = 0, viaAlias = 0;
    const tokenManifest = parsed.manifest.map((m) => {
      const direct = regSet.get(m.token);
      const alias = !direct ? aliasMap.get(m.token) : null;
      const reg = direct || (alias ? regSet.get(alias.canonical_token_key) : null);
      const status = reg ? 'mapped' : 'unmapped';
      if (reg) {
        mapped += 1;
        if (alias) viaAlias += 1;
      } else unmapped += 1;
      return {
        token: m.token,
        locations: m.locations,
        total_count: m.total_count,
        status,
        via_alias: alias ? { canonical_token_key: alias.canonical_token_key, scope: alias.scope } : null,
        registry: reg ? { token_key: reg.token_key, ui_label: reg.ui_label, category: reg.category, is_required: !!reg.is_required } : null,
      };
    });

    let validationStatus: 'valid' | 'valid_with_warnings' | 'invalid_unknown_required' = 'valid';
    if (unmapped > 0) validationStatus = 'valid_with_warnings';

    const validationErrors: any[] = [];
    if (unmapped > 0) {
      validationErrors.push({
        code: 'unmapped_tokens',
        count: unmapped,
        tokens: tokenManifest.filter(t => t.status === 'unmapped').map(t => t.token),
        hint: 'Эти токены отсутствуют в реестре. Сопоставьте их или замените в DOCX.',
      });
    }

    let updated = false;
    if (version?.id) {
      const { error: upErr } = await supabase.from('document_template_versions').update({
        detected_tokens: parsed.tokens,
        token_manifest: tokenManifest,
        validation_status: validationStatus,
        validation_errors: validationErrors,
        validation_checked_at: new Date().toISOString(),
        tokens: parsed.tokens,
        unmapped_tokens: tokenManifest.filter(t => t.status === 'unmapped').map(t => t.token),
      }).eq('id', version.id);
      if (upErr) {
        await audit(supabase, userId, 'document.template_version_validation_failed', { template_version_id: version.id, error: upErr.message });
        return new Response(JSON.stringify({ error: `update_failed:${upErr.message}` }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      updated = true;
    }

    await audit(supabase, userId, 'document.template_tokens_parsed', {
      template_version_id: version?.id || null,
      template_id: version?.template_id || templateId,
      detected_count: parsed.tokens.length,
      mapped_count: mapped,
      unmapped_count: unmapped,
      validation_status: validationStatus,
      parts_scanned: parsed.parts_scanned,
    });

    return new Response(JSON.stringify({
      success: true,
      template_version_id: version?.id || null,
      template_id: version?.template_id || templateId,
      updated_in_db: updated,
      detected_count: parsed.tokens.length,
      mapped_count: mapped,
      unmapped_count: unmapped,
      missing_required_count: 0,
      validation_status: validationStatus,
      validation_errors: validationErrors,
      parts_scanned: parsed.parts_scanned,
      detected_tokens: parsed.tokens,
      token_manifest: tokenManifest,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('canonical-template-validate error:', e);
    return new Response(JSON.stringify({ error: e?.message || 'internal' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
