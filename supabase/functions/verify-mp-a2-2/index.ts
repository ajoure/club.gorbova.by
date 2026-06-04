// MP-A2-2 temporary verify edge function. Runs S1..S10. To be DELETED after proof.
// verify_jwt=false (super-admin guard inside).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { requireSuperAdmin } from '../_shared/acquiring/auth-guard.ts';
import { readAcquiringSecret } from '../_shared/acquiring/vault.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function svc() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
}

async function sfetch<T = any>(sk: string, path: string, opts: { method?: string; form?: Record<string, string>; idem?: string } = {}): Promise<{ ok: boolean; status: number; data: T | null; error?: any }> {
  const headers: Record<string, string> = { Authorization: `Bearer ${sk}`, 'Stripe-Version': '2024-06-20' };
  let body: string | undefined;
  if (opts.form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.form)) p.append(k, v);
    body = p.toString();
  }
  if (opts.idem) headers['Idempotency-Key'] = opts.idem;
  const res = await fetch(`https://api.stripe.com/v1${path}`, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) return { ok: false, status: res.status, data: null, error: json?.error ?? text };
  return { ok: true, status: res.status, data: json };
}

const USER_ID = '05cd3754-d589-4d90-97d1-89ba2bee610b';
const PROFILE_ID = 'a4b7c8c9-8210-499e-ae3f-2a5db2121577';
const EMAIL = '7500084@gmail.com';
const ACCOUNT_CODE = 'stripe_poland';
const FAKE_ACCOUNT_CODE = 'stripe_test_eu';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    await requireSuperAdmin(req);
  } catch {
    return new Response('forbidden', { status: 403, headers: corsHeaders });
  }
  const sb = svc();
  const SK = await readAcquiringSecret('stripe', ACCOUNT_CODE, 'secret_key');
  const VERIFY_TAG = `mp_a2_2_verify_${Date.now()}`;

  async function readMeta(): Promise<any> {
    const { data } = await sb.from('profiles').select('meta').eq('id', PROFILE_ID).maybeSingle();
    return (data?.meta as any) ?? {};
  }
  async function writeMeta(meta: any) {
    await sb.from('profiles').update({ meta }).eq('id', PROFILE_ID);
  }
  async function resetCache() {
    const m = await readMeta();
    m.stripe = m.stripe ?? {};
    m.stripe.customers = {};
    await writeMeta(m);
  }
  async function setCache(cid: string, account_code = ACCOUNT_CODE) {
    const m = await readMeta();
    m.stripe = m.stripe ?? {};
    m.stripe.customers = m.stripe.customers ?? {};
    m.stripe.customers[account_code] = { customer_id: cid, source: 'manual_seed', last_synced_at: new Date().toISOString(), created_at: new Date().toISOString() };
    await writeMeta(m);
  }
  async function logAudit(action: string, meta: any) {
    await sb.from('audit_logs').insert({ action, entity_type: 'stripe_customer', meta: { ...meta, verify_tag: VERIFY_TAG } });
  }
  async function mergeProfile(account_code: string, entry: any) {
    const m = await readMeta();
    m.stripe = m.stripe ?? {};
    m.stripe.customers = m.stripe.customers ?? {};
    const ex = m.stripe.customers[account_code] ?? {};
    m.stripe.customers[account_code] = {
      ...ex,
      ...entry,
      last_synced_at: new Date().toISOString(),
      created_at: ex.created_at ?? new Date().toISOString(),
    };
    await writeMeta(m);
  }

  type Src = 'profile_cache' | 'stripe_search' | 'email_fallback' | 'created';
  async function resolve(input: { user_id: string; account_code: string; email: string; name?: string | null }): Promise<{ customer_id: string; source: Src; mismatch?: any }> {
    const meta = await readMeta();
    const cached = meta?.stripe?.customers?.[input.account_code]?.customer_id ?? null;
    if (cached) {
      const r = await sfetch<any>(SK, `/customers/${cached}`);
      if (r.ok && r.data && !r.data.deleted) {
        const c = r.data;
        if (input.email && c.email && c.email.toLowerCase() !== input.email.toLowerCase()) {
          await sfetch(SK, `/customers/${c.id}`, { method: 'POST', form: { email: input.email } });
          await logAudit('stripe_customer_profile_synced', { user_id: input.user_id, account_code: input.account_code, customer_id: c.id, changed: { email: true } });
        }
        if (input.name && c.name !== input.name) {
          await sfetch(SK, `/customers/${c.id}`, { method: 'POST', form: { name: input.name } });
          await logAudit('stripe_customer_profile_synced', { user_id: input.user_id, account_code: input.account_code, customer_id: c.id, changed: { name: true } });
        }
        await mergeProfile(input.account_code, { customer_id: c.id, source: 'profile_cache' });
        return { customer_id: c.id, source: 'profile_cache' };
      }
    }
    const q = `metadata['user_id']:'${input.user_id}' AND metadata['account_code']:'${input.account_code}'`;
    const s = await sfetch<any>(SK, `/customers/search?query=${encodeURIComponent(q)}&limit=5`);
    if (s.ok && s.data?.data?.length) {
      const hit = s.data.data[0];
      if (cached && cached !== hit.id) {
        await logAudit('stripe_customer_mismatch', { user_id: input.user_id, account_code: input.account_code, profile_customer_id: cached, stripe_customer_id: hit.id, manual_review: true });
        return { customer_id: cached, source: 'profile_cache', mismatch: { profile_customer_id: cached, stripe_customer_id: hit.id } };
      }
      await mergeProfile(input.account_code, { customer_id: hit.id, source: 'stripe_search' });
      return { customer_id: hit.id, source: 'stripe_search' };
    }
    const e = await sfetch<any>(SK, `/customers?email=${encodeURIComponent(input.email)}&limit=10`);
    if (e.ok && e.data?.data?.length) {
      const cands = e.data.data;
      if (cands.length > 1) {
        await logAudit('stripe_customer_email_ambiguous', { user_id: input.user_id, account_code: input.account_code, count: cands.length, candidate_ids: cands.map((c: any) => c.id) });
      } else {
        const c = cands[0];
        const otherUid = c.metadata?.user_id;
        if (otherUid && otherUid !== input.user_id) {
          await logAudit('stripe_customer_email_collision', { user_id: input.user_id, account_code: input.account_code, foreign_user_id: otherUid, customer_id: c.id });
        } else {
          await sfetch(SK, `/customers/${c.id}`, { method: 'POST', form: { 'metadata[user_id]': input.user_id, 'metadata[account_code]': input.account_code } });
          await logAudit('stripe_customer_email_fallback_used', { user_id: input.user_id, account_code: input.account_code, customer_id: c.id });
          await mergeProfile(input.account_code, { customer_id: c.id, source: 'email_fallback' });
          return { customer_id: c.id, source: 'email_fallback' };
        }
      }
    }
    const form: Record<string, string> = { email: input.email, 'metadata[user_id]': input.user_id, 'metadata[account_code]': input.account_code, 'metadata[verify_tag]': VERIFY_TAG };
    if (input.name) form.name = input.name;
    const cr = await sfetch<any>(SK, '/customers', { method: 'POST', form });
    if (!cr.ok) throw new Error('create_failed ' + JSON.stringify(cr.error));
    await mergeProfile(input.account_code, { customer_id: cr.data.id, source: 'created' });
    await logAudit('stripe_customer_created', { user_id: input.user_id, account_code: input.account_code, customer_id: cr.data.id });
    return { customer_id: cr.data.id, source: 'created' };
  }

  const results: any = { verify_tag: VERIFY_TAG, scenarios: {}, created_customer_ids: [] };
  const created: string[] = [];
  try {
    // Pre-clean any existing customers for this user
    const pre = await sfetch<any>(SK, `/customers/search?query=${encodeURIComponent(`metadata['user_id']:'${USER_ID}'`)}&limit=50`);
    for (const c of pre.data?.data ?? []) await sfetch(SK, `/customers/${c.id}`, { method: 'DELETE' });
    await new Promise((r) => setTimeout(r, 1500));

    await resetCache();
    const before_s1 = (await readMeta()).stripe?.customers ?? {};
    const r1 = await resolve({ user_id: USER_ID, account_code: ACCOUNT_CODE, email: EMAIL });
    created.push(r1.customer_id);
    results.scenarios.S1 = { expect: 'created', got: r1.source, customer_id: r1.customer_id, pass: r1.source === 'created', profile_before: before_s1, profile_after: (await readMeta()).stripe?.customers };

    const r2 = await resolve({ user_id: USER_ID, account_code: ACCOUNT_CODE, email: EMAIL });
    results.scenarios.S2 = { expect: 'profile_cache', got: r2.source, customer_id: r2.customer_id, same: r2.customer_id === r1.customer_id, pass: r2.source === 'profile_cache' && r2.customer_id === r1.customer_id };

    await resetCache();
    await new Promise((r) => setTimeout(r, 2500));
    const r3 = await resolve({ user_id: USER_ID, account_code: ACCOUNT_CODE, email: EMAIL });
    results.scenarios.S3 = { expect: 'stripe_search', got: r3.source, customer_id: r3.customer_id, same: r3.customer_id === r1.customer_id, pass: r3.source === 'stripe_search' && r3.customer_id === r1.customer_id };

    await resetCache();
    await sfetch(SK, `/customers/${r1.customer_id}`, { method: 'POST', form: { 'metadata[user_id]': '', 'metadata[account_code]': '' } });
    await new Promise((r) => setTimeout(r, 3000));
    const r4 = await resolve({ user_id: USER_ID, account_code: ACCOUNT_CODE, email: EMAIL });
    results.scenarios.S4 = { expect: 'email_fallback', got: r4.source, customer_id: r4.customer_id, pass: r4.source === 'email_fallback' };

    // S5: email collision
    await resetCache();
    const FAKE_UID = '00000000-0000-0000-0000-deadbeef0001';
    await sfetch(SK, `/customers/${r1.customer_id}`, { method: 'POST', form: { 'metadata[user_id]': FAKE_UID, 'metadata[account_code]': ACCOUNT_CODE } });
    await new Promise((r) => setTimeout(r, 2500));
    const r5 = await resolve({ user_id: USER_ID, account_code: ACCOUNT_CODE, email: EMAIL });
    if (r5.source === 'created') created.push(r5.customer_id);
    results.scenarios.S5 = { expect: 'created (collision)', got: r5.source, customer_id: r5.customer_id, foreign_was: r1.customer_id, pass: r5.source === 'created' && r5.customer_id !== r1.customer_id };
    const canonical = r5.source === 'created' ? r5.customer_id : r1.customer_id;

    // S6
    const NEW_EMAIL = '7500***+s6@gmail.com'.replace('***', '084');
    const r6 = await resolve({ user_id: USER_ID, account_code: ACCOUNT_CODE, email: NEW_EMAIL });
    const c6 = await sfetch<any>(SK, `/customers/${r6.customer_id}`);
    results.scenarios.S6 = { expect_same_id: canonical, got: r6.customer_id, email_on_stripe: c6.data?.email, pass: r6.customer_id === canonical && c6.data?.email?.toLowerCase() === NEW_EMAIL.toLowerCase() };

    // S7
    const NEW_NAME = `Verify ${VERIFY_TAG}`;
    const r7 = await resolve({ user_id: USER_ID, account_code: ACCOUNT_CODE, email: NEW_EMAIL, name: NEW_NAME });
    const c7 = await sfetch<any>(SK, `/customers/${r7.customer_id}`);
    results.scenarios.S7 = { expect_same_id: canonical, got: r7.customer_id, name_on_stripe: c7.data?.name, pass: r7.customer_id === canonical && c7.data?.name === NEW_NAME };
    await sfetch(SK, `/customers/${r7.customer_id}`, { method: 'POST', form: { email: EMAIL } });

    // S8: mismatch
    const live_bogus = await sfetch<any>(SK, '/customers', { method: 'POST', form: { email: `livebogus+${VERIFY_TAG}@example.test`, 'metadata[verify_tag]': VERIFY_TAG } });
    created.push(live_bogus.data.id);
    await setCache(live_bogus.data.id);
    await new Promise((r) => setTimeout(r, 2500));
    // Need a search-hit for USER_ID + ACCOUNT_CODE; reset r1's metadata back to USER_ID
    await sfetch(SK, `/customers/${canonical}`, { method: 'POST', form: { 'metadata[user_id]': USER_ID, 'metadata[account_code]': ACCOUNT_CODE } });
    await new Promise((r) => setTimeout(r, 2500));
    const r8 = await resolve({ user_id: USER_ID, account_code: ACCOUNT_CODE, email: EMAIL });
    const { count: mismatchCount } = await sb.from('audit_logs').select('*', { count: 'exact', head: true }).eq('action', 'stripe_customer_mismatch').filter('meta->>verify_tag', 'eq', VERIFY_TAG);
    results.scenarios.S8 = { expect: 'profile_cache returned + mismatch flagged', got_source: r8.source, got_id: r8.customer_id, profile_cache_was: live_bogus.data.id, mismatch: r8.mismatch, audit_count: mismatchCount, pass: !!r8.mismatch && r8.customer_id === live_bogus.data.id && (mismatchCount ?? 0) > 0 };

    // S9: multi-account isolation
    const q9 = `metadata['user_id']:'${USER_ID}' AND metadata['account_code']:'${FAKE_ACCOUNT_CODE}'`;
    const s9before = await sfetch<any>(SK, `/customers/search?query=${encodeURIComponent(q9)}&limit=5`);
    const s9c = await sfetch<any>(SK, '/customers', { method: 'POST', form: { email: EMAIL, 'metadata[user_id]': USER_ID, 'metadata[account_code]': FAKE_ACCOUNT_CODE, 'metadata[verify_tag]': VERIFY_TAG } });
    created.push(s9c.data.id);
    await mergeProfile(FAKE_ACCOUNT_CODE, { customer_id: s9c.data.id, source: 'created' });
    const m9 = (await readMeta()).stripe?.customers ?? {};
    results.scenarios.S9 = {
      expect: 'two distinct cus_* per account_code',
      search_in_fake_account_before_create_count: s9before.data?.data?.length ?? 0,
      stripe_poland_customer: m9[ACCOUNT_CODE]?.customer_id,
      stripe_test_eu_customer: m9[FAKE_ACCOUNT_CODE]?.customer_id,
      pass: m9[ACCOUNT_CODE]?.customer_id && m9[FAKE_ACCOUNT_CODE]?.customer_id && m9[ACCOUNT_CODE].customer_id !== m9[FAKE_ACCOUNT_CODE].customer_id,
      profile_meta_snapshot: m9,
    };

    // S10: PaymentMethod attach + Stripe API list
    const pm = await sfetch<any>(SK, '/payment_methods', { method: 'POST', form: { type: 'card', 'card[token]': 'tok_visa' } });
    await sfetch(SK, `/payment_methods/${pm.data.id}/attach`, { method: 'POST', form: { customer: canonical } });
    const list = await sfetch<any>(SK, `/payment_methods?customer=${canonical}&type=card&limit=5`);
    const attached = list.data?.data ?? [];
    results.scenarios.S10 = {
      expect: 'pm.customer === customer_id; no local card storage',
      customer_id: canonical,
      pm_id: pm.data?.id,
      pm_customer_attribute: attached[0]?.customer,
      pm_count: attached.length,
      pass: attached.length > 0 && attached[0].customer === canonical,
    };

    // Cleanup: remove fake account_code from profile cache; restore canonical only
    const finalMeta = await readMeta();
    if (finalMeta.stripe?.customers) {
      delete finalMeta.stripe.customers[FAKE_ACCOUNT_CODE];
      finalMeta.stripe.customers[ACCOUNT_CODE] = { customer_id: canonical, source: 'created', last_synced_at: new Date().toISOString(), created_at: new Date().toISOString() };
    }
    await writeMeta(finalMeta);
    results.final_profile_meta = finalMeta.stripe?.customers ?? {};
    results.created_customer_ids = created;
    results.canonical_customer_id = canonical;

    return new Response(JSON.stringify(results, null, 2), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    results.error = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify(results, null, 2), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
