// ============================================================================
// canonical-template-audit — Sprint 11 C2
// ----------------------------------------------------------------------------
// Узкая server-side точка для записи событий жизненного цикла шаблона:
//   document_template.uploaded
//   document_template.preview_opened
//   document_template.validation_failed
//   document_template.validation_passed
//   document_template.version_activated   (call site: пока client)
//   document_template.markup_started
//   document_template.markup_applied
//
// Body:
//   { event: string, template_id?, template_version_id?, meta?: object }
//
// Гарантии:
//   • JWT обязателен (admin/super_admin/owner)
//   • Записывает в audit_logs c actor_user_id из JWT
//   • Никогда не использует user_id из body (anti-spoofing)
// ============================================================================

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ALLOWED_EVENTS = new Set([
  'document_template.uploaded',
  'document_template.preview_opened',
  'document_template.validation_failed',
  'document_template.validation_passed',
  'document_template.version_activated',
  'document_template.markup_started',
  'document_template.markup_applied',
  'document_template.deleted',
]);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const { data: authData } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    const userId = authData?.user?.id;
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: roleRows } = await supabase.from('user_roles_v2').select('roles!inner(code)').eq('user_id', userId);
    const codes = (roleRows || []).map((r: any) => r.roles?.code);
    if (!codes.some((c: string) => ['admin', 'super_admin', 'owner'].includes(c))) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = await req.json().catch(() => ({}));
    const event: string = String(body.event || '');
    if (!ALLOWED_EVENTS.has(event)) {
      return new Response(JSON.stringify({ error: 'unknown_event', event }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const meta: Record<string, unknown> = {
      template_id: body.template_id ?? null,
      template_version_id: body.template_version_id ?? null,
      ...(body.meta && typeof body.meta === 'object' ? body.meta : {}),
    };

    const { error } = await supabase.from('audit_logs').insert({
      actor_user_id: userId,
      actor_type: 'user',
      action: event,
      meta,
    });
    if (error) throw error;

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
