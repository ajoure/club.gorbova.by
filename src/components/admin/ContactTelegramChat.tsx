import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, isToday, isYesterday, isSameDay } from "date-fns";
import { ru } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getEventLabel } from "@/lib/eventLabels";
import { normalizeEdgeFunctionError } from "@/utils/normalizeEdgeFunctionError";
import { VideoNoteRecorder } from "./VideoNoteRecorder";
import { OutboundMediaPreview } from "./chat/OutboundMediaPreview";
import { ChatMediaMessage } from "./chat/ChatMediaMessage";
import { useTelegramReactions, useToggleTelegramReaction } from "@/hooks/useTelegramReactions";
import { SmilePlus } from "lucide-react";

interface ContactTelegramChatProps {
  userId: string;
  telegramUserId: number | null;
  telegramUsername: string | null;
  clientName?: string | null;
  avatarUrl?: string | null;
  onAvatarUpdated?: (url: string) => void;
  hidePhotoButton?: boolean;
  onMessageSent?: () => void;
}

interface TelegramMessage {
  id: string;
  type: "message";
  direction: "outgoing" | "incoming";
  message_text: string | null;
  message_id: number | null;
  status: string;
  created_at: string;
  sent_by_admin?: string | null;
  bot_id?: string | null;
  bot_username?: string | null; // for optimistic UI
  bot_name?: string | null; // for optimistic UI
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

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk) as any);
  }

  return btoa(binary);
}

// Only Telegram-supported reaction emojis (whitelist)
const EMOJI_LIST = [
  "👍", "👎", "❤️", "🔥", "🥰", "👏", "😁", "🤔", "🤯", "😱",
  "🤬", "😢", "🎉", "🤩", "🤮", "💩", "🙏", "👌", "🕊", "🤡",
  "🥱", "🥴", "😍", "🐳", "❤️‍🔥", "🌚", "🌭", "💯", "🤣", "⚡",
  "🍌", "🏆", "💔", "🤨", "😐", "🍓", "🍾", "💋", "🖕", "😈",
  "😴", "😭", "🤓", "👻", "👨‍💻", "👀", "🎃", "🙈", "😇", "😨",
  "🤝", "✍️", "🤗", "🫡", "🎅", "🎄", "☃️", "💅", "🤪", "🗿",
  "🆒", "💘", "🙉", "🦄", "😘", "💊", "🙊", "😎", "👾", "🤷‍♂️",
  "🤷", "🤷‍♀️", "😡",
];

const EVENT_ICONS: Record<string, React.ReactNode> = {
  // Telegram linking
  LINK_SUCCESS: <Link className="w-3 h-3 text-green-500" />,
  RELINK_SUCCESS: <Link className="w-3 h-3 text-blue-500" />,
  UNLINK: <Unlink className="w-3 h-3 text-orange-500" />,
  
  // Access management
  AUTO_GRANT: <Key className="w-3 h-3 text-green-500" />,
  MANUAL_GRANT: <Key className="w-3 h-3 text-green-500" />,
  MANUAL_EXTEND: <Key className="w-3 h-3 text-blue-500" />,
  AUTO_REVOKE: <UserMinus className="w-3 h-3 text-red-500" />,
  MANUAL_REVOKE: <UserMinus className="w-3 h-3 text-red-500" />,
  AUTO_KICK_VIOLATOR: <UserMinus className="w-3 h-3 text-red-500" />,
  "telegram.access_granted": <Key className="w-3 h-3 text-green-500" />,
  "telegram.access_revoked": <UserMinus className="w-3 h-3 text-red-500" />,
  "telegram.access_queued": <RefreshCcw className="w-3 h-3 text-blue-500" />,
  
  // Notifications
  manual_notification: <Bell className="w-3 h-3 text-blue-500" />,
  ADMIN_CHAT_MESSAGE: <MessageCircle className="w-3 h-3 text-primary" />,
  ADMIN_CHAT_FILE: <Paperclip className="w-3 h-3 text-primary" />,
  
  // Contacts
  CONTACT_MERGED: <UserPlus className="w-3 h-3 text-purple-500" />,
  CONTACT_UNMERGED: <UserMinus className="w-3 h-3 text-orange-500" />,
  
  // Billing / Subscriptions (NEW)
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
  
  // Payments
  "payment.success": <CreditCard className="w-3 h-3 text-green-500" />,
  "payment.failed": <AlertTriangle className="w-3 h-3 text-red-500" />,
  
  // System
  "system.trigger_fix_telegram_status": <Settings className="w-3 h-3 text-muted-foreground" />,
  "telegram.backfill_grant": <RefreshCcw className="w-3 h-3 text-blue-500" />,
};

// PATCH 13.6+: Используется централизованный словарь EVENT_LABELS из @/lib/eventLabels

export function ContactTelegramChat({
  userId,
  telegramUserId,
  telegramUsername,
  clientName,
  avatarUrl,
  onAvatarUpdated,
  hidePhotoButton = false,
  onMessageSent,
}: ContactTelegramChatProps) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFileType, setSelectedFileType] = useState<"photo" | "video" | "audio" | "video_note" | "document" | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showMediaMenu, setShowMediaMenu] = useState(false);
  const [showVideoNoteRecorder, setShowVideoNoteRecorder] = useState(false);
  const [editingMessage, setEditingMessage] = useState<TelegramMessage | null>(null);
  const [editText, setEditText] = useState("");
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const didInitialScrollRef = useRef(false);
  const lastUserIdRef = useRef<string | null>(null);
  
  // Anti double-click protection for send button
  const lastSendTimeRef = useRef<number>(0);
  const SEND_DEBOUNCE_MS = 500;

  const fileInputRef = useRef<HTMLInputElement>(null);

  const prevMessageCountRef = useRef<number>(0);

  // === AUTO-REFRESH FOR PENDING MEDIA ===
  const pendingAutoRefreshRef = useRef<number | null>(null);
  const pendingRefreshCountRef = useRef(0);
  const MAX_PENDING_REFRESH_ATTEMPTS = 12; // 2 minutes at 10s interval
  const PENDING_REFRESH_INTERVAL = 10000; // 10 seconds

  function mergeByIdPreferEnriched(prev: TelegramMessage[], next: TelegramMessage[]) {
    const map = new Map<string, TelegramMessage>();
    for (const m of prev) map.set(m.id, m);

    for (const m of next) {
      const old = map.get(m.id);
      if (!old) {
        map.set(m.id, m);
        continue;
      }

      const oldMeta: any = (old as any).meta ?? {};
      const newMeta: any = (m as any).meta ?? {};

      const oldUrl: string | null =
        oldMeta.file_url ?? (old as any).file_url ?? (old as any).fileUrl ?? null;
      const newUrl: string | null =
        newMeta.file_url ?? (m as any).file_url ?? (m as any).fileUrl ?? null;

      // Prefer already-enriched item if the new one is worse (no URL)
      if (oldUrl && !newUrl) {
        map.set(m.id, {
          ...m,
          meta: {
            ...newMeta,
            file_url: oldUrl,
          },
        });
      } else {
        map.set(m.id, m);
      }
    }

    // Sort by created_at ASC to maintain correct order after merge
    return Array.from(map.values()).sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
  }

  // Fetch messages - with polling interval as backup
  const { data: messages, isLoading: messagesLoading, refetch: refetchMessages } = useQuery({
    queryKey: ["telegram-messages", userId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("telegram-admin-chat", {
        body: { action: "get_messages", user_id: userId, limit: 50 },
      });
      if (error) throw error;

      const nextMessages = (data.messages || []).map((m: any) => ({ ...m, type: "message" })) as TelegramMessage[];
      const prevMessages = (queryClient.getQueryData(["telegram-messages", userId]) as TelegramMessage[] | undefined) || [];
      return mergeByIdPreferEnriched(prevMessages, nextMessages);
    },
    enabled: !!userId,
    staleTime: 30000,              // 30s before stale - reduces refetch frequency (mobile fix)
    refetchOnWindowFocus: false,   // Disable - causes mobile "infinite reload" feel
    refetchOnMount: true,          // Once on mount, not "always"
    refetchInterval: false,        // Disable polling - realtime is enough
    refetchOnReconnect: false,     // Prevent mobile reconnect floods
  });

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

  // Combine and sort messages + telegram events + billing events.
  // PATCH: Hide event-pills that mirror a real outgoing telegram_messages bubble.
  // Rules:
  //   - status must be 'success' (failed/skipped stay visible as diagnostic pills);
  //   - whitelist of admin/notification actions that are normally mirrored to chat;
  //   - either bubble exists in ±5min window (heuristic) OR meta marks it as mirrored,
  //     OR text is empty (no value to show as pill).
  const normalizeText = (t?: string | null) =>
    (t || "").replace(/\s+/g, " ").trim().toLowerCase();
  const outgoingMirrored = (messages || []).filter(
    (m: any) => m.direction === 'outgoing' && (m.meta?.automated === true || m.meta?.source)
  );
  const mirroredAt: number[] = outgoingMirrored.map((m: any) => new Date(m.created_at).getTime());
  const mirroredTexts = new Set(outgoingMirrored.map((m: any) => normalizeText(m.message_text)));

  const MIRRORABLE_ACTIONS = new Set<string>([
    'SEND_REMINDER',
    'manual_notification',
    'MANUAL_NOTIFICATION',
    'custom',
    'telegram.notification.sent',
    // subscription_reminder_*d are matched via prefix below
  ]);

  const isMirroredEvent = (e: TelegramEvent): boolean => {
    const action = e.action || '';
    const isMirrorable =
      MIRRORABLE_ACTIONS.has(action) ||
      action.startsWith('subscription_reminder_');
    if (!isMirrorable) return false;
    if (e.status !== 'success') return false;
    // Backend hint: explicit flag in meta wins.
    if ((e.meta as any)?.mirrored_to_telegram_messages === true) return true;
    // No payload to render as pill — always hide.
    if (!e.message_text || !e.message_text.trim()) return true;
    // Exact text match with any mirrored bubble.
    if (mirroredTexts.has(normalizeText(e.message_text))) return true;
    // Time-window fallback (±5 min) for legacy rows without explicit flag.
    const t = new Date(e.created_at).getTime();
    return mirroredAt.some((mt) => Math.abs(mt - t) <= 300_000);
  };

  const chatItems: ChatItem[] = [
    ...(messages || []),
    ...((events || []).filter((e) => !isMirroredEvent(e as TelegramEvent))),
    ...(billingEvents || []),
  ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const isLoading = messagesLoading || eventsLoading || billingLoading;

  // --- Telegram reactions ---
  const telegramMessageIds = useMemo(
    () => (messages || []).map((m: TelegramMessage) => m.id).filter(Boolean),
    [messages]
  );
  const { data: telegramReactionsMap } = useTelegramReactions(telegramMessageIds);
  const toggleTelegramReaction = useToggleTelegramReaction();

  // Check if any messages have pending upload status
  const hasPendingMedia = useMemo(() => {
    if (!messages) return false;
    return messages.some((m: TelegramMessage) => {
      const meta = m.meta || {};
      return (meta as any).upload_status === 'pending';
    });
  }, [messages]);

  // === DEFAULT BOT SELECTION ===
  useEffect(() => {
    if (!messages || messages.length === 0 || activeBots.length === 0) return;

    const savedBotId = localStorage.getItem(`tg_bot_${userId}`);
    if (savedBotId && activeBots.some(b => b.id === savedBotId)) {
      if (selectedBotId !== savedBotId) setSelectedBotId(savedBotId);
      return;
    }
    if (savedBotId) localStorage.removeItem(`tg_bot_${userId}`);

    const lastInbound = [...messages].reverse().find(m => m.direction === "incoming" && m.bot_id);
    if (lastInbound?.bot_id && activeBots.some(b => b.id === lastInbound.bot_id)) {
      setSelectedBotId(lastInbound.bot_id);
      return;
    }

    const primaryBot = activeBots.find(b => b.is_primary);
    if (primaryBot) { setSelectedBotId(primaryBot.id); return; }
    if (activeBots[0]) { setSelectedBotId(activeBots[0].id); }
  }, [messages, activeBots, userId]);

  const handleBotChange = (botId: string) => {
    setSelectedBotId(botId);
    localStorage.setItem(`tg_bot_${userId}`, botId);
  };

  const refetch = useCallback(() => {
    refetchMessages();
    refetchEvents();
    refetchBilling();
  }, [refetchMessages, refetchEvents, refetchBilling]);

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

  // Subscribe to realtime messages for this user
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`chat-messages-${userId}`)
      .on(
        "postgres_changes",
        { 
          event: "INSERT", 
          schema: "public", 
          table: "telegram_messages",
          filter: `user_id=eq.${userId}`
        },
        (payload) => {
          console.log("New message received:", payload);
          
          // FIX B: Remove temp messages that match the incoming real message
          const newMsg = payload.new as any;
          const msgText = (newMsg?.message_text || "").trim();
          const msgTime = new Date(newMsg?.created_at || Date.now()).getTime();
          
          queryClient.setQueryData(["telegram-messages", userId], (old: TelegramMessage[] | undefined) => {
            if (!old) return old;
            
            // Filter out temp messages that match the new real message
            return old.filter(m => {
              // Keep all non-temp messages
              if (!m.id.startsWith('temp-')) return true;
              
              // For temp messages: remove if text matches AND within 10s window
              const tempText = (m.message_text || "").trim();
              const tempTime = new Date(m.created_at).getTime();
              const textMatches = tempText === msgText || (tempText.startsWith("📎") && msgText === "");
              const timeClose = Math.abs(tempTime - msgTime) < 10000; // 10s window
              
              if (textMatches && timeClose) {
                console.log("[DEDUP] Removing temp message:", m.id, "replaced by real:", newMsg.id);
                return false; // Remove temp
              }
              return true;
            });
          });
          
          // Single debounced refetch
          debouncedRefetch();
          
          // Auto-scroll only if user is at bottom OR it's an outgoing message
          const isFromAdmin = newMsg?.direction === "outgoing";
          
          setTimeout(() => {
            const root = scrollRef.current;
            const viewport = root?.querySelector(
              "[data-radix-scroll-area-viewport]"
            ) as HTMLElement | null;
            
            if (viewport) {
              const isAtBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 100;
              
              // Scroll only if at bottom OR it's our own message
              if (isAtBottom || isFromAdmin) {
                viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
              }
            }
          }, 100);
        }
      )
      .subscribe();

    return () => {
      if (refetchTimerRef.current) {
        window.clearTimeout(refetchTimerRef.current);
      }
      supabase.removeChannel(channel);
    };
  }, [userId, debouncedRefetch]);

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
    mutationFn: async ({ text, file, fileType }: { text?: string; file?: File; fileType?: string }) => {
      let fileData: { type: string; name: string; base64: string } | undefined;
      
      if (file) {
        setIsUploading(true);

        let base64: string;
        try {
          const buffer = await file.arrayBuffer();
          base64 = arrayBufferToBase64(buffer);
        } catch (e) {
          console.error("Failed to encode file to base64", e);
          throw new Error("Не удалось подготовить файл для отправки");
        }
        
        // Use provided fileType or auto-detect
        let type = fileType || "document";
        if (!fileType) {
          if (file.type.startsWith("image/")) type = "photo";
          else if (file.type.startsWith("video/")) type = "video";
          else if (file.type.startsWith("audio/")) type = "audio";
        }
        
        fileData = { type, name: file.name, base64 };
      }

      const { data, error } = await supabase.functions.invoke("telegram-admin-chat", {
        body: { 
          action: "send_message", 
          user_id: userId, 
          message: text || "",
          file: fileData,
          bot_id: selectedBotId || undefined,
        },
      });
      if (error) throw error;
      if (!data.success) throw new Error(data.error || "Не удалось отправить сообщение");
      return data;
    },
    onMutate: () => {
      // Optimistically add message to UI immediately
      const tempMessage: TelegramMessage = {
        id: `temp-${Date.now()}`,
        type: "message",
        direction: "outgoing",
        message_text: message.trim() || (selectedFile ? `📎 ${selectedFile.name}` : null),
        message_id: null,
        status: "pending",
        created_at: new Date().toISOString(),
        bot_id: selectedBotId,
        bot_username: selectedBotId ? botsMap.get(selectedBotId)?.bot_username || null : null,
        bot_name: selectedBotId ? botsMap.get(selectedBotId)?.bot_name || null : null,
      };
      queryClient.setQueryData(["telegram-messages", userId], (old: TelegramMessage[] | undefined) => 
        [...(old || []), tempMessage]
      );
    },
    onSuccess: () => {
      // FIX B: Remove all temp messages BEFORE refetch to prevent duplicates
      queryClient.setQueryData(["telegram-messages", userId], (old: TelegramMessage[] | undefined) =>
        (old || []).filter(m => !m.id.startsWith('temp-'))
      );
      
      setMessage("");
      setSelectedFile(null);
      setSelectedFileType(null);
      setIsUploading(false);
      refetch();
      onMessageSent?.();
    },
    onError: (error) => {
      setIsUploading(false);
      toast.error("Ошибка отправки: " + formatChatError(error));
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

  useEffect(() => {
    if (!userId) return;
    if (isLoading) return;

    // Reset “initial scroll” when switching contact
    if (lastUserIdRef.current !== userId) {
      lastUserIdRef.current = userId;
      didInitialScrollRef.current = false;
    }

    const root = scrollRef.current;
    const viewport = root?.querySelector(
      "[data-radix-scroll-area-viewport]",
    ) as HTMLElement | null;

    const isNearBottom = viewport
      ? viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 120
      : true;

    const shouldScroll = !didInitialScrollRef.current || isNearBottom;
    if (!shouldScroll) return;

    // Wait for DOM paint - double rAF for reliable scroll after paint
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const vp = scrollRef.current?.querySelector("[data-radix-scroll-area-viewport]") as HTMLElement | null;
        if (vp) vp.scrollTo({ top: vp.scrollHeight, behavior: "auto" });
        didInitialScrollRef.current = true;
      });
    });

    // Fallback timeout for edge cases where rAF doesn't fire correctly
    const fallbackTimeout = setTimeout(() => {
      if (!didInitialScrollRef.current) {
        const vp = scrollRef.current?.querySelector("[data-radix-scroll-area-viewport]") as HTMLElement | null;
        if (vp) vp.scrollTo({ top: vp.scrollHeight, behavior: "auto" });
        didInitialScrollRef.current = true;
      }
    }, 150);

    return () => clearTimeout(fallbackTimeout);
  }, [userId, isLoading, chatItems.length]);

  const handleSend = () => {
    const trimmed = message.trim();
    if (!trimmed && !selectedFile) return;
    sendMutation.mutate({ text: trimmed, file: selectedFile || undefined, fileType: selectedFileType || undefined });
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, type?: "photo" | "video" | "audio" | "video_note" | "document") => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file size
      const maxSize = type === "video" || type === "video_note" ? 50 * 1024 * 1024 : 20 * 1024 * 1024;
      if (file.size > maxSize) {
        toast.error(`Файл слишком большой (макс. ${maxSize / 1024 / 1024} МБ)`);
        return;
      }
      setSelectedFile(file);
      setSelectedFileType(type || null);
      setShowMediaMenu(false);
    }
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const insertEmoji = (emoji: string) => {
    setMessage(prev => prev + emoji);
  };

  const getFileIcon = (fileType: string | null | undefined) => {
    if (fileType === "photo") return <ImageIcon className="w-4 h-4" />;
    if (fileType === "video") return <Video className="w-4 h-4" />;
    if (fileType === "audio") return <Music className="w-4 h-4" />;
    if (fileType === "video_note") return <Circle className="w-4 h-4" />;
    return <FileText className="w-4 h-4" />;
  };

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

  const renderChatItem = (item: ChatItem) => {
    if (item.type === "event") {
      const event = item as TelegramEvent;
      // PATCH: Show message_text for ANY event that has it (not just manual/system notifications)
      const hasMessageText = !!event.message_text;
      
      // PATCH: Show extended info for access grant events
      const meta = event.meta as Record<string, unknown> | undefined;
      let displayText = getEventLabel(event.action);
      
      if (event.action === 'AUTO_GRANT' || event.action === 'MANUAL_GRANT') {
        const clubName = (meta?.club_name || meta?.product_name || '') as string;
        const tariffName = meta?.tariff_name as string | undefined;
        const accessEndDate = meta?.access_end_date as string | undefined;
        const validUntil = meta?.valid_until as string | undefined;
        const endDate = accessEndDate || (validUntil ? new Date(validUntil).toLocaleDateString('ru-RU') : null);
        
        const prefix = event.action === 'AUTO_GRANT' ? 'Авто-выдача' : 'Ручная выдача';
        const productInfo = clubName || 'Клуб';
        const tariffInfo = tariffName ? ` тариф ${tariffName}` : '';
        const dateInfo = endDate ? ` до ${endDate}` : '';
        
        displayText = `${prefix}: ${productInfo}${tariffInfo}${dateInfo}`;
      }
      
      const isSkipped = event.status === 'skipped';
      const isFailed = event.status === 'failed' || event.status === 'error';
      const skipReason = (meta?.reason || meta?.skip_reason) as string | undefined;
      const errorMsg = (meta as any)?.error_message as string | undefined;

      const pillBg = isSkipped
        ? 'bg-muted/40 border border-dashed border-muted-foreground/30'
        : isFailed
          ? 'bg-destructive/10 border border-destructive/30'
          : 'bg-muted';

      const statusSuffix = isSkipped
        ? ' · не отправлено'
        : isFailed
          ? ' · ошибка отправки'
          : '';

      return (
        <div key={event.id} className="flex justify-center my-2">
          <div className="flex flex-col items-center gap-1 max-w-[85%]">
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs text-muted-foreground ${pillBg}`}
              title={skipReason ? `Причина: ${skipReason}` : errorMsg || undefined}
            >
              {isSkipped ? (
                <AlertCircle className="w-3 h-3 text-muted-foreground" />
              ) : (
                EVENT_ICONS[event.action] || <Bell className="w-3 h-3" />
              )}
              <span>
                {displayText}
                {statusSuffix && <span className="opacity-70">{statusSuffix}</span>}
              </span>
              <span className="opacity-60">
                {format(new Date(event.created_at), "dd.MM HH:mm", { locale: ru })}
              </span>
              {event.status === 'success' && <CheckCircle className="w-3 h-3 text-green-500" />}
              {isFailed && <AlertCircle className="w-3 h-3 text-destructive" />}
            </div>
            {/* PATCH 13E: Show notification text (skipped тоже показываем, чтобы было видно что планировалось) */}
            {hasMessageText && (
              <div className="w-full px-4 py-2 bg-muted/50 rounded-lg text-xs text-muted-foreground border border-border/30">
                <div className="whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
                  {event.message_text}
                </div>
              </div>
            )}
            {isSkipped && skipReason && (
              <div className="text-[10px] text-muted-foreground/70 italic">
                Причина: {skipReason}
              </div>
            )}
          </div>
        </div>
      );
    }

    const msg = item as TelegramMessage;
    const metaAny: any = (msg as any).meta ?? {};
    const msgAny: any = msg as any;
    
    // Normalize all media fields (snake_case + camelCase fallbacks)
    const fileType = (metaAny.file_type ?? metaAny.fileType ?? msgAny.file_type ?? msgAny.fileType ?? null) as string | null;
    const fileName = (metaAny.file_name ?? metaAny.fileName ?? msgAny.file_name ?? msgAny.fileName ?? null) as string | null;
    const fileUrl = (metaAny.file_url ?? metaAny.fileUrl ?? msgAny.file_url ?? msgAny.fileUrl ?? null) as string | null;
    const mimeType = (metaAny.mime_type ?? metaAny.mimeType ?? msgAny.mime_type ?? msgAny.mimeType ?? null) as string | null;
    const bucket = (metaAny.storage_bucket ?? metaAny.storageBucket ?? msgAny.storage_bucket ?? msgAny.storageBucket ?? null) as string | null;
    const path = (metaAny.storage_path ?? metaAny.storagePath ?? msgAny.storage_path ?? msgAny.storagePath ?? null) as string | null;
    const uploadError = (metaAny.upload_error ?? metaAny.uploadError ?? msgAny.upload_error ?? msgAny.uploadError ?? null) as string | null;
    
    // Detect media-like messages (even if fileType is missing)
    const fileNameLooksLikeMedia = /\.(pdf|png|jpe?g|webp|gif|mp4|mov|mp3|m4a|ogg|wav|webm|oga|opus)$/i.test(fileName || "");
    const isMediaLike = !!(fileType || mimeType || (bucket && path) || fileNameLooksLikeMedia);

    const isEdited = (metaAny.edited ?? (msg as any).edited) as boolean | undefined;
    const isDeleted = (msg.status === "deleted" || metaAny.deleted || (msg as any).deleted) as boolean;
    const canEdit = msg.direction === "outgoing" && msg.message_id && msg.status === "sent" && !fileType && !isDeleted;
    const canDelete = msg.direction === "outgoing" && msg.message_id && msg.status === "sent" && !isDeleted;

    if (isDeleted) {
      return (
        <div
          key={msg.id}
          className={`flex ${msg.direction === "outgoing" ? "justify-end" : "justify-start"}`}
        >
          <div className="max-w-[80%] rounded-lg p-3 bg-muted/50 border border-dashed">
            <p className="text-sm text-muted-foreground italic">Сообщение удалено</p>
            <span className="text-xs opacity-60">
              {format(new Date(msg.created_at), "HH:mm", { locale: ru })}
            </span>
          </div>
        </div>
      );
    }

    const msgReactions = telegramReactionsMap?.[msg.id] || [];

    return (
      <div
        key={msg.id}
        className={`flex w-full min-w-0 ${msg.direction === "outgoing" ? "justify-end pr-1" : "justify-start"} group`}
      >
        <div className={`relative max-w-[80%] min-w-0 ${msg.direction === "outgoing" ? "mr-1" : ""}`}>
          <div className="flex flex-col w-full min-w-0">
            <div className="relative">
              <div
                className={`rounded-lg p-3 break-words overflow-hidden ${
                  msg.direction === "outgoing"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  {msg.direction === "outgoing" ? (
                    msg.admin_profile?.avatar_url ? (
                      <img src={msg.admin_profile.avatar_url} alt="" className="w-4 h-4 rounded-full object-cover flex-shrink-0" />
                    ) : (
                      <Bot className="w-3 h-3 flex-shrink-0" />
                    )
                  ) : (
                    avatarUrl ? (
                      <img src={avatarUrl} alt="" className="w-4 h-4 rounded-full object-cover flex-shrink-0" />
                    ) : (
                      <User className="w-3 h-3 flex-shrink-0" />
                    )
                  )}
                  <span className="text-xs opacity-70">
                    {msg.direction === "outgoing" 
                      ? (msg.admin_profile?.full_name || "Администратор") 
                      : (clientName || "Клиент")}
                  </span>
                </div>
                
                {/* Media preview with lightbox support - render if isMediaLike (not just fileType) */}
                {isMediaLike && (
                  <div className="mb-2">
    <ChatMediaMessage
                      fileType={fileType}
                      fileUrl={fileUrl}
                      fileName={fileName}
                      mimeType={mimeType}
                      errorMessage={uploadError}
                      isOutgoing={msg.direction === "outgoing"}
                      storageBucket={bucket}
                      storagePath={path}
                      uploadStatus={(metaAny.upload_status ?? metaAny.uploadStatus ?? null) as string | null}
                      onRefresh={() => refetchMessages()}
                    />
                  </div>
                )}
                
                {msg.message_text && (
                  <p className="text-sm whitespace-pre-wrap break-words">{msg.message_text}</p>
                )}

                {/* Inline keyboard mirror — рендер как нативные Telegram-кнопки.
                    Берём только url-кнопки (callback_data намеренно скрыты).
                    Кнопки тянутся на всю ширину пузыря, разделены тонкой линией от текста. */}
                {(() => {
                  const rm = (msg.meta as any)?.reply_markup;
                  const rows: Array<Array<{ text?: string; url?: string }>> = Array.isArray(rm?.inline_keyboard) ? rm.inline_keyboard : [];
                  const urlRows = rows
                    .map((row) => row.filter((b) => b && typeof b.url === "string" && b.url.trim().length > 0))
                    .filter((row) => row.length > 0);
                  if (urlRows.length === 0) return null;
                  const isOutgoing = msg.direction === "outgoing";
                  return (
                    <div className={cn(
                      "mt-2 pt-2 -mx-3 px-3 flex flex-col gap-1.5 border-t",
                      isOutgoing ? "border-primary-foreground/20" : "border-border/40",
                    )}>
                      {urlRows.map((row, ri) => (
                        <div key={ri} className="flex flex-wrap gap-1.5">
                          {row.map((btn, bi) => (
                            <a
                              key={bi}
                              href={btn.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={cn(
                                "flex-1 min-w-0 inline-flex items-center justify-center text-center h-9 px-3 rounded-lg text-sm font-medium transition-colors break-words",
                                isOutgoing
                                  ? "bg-primary-foreground/15 text-primary-foreground hover:bg-primary-foreground/25"
                                  : "bg-primary/10 text-primary hover:bg-primary/20",
                              )}
                            >
                              <span className="truncate">{btn.text || btn.url}</span>
                            </a>
                          ))}
                        </div>
                      ))}
                    </div>
                  );
                })()}

                <div className="flex items-center justify-end gap-1 mt-1">
                  {/* Авто badge — automated outgoing messages without admin author */}
                  {msg.direction === "outgoing" && !msg.sent_by_admin && (msg.meta as any)?.automated && (
                    <span
                      className="text-[10px] opacity-80 mr-1 px-1 rounded bg-primary-foreground/20"
                      title={(msg.meta as any)?.source ? `Автоматическое сообщение · ${(msg.meta as any).source}` : "Автоматическое сообщение"}
                    >
                      Авто
                    </span>
                  )}
                  {/* Bot badge — приоритет bot_name, fallback @username, иначе null */}
                  {(() => {
                    const joined = msg.telegram_bots;
                    const fromMap = msg.bot_id ? botsMap.get(msg.bot_id) : null;
                    const botName = msg.bot_name ?? joined?.bot_name ?? fromMap?.bot_name ?? null;
                    const botUsername = msg.bot_username ?? joined?.bot_username ?? fromMap?.bot_username ?? null;
                    const name = botName?.trim();
                    const label = name ? name : (botUsername?.trim() ? `@${botUsername.trim()}` : null);
                    return label ? (
                      <span className="text-[10px] opacity-70 mr-1">{label}</span>
                    ) : null;
                  })()}
                  {isEdited && (
                    <span className="text-xs opacity-60 mr-1">ред.</span>
                  )}
                  <span className="text-xs opacity-60">
                    {format(new Date(msg.created_at), "HH:mm", { locale: ru })}
                  </span>
                  {msg.direction === "outgoing" && (
                    <>
                      {msg.status === "sent" && <CheckCircle className="w-3 h-3 opacity-60" />}
                      {msg.status === "failed" && <AlertCircle className="w-3 h-3 text-destructive" />}
                      {msg.status === "pending" && <Clock className="w-3 h-3 opacity-60" />}
                    </>
                  )}
                </div>
              </div>

              {/* Emoji reaction picker — hover trigger */}
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    className={cn(
                      "absolute -bottom-2 opacity-0 group-hover:opacity-100 transition-opacity",
                      "h-6 w-6 rounded-full bg-card border border-border shadow-sm flex items-center justify-center hover:bg-accent",
                      msg.direction === "outgoing" ? "left-0" : "right-0"
                    )}
                  >
                    <SmilePlus className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-2" side="top" align="center">
                  <div className="grid grid-cols-10 gap-1">
                    {EMOJI_LIST.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => toggleTelegramReaction.mutate({ messageId: msg.id, emoji })}
                        className="h-7 w-7 flex items-center justify-center rounded hover:bg-accent text-sm transition-colors"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1.5 text-center leading-tight">
                    В Telegram отображается только 1 реакция от бота (лимит Telegram API)
                  </p>
                </PopoverContent>
              </Popover>
            </div>

            {/* Reactions display */}
            {msgReactions.length > 0 && (
              <div className={cn("flex flex-wrap gap-1 mt-1", msg.direction === "outgoing" && "justify-end")}>
                {msgReactions.map((r) => (
                  <button
                    key={r.emoji}
                    onClick={() => toggleTelegramReaction.mutate({ messageId: msg.id, emoji: r.emoji })}
                    className={cn(
                      "inline-flex items-center gap-1 h-6 px-1.5 rounded-full text-xs border transition-colors",
                      r.userReacted
                        ? "bg-primary/10 border-primary/30 text-primary"
                        : "bg-muted border-border hover:bg-accent"
                    )}
                  >
                    <span>{r.emoji}</span>
                    <span className="font-medium">{r.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {msg.direction === "outgoing" && (canEdit || canDelete) && (
            <div className="absolute -left-8 top-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                  >
                    <MoreVertical className="w-3 h-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {canEdit && (
                    <DropdownMenuItem
                      onClick={() => {
                        setEditingMessage(msg);
                        setEditText(msg.message_text || "");
                      }}
                    >
                      <Edit2 className="w-4 h-4 mr-2" />
                      Редактировать
                    </DropdownMenuItem>
                  )}
                  {canDelete && (
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => {
                        if (msg.message_id) {
                          deleteMutation.mutate({ dbMessageId: msg.id, messageId: msg.message_id });
                        }
                      }}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Удалить
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <TooltipProvider>
      <div className="flex flex-col h-full min-h-0">
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
            <div className="space-y-3 px-3 w-full max-w-full box-border">
              {chatItems.map((item, index) => {
                const currentDate = new Date(item.created_at);
                const prevItem = index > 0 ? chatItems[index - 1] : null;
                const prevDate = prevItem ? new Date(prevItem.created_at) : null;
                const showDateSeparator = !prevDate || !isSameDay(currentDate, prevDate);
                
                const getDateLabel = (date: Date) => {
                  if (isToday(date)) return "Сегодня";
                  if (isYesterday(date)) return "Вчера";
                  return format(date, "dd.MM.yyyy", { locale: ru });
                };
                
                return (
                  <div key={item.id}>
                    {showDateSeparator && (
                      <div className="flex items-center justify-center my-4">
                        <div className="flex-1 border-t border-border/30" />
                        <span className="px-3 py-1 text-xs text-muted-foreground bg-muted/50 rounded-full mx-2">
                          {getDateLabel(currentDate)}
                        </span>
                        <div className="flex-1 border-t border-border/30" />
                      </div>
                    )}
                    {renderChatItem(item)}
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
          )}
        </ScrollArea>

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
        <div className="pt-2 border-t shrink-0 bg-background" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          {activeBots.length > 1 && (
            <div className="flex items-center gap-1.5 pb-1.5">
              <Select value={selectedBotId || ""} onValueChange={handleBotChange}>
                <SelectTrigger className="h-7 w-auto min-w-[100px] text-[11px] rounded-lg border-border/40 bg-muted/30 gap-1 px-2">
                  <Bot className="h-3 w-3 shrink-0" />
                  <SelectValue placeholder="Бот" />
                </SelectTrigger>
                <SelectContent>
                  {activeBots.map(bot => (
                    <SelectItem key={bot.id} value={bot.id} className="text-xs">
                      {bot.bot_name?.trim() ? bot.bot_name : `@${bot.bot_username}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex gap-2">
          <div className="flex flex-col gap-1">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
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
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
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
                  let type: "photo" | "video" | "audio" | "video_note" | "document" | undefined;
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
          
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder="Введите сообщение..."
            className="min-h-[60px] max-h-[120px] resize-none flex-1"
            disabled={sendMutation.isPending || isUploading}
          />
          <div className="flex flex-col gap-1 items-end">
            <Button
              onClick={handleSend}
              disabled={(!message.trim() && !selectedFile) || sendMutation.isPending || isUploading || !selectedBotId}
              className="h-auto"
              title={!selectedBotId ? "Выберите бота для отправки" : undefined}
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
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