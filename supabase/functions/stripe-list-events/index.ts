// Phase 2 — stripe-list-events (read-only, from provider_events)
import { handleCorsPreflightRequest, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { requireSuperAdmin } from '../_shared/acquiring/auth-guard.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleCorsPreflightRequest();
  try {
    const { supabase } = await requireSuperAdmin(req);
    const url = new URL(req.url);
    const account_code = url.searchParams.get('account_code');
    const event_type = url.searchParams.get('event_type');
    const status = url.searchParams.get('status');
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 500);

    let q = supabase
      .from('provider_events')
      .select('id, provider, account_code, event_id, event_type, processing_status, processed_at, signature_valid, related_order_id, related_payment_id, created_at, processing_error')
      .eq('provider', 'stripe')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (account_code) q = q.eq('account_code', account_code);
    if (event_type) q = q.eq('event_type', event_type);
    if (status) q = q.eq('processing_status', status);

    const { data, error } = await q;
    if (error) return errorResponse(error.message, 500);
    return jsonResponse({ ok: true, events: data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    if (msg.startsWith('unauthorized')) return errorResponse(msg, 401);
    if (msg.startsWith('forbidden')) return errorResponse(msg, 403);
    return errorResponse(msg, 500);
  }
});
