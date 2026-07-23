import { useMemo } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { INBOX_DIALOGS_QK } from "@/constants/inboxQueryKeys";
import { useAuth } from "@/contexts/AuthContext";
import { normalizeTelegramSearchInput } from "@/lib/telegramSearch";

/**
 * useUnifiedInbox — фронтенд-нормализация трёх источников
 * (Telegram / Instagram / Техподдержка) в единый список UnifiedDialog.
 *
 * НЕ меняет схему БД. Использует существующие источники:
 *   - Telegram: RPC get_inbox_dialogs_v1 (тот же ключ INBOX_DIALOGS_QK, что и моно-лента,
 *     благодаря чему React Query-дедупликация работает и в unified, и в моно).
 *   - Instagram: RPC get_instagram_dialogs_v1 по всем активным аккаунтам.
 *   - Support: таблица support_tickets (не closed/resolved).
 *
 * Preferences (pin/favorite) остаются в трёх разных таблицах и мутируются
 * своими API — здесь только чтение.
 */

export type UnifiedSource = "telegram" | "instagram" | "support";

export interface UnifiedRowCapabilities {
  canPin: boolean;
  canFavorite: boolean;
  canMarkRead: boolean;
}

export interface UnifiedDialog {
  /** Стабильный ключ строки для React key и mark-read. */
  key: string;
  source: UnifiedSource;
  /** Технический ID внутри источника (user_id / `${account}:${thread_key}` / ticket_id). */
  sourceId: string;
  /** Дополнительный ярлык источника: имя бота / @аккаунт IG / null для support. */
  sourceLabel: string | null;
  displayName: string;
  avatarUrl: string | null;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
  /** Есть ли неотвеченное входящее (для сортировки). */
  isUnanswered: boolean;
  isPinned: boolean;
  isFavorite: boolean;
  /**
   * Возможности источника для hover-действий строки.
   * Backend-схема не расширяется — если поля/таблицы нет, capability=false и
   * иконка в UI просто не показывается (см. UnifiedInboxView).
   */
  capabilities: UnifiedRowCapabilities;
  /** Технические поля источника, нужные правой панели. */
  meta: {
    /** profiles.id — общий канон для ChannelPicker (V2-CHANNELS). */
    profileId?: string | null;
    /** profiles.user_id (UUID) — используется как chat key и передаётся как `userId` в ContactTelegramChat. */
    telegramUserId?: string;
    /** profiles.telegram_user_id (числовой Telegram ID) — обязателен для ContactTelegramChat, иначе он показывает «Telegram не привязан». */
    telegramNumericId?: number | null;
    telegramUsername?: string | null;
    telegramBotId?: string | null;
    telegramBotUsername?: string | null;
    telegramBotName?: string | null;
    instagramAccountId?: string;
    /** thread_key из RPC get_instagram_dialogs_v1 — стабильный ключ строки/mark_read. */
    instagramThreadKey?: string;
    /** ig_thread_id из RPC — тот же, что ждёт instagram-admin-chat/get_history. Может быть null для новых диалогов. */
    instagramThreadId?: string | null;
    instagramPeerId?: string;
    /** instagram_contacts.instagram_user_id — IG-side peer id (== peer_id). */
    instagramUserId?: string;
    /** instagram_contacts.id — нужен для link/unlink RPC (V2-CHANNELS P2). */
    instagramContactId?: string | null;
    instagramSenderName?: string | null;
    ticketId?: string;
    ticketStatus?: string;
    ticketProfileId?: string | null;
    ticketUserId?: string | null;
  };
}

const TG_CAPS: UnifiedRowCapabilities = { canPin: true, canFavorite: true, canMarkRead: true };
const IG_CAPS: UnifiedRowCapabilities = { canPin: true, canFavorite: true, canMarkRead: true };
const SUPPORT_CAPS: UnifiedRowCapabilities = { canPin: true, canFavorite: true, canMarkRead: true };


const SOURCE_PRIORITY: Record<UnifiedSource, number> = {
  telegram: 0,
  instagram: 1,
  support: 2,
};

/**
 * V3-PROFILE-GROUPING (2026-07-04):
 * Одна строка ленты = один контакт. Каналы (TG/IG/Support) сгруппированы
 * внутри карточки. См. docs/audit/2026-07-04-unified-inbox-v3-profile-grouping.md.
 */
export interface SourceChannelRef {
  /** Стабильный ключ source-row (`tg:<id>` / `ig:<acc>:<thread>` / `support:<id>`). */
  key: string;
  source: UnifiedSource;
  /** Полный source-row — правая панель и row actions работают через него. */
  sourceRow: UnifiedDialog;
  unread: number;
  pinned: boolean;
  favorite: boolean;
  lastMessageAt: string;
  lastMessagePreview: string;
}

export interface UnifiedContactRow {
  /** `profile:<id>` для grouped, `source:<src>:<key>` для одиноких. */
  key: string;
  profileId: string | null;
  displayName: string;
  avatarUrl: string | null;
  channels: Partial<Record<UnifiedSource, SourceChannelRef>>;
  availableSources: UnifiedSource[];
  /** Канал последнего сообщения — default для activeSource и для preview в списке. */
  defaultActiveSource: UnifiedSource;
  lastMessageAt: string;
  lastMessageSource: UnifiedSource;
  lastMessagePreview: string;
  totalUnread: number;
  isUnanswered: boolean;
  isPinned: boolean;
  isFavorite: boolean;
}

/** Backward-compat alias. */
export type UnifiedInboxRow = UnifiedContactRow;

/**
 * Достать SourceChannelRef активного канала для правой панели / row actions.
 * Fallback: если запрошенный source отсутствует — defaultActiveSource.
 */
export function getActiveChannel(
  row: UnifiedContactRow,
  activeSource: UnifiedSource | null | undefined,
): SourceChannelRef | null {
  const src = activeSource && row.channels[activeSource] ? activeSource : row.defaultActiveSource;
  return row.channels[src] ?? null;
}

interface Options {
  enabled: boolean;
  perSourceLimit?: number;
  search?: string;
}

export function useUnifiedInbox({ enabled, perSourceLimit = 75, search = "" }: Options) {
  const { user } = useAuth();
  const serverSearch = normalizeTelegramSearchInput(search);
  const effectiveTelegramLimit = serverSearch ? 100 : perSourceLimit;

  // --- Telegram ---
  // Отдельный queryKey от INBOX_DIALOGS_QK: моно-InboxTabContent кэширует
  // обогащённые Dialog[] (с profile/orders/last_message), а здесь мы держим
  // сырые RPC-строки. Общий ключ приводил к тому, что при переключении
  // вкладок «Все» / «Telegram» компонент читал чужую форму данных из кэша
  // и показывал «Неизвестный» / пустой preview до следующего refetch.
  const tg = useInfiniteQuery({
    queryKey: ["unified-inbox-telegram", effectiveTelegramLimit, serverSearch],
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc("get_inbox_dialogs_v1", {
        p_limit: effectiveTelegramLimit,
        p_offset: pageParam,
        p_search: serverSearch || null,
      });
      if (error) throw error;
      const rows = (data || []) as any[];
      return {
        rows,
        nextOffset:
          rows.length === effectiveTelegramLimit
            ? pageParam + effectiveTelegramLimit
            : undefined,
      };
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset,
  });
  const tgRows = useMemo(
    () => tg.data?.pages.flatMap((page) => page.rows) || [],
    [tg.data],
  );

  // --- Telegram: параллельно тянем chat_preferences (pin/fav) для оператора ---
  const tgPrefs = useQuery({
    queryKey: ["chat-preferences", user?.id],
    enabled: enabled && !!user?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_preferences")
        .select("contact_user_id, is_pinned, is_favorite")
        .eq("admin_user_id", user!.id);
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  // --- Telegram profile enrichment (avatar/name) для user_id, которых нет в telegram_messages payload ---
  const tgUserIds = useMemo(
    () => tgRows.map((d: any) => d.user_id),
    [tgRows],
  );
  const tgProfiles = useQuery({
    queryKey: ["unified-tg-profiles", tgUserIds],
    enabled: enabled && tgUserIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      // HOTFIX: тот же баг, что в InboxTabContent — `.or(...)` с 100+ UUID
      // превышал URL limit PostgREST. Разводим на два .in()-запроса и
      // де-дублируем по profile.id.
      const [byUserId, byId] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, user_id, full_name, email, avatar_url, telegram_user_id, telegram_username")
          .in("user_id", tgUserIds as string[]),
        supabase
          .from("profiles")
          .select("id, user_id, full_name, email, avatar_url, telegram_user_id, telegram_username")
          .in("id", tgUserIds as string[]),
      ]);
      if (byUserId.error) console.error("[unified-tg-profiles] by user_id error:", byUserId.error);
      if (byId.error) console.error("[unified-tg-profiles] by id error:", byId.error);
      const m = new Map<string, any>();
      (byUserId.data || []).forEach((p: any) => m.set(p.id, p));
      (byId.data || []).forEach((p: any) => m.set(p.id, p));
      return Array.from(m.values()) as any[];
    },
  });

  // --- Instagram: аккаунты + диалоги по каждому активному аккаунту ---
  const igAccounts = useQuery({
    queryKey: ["unified-ig-accounts"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("instagram-admin-chat", {
        body: { action: "get_accounts" },
      });
      if (error) throw error;
      const all = (data?.accounts || []) as any[];
      return all.filter((a) => a.is_active !== false && a.status !== "error");
    },
  });

  const igAccountIds = useMemo(
    () => (igAccounts.data || []).map((a: any) => a.id),
    [igAccounts.data],
  );

  const igDialogs = useQuery({
    queryKey: ["unified-ig-dialogs", igAccountIds],
    enabled: enabled && igAccountIds.length > 0,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const results = await Promise.all(
        igAccountIds.map(async (accountId: string) => {
          const { data, error } = await supabase.rpc("get_instagram_dialogs_v1", {
            p_account_id: accountId,
          });
          if (error) {
            throw new Error(`Instagram ${accountId}: ${error.message}`);
          }
          return ((data || []) as any[]).map((d) => ({ ...d, __accountId: accountId }));
        }),
      );
      return results.flat();
    },
  });

  const igAccountLabel = useMemo(() => {
    const map = new Map<string, string>();
    (igAccounts.data || []).forEach((a: any) => {
      const name = a.display_name || a.account_name || a.instagram_page_id || a.id;
      map.set(a.id, name);
    });
    return map;
  }, [igAccounts.data]);

  // Загружаем instagram_contacts для видимых аккаунтов — источник canonical
  // profile_id и instagram_contacts.id (нужны для ChannelPicker и link RPC).
  // RPC уже возвращает profile_id, но не отдаёт contact.id.
  const igContacts = useQuery({
    queryKey: ["unified-ig-contacts", igAccountIds],
    enabled: enabled && igAccountIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("instagram_contacts")
        .select("id, instagram_account_id, instagram_user_id, profile_id, instagram_username, full_name")
        .in("instagram_account_id", igAccountIds as string[]);
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const igContactMap = useMemo(() => {
    const m = new Map<string, { id: string; profile_id: string | null }>();
    (igContacts.data || []).forEach((c: any) => {
      m.set(`${c.instagram_account_id}:${c.instagram_user_id}`, {
        id: c.id,
        profile_id: c.profile_id ?? null,
      });
    });
    return m;
  }, [igContacts.data]);

  // --- Instagram: personal prefs (pin/fav) для текущего оператора ---
  const igPrefs = useQuery({
    queryKey: ["unified-ig-prefs", user?.id, igAccountIds],
    enabled: enabled && !!user?.id && igAccountIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("instagram_dialog_preferences")
        .select("instagram_account_id, thread_key, is_pinned, is_favorite")
        .eq("admin_user_id", user!.id)
        .in("instagram_account_id", igAccountIds as string[]);
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const igPrefMap = useMemo(() => {
    const m = new Map<string, { is_pinned: boolean; is_favorite: boolean }>();
    (igPrefs.data || []).forEach((p: any) => {
      m.set(`${p.instagram_account_id}:${p.thread_key}`, {
        is_pinned: !!p.is_pinned,
        is_favorite: !!p.is_favorite,
      });
    });
    return m;
  }, [igPrefs.data]);

  // --- Support: тикеты, отсортированные по last_activity ---
  const support = useInfiniteQuery({
    queryKey: ["unified-support-tickets"],
    enabled,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase
        .from("support_tickets")
        .select(
          "id, ticket_number, subject, status, has_unread_admin, is_starred, updated_at, user_id, profile_id",
        )
        .not("status", "in", "(closed,resolved)")
        .is("merged_into_ticket_id", null)
        .order("updated_at", { ascending: false })
        .order("id", { ascending: false })
        .range(pageParam, pageParam + perSourceLimit - 1);
      if (error) throw error;
      const rows = (data || []) as any[];
      return {
        rows,
        nextOffset:
          rows.length === perSourceLimit
            ? pageParam + perSourceLimit
            : undefined,
      };
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset,
  });
  const supportRows = useMemo(
    () => support.data?.pages.flatMap((page) => page.rows) || [],
    [support.data],
  );

  const supportProfileIds = useMemo(
    () =>
      Array.from(
        new Set(
          supportRows
            .map((t: any) => t.profile_id)
            .filter((x: any): x is string => !!x),
        ),
      ),
    [supportRows],
  );

  const supportProfiles = useQuery({
    queryKey: ["unified-support-profiles", supportProfileIds],
    enabled: enabled && supportProfileIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, avatar_url")
        .in("id", supportProfileIds as string[]);
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  // --- Normalize + merge + sort ---
  const rows = useMemo<UnifiedDialog[]>(() => {
    if (!enabled) return [];

    const tgProfileMap = new Map<string, any>();
    (tgProfiles.data || []).forEach((p: any) => {
      if (p.user_id) tgProfileMap.set(p.user_id, p);
      if (p.id) tgProfileMap.set(p.id, p);
    });
    const tgPrefMap = new Map<string, { is_pinned: boolean; is_favorite: boolean }>();
    (tgPrefs.data || []).forEach((p: any) =>
      tgPrefMap.set(p.contact_user_id, {
        is_pinned: !!p.is_pinned,
        is_favorite: !!p.is_favorite,
      }),
    );
    const supportProfileMap = new Map<string, any>();
    (supportProfiles.data || []).forEach((p: any) => supportProfileMap.set(p.id, p));

    const out: UnifiedDialog[] = [];

    // Telegram
    for (const d of tgRows) {
      const p = tgProfileMap.get(d.user_id);
      const pref = tgPrefMap.get(d.user_id);
      out.push({
        key: `tg:${d.user_id}`,
        source: "telegram",
        sourceId: d.user_id,
        sourceLabel: d.last_bot_name || d.last_bot_username || null,
        displayName: p?.full_name || p?.email || "Без имени",
        avatarUrl: p?.avatar_url || null,
        lastMessage: d.last_message_text || (d.last_message_type ? `[${d.last_message_type}]` : ""),
        lastMessageAt: d.last_message_at,
        unreadCount: Number(d.unread_count) || 0,
        isUnanswered: (Number(d.unread_count) || 0) > 0,
        isPinned: pref?.is_pinned || false,
        isFavorite: pref?.is_favorite || false,
        capabilities: TG_CAPS,
        meta: {
          profileId: p?.id ?? null,
          telegramUserId: d.user_id,
          telegramNumericId: p?.telegram_user_id ?? null,
          telegramUsername: p?.telegram_username ?? null,
          telegramBotId: d.last_bot_id || null,
          telegramBotUsername: d.last_bot_username || null,
          telegramBotName: d.last_bot_name || null,
        },
      });
    }

    // Instagram
    for (const d of igDialogs.data || []) {
      const accountLabel = igAccountLabel.get(d.__accountId) || null;
      const unread = Number(d.unread_count) || 0;
      const prefKey = `${d.__accountId}:${d.thread_key || d.peer_id}`;
      const pref = igPrefMap.get(prefKey);
      out.push({
        key: `ig:${d.__accountId}:${d.thread_key || d.peer_id}`,
        source: "instagram",
        sourceId: `${d.__accountId}:${d.thread_key || d.peer_id}`,
        sourceLabel: accountLabel ? `@${accountLabel}` : null,
        displayName: d.full_name || d.sender_name || d.instagram_username || "Instagram",
        avatarUrl: d.avatar_url || null,
        lastMessage: d.last_message || (d.last_media_url ? "[медиа]" : ""),
        lastMessageAt: d.last_at,
        unreadCount: unread,
        isUnanswered: unread > 0,
        isPinned: pref?.is_pinned ?? !!d.is_pinned,
        isFavorite: pref?.is_favorite ?? false,
        capabilities: IG_CAPS,
        meta: {
          profileId: (igContactMap.get(`${d.__accountId}:${d.peer_id}`)?.profile_id) ?? d.profile_id ?? null,
          instagramAccountId: d.__accountId,
          instagramThreadKey: d.thread_key,
          instagramThreadId: d.ig_thread_id ?? null,
          instagramPeerId: d.peer_id,
          instagramUserId: d.peer_id,
          instagramContactId: igContactMap.get(`${d.__accountId}:${d.peer_id}`)?.id ?? null,
          instagramSenderName: d.sender_name,
        },
      });
    }

    // Support
    for (const t of supportRows) {
      const p = t.profile_id ? supportProfileMap.get(t.profile_id) : null;
      const unread = t.has_unread_admin ? 1 : 0;
      out.push({
        key: `support:${t.id}`,
        source: "support",
        sourceId: t.id,
        sourceLabel: null,
        displayName: p?.full_name || p?.email || `Тикет #${t.ticket_number || t.id.slice(0, 6)}`,
        avatarUrl: p?.avatar_url || null,
        lastMessage: t.subject || "",
        lastMessageAt: t.updated_at,
        unreadCount: unread,
        isUnanswered: unread > 0,
        isPinned: !!t.is_pinned,
        isFavorite: !!t.is_starred,
        capabilities: SUPPORT_CAPS,
        meta: {
          profileId: t.profile_id ?? null,
          ticketId: t.id,
          ticketStatus: t.status,
          ticketProfileId: t.profile_id,
          ticketUserId: t.user_id,
        },
      });
    }

    // Строгая сортировка с tie-breaker'ами, чтобы порядок не прыгал.
    out.sort((a, b) => {
      if (a.isUnanswered !== b.isUnanswered) return a.isUnanswered ? -1 : 1;
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      const bt = new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
      if (bt !== 0) return bt;
      const sp = SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source];
      if (sp !== 0) return sp;
      return a.key.localeCompare(b.key);
    });

    return out;
  }, [
    enabled,
    tgRows,
    tgProfiles.data,
    tgPrefs.data,
    igDialogs.data,
    igAccountLabel,
    igContactMap,
    igPrefMap,
    supportRows,
    supportProfiles.data,
  ]);

  // --- V3 profile grouping ---
  const contactRows = useMemo<UnifiedContactRow[]>(() => {
    if (!enabled) return [];

    // profileId -> aggregate
    const byKey = new Map<string, UnifiedContactRow>();
    // For deterministic displayName/avatar: prefer profile-linked TG row (уже enriched
    // by profile). Затем IG. Затем support. Fallback — most-recent channel.
    const namePriority: UnifiedSource[] = ["telegram", "instagram", "support"];

    for (const r of rows) {
      const groupKey = r.meta.profileId
        ? `profile:${r.meta.profileId}`
        : `source:${r.source}:${r.sourceId}`;

      const ref: SourceChannelRef = {
        key: r.key,
        source: r.source,
        sourceRow: r,
        unread: r.unreadCount,
        pinned: r.isPinned,
        favorite: r.isFavorite,
        lastMessageAt: r.lastMessageAt,
        lastMessagePreview: r.lastMessage,
      };

      const existing = byKey.get(groupKey);
      if (!existing) {
        byKey.set(groupKey, {
          key: groupKey,
          profileId: r.meta.profileId ?? null,
          displayName: r.displayName,
          avatarUrl: r.avatarUrl,
          channels: { [r.source]: ref } as any,
          availableSources: [r.source],
          defaultActiveSource: r.source,
          lastMessageAt: r.lastMessageAt,
          lastMessageSource: r.source,
          lastMessagePreview: r.lastMessage,
          totalUnread: r.unreadCount,
          isUnanswered: r.isUnanswered,
          isPinned: r.isPinned,
          isFavorite: r.isFavorite,
        });
        continue;
      }

      // Support-дубли: если тот же profileId и уже есть support-канал —
      // берём тот, у кого lastMessageAt свежее (визуальная группировка,
      // не data-merge).
      if (existing.channels[r.source]) {
        const prev = existing.channels[r.source]!;
        if (new Date(r.lastMessageAt).getTime() > new Date(prev.lastMessageAt).getTime()) {
          existing.channels[r.source] = ref;
        } else {
          // старый канал — не заменяем; но unread всё равно суммируем ниже? Нет:
          // это тот же source (например два support ticket) — оставляем только
          // самый свежий, чтобы не двоить unread.
          continue;
        }
      } else {
        existing.channels[r.source] = ref;
        existing.availableSources.push(r.source);
      }

      existing.totalUnread += r.unreadCount;
      existing.isUnanswered = existing.isUnanswered || r.isUnanswered;
      existing.isPinned = existing.isPinned || r.isPinned;
      existing.isFavorite = existing.isFavorite || r.isFavorite;

      if (new Date(r.lastMessageAt).getTime() > new Date(existing.lastMessageAt).getTime()) {
        existing.lastMessageAt = r.lastMessageAt;
        existing.lastMessageSource = r.source;
        existing.lastMessagePreview = r.lastMessage;
        existing.defaultActiveSource = r.source;
      }
    }

    // Детерминированный displayName/avatar для grouped rows.
    for (const c of byKey.values()) {
      if (!c.profileId) continue;
      for (const src of namePriority) {
        const ch = c.channels[src];
        if (ch && ch.sourceRow.displayName && ch.sourceRow.displayName !== "Instagram" && !ch.sourceRow.displayName.startsWith("Тикет #")) {
          c.displayName = ch.sourceRow.displayName;
          c.avatarUrl = ch.sourceRow.avatarUrl ?? c.avatarUrl;
          break;
        }
      }
    }

    const list = Array.from(byKey.values());

    // Стабильная сортировка после группировки.
    list.sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      if (a.isUnanswered !== b.isUnanswered) return a.isUnanswered ? -1 : 1;
      const bt = new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
      if (bt !== 0) return bt;
      return a.displayName.localeCompare(b.displayName) || a.key.localeCompare(b.key);
    });

    return list;
  }, [enabled, rows]);

  return {
    /** V3 API: одна строка на контакт. */
    contactRows,
    /** Внутренний source-level список (для legacy/debug). */
    rows,
    isLoading:
      enabled &&
      (tg.isLoading || igDialogs.isLoading || support.isLoading),
    errors: {
      telegram: tg.error as Error | null,
      instagram: igDialogs.error as Error | null,
      support: support.error as Error | null,
    },
    counts: {
      telegramUnread: tgRows.reduce(
        (s: number, d: any) => s + (Number(d.unread_count) || 0),
        0,
      ),
      instagramUnread: (igDialogs.data || []).reduce(
        (s: number, d: any) => s + (Number(d.unread_count) || 0),
        0,
      ),
      supportUnread: supportRows.filter((t: any) => t.has_unread_admin).length,
    },
    hasNextPage: !!tg.hasNextPage || !!support.hasNextPage,
    isFetchingNextPage: tg.isFetchingNextPage || support.isFetchingNextPage,
    fetchNextPage: async () => {
      await Promise.all([
        tg.hasNextPage ? tg.fetchNextPage() : Promise.resolve(),
        support.hasNextPage ? support.fetchNextPage() : Promise.resolve(),
      ]);
    },
  };
}
