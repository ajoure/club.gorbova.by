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

assert.match(
  validationSource,
  /selectWiderCommercialAccess/,
  'commercial batch validation must resolve the widest active window',
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
