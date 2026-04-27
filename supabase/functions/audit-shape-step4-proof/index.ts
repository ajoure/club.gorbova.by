/**
 * TEMPORARY proof harness for telegram-audit-shape-runner.
 * MUST be deleted right after Step 4 proof.
 *
 * Mints user-scoped JWTs via admin.generateLink + /auth/v1/verify,
 * then exercises:
 *   1) unauth (no JWT)            -> expect 401 missing_jwt
 *   2) bogus JWT                  -> expect 401 invalid_jwt
 *   3) authed non-superadmin user -> expect 403 superadmin_required
 *   4) authed superadmin          -> expect 200 ok
 * Snapshots telegram_club_members & telegram_invite_links before/after.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
};

const SUPER_EMAIL = 'ceo@ajoure.by';
const NONSUPER_EMAIL = 'ibelka1@mail.ru';

async function mintAccessToken(supabaseUrl: string, anonKey: string, admin: ReturnType<typeof createClient>, email: string) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (error) throw new Error(`generateLink(${email}): ${error.message}`);
  const tokenHash = (data as any)?.properties?.hashed_token;
  if (!tokenHash) throw new Error(`no hashed_token for ${email}`);
  const verifyResp = await fetch(`${supabaseUrl}/auth/v1/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anonKey },
    body: JSON.stringify({ type: 'magiclink', token: tokenHash }),
  });
  const verifyJson = await verifyResp.json().catch(() => null);
  if (!verifyResp.ok) throw new Error(`verify(${email}) ${verifyResp.status}: ${JSON.stringify(verifyJson)}`);
  const accessToken = verifyJson?.access_token;
  if (!accessToken) throw new Error(`no access_token for ${email}: ${JSON.stringify(verifyJson)}`);
  return accessToken as string;
}

async function callRunner(supabaseUrl: string, jwt: string | null, body: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (jwt) headers['Authorization'] = `Bearer ${jwt}`;
  const r = await fetch(`${supabaseUrl}/functions/v1/telegram-audit-shape-runner`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => null);
  return { status: r.status, body: j };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    const snap = async () => {
      const { data: m } = await admin
        .from('telegram_club_members')
        .select('id', { count: 'exact', head: true });
      const { data: mu } = await admin
        .from('telegram_club_members')
        .select('updated_at')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const { data: i } = await admin
        .from('telegram_invite_links')
        .select('id', { count: 'exact', head: true });
      const { data: iu } = await admin
        .from('telegram_invite_links')
        .select('used_at, status, used_by_telegram_user_id')
        .order('used_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      const { count: usedCount } = await admin
        .from('telegram_invite_links')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'used');
      // counts come from response headers on head:true; supabase-js exposes via .count
      return { mu, iu, usedCount };
    };

    const before = await snap();
    // also count manually via head queries
    const { count: membersCountBefore } = await admin
      .from('telegram_club_members').select('id', { count: 'exact', head: true });
    const { count: invitesCountBefore } = await admin
      .from('telegram_invite_links').select('id', { count: 'exact', head: true });

    // 1) unauth
    const r1 = await callRunner(supabaseUrl, null, { scenario: 'INVITE_USED' });
    // 2) bogus JWT
    const r2 = await callRunner(supabaseUrl, 'bogus.jwt.value', { scenario: 'INVITE_USED' });
    // 3) non-superadmin
    const nonSuperJwt = await mintAccessToken(supabaseUrl, anonKey, admin, NONSUPER_EMAIL);
    const r3 = await callRunner(supabaseUrl, nonSuperJwt, { scenario: 'INVITE_USED' });
    // 4) superadmin OK
    const superJwt = await mintAccessToken(supabaseUrl, anonKey, admin, SUPER_EMAIL);
    const r4 = await callRunner(supabaseUrl, superJwt, { scenario: 'INVITE_USED' });
    // 4b) superadmin: invalid scenario
    const r4b = await callRunner(supabaseUrl, superJwt, { scenario: 'NOT_A_SCENARIO' });
    // 4c) superadmin: raw payload forbidden
    const r4c = await callRunner(supabaseUrl, superJwt, { scenario: 'INVITE_USED', update: { foo: 1 } });

    const after = await snap();
    const { count: membersCountAfter } = await admin
      .from('telegram_club_members').select('id', { count: 'exact', head: true });
    const { count: invitesCountAfter } = await admin
      .from('telegram_invite_links').select('id', { count: 'exact', head: true });

    return new Response(JSON.stringify({
      ok: true,
      cases: {
        unauth: r1,
        bogus_jwt: r2,
        non_superadmin: r3,
        superadmin_ok: r4,
        superadmin_invalid_scenario: r4b,
        superadmin_raw_payload: r4c,
      },
      snapshots: {
        members_count_before: membersCountBefore,
        members_count_after: membersCountAfter,
        members_count_delta: (membersCountAfter || 0) - (membersCountBefore || 0),
        members_max_updated_before: before.mu?.updated_at,
        members_max_updated_after: after.mu?.updated_at,
        invites_count_before: invitesCountBefore,
        invites_count_after: invitesCountAfter,
        invites_count_delta: (invitesCountAfter || 0) - (invitesCountBefore || 0),
        invites_used_count_before: before.usedCount,
        invites_used_count_after: after.usedCount,
        invites_latest_used_at_before: before.iu?.used_at,
        invites_latest_used_at_after: after.iu?.used_at,
        invites_latest_status_before: before.iu?.status,
        invites_latest_status_after: after.iu?.status,
        invites_latest_used_by_before: before.iu?.used_by_telegram_user_id,
        invites_latest_used_by_after: after.iu?.used_by_telegram_user_id,
      },
    }, null, 2), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message, stack: (e as Error).stack }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
