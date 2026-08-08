import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const validationSource = await readFile(
  new URL('../supabase/functions/_shared/accessValidation.ts', import.meta.url),
  'utf8',
);
const syncSource = await readFile(
  new URL('../supabase/functions/telegram-cron-sync/index.ts', import.meta.url),
  'utf8',
);
const grantSource = await readFile(
  new URL('../supabase/functions/grant-access-for-order/index.ts', import.meta.url),
  'utf8',
);
const renewalSource = await readFile(
  new URL('../supabase/functions/subscription-charge/index.ts', import.meta.url),
  'utf8',
);
const telegramGrantSource = await readFile(
  new URL('../supabase/functions/telegram-grant-access/index.ts', import.meta.url),
  'utf8',
);

assert.match(
  validationSource,
  /selectWiderCommercialAccess/,
  'commercial batch validation must resolve the widest active window',
);
assert.match(
  validationSource,
  /paid_order_rule/,
  'finite club bonuses must be resolved from their paid order rule',
);
assert.match(
  validationSource,
  /calculateRuleBoundClubEndAt\(paidAt, rule\.durationDays!\)/,
  'finite club bonuses must use paid_at plus rule duration',
);
assert.match(
  grantSource,
  /valid_until: clubAccessEndAt\.toISOString\(\)/,
  'order fulfilment must pass the rule-bound club end to Telegram',
);
assert.match(
  grantSource,
  /access_rule_id: matchedClubRule\.id/,
  'Telegram grant must retain the matching access-rule lineage',
);
assert.match(
  renewalSource,
  /filter\(\(rule: any\) => rule\.duration_days === null\)/,
  'main-product renewals must not renew a finite club bonus',
);
assert.match(
  telegramGrantSource,
  /if \(accessSnapshot\.allSources\.length > 0\) \{\s*activeUntil = effectiveEndAtIso\(accessSnapshot\)/,
  'commercial Telegram projection must use the widest authoritative club access',
);
assert.match(
  telegramGrantSource,
  /if \(newEnd !== existingEnd\)/,
  'same-source Telegram grants must converge downward as well as upward',
);
assert.match(
  validationSource,
  /commercial_access_subscriptions_failed/,
  'subscription read failures must stop commercial validation instead of looking like no access',
);
assert.match(
  validationSource,
  /club_access_rules_failed/,
  'access-rule read failures must fail closed before autokick decisions',
);
assert.match(
  syncSource,
  /\.select\('id, user_id, active_until, state_chat, state_channel'\)/,
  'cron sync must preload Telegram access projections for the batch',
);
assert.match(
  syncSource,
  /active_until: expectedEndAt/,
  'cron sync must mirror the effective commercial end date',
);
assert.match(
  syncSource,
  /telegram\.access_projection\.synced/,
  'projection corrections must be auditable',
);
assert.match(
  syncSource,
  /projection_sync_count: projectionSyncCount/,
  'batch audit must expose the number of corrected projections',
);
assert.doesNotMatch(
  syncSource,
  /\.eq\('state_chat', 'pending'\)/,
  'projection reconciliation must not be limited to pending rows',
);

console.log('telegram derived access projection checks passed');
