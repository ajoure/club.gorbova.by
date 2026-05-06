// ============================================================================
// canonical-document-generate — Sprint 1 entrypoint
// Modes:
//   - preview: returns resolved payload без сохранения
//   - generate: рендерит DOCX, сохраняет ai_generated_documents, возвращает signed URL
//
// Feature-flag gated by app_settings.documents_canonical_generation_enabled.
// ============================================================================

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2';
import { resolveCanonicalPayload, generateCanonicalDocument, isCanonicalEnabled } from '../_shared/document-render.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const { data: authData, error: authErr } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authErr || !authData?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const userId = authData.user.id;

    // RBAC: admin / super_admin only on Sprint 1
    const { data: roleRows } = await supabase.from('user_roles_v2').select('roles!inner(code)').eq('user_id', userId);
    const codes = (roleRows || []).map((r: any) => r.roles?.code);
    const isAdmin = codes.includes('admin') || codes.includes('super_admin') || codes.includes('owner');
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: prof } = await supabase.from('profiles').select('id').eq('user_id', userId).maybeSingle();
    if (!prof) {
      return new Response(JSON.stringify({ error: 'Profile not found' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = await req.json();
    const mode = (body.mode || 'preview') as 'preview' | 'generate';
    const input = {
      template_id: body.template_id,
      template_version_id: body.template_version_id || null,
      context_type: body.context_type || null,
      context_id: body.context_id || null,
      executor_id: body.executor_id || null,
      legal_details_id: body.legal_details_id || null,
      signer_link_id: body.signer_link_id || null,
      overrides: body.overrides || undefined,
    };

    if (!input.template_id) {
      return new Response(JSON.stringify({ error: 'template_id required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (mode === 'preview') {
      const enabled = await isCanonicalEnabled(supabase);
      const payload = await resolveCanonicalPayload(supabase, input);
      return new Response(JSON.stringify({ success: true, feature_enabled: enabled, ...payload }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // generate
    const result = await generateCanonicalDocument(supabase, input, {
      profileId: prof.id,
      userId,
      enforceFeatureFlag: true,
    });
    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('canonical-document-generate error:', e);
    return new Response(JSON.stringify({ error: e?.message || 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
