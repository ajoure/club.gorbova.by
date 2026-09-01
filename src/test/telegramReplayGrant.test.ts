import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { syncReplayGrant } from '../../supabase/functions/telegram-grant-access/sync-replay-grant';

const input = {
  userId: 'user', clubId: 'club', sourceId: 'order', source: 'grant-access-for-order',
  accessRuleId: 'rule', activeUntil: '2026-09-29T12:00:00Z', now: '2026-08-31T18:00:00Z',
};
const original = { id: 'grant', status: 'active', end_at: '2026-09-27T20:59:59Z', updated_at: '2026-08-28T12:00:00Z' };
function database(options: { row?: any; readError?: boolean; writeError?: boolean; insertError?: boolean; conflict?: boolean; wrongReadback?: boolean } = {}) {
  let row = options.row === undefined ? { ...original } : options.row;
  const writes: any[] = [];
  const queries: any[] = [];
  const db = { from(table: string) {
    const query: any = { table, filters: [], patch: null };
    queries.push(query);
    const builder: any = {
      select: () => builder,
      eq: (key: string, value: any) => { query.filters.push([key, value]); return builder; },
      update: (patch: any) => { query.patch = patch; query.kind = 'update'; return builder; },
      insert: (patch: any) => { query.patch = patch; query.kind = 'insert'; return builder; },
      maybeSingle: async () => {
        if (!query.patch) return { data: row && { ...row }, error: options.readError ? new Error('read') : null };
        writes.push(query);
        if (options.writeError || (query.kind === 'insert' && options.insertError)) return { data: null, error: new Error('write') };
        if (options.conflict) return { data: null, error: null };
        row = query.kind === 'insert'
          ? { id: 'created-grant', ...query.patch }
          : { ...row, ...query.patch };
        return { data: options.wrongReadback ? { ...row, id: 'another' } : { ...row }, error: null };
      },
    };
    return builder;
  } };
  return { db, writes, queries };
}

describe('Telegram grant mirror replay without sending another DM', () => {
  it('updates only the exact existing source with a snapshot guard and is idempotent', async () => {
    const t = database();
    expect(await syncReplayGrant(t.db, input)).toEqual({ updated: true, reason: 'synchronized' });
    expect(t.writes).toHaveLength(1);
    expect(t.writes[0].patch).toEqual({ end_at: input.activeUntil, updated_at: input.now });
    expect(t.writes[0].filters).toEqual([
      ['id', 'grant'], ['user_id', 'user'], ['club_id', 'club'], ['source_id', 'order'],
      ['status', 'active'], ['updated_at', original.updated_at],
    ]);
    expect(await syncReplayGrant(t.db, input)).toEqual({ updated: false, reason: 'already_current' });
    expect(t.writes).toHaveLength(1);
  });
  it('creates the exact missing source mirror without calling Telegram', async () => {
    const t = database({ row: null });
    expect(await syncReplayGrant(t.db, input)).toEqual({ updated: true, reason: 'created' });
    expect(t.writes).toHaveLength(1);
    expect(t.writes[0].kind).toBe('insert');
    expect(t.writes[0].patch).toMatchObject({
      user_id: 'user', club_id: 'club', source: 'grant-access-for-order', source_id: 'order',
      start_at: input.now, end_at: input.activeUntil, status: 'active',
      meta: { replay_without_duplicate_dm: true, access_rule_id: 'rule' },
    });
  });
  it('does not use a fuzzy source when source_id is absent', async () => {
    const t = database();
    expect((await syncReplayGrant(t.db, { ...input, sourceId: null })).reason).toBe('no_source');
    expect(t.queries).toHaveLength(0);
  });
  it('compares timestamps, not their string formatting', async () => {
    const t = database({ row: { ...original, end_at: '2026-09-29T12:00:00.000Z' } });
    expect((await syncReplayGrant(t.db, input)).reason).toBe('already_current');
    expect(t.writes).toHaveLength(0);
  });
  it.each([null, '2026-09-26T12:00:00Z'])('converges to authoritative end %s without rewriting meta or membership', async end => {
    const t = database();
    await syncReplayGrant(t.db, { ...input, activeUntil: end });
    expect(Object.keys(t.writes[0].patch).sort()).toEqual(['end_at', 'updated_at']);
  });
  it('does not reactivate revoked sources', async () => {
    const t = database({ row: { ...original, status: 'revoked' } });
    await expect(syncReplayGrant(t.db, input)).rejects.toThrow('telegram_replay_grant_not_active');
    expect(t.writes).toHaveLength(0);
  });
  it('rejects invalid target timestamps before reading or writing', async () => {
    const t = database();
    await expect(syncReplayGrant(t.db, { ...input, activeUntil: 'not-a-date' })).rejects.toThrow('invalid_end');
    expect(t.queries).toHaveLength(0);
  });
  it.each([
    [{ readError: true }, 'read_failed'],
    [{ writeError: true }, 'update_failed'],
    [{ conflict: true }, 'snapshot_changed'],
    [{ wrongReadback: true }, 'readback_failed'],
    [{ row: { ...original, updated_at: null } }, 'missing_snapshot'],
  ])('fails closed on %j', async (options, error) => {
    await expect(syncReplayGrant(database(options).db, input)).rejects.toThrow(error);
  });
  it.each([
    [{ row: null, insertError: true }, 'insert_failed'],
    [{ row: null, conflict: true }, 'insert_readback_failed'],
  ])('fails closed while creating a missing exact mirror on %j', async (options, error) => {
    await expect(syncReplayGrant(database(options).db, input)).rejects.toThrow(error);
  });
  it('synchronizes before duplicate continue and never falls through on lookup/sync failure', () => {
    const source = readFileSync('supabase/functions/telegram-grant-access/index.ts', 'utf8');
    const branch = source.slice(source.indexOf('if (dup && !projectionNeedsRestore)'), source.indexOf('// Process chat'));
    expect(branch.indexOf('await syncReplayGrant')).toBeLessThan(branch.indexOf('skipped_duplicate: true'));
    expect(branch).toContain('throw dupErr;');
    expect(branch).not.toContain('lookup failed (continuing)');
    expect(source).toContain("if (existingDmError) throw new Error('telegram_duplicate_dm_lookup_failed')");
    expect(source).toContain("if (legacyError) throw new Error('telegram_duplicate_dm_legacy_lookup_failed')");
    expect(source).toContain("requestedEnd >= effectiveEnd ? activeUntil : effectiveUntil");
  });
});
