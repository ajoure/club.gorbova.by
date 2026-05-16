// PATCH H2.1 — Contract tests for canonical-writer enforcement in WEBHOOK-SUBSCRIPTION
// These are pure unit-tests over the decision matrix (no Supabase wiring).
// They lock in the contract: webhook never writes access fields when the
// canonical writer skip/errors, and only does provider-sync of non-access fields.

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

type GrantOutcome = 'ok' | 'skip' | 'error';

// Mirrors the decision in index.ts STEP A
function classifyGrantOutcome(args: {
  ok: boolean;
  body: any;
}): GrantOutcome {
  const { ok, body } = args;
  if (ok && body && body.success !== false) return 'ok';
  if (
    ok &&
    (body?.skipped === true ||
      body?.status === 'skipped' ||
      String(body?.reason || '').startsWith('skip_') ||
      String(body?.reason || '') === 'sbs_mismatch' ||
      String(body?.reason || '') === 'manual_review')
  ) {
    return 'skip';
  }
  return 'error';
}

// What webhook is allowed to write to subscriptions_v2 in provider-sync STEP C.
// Access fields (access_start_at/access_end_at/status) MUST NOT appear here.
const ALLOWED_PROVIDER_SYNC_FIELDS = new Set([
  'billing_type',
  'next_charge_at',
  'auto_renew',
  'meta',
  'updated_at',
]);

const FORBIDDEN_ACCESS_FIELDS = new Set([
  'access_start_at',
  'access_end_at',
  'status', // owned by canonical writer
]);

function providerSyncUpdate(args: {
  renewAtIso: string;
  finite: boolean;
  bepaidSubscriptionId: string;
  nowIso: string;
  baseMeta: Record<string, any>;
  installmentCount: number;
}) {
  const { renewAtIso, finite, bepaidSubscriptionId, nowIso, baseMeta, installmentCount } = args;
  return {
    billing_type: 'provider_managed',
    next_charge_at: finite ? null : renewAtIso,
    auto_renew: !finite,
    meta: {
      ...baseMeta,
      bepaid_subscription_id: bepaidSubscriptionId,
      bepaid_activated_at: nowIso,
      ...(finite
        ? {
            model: 'bepaid_finite_subscription',
            billing_cycles: Number(baseMeta.billing_cycles ?? installmentCount),
            installment_count: installmentCount,
          }
        : {}),
    },
    updated_at: nowIso,
  };
}

Deno.test('grant outcome OK on success body', () => {
  assertEquals(classifyGrantOutcome({ ok: true, body: { success: true } }), 'ok');
  assertEquals(classifyGrantOutcome({ ok: true, body: { granted: true } }), 'ok');
});

Deno.test('grant outcome SKIP on skipped/sbs_mismatch/manual_review', () => {
  assertEquals(classifyGrantOutcome({ ok: true, body: { skipped: true } }), 'skip');
  assertEquals(classifyGrantOutcome({ ok: true, body: { status: 'skipped' } }), 'skip');
  assertEquals(classifyGrantOutcome({ ok: true, body: { reason: 'skip_already_fulfilled' } }), 'skip');
  assertEquals(classifyGrantOutcome({ ok: true, body: { reason: 'sbs_mismatch' } }), 'skip');
  assertEquals(classifyGrantOutcome({ ok: true, body: { reason: 'manual_review' } }), 'skip');
});

Deno.test('grant outcome ERROR on non-200 or success:false', () => {
  assertEquals(classifyGrantOutcome({ ok: false, body: { error: 'x' } }), 'error');
  assertEquals(classifyGrantOutcome({ ok: true, body: { success: false } }), 'error');
  assertEquals(classifyGrantOutcome({ ok: true, body: null }), 'error');
});

Deno.test('provider-sync update has NO access fields', () => {
  const upd = providerSyncUpdate({
    renewAtIso: '2026-06-24T12:00:00.000Z',
    finite: false,
    bepaidSubscriptionId: 'sbs_test',
    nowIso: '2026-05-24T12:00:00.000Z',
    baseMeta: {},
    installmentCount: 0,
  });
  const keys = new Set(Object.keys(upd));
  for (const f of FORBIDDEN_ACCESS_FIELDS) {
    assertEquals(keys.has(f), false, `provider-sync must NOT contain ${f}`);
  }
  for (const k of keys) {
    assertEquals(ALLOWED_PROVIDER_SYNC_FIELDS.has(k), true, `unexpected key in provider-sync: ${k}`);
  }
});

Deno.test('finite installment: auto_renew=false and next_charge_at=null', () => {
  const upd = providerSyncUpdate({
    renewAtIso: '2026-06-24T12:00:00.000Z',
    finite: true,
    bepaidSubscriptionId: 'sbs_inst',
    nowIso: '2026-05-24T12:00:00.000Z',
    baseMeta: { installment_count: 3 },
    installmentCount: 3,
  });
  assertEquals(upd.auto_renew, false);
  assertEquals(upd.next_charge_at, null);
  assertEquals((upd.meta as any).model, 'bepaid_finite_subscription');
  assertEquals((upd.meta as any).installment_count, 3);
});

Deno.test('recurring (non-finite): auto_renew=true and next_charge_at=renewAt', () => {
  const upd = providerSyncUpdate({
    renewAtIso: '2026-06-24T12:00:00.000Z',
    finite: false,
    bepaidSubscriptionId: 'sbs_rec',
    nowIso: '2026-05-24T12:00:00.000Z',
    baseMeta: {},
    installmentCount: 0,
  });
  assertEquals(upd.auto_renew, true);
  assertEquals(upd.next_charge_at, '2026-06-24T12:00:00.000Z');
});

Deno.test('contract: webhook never owns subscription status in provider-sync', () => {
  const upd = providerSyncUpdate({
    renewAtIso: '2026-06-24T12:00:00.000Z',
    finite: false,
    bepaidSubscriptionId: 'sbs_x',
    nowIso: '2026-05-24T12:00:00.000Z',
    baseMeta: {},
    installmentCount: 0,
  });
  assertEquals('status' in upd, false, 'subscriptions_v2.status is owned by grant-access-for-order');
});
