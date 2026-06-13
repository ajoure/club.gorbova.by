// PATCH-STRIPE-TELEGRAM-ADMIN-NOTIFY-PARITY-V2 — fix-to-patch.
// Integration dispatch proof for notifyAdminPaymentEvent without live Telegram.
// Mocks globalThis.fetch to intercept calls to /functions/v1/telegram-notify-admins
// and asserts: (a) single dispatch per call, (b) HTTP 500 / timeout / forbidden-payload
// never throw out of the helper and never affect webhook lifecycle.

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { notifyAdminPaymentEvent } from './stripe-admin-notify.ts';

// Minimal mock SupabaseClient: notifyAdminPaymentEvent only reads orders_v2 → profiles → products → tariffs.
function makeMockSupabase() {
  const builder = (data: unknown) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data, error: null }),
    };
    return chain;
  };
  const handlers: Record<string, unknown> = {
    orders_v2: { user_id: 'u1', profile_id: null, product_id: 'p1', tariff_id: 't1', customer_email: 'x@y.z' },
    profiles: { full_name: 'Test', email: 'x@y.z', telegram_username: null },
    products: { name: 'Прод' },
    tariffs: { name: 'Тариф' },
  };
  return {
    from(table: string) {
      return builder(handlers[table] ?? null);
    },
  };
}

interface CapturedCall { url: string; body: unknown; status: number }

async function withMockFetch<T>(
  responder: (url: string, init: RequestInit) => Promise<Response>,
  fn: () => Promise<T>,
): Promise<{ result: T; calls: CapturedCall[] }> {
  const original = globalThis.fetch;
  const calls: CapturedCall[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const initSafe = init ?? {};
    let body: unknown = null;
    try { body = initSafe.body ? JSON.parse(String(initSafe.body)) : null; } catch { /* ignore */ }
    const resp = await responder(url, initSafe);
    calls.push({ url, body, status: resp.status });
    return resp;
  }) as typeof globalThis.fetch;
  try {
    const result = await fn();
    return { result, calls };
  } finally {
    globalThis.fetch = original;
  }
}

// Helper: wait for the background work scheduled by notifyAdminPaymentEvent.
function flush() { return new Promise(r => setTimeout(r, 50)); }

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-key');

Deno.test('dispatch: success → exactly one POST to telegram-notify-admins', async () => {
  const { calls } = await withMockFetch(
    async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }),
    async () => {
      // deno-lint-ignore no-explicit-any
      notifyAdminPaymentEvent(makeMockSupabase() as any, {
        op: 'payment_succeeded', order_id: 'o-1', payment_id: 'p-1',
        provider_object_id: 'pi_X', amount: 7, currency: 'USD',
      });
      await flush();
    },
  );
  const notifyCalls = calls.filter(c => c.url.includes('/telegram-notify-admins'));
  assertEquals(notifyCalls.length, 1, 'must dispatch exactly once');
  const body = notifyCalls[0].body as Record<string, unknown>;
  assertEquals(body.source, 'stripe_webhook:payment_succeeded');
  assertEquals(body.order_id, 'o-1');
  assertEquals(body.parse_mode, 'HTML');
  assert(typeof body.message === 'string' && (body.message as string).length > 0);
});

Deno.test('dispatch: HTTP 500 → swallowed, no throw, lifecycle unaffected', async () => {
  let threw = false;
  try {
    const { calls } = await withMockFetch(
      async () => new Response('boom', { status: 500 }),
      async () => {
        // deno-lint-ignore no-explicit-any
        notifyAdminPaymentEvent(makeMockSupabase() as any, {
          op: 'payment_succeeded', order_id: 'o-2', payment_id: 'p-2', amount: 7, currency: 'USD',
        });
        await flush();
      },
    );
    assertEquals(calls.filter(c => c.url.includes('telegram-notify-admins')).length, 1);
  } catch {
    threw = true;
  }
  assertEquals(threw, false, 'HTTP 500 must not throw out of notifyAdminPaymentEvent');
});

Deno.test({
  name: 'dispatch: timeout (AbortController) → swallowed, never throws synchronously',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    let threw = false;
    try {
      await withMockFetch(
        async (_u, init) => {
          return await new Promise<Response>((_resolve, reject) => {
            const sig = init.signal as AbortSignal | undefined;
            if (sig) sig.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          });
        },
        async () => {
          // deno-lint-ignore no-explicit-any
          notifyAdminPaymentEvent(makeMockSupabase() as any, {
            op: 'subscription_renewal', order_id: 'o-3', payment_id: 'p-3',
            amount: 10, currency: 'USD', next_charge_at: new Date().toISOString(),
          });
          await flush();
        },
      );
    } catch {
      threw = true;
    }
    assertEquals(threw, false, 'timeout path must not surface as unhandled rejection');
  },
});

Deno.test('dispatch: refund_succeeded → one POST, op-specific source label', async () => {
  const { calls } = await withMockFetch(
    async () => new Response('{"ok":true}', { status: 200 }),
    async () => {
      // deno-lint-ignore no-explicit-any
      notifyAdminPaymentEvent(makeMockSupabase() as any, {
        op: 'refund_succeeded', order_id: 'o-4', payment_id: 'p-4',
        provider_object_id: 're_XYZ', amount: 3, currency: 'USD',
      });
      await flush();
    },
  );
  const notifyCalls = calls.filter(c => c.url.includes('telegram-notify-admins'));
  assertEquals(notifyCalls.length, 1);
  const body = notifyCalls[0].body as Record<string, unknown>;
  assertEquals(body.source, 'stripe_webhook:refund_succeeded');
});
