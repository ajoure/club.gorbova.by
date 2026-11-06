import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Execute the entire entry handler; only its external boundaries are replaced.
const compiled = ts.transpileModule(readFileSync('supabase/functions/telegram-club-members/index.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
type Action = 'kick' | 'kick_present';
interface Member {
  id: string; telegram_user_id: number; profile_id: string | null;
  in_chat: boolean; in_channel: boolean; access_status: string;
  last_telegram_check_result?: { chat?: { status: string }; channel?: { status: string } };
}
interface Profile { id: string; user_id: string | null }
function member(index = 1, extra: Partial<Member> = {}): Member {
  return { id: `member-${index}`, telegram_user_id: 1000 + index, profile_id: `profile-${index}`,
    in_chat: true, in_channel: false, access_status: 'expired', ...extra };
}
interface Options {
  members?: Member[]; profiles?: Profile[] | null; profileError?: unknown;
  validUsers?: string[]; helperThrows?: boolean;
}
async function invoke(action: Action, dryRun = false, options: Options = {}) {
  const members = options.members ?? [member()];
  const profiles = options.profiles === undefined
    ? members.filter(m => m.profile_id).map(m => ({ id: m.profile_id!, user_id: `user-${m.id}` }))
    : options.profiles;
  const reads: string[] = [], writes: { table: string; method: string; payload: unknown }[] = [];
  const messages: string[] = [];
  const helper = vi.fn(async (_db: unknown, userIds: string[]) => {
    if (options.helperThrows) throw new Error('SYNTHETIC_HELPER_FAILURE');
    return new Map(userIds.map(id => [id, { valid: options.validUsers?.includes(id) ?? false, source: 'subscription' }]));
  });
  const fetcher = vi.fn(async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (url.hostname !== 'api.telegram.org' || !url.pathname.endsWith('/banChatMember') || init.method !== 'POST')
      throw new Error('UNEXPECTED_OFFLINE_PROVIDER_REQUEST');
    return new Response(JSON.stringify({ ok: true, result: true }));
  });
  const db = { from(table: string) {
    if (!['telegram_clubs', 'telegram_club_members', 'profiles', 'telegram_access_audit'].includes(table))
      throw new Error('UNEXPECTED_OFFLINE_TABLE');
    let mutation = false;
    function result() {
      if (mutation) return { data: null, error: null };
      reads.push(table);
      if (table === 'telegram_clubs') return { data: { id: 'club-fixture', chat_id: -1001, channel_id: -1002,
        telegram_bots: { bot_token_encrypted: 'fixture-bot' } }, error: null };
      if (table === 'profiles') return { data: profiles, error: options.profileError ?? null };
      if (table === 'telegram_club_members') return { data: members, error: null };
      throw new Error('UNEXPECTED_OFFLINE_READ');
    }
    const q = {
      select: (_columns: string) => q, eq: (_key: string, _value: unknown) => q,
      in: (_key: string, _values: unknown[]) => q, or: (_filter: string) => q,
      update(payload: unknown) { mutation = true; writes.push({ table, method: 'update', payload }); return q; },
      insert(payload: unknown) { mutation = true; writes.push({ table, method: 'insert', payload }); return q; },
      single: async () => result(),
      then(resolve: (value: { data: unknown; error: unknown }) => unknown) { return Promise.resolve(result()).then(resolve); },
    };
    return q;
  } };
  let handler!: (request: Request) => Promise<Response>;
  runInNewContext(compiled, {
    exports: {}, Request, Response, Date, Map, Set,
    fetch: fetcher,
    console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args: unknown[]) => messages.push(args.map(String).join(' '))])),
    Deno: { env: { get: (key: string) => ({ SUPABASE_URL: 'https://fixture.invalid',
      SUPABASE_SERVICE_ROLE_KEY: 'fixture-service', SUPABASE_ANON_KEY: 'fixture-anon' })[key] },
      serve: (callback: typeof handler) => { handler = callback; } },
    require(specifier: string) {
      if (specifier === 'npm:@supabase/supabase-js@2') return { createClient: () => db };
      if (specifier === '../_shared/accessValidation.ts') return { hasCommercialAccessBatch: helper };
      throw new Error('UNEXPECTED_OFFLINE_IMPORT');
    },
  });
  const response = await handler(new Request('https://fixture.invalid', { method: 'POST',
    headers: { Authorization: 'Bearer fixture-service', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, club_id: 'club-fixture', dry_run: dryRun }) }));
  return { status: response.status, body: await response.json() as Record<string, unknown>, reads, writes, helper, fetcher, messages };
}
const actions: Action[] = ['kick', 'kick_present'];

describe('actual club member entry handler: profile mapping read failure', () => {
  for (const action of actions) for (const dryRun of [false, true]) {
    it.each(['null', 'partial'] as const)(`${action} dry_run=${dryRun}: fails closed for %s data plus a lookup error`, async kind => {
      const h = await invoke(action, dryRun, { members: [member(1), member(2)],
        profiles: kind === 'null' ? null : [{ id: 'profile-1', user_id: 'user-member-1' }],
        profileError: { message: 'SYNTHETIC_PRIVATE_DATABASE_DETAIL', details: 'fixture-detail', code: 'fixture-code' } });
      expect.soft(h.status).toBe(503);
      expect.soft(h.body).toEqual({ success: false, error: 'PROFILES_LOOKUP_FAILED', action, kicked_count: 0 });
      expect.soft(h.helper).not.toHaveBeenCalled();
      expect.soft(h.fetcher).not.toHaveBeenCalled();
      expect.soft(h.writes).toEqual([]);
      expect(JSON.stringify([h.body, h.messages])).not.toContain('SYNTHETIC_PRIVATE_DATABASE_DETAIL');
    });
  }
});

describe('actual club member entry handler: unchanged successful-read behavior', () => {
  it.each(actions)('%s: commercial helper failure has no provider call or write', async action => {
    const h = await invoke(action, false, { helperThrows: true });
    expect(h.status).toBe(500); expect(h.body.success).toBe(false);
    expect(h.helper).toHaveBeenCalledOnce(); expect(h.fetcher).not.toHaveBeenCalled(); expect(h.writes).toEqual([]);
  });
  it.each(actions)('%s: retains paid skip and explicit false-access removal', async action => {
    const h = await invoke(action, false, { members: [member(1), member(2)], validUsers: ['user-member-1'] });
    expect(h.status).toBe(200); expect(h.body).toMatchObject({ success: true, kicked_count: 1 });
    expect(h.helper).toHaveBeenCalledWith(expect.anything(), ['user-member-1', 'user-member-2'], 'club-fixture');
    expect(h.fetcher).toHaveBeenCalledOnce();
    expect(JSON.parse(h.fetcher.mock.calls[0][1].body as string).user_id).toBe(1002);
    expect(h.writes.filter(w => w.method === 'update')).toHaveLength(1);
  });
  for (const action of actions) for (const location of ['chat', 'channel'] as const) {
    it.each(['administrator', 'creator'])(`${action}: retains ${location} %s protection`, async status => {
      const h = await invoke(action, false, { members: [member(1, { in_channel: true,
        last_telegram_check_result: { [location]: { status } } })] });
      expect(h.body).toMatchObject({ success: true, kicked_count: 0 });
      expect(h.fetcher).not.toHaveBeenCalled(); expect(h.writes.filter(w => w.method === 'update')).toEqual([]);
      expect(h.writes).toHaveLength(1); // existing skip audit, not a removal
    });
  }
  it('kick keeps its 51-member MAX guard before profiles lookup even if that lookup would fail', async () => {
    const h = await invoke('kick', false, { members: Array.from({ length: 51 }, (_, i) => member(i)),
      profileError: { message: 'SYNTHETIC_LOOKUP_FAILURE' } });
    expect(h.status).toBe(409); expect(h.body).toMatchObject({ error: 'TOO_MANY_CANDIDATES_STOP', count: 51, max: 50 });
    expect(h.reads).not.toContain('profiles'); expect(h.helper).not.toHaveBeenCalled();
    expect(h.fetcher).not.toHaveBeenCalled(); expect(h.writes).toEqual([]);
  });
  it('kick_present keeps its 51-candidate MAX guard after successful access validation', async () => {
    const h = await invoke('kick_present', false, { members: Array.from({ length: 51 }, (_, i) => member(i)) });
    expect(h.status).toBe(409); expect(h.body).toMatchObject({ count: 51, max: 50 });
    expect(h.helper).toHaveBeenCalledOnce(); expect(h.fetcher).not.toHaveBeenCalled(); expect(h.writes).toEqual([]);
  });
  it.each(actions)('%s: retains the exact 50-candidate boundary', async action => {
    const h = await invoke(action, false, { members: Array.from({ length: 50 }, (_, i) => member(i)) });
    expect(h.status).toBe(200); expect(h.body.kicked_count).toBe(50); expect(h.fetcher).toHaveBeenCalledTimes(50);
  });
  it('kick_present dry run retains preview before MAX and no provider calls or writes', async () => {
    const h = await invoke('kick_present', true, { members: Array.from({ length: 51 }, (_, i) => member(i)) });
    expect(h.status).toBe(200); expect(h.body).toMatchObject({ success: true, dry_run: true, candidates_count: 51 });
    expect(h.helper).toHaveBeenCalledOnce(); expect(h.fetcher).not.toHaveBeenCalled(); expect(h.writes).toEqual([]);
  });
  it('kick_present dry run retains valid-access and admin exclusions', async () => {
    const h = await invoke('kick_present', true, { members: [member(1), member(2), member(3, {
      last_telegram_check_result: { chat: { status: 'creator' } } })], validUsers: ['user-member-1'] });
    expect(h.body).toMatchObject({ candidates_count: 1, skipped_has_access_count: 2 });
    expect(h.fetcher).not.toHaveBeenCalled(); expect(h.writes).toEqual([]);
  });
  it.each(actions)('%s: retains the empty successful-read result', async action => {
    const h = await invoke(action, false, { members: [], profiles: [] });
    expect(h.body).toMatchObject({ success: true, kicked_count: 0 });
    expect(h.helper).not.toHaveBeenCalled(); expect(h.fetcher).not.toHaveBeenCalled(); expect(h.writes).toEqual([]);
  });
  for (const action of actions) {
    it.each(['missing-profile', 'null-user', 'missing-profile-id'] as const)(`${action}: characterizes successful-read %s without changing identity policy`, async kind => {
      const h = await invoke(action, false, { members: [member(1, kind === 'missing-profile-id' ? { profile_id: null } : {})],
        profiles: kind === 'null-user' ? [{ id: 'profile-1', user_id: null }] : [] });
      expect(h.status).toBe(200); expect(h.body).toMatchObject({ success: true, kicked_count: 1 });
      expect(h.helper).not.toHaveBeenCalled(); expect(h.fetcher).toHaveBeenCalledOnce();
      expect(h.writes.filter(w => w.method === 'update')).toHaveLength(1);
    });
  }
});
