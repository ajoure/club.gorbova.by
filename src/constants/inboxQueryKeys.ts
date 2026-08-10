/**
 * Канонические query keys для контакт-центра.
 *
 * Используются всеми точками чтения/инвалидации, чтобы не было
 * расходящихся литералов и опечаток в ключах.
 */
export const INBOX_DIALOGS_QK = ["inbox-dialogs"] as const;
export const UNREAD_MESSAGES_COUNT_QK = ["unread-messages-count"] as const;
/**
 * Canonical unread contact-card count calculated by the unified inbox.
 * AdminSidebar observes this cache only while the contact center is open so
 * its badge cannot drift from the visible "Новые" queue.
 */
export const CONTACT_CENTER_VISIBLE_UNREAD_QK = [
  "contact-center-visible-unread-count",
] as const;
