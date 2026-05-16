// PATCH H2.1c-i — Static-contract tests for legacy one-time access-write retirement.
//
// The legacy zone 2 (orders table + orderStatus==='completed') used to perform
// direct access writes (subscriptions_v2 / entitlements / legacy subscriptions
// / telegram-grant-access). After H2.1c-i it MUST only:
//   - write an audit log `bepaid.webhook.legacy_one_time_retired_manual_review`
//   - return HTTP 200 with body { ok:true, status:'manual_review', reason:'legacy_one_time_path_retired' }
//
// Source: .lovable/proofs/patch_h2_1c_i_legacy_retirement_2026_05.md
//         .lovable/proofs/patch_h2_1c_legacy_one_time_analysis_2026_05.md

import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';

const SOURCE_PATH = new URL('./index.ts', import.meta.url);
const SOURCE = await Deno.readTextFile(SOURCE_PATH);
const LINES = SOURCE.split('\n');

const ZONE2_START_MARKER = '// PATCH H2.1c-i: legacy one-time access-write path RETIRED';
const ZONE2_RETIRE_BRANCH = "if (orderStatus === 'completed' && order.user_id) {";
const ZONE2_END_HINT = "// Handle failed payment notification";

function findLine(needle: string, from = 0): number {
  for (let i = from; i < LINES.length; i++) {
    if (LINES[i].includes(needle)) return i;
  }
  return -1;
}

function sliceLines(start: number, end: number): string {
  return LINES.slice(start, end).join('\n');
}

Deno.test('H2.1c-i: retirement marker exists in zone 2', () => {
  const i = findLine(ZONE2_START_MARKER);
  assert(i > 0, 'PATCH H2.1c-i retirement marker missing in bepaid-webhook/index.ts');
});

Deno.test('H2.1c-i: zone 2 completed-branch has 0 access writes (subscriptions_v2)', () => {
  const start = findLine(ZONE2_START_MARKER);
  const retireBranch = findLine(ZONE2_RETIRE_BRANCH, start);
  const end = findLine(ZONE2_END_HINT, retireBranch);
  assert(start > 0 && retireBranch > start && end > retireBranch, 'zone 2 markers not found in order');
  const zone = sliceLines(start, end);
  assertEquals(
    /\.from\(['"]subscriptions_v2['"]\)\s*\.\s*(insert|update|upsert)/.test(zone),
    false,
    'zone 2 still contains subscriptions_v2 insert/update/upsert',
  );
});

Deno.test('H2.1c-i: zone 2 completed-branch has 0 entitlements writes', () => {
  const start = findLine(ZONE2_START_MARKER);
  const end = findLine(ZONE2_END_HINT, start);
  const zone = sliceLines(start, end);
  assertEquals(
    /\.from\(['"]entitlements['"]\)\s*\.\s*(insert|update|upsert)/.test(zone),
    false,
    'zone 2 still contains entitlements insert/update/upsert',
  );
});

Deno.test('H2.1c-i: zone 2 completed-branch has 0 entitlement_orders writes', () => {
  const start = findLine(ZONE2_START_MARKER);
  const end = findLine(ZONE2_END_HINT, start);
  const zone = sliceLines(start, end);
  assertEquals(
    /\.from\(['"]entitlement_orders['"]\)\s*\.\s*(insert|update|upsert)/.test(zone),
    false,
    'zone 2 still contains entitlement_orders writes',
  );
});

Deno.test('H2.1c-i: zone 2 completed-branch has 0 legacy subscriptions v1 updates', () => {
  const start = findLine(ZONE2_START_MARKER);
  const end = findLine(ZONE2_END_HINT, start);
  const zone = sliceLines(start, end);
  assertEquals(
    /\.from\(['"]subscriptions['"]\)\s*\.\s*update/.test(zone),
    false,
    'zone 2 still contains legacy subscriptions (v1) updates',
  );
});

Deno.test('H2.1c-i: zone 2 completed-branch has 0 telegram-grant-access invocations', () => {
  const start = findLine(ZONE2_START_MARKER);
  const end = findLine(ZONE2_END_HINT, start);
  const zone = sliceLines(start, end);
  assertEquals(
    /functions\.invoke\(\s*['"]telegram-grant-access['"]/.test(zone),
    false,
    'zone 2 still invokes telegram-grant-access',
  );
});

Deno.test('H2.1c-i: zone 2 retire-branch writes audit action and returns manual_review HTTP 200', () => {
  const start = findLine(ZONE2_START_MARKER);
  const end = findLine(ZONE2_END_HINT, start);
  const zone = sliceLines(start, end);
  assertStringIncludes(zone, 'bepaid.webhook.legacy_one_time_retired_manual_review');
  assertStringIncludes(zone, "status: 'manual_review'");
  assertStringIncludes(zone, "reason: 'legacy_one_time_path_retired'");
  assertStringIncludes(zone, 'status: 200');
});

Deno.test('H2.1c-i: canonical link_order branch (3DS finalize + WEBHOOK-LINK-ORDER) untouched', () => {
  // 3DS finalize delegation marker from H2.1b-ii
  assert(SOURCE.includes("context: '3ds_finalize'"), '3DS finalize delegation marker missing');
  assert(SOURCE.includes("grant-access-for-order"), 'canonical grant-access-for-order invocation missing');
});

Deno.test('H2.1c-i: zone 1 (materialization-only) still writes payments_v2 and does NOT write access', () => {
  // Zone 1 markers come from PATCH P-LEGACY-BEPAID.1
  const z1Start = findLine('PATCH P-LEGACY-BEPAID.1');
  const z1End = findLine('END PATCH P-LEGACY-BEPAID.1', z1Start);
  assert(z1Start > 0 && z1End > z1Start, 'zone 1 markers not found');
  const zone1 = sliceLines(z1Start, z1End);
  assertStringIncludes(zone1, "payments_v2");
  assertEquals(
    /\.from\(['"]subscriptions_v2['"]\)\s*\.\s*(insert|update|upsert)/.test(zone1),
    false,
    'zone 1 must not write subscriptions_v2',
  );
  assertEquals(
    /\.from\(['"]entitlements['"]\)\s*\.\s*(insert|update|upsert)/.test(zone1),
    false,
    'zone 1 must not write entitlements',
  );
  assertEquals(
    /functions\.invoke\(\s*['"]telegram-grant-access['"]/.test(zone1),
    false,
    'zone 1 must not invoke telegram-grant-access',
  );
});

Deno.test('H2.1c-i: failed-payment branch (resend email) still present and untouched', () => {
  const i = findLine(ZONE2_END_HINT);
  assert(i > 0, 'failed payment notification branch missing');
  const region = sliceLines(i, i + 40);
  assertStringIncludes(region, "orderStatus === 'failed'");
});
