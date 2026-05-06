// ============================================================================
// canonical-template-backfill-validation — Sprint 3
// ----------------------------------------------------------------------------
// Перепроверяет document_template_versions без validation_checked_at (или все,
// если force=true). Работает батчами. Поддерживает dry_run.
//
// Body:
//   { dry_run?: boolean (default true), limit?: number (default 20),
//     force?: boolean (default false) }
//
// Add-only: legacy таблицы и flows не трогаются.
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
    if (!authHeader?.startsWith('Bearer ')) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    const { data: authData } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    const userId = authData?.user?.id || null;
    if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    const { data: roles } = await supabase.from('user_roles_v2').select('roles!inner(code)').eq('user_id', userId);
    const codes = (roles || []).map((r: any) => r.roles?.code);
    if (!codes.some((c: string) => ['admin','super_admin','owner'].includes(c))) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: corsHeaders });
    }

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false;
    const limit = Math.min(Math.max(Number(body.limit) || 20, 1), 100);
    const force = body.force === true;

    let q = supabase.from('document_template_versions')
      .select('id, template_id, storage_bucket, storage_path, version_number, validation_checked_at')
      .order('created_at', { ascending: true })
      .limit(limit);
    if (!force) q = q.is('validation_checked_at', null);
    const { data: versions, error: vErr } = await q;
    if (vErr) return new Response(JSON.stringify({ error: vErr.message }), { status: 500, headers: corsHeaders });

    const { data: registry } = await supabase.from('document_token_registry').select('token_key, ui_label, category').is('archived_at', null);
    const regSet = new Map<string, any>();
    for (const r of (registry || [])) regSet.set(r.token_key, r);

    const summary = {
      dry_run: dryRun, force, batch_size: limit,
      total_to_process: (versions || []).length,
      would_update: 0, missing_files: 0, valid: 0, valid_with_warnings: 0, total_unmapped: 0,
      details: [] as any[],
    };

    for (const v of (versions || [])) {
      const item: any = { version_id: v.id, template_id: v.template_id, version_number: v.version_number };
      try {
        const bucket = v.storage_bucket || 'documents-templates';
        const path = v.storage_path;
        if (!path) { item.status = 'unchecked'; item.error = 'no_storage_path'; summary.missing_files++; summary.details.push(item); continue; }
        const { data: file, error: dlErr } = await supabase.storage.from(bucket).download(path);
        if (dlErr || !file) {
          summary.missing_files++;
          item.status = 'unchecked'; item.error = 'template_file_missing';
          if (!dryRun) {
            await supabase.from('document_template_versions').update({
              validation_status: 'unchecked',
              validation_errors: [{ code: 'template_file_missing', detail: dlErr?.message || 'no_file' }],
              validation_checked_at: new Date().toISOString(),
            }).eq('id', v.id);
            await audit(supabase, userId, 'document.template_validation_file_missing', { template_version_id: v.id, error: dlErr?.message || 'no_file' });
          }
          summary.details.push(item); continue;
        }
        const buf = new Uint8Array(await file.arrayBuffer());
        const parsed = extractDocxTokensWithLocations(buf);
        let mapped = 0, unmapped = 0;
        const manifest = parsed.manifest.map((m) => {
          const reg = regSet.get(m.token);
          if (reg) mapped++; else unmapped++;
          return {
            token: m.token, locations: m.locations, total_count: m.total_count,
            status: reg ? 'mapped' : 'unmapped',
            registry: reg ? { token_key: reg.token_key, ui_label: reg.ui_label, category: reg.category } : null,
          };
        });
        const status = unmapped > 0 ? 'valid_with_warnings' : 'valid';
        const errors: any[] = unmapped > 0 ? [{ code: 'unmapped_tokens', count: unmapped, tokens: manifest.filter(t => t.status === 'unmapped').map(t => t.token) }] : [];
        item.status = status; item.detected_count = parsed.tokens.length; item.mapped = mapped; item.unmapped = unmapped;
        summary.would_update++;
        if (status === 'valid') summary.valid++; else summary.valid_with_warnings++;
        summary.total_unmapped += unmapped;
        if (!dryRun) {
          await supabase.from('document_template_versions').update({
            detected_tokens: parsed.tokens,
            token_manifest: manifest,
            validation_status: status,
            validation_errors: errors,
            validation_checked_at: new Date().toISOString(),
            tokens: parsed.tokens,
            unmapped_tokens: manifest.filter(t => t.status === 'unmapped').map(t => t.token),
          }).eq('id', v.id);
        }
      } catch (e: any) {
        item.status = 'error'; item.error = e?.message || 'unknown';
        summary.details.push(item); continue;
      }
      summary.details.push(item);
    }

    await audit(supabase, userId, dryRun ? 'document.template_backfill_dry_run' : 'document.template_backfill_executed', {
      total: summary.total_to_process, would_update: summary.would_update,
      missing_files: summary.missing_files, total_unmapped: summary.total_unmapped,
    });

    return new Response(JSON.stringify({ success: true, summary }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'internal' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
