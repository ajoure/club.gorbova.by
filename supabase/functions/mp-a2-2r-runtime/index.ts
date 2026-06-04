// MP-A2-2R — Temporary runtime verification harness for Stripe Customer Resolver.
//
// SCOPE (one-off; this whole function is deleted after MP-A2-2R closes):
//   - Exercises the existing stripe-customer-resolver against the live Stripe TEST mode
//     account (stripe_poland) for scenarios S1, S4, S5, S6, S7.
//   - Returns Stripe API dump, audit records, profiles.meta before/after, resolver decision.
//   - Does NOT modify resolver / adapter / webhook code.
//   - Does NOT touch bePaid.
//   - Does NOT run migrations.
//   - Test mode only — gated explicitly by acquiring_connections.test_mode === true.
//
// Auth: super_admin JWT only.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { readAcquiringSecret } from '../_shared/acquiring/vault.ts';
import { stripeFetch } from '../_shared/acquiring/stripe-client.ts';
import {
  resolveStripeCustomer,
  mergeStripeCustomerIntoProfile,
} from '../_shared/acquiring/stripe-customer-resolver.ts';

const ACCOUNT_CODE = 'stripe_poland';
const EMAIL_PREFIX = 'mp-a2-2r-';
const EMAIL_DOMAIN = '@gorbova.test';

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

async function requireSuperAdmin(authHeader: string | null) {
  if (!authHeader) throw new Error('unauthorized:no_jwt');
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: ures, error: uerr } = await userClient.auth.getUser();
  if (uerr || !ures?.user) throw new Error('unauthorized:invalid_jwt');
  const svc = serviceClient();
  const { data: isSuper } = await svc.rpc('has_role_v2', {
    _user_id: ures.user.id,
    _role_code: 'super_admin',
  });
  if (!isSuper) throw new Error('forbidden:not_super_admin');
  return { user_id: ures.user.id };
}

async function assertTestMode(svc: ReturnType<typeof serviceClient>) {
  const { data } = await svc
    .from('acquiring_connections')
    .select('account_code,test_mode,status')
    .eq('provider', 'stripe')
    .eq('account_code', ACCOUNT_CODE)
    .maybeSingle();
  if (!data || data.test_mode !== true || data.status !== 'active') {
    throw new Error(`refuse_non_test_or_inactive:${JSON.stringify(data)}`);
  }
}

async function readProfileMeta(svc: ReturnType<typeof serviceClient>, user_id: string) {
  const { data } = await svc.from('profiles').select('id,meta').eq('user_id', user_id).maybeSingle();
  return data ?? null;
}

async function fetchAuditSince(svc: ReturnType<typeof serviceClient>, sinceIso: string, actions: string[]) {
  const { data } = await svc
    .from('audit_logs')
    .select('id,action,entity_type,meta,created_at')
    .gte('created_at', sinceIso)
    .in('action', actions)
    .order('created_at', { ascending: true });
  return data ?? [];
}

async function stripeCustomerRetrieve(secret_key: string, customer_id: string) {
  return stripeFetch<Record<string, unknown>>(`/customers/${encodeURIComponent(customer_id)}`, {
    secret_key, method: 'GET',
  });
}
async function stripeCustomerCreateSeed(
  secret_key: string,
  email: string,
  metadata: Record<string, string>,
  name?: string,
) {
  const form: Array<[string, string]> = [['email', email]];
  if (name) form.push(['name', name]);
  for (const [k, v] of Object.entries(metadata)) form.push([`metadata[${k}]`, v]);
  return stripeFetch<{ id: string; email: string; metadata: Record<string, string> }>(
    '/customers', { secret_key, method: 'POST', formBody: form },
  );
}
async function stripeCustomerListByEmail(secret_key: string, email: string) {
  const params = new URLSearchParams({ email, limit: '20' });
  return stripeFetch<{ data: Array<{ id: string; email: string; metadata: Record<string, string> }> }>(
    `/customers?${params.toString()}`, { secret_key, method: 'GET' },
  );
}
async function stripeCustomerDelete(secret_key: string, customer_id: string) {
  return stripeFetch<{ id: string; deleted: boolean }>(
    `/customers/${encodeURIComponent(customer_id)}`, { secret_key, method: 'DELETE' },
  );
}
async function stripePaymentMethodsList(secret_key: string, customer_id: string) {
  const params = new URLSearchParams({ customer: customer_id, type: 'card', limit: '5' });
  return stripeFetch<{ data: Array<{ id: string; customer: string; type: string }> }>(
    `/payment_methods?${params.toString()}`, { secret_key, method: 'GET' },
  );
}

async function resetProfileStripeMeta(
  svc: ReturnType<typeof serviceClient>,
  user_id: string,
) {
  const prof = await readProfileMeta(svc, user_id);
  if (!prof) return null;
  const meta = (prof.meta ?? {}) as Record<string, any>;
  if (meta.stripe?.customers?.[ACCOUNT_CODE]) {
    delete meta.stripe.customers[ACCOUNT_CODE];
    await svc.from('profiles').update({ meta }).eq('id', prof.id);
  }
  return prof.id;
}

// ─── Scenarios ───────────────────────────────────────────────────────────────
async function runScenario(
  svc: ReturnType<typeof serviceClient>,
  secret_key: string,
  scenario: string,
  payload: { user_id: string; foreign_user_id?: string },
) {
  const startedAt = new Date().toISOString();
  const ts = Date.now();
  const auditActions = [
    'stripe_customer_created',
    'stripe_customer_profile_synced',
    'stripe_customer_email_fallback_used',
    'stripe_customer_email_collision',
    'stripe_customer_email_ambiguous',
    'stripe_customer_mismatch',
  ];
  const out: Record<string, unknown> = { scenario, started_at: startedAt };
  const { user_id, foreign_user_id } = payload;

  // Always clear cache before runtime scenarios that expect deterministic source.
  if (['S1', 'S4', 'S5'].includes(scenario)) {
    await resetProfileStripeMeta(svc, user_id);
  }

  let email = `${EMAIL_PREFIX}${scenario.toLowerCase()}-${ts}${EMAIL_DOMAIN}`;
  let name: string | undefined;
  let seededCustomerId: string | null = null;

  if (scenario === 'S1') {
    // New user, no profile cache, no Stripe Customer with this user_id metadata.
    // Email is brand-new (timestamp), so no email-fallback collision.
    name = 'MP A2-2R S1';
  } else if (scenario === 'S4') {
    // Pre-seed: Stripe Customer with matching email but NO metadata.user_id.
    const seed = await stripeCustomerCreateSeed(secret_key, email, {
      mp_a2_2r: 'seed_s4',
    });
    if (!seed.ok || !seed.data) throw new Error(`seed_s4_failed:${JSON.stringify(seed.error)}`);
    seededCustomerId = seed.data.id;
    name = 'MP A2-2R S4';
  } else if (scenario === 'S5') {
    if (!foreign_user_id) throw new Error('s5_missing_foreign_user_id');
    const seed = await stripeCustomerCreateSeed(secret_key, email, {
      user_id: foreign_user_id,
      account_code: ACCOUNT_CODE,
      mp_a2_2r: 'seed_s5_foreign',
    });
    if (!seed.ok || !seed.data) throw new Error(`seed_s5_failed:${JSON.stringify(seed.error)}`);
    seededCustomerId = seed.data.id;
    name = 'MP A2-2R S5';
  } else if (scenario === 'S6' || scenario === 'S7') {
    // Reuse previous (S1 or S6) cached customer. Caller must have run S1 first.
    const prof = await readProfileMeta(svc, user_id);
    const cached = (prof?.meta as any)?.stripe?.customers?.[ACCOUNT_CODE];
    if (!cached?.customer_id) {
      throw new Error(`${scenario}_requires_existing_cache_from_S1`);
    }
    if (scenario === 'S6') {
      email = `${EMAIL_PREFIX}s6-changed-${ts}${EMAIL_DOMAIN}`;
      name = 'MP A2-2R S6 (kept name)';
    } else {
      // S7: keep the email from S6 (latest sync) but change name.
      const cust = await stripeCustomerRetrieve(secret_key, cached.customer_id);
      email = (cust.data as any)?.email ?? email;
      name = `MP A2-2R S7 Renamed ${ts}`;
    }
  } else {
    throw new Error(`unknown_scenario:${scenario}`);
  }

  // Capture BEFORE
  const profBefore = await readProfileMeta(svc, user_id);
  out.profile_meta_before = (profBefore?.meta as any)?.stripe ?? null;

  // Call resolver
  const decision = await resolveStripeCustomer(svc as any, secret_key, {
    user_id,
    account_code: ACCOUNT_CODE,
    email,
    name,
  });
  out.resolver_decision = { ...decision, input: { user_id, account_code: ACCOUNT_CODE, email, name } };

  // Capture AFTER
  const profAfter = await readProfileMeta(svc, user_id);
  out.profile_meta_after = (profAfter?.meta as any)?.stripe ?? null;

  // Stripe API dump
  const stripeDump = await stripeCustomerRetrieve(secret_key, decision.customer_id);
  out.stripe_customer = stripeDump.data;
  if (scenario === 'S1') {
    const pm = await stripePaymentMethodsList(secret_key, decision.customer_id);
    out.stripe_payment_methods = pm.data;
  }
  if (scenario === 'S5' && seededCustomerId) {
    // Pull the foreign seed too to prove resolver did NOT use it.
    const foreignDump = await stripeCustomerRetrieve(secret_key, seededCustomerId);
    out.s5_foreign_customer_after = foreignDump.data;
    out.s5_seeded_customer_id = seededCustomerId;
    out.s5_assertion_not_reused =
      (foreignDump.data as any)?.id !== decision.customer_id;
  }

  // Audit since
  out.audit_records = await fetchAuditSince(svc, startedAt, auditActions);
  out.finished_at = new Date().toISOString();

  return out;
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────
async function runCleanup(
  svc: ReturnType<typeof serviceClient>,
  secret_key: string,
  user_ids: string[],
) {
  const removed: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  // Find all Stripe Customers with mp_a2_2r metadata or matching test emails.
  // Strategy: iterate user_ids' cached customers + list by email pattern wildcard isn't supported,
  // so we rely on the cached set + audit-derived ids returned to caller below.

  // 1) Delete cached customers for test users
  for (const uid of user_ids) {
    const prof = await readProfileMeta(svc, uid);
    const cached = (prof?.meta as any)?.stripe?.customers?.[ACCOUNT_CODE];
    if (cached?.customer_id) {
      const del = await stripeCustomerDelete(secret_key, cached.customer_id);
      if (del.ok) removed.push(cached.customer_id);
      else failed.push({ id: cached.customer_id, error: del.error?.message ?? `http_${del.status}` });
    }
    await resetProfileStripeMeta(svc, uid);
  }

  // 2) Sweep any seeded customers by recent mp-a2-2r emails (best-effort).
  // The caller passes a list of emails seen during this MP-A2-2R run.
  return { removed, failed };
}

async function sweepCustomersByEmails(
  secret_key: string,
  emails: string[],
) {
  const removed: string[] = [];
  const failed: Array<{ email: string; error: string }> = [];
  for (const email of emails) {
    const list = await stripeCustomerListByEmail(secret_key, email);
    if (!list.ok || !list.data) {
      failed.push({ email, error: list.error?.message ?? `http_${list.status}` });
      continue;
    }
    for (const c of list.data.data) {
      const del = await stripeCustomerDelete(secret_key, c.id);
      if (del.ok) removed.push(c.id);
      else failed.push({ email, error: `${c.id}:${del.error?.message ?? del.status}` });
    }
  }
  return { removed, failed };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    await requireSuperAdmin(req.headers.get('Authorization'));
    const svc = serviceClient();
    await assertTestMode(svc);
    const secret_key = await readAcquiringSecret('stripe', ACCOUNT_CODE, 'secret_key');

    const body = await req.json().catch(() => ({}));
    const action = (body.action ?? 'scenario') as 'scenario' | 'cleanup' | 'sweep_emails';

    if (action === 'cleanup') {
      const result = await runCleanup(svc, secret_key, body.user_ids ?? []);
      return new Response(JSON.stringify({ ok: true, ...result }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (action === 'sweep_emails') {
      const result = await sweepCustomersByEmails(secret_key, body.emails ?? []);
      return new Response(JSON.stringify({ ok: true, ...result }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const out = await runScenario(svc, secret_key, body.scenario, {
      user_id: body.user_id,
      foreign_user_id: body.foreign_user_id,
    });
    return new Response(JSON.stringify({ ok: true, result: out }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: String((e as Error).message ?? e) }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
