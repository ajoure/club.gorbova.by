// MP-A2-2 — Stripe Customer Resolver.
//
// SOT of customer identity = (user_id, account_code).
// One user → DIFFERENT cus_* across different Stripe accounts. Never merged cross-account.
// Email is NOT an identity key. Email + name can change without producing a new Customer.
//
// Lookup order (strict):
//   1) profile_cache  — profiles.meta.stripe.customers[account_code].customer_id, validated via customers.retrieve
//   2) stripe_search  — customers.search by metadata.user_id + metadata.account_code
//   3) email_fallback — customers.list({email}); only if exactly one match WITHOUT foreign user_id metadata
//   4) created        — customers.create with metadata.user_id + metadata.account_code
//
// Mismatch policy: if step (2) returns a customer_id that differs from profile_cache,
// DO NOT auto-rewrite. Audit `stripe_customer_mismatch` + return existing profile_cache id
// with `mismatch` field set. Manual resolution only.
//
// Local PaymentMethod storage is FORBIDDEN. Stripe = SOT for cards.

import { stripeFetch } from './stripe-client.ts';

type Supa = {
  from: (t: string) => any;
};

export interface ResolveStripeCustomerInput {
  user_id: string;
  account_code: string;
  email: string;
  name?: string | null;
}

export type CustomerResolveSource =
  | 'profile_cache'
  | 'stripe_search'
  | 'email_fallback'
  | 'created';

export interface ResolveStripeCustomerOutput {
  customer_id: string;
  source: CustomerResolveSource;
  mismatch?: { profile_customer_id: string; stripe_customer_id: string };
}

interface CachedEntry {
  customer_id: string;
  created_at?: string;
  last_synced_at?: string;
  source?: CustomerResolveSource;
}

function getCached(meta: any, account_code: string): CachedEntry | null {
  const entry = meta?.stripe?.customers?.[account_code];
  if (entry && typeof entry === 'object' && typeof entry.customer_id === 'string') {
    return entry as CachedEntry;
  }
  return null;
}

async function audit(supabase: Supa, action: string, payload: Record<string, unknown>) {
  try {
    await supabase.from('audit_logs').insert({
      action,
      entity_type: 'stripe_customer',
      entity_id: null,
      meta: payload,
    });
  } catch {
    // best-effort
  }
}

export async function mergeStripeCustomerIntoProfile(
  supabase: Supa,
  user_id: string,
  account_code: string,
  entry: CachedEntry,
): Promise<void> {
  // Read current meta, do shallow merge under stripe.customers.<account_code>
  const { data: prof } = await supabase
    .from('profiles')
    .select('id, meta')
    .eq('user_id', user_id)
    .maybeSingle();
  if (!prof) return;
  const meta = (prof.meta ?? {}) as Record<string, any>;
  const stripeMeta = (meta.stripe ?? {}) as Record<string, any>;
  const customers = (stripeMeta.customers ?? {}) as Record<string, any>;
  const existing = customers[account_code] ?? {};
  customers[account_code] = {
    ...existing,
    ...entry,
    last_synced_at: new Date().toISOString(),
    created_at: existing.created_at ?? entry.created_at ?? new Date().toISOString(),
  };
  stripeMeta.customers = customers;
  meta.stripe = stripeMeta;
  await supabase.from('profiles').update({ meta }).eq('id', prof.id);
}

interface StripeCustomer {
  id: string;
  email?: string | null;
  name?: string | null;
  deleted?: boolean;
  metadata?: Record<string, string>;
}

async function stripeCustomersRetrieve(secret_key: string, id: string) {
  return stripeFetch<StripeCustomer>(`/customers/${encodeURIComponent(id)}`, {
    secret_key,
    method: 'GET',
  });
}

async function stripeCustomersSearch(secret_key: string, user_id: string, account_code: string) {
  const q = `metadata['user_id']:'${user_id}' AND metadata['account_code']:'${account_code}'`;
  const params = new URLSearchParams({ query: q, limit: '5' });
  return stripeFetch<{ data: StripeCustomer[] }>(`/customers/search?${params.toString()}`, {
    secret_key,
    method: 'GET',
  });
}

async function stripeCustomersListByEmail(secret_key: string, email: string) {
  const params = new URLSearchParams({ email, limit: '10' });
  return stripeFetch<{ data: StripeCustomer[] }>(`/customers?${params.toString()}`, {
    secret_key,
    method: 'GET',
  });
}

async function stripeCustomersCreate(
  secret_key: string,
  email: string,
  name: string | null | undefined,
  metadata: Record<string, string>,
) {
  const form: Array<[string, string]> = [['email', email]];
  if (name) form.push(['name', name]);
  for (const [k, v] of Object.entries(metadata)) form.push([`metadata[${k}]`, v]);
  return stripeFetch<StripeCustomer>('/customers', {
    secret_key,
    method: 'POST',
    formBody: form,
  });
}

async function stripeCustomersUpdate(
  secret_key: string,
  id: string,
  patch: { email?: string; name?: string | null; metadata?: Record<string, string> },
) {
  const form: Array<[string, string]> = [];
  if (patch.email !== undefined) form.push(['email', patch.email]);
  if (patch.name !== undefined && patch.name !== null) form.push(['name', patch.name]);
  if (patch.metadata) for (const [k, v] of Object.entries(patch.metadata)) form.push([`metadata[${k}]`, v]);
  return stripeFetch<StripeCustomer>(`/customers/${encodeURIComponent(id)}`, {
    secret_key,
    method: 'POST',
    formBody: form,
  });
}

/**
 * Ensure Stripe Customer for (user_id, account_code). Returns customer_id + source.
 * Caller must supply a valid Stripe secret_key for the same account_code.
 */
export async function resolveStripeCustomer(
  supabase: Supa,
  secret_key: string,
  input: ResolveStripeCustomerInput,
): Promise<ResolveStripeCustomerOutput> {
  const { user_id, account_code, email, name } = input;
  if (!user_id) throw new Error('resolve_stripe_customer_missing_user_id');
  if (!account_code) throw new Error('resolve_stripe_customer_missing_account_code');
  if (!email) throw new Error('resolve_stripe_customer_missing_email');

  // Load profile + cache
  const { data: prof } = await supabase
    .from('profiles')
    .select('id, meta')
    .eq('user_id', user_id)
    .maybeSingle();
  const cached = prof ? getCached(prof.meta, account_code) : null;

  // ── Step 1: profile_cache ────────────────────────────────────────────────
  if (cached?.customer_id) {
    const ret = await stripeCustomersRetrieve(secret_key, cached.customer_id);
    if (ret.ok && ret.data && !ret.data.deleted) {
      // Optional email/name sync (does NOT change customer_id)
      const c = ret.data;
      const needsEmail = email && c.email && c.email.toLowerCase() !== email.toLowerCase();
      const needsName = name && c.name !== name;
      if (needsEmail || needsName) {
        await stripeCustomersUpdate(secret_key, c.id, {
          email: needsEmail ? email : undefined,
          name: needsName ? (name ?? undefined) : undefined,
        });
        await audit(supabase, 'stripe_customer_profile_synced', {
          user_id, account_code, customer_id: c.id,
          changed: { email: !!needsEmail, name: !!needsName },
        });
      }
      await mergeStripeCustomerIntoProfile(supabase, user_id, account_code, {
        customer_id: c.id, source: 'profile_cache',
      });
      return { customer_id: c.id, source: 'profile_cache' };
    }
    // cache stale → fall through; do not delete cache automatically
  }

  // ── Step 2: stripe_search by metadata ────────────────────────────────────
  const search = await stripeCustomersSearch(secret_key, user_id, account_code);
  if (search.ok && search.data && Array.isArray(search.data.data) && search.data.data.length > 0) {
    const hit = search.data.data[0];
    // Mismatch guard
    if (cached?.customer_id && cached.customer_id !== hit.id) {
      await audit(supabase, 'stripe_customer_mismatch', {
        user_id, account_code,
        profile_customer_id: cached.customer_id,
        stripe_customer_id: hit.id,
        manual_review: true,
        reason: 'profile_cache_vs_stripe_search_diverged',
      });
      // Do NOT auto-rewrite. Return profile_cache id with mismatch flag.
      return {
        customer_id: cached.customer_id,
        source: 'profile_cache',
        mismatch: { profile_customer_id: cached.customer_id, stripe_customer_id: hit.id },
      };
    }
    // No cache or matches → adopt
    if (email && hit.email && hit.email.toLowerCase() !== email.toLowerCase()) {
      await stripeCustomersUpdate(secret_key, hit.id, { email });
    }
    if (name && hit.name !== name) {
      await stripeCustomersUpdate(secret_key, hit.id, { name });
    }
    await mergeStripeCustomerIntoProfile(supabase, user_id, account_code, {
      customer_id: hit.id, source: 'stripe_search',
    });
    return { customer_id: hit.id, source: 'stripe_search' };
  }

  // ── Step 3: email_fallback ───────────────────────────────────────────────
  const byEmail = await stripeCustomersListByEmail(secret_key, email);
  if (byEmail.ok && byEmail.data && Array.isArray(byEmail.data.data) && byEmail.data.data.length > 0) {
    const candidates = byEmail.data.data;

    // Amendment 5: > 1 results without our metadata → ambiguous, do not adopt.
    if (candidates.length > 1) {
      await audit(supabase, 'stripe_customer_email_ambiguous', {
        user_id, account_code, email_masked: maskEmail(email),
        count: candidates.length,
        candidate_ids: candidates.map((c) => c.id),
      });
      // fall through to create
    } else {
      const c = candidates[0];
      const otherUid = c.metadata?.user_id;
      if (otherUid && otherUid !== user_id) {
        // Email collision with foreign user_id → do not use.
        await audit(supabase, 'stripe_customer_email_collision', {
          user_id, account_code, email_masked: maskEmail(email),
          foreign_user_id: otherUid, customer_id: c.id,
        });
        // fall through to create
      } else {
        // Adopt + backfill metadata
        await stripeCustomersUpdate(secret_key, c.id, {
          metadata: {
            user_id,
            account_code,
            ...(c.metadata ?? {}),
            user_id_override: user_id, // explicit
          },
        });
        // Re-issue with canonical metadata (last write wins on Stripe side)
        await stripeCustomersUpdate(secret_key, c.id, {
          metadata: { user_id, account_code },
        });
        await audit(supabase, 'stripe_customer_email_fallback_used', {
          user_id, account_code, customer_id: c.id, email_masked: maskEmail(email),
        });
        await mergeStripeCustomerIntoProfile(supabase, user_id, account_code, {
          customer_id: c.id, source: 'email_fallback',
        });
        return { customer_id: c.id, source: 'email_fallback' };
      }
    }
  }

  // ── Step 4: create ───────────────────────────────────────────────────────
  const created = await stripeCustomersCreate(secret_key, email, name ?? null, {
    user_id,
    account_code,
  });
  if (!created.ok || !created.data) {
    throw new Error(`stripe_customer_create_failed:${created.error?.message ?? created.status}`);
  }
  const newId = created.data.id;
  await mergeStripeCustomerIntoProfile(supabase, user_id, account_code, {
    customer_id: newId, source: 'created',
  });
  await audit(supabase, 'stripe_customer_created', {
    user_id, account_code, customer_id: newId,
  });
  return { customer_id: newId, source: 'created' };
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '[masked]';
  const head = local.slice(0, Math.min(4, local.length));
  return `${head}***@${domain}`;
}
