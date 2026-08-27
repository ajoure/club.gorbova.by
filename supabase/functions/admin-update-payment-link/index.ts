/**
 * admin-update-payment-link
 *
 * НАЗНАЧЕНИЕ: безопасное редактирование публичной ссылки.
 *   Разрешено менять ТОЛЬКО: description, max_uses, expires_at.
 *   ЗАПРЕЩЕНО: amount, product_id, tariff_id, offer_id, user_id, status, url_token, current_uses.
 *   Guards:
 *     • max_uses < current_uses → 400.
 *     • expires_at в прошлом → 400.
 *   AUTH: JWT + payments:edit (admin/super_admin bypass through canonical RBAC).
 *   Audit: payment_link.updated.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, handleCorsPreflightRequest, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { requirePaymentsEdit } from '../_shared/admin-section-auth.ts';

interface UpdateBody {
  payment_link_id: string;
  description?: string | null;
  max_uses?: number | null;
  expires_at?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleCorsPreflightRequest();
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const access = await requirePaymentsEdit(req, supabase);
    if (!access.ok) return errorResponse(access.error, access.status);
    const user = access.actor;

    const body: UpdateBody = await req.json();
    if (!body.payment_link_id) return errorResponse('payment_link_id required', 400);

    const { data: existing } = await supabase
      .from('payment_links')
      .select('id, current_uses, max_uses, expires_at, description')
      .eq('id', body.payment_link_id).maybeSingle();
    if (!existing) return errorResponse('Payment link not found', 404);

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if ('description' in body) patch.description = body.description ?? null;

    if ('max_uses' in body) {
      if (body.max_uses !== null && body.max_uses !== undefined) {
        if (!Number.isInteger(body.max_uses) || body.max_uses < 1) {
          return errorResponse('max_uses must be positive integer or null', 400);
        }
        if (body.max_uses < (existing.current_uses ?? 0)) {
          return errorResponse(
            `max_uses (${body.max_uses}) cannot be less than current_uses (${existing.current_uses})`,
            400
          );
        }
      }
      patch.max_uses = body.max_uses ?? null;
    }

    if ('expires_at' in body) {
      if (body.expires_at) {
        const exp = new Date(body.expires_at);
        if (isNaN(exp.getTime())) return errorResponse('expires_at invalid date', 400);
        if (exp.getTime() <= Date.now()) return errorResponse('expires_at must be in the future', 400);
      }
      patch.expires_at = body.expires_at ?? null;
    }

    const { error: updErr } = await supabase
      .from('payment_links').update(patch).eq('id', body.payment_link_id);
    if (updErr) return errorResponse(`Failed to update: ${updErr.message}`, 500);

    await supabase.from('audit_logs').insert({
      actor_type: 'admin',
      actor_user_id: user.id,
      action: 'payment_link.updated',
      actor_label: 'admin-update-payment-link',
      meta: {
        payment_link_id: body.payment_link_id,
        before: existing,
        patch,
      },
    });

    return jsonResponse({ success: true, payment_link_id: body.payment_link_id });
  } catch (e) {
    console.error('[admin-update-payment-link] Unexpected error:', e);
    return errorResponse('Internal server error', 500);
  }
});
