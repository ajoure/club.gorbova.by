// ============================================================================
// canonical-template-activate-version (Sprint 11 C3)
// ----------------------------------------------------------------------------
// Server-side promotion of a document_template_versions row to is_current.
//
// Rules:
//  - admin / super_admin / owner only (JWT-validated, no service_role bypass).
//  - validation_status MUST be 'valid'; otherwise reject (cannot_activate_invalid).
//  - markup_status (if present) MUST be 'marked' or absent.
//  - Demote sibling versions, set current_version_id on document_templates,
//    write audit_logs entry with actor JWT identity (not body).
// ============================================================================

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const auth = req.headers.get('Authorization');
    if (!auth?.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401);
    const { data: ud, error: ue } = await supabase.auth.getUser(auth.slice(7));
    if (ue || !ud?.user) return json({ error: 'unauthorized' }, 401);
    const userId = ud.user.id;

    const { data: roleRows } = await supabase
      .from('user_roles_v2')
      .select('roles!inner(code)')
      .eq('user_id', userId);
    const codes = (roleRows || []).map((r: any) => r.roles?.code);
    const isAdmin = codes.includes('admin') || codes.includes('super_admin') || codes.includes('owner');
    if (!isAdmin) return json({ error: 'forbidden' }, 403);

    const body = await req.json().catch(() => ({}));
    const versionId = body?.template_version_id;
    if (!versionId || typeof versionId !== 'string') {
      return json({ error: 'template_version_id_required' }, 400);
    }

    const { data: ver, error: verErr } = await supabase
      .from('document_template_versions')
      .select('id, template_id, version_number, validation_status, markup_status, is_current')
      .eq('id', versionId)
      .maybeSingle();
    if (verErr) return json({ error: verErr.message }, 500);
    if (!ver) return json({ error: 'version_not_found' }, 404);

    if (ver.validation_status !== 'valid') {
      await supabase.from('audit_logs').insert({
        actor_user_id: userId,
        actor_type: 'user',
        action: 'document_template.version_activation_blocked',
        meta: {
          template_id: ver.template_id,
          template_version_id: ver.id,
          reason: 'validation_status_not_valid',
          validation_status: ver.validation_status,
        },
      });
      return json({ error: 'cannot_activate_invalid_version', validation_status: ver.validation_status }, 400);
    }
    if (ver.markup_status && ver.markup_status !== 'marked') {
      await supabase.from('audit_logs').insert({
        actor_user_id: userId,
        actor_type: 'user',
        action: 'document_template.version_activation_blocked',
        meta: {
          template_id: ver.template_id,
          template_version_id: ver.id,
          reason: 'markup_status_not_marked',
          markup_status: ver.markup_status,
        },
      });
      return json({ error: 'cannot_activate_unmarked_version', markup_status: ver.markup_status }, 400);
    }

    await supabase
      .from('document_template_versions')
      .update({ is_current: false })
      .eq('template_id', ver.template_id)
      .neq('id', ver.id);

    const { error: e1 } = await supabase
      .from('document_template_versions')
      .update({ is_current: true })
      .eq('id', ver.id);
    if (e1) return json({ error: e1.message }, 500);

    const { error: e2 } = await supabase
      .from('document_templates')
      .update({ current_version_id: ver.id, template_status: 'active', is_active: true })
      .eq('id', ver.template_id);
    if (e2) return json({ error: e2.message }, 500);

    await supabase.from('audit_logs').insert({
      actor_user_id: userId,
      actor_type: 'user',
      action: 'document_template.version_activated',
      meta: {
        template_id: ver.template_id,
        template_version_id: ver.id,
        version_number: ver.version_number,
      },
    });

    return json({ success: true, template_id: ver.template_id, template_version_id: ver.id });
  } catch (e: any) {
    console.error('canonical-template-activate-version error:', e);
    return json({ error: e?.message || 'internal_error' }, 500);
  }
});
