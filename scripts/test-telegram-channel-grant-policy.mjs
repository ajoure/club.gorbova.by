import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const grantSource = await readFile(
  new URL('../supabase/functions/telegram-grant-access/index.ts', import.meta.url),
  'utf8',
);
const reinviteSource = await readFile(
  new URL('../supabase/functions/telegram-reinvite-ghosts/index.ts', import.meta.url),
  'utf8',
);
const syncSource = await readFile(
  new URL('../supabase/functions/telegram-cron-sync/index.ts', import.meta.url),
  'utf8',
);
const migrationSource = await readFile(
  new URL('../supabase/migrations/20260808123000_add_channel_grant_policy.sql', import.meta.url),
  'utf8',
);

assert.match(
  grantSource,
  /const shouldGrantChannel = Boolean\(club\.channel_id && channelGrantEnabled\)/,
  'canonical grant must derive channel issuance from the durable club policy',
);
assert.match(
  grantSource,
  /state_channel: shouldGrantChannel \? 'pending' : 'none'/,
  'chat-only grants must not leave a pending channel projection',
);
assert.match(
  grantSource,
  /if \(shouldGrantChannel && club\.channel_id\)/,
  'canonical grant must skip channel Telegram API calls when policy is disabled',
);
assert.match(
  reinviteSource,
  /const requiresChannel = Boolean\(club\.channel_id && channelGrantEnabled\)/,
  'ghost reinvites must use the same channel policy',
);
assert.match(
  reinviteSource,
  /const needsChannel = requiresChannel &&/,
  'ghost reinvites must not recreate disabled channel invitations',
);
assert.match(
  syncSource,
  /const nextChannelState = club\.channel_id && channelGrantEnabled \? 'active' : 'none'/,
  'membership sync must preserve chat-only channel projection',
);
assert.doesNotMatch(
  syncSource,
  /state_channel: 'active'/,
  'membership sync must not promote a disabled channel unconditionally',
);
assert.match(
  migrationSource,
  /WHERE id = '4f8f9d8f-07ce-4898-8012-39f1035c1456'::uuid\s+AND club_name = 'Бухгалтерия как бизнес'/,
  'managed migration must target the canonical BB club exactly',
);
assert.match(
  migrationSource,
  /IF v_affected <> 1 THEN\s+RAISE EXCEPTION/,
  'managed configuration must fail closed on target drift',
);

console.log('telegram channel grant policy checks passed');
