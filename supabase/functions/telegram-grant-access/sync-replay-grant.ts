// A suppressed duplicate DM still has to converge its existing grant mirror.
// This helper does not create grants, alter membership, or call Telegram.
// deno-lint-ignore-file no-explicit-any
export async function syncReplayGrant(db: any, input: {
  userId: string;
  clubId: string;
  sourceId?: string | null;
  activeUntil: string | null;
  now?: string;
}) {
  if (!input.sourceId) return { updated: false, reason: 'no_source' };
  const endValue = (value: string | null) => value === null ? Infinity : Date.parse(value);
  const targetEnd = endValue(input.activeUntil);
  if (Number.isNaN(targetEnd)) throw new Error('telegram_replay_grant_invalid_end');
  const { data: current, error } = await db.from('telegram_access_grants')
    .select('id,end_at,status,updated_at')
    .eq('user_id', input.userId).eq('club_id', input.clubId)
    .eq('source_id', input.sourceId).maybeSingle();
  if (error) throw new Error('telegram_replay_grant_read_failed');
  // Historical DMs may predate the optional grant mirror. Do not invent a
  // second grant or reactivate a revoked source while replaying a sent DM.
  if (!current) return { updated: false, reason: 'not_found' };
  if (current.status !== 'active') throw new Error('telegram_replay_grant_not_active');
  if (Number.isNaN(endValue(current.end_at))) throw new Error('telegram_replay_grant_invalid_end');
  if (endValue(current.end_at) === targetEnd) return { updated: false, reason: 'already_current' };
  if (!current.updated_at) throw new Error('telegram_replay_grant_missing_snapshot');
  const result = await db.from('telegram_access_grants')
    .update({ end_at: input.activeUntil, updated_at: input.now ?? new Date().toISOString() })
    .eq('id', current.id).eq('user_id', input.userId).eq('club_id', input.clubId)
    .eq('source_id', input.sourceId).eq('status', 'active').eq('updated_at', current.updated_at)
    .select('id,end_at,status').maybeSingle();
  if (result.error) throw new Error('telegram_replay_grant_update_failed');
  if (!result.data) throw new Error('telegram_replay_grant_snapshot_changed');
  if (result.data.id !== current.id || result.data.status !== 'active' ||
      endValue(result.data.end_at) !== targetEnd) throw new Error('telegram_replay_grant_readback_failed');
  return { updated: true, reason: 'synchronized' };
}
