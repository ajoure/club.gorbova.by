import type { ReactNode } from "react";
import {
  Link,
  Unlink,
  Key,
  UserPlus,
  UserMinus,
  Bell,
  MessageCircle,
  Paperclip,
  RefreshCcw,
  CreditCard,
  Package,
  CheckCircle2,
  AlertTriangle,
  Settings,
} from "lucide-react";

/**
 * PATCH-CONTACT-CENTER-TELEGRAM-CHAT-PERFORMANCE-V1.3-MEMOIZE-BUBBLE
 *
 * Shared types for flat-props message/event bubbles. All fields are
 * primitive strings/numbers/booleans (or `readonly` arrays with stable
 * refs) so that `React.memo` with a custom comparator can decide re-render
 * without expensive lookups.
 */

/** Stable frozen empty reactions ref — never allocate `[]` in hot render path. */
export const EMPTY_REACTIONS: ReadonlyArray<TelegramReactionSummary> = Object.freeze([]);

export interface TelegramReactionSummary {
  emoji: string;
  count: number;
  userReacted: boolean;
}

/**
 * All render-relevant fields flattened. Any UI-visible attribute of a
 * telegram message MUST be listed here — if it changes, the bubble must
 * re-render.
 */
export interface MessageBubbleData {
  kind: "message";
  key: string;

  // identity + hot state
  id: string;
  telegramMessageId: number | null;
  direction: "incoming" | "outgoing";
  status: string;
  createdAt: string;

  // content
  messageText: string | null;
  isDeleted: boolean;
  isEdited: boolean;

  // media (flattened)
  isMediaLike: boolean;
  fileType: string | null;
  fileUrl: string | null;
  fileName: string | null;
  mimeType: string | null;
  storageBucket: string | null;
  storagePath: string | null;
  uploadStatus: string | null;
  uploadError: string | null;

  // reply / quote (precomputed — no lookup inside bubble)
  hasReply: boolean;
  quotedMessageDbId: string | null;
  quotedPreview: string | null;
  quotedAuthor: string | null;
  quotedMissing: boolean;

  // sender identity (flattened primitives — NOT the join object)
  adminName: string | null;
  adminAvatarUrl: string | null;
  clientName: string | null;
  clientAvatarUrl: string | null;

  // bot metadata (flattened primitives)
  botLabel: string | null;

  // automation
  automated: boolean;
  automatedTitle: string | null;

  // inline keyboard (only URL rows; empty array is a stable ref)
  inlineUrlRows: ReadonlyArray<ReadonlyArray<{ text?: string; url?: string }>>;
  inlineUrlSignature: string;

  // timestamps
  timeShort: string;

  // capabilities
  canEdit: boolean;
  canDelete: boolean;

  // reactions
  reactionsForRow: ReadonlyArray<TelegramReactionSummary>;
  reactionsSignature: string;
}

export interface EventBubbleData {
  kind: "event";
  key: string;
  id: string;
  action: string;
  displayText: string;
  statusSuffix: string;
  status: string;
  isSkipped: boolean;
  isFailed: boolean;
  isSuccess: boolean;
  skipReason: string | null;
  errorMessage: string | null;
  hasMessageText: boolean;
  messageText: string | null;
  timeMedium: string;
  title: string | null;
}

export const EVENT_ICONS: Record<string, ReactNode> = {
  LINK_SUCCESS: <Link className="w-3 h-3 text-green-500" />,
  RELINK_SUCCESS: <Link className="w-3 h-3 text-blue-500" />,
  UNLINK: <Unlink className="w-3 h-3 text-orange-500" />,
  AUTO_GRANT: <Key className="w-3 h-3 text-green-500" />,
  MANUAL_GRANT: <Key className="w-3 h-3 text-green-500" />,
  MANUAL_EXTEND: <Key className="w-3 h-3 text-blue-500" />,
  AUTO_REVOKE: <UserMinus className="w-3 h-3 text-red-500" />,
  MANUAL_REVOKE: <UserMinus className="w-3 h-3 text-red-500" />,
  AUTO_KICK_VIOLATOR: <UserMinus className="w-3 h-3 text-red-500" />,
  "telegram.access_granted": <Key className="w-3 h-3 text-green-500" />,
  "telegram.access_revoked": <UserMinus className="w-3 h-3 text-red-500" />,
  "telegram.access_queued": <RefreshCcw className="w-3 h-3 text-blue-500" />,
  manual_notification: <Bell className="w-3 h-3 text-blue-500" />,
  ADMIN_CHAT_MESSAGE: <MessageCircle className="w-3 h-3 text-primary" />,
  ADMIN_CHAT_FILE: <Paperclip className="w-3 h-3 text-primary" />,
  CONTACT_MERGED: <UserPlus className="w-3 h-3 text-purple-500" />,
  CONTACT_UNMERGED: <UserMinus className="w-3 h-3 text-orange-500" />,
  "subscription.charged": <CreditCard className="w-3 h-3 text-green-500" />,
  "subscription.renewal_order_created": <Package className="w-3 h-3 text-blue-500" />,
  "subscription.purchased": <CreditCard className="w-3 h-3 text-green-500" />,
  "subscription.created": <Package className="w-3 h-3 text-blue-500" />,
  "subscription.activated": <CheckCircle2 className="w-3 h-3 text-green-500" />,
  "subscription.expired": <AlertTriangle className="w-3 h-3 text-orange-500" />,
  "subscription.canceled": <AlertTriangle className="w-3 h-3 text-red-500" />,
  "subscription.charge_failed": <AlertTriangle className="w-3 h-3 text-red-500" />,
  "subscription.gc_sync_renewal_success": <RefreshCcw className="w-3 h-3 text-green-500" />,
  "subscription.gc_sync_renewal_failed": <AlertTriangle className="w-3 h-3 text-orange-500" />,
  "payment.success": <CreditCard className="w-3 h-3 text-green-500" />,
  "payment.failed": <AlertTriangle className="w-3 h-3 text-red-500" />,
  "system.trigger_fix_telegram_status": <Settings className="w-3 h-3 text-muted-foreground" />,
  "telegram.backfill_grant": <RefreshCcw className="w-3 h-3 text-blue-500" />,
};

/** Build a compact signature for a reactions array — cheap string compare in comparator. */
export function buildReactionsSignature(list: ReadonlyArray<TelegramReactionSummary> | null | undefined): string {
  if (!list || list.length === 0) return "";
  // list is already sorted upstream (server), but sort by emoji for defensive stability
  const parts = list.map((r) => `${r.emoji}:${r.count}:${r.userReacted ? 1 : 0}`);
  return parts.join("|");
}

/** Stable, sortable telegram-relevant signature for merge identity preservation. */
export function messageRenderSignature(m: any): string {
  const meta: any = m?.meta ?? {};
  const rm = meta.reply_markup ? JSON.stringify(meta.reply_markup) : "";
  return [
    m?.id ?? "",
    m?.direction ?? "",
    m?.status ?? "",
    m?.created_at ?? "",
    (m?.message_text ?? "").length,
    (m?.message_text ?? "").slice(0, 96),
    m?.sent_by_admin ?? "",
    m?.reply_to_message_id ?? 0,
    m?.is_read ? 1 : 0,
    m?.is_pinned ? 1 : 0,
    m?.is_favorite ? 1 : 0,
    m?.error_message ?? "",
    m?.file_type ?? meta.file_type ?? "",
    m?.file_url ?? meta.file_url ?? "",
    m?.file_name ?? meta.file_name ?? "",
    m?.file_size ?? 0,
    m?.mime_type ?? meta.mime_type ?? "",
    m?.storage_bucket ?? meta.storage_bucket ?? "",
    m?.storage_path ?? meta.storage_path ?? "",
    m?.upload_status ?? meta.upload_status ?? "",
    m?.thumbnail_url ?? "",
    m?.duration ?? 0,
    meta.edited ? 1 : 0,
    meta.deleted ? 1 : 0,
    meta.automated ? 1 : 0,
    meta.source ?? "",
    rm.length,
    m?.admin_profile?.full_name ?? "",
    m?.admin_profile?.avatar_url ?? "",
    m?.telegram_bots?.bot_name ?? "",
    m?.telegram_bots?.bot_username ?? "",
    m?.bot_id ?? "",
    m?.bot_name ?? "",
    m?.bot_username ?? "",
  ].join("|");
}

export interface MessageBubbleProps {
  data: MessageBubbleData;
  isHighlighted: boolean;
  onReply: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (dbId: string, telegramMessageId: number) => void;
  onReact: (id: string, emoji: string) => void;
  onQuoteClick: (dbId: string) => void;
  onMediaRefresh: (messageDbId: string) => void;
  emojiList: ReadonlyArray<string>;
}

export interface EventBubbleProps {
  data: EventBubbleData;
}

/** Custom comparator — returns TRUE when props are equal (skip render). */
export function messageBubbleAreEqual(prev: MessageBubbleProps, next: MessageBubbleProps): boolean {
  if (prev.isHighlighted !== next.isHighlighted) return false;
  if (prev.onReply !== next.onReply) return false;
  if (prev.onEdit !== next.onEdit) return false;
  if (prev.onDelete !== next.onDelete) return false;
  if (prev.onReact !== next.onReact) return false;
  if (prev.onQuoteClick !== next.onQuoteClick) return false;
  if (prev.onMediaRefresh !== next.onMediaRefresh) return false;
  if (prev.emojiList !== next.emojiList) return false;

  const a = prev.data;
  const b = next.data;
  if (a === b) return true;

  return (
    a.id === b.id &&
    a.telegramMessageId === b.telegramMessageId &&
    a.direction === b.direction &&
    a.status === b.status &&
    a.messageText === b.messageText &&
    a.isDeleted === b.isDeleted &&
    a.isEdited === b.isEdited &&
    a.isMediaLike === b.isMediaLike &&
    a.fileType === b.fileType &&
    a.fileUrl === b.fileUrl &&
    a.fileName === b.fileName &&
    a.mimeType === b.mimeType &&
    a.storageBucket === b.storageBucket &&
    a.storagePath === b.storagePath &&
    a.uploadStatus === b.uploadStatus &&
    a.uploadError === b.uploadError &&
    a.hasReply === b.hasReply &&
    a.quotedMessageDbId === b.quotedMessageDbId &&
    a.quotedPreview === b.quotedPreview &&
    a.quotedAuthor === b.quotedAuthor &&
    a.quotedMissing === b.quotedMissing &&
    a.adminName === b.adminName &&
    a.adminAvatarUrl === b.adminAvatarUrl &&
    a.clientName === b.clientName &&
    a.clientAvatarUrl === b.clientAvatarUrl &&
    a.botLabel === b.botLabel &&
    a.automated === b.automated &&
    a.automatedTitle === b.automatedTitle &&
    a.inlineUrlSignature === b.inlineUrlSignature &&
    a.timeShort === b.timeShort &&
    a.canEdit === b.canEdit &&
    a.canDelete === b.canDelete &&
    a.reactionsSignature === b.reactionsSignature
  );
}

export function eventBubbleAreEqual(prev: EventBubbleProps, next: EventBubbleProps): boolean {
  const a = prev.data;
  const b = next.data;
  if (a === b) return true;
  return (
    a.id === b.id &&
    a.action === b.action &&
    a.displayText === b.displayText &&
    a.statusSuffix === b.statusSuffix &&
    a.status === b.status &&
    a.isSkipped === b.isSkipped &&
    a.isFailed === b.isFailed &&
    a.isSuccess === b.isSuccess &&
    a.skipReason === b.skipReason &&
    a.errorMessage === b.errorMessage &&
    a.hasMessageText === b.hasMessageText &&
    a.messageText === b.messageText &&
    a.timeMedium === b.timeMedium &&
    a.title === b.title
  );
}
