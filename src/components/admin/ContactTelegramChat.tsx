import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { uploadToTelegramMedia } from "@/components/admin/chat/uploadToTelegramMedia";
import { getClipboardFile } from "@/lib/clipboardImage";
import { format, isToday, isYesterday, isSameDay } from "date-fns";
import { ru } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { TokenizedRichInput } from "@/components/admin/TokenizedRichInput";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  TooltipProvider,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Send,
  MessageCircle,
  Bot,
  User,
  AlertCircle,
  CheckCircle,
  Clock,
  RefreshCw,
  Paperclip,
  Smile,
  Image as ImageIcon,
  FileText,
  X,
  Key,
  UserPlus,
  UserMinus,
  Link,
  Unlink,
  Bell,
  Video,
  Music,
  Mic,
  Circle,
  Edit2,
  CreditCard,
  Package,
  RefreshCcw,
  AlertTriangle,
  CheckCircle2,
  Settings,
  Trash2,
  MoreVertical,
  Reply,
  CornerUpLeft,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getEventLabel } from "@/lib/eventLabels";
import { normalizeEdgeFunctionError, normalizeEdgeFunctionErrorAsync } from "@/utils/normalizeEdgeFunctionError";
import { VideoNoteRecorder } from "./VideoNoteRecorder";
import { AdminVoiceRecorder } from "./chat/AdminVoiceRecorder";
import { OutboundMediaPreview } from "./chat/OutboundMediaPreview";
import { ChatMediaMessage } from "./chat/ChatMediaMessage";
import { useTelegramReactions, useToggleTelegramReaction } from "@/hooks/useTelegramReactions";
import { SmilePlus } from "lucide-react";
import { TELEGRAM_REACTION_EMOJIS } from "@/lib/telegramReactionEmojis";
// V1.3: memo-bubble refactor
import { TelegramMessageBubble } from "./chat/TelegramMessageBubble";
import { TelegramEventBubble } from "./chat/TelegramEventBubble";
import {
  EMPTY_REACTIONS,
  EVENT_ICONS,
  buildReactionsSignature,
  messageRenderSignature,
  type MessageBubbleData,
  type EventBubbleData,
} from "./chat/telegramBubbleTypes";
import {
  buildQuotePreview,
} from "./chat/telegramFormat";
import { selectDefaultTelegramSender } from "@/lib/telegramSenderSelection";
import {
  getTelegramMessageIdentityLabel,
  type TelegramBusinessIdentity,
} from "@/lib/telegramBusinessIdentity";
import { renderContactCenterMessagePlaceholders } from "@/lib/contactCenterMessagePlaceholders";

interface ContactTelegramChatProps {
  userId: string;
  telegramUserId: number | null;
  telegramUsername: string | null;
  clientName?: string | null;
  clientFirstName?: string | null;
  clientLastName?: string | null;
  clientEmail?: string | null;
  clientPhone?: string | null;
  avatarUrl?: string | null;
  onAvatarUpdated?: (url: string) => void;
  hidePhotoButton?: boolean;
  /**
   * Вызывается ПОСЛЕ успешной отправки. `boundary` = max(created_at) среди
   * incoming-сообщений, реально загруженных ДО отправки (capture-before-send).
   * Null → пользовательский flow не должен помечать прочитанным с now()
   * (PATCH-CONTACT-CENTER-FIX-V1 corrective).
   */
  onMessageSent?: (boundary?: string | null) => void;
  /** True когда вкладка Telegram активна. При переходе false→true автоматически прижимаем ленту к низу. */
  isActive?: boolean;
}

interface TelegramMessage {
  id: string;
  type: "message";
  direction: "outgoing" | "incoming";
  message_text: string | null;
  message_id: number | null;
  reply_to_message_id?: number | null;
  status: string;
  created_at: string;
  sent_by_admin?: string | null;
  bot_id?: string | null;
  bot_username?: string | null; // for optimistic UI
  bot_name?: string | null; // for optimistic UI
  transport?: "bot" | "business";
  business_connection_id?: string | null;
  business_account_id?: string | null;
  message_origin?: "client" | "owner_manual" | "crm_operator" | "bot_automation" | null;
  requires_reply?: boolean | null;
  admin_profile?: {
    full_name: string | null;
    avatar_url: string | null;
  } | null;
  telegram_bots?: {
    id: string;
    bot_name: string;
    bot_username: string;
  } | null;
  meta?: {
    file_type?: string | null;
    file_name?: string | null;
    file_url?: string | null;
    edited?: boolean;
    deleted?: boolean;
    automated?: boolean;
    source?: string;
    reply_markup?: {
      inline_keyboard?: Array<Array<{ text?: string; url?: string; callback_data?: string }>>;
    } | null;
    [key: string]: unknown;
  } | null;
}

interface TelegramEvent {
  id: string;
  type: "event";
  action: string;
  status: string;
  created_at: string;
  meta?: Record<string, unknown> | null;
  message_text?: string | null; // PATCH 13E: notification text
}

type ChatItem = TelegramMessage | TelegramEvent;

const EMOJI_LIST = TELEGRAM_REACTION_EMOJIS;

// V1.3: EVENT_ICONS moved to ./chat/telegramBubbleTypes,
// text formatters moved to ./chat/telegramFormat.

// PATCH 13.6+: Используется централизованный словарь EVENT_LABELS из @/lib/eventLabels

export function ContactTelegramChat({
  userId,
  telegramUserId,
  telegramUsername,
  clientName,
  clientFirstName,
  clientLastName,
  clientEmail,
  clientPhone,
  avatarUrl,
  onAvatarUpdated,
  hidePhotoButton = false,
  onMessageSent,
  isActive = true,
}: ContactTelegramChatProps) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFileType, setSelectedFileType] = useState<"photo" | "video" | "audio" | "voice" | "video_note" | "document" | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showMediaMenu, setShowMediaMenu] = useState(false);
  const [showVideoNoteRecorder, setShowVideoNoteRecorder] = useState(false);
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
  const [editingMessage, setEditingMessage] = useState<TelegramMessage | null>(null);
  const [editText, setEditText] = useState("");
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [selectedBusinessAccountId, setSelectedBusinessAccountId] = useState<string | null>(null);
  const senderWasChosenManuallyRef = useRef(false);
  const [replyingTo, setReplyingTo] = useState<TelegramMessage | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [isNearBottomState, setIsNearBottomState] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [hasOlderMessages, setHasOlderMessages] = useState(true);
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
  const [isRefreshingMedia, setIsRefreshingMedia] = useState(false);

  // Fetch available bots
  const { data: telegramBots = [] } = useQuery({
    queryKey: ["telegram-bots-for-chat"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("telegram_bots")
        .select("id, bot_name, bot_username, status, is_primary")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    staleTime: 60000,
  });

  const botsMap = useMemo(() => {
    const map = new Map<string, { bot_name: string; bot_username: string; status: string; is_primary: boolean }>();
    telegramBots.forEach(b => map.set(b.id, { bot_name: b.bot_name, bot_username: b.bot_username, status: b.status, is_primary: b.is_primary || false }));
    return map;
  }, [telegramBots]);

  const activeBots = useMemo(() => telegramBots.filter(b => b.status === "active"), [telegramBots]);
  const { data: businessContext } = useQuery({
    queryKey: ["telegram-latest-incoming-sender-context", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("telegram_messages")
        .select("business_connection_id, business_account_id, bot_id, transport, created_at")
        .eq("user_id", userId)
        .eq("direction", "incoming")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as {
        business_connection_id: string | null;
        business_account_id: string | null;
        bot_id: string | null;
        transport: "bot" | "business" | null;
        created_at: string;
      } | null;
    },
    enabled: !!userId,
    staleTime: 30_000,
  });
  const { data: businessAccount } = useQuery({
    queryKey: ["telegram-business-sender", businessContext?.business_account_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("telegram_business_connections")
        .select("id, bot_id, first_name, last_name, username, can_reply, is_enabled")
        .eq("id", businessContext!.business_account_id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: businessContext?.transport === "business" && !!businessContext.business_account_id,
    staleTime: 30_000,
  });
  // A client may have talked both to a bot and to the connected personal
  // account. Keep every eligible Business sender available instead of hiding
  // it merely because a later bot message became the latest inbound event.
  const { data: dialogBusinessMessageLinks = [] } = useQuery({
    queryKey: ["telegram-dialog-business-message-links", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("telegram_messages")
        .select("id, business_account_id")
        .eq("user_id", userId)
        .eq("transport", "business")
        .not("business_account_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data || []) as Array<{ id: string; business_account_id: string }>;
    },
    enabled: !!userId,
    staleTime: 30_000,
  });
  const dialogBusinessAccountIds = useMemo(
    () => Array.from(new Set(dialogBusinessMessageLinks.map((row) => row.business_account_id))),
    [dialogBusinessMessageLinks],
  );
  const businessAccountIdByMessageId = useMemo(
    () => new Map(dialogBusinessMessageLinks.map((row) => [row.id, row.business_account_id])),
    [dialogBusinessMessageLinks],
  );
  const { data: dialogBusinessAccounts = [] } = useQuery({
    queryKey: ["telegram-dialog-business-senders", dialogBusinessAccountIds],
    queryFn: async () => {
      if (!dialogBusinessAccountIds.length) return [];
      const { data, error } = await supabase
        .from("telegram_business_connections")
        .select("id, bot_id, first_name, last_name, username, can_reply, is_enabled")
        .in("id", dialogBusinessAccountIds);
      if (error) throw error;
      return data || [];
    },
    enabled: dialogBusinessAccountIds.length > 0,
    staleTime: 30_000,
  });
  const selectedBusinessAccount = useMemo(
    () => dialogBusinessAccounts.find((account) => account.id === selectedBusinessAccountId) || businessAccount || null,
    [dialogBusinessAccounts, selectedBusinessAccountId, businessAccount],
  );
  const selectedSender = selectedBusinessAccountId
    ? `business:${selectedBusinessAccountId}`
    : selectedBotId ? `bot:${selectedBotId}` : "";
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const didInitialScrollRef = useRef(false);
  const lastUserIdRef = useRef<string | null>(null);
  const lastIsActiveRef = useRef<boolean>(true);
  
  // Anti double-click protection for send button
  const lastSendTimeRef = useRef<number>(0);
  const SEND_DEBOUNCE_MS = 500;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputFocusRef = useRef<(() => void) | null>(null);

  const prevMessageCountRef = useRef<number>(0);
  // Observed boundary, зафиксированная в onMutate ДО отправки (corrective S2).
  const pendingBoundaryRef = useRef<string | null>(null);
  const pendingReplyScopeRef = useRef<{
    transport: "bot" | "business";
    botId: string | null;
    businessAccountId: string | null;
  } | null>(null);
  const localMediaUrlsRef = useRef<string[]>([]);
  const stickyScrollUntilRef = useRef(0);
  const shouldStickToBottomRef = useRef(true);
  const mediaUrlRequestsRef = useRef<Set<string>>(new Set());
  const STICKY_THRESHOLD = 260;

  // === AUTO-REFRESH FOR PENDING MEDIA ===
  const pendingAutoRefreshRef = useRef<number | null>(null);
  const pendingRefreshCountRef = useRef(0);
  const MAX_PENDING_REFRESH_ATTEMPTS = 30; // 1 minute at 2s interval
  const PENDING_REFRESH_INTERVAL = 2000; // 2 seconds

  /**
   * V1.3: identity-preserving merge.
   * - If a `next` item is byte-identical (by render signature) to `prev`, we
   *   REUSE the prev object reference — bubble memo does not re-render.
   * - If the incoming row is worse (missing file_url), we keep the enriched URL.
   * - If the whole set is identical (same ids, same order, no changes), we
   *   return the `prev` array reference — downstream memos stay stable.
   */
  function mergeByIdPreferEnriched(prev: TelegramMessage[], next: TelegramMessage[]) {
    const prevById = new Map<string, TelegramMessage>();
    const prevSigs = new Map<string, string>();
    for (const p of prev) {
      prevById.set(p.id, p);
      prevSigs.set(p.id, messageRenderSignature(p));
    }

    const nextById = new Map<string, TelegramMessage>();
    let anyChange = false;

    for (const m of next) {
      const old = prevById.get(m.id);
      if (!old) {
        nextById.set(m.id, m);
        anyChange = true;
        continue;
      }
      const oldMeta: any = (old as any).meta ?? {};
      const newMeta: any = (m as any).meta ?? {};
      const oldUrl: string | null =
        oldMeta.file_url ?? (old as any).file_url ?? (old as any).fileUrl ?? null;
      const newUrl: string | null =
        newMeta.file_url ?? (m as any).file_url ?? (m as any).fileUrl ?? null;

      const candidate: TelegramMessage =
        oldUrl && !newUrl
          ? ({ ...m, meta: { ...newMeta, file_url: oldUrl } } as TelegramMessage)
          : m;

      if (messageRenderSignature(candidate) === prevSigs.get(m.id)) {
        // reuse prev reference — bubble memo stays intact
        nextById.set(m.id, old);
      } else {
        nextById.set(m.id, candidate);
        anyChange = true;
      }
    }

    // Preserve prev-only ids too (e.g., optimistic temps not in next yet).
    for (const p of prev) {
      if (!nextById.has(p.id)) {
        nextById.set(p.id, p);
        anyChange = true;
      }
    }

    if (!anyChange && nextById.size === prev.length) {
      // Same set — check order too. If ordered the same, return prev ref.
      let sameOrder = true;
      let i = 0;
      for (const p of prev) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        if (nextById.get(p.id) !== p) { sameOrder = false; break; }
        i++;
      }
      if (sameOrder && i === prev.length) return prev;
    }

    return Array.from(nextById.values()).sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
  }

  // Row → TelegramMessage mapper (shared by lean + full queries).
  // Both RPCs return the same flattened shape; lean adds `is_truncated`.
  function mapRowsToMessages(rows: any[]): TelegramMessage[] {
    return [...rows].reverse().map((r) => ({
      id: r.id,
      type: "message" as const,
      direction: r.direction,
      message_text: r.message_text,
      is_truncated: r.is_truncated ?? false,
      message_id: r.message_id,
      reply_to_message_id: r.reply_to_message_id ?? null,
      status: r.status,
      created_at: r.created_at,
      sent_by_admin: r.sent_by_admin ?? null,
      bot_id: r.bot_id ?? null,
      bot_username: r.bot_username ?? null,
      bot_name: r.bot_name ?? null,
      transport: r.transport ?? null,
      business_connection_id: r.business_connection_id ?? null,
      business_account_id: r.business_account_id ?? null,
      message_origin: r.message_origin ?? null,
      admin_profile: r.sent_by_admin
        ? { full_name: r.admin_full_name, avatar_url: r.admin_avatar_url }
        : null,
      telegram_bots: r.bot_id
        ? { id: r.bot_id, bot_name: r.bot_name, bot_username: r.bot_username }
        : null,
      meta: r.meta ?? null,
      is_read: r.is_read,
      is_pinned: r.is_pinned,
      is_favorite: r.is_favorite,
      error_message: r.error_message,
      telegram_user_id: r.telegram_user_id,
      // media fields flattened by both RPCs
      file_type: r.file_type,
      storage_bucket: r.storage_bucket,
      storage_path: r.storage_path,
      file_url: r.file_url,
      file_name: r.file_name,
      file_size: r.file_size,
      mime_type: r.mime_type,
      duration: r.duration,
      thumbnail_url: r.thumbnail_url,
      automated: r.automated,
      source: r.source,
      upload_status: r.upload_status,
    } as unknown as TelegramMessage));
  }

  // PATCH-CONTACT-CENTER-TELEGRAM-CHAT-PERFORMANCE-V1.1:
  // Two-step read for chat first paint.
  //   Stage 1 (lean): last 20 messages, message_text ≤ 4KB, no reply_markup/meta.
  //     Drives `isLoading` — the only critical path.
  //   Stage 2 (full): last 200 messages, full text/meta. Runs after Stage 1
  //     lands, enriches the cache. Never blocks first paint.
  // Both stages fill the same `["telegram-messages", userId]` cache; downstream
  // optimistic writes (send/edit/delete) keep pointing at that single key.
  // PATCH-CONTACT-CENTER-TELEGRAM-CHAT-PERFORMANCE-V1.2:
  //   1) Removed `placeholderData: (prev) => prev` on both queries — it
  //      leaked previous userId's data between queryKey switches (1-frame
  //      wrong-chat flash). Cache-first is now provided by React Query's
  //      per-key cache alone.
  //   2) `refetchOnMount: false` on both — warm reopens must NOT round-trip
  //      to the server when data is still fresh. Realtime + background
  //      refresh (see fullEnabled effect below) keep the cache honest.
  const { data: leanData, isLoading: leanLoading } = useQuery({
    queryKey: ["telegram-messages-lean", userId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_telegram_messages_lean_v1" as any,
        { p_user_id: userId, p_limit: 20, p_text_limit: 4096 } as any,
      );
      if (error) throw error;
      const mapped = mapRowsToMessages((data || []) as any[]);
      // Seed the shared cache so downstream reads/writes see something
      // immediately, and Stage 2 can merge into a warm cache.
      queryClient.setQueryData(
        ["telegram-messages", userId],
        (old: TelegramMessage[] | undefined) => mergeByIdPreferEnriched(old || [], mapped),
      );
      return mapped;
    },
    enabled: !!userId,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchInterval: false,
    refetchOnReconnect: false,
  });

  // V1.2: Stage 2 (full RPC) is deferred out of the warm critical path.
  // It only fires after first paint (requestIdleCallback) and only when
  // full-cache is missing or older than 120 s for THIS userId. Warm
  // reopens with fresh full-cache skip the RPC entirely.
  const [fullEnabled, setFullEnabled] = useState(false);
  // Freshness marker stored in queryClient so it survives remount of this
  // component (e.g., inbox → chat navigation cycles).
  const fullFreshnessKey = ["telegram-messages-full-at", userId] as const;
  useEffect(() => {
    setFullEnabled(false);
    if (!userId || !leanData) return;

    const lastFullAt = queryClient.getQueryData<number>(fullFreshnessKey);
    const isFullFresh = lastFullAt && Date.now() - lastFullAt < 120_000;
    if (isFullFresh) return; // warm hit — no RPC on critical path



    const w = window as any;
    const cancel = (h: any) => {
      if (typeof w.cancelIdleCallback === "function") {
        try { w.cancelIdleCallback(h); } catch { /* noop */ }
      } else {
        clearTimeout(h);
      }
    };
    const handle =
      typeof w.requestIdleCallback === "function"
        ? w.requestIdleCallback(() => setFullEnabled(true), { timeout: 500 })
        : setTimeout(() => setFullEnabled(true), 80);
    return () => cancel(handle);
  }, [userId, leanData]);

  const { data: fullData, refetch: refetchMessages } = useQuery({
    queryKey: ["telegram-messages", userId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_telegram_messages_fast_v1", {
        p_user_id: userId,
        p_limit: 200,
      });
      if (error) throw error;
      const nextMessages = mapRowsToMessages((data || []) as any[]);
      setHasOlderMessages(nextMessages.length === 200);
      const prevMessages =
        (queryClient.getQueryData(["telegram-messages", userId]) as TelegramMessage[] | undefined) || [];
      return mergeByIdPreferEnriched(prevMessages, nextMessages);
    },
    enabled: !!userId && fullEnabled,
    // The lean stage seeds this same cache key. It must be stale when Stage 2
    // becomes enabled, otherwise React Query treats the 20-row lean seed as a
    // complete fresh result and silently skips the full-history request.
    staleTime: 0,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchInterval: false,
    refetchOnReconnect: false,
  });

  // Track successful full-fetch per user, so subsequent warm reopens skip
  // the RPC while the cache is fresh (<120 s). Stored in queryClient so
  // it survives component remount.
  useEffect(() => {
    if (fullData && userId) {
      queryClient.setQueryData(fullFreshnessKey, Date.now());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullData, userId]);

  // Rendered messages: prefer full (enriched) if available, otherwise lean.
  // `messagesLoading` is bound to Stage 1 only — Stage 2 never blocks paint.
  const messages = fullData ?? leanData;
  const messagesLoading = leanLoading && !leanData && !fullData;
  const { data: unansweredItems = [] } = useQuery({
    queryKey: ["contact-center-unanswered", userId],
    enabled: !!userId,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_contact_center_unanswered_v1" as any, {
        p_user_id: userId,
      } as any);
      if (error) throw error;
      return (data || []) as Array<{ id: string; message_text: string | null; created_at: string }>;
    },
  });

  useEffect(() => {
    setHasOlderMessages(true);
    setIsLoadingOlderMessages(false);
  }, [userId]);

  const loadOlderMessages = useCallback(async () => {
    if (isLoadingOlderMessages || !messages?.length) return;

    const persistedMessages = messages.filter(
      (item) => item.id && !item.id.startsWith("temp-") && item.created_at,
    );
    if (persistedMessages.length === 0) {
      setHasOlderMessages(false);
      return;
    }

    const oldest = persistedMessages.reduce((candidate, item) => {
      const candidateTime = new Date(candidate.created_at).getTime();
      const itemTime = new Date(item.created_at).getTime();
      if (itemTime !== candidateTime) return itemTime < candidateTime ? item : candidate;
      return item.id < candidate.id ? item : candidate;
    });

    const viewport = scrollRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]",
    ) as HTMLElement | null;
    const previousHeight = viewport?.scrollHeight ?? 0;
    const previousTop = viewport?.scrollTop ?? 0;

    setIsLoadingOlderMessages(true);
    try {
      const { data, error } = await supabase.rpc(
        "admin_get_telegram_messages_page_v2" as any,
        {
          p_user_id: userId,
          p_before_created_at: oldest.created_at,
          p_before_id: oldest.id,
          p_limit: 100,
        } as any,
      );
      if (error) throw error;

      const older = mapRowsToMessages((data || []) as any[]);
      queryClient.setQueryData(
        ["telegram-messages", userId],
        (current: TelegramMessage[] | undefined) =>
          mergeByIdPreferEnriched(current || messages, older),
      );
      setHasOlderMessages(older.length === 100);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!viewport) return;
          viewport.scrollTop = previousTop + (viewport.scrollHeight - previousHeight);
        });
      });
    } catch (error) {
      toast.error("Не удалось загрузить предыдущие сообщения: " + formatChatError(error));
    } finally {
      setIsLoadingOlderMessages(false);
    }
  }, [isLoadingOlderMessages, messages, queryClient, userId]);

  // Fetch events from telegram_logs - optimized
  const { data: events, isLoading: eventsLoading, refetch: refetchEvents } = useQuery({
    queryKey: ["telegram-events", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("telegram_logs")
        .select("id, action, status, created_at, meta, message_text")
        .eq("user_id", userId)
        .not("action", "in", "(ADMIN_CHAT_MESSAGE,ADMIN_CHAT_FILE)")
        .order("created_at", { ascending: true })
        .limit(50);
      if (error) throw error;
      return (data || []).map((e: any) => ({ ...e, type: "event" })) as TelegramEvent[];
    },
    enabled: !!userId,
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });

  // Fetch billing/subscription events from audit_logs
  const { data: billingEvents, isLoading: billingLoading, refetch: refetchBilling } = useQuery({
    queryKey: ["billing-events", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("id, action, created_at, meta")
        .eq("target_user_id", userId)
        .in("action", [
          "subscription.charged",
          "subscription.renewal_order_created",
          "subscription.purchased",
          "subscription.created",
          "subscription.activated",
          "subscription.expired",
          "subscription.canceled",
          "subscription.charge_failed",
          "subscription.gc_sync_renewal_success",
          "subscription.gc_sync_renewal_failed",
          "payment.success",
          "payment.failed",
          "telegram.backfill_grant",
        ])
        .order("created_at", { ascending: true })
        .limit(50);
      if (error) throw error;
      return (data || []).map((e: any) => ({ 
        ...e, 
        type: "event",
        status: "ok",
      })) as TelegramEvent[];
    },
    enabled: !!userId,
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });

  // Telegram does not echo a bot's own sendMessage response back through the
  // webhook. Historical join decisions therefore exist only in the access
  // audit. Surface those records so old technical replies are not invisible;
  // new replies are persisted as normal outgoing telegram_messages by webhook.
  const { data: accessEvents } = useQuery({
    queryKey: ["telegram-access-events", telegramUserId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("telegram_access_audit")
        .select("id, event_type, created_at, reason, meta")
        .eq("telegram_user_id", telegramUserId!)
        .in("event_type", ["JOIN_APPROVED", "JOIN_DECLINED"])
        .order("created_at", { ascending: true })
        .limit(50);
      if (error) throw error;
      return (data || []).map((event: any) => ({
        id: `access-${event.id}`,
        type: "event" as const,
        action: event.event_type,
        status: "success",
        created_at: event.created_at,
        message_text:
          event.event_type === "JOIN_DECLINED"
            ? "Заявка отклонена. Активный доступ к клубу не был найден."
            : "Заявка одобрена. Доступ в клуб открыт.",
        meta: { ...(event.meta || {}), reason: event.reason || null, source: "telegram_access_audit" },
      })) as TelegramEvent[];
    },
    enabled: !!telegramUserId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  // Combine and sort messages + telegram events + billing events.
  // PATCH: Hide event-pills that mirror a real outgoing telegram_messages bubble.
  // Rules:
  //   - status must be 'success' (failed/skipped stay visible as diagnostic pills);
  //   - whitelist of admin/notification actions that are normally mirrored to chat;
  //   - either bubble exists in ±5min window (heuristic) OR meta marks it as mirrored,
  //     OR text is empty (no value to show as pill).
  const normalizeText = (t?: string | null) =>
    (t || "").replace(/\s+/g, " ").trim().toLowerCase();

  const MIRRORABLE_ACTIONS = new Set<string>([
    'SEND_REMINDER',
    'manual_notification',
    'MANUAL_NOTIFICATION',
    'custom',
    'telegram.notification.sent',
    // Auto/manual access grants — backend mirrors them as a real outgoing
    // bubble in telegram_messages, so the event-pill is redundant.
    'AUTO_GRANT',
    'MANUAL_GRANT',
    'JOIN_APPROVED',
    'JOIN_DECLINED',
    // subscription_reminder_*d are matched via prefix below
  ]);

  const SUCCESSFUL_STATUSES = new Set<string>(['success', 'ok', 'sent']);

  // V1.2: chatItems is now memoized on [messages, events, billingEvents].
  // Draft/highlighted/unread state changes no longer rebuild the array
  // (so downstream map + date/time precompute stays reference-stable).
  const chatItems = useMemo<ChatItem[]>(() => {
    const msgs = messages || [];
    const outgoingMirrored = msgs.filter(
      (m: any) => m.direction === 'outgoing' && (m.meta?.automated === true || m.meta?.source)
    );
    const mirroredAt: number[] = outgoingMirrored.map((m: any) => new Date(m.created_at).getTime());
    const mirroredTexts = new Set(outgoingMirrored.map((m: any) => normalizeText(m.message_text)));

    const isMirrored = (e: TelegramEvent): boolean => {
      const action = e.action || '';
      const isMirrorable =
        MIRRORABLE_ACTIONS.has(action) ||
        action.startsWith('subscription_reminder_');
      if (!isMirrorable) return false;
      if (!SUCCESSFUL_STATUSES.has(String(e.status || ''))) return false;
      if ((e.meta as any)?.mirrored_to_telegram_messages === true) return true;
      const mirroredTgId = (e.meta as any)?.telegram_message_id;
      if (typeof mirroredTgId === 'number' && mirroredTgId > 0) {
        const hit = msgs.some((m: any) => m.message_id === mirroredTgId);
        if (hit) return true;
      }
      if (!e.message_text || !e.message_text.trim()) return true;
      if (mirroredTexts.has(normalizeText(e.message_text))) return true;
      const t = new Date(e.created_at).getTime();
      return mirroredAt.some((mt) => Math.abs(mt - t) <= 300_000);
    };

    return [
      ...msgs,
      ...((events || []).filter((e) => !isMirrored(e as TelegramEvent))),
      ...(accessEvents || []),
      ...(billingEvents || []),
    ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, events, accessEvents, billingEvents]);

  // V1.3: reactions moved above chatItemsWithMeta so precompute has access.
  const telegramMessageIds = useMemo(
    () => (messages || []).map((m: TelegramMessage) => m.id).filter(Boolean),
    [messages]
  );
  const { data: telegramReactionsMap } = useTelegramReactions(telegramMessageIds);
  const toggleTelegramReaction = useToggleTelegramReaction();

  // V1.3: chatItemsWithMeta emits fully-flat bubble data for each row.
  // Deps: chatItems + reactions + labels/bots (no draft/highlighted/hover).
  const chatItemsWithMeta = useMemo<Array<{
    key: string;
    showDateSeparator: boolean;
    dateLabel: string;
    bubble: MessageBubbleData | EventBubbleData;
  }>>(() => {
    // H4 fix: build tgId → message map once for quote preview lookup.
    const byTgId = new Map<number, TelegramMessage>();
    for (const it of chatItems) {
      if (it.type === "message") {
        const mm = it as TelegramMessage;
        if (mm.message_id) byTgId.set(mm.message_id, mm);
      }
    }

    return chatItems.map((item, index) => {
      const currentDate = new Date(item.created_at);
      const prevItem = index > 0 ? chatItems[index - 1] : null;
      const prevDate = prevItem ? new Date(prevItem.created_at) : null;
      const showDateSeparator = !prevDate || !isSameDay(currentDate, prevDate);
      const dateLabel = showDateSeparator
        ? (isToday(currentDate)
            ? "Сегодня"
            : isYesterday(currentDate)
              ? "Вчера"
              : format(currentDate, "dd.MM.yyyy", { locale: ru }))
        : "";
      const timeShort = format(currentDate, "HH:mm", { locale: ru });
      const timeMedium = format(currentDate, "dd.MM HH:mm", { locale: ru });

      if (item.type === "event") {
        const ev = item as TelegramEvent;
        const meta = ev.meta as Record<string, unknown> | undefined;
        let displayText = getEventLabel(ev.action);
        if (ev.action === 'AUTO_GRANT' || ev.action === 'MANUAL_GRANT') {
          const clubName = (meta?.club_name || meta?.product_name || '') as string;
          const tariffName = meta?.tariff_name as string | undefined;
          const accessEndDate = meta?.access_end_date as string | undefined;
          const validUntil = meta?.valid_until as string | undefined;
          const endDate = accessEndDate || (validUntil ? new Date(validUntil).toLocaleDateString('ru-RU') : null);
          const prefix = ev.action === 'AUTO_GRANT' ? 'Авто-выдача' : 'Ручная выдача';
          const productInfo = clubName || 'Клуб';
          const tariffInfo = tariffName ? ` тариф ${tariffName}` : '';
          const dateInfo = endDate ? ` до ${endDate}` : '';
          displayText = `${prefix}: ${productInfo}${tariffInfo}${dateInfo}`;
        }
        const isSkipped = ev.status === 'skipped';
        const isFailed = ev.status === 'failed' || ev.status === 'error';
        const isSuccess = ev.status === 'success';
        const skipReason = (meta?.reason || meta?.skip_reason) as string | undefined;
        const errorMsg = (meta as any)?.error_message as string | undefined;
        const statusSuffix = isSkipped ? ' · не отправлено' : isFailed ? ' · ошибка отправки' : '';
        const title = skipReason ? `Причина: ${skipReason}` : errorMsg || null;
        const evData: EventBubbleData = {
          kind: "event",
          key: ev.id,
          id: ev.id,
          action: ev.action,
          displayText,
          statusSuffix,
          status: String(ev.status || ''),
          isSkipped,
          isFailed,
          isSuccess,
          skipReason: skipReason || null,
          errorMessage: errorMsg || null,
          hasMessageText: !!ev.message_text,
          messageText: ev.message_text || null,
          timeMedium,
          title,
        };
        return { key: ev.id, showDateSeparator, dateLabel, bubble: evData };
      }

      const msg = item as TelegramMessage;
      const metaAny: any = (msg as any).meta ?? {};
      const msgAny: any = msg as any;

      const fileType = (metaAny.file_type ?? metaAny.fileType ?? msgAny.file_type ?? msgAny.fileType ?? null) as string | null;
      const fileName = (metaAny.file_name ?? metaAny.fileName ?? msgAny.file_name ?? msgAny.fileName ?? null) as string | null;
      const fileUrl = (metaAny.file_url ?? metaAny.fileUrl ?? msgAny.file_url ?? msgAny.fileUrl ?? null) as string | null;
      const mimeType = (metaAny.mime_type ?? metaAny.mimeType ?? msgAny.mime_type ?? msgAny.mimeType ?? null) as string | null;
      const bucket = (metaAny.storage_bucket ?? metaAny.storageBucket ?? msgAny.storage_bucket ?? msgAny.storageBucket ?? null) as string | null;
      const path = (metaAny.storage_path ?? metaAny.storagePath ?? msgAny.storage_path ?? msgAny.storagePath ?? null) as string | null;
      const uploadError = (metaAny.upload_error ?? metaAny.uploadError ?? msgAny.upload_error ?? msgAny.uploadError ?? null) as string | null;
      const uploadStatus = (metaAny.upload_status ?? metaAny.uploadStatus ?? msgAny.upload_status ?? null) as string | null;

      const fileNameLooksLikeMedia = /\.(pdf|png|jpe?g|webp|gif|mp4|mov|mp3|m4a|ogg|wav|webm|oga|opus)$/i.test(fileName || "");
      const isMediaLike = !!(fileType || mimeType || (bucket && path) || fileNameLooksLikeMedia);

      const isEdited = !!(metaAny.edited ?? (msg as any).edited);
      const isDeleted = !!(msg.status === "deleted" || metaAny.deleted || (msg as any).deleted);
      const isManualBusinessMessage = (msg.meta as any)?.message_origin === "owner_manual";
      const canEdit = msg.direction === "outgoing" && !!msg.message_id && msg.status === "sent" && !fileType && !isDeleted && !isManualBusinessMessage;
      const canDelete = msg.direction === "outgoing" && !!msg.message_id && msg.status === "sent" && !isDeleted;

      // Quote precompute (H4 fix — no lookup in bubble render).
      let hasReply = false;
      let quotedMessageDbId: string | null = null;
      let quotedPreview: string | null = null;
      let quotedAuthor: string | null = null;
      let quotedMissing = false;
      if (msg.reply_to_message_id) {
        hasReply = true;
        const quoted = byTgId.get(msg.reply_to_message_id) || null;
        if (quoted) {
          quotedMessageDbId = quoted.id;
          quotedPreview = buildQuotePreview(quoted);
          quotedAuthor = quoted.direction === "outgoing"
            ? (quoted.admin_profile?.full_name || "Администратор")
            : (clientName || "Клиент");
        } else {
          quotedMissing = true;
          quotedAuthor = "Сообщение";
          quotedPreview = null;
        }
      }

      // The connected bot is only the transport bridge for Telegram Business.
      // Show the personal account identity for Business messages and reserve
      // the bot label for ordinary Bot API conversations.
      const joined = msg.telegram_bots;
      const fromMap = msg.bot_id ? botsMap.get(msg.bot_id) : null;
      const botNameRaw = msg.bot_name ?? joined?.bot_name ?? fromMap?.bot_name ?? null;
      const botUsernameRaw = msg.bot_username ?? joined?.bot_username ?? fromMap?.bot_username ?? null;
      const flattenedSource = (msgAny.source ?? null) as string | null;
      const messageSource = (metaAny.source ?? flattenedSource) as string | null;
      const businessAccountId = msg.business_account_id ?? businessAccountIdByMessageId.get(msg.id) ?? null;
      const resolvedBusinessAccount = businessAccountId
        ? dialogBusinessAccounts.find((account) => account.id === businessAccountId) ?? null
        : dialogBusinessAccounts.length === 1
          ? dialogBusinessAccounts[0]
          : null;
      const botLabel = getTelegramMessageIdentityLabel({
        direction: msg.direction,
        transport: msg.transport ?? null,
        source: messageSource,
        messageOrigin: msg.message_origin ?? metaAny.message_origin ?? null,
        businessAccount: resolvedBusinessAccount as TelegramBusinessIdentity | null,
        botName: botNameRaw,
        botUsername: botUsernameRaw,
      });

      // Automated badge.
      const automated = msg.direction === "outgoing" && !msg.sent_by_admin && !!(msg.meta as any)?.automated;
      const automatedSource = (msg.meta as any)?.source as string | undefined;
      const automatedTitle = automated
        ? (automatedSource ? `Автоматическое сообщение · ${automatedSource}` : "Автоматическое сообщение")
        : null;

      // Inline keyboard url-only rows + signature.
      const rm = (msg.meta as any)?.reply_markup;
      const rowsIn: Array<Array<{ text?: string; url?: string }>> = Array.isArray(rm?.inline_keyboard) ? rm.inline_keyboard : [];
      const urlRows = rowsIn
        .map((row) => row.filter((b) => b && typeof b.url === "string" && b.url.trim().length > 0))
        .filter((row) => row.length > 0);
      const inlineUrlSignature = urlRows.length
        ? urlRows.map((r) => r.map((b) => `${b.text ?? ""}::${b.url ?? ""}`).join("|")).join("~")
        : "";

      // Reactions (H5 fix): stable empty ref, comparator uses signature.
      const rxRaw = telegramReactionsMap?.[msg.id];
      const reactionsForRow = rxRaw && rxRaw.length ? rxRaw : EMPTY_REACTIONS;
      const reactionsSignature = buildReactionsSignature(reactionsForRow);

      const bubbleData: MessageBubbleData = {
        kind: "message",
        key: msg.id,
        id: msg.id,
        telegramMessageId: msg.message_id ?? null,
        direction: msg.direction,
        status: msg.status,
        createdAt: msg.created_at,
        messageText: msg.message_text ?? null,
        isDeleted,
        isEdited,
        isMediaLike,
        fileType,
        fileUrl,
        fileName,
        mimeType,
        storageBucket: bucket,
        storagePath: path,
        uploadStatus,
        uploadError,
        hasReply,
        quotedMessageDbId,
        quotedPreview,
        quotedAuthor,
        quotedMissing,
        adminName: msg.admin_profile?.full_name ?? null,
        adminAvatarUrl: msg.admin_profile?.avatar_url ?? null,
        clientName: clientName ?? null,
        clientAvatarUrl: avatarUrl ?? null,
        botLabel,
        automated,
        automatedTitle,
        inlineUrlRows: urlRows,
        inlineUrlSignature,
        timeShort,
        canEdit,
        canDelete,
        reactionsForRow,
        reactionsSignature,
      };

      return { key: msg.id, showDateSeparator, dateLabel, bubble: bubbleData };
    });
  }, [
    chatItems,
    telegramReactionsMap,
    clientName,
    avatarUrl,
    botsMap,
    businessAccountIdByMessageId,
    dialogBusinessAccounts,
  ]);

  // PATCH-CONTACT-CENTER-TELEGRAM-CHAT-PERFORMANCE-V1: первый рендер
  // блокируем ТОЛЬКО сообщениями.
  const isLoading = messagesLoading;

  // Скролл к сообщению по DB id + подсветка.
  const scrollToMessage = useCallback((dbId: string) => {
    const el = document.getElementById(`tg-msg-${dbId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedId(dbId);
    setTimeout(() => setHighlightedId(null), 1500);
  }, []);

  // V1.3: stable refs for handler lookups (avoids per-render callback churn).
  const latestMessagesRef = useRef<TelegramMessage[]>([]);
  useEffect(() => { latestMessagesRef.current = messages || []; }, [messages]);
  const toggleReactionRef = useRef(toggleTelegramReaction);
  toggleReactionRef.current = toggleTelegramReaction;

  // Check if any messages have pending upload status
  const hasPendingMedia = useMemo(() => {
    if (!messages) return false;
    return messages.some((m: TelegramMessage) => {
      const meta = m.meta || {};
      return (meta as any).upload_status === 'pending';
    });
  }, [messages]);

  // Reset sender immediately on dialog switch so the footer doesn't flash
  // the previous chat's sender while the next dialog context is loading.
  useEffect(() => {
    senderWasChosenManuallyRef.current = false;
    setSelectedBotId(null);
    setSelectedBusinessAccountId(null);
  }, [userId]);

  // === DEFAULT SENDER SELECTION ===
  useEffect(() => {
    if (senderWasChosenManuallyRef.current) return;

    const selection = selectDefaultTelegramSender({
      messages: businessContext
        ? [{
            direction: "incoming",
            created_at: businessContext.created_at,
            transport: businessContext.transport,
            bot_id: businessContext.bot_id,
            business_account_id: businessContext.business_account_id,
          }]
        : [],
      activeBots,
      businessAccount,
    });
    setSelectedBotId(selection?.botId ?? null);
    setSelectedBusinessAccountId(selection?.businessAccountId ?? null);
  }, [businessContext, activeBots, userId, businessAccount]);

  const handleBotChange = (botId: string) => {
    senderWasChosenManuallyRef.current = true;
    setSelectedBotId(botId);
    setSelectedBusinessAccountId(null);
  };

  const handleSenderChange = (value: string) => {
    senderWasChosenManuallyRef.current = true;
    if (value.startsWith("business:")) {
      const accountId = value.slice("business:".length);
      setSelectedBusinessAccountId(accountId);
      setSelectedBotId(null);
    } else {
      handleBotChange(value.slice("bot:".length));
      return;
    }
  };

  const refetch = useCallback(() => {
    refetchMessages();
    refetchEvents();
    refetchBilling();
  }, [refetchMessages, refetchEvents, refetchBilling]);

  const getScrollViewport = useCallback((): HTMLElement | null => {
    return (scrollRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]"
    ) as HTMLElement | null) ?? null;
  }, []);

  const isNearBottom = useCallback((threshold = STICKY_THRESHOLD) => {
    const vp = getScrollViewport();
    if (!vp) return true;
    return vp.scrollHeight - vp.scrollTop - vp.clientHeight < threshold;
  }, [getScrollViewport]);

  const pinToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const vp = getScrollViewport();
    if (!vp) return;
    vp.scrollTo({ top: vp.scrollHeight, behavior });
  }, [getScrollViewport]);

  const startStickyScroll = useCallback((durationMs = 1800) => {
    shouldStickToBottomRef.current = true;
    stickyScrollUntilRef.current = performance.now() + durationMs;

    const tick = () => {
      if (!shouldStickToBottomRef.current) return;
      pinToBottom("auto");
      if (performance.now() < stickyScrollUntilRef.current) {
        requestAnimationFrame(tick);
      }
    };

    requestAnimationFrame(() => requestAnimationFrame(tick));
  }, [pinToBottom]);

  useEffect(() => {
    return () => {
      localMediaUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      localMediaUrlsRef.current = [];
    };
  }, []);

  // Debounced refetch to prevent parallel requests on mobile
  const refetchTimerRef = useRef<number | null>(null);
  const isRefetchingRef = useRef(false);

  const debouncedRefetch = useCallback(() => {
    if (refetchTimerRef.current) {
      window.clearTimeout(refetchTimerRef.current);
    }
    refetchTimerRef.current = window.setTimeout(async () => {
      if (isRefetchingRef.current) return;
      isRefetchingRef.current = true;
      try {
        await refetchMessages();
      } finally {
        isRefetchingRef.current = false;
      }
    }, 1000);
  }, [refetchMessages]);

  // Subscribe to realtime messages for this user — INSERT (new) + UPDATE (media enrichment)
  // Channel name uses an instance-unique suffix so multiple components mounted for the same
  // userId (e.g. InboxTabContent + ContactDetailSheet) don't collide on a single channel.
  const instanceIdRef = useRef<string>(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  );

  useEffect(() => {
    // Strict UUID guard — never subscribe with empty/invalid userId (filter would silently miss).
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!userId || !UUID_RE.test(userId)) {
      console.warn("[ContactTelegramChat][realtime] skip subscribe — invalid userId:", userId);
      return;
    }

    const filter = `user_id=eq.${userId}`;
    const channelName = `chat-messages-${userId}-${instanceIdRef.current}`;
    console.log("[ContactTelegramChat][realtime] subscribing", { channelName, filter });

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "telegram_messages",
          filter,
        },
        (payload) => {
          const newMsg = payload.new as any;
          console.log("[ContactTelegramChat][realtime] INSERT", { id: newMsg?.id, user_id: newMsg?.user_id, direction: newMsg?.direction });
          const msgText = (newMsg?.message_text || "").trim();
          const msgTime = new Date(newMsg?.created_at || Date.now()).getTime();
          if (newMsg?.direction === "incoming") {
            queryClient.setQueryData(
              ["telegram-latest-incoming-sender-context", userId],
              {
                business_connection_id: newMsg.business_connection_id ?? null,
                business_account_id: newMsg.business_account_id ?? null,
                bot_id: newMsg.bot_id ?? null,
                transport: newMsg.transport ?? "bot",
                created_at: newMsg.created_at,
              },
            );
          }

          // Patch cache: merge incoming row directly, drop matching temp row.
          // Dedup by telegram_messages.id — guard against double-insert from realtime + fallback refetch.
          queryClient.setQueryData(
            ["telegram-messages", userId],
            (old: TelegramMessage[] | undefined) => {
              const list = old ? [...old] : [];
              if (list.some((m) => m.id === newMsg.id)) return list;
              const filtered = list.filter((m) => {
                if (!m.id.startsWith("temp-")) return true;
                const tempText = (m.message_text || "").trim();
                const tempTime = new Date(m.created_at).getTime();
                const textMatches = tempText === msgText || (tempText.startsWith("📎") && msgText === "");
                const timeClose = Math.abs(tempTime - msgTime) < 10000;
                return !(textMatches && timeClose);
              });
              filtered.push({ ...newMsg, type: "message" });
              filtered.sort(
                (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
              );
              return filtered;
            }
          );

          const isFromAdmin = newMsg?.direction === "outgoing";
          const _nearBottom = isNearBottom();
          if (isFromAdmin || _nearBottom) {
            startStickyScroll(2600);
          } else {
            setUnreadCount((c) => c + 1);
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "telegram_messages",
          filter,
        },
        (payload) => {
          const updated = payload.new as any;
          const shouldPin = isNearBottom();
          queryClient.setQueryData(
            ["telegram-messages", userId],
            (old: TelegramMessage[] | undefined) => {
              if (!old) return old;
              let found = false;
              const next = old.map((m) => {
                if (m.id === updated.id) {
                  found = true;
                  return { ...m, ...updated, type: "message" } as TelegramMessage;
                }
                return m;
              });
              if (!found) {
                next.push({ ...updated, type: "message" } as TelegramMessage);
                next.sort(
                  (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
                );
              }
              return next;
            }
          );
          if (shouldPin) startStickyScroll(2600);
        }
      )
      .subscribe((status, err) => {
        console.log("[ContactTelegramChat][realtime] status", { channelName, status, err });
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          // Fallback safety net: realtime not delivering → trigger a debounced refetch
          // so the open chat doesn't get stuck without the latest message.
          console.warn("[ContactTelegramChat][realtime] fallback refetch triggered due to status", status);
          debouncedRefetch();
        }
      });

    // Fallback refetch hook: when the LEFT inbox list invalidates the per-user message cache
    // (it does so on its own realtime INSERT), perform a safe refetch in the open right panel
    // even if our channel didn't fire. Dedup is handled inside the query (mergeByIdPreferEnriched).
    const inboxBridgeChannel = supabase
      .channel(`chat-bridge-${userId}-${instanceIdRef.current}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "telegram_messages",
          filter,
        },
        (payload) => {
          const row = payload.new as any;
          const cached = queryClient.getQueryData(["telegram-messages", userId]) as
            | TelegramMessage[]
            | undefined;
          const alreadyHave = !!cached?.some((m) => m.id === row?.id);
          if (!alreadyHave) {
            console.log("[ContactTelegramChat][realtime] bridge fallback refetch — message missing in cache", row?.id);
            debouncedRefetch();
          }
        }
      )
      .subscribe();

    return () => {
      if (refetchTimerRef.current) {
        window.clearTimeout(refetchTimerRef.current);
      }
      console.log("[ContactTelegramChat][realtime] unsubscribing", { channelName });
      supabase.removeChannel(channel);
      supabase.removeChannel(inboxBridgeChannel);
    };
  }, [userId, queryClient, isNearBottom, startStickyScroll, debouncedRefetch]);

  const mediaIdsNeedingUrls = useMemo(() => {
    return (messages || [])
      .filter((m: TelegramMessage) => {
        const meta: any = m.meta || {};
        return meta.storage_bucket && meta.storage_path && !meta.file_url && meta.upload_status === "ok";
      })
      .map((m) => m.id);
  }, [messages]);

  useEffect(() => {
    const ids = mediaIdsNeedingUrls.filter((id) => !mediaUrlRequestsRef.current.has(id));
    if (!ids.length) return;
    ids.forEach((id) => mediaUrlRequestsRef.current.add(id));

    supabase.functions.invoke("telegram-admin-chat", {
      body: { action: "get_media_urls", message_ids: ids },
    }).then(({ data, error }) => {
      if (error || !data?.urls) return;
      queryClient.setQueryData(["telegram-messages", userId], (old: TelegramMessage[] | undefined) => {
        if (!old) return old;
        return old.map((m) => {
          const url = data.urls[m.id];
          if (!url) return m;
          return { ...m, meta: { ...(m.meta || {}), file_url: url } } as TelegramMessage;
        });
      });
      if (isNearBottom()) startStickyScroll(2600);
    });
  }, [mediaIdsNeedingUrls, queryClient, userId, isNearBottom, startStickyScroll]);

  // === AUTO-REFRESH EFFECT FOR PENDING MEDIA ===
  // Polls every 10s if there are pending uploads, stops after 12 attempts (2 min)
  useEffect(() => {
    // Clear existing timer
    if (pendingAutoRefreshRef.current) {
      window.clearInterval(pendingAutoRefreshRef.current);
      pendingAutoRefreshRef.current = null;
    }

    // Reset counter when no pending or when user changes
    if (!hasPendingMedia) {
      pendingRefreshCountRef.current = 0;
      return;
    }

    // Start polling if there are pending items and haven't exceeded max attempts
    if (hasPendingMedia && pendingRefreshCountRef.current < MAX_PENDING_REFRESH_ATTEMPTS) {
      console.log(`[AUTO-REFRESH] Starting polling for pending media (attempt ${pendingRefreshCountRef.current + 1}/${MAX_PENDING_REFRESH_ATTEMPTS})`);
      
      pendingAutoRefreshRef.current = window.setInterval(async () => {
        // Stop if max attempts reached
        if (pendingRefreshCountRef.current >= MAX_PENDING_REFRESH_ATTEMPTS) {
          console.log("[AUTO-REFRESH] Max attempts reached, stopping polling");
          if (pendingAutoRefreshRef.current) {
            window.clearInterval(pendingAutoRefreshRef.current);
            pendingAutoRefreshRef.current = null;
          }
          return;
        }

        // Skip if already refetching
        if (isRefetchingRef.current) {
          console.log("[AUTO-REFRESH] Skipping - already refetching");
          return;
        }
        
        isRefetchingRef.current = true;
        pendingRefreshCountRef.current += 1;
        
        try {
          console.log(`[AUTO-REFRESH] Refreshing messages (attempt ${pendingRefreshCountRef.current}/${MAX_PENDING_REFRESH_ATTEMPTS})`);
          await refetchMessages();
          
          // === EARLY STOP: Check if pending disappeared after refetch ===
          // Get fresh data from query cache
          const freshMessages = queryClient.getQueryData(["telegram-messages", userId]) as TelegramMessage[] | undefined;
          const stillHasPending = freshMessages?.some((m) => m.meta?.upload_status === 'pending');
          
          if (!stillHasPending) {
            console.log("[AUTO-REFRESH] No more pending media, stopping polling early");
            pendingRefreshCountRef.current = 0;
            if (pendingAutoRefreshRef.current) {
              window.clearInterval(pendingAutoRefreshRef.current);
              pendingAutoRefreshRef.current = null;
            }
          }
          // === END EARLY STOP ===
          
        } finally {
          isRefetchingRef.current = false;
        }
      }, PENDING_REFRESH_INTERVAL);
    }

    return () => {
      if (pendingAutoRefreshRef.current) {
        window.clearInterval(pendingAutoRefreshRef.current);
        pendingAutoRefreshRef.current = null;
      }
    };
  }, [hasPendingMedia, refetchMessages]);

  // Reset pending counter when user changes
  useEffect(() => {
    pendingRefreshCountRef.current = 0;
  }, [userId]);

  // Helper function to translate Telegram API errors to Russian
  const translateTelegramError = (errorMessage: string): string => {
    const translations: Record<string, string> = {
      "Forbidden: bot can't initiate conversation with a user": "Бот не может начать диалог с пользователем. Пользователь должен сначала написать боту.",
      "Forbidden: bot was blocked by the user": "Бот заблокирован пользователем",
      "Bad Request: chat not found": "Чат не найден",
      "Bad Request: message is too long": "Сообщение слишком длинное",
      "Bad Request: PEER_ID_INVALID": "Неверный идентификатор пользователя",
      "Unauthorized": "Ошибка авторизации бота",
      "Failed to fetch photo": "Не удалось загрузить фото",
      "Failed to send message": "Не удалось отправить сообщение",
      "Bad Request: have no rights to send a message": "Нет прав для отправки сообщения",
      "Bad Request: user not found": "Пользователь не найден",
      "business_reply_unavailable": "Telegram не разрешает отвечать от имени подключённого аккаунта",
      "BUSINESS_CONNECTION_INVALID": "Подключение личного Telegram изменилось или было отключено",
      "BUSINESS_PEER_USAGE_MISSING": "Клиент должен снова написать Екатерине, прежде чем можно будет ответить из системы",
    };
    
    // Check for exact match first
    if (translations[errorMessage]) {
      return translations[errorMessage];
    }
    
    // Check for partial matches
    for (const [key, value] of Object.entries(translations)) {
      if (errorMessage.includes(key)) {
        return value;
      }
    }
    
    // Return original if no translation found
    return errorMessage;
  };

  // Унифицированный форматтер ошибок чата:
  // 1) normalizeEdgeFunctionError — раскрывает body Edge Function,
  //    переводит "Failed to send a request to the Edge Function" в человеческое сообщение.
  // 2) translateTelegramError — переводит Telegram-API ошибки на русский.
  const formatChatError = (error: unknown): string => {
    const normalized = normalizeEdgeFunctionError(error);
    return translateTelegramError(normalized);
  };
  // Async-вариант: читает body non-2xx ответа edge-функции (важно для 403
  // `rbac_section_manage_denied`, 400 `selected_bot_inactive`, и т.п.),
  // чтобы пользователь видел точную причину, а не generic «Функция временно недоступна».
  const formatChatErrorAsync = async (error: unknown): Promise<string> => {
    const normalized = await normalizeEdgeFunctionErrorAsync(error);
    return translateTelegramError(normalized);
  };

  // Fetch profile photo from Telegram
  const fetchPhotoMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("telegram-admin-chat", {
        body: { action: "fetch_profile_photo", user_id: userId },
      });
      if (error) throw error;
      if (!data.success) throw new Error(data.error || "Не удалось загрузить фото");
      return data.avatar_url;
    },
    onSuccess: (newAvatarUrl) => {
      if (newAvatarUrl && onAvatarUpdated) {
        onAvatarUpdated(newAvatarUrl);
      }
      queryClient.invalidateQueries({ queryKey: ["inbox-dialogs"] });
      toast.success("Фото профиля обновлено");
    },
    onError: (error) => {
      toast.error("Ошибка загрузки фото: " + formatChatError(error));
    },
  });

  // Send message mutation
  const sendMutation = useMutation({
    mutationFn: async ({
      text,
      file,
      fileType,
      replyToMessageId,
    }: {
      text?: string;
      file?: File;
      fileType?: string;
      replyToMessageId?: number | null;
    }) => {
      let fileData:
        | { type: string; name: string; storage_path: string; storage_bucket: string }
        | undefined;

      if (file) {
        setIsUploading(true);

        // Use provided fileType or auto-detect
        let type = fileType || "document";
        if (!fileType) {
          if (file.type.startsWith("image/")) type = "photo";
          else if (file.type.startsWith("video/")) type = "video";
          else if (file.type.startsWith("audio/")) type = "audio";
        }

        // Все файлы отправляем через storage_path: это исключает падения edge function на base64.
        try {
          const { bucket, path } = await uploadToTelegramMedia(file, userId);
          fileData = { type, name: file.name, storage_path: path, storage_bucket: bucket };
        } catch (e) {
          console.error("Failed to upload file to storage", e);
          throw new Error("Не удалось загрузить файл в хранилище");
        }
      }

      const { data, error } = await supabase.functions.invoke("telegram-admin-chat", {
        body: {
          action: "send_message",
          user_id: userId,
          message: text || "",
          file: fileData,
          bot_id: selectedBotId || undefined,
          sender_type: selectedBusinessAccountId ? "business" : "bot",
          business_account_id: selectedBusinessAccountId || undefined,
          reply_to_message_id: replyToMessageId ?? undefined,
        },
      });
      if (error) throw error;
      if (!data.success) throw new Error(data.error || "Не удалось отправить сообщение");
      return data;
    },
    onMutate: ({ text }) => {
      // === Observed boundary capture BEFORE send ===
      // Фиксируем границу до фактической отправки, чтобы incoming, пришедший
      // во время отправки, НЕ попал в эту boundary, даже если realtime уже
      // добавил его в кэш к моменту onSuccess.
      const snapshot = (queryClient.getQueryData(["telegram-messages", userId]) as
        | TelegramMessage[]
        | undefined) || [];
      const replyScope = selectedBusinessAccountId
        ? { transport: "business" as const, botId: null, businessAccountId: selectedBusinessAccountId }
        : { transport: "bot" as const, botId: selectedBotId, businessAccountId: null };
      let capturedBoundary: string | null = null;
      for (const m of snapshot) {
        const sameScope = replyScope.transport === "business"
          ? m?.transport === "business" && m.business_account_id === replyScope.businessAccountId
          : (m?.transport ?? "bot") === "bot" && m.bot_id === replyScope.botId;
        if (m?.direction === "incoming" && sameScope && typeof m?.created_at === "string") {
          if (!capturedBoundary || m.created_at > capturedBoundary) {
            capturedBoundary = m.created_at;
          }
        }
      }
      pendingBoundaryRef.current = capturedBoundary;
      pendingReplyScopeRef.current = replyScope;

      // Optimistically add message to UI immediately
      const localUrl = selectedFile ? URL.createObjectURL(selectedFile) : null;
      if (localUrl) localMediaUrlsRef.current.push(localUrl);
      const tempMessage: TelegramMessage = {
        id: `temp-${Date.now()}`,
        type: "message",
        direction: "outgoing",
        message_text: text?.trim() || null,
        message_id: null,
        status: "pending",
        created_at: new Date().toISOString(),
        bot_id: selectedBusinessAccountId ? selectedBusinessAccount?.bot_id || null : selectedBotId,
        bot_username: selectedBotId ? botsMap.get(selectedBotId)?.bot_username || null : null,
        bot_name: selectedBotId ? botsMap.get(selectedBotId)?.bot_name || null : null,
        transport: selectedBusinessAccountId ? "business" : "bot",
        business_connection_id: selectedBusinessAccountId ? businessContext?.business_connection_id || null : null,
        business_account_id: selectedBusinessAccountId,
        message_origin: "crm_operator",
        meta: selectedFile ? {
          file_type: selectedFileType,
          file_name: selectedFile.name,
          mime_type: selectedFile.type || null,
          file_url: localUrl,
          upload_status: "ok",
          source: "local_preview",
        } : null,
      };
      queryClient.setQueryData(["telegram-messages", userId], (old: TelegramMessage[] | undefined) => 
        [...(old || []), tempMessage]
      );
      startStickyScroll(2200);
    },
    onSuccess: async (result) => {
      // FIX B: Remove all temp messages BEFORE refetch to prevent duplicates
      queryClient.setQueryData(["telegram-messages", userId], (old: TelegramMessage[] | undefined) =>
        (old || []).filter(m => !m.id.startsWith('temp-'))
      );
      
      setMessage("");
      setSelectedFile(null);
      setSelectedFileType(null);
      setIsUploading(false);
      setReplyingTo(null);
      refetch();
      startStickyScroll(2200);
      // Передаём boundary, зафиксированную ДО отправки (corrective S2).
      const b = pendingBoundaryRef.current;
      pendingBoundaryRef.current = null;
      const replyScope = pendingReplyScopeRef.current;
      pendingReplyScopeRef.current = null;
      if (b && replyScope && (replyScope.businessAccountId || replyScope.botId)) {
        const { error: resolveError } = await supabase.rpc(
          "resolve_telegram_conversation_v1" as any,
          {
            p_user_id: userId,
            p_boundary: b,
            p_transport: replyScope.transport,
            p_bot_id: replyScope.botId,
            p_business_account_id: replyScope.businessAccountId,
            // telegram-admin-chat returns Telegram's numeric message id, while
            // resolution_message_id is the database UUID. The latter is filled
            // by webhook-originated owner replies; do not coerce IDs here.
            p_resolution_message_id: null,
            p_boundary_message_id: result?.message_id ?? null,
          } as any,
        );
        if (resolveError) {
          console.warn("[ContactTelegramChat] reply state sync failed", resolveError.message);
          toast.error("Сообщение отправлено, но статус ответа пока не синхронизирован");
        } else {
          queryClient.invalidateQueries({ queryKey: ["unified-inbox-telegram"] });
          queryClient.invalidateQueries({ queryKey: ["inbox-dialogs"] });
          queryClient.invalidateQueries({ queryKey: ["unread-messages-count"] });
          queryClient.invalidateQueries({ queryKey: ["contact-center-unanswered-dialogs"] });
          queryClient.invalidateQueries({ queryKey: ["contact-center-assignments"] });
        }
      }
      onMessageSent?.(b);
    },
    onError: async (error) => {
      setIsUploading(false);
      pendingBoundaryRef.current = null;
      pendingReplyScopeRef.current = null;
      const msg = await formatChatErrorAsync(error);
      toast.error("Ошибка отправки: " + msg);
    },
  });

  // Edit message mutation
  const editMutation = useMutation({
    mutationFn: async ({ dbMessageId, messageId, text }: { dbMessageId: string; messageId: number; text: string }) => {
      const { data, error } = await supabase.functions.invoke("telegram-admin-chat", {
        body: { 
          action: "edit_message", 
          user_id: userId, 
          message: text,
          message_id: messageId,
          db_message_id: dbMessageId,
        },
      });
      if (error) throw error;
      if (!data.success) throw new Error(data.error || "Не удалось отредактировать сообщение");
      return data;
    },
    onSuccess: () => {
      setEditingMessage(null);
      setEditText("");
      refetch();
      toast.success("Сообщение отредактировано");
    },
    onError: (error) => {
      toast.error("Ошибка редактирования: " + formatChatError(error));
    },
  });

  // Delete message mutation
  const deleteMutation = useMutation({
    mutationFn: async ({ dbMessageId, messageId }: { dbMessageId: string; messageId: number }) => {
      const { data, error } = await supabase.functions.invoke("telegram-admin-chat", {
        body: { 
          action: "delete_message", 
          user_id: userId, 
          message_id: messageId,
          db_message_id: dbMessageId,
        },
      });
      if (error) throw error;
      if (!data.success) throw new Error(data.error || "Не удалось удалить сообщение");
      return data;
    },
    onSuccess: () => {
      refetch();
      toast.success("Сообщение удалено");
    },
    onError: (error) => {
      toast.error("Ошибка удаления: " + formatChatError(error));
    },
  });

  // Автоскролл к последнему сообщению — выполняется через useLayoutEffect,
  // чтобы прижатие к низу происходило ДО того, как браузер покажет кадр.
  // Это исключает "вспышку" с прокруткой сверху при открытии шторки.
  useLayoutEffect(() => {
    if (!userId) return;
    if (isLoading) return;
    // Если вкладка скрыта — не трогаем scroll, чтобы не дёргать viewport (он 0×0).
    if (!isActive) return;

    // Reset "initial scroll" when switching contact OR when tab becomes active again.
    // Без этого при возврате на вкладку Telegram (компонент не размонтирован из-за forceMount)
    // лента остаётся на той позиции, где её оставил browser layout — обычно сверху.
    if (lastUserIdRef.current !== userId || lastIsActiveRef.current === false) {
      lastUserIdRef.current = userId;
      didInitialScrollRef.current = false;
    }
    lastIsActiveRef.current = isActive;

    const getViewport = (): HTMLElement | null => {
      const root = scrollRef.current;
      return (root?.querySelector(
        "[data-radix-scroll-area-viewport]",
      ) as HTMLElement | null) ?? null;
    };

    const viewport = getViewport();
    if (!viewport) return;

    const isNearBottom = () => {
      const vp = getViewport();
      if (!vp) return false;
      return vp.scrollHeight - vp.scrollTop - vp.clientHeight < 120;
    };

    // Decide from the position captured BEFORE React prepends/enriches rows.
    // Stage 2 adds older history above the initial 20 messages; measuring the
    // DOM after that prepend incorrectly looks like the operator scrolled up.
    const shouldScroll =
      !didInitialScrollRef.current || shouldStickToBottomRef.current;
    if (!shouldScroll) return;

    // Скрытый pin-to-bottom: моментально, без анимации.
    const pinToBottom = () => {
      const vp = getViewport();
      if (!vp) return;
      vp.scrollTop = vp.scrollHeight;
    };

    // 1) Пока первая раскладка и медиа догружаются, держим ленту у конца.
    // Любой явный жест пользователя немедленно отменяет автопрокрутку:
    // интерфейс не должен "отбирать" скролл в первые секунды после открытия.
    let stickyActive = !didInitialScrollRef.current;
    const stickyDeadline = performance.now() + 1500;
    const releaseInitialPin = () => {
      stickyActive = false;
      didInitialScrollRef.current = true;
      shouldStickToBottomRef.current = false;
    };
    viewport.addEventListener("wheel", releaseInitialPin, { passive: true });
    viewport.addEventListener("touchstart", releaseInitialPin, { passive: true });
    viewport.addEventListener("pointerdown", releaseInitialPin, { passive: true });
    const stickyLoop = () => {
      if (!stickyActive) return;
      pinToBottom();
      if (performance.now() < stickyDeadline) {
        requestAnimationFrame(stickyLoop);
      } else {
        stickyActive = false;
        didInitialScrollRef.current = true;
      }
    };
    requestAnimationFrame(stickyLoop);

    // 2) ResizeObserver — для последующих апдейтов (новое сообщение, медиа).
    const ro = new ResizeObserver(() => {
      if (!didInitialScrollRef.current) {
        pinToBottom();
        return;
      }
      if (shouldStickToBottomRef.current) pinToBottom();
    });
    const inner = viewport.firstElementChild as HTMLElement | null;
    if (inner) ro.observe(inner);
    ro.observe(viewport);

    // 3) Картинки и видео — каждая догрузка двигает scrollHeight.
    const onMediaLoad = () => {
      if (shouldStickToBottomRef.current) pinToBottom();
    };
    const attachLoadListeners = (root: ParentNode) => {
      const medias = Array.from(
        root.querySelectorAll("img, video")
      ) as Array<HTMLImageElement | HTMLVideoElement>;
      medias.forEach((m) => {
        // dataset-флаг чтобы не вешать listener дважды
        if ((m as any).dataset?.pinAttached === "1") return;
        (m as any).dataset.pinAttached = "1";
        const isImg = m.tagName === "IMG";
        const ready = isImg
          ? (m as HTMLImageElement).complete && (m as HTMLImageElement).naturalWidth > 0
          : (m as HTMLVideoElement).readyState >= 1;
        if (ready) return;
        const evtLoad = isImg ? "load" : "loadedmetadata";
        m.addEventListener(evtLoad, onMediaLoad, { once: true });
        m.addEventListener("error", onMediaLoad, { once: true });
      });
    };
    attachLoadListeners(viewport);

    // 4) MutationObserver — ловим динамически добавленные медиа
    //    (когда телеграм-worker догружает картинку и React рендерит <img>).
    const mo = new MutationObserver((mutations) => {
      let hasNewMedia = false;
      for (const m of mutations) {
        m.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          const el = n as Element;
          if (el.tagName === "IMG" || el.tagName === "VIDEO" || el.querySelector?.("img, video")) {
            hasNewMedia = true;
          }
        });
      }
      if (hasNewMedia) {
        attachLoadListeners(viewport);
        if (shouldStickToBottomRef.current) pinToBottom();
      }
    });
    mo.observe(viewport, { childList: true, subtree: true });

    return () => {
      stickyActive = false;
      viewport.removeEventListener("wheel", releaseInitialPin);
      viewport.removeEventListener("touchstart", releaseInitialPin);
      viewport.removeEventListener("pointerdown", releaseInitialPin);
      ro.disconnect();
      mo.disconnect();
    };
  }, [userId, isLoading, chatItems.length, isActive]);

  // Track scroll position → toggle "scroll to bottom" FAB + clear unread.
  useEffect(() => {
    const root = scrollRef.current;
    const viewport = root?.querySelector(
      "[data-radix-scroll-area-viewport]"
    ) as HTMLElement | null;
    if (!viewport) return;

    const onScroll = () => {
      const near =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 200;
      setIsNearBottomState(near);
      if (near) {
        setUnreadCount(0);
      } else {
        // A manual scroll away from the end always wins over any active
        // sticky loop started by realtime/media updates.
        shouldStickToBottomRef.current = false;
      }
    };

    onScroll();
    viewport.addEventListener("scroll", onScroll, { passive: true });
    return () => viewport.removeEventListener("scroll", onScroll);
  }, [userId, isLoading]);

  // Smooth jump to the bottom (used by FAB).
  const jumpToBottom = useCallback(() => {
    const vp = scrollRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]"
    ) as HTMLElement | null;
    if (vp) {
      vp.scrollTo({ top: vp.scrollHeight, behavior: "smooth" });
    }
    shouldStickToBottomRef.current = true;
    setUnreadCount(0);
  }, []);

  // Autofocus input when user picks a message to reply to.
  useEffect(() => {
    if (replyingTo) {
      // rAF чтобы дождаться mount блока reply-preview и не словить scroll-jump.
      requestAnimationFrame(() => {
        inputFocusRef.current?.();
      });
    }
  }, [replyingTo]);

  const handleSend = () => {
    if (
      sendMutation.isPending ||
      isUploading ||
      (!selectedBotId && !selectedBusinessAccountId)
    ) return;
    const trimmed = renderContactCenterMessagePlaceholders(message, {
      fullName: clientName,
      firstName: clientFirstName,
      lastName: clientLastName,
      email: clientEmail,
      phone: clientPhone,
      telegramUsername,
    }).trim();
    if (!trimmed && !selectedFile) return;
    sendMutation.mutate({
      text: trimmed,
      file: selectedFile || undefined,
      fileType: selectedFileType || undefined,
      replyToMessageId: replyingTo?.message_id ?? undefined,
    });
  };

  const acceptSelectedFile = (
    file: File,
    type?: "photo" | "video" | "audio" | "voice" | "video_note" | "document",
  ) => {
    const maxSize = type === "video" || type === "video_note" ? 50 * 1024 * 1024 : 20 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error(`Файл слишком большой (макс. ${maxSize / 1024 / 1024} МБ)`);
      return;
    }
    setSelectedFile(file);
    setSelectedFileType(type || null);
    setShowMediaMenu(false);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, type?: "photo" | "video" | "audio" | "voice" | "video_note" | "document") => {
    const file = e.target.files?.[0];
    if (file) acceptSelectedFile(file, type);
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLElement>) => {
    const file = getClipboardFile(e.clipboardData);
    if (!file) return;
    e.preventDefault();
    const type = file.type.startsWith("image/")
      ? "photo"
      : file.type.startsWith("video/")
        ? "video"
        : file.type.startsWith("audio/")
          ? "audio"
          : "document";
    acceptSelectedFile(file, type);
  };

  const insertEmoji = (emoji: string) => {
    setMessage(prev => prev + emoji);
  };

  const getFileIcon = (fileType: string | null | undefined) => {
    if (fileType === "photo") return <ImageIcon className="w-4 h-4" />;
    if (fileType === "video") return <Video className="w-4 h-4" />;
    if (fileType === "audio") return <Music className="w-4 h-4" />;
    if (fileType === "voice") return <Mic className="w-4 h-4" />;
    if (fileType === "video_note") return <Circle className="w-4 h-4" />;
    return <FileText className="w-4 h-4" />;
  };

  // V1.3: stable handlers passed to memoized bubbles.
  // All lookups by db id use `latestMessagesRef` to keep deps [].
  const handleReplyById = useCallback((id: string) => {
    const msg = latestMessagesRef.current.find((m) => m.id === id);
    if (msg) setReplyingTo(msg);
  }, []);

  const handleEditById = useCallback((id: string) => {
    const msg = latestMessagesRef.current.find((m) => m.id === id);
    if (msg) {
      setEditingMessage(msg);
      setEditText(msg.message_text || "");
    }
  }, []);

  const handleDeleteMessage = useCallback((dbId: string, telegramMessageId: number) => {
    deleteMutation.mutate({ dbMessageId: dbId, messageId: telegramMessageId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteMutation]);

  const handleReact = useCallback((id: string, emoji: string) => {
    toggleReactionRef.current.mutate({ messageId: id, emoji });
  }, []);

  const handleQuoteClick = useCallback((dbId: string) => {
    scrollToMessage(dbId);
  }, [scrollToMessage]);

  const handleMediaRefresh = useCallback(async (messageDbId: string) => {
    if (isRefreshingMedia) return;
    setIsRefreshingMedia(true);
    try {
      // Простого refetch недостаточно для старых pending-записей: он лишь
      // повторно читает тот же статус. Сначала точечно запускаем защищённый
      // worker для текущего диалога, затем обновляем кэш сообщений.
      const { error } = await supabase.functions.invoke("telegram-admin-chat", {
        body: {
          action: "process_media_jobs",
          user_id: userId,
          db_message_id: messageDbId,
          limit: 20,
        },
      });
      if (error) throw error;
      await refetchMessages();
    } catch (error) {
      console.error("[ContactTelegramChat] media refresh failed", error);
      toast.error("Не удалось обновить вложение");
    } finally {
      setIsRefreshingMedia(false);
    }
  }, [isRefreshingMedia, refetchMessages, userId]);

  if (!telegramUserId) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-8 text-center text-muted-foreground">
          <MessageCircle className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>Telegram не привязан</p>
          <p className="text-sm mt-1">Клиент должен привязать свой Telegram аккаунт</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col h-full min-h-0" data-testid="telegram-chat-panel">
        {/* Header - only show if photo button is visible */}
        {!hidePhotoButton && (
          <div className="flex items-center justify-end pb-2 border-b border-border/30 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fetchPhotoMutation.mutate()}
              disabled={fetchPhotoMutation.isPending}
              className="h-7 px-2 text-xs"
              title="Загрузить фото из Telegram"
            >
              {fetchPhotoMutation.isPending ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ImageIcon className="w-3.5 h-3.5" />
              )}
              <span className="ml-1">Фото TG</span>
            </Button>
          </div>
        )}

        {/* Messages + Events - flex-1 with min-h-0 for proper scrolling */}
        <div className="relative flex-1 min-h-0 flex flex-col">
          <ScrollArea className="flex-1 min-h-0 py-3 [&>[data-radix-scroll-area-viewport]>div]:!block" ref={scrollRef}>
            {isLoading ? (
              <div className="space-y-3 px-1">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 w-3/4" />
                ))}
              </div>
            ) : !chatItems?.length ? (
              <div className="h-full flex items-center justify-center text-muted-foreground min-h-[200px]">
                <div className="text-center">
                  <Bot className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Нет сообщений</p>
                  <p className="text-xs">Начните диалог, отправив сообщение</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3 px-3 w-full max-w-full box-border" data-testid="telegram-message-list">
                {hasOlderMessages && (
                  <div className="flex justify-center pb-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={loadOlderMessages}
                      disabled={isLoadingOlderMessages}
                      data-testid="telegram-load-older-messages"
                    >
                      {isLoadingOlderMessages && (
                        <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
                      )}
                      Показать предыдущие сообщения
                    </Button>
                  </div>
                )}
                {chatItemsWithMeta.map(({ key, showDateSeparator, dateLabel, bubble }) => (
                  <div key={key}>
                    {showDateSeparator && (
                      <div className="flex items-center justify-center my-4">
                        <div className="flex-1 border-t border-border/30" />
                        <span className="px-3 py-1 text-xs text-muted-foreground bg-muted/50 rounded-full mx-2">
                          {dateLabel}
                        </span>
                        <div className="flex-1 border-t border-border/30" />
                      </div>
                    )}
                    {bubble.kind === "event" ? (
                      <TelegramEventBubble data={bubble} />
                    ) : (
                      <TelegramMessageBubble
                        data={bubble}
                        isHighlighted={highlightedId === bubble.id}
                        onReply={handleReplyById}
                        onEdit={handleEditById}
                        onDelete={handleDeleteMessage}
                        onReact={handleReact}
                        onQuoteClick={handleQuoteClick}
                        onMediaRefresh={handleMediaRefresh}
                        emojiList={EMOJI_LIST}
                      />
                    )}
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
            )}
          </ScrollArea>

          {unansweredItems.length > 0 && (
            <button
              type="button"
              onClick={() => scrollToMessage(unansweredItems[0].id)}
              className="absolute top-2 left-3 right-3 z-10 rounded-xl border border-primary/25 bg-background/95 px-3 py-2 text-left shadow-sm backdrop-blur transition-colors hover:bg-primary/5"
              aria-label="Перейти к неотвеченному сообщению"
            >
              <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-primary">
                <span>Нужно ответить</span>
                {unansweredItems.length > 1 && <span>ещё {unansweredItems.length - 1}</span>}
              </div>
              <p className="mt-0.5 truncate text-xs text-foreground/85">
                {unansweredItems[0].message_text || "Вложение или сообщение без текста"}
              </p>
            </button>
          )}

          {/* Floating "scroll to bottom" button with unread badge */}
          {!isNearBottomState && chatItems.length > 0 && (
            <button
              type="button"
              onClick={jumpToBottom}
              aria-label="К новым сообщениям"
              className="absolute bottom-3 right-3 z-10 h-10 w-10 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 transition-colors"
            >
              <ChevronDown className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold flex items-center justify-center border-2 border-background">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </button>
          )}
        </div>

        {/* Selected file preview - shrink-0 to stay visible */}
        {selectedFile && (
          <div className="shrink-0 px-1">
            <OutboundMediaPreview
              file={selectedFile}
              fileType={selectedFileType}
              isUploading={isUploading}
              onRemove={() => {
                setSelectedFile(null);
                setSelectedFileType(null);
              }}
            />
          </div>
        )}

        {/* Input — shrink-0 в нижней части flex-контейнера. Без sticky:
            родитель уже ограничен по высоте (Telegram-вкладка),
            поэтому композер всегда виден внизу карточки. */}
        <div className="shrink-0 border-t bg-background px-2 pt-2 pb-[calc(env(safe-area-inset-bottom,0px)+0.5rem)]">
          {(activeBots.length > 0 || dialogBusinessAccounts.some((account) => account.is_enabled && account.can_reply)) && (
            <div className="flex items-center gap-1.5 pb-1.5">
              <Select value={selectedSender} onValueChange={handleSenderChange}>
                <SelectTrigger className="h-7 w-auto min-w-[140px] text-[11px] rounded-lg border-border/40 bg-muted/30 gap-1 px-2">
                  <Bot className="h-3 w-3 shrink-0" />
                  <SelectValue placeholder="Выберите отправителя" />
                </SelectTrigger>
                <SelectContent>
                  {dialogBusinessAccounts
                    .filter((account) => account.is_enabled && account.can_reply)
                    .map((account) => {
                      const name = [account.first_name, account.last_name].filter(Boolean).join(" ").trim()
                        || (account.username ? `@${account.username}` : "Telegram Business");
                      return (
                        <SelectItem key={account.id} value={`business:${account.id}`} className="text-xs">
                          {name} · личный Telegram
                        </SelectItem>
                      );
                    })}
                  {activeBots.map(bot => (
                    <SelectItem key={bot.id} value={`bot:${bot.id}`} className="text-xs">
                      {bot.bot_name?.trim() ? bot.bot_name : `@${bot.bot_username}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {replyingTo && (
            <div className="flex items-start gap-2 mb-2 p-2 rounded-md bg-muted border-l-2 border-primary">
              <CornerUpLeft className="w-3.5 h-3.5 text-primary mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-semibold text-primary truncate">
                  Ответ:{" "}
                  {replyingTo.direction === "outgoing"
                    ? (replyingTo.admin_profile?.full_name || "Администратор")
                    : (clientName || "Клиент")}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {buildQuotePreview(replyingTo)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReplyingTo(null)}
                className="p-0.5 rounded hover:bg-accent"
                title="Отменить ответ"
              >
                <X className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            </div>
          )}
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-2">
          <div className="flex shrink-0 flex-col gap-1">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="h-9 w-9 p-0 shrink-0">
                  <Smile className="w-4 h-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-2" align="start">
                <div className="grid grid-cols-10 gap-1">
                  {EMOJI_LIST.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => insertEmoji(emoji)}
                      className="w-6 h-6 text-center hover:bg-muted rounded transition-colors"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            
            <DropdownMenu open={showMediaMenu} onOpenChange={setShowMediaMenu}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-9 w-9 p-0 shrink-0">
                  <Paperclip className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-48 p-2" align="start">
                <DropdownMenuItem
                  className="gap-2"
                  onSelect={(e) => {
                    e.preventDefault();
                    setShowMediaMenu(false);
                    if (fileInputRef.current) {
                      fileInputRef.current.accept = "image/*";
                      fileInputRef.current.click();
                    }
                  }}
                >
                  <ImageIcon className="w-4 h-4" />
                  Фото
                </DropdownMenuItem>

                <DropdownMenuItem
                  className="gap-2"
                  onSelect={(e) => {
                    e.preventDefault();
                    setShowMediaMenu(false);
                    if (fileInputRef.current) {
                      fileInputRef.current.accept = "video/*";
                      fileInputRef.current.click();
                    }
                  }}
                >
                  <Video className="w-4 h-4" />
                  Видео
                </DropdownMenuItem>

                <DropdownMenuItem
                  className="gap-2"
                  onSelect={(e) => {
                    e.preventDefault();
                    setShowMediaMenu(false);
                    setShowVideoNoteRecorder(true);
                  }}
                >
                  <Circle className="w-4 h-4" />
                  Записать кружок
                </DropdownMenuItem>

                <DropdownMenuItem
                  className="gap-2"
                  onSelect={(e) => {
                    e.preventDefault();
                    setShowMediaMenu(false);
                    setShowVoiceRecorder(true);
                  }}
                >
                  <Mic className="w-4 h-4" />
                  Голосовое
                </DropdownMenuItem>

                <DropdownMenuItem
                  className="gap-2"
                  onSelect={(e) => {
                    e.preventDefault();
                    setShowMediaMenu(false);
                    if (fileInputRef.current) {
                      fileInputRef.current.accept = "audio/*";
                      fileInputRef.current.click();
                    }
                  }}
                >
                  <Music className="w-4 h-4" />
                  Аудио
                </DropdownMenuItem>

                <DropdownMenuItem
                  className="gap-2"
                  onSelect={(e) => {
                    e.preventDefault();
                    setShowMediaMenu(false);
                    if (fileInputRef.current) {
                      fileInputRef.current.accept = "*/*";
                      fileInputRef.current.click();
                    }
                  }}
                >
                  <FileText className="w-4 h-4" />
                  Документ
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const mediaType = fileInputRef.current?.dataset.mediaType as "video_note" | undefined;
                const file = e.target.files?.[0];
                if (file) {
                  let type: "photo" | "video" | "audio" | "voice" | "video_note" | "document" | undefined;
                  if (mediaType === "video_note") {
                    type = "video_note";
                  } else if (file.type.startsWith("image/")) {
                    type = "photo";
                  } else if (file.type.startsWith("video/")) {
                    type = "video";
                  } else if (file.type.startsWith("audio/")) {
                    type = "audio";
                  } else {
                    type = "document";
                  }
                  handleFileSelect(e, type);
                }
                // Reset the data attribute
                if (fileInputRef.current) {
                  delete fileInputRef.current.dataset.mediaType;
                }
              }}
            />
          </div>
          
          <div className="min-w-0 w-full">
            <TokenizedRichInput
              value={message}
              onChange={setMessage}
              onSubmit={handleSend}
              onPaste={handlePaste}
              onFocusReady={(focus) => { inputFocusRef.current = focus; }}
              tokenContext="contact_center"
              rows={2}
              placeholder="Введите сообщение..."
              className="min-h-[56px] max-h-[112px] w-full overflow-y-auto leading-snug"
              disabled={sendMutation.isPending || isUploading}
            />
          </div>
          <div className="flex shrink-0 flex-col gap-1 items-end">
            <Button
              onClick={handleSend}
              disabled={(!message.trim() && !selectedFile) || sendMutation.isPending || isUploading || (!selectedBotId && !selectedBusinessAccountId)}
              className="h-12 w-12 p-0 shrink-0"
              title={!selectedBotId && !selectedBusinessAccountId ? "Выберите отправителя" : undefined}
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
          </div>
          <p className="hidden sm:block text-[11px] leading-none text-muted-foreground mt-0.5">
            Enter для отправки, Shift+Enter для новой строки
          </p>
        </div>

      {/* Video Note Recorder */}
      <VideoNoteRecorder
        open={showVideoNoteRecorder}
        onOpenChange={setShowVideoNoteRecorder}
        onRecorded={(file) => {
          setSelectedFile(file);
          setSelectedFileType("video_note");
        }}
      />

      {/* Voice Recorder — PATCH-CONTACT-CENTER-VOICE-MESSAGES-V1 */}
      <AdminVoiceRecorder
        open={showVoiceRecorder}
        onOpenChange={setShowVoiceRecorder}
        onRecorded={(file) => {
          setSelectedFile(file);
          setSelectedFileType("voice");
        }}
      />


      {/* Edit Message Dialog */}
      <Dialog open={!!editingMessage} onOpenChange={(open) => !open && setEditingMessage(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Редактировать сообщение</DialogTitle>
          </DialogHeader>
          <Textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            placeholder="Введите новый текст..."
            className="min-h-[100px]"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingMessage(null)}>
              Отмена
            </Button>
            <Button
              onClick={() => {
                if (editingMessage && editingMessage.message_id && editText.trim()) {
                  editMutation.mutate({
                    dbMessageId: editingMessage.id,
                    messageId: editingMessage.message_id,
                    text: editText.trim(),
                  });
                }
              }}
              disabled={!editText.trim() || editMutation.isPending}
            >
              {editMutation.isPending ? "Сохранение..." : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </TooltipProvider>
  );
}
