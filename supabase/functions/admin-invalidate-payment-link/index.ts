/**
 * admin-invalidate-payment-link
 *
 * НАЗНАЧЕНИЕ: безопасно сделать публичную ссылку недействительной (soft).
 *   • UPDATE payment_links.status='invalidated' (никакого DELETE).
 *   • НЕ трогает orders_v2 / current_uses / downstream.
 *   • AUTH: JWT + admin/super_admin.
 *   • Audit: payment_link.invalidated.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, handleCorsPreflightRequest, jsonResponse, errorResponse } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleCorsPreflightRequest();
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return errorResponse('Not authorized', 401);
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) return errorResponse('Invalid token', 401);

    const { data: isAdmin } = await supabase.rpc('has_role', { _user_id: user.id, _role: 'admin' });
    const { data: isSuper } = await supabase.rpc('has_role', { _user_id: user.id, _role: 'super_admin' });
    if (!isAdmin && !isSuper) return errorResponse('Access denied: admin role required', 403);

    const { payment_link_id, reason } = await req.json();
    if (!payment_link_id || typeof payment_link_id !== 'string') {
      return errorResponse('payment_link_id required', 400);
    }

    const { data: existing } = await supabase
      .from('payment_links').select('id, status, url_token').eq('id', payment_link_id).maybeSingle();
    if (!existing) return errorResponse('Payment link not found', 404);

    const { error: updErr } = await supabase
      .from('payment_links')
      .update({ status: 'invalidated', updated_at: new Date().toISOString() })
      .eq('id', payment_link_id);
    if (updErr) return errorResponse(`Failed to invalidate: ${updErr.message}`, 500);

    await supabase.from('audit_logs').insert({
      actor_type: 'admin',
      actor_user_id: user.id,
      action: 'payment_link.invalidated',
      actor_label: 'admin-invalidate-payment-link',
      meta: {
        payment_link_id,
        url_token: existing.url_token,
        previous_status: existing.status,
        reason: reason || null,
      },
    });

    return jsonResponse({ success: true, payment_link_id });
  } catch (e) {
    console.error('[admin-invalidate-payment-link] Unexpected error:', e);
    return errorResponse('Internal server error', 500);
  }
});
