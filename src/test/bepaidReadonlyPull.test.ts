import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { authorizePaymentsReconcile } from '../../supabase/functions/payments-reconcile/auth';
import { parseBepaidTrackingId } from '../../supabase/functions/_shared/bepaid-tracking-id';

const source = readFileSync('supabase/functions/bepaid-readonly-pull/index.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness(admin = false) {
  let handler!: (request: Request) => Promise<Response>;
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ transaction: {
    uid: 'tx-test', status: 'successful', type: 'payment', amount: 25000, currency: 'BYN',
    tracking_id: 'arbitrary-private-text', customer: { email: 'private@example.test' },
    credit_card: { token: 'private-card-token' },
  } }), { status: 200 }));
  const creds = vi.fn().mockResolvedValue({ shop_id: 'test-shop', secret_key: 'test-secret' });
  const getUser = vi.fn().mockResolvedValue({ data: { user: admin ? { id: 'test-user' } : null }, error: null });
  const rpc = vi.fn().mockImplementation(async (name: string) => ({
    data: name === 'payments_reconcile_cron_secret' ? 'test-diagnostic-secret' : admin,
    error: null,
  }));
  const client = { auth: { getUser }, rpc, from: () => { throw new Error('No database writes permitted'); } };
  runInNewContext(compiled, {
    exports: {}, Response, Request, Date, AbortSignal, fetch,
    Deno: { serve: (callback: typeof handler) => { handler = callback; }, env: { get: (key: string) => key === 'SUPABASE_URL' ? 'https://example.test' : 'test-service' } },
    require(path: string) {
      if (path.includes('@supabase/supabase-js')) return { createClient: () => client };
      if (path.includes('bepaid-credentials')) return { getBepaidCredsStrict: creds, isBepaidCredsError: () => false, createBepaidAuthHeader: () => 'Basic test-only' };
      if (path.includes('payments-reconcile/auth')) return { authorizePaymentsReconcile };
      if (path.includes('bepaid-tracking-id')) return { parseBepaidTrackingId };
      throw new Error(`Unexpected module ${path}`);
    },
  });
  const run = (body: unknown, headers: Record<string, string> = { apikey: 'test-service' }) => handler(new Request('https://example.test', { method: 'POST', headers, body: JSON.stringify(body) }));
  return { run, fetch, creds, getUser, rpc };
}

describe('bePaid managed read-only diagnostic channel', () => {
  it('allows the dedicated reconciliation secret without exporting a service key', async () => {
    const h = harness();
    const response = await h.run({ transaction_uids: ['tx-test'] }, { 'x-payments-reconcile-cron-secret': 'test-diagnostic-secret' });
    expect(response.status).toBe(200);
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith('payments_reconcile_cron_secret');
    expect(h.getUser).not.toHaveBeenCalled();
    expect(h.fetch).toHaveBeenCalledOnce();
  });
  it('rejects a wrong dedicated secret before reading payment credentials', async () => {
    const h = harness();
    expect((await h.run({ transaction_uids: ['tx-test'] }, { 'x-payments-reconcile-cron-secret': 'wrong' })).status).toBe(401);
    expect(h.creds).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it('uses exact service authentication and returns no raw personal/card data', async () => {
    const h = harness();
    const result = await (await h.run({ transaction_uids: ['tx-test'] })).json();
    expect(result.no_writes).toBe(true);
    expect(result.transactions[0]).toMatchObject({ uid: 'tx-test', status: 'successful', amount: 25000, currency: 'BYN' });
    expect(JSON.stringify(result)).not.toMatch(/private@example|private-card|arbitrary-private|test-secret/);
    expect(h.fetch).toHaveBeenCalledOnce();
    expect(h.fetch.mock.calls[0][1].method).toBe('GET');
    expect(h.getUser).not.toHaveBeenCalled();
  });
  it('keeps the existing verified admin route', async () => {
    const h = harness(true);
    expect((await h.run({ transaction_uids: ['tx-test'] }, { Authorization: 'Bearer test-admin' })).status).toBe(200);
    expect(h.getUser).toHaveBeenCalledWith('test-admin');
  });
  it.each([{}, { apikey: 'public-anon' }, { Authorization: 'Bearer non-admin' }])('rejects unauthorized requests before accessing bePaid', async headers => {
    const h = harness();
    expect((await h.run({ transaction_uids: ['tx-test'] }, headers)).status).toBe(401);
    expect(h.creds).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it.each([
    {}, { transaction_uids: ['../escape'] }, { subscription_ids: ['bad/path'] },
    { transaction_uids: Array.from({ length: 11 }, (_, i) => `tx-${i}`) },
    { subscription_ids: Array.from({ length: 51 }, (_, i) => `sbs_${i}`) },
  ])('bounds and validates the provider request set', async body => {
    const h = harness();
    expect((await h.run(body)).status).toBe(400);
    expect(h.creds).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it('has no DML, worker invocations or customer mutation methods', () => {
    expect(source).not.toMatch(/\.(insert|update|upsert|delete)\s*\(/);
    expect(source).not.toContain('functions.invoke');
    expect(source).not.toMatch(/method:\s*['"](?:POST|PUT|DELETE|PATCH)['"]/);
  });
});
