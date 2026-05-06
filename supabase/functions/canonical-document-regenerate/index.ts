// ============================================================================
// canonical-document-regenerate — Sprint 4
// Ручная перегенерация документа админом. Старая запись остаётся, новая
// создаётся с regenerated_from_document_id и собственным idempotency_key.
//
// Body: { document_id: uuid, mode: 'preview'|'execute', confirm?: boolean }
// ============================================================================

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  resolveCanonicalPayload,
  generateCanonicalDocument,
} from '../_shared/document-render.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function snapshotDiff(oldS: any, newS: any): any {
  const diff: any = {};
  const sections = ['executor', 'customer', 'order', 'document'];
  for (const s of sections) {
    const a = oldS?.[s] || {};
    const b = newS?.[s] || {};
    const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    for (const k of keys) {
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
        diff[`${s}.${k}`] = { from: a[k], to: b[k] };
      }
    }
  }
  return diff;
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
    const docId: string | null = body.document_id || null;
    const mode: 'preview' | 'execute' = body.mode === 'execute' ? 'execute' : 'preview';
    if (!docId) return new Response(JSON.stringify({ error: 'document_id required' }), { status: 400, headers: corsHeaders });

    const { data: orig } = await supabase.from('ai_generated_documents')
      .select('*').eq('id', docId).maybeSingle();
    if (!orig) return new Response(JSON.stringify({ error: 'document_not_found' }), { status: 404, headers: corsHeaders });

    // Resolve current payload
    const input = {
      template_id: orig.template_id,
      template_version_id: orig.template_version_id,
      context_type: orig.context_type as any,
      context_id: orig.context_id,
      legal_details_id: orig.legal_details_id,
      signer_link_id: orig.signer_link_id,
    };
    const newPayload = await resolveCanonicalPayload(supabase, input);
    const diff = snapshotDiff(orig.snapshot, newPayload.snapshot);

    if (mode === 'preview') {
      return new Response(JSON.stringify({
        success: true,
        original: { id: orig.id, file_name: orig.file_name, snapshot: orig.snapshot, created_at: orig.created_at },
        new_payload: {
          resolved_tokens: newPayload.resolved_tokens,
          missing_tokens: newPayload.missing_tokens,
          unmapped_template_tokens: newPayload.unmapped_template_tokens,
          warnings: newPayload.warnings,
          template: newPayload.template,
          snapshot: newPayload.snapshot,
        },
        diff,
        diff_keys: Object.keys(diff),
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (body.confirm !== true) {
      return new Response(JSON.stringify({ error: 'confirm_required' }), { status: 400, headers: corsHeaders });
    }

    // Execute: bypass idempotency by switching context to 'manual'
    // (document-render.ts only generates idempotency_key when context_type==='order')
    const manualInput = { ...input, context_type: 'manual' as const };
    const manualKey = `manual_regen:${orig.id}:${Date.now()}`;
    const result = await generateCanonicalDocument(supabase, manualInput, {
      profileId: orig.profile_id,
      userId,
      enforceFeatureFlag: true,
      storageBucketOutput: orig.storage_bucket || 'documents',
    });

    if (!result.success) {
      await supabase.from('audit_logs').insert({
        actor_user_id: userId, actor_type: 'user',
        action: 'document.regenerate_failed',
        meta: { source_document_id: orig.id, error: result.error, missing_tokens: result.payload?.missing_tokens },
      });
      return new Response(JSON.stringify({ error: result.error || 'render_failed' }), { status: 400, headers: corsHeaders });
    }

    // Если generateCanonicalDocument вернул reused — это не подойдёт для regenerate.
    // Перезапишем idempotency_key и пометим связь со старым документом.
    if (result.document_id) {
      await supabase.from('ai_generated_documents').update({
        regenerated_from_document_id: orig.id,
        idempotency_key: manualKey,
        meta: { ...(orig.meta || {}), regenerated_from: orig.id, regenerated_by: userId, regenerated_at: new Date().toISOString() },
      }).eq('id', result.document_id);
    }

    await supabase.from('audit_logs').insert({
      actor_user_id: userId, actor_type: 'user',
      action: 'document.regenerated',
      meta: {
        source_document_id: orig.id,
        new_document_id: result.document_id,
        diff_keys: Object.keys(diff),
        template_version_id: input.template_version_id,
      },
    });

    return new Response(JSON.stringify({
      success: true,
      regenerated_from: orig.id,
      document_id: result.document_id,
      download_url: result.download_url,
      diff,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'internal' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
