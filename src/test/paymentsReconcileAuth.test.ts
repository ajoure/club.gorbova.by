import { describe, expect, it, vi } from 'vitest';
import { authorizePaymentsReconcile } from '../../supabase/functions/_shared/payments-reconcile-auth';

describe('payments-reconcile authorization', () => {
  it.each([{}, { Authorization: 'Bearer public-anon' }, { Authorization: 'Bearer user-jwt' }])('rejects missing/public/user credentials without secret lookup', async headers => {
    const rpc = vi.fn();
    expect(await authorizePaymentsReconcile(new Request('https://example.test', { headers }), 'service-test', { rpc })).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('allows the exact service key without a Vault lookup', async () => {
    const rpc = vi.fn();
    expect(await authorizePaymentsReconcile(new Request('https://example.test', { headers: { apikey: 'service-test' } }), 'service-test', { rpc })).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('allows only the exact dedicated Vault-backed secret and fails closed', async () => {
    for (const [provided, expected, error, allowed] of [
      ['cron-test', 'cron-test', null, true], ['bad', 'cron-test', null, false],
      ['cron-test', null, null, false], ['cron-test', 'cron-test', { message: 'rpc failed' }, false],
    ] as const) {
      const rpc = vi.fn().mockResolvedValue({ data: expected, error });
      expect(await authorizePaymentsReconcile(new Request('https://example.test', { headers: { 'x-payments-reconcile-cron-secret': provided } }), 'service-test', { rpc })).toBe(allowed);
      expect(rpc).toHaveBeenCalledWith('payments_reconcile_cron_secret');
    }
  });
});
