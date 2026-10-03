/** Transport success alone is not customer delivery. Canonical replay is valid. */
export function assertReferralDelivery(data: { queued?: boolean; results?: Array<{ club_id?: string; dm_sent?: boolean; mirrored_to_telegram_messages?: boolean; skipped_duplicate?: boolean; existing_message_row_id?: string }> } | null, clubId: string): void {
  const result = data?.results?.find(row => row.club_id === clubId);
  if (data?.queued || !result) throw new Error('telegram_delivery_unconfirmed');
  if (result.skipped_duplicate && result.existing_message_row_id) return;
  if (!result.dm_sent) throw new Error('telegram_delivery_failed');
  if (!result.mirrored_to_telegram_messages) throw new Error('telegram_mirror_reconciliation_required');
}
