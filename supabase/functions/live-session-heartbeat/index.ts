import { createClient } from 'npm:@supabase/supabase-js@2';
import { isClosedLiveRoom } from '../_shared/live-room-gate.ts';
import { verifyLiveBearerClaims } from '../_shared/live-auth-claims.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * M2 unified entry tracking.
 *
 * Two modes:
 *  1) Heartbeat mode: payload { session_key } — UPDATE last_seen_at on existing row.
 *  2) Soft-join mode: payload { live_event_id, entry_path? } (no session_key OR session_key not found)
 *     — verify access via user_has_live_event_access, UPSERT into live_active_sessions
 *     keyed by (user_id, live_event_id) WHERE revoked_at IS NULL, return new session_key.
 *
 * Scope guard: soft-join is allowed only when the caller has access and the
 * explicit live room lifecycle is not closed. Both checks are authoritative
 * on the server; the UI only decides when to request a join.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Authenticate user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ status: 'auth_required' }, 401);
    }

    const jwtToken = authHeader.replace('Bearer ', '').trim();
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwtToken}` } },
    });
    const authVerification = await verifyLiveBearerClaims(
      () => userClient.auth.getClaims(jwtToken),
    );

    if (!authVerification.userId) {
      console.error('[live-session-heartbeat] Auth error:', authVerification.error);
      return jsonResponse({ status: 'auth_required' }, 401);
    }
    const user = { id: authVerification.userId };

    const body = await req.json().catch(() => ({}));
    const session_key: string | undefined = body?.session_key;
    const live_event_id: string | undefined = body?.live_event_id;
    const rawEntryPath: string | undefined = body?.entry_path;
    const entry_path: 'token' | 'direct' | 'menu' = ['token', 'direct', 'menu'].includes(rawEntryPath as string)
      ? (rawEntryPath as 'token' | 'direct' | 'menu')
      : 'direct';

    // ---- Heartbeat mode (existing session_key) ----
    if (session_key && typeof session_key === 'string') {
      const { data: session, error: sessionErr } = await supabase
        .from('live_active_sessions')
        .select('id, user_id, live_event_id, revoked_at, expires_at')
        .eq('session_key', session_key)
        .eq('user_id', user.id)
        .maybeSingle();

      if (sessionErr) {
        console.error('[live-session-heartbeat] sessionErr', sessionErr);
      }

      if (session) {
        if (session.revoked_at) {
          return jsonResponse({ status: 'session_revoked' });
        }
        if (new Date(session.expires_at) < new Date()) {
          return jsonResponse({ status: 'session_expired' });
        }
        await supabase
          .from('live_active_sessions')
          .update({ last_seen_at: new Date().toISOString() })
          .eq('id', session.id);
        return jsonResponse({ status: 'ok' });
      }
      // No session row found by session_key → fall through to soft-join if live_event_id provided.
      if (!live_event_id) {
        return jsonResponse({ status: 'session_not_found' }, 404);
      }
    }

    // ---- Soft-join mode (no session_key OR session_key not found, requires live_event_id) ----
    if (!live_event_id || typeof live_event_id !== 'string') {
      return jsonResponse({ status: 'error', message: 'session_key or live_event_id required' }, 400);
    }

    // Defense in depth: never create/resume a soft-join session while the
    // explicit live room lifecycle is still closed. The UI has the same gate,
    // but session creation must not rely on client behavior.
    const { data: event, error: eventErr } = await supabase
      .from('live_events')
      .select('id, event_type, room_state, platform_status, status')
      .eq('id', live_event_id)
      .maybeSingle();
    if (eventErr) {
      console.error('[live-session-heartbeat] room state check error', eventErr);
      return jsonResponse({ status: 'error', message: 'room_state_check_failed' }, 500);
    }
    if (!event) {
      return jsonResponse({ status: 'event_not_found' }, 404);
    }
    if (isClosedLiveRoom(event)) {
      return jsonResponse({ status: 'room_closed' }, 403);
    }

    // Server-side access check (authoritative).
    const { data: hasAccess, error: accessErr } = await supabase.rpc('user_has_live_event_access', {
      _user_id: user.id,
      _live_event_id: live_event_id,
    });
    if (accessErr) {
      console.error('[live-session-heartbeat] access check error', accessErr);
      return jsonResponse({ status: 'error', message: 'access_check_failed' }, 500);
    }
    if (!hasAccess) {
      return jsonResponse({ status: 'access_denied' }, 403);
    }

    const nowIso = new Date().toISOString();
    const expiresIso = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();

    // Idempotent: try to find an existing non-revoked row first.
    const { data: existing } = await supabase
      .from('live_active_sessions')
      .select('id, session_key, expires_at')
      .eq('user_id', user.id)
      .eq('live_event_id', live_event_id)
      .is('revoked_at', null)
      .maybeSingle();

    if (existing) {
      const expired = new Date(existing.expires_at) < new Date();
      const updates: Record<string, unknown> = { last_seen_at: nowIso };
      if (expired) updates.expires_at = expiresIso;
      await supabase
        .from('live_active_sessions')
        .update(updates)
        .eq('id', existing.id);
      return jsonResponse({ status: 'ok', session_key: existing.session_key, mode: 'soft_join_resumed' });
    }

    const newSessionKey = crypto.randomUUID();
    const { error: insertErr } = await supabase
      .from('live_active_sessions')
      .insert({
        user_id: user.id,
        live_event_id,
        session_key: newSessionKey,
        expires_at: expiresIso,
        last_seen_at: nowIso,
      });
    // entry_path передаётся клиентом и используется в M3 (live_view_sessions). На уровне
    // live_active_sessions колонки meta нет — это runtime SoT, не история.
    void entry_path;

    if (insertErr) {
      // Race: someone else (parallel tab) inserted in between → re-read and reuse.
      console.warn('[live-session-heartbeat] insert race', insertErr.message);
      const { data: raceRow } = await supabase
        .from('live_active_sessions')
        .select('session_key')
        .eq('user_id', user.id)
        .eq('live_event_id', live_event_id)
        .is('revoked_at', null)
        .maybeSingle();
      if (raceRow?.session_key) {
        return jsonResponse({ status: 'ok', session_key: raceRow.session_key, mode: 'soft_join_resumed' });
      }
      return jsonResponse({ status: 'error', message: 'insert_failed' }, 500);
    }

    return jsonResponse({ status: 'ok', session_key: newSessionKey, mode: 'soft_join_created' });
  } catch (err) {
    console.error('[live-session-heartbeat] Error:', err);
    return jsonResponse({ status: 'error', message: 'Internal error' }, 500);
  }
});

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
