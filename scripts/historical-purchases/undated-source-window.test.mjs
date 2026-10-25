import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

// Run the actual preview resolver; only its enclosing request/DB inputs are
// supplied here. This catches a guard placed after an early duration return.
const endpoint = readFileSync(new URL('../../supabase/functions/rules-retroapply/index.ts', import.meta.url), 'utf8');
const policy = readFileSync(new URL('../../supabase/functions/_shared/undated-subscription-window.ts', import.meta.url), 'utf8');
const bearing = new Function(`${stripTypeScriptTypes(policy.replace('export ', ''))};return isAccessBearingUndatedSubscription;`)();
const start = endpoint.indexOf('  const resolveWindow = (sub: any)');
const end = endpoint.indexOf('\n  if (rule.grant_target_type === "product_access")', start);
assert.ok(start > 0 && end > start);
const resolverText = stripTypeScriptTypes(endpoint.slice(start, end));
function resolver(override, ruleDays, tariffDays) {
  return new Function('isAccessBearingUndatedSubscription', 'durationDaysOverride', 'rule', 'tariffAccessDaysMap',
    `${resolverText};return resolveWindow;`)(bearing, override, { duration_days: ruleDays }, new Map([['business', tariffDays]]));
}
const source = { status: 'past_due', tariff_id: 'business', access_end_at: null, access_start_at: '2099-01-01T00:00:00Z' };
for (const [name, override, ruleDays, tariffDays] of [['override', 30, null, 30], ['rule', null, 30, 30], ['tariff', null, null, 30]]) {
  test(`unpaid undated checkout cannot fabricate a window through ${name}`, () => {
    assert.deepEqual(resolver(override, ruleDays, tariffDays)(source),
      { plannedIso: null, window_resolved_from: null, window_anchor_source: null });
  });
}
test('finite existing windows remain intact for past_due and legacy sources', () => {
  const end = '2099-02-01T00:00:00Z';
  assert.equal(resolver(null, null, 30)({ ...source, access_end_at: end }).plannedIso, end);
});
for (const status of ['active', 'trial']) {
  test(`open-ended ${status} keeps its existing anchored tariff window`, () => {
    assert.equal(resolver(null, null, 30)({ ...source, status }).plannedIso, '2099-01-31T00:00:00.000Z');
  });
}

test('fresh no_source_window classification cannot execute even with explicit selection and force', async () => {
  const neverStart = endpoint.indexOf('const NEVER_EXECUTE_CATEGORIES =');
  const neverEnd = endpoint.indexOf('\n\n// Stage 4:', neverStart);
  const never = new Function(`${stripTypeScriptTypes(endpoint.slice(neverStart, neverEnd))};return NEVER_EXECUTE_CATEGORIES;`)();
  const executeText = endpoint.slice(endpoint.indexOf('async function executeActions('));
  const execute = new Function('NEVER_EXECUTE_CATEGORIES', 'EXTRA_ACCESS_DESTRUCTIVE',
    `${stripTypeScriptTypes(executeText)};return executeActions;`)(never, new Set());
  let queries = 0;
  const result = await execute({ from(table) {
    if (table === 'audit_logs') return { insert: async () => ({ error: null }) };
    queries++; throw new Error('No access query or mutation expected');
  } },
    [{ action_id: 'shell', category: 'no_source_window', user_id: 'buyer', target_product_id: 'module' }], [],
    { selectedActionIds: ['shell'], applyCategories: ['no_source_window'], forceExecute: true });
  assert.equal(result.created, 0);
  assert.equal(result.updated, 0);
  assert.equal(queries, 0);
});
