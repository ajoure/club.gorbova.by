export interface TelegramUnansweredSummary {
  user_id: string;
  unanswered_count: number | string | null;
  oldest_message_id?: string | null;
  oldest_message_text?: string | null;
  oldest_message_at?: string | null;
}

export interface TelegramQueueItem<TDialog extends { user_id: string }> {
  dialog: TDialog | null;
  unanswered: TelegramUnansweredSummary | null;
}

/**
 * The regular inbox RPC is paginated, while the unanswered RPC returns the
 * complete work queue. Keep the fast first page, then add lightweight rows for
 * unanswered conversations that are not on that page. This makes the badges
 * and the "New" tab describe the same set without downloading every dialog.
 */
export function mergeTelegramWorkQueue<TDialog extends { user_id: string }>(
  dialogs: TDialog[],
  unanswered: TelegramUnansweredSummary[],
  appendMissing = true,
): TelegramQueueItem<TDialog>[] {
  const unansweredByUser = new Map(unanswered.map((item) => [item.user_id, item]));
  const loadedUserIds = new Set(dialogs.map((dialog) => dialog.user_id));

  const loaded = dialogs.map((dialog) => ({
    dialog,
    unanswered: unansweredByUser.get(dialog.user_id) ?? null,
  }));

  const missing = appendMissing ? unanswered
    .filter((item) => !loadedUserIds.has(item.user_id))
    .sort((a, b) => {
      const byDate = String(b.oldest_message_at || "").localeCompare(
        String(a.oldest_message_at || ""),
      );
      return byDate || a.user_id.localeCompare(b.user_id);
    })
    .map((item) => ({ dialog: null, unanswered: item })) : [];

  return [...loaded, ...missing];
}
