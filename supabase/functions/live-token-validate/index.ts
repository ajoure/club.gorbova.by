import { createClient } from 'npm:@supabase/supabase-js@2';
import { resolveEffectiveProductAccess } from '../_shared/resolve-effective-access.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PROOF_TTL_HOURS = 24;
const SESSION_TTL_HOURS = 24;
const DEFAULT_LINK_TTL_HOURS = 72;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { action } = body;

    if (!action || !['create', 'validate', 'revoke', 'reissue'].includes(action)) {
      return jsonResponse({ status: 'error', message: 'Invalid action' }, 400);
    }

    // ─── ACTION: CREATE (service role / internal backend only) ───
    if (action === 'create') {
      const authHeader = req.headers.get('Authorization');
      const svcKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      if (!authHeader || authHeader !== `Bearer ${svcKey}`) {
        return jsonResponse({ status: 'error', message: 'Service role access required' }, 403);
      }
      return await handleCreate(supabase, body);
    }

    // ─── ACTION: VALIDATE ───
    if (action === 'validate') {
      return await handleValidate(supabase, req, body, supabaseUrl, anonKey);
    }

    // ─── ACTION: REVOKE ───
    if (action === 'revoke') {
      return await handleRevoke(supabase, req, body, supabaseUrl, anonKey);
    }

    // ─── ACTION: REISSUE ───
    if (action === 'reissue') {
      return await handleReissue(supabase, req, body, supabaseUrl, anonKey);
    }

    return jsonResponse({ status: 'error', message: 'Unknown action' }, 400);
  } catch (err) {
    console.error('[live-token-validate] Unexpected error:', err);
    return jsonResponse({ status: 'error', message: 'Internal error' }, 500);
  }
});

// ════════════════════════════════════════════════════════════
// ACTION: CREATE
// ════════════════════════════════════════════════════════════
async function handleCreate(supabase: any, body: any) {
  const { live_event_id, user_id, ttl_hours, sent_via } = body;

  if (!live_event_id || !user_id) {
    return jsonResponse({ status: 'error', message: 'live_event_id and user_id required' }, 400);
  }

  const ttl = ttl_hours ?? DEFAULT_LINK_TTL_HOURS;
  const rawToken = crypto.randomUUID();
  const tokenHash = await hashToken(rawToken);
  const expiresAt = new Date(Date.now() + ttl * 60 * 60 * 1000).toISOString();

  // Revoke any existing active link for this user+event
  await supabase
    .from('live_access_links')
    .update({ status: 'revoked', revoked_at: new Date().toISOString() })
    .eq('user_id', user_id)
    .eq('live_event_id', live_event_id)
    .in('status', ['created', 'sent']);

  const { data: link, error: insertError } = await supabase
    .from('live_access_links')
    .insert({
      live_event_id,
      user_id,
      token_hash: tokenHash,
      status: 'created',
      expires_at: expiresAt,
      sent_via: sent_via || null,
    })
    .select('id, expires_at')
    .single();

  if (insertError) {
    console.error('[live-token-validate] Create insert error:', insertError);
    return jsonResponse({ status: 'error', message: 'Failed to create link' }, 500);
  }

  await logAudit(supabase, 'live_link_created', 'system', null, {
    link_id: link.id, live_event_id, user_id, sent_via: sent_via || null,
  });

  return jsonResponse({
    status: 'ok',
    token: rawToken,
    link_id: link.id,
    expires_at: link.expires_at,
  });
}

// ════════════════════════════════════════════════════════════
// ACTION: VALIDATE (+ activate/re-enter on success)
// ════════════════════════════════════════════════════════════
async function handleValidate(
  supabase: any,
  req: Request,
  body: any,
  supabaseUrl: string,
  anonKey: string,
) {
  const { token } = body;
  if (!token) {
    return jsonResponse({ status: 'error', message: 'token required' }, 400);
  }

  // 1. Hash token → find link
  const tokenHash = await hashToken(token);
  const { data: link, error: linkErr } = await supabase
    .from('live_access_links')
    .select('*')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (linkErr || !link) {
    return jsonResponse({ status: 'token_not_found' }, 404);
  }

  // 2. Record first opened timestamp
  if (!link.opened_at) {
    await supabase
      .from('live_access_links')
      .update({ opened_at: new Date().toISOString() })
      .eq('id', link.id);
  }

  // 3. Token expired (check before status checks)
  if (new Date(link.expires_at) < new Date()) {
    await supabase
      .from('live_access_links')
      .update({ status: 'expired' })
      .eq('id', link.id)
      .in('status', ['created', 'sent']);
    return jsonResponse({ status: 'token_expired' }, 403);
  }

  // 4. Token revoked
  if (link.status === 'revoked') {
    return jsonResponse({ status: 'token_revoked' }, 403);
  }

  // 5. Authenticate user via JWT
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonResponse({ status: 'auth_required' }, 401);
  }

  const jwtToken = authHeader.replace('Bearer ', '');
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwtToken}` } },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();

  if (authError || !user) {
    return jsonResponse({ status: 'auth_required' }, 401);
  }

  // 6. Audit: link opened (after auth, with user context)
  await logAudit(supabase, 'live_link_opened', 'user', user.id, {
    link_id: link.id, link_status: link.status, result: 'pending_validation',
  });

  // 7. User mismatch — audit-only, do NOT change link status
  if (user.id !== link.user_id) {
    await supabase
      .from('live_access_links')
      .update({
        last_opened_by_user_id: user.id,
        last_opened_at: new Date().toISOString(),
      })
      .eq('id', link.id);

    await logAudit(supabase, 'live_link_mismatch', 'user', user.id, {
      link_id: link.id,
      expected_user_id: link.user_id,
      actual_user_id: user.id,
    });
    return jsonResponse({ status: 'token_mismatch' }, 403);
  }

  // 8. If link already activated — owner re-entry flow
  // Skip re-validation of access for activated links — just refresh proof+session
  if (link.status === 'consumed') {
    // Fetch event for slug + published check
    const { data: event } = await supabase
      .from('live_events')
      .select('id, slug, is_published')
      .eq('id', link.live_event_id)
      .maybeSingle();

    if (!event) {
      return jsonResponse({ status: 'event_not_found' }, 404);
    }
    if (!event.is_published) {
      return jsonResponse({ status: 'event_unpublished' }, 403);
    }

    // Refresh proof + session for owner re-entry
    await upsertProof(supabase, event.id, user.id, link.id);
    const sessionKey = await createOrReplaceSession(supabase, event.id, user.id);

    await logAudit(supabase, 'live_link_reentry', 'user', user.id, {
      link_id: link.id, live_event_id: event.id,
    });

    return jsonResponse({
      status: 'ok',
      redirect_slug: event.slug,
      session_key: sessionKey,
    });
  }

  // 9. First activation: link must be in created/sent status
  if (!['created', 'sent'].includes(link.status)) {
    return jsonResponse({ status: 'error', message: 'Unexpected link status' }, 400);
  }

  // 10. Check event exists + published
  const { data: event, error: eventErr } = await supabase
    .from('live_events')
    .select('id, slug, is_published, product_id, access_rule, status')
    .eq('id', link.live_event_id)
    .maybeSingle();

  if (eventErr || !event) {
    return jsonResponse({ status: 'event_not_found' }, 404);
  }

  if (!event.is_published) {
    return jsonResponse({ status: 'event_unpublished' }, 403);
  }

  // 11. Canonical access check
  const accessRule = event.access_rule as { mode: string; product_id?: string; tariff_id?: string };
  let accessValid = false;

  if (accessRule.mode === 'all') {
    accessValid = true;
  } else {
    const productId = accessRule.product_id || event.product_id;
    const snapshot = await resolveEffectiveProductAccess(supabase, user.id, productId);

    if (snapshot.isUnlimited || (snapshot.effectiveEndAt && snapshot.effectiveEndAt > new Date())) {
      accessValid = true;
    }

    if (accessValid && accessRule.mode === 'tariff' && accessRule.tariff_id) {
      const { data: tariffSub } = await supabase
        .from('subscriptions_v2')
        .select('id')
        .eq('user_id', user.id)
        .eq('product_id', productId)
        .eq('tariff_id', accessRule.tariff_id)
        .in('status', ['active', 'trial'])
        .limit(1)
        .maybeSingle();

      if (!tariffSub) {
        const { data: tariffEnt } = await supabase
          .from('entitlements')
          .select('id')
          .eq('user_id', user.id)
          .eq('product_id', productId)
          .eq('status', 'active')
          .limit(1)
          .maybeSingle();

        if (!tariffEnt) {
          accessValid = false;
        }
      }
    }
  }

  if (!accessValid) {
    await logAudit(supabase, 'live_access_denied', 'user', user.id, {
      link_id: link.id, live_event_id: event.id, access_rule_mode: accessRule.mode,
    });
    return jsonResponse({ status: 'access_denied' }, 403);
  }

  // ─── 12. ACTIVATE (first successful activation) ───
  await supabase
    .from('live_access_links')
    .update({
      status: 'consumed',
      consumed_at: new Date().toISOString(),
      activated_at: new Date().toISOString(),
    })
    .eq('id', link.id);

  // Create proof + session
  await upsertProof(supabase, event.id, user.id, link.id);
  const sessionKey = await createOrReplaceSession(supabase, event.id, user.id);

  await logAudit(supabase, 'live_link_activated', 'user', user.id, {
    link_id: link.id, live_event_id: event.id,
  });

  return jsonResponse({
    status: 'ok',
    redirect_slug: event.slug,
    session_key: sessionKey,
  });
}

// ════════════════════════════════════════════════════════════
// ACTION: REVOKE
// ════════════════════════════════════════════════════════════
async function handleRevoke(
  supabase: any,
  req: Request,
  body: any,
  supabaseUrl: string,
  anonKey: string,
) {
  const admin = await authenticateAdmin(supabase, req, supabaseUrl, anonKey);
  if (!admin) {
    return jsonResponse({ status: 'error', message: 'Admin access required' }, 403);
  }

  const { link_id } = body;
  if (!link_id) {
    return jsonResponse({ status: 'error', message: 'link_id required' }, 400);
  }

  const { error } = await supabase
    .from('live_access_links')
    .update({ status: 'revoked', revoked_at: new Date().toISOString() })
    .eq('id', link_id)
    .in('status', ['created', 'sent']);

  if (error) {
    return jsonResponse({ status: 'error', message: 'Failed to revoke' }, 500);
  }

  await logAudit(supabase, 'live_link_revoked', 'user', admin.id, { link_id });

  return jsonResponse({ status: 'ok' });
}

// ════════════════════════════════════════════════════════════
// ACTION: REISSUE
// ════════════════════════════════════════════════════════════
async function handleReissue(
  supabase: any,
  req: Request,
  body: any,
  supabaseUrl: string,
  anonKey: string,
) {
  const admin = await authenticateAdmin(supabase, req, supabaseUrl, anonKey);
  if (!admin) {
    return jsonResponse({ status: 'error', message: 'Admin access required' }, 403);
  }

  let { link_id, user_id, live_event_id } = body;

  if (link_id) {
    const { data: oldLink } = await supabase
      .from('live_access_links')
      .select('user_id, live_event_id')
      .eq('id', link_id)
      .single();

    if (!oldLink) {
      return jsonResponse({ status: 'error', message: 'Link not found' }, 404);
    }
    user_id = oldLink.user_id;
    live_event_id = oldLink.live_event_id;
  }

  if (!user_id || !live_event_id) {
    return jsonResponse({ status: 'error', message: 'user_id and live_event_id required' }, 400);
  }

  const createResult = await handleCreate(supabase, {
    live_event_id, user_id,
    ttl_hours: body.ttl_hours,
    sent_via: body.sent_via,
  });

  await logAudit(supabase, 'live_link_revoked', 'user', admin.id, {
    link_id: link_id || null, reissue: true, user_id, live_event_id,
  });

  return createResult;
}

// ════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function authenticateAdmin(
  supabase: any,
  req: Request,
  supabaseUrl: string,
  anonKey: string,
): Promise<{ id: string } | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return null;

  const jwtToken = authHeader.replace('Bearer ', '');
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwtToken}` } },
  });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return null;

  // C1 hotfix: use correct parameter name _role_code
  const { data: hasRole } = await supabase.rpc('has_role_v2', {
    _user_id: user.id,
    _role_code: 'admin',
  });

  if (!hasRole) return null;
  return { id: user.id };
}

/** Upsert proof: delete existing + insert new (TTL 24h) */
async function upsertProof(
  supabase: any,
  eventId: string,
  userId: string,
  linkId: string,
) {
  const proofExpiresAt = new Date(Date.now() + PROOF_TTL_HOURS * 60 * 60 * 1000).toISOString();

  await supabase
    .from('live_access_proofs')
    .delete()
    .eq('user_id', userId)
    .eq('live_event_id', eventId);

  await supabase
    .from('live_access_proofs')
    .insert({
      live_event_id: eventId,
      user_id: userId,
      link_id: linkId,
      proof_type: 'invite_consumed',
      expires_at: proofExpiresAt,
    });
}

/**
 * Create or replace active session for user+event.
 * Revokes any existing active session first (single-session enforcement).
 * Returns the new session_key.
 */
async function createOrReplaceSession(
  supabase: any,
  eventId: string,
  userId: string,
): Promise<string> {
  const now = new Date().toISOString();

  // Revoke existing active session for this user+event
  const { data: existingSession } = await supabase
    .from('live_active_sessions')
    .select('id')
    .eq('user_id', userId)
    .eq('live_event_id', eventId)
    .is('revoked_at', null)
    .maybeSingle();

  if (existingSession) {
    await supabase
      .from('live_active_sessions')
      .update({ revoked_at: now })
      .eq('id', existingSession.id);

    await logAudit(supabase, 'live_session_replaced', 'system', null, {
      old_session_id: existingSession.id,
      user_id: userId,
      live_event_id: eventId,
    });
  }

  // Create new session
  const sessionKey = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString();

  await supabase
    .from('live_active_sessions')
    .insert({
      live_event_id: eventId,
      user_id: userId,
      session_key: sessionKey,
      expires_at: expiresAt,
    });

  await logAudit(supabase, 'live_session_started', 'user', userId, {
    live_event_id: eventId,
  });

  return sessionKey;
}

async function logAudit(
  supabase: any,
  action: string,
  actorType: 'user' | 'system',
  actorUserId: string | null,
  meta: Record<string, any>,
) {
  try {
    await supabase.from('audit_logs').insert({
      action,
      actor_type: actorType,
      actor_user_id: actorUserId,
      actor_label: actorType === 'system' ? 'live-token-validate' : null,
      meta,
    });
  } catch (e) {
    console.error('[live-token-validate] Audit log error:', e);
  }
}

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
