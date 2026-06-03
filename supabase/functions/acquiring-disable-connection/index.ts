// Phase 2 — acquiring-disable-connection
// Sets status='disabled' and purges Vault secrets via admin_delete_acquiring_secrets RPC.

import { handleCorsPreflightRequest, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { requireSuperAdmin, actorSupabase } from '../_shared/acquiring/auth-guard.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleCorsPreflightRequest();
  try {
    const { supabase } = await requireSuperAdmin(req);
    const { connection_id } = await req.json() as { connection_id: string };
    if (!connection_id) return errorResponse('missing_connection_id', 400);

    const actor = actorSupabase(req);
    const { error: rpcErr } = await actor.rpc('admin_delete_acquiring_secrets', { p_connection_id: connection_id });
    if (rpcErr) return errorResponse(`vault_delete_failed:${rpcErr.message}`, 500);

    const { error } = await supabase
      .from('acquiring_connections')
      .update({ status: 'disabled', last_error: null, last_verified_at: new Date().toISOString() })
      .eq('id', connection_id);
    if (error) return errorResponse(error.message, 500);
    return jsonResponse({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    if (msg.startsWith('unauthorized')) return errorResponse(msg, 401);
    if (msg.startsWith('forbidden')) return errorResponse(msg, 403);
    return errorResponse(msg, 500);
  }
});
