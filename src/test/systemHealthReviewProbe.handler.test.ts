import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as renewals from '../../supabase/functions/system-health-full-check/renewal-check';
import * as policy from '../../supabase/functions/_shared/payment-health-policy';
import { authorizeSystemHealth } from '../../supabase/functions/system-health-full-check/authorization';

const compiled = ts.transpileModule(readFileSync('supabase/functions/system-health-full-check/index.ts', 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const future = '2026-11-13T09:12:37Z';

async function diagnose(flag?: boolean | string) {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-20T00:00:00Z'));
  const reads: string[] = [];
  const getCredentials = vi.fn(async () => ({ shop_id: 'fixture', secret_key: 'fixture' }));
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: 'sbs_fixture', state: 'active', renew_at: future })));
  vi.stubGlobal('fetch', fetcher);
  const db = { from(table: string) {
    reads.push(table);
    if (!['provider_subscriptions', 'subscriptions_v2'].includes(table)) throw new Error('Unexpected business write or report');
    const q: any = {};
    for (const key of ['select', 'eq', 'or', 'order']) q[key] = () => q;
    q.range = async () => ({ data: [{ id: 'fixture-provider', provider_subscription_id: 'sbs_fixture',
      subscription_v2_id: 'fixture-sub', state: 'active', next_charge_at: future,
      billing_review_required: flag }], error: null });
    q.in = async () => ({ data: [{ id: 'fixture-sub', status: 'active', auto_renew: false }], error: null });
    return q;
  } };
  let handler!: (req: Request) => Promise<Response>;
  runInNewContext(compiled, { exports: {}, Request, Response, Date, console: { log() {}, warn() {}, error() {} },
    Deno: { env: { get: (key: string) => ({ SUPABASE_URL: 'https://fixture.test', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service' })[key] },
      serve: (callback: typeof handler) => { handler = callback; } },
    require(path: string) {
      if (path.includes('@supabase/supabase-js')) return { createClient: () => db };
      if (path.endsWith('/cors.ts')) return { corsHeaders: {} };
      if (path.endsWith('/payment-health-policy.ts')) return policy;
      if (path.endsWith('/bepaid-credentials.ts')) return { getBepaidCredsStrict: getCredentials, isBepaidCredsError: () => false, createBepaidAuthHeader: () => 'Basic fixture' };
      if (path.endsWith('/caller-user.ts')) return { getCallerUserId: async () => { throw new Error('Service call must not impersonate staff'); } };
      if (path === './authorization.ts') return { authorizeSystemHealth };
      if (path === './renewal-check.ts') return renewals;
      throw new Error(`Unexpected dependency ${path}`);
    } });
  const response = await handler(new Request('https://fixture.test', { method: 'POST', headers: { apikey: 'fixture-service' },
    body: JSON.stringify({ action: 'diagnose_renewals' }) }));
  return { status: response.status, result: await response.json(), getCredentials, fetcher, reads };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('actual system health handler with a future billing review', () => {
  it.each([true, 'true'])('obtains provider authorization and fresh evidence for review flag %s without an overdue row', async flag => {
    const h = await diagnose(flag);
    expect(h.status).toBe(200); expect(h.result).toMatchObject({ read_only: true, sent: false,
      invariant: { count: 0, review: { count: 1, passed: false } } });
    expect(h.getCredentials).toHaveBeenCalledTimes(1); expect(h.fetcher).toHaveBeenCalledTimes(1);
    expect(h.reads).toEqual(['provider_subscriptions', 'subscriptions_v2']);
  });
  it('does not obtain credentials or call the provider for an unflagged future snapshot', async () => {
    const h = await diagnose();
    expect(h.result.invariant).toMatchObject({ count: 0, review: { count: 0 } });
    expect(h.getCredentials).not.toHaveBeenCalled(); expect(h.fetcher).not.toHaveBeenCalled();
  });
});
