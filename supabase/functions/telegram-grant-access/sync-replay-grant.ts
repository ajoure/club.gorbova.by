// A suppressed duplicate DM still has to converge the exact grant mirror.
// It may create the missing mirror for this already-authorized source, but it
// never alters membership or calls Telegram.
// deno-lint-ignore-file no-explicit-any
export async function syncReplayGrant(db: any, input: {
  userId: string;
  clubId: string;
  sourceId?: string | null;
  source: string;
  grantedBy?: string | null;
  accessRuleId?: string | null;
  comment?: string | null;
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
  if (!current) {
    const now = input.now ?? new Date().toISOString();
    const inserted = await db.from('telegram_access_grants').insert({
      user_id: input.userId,
      club_id: input.clubId,
      source: input.source,
      source_id: input.sourceId,
      granted_by: input.grantedBy ?? null,
      start_at: now,
      end_at: input.activeUntil,
      status: 'active',
      meta: {
        replay_without_duplicate_dm: true,
        access_rule_id: input.accessRuleId ?? null,
        comment: input.comment ?? null,
      },
    }).select('id,end_at,status,source_id').maybeSingle();
    if (inserted.error) throw new Error('telegram_replay_grant_insert_failed');
    if (!inserted.data || inserted.data.status !== 'active' ||
        inserted.data.source_id !== input.sourceId ||
        endValue(inserted.data.end_at) !== targetEnd) {
      throw new Error('telegram_replay_grant_insert_readback_failed');
    }
    return { updated: true, reason: 'created' };
  }
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
