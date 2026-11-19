import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { isIsolatedZg27SandboxNotification } from '../../supabase/functions/bepaid-webhook/zg27-sandbox-notification';

const source = readFileSync('supabase/functions/bepaid-webhook/index.ts', 'utf8');
const start = source.indexOf('    // PATCH-1.7: STRICT - If signature not verified');
const end = source.indexOf('    // Authenticated historical receipt replay stops', start);
if (start < 0 || end < start) throw Error('Actual authentication/isolation boundary missing');
const boundary = source.slice(start, end);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function invoke(body: unknown, authenticated: boolean) {
  const writes: string[] = [];
  const db = { from(table: string) {
    if (!['provider_webhook_orphans', 'audit_logs'].includes(table)) throw Error(`Business write: ${table}`);
    return { upsert: async () => { writes.push(table); }, insert: async () => { writes.push(table); } };
  } };
  const downstream = vi.fn(async () => new Response('downstream', { status: 202 }));
  const execute = new AsyncFunction('body', 'signatureVerified', 'signatureSkipReason', 'rawTrackingIdEarly',
    'supabase', 'corsHeaders', 'createSafeOrphanData', 'isIsolatedZg27SandboxNotification', 'downstream', 'console',
    `${boundary}\nreturn downstream();`);
  const response = await execute(body, authenticated, 'invalid_signature', 'synthetic', db, {}, () => ({}),
    isIsolatedZg27SandboxNotification, downstream, { error: () => {} });
  return { response, writes, downstream };
}

describe('isolated ZG27 TEST notifications in the actual production webhook boundary', () => {
  const synthetic = { transaction: { test: true, tracking_id: 'zg27-sandbox:synthetic-run' } };
  it('acknowledges an authenticated isolated TEST before every business writer', async () => {
    const result = await invoke(synthetic, true);
    expect(result.response.status).toBe(200);
    expect(await result.response.json()).toEqual({ success: true, ignored: 'isolated_zg27_sandbox_test' });
    expect(result.writes).toEqual([]); expect(result.downstream).not.toHaveBeenCalled();
  });
  it('keeps signature rejection and its security audit before the TEST exemption', async () => {
    const result = await invoke(synthetic, false);
    expect(result.response.status).toBe(401);
    expect(result.writes).toEqual(['provider_webhook_orphans', 'audit_logs']);
    expect(result.downstream).not.toHaveBeenCalled();
  });
  const checkout = { test: true, token: 'synthetic-checkout-token', transaction_type: 'payment',
    order: { tracking_id: 'zg27-sandbox:hosted:synthetic-run' }, finished: false, expired: true, status: 'error' };
  it.each([checkout, { ...checkout, finished: true, expired: false, status: 'successful' }])
    ('isolates documented hosted Checkout events before every business writer', async body => {
      const result = await invoke(body, true);
      expect(result.response.status).toBe(200);
      expect(result.writes).toEqual([]); expect(result.downstream).not.toHaveBeenCalled();
    });
  it('retains signature rejection for hosted TEST Checkout events', async () => {
    const result = await invoke(checkout, false);
    expect(result.response.status).toBe(401);
    expect(result.writes).toEqual(['provider_webhook_orphans', 'audit_logs']);
    expect(result.downstream).not.toHaveBeenCalled();
  });
  it.each([
    { ...checkout, test: false }, { ...checkout, test: 'true' },
    { ...checkout, transaction_type: 'authorization' }, { ...checkout, token: '' },
    { ...checkout, token: 'x'.repeat(513) }, { ...checkout, order: [] },
    { ...checkout, order: { tracking_id: 'zg27-sandbox:other-run' } },
    { ...checkout, order: { tracking_id: 'zg27-sandbox:hosted:' } },
    { ...checkout, order: { tracking_id: `zg27-sandbox:hosted:${'x'.repeat(128)}` } },
    { ...checkout, transaction: { test: false, tracking_id: 'live-order' } },
  ])('keeps every other signed Checkout event in ordinary processing %#', async body => {
    const result = await invoke(body, true);
    expect(result.response.status).toBe(202); expect(result.downstream).toHaveBeenCalledOnce();
    expect(result.writes).toEqual([]);
  });
  it.each([
    { transaction: { test: false, tracking_id: 'zg27-sandbox:synthetic-run' } },
    { transaction: { test: 'true', tracking_id: 'zg27-sandbox:synthetic-run' } },
    { transaction: { test: true, tracking_id: 'link:owned-order' } },
    { transaction: { test: true, tracking_id: 'zg27-sandbox:' } },
    { transaction: { test: true, tracking_id: `zg27-sandbox:${'x'.repeat(128)}` } },
    { transaction: { tracking_id: 'zg27-sandbox:synthetic-run' } },
    {}, { transaction: [] }, null,
  ])('preserves ordinary processing for every other signed event %#', async body => {
    const result = await invoke(body, true);
    expect(result.response.status).toBe(202); expect(result.downstream).toHaveBeenCalledOnce();
    expect(result.writes).toEqual([]);
  });
});
