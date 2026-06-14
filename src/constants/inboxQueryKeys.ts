/**
 * Канонические query keys для контакт-центра.
 *
 * Используются всеми точками чтения/инвалидации, чтобы не было
 * расходящихся литералов и опечаток в ключах.
 */
export const INBOX_DIALOGS_QK = ["inbox-dialogs"] as const;
export const UNREAD_MESSAGES_COUNT_QK = ["unread-messages-count"] as const;
