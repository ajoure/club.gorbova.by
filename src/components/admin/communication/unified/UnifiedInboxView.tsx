import { useEffect, useMemo, useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Search, MessageSquare, RefreshCw, Check, Star, Pin, UserRoundCheck, UserMinus, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import {
  INBOX_DIALOGS_QK,
  UNREAD_MESSAGES_COUNT_QK,
} from "@/constants/inboxQueryKeys";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  normalizeTelegramNumericSearch,
  normalizeTelegramSearchInput,
  normalizeTelegramUsernameSearch,
} from "@/lib/telegramSearch";

import {
  useUnifiedInbox,
  getActiveChannel,
  type UnifiedContactRow,
  type UnifiedSource,
  type SourceChannelRef,
  type UnifiedInboxCounts,
} from "@/hooks/useUnifiedInbox";
import { SourceBadge } from "./SourceBadge";
import { ContactTelegramChat } from "@/components/admin/ContactTelegramChat";
import { ContactInstagramChat } from "@/components/admin/communication/instagram/ContactInstagramChat";
import { TicketChat } from "@/components/support/TicketChat";
import { ChannelPicker } from "./ChannelPicker";
import { UnifiedChatHeader } from "./UnifiedChatHeader";
import { AdminInitiateTicketDialog } from "./AdminInitiateTicketDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const PANEL_KEY = "unified-inbox-panel-sizes";

type SourceFilter = "all" | UnifiedSource;

function isUnansweredForSource(row: UnifiedContactRow, source: SourceFilter): boolean {
  return source === "all"
    ? row.isUnanswered
    : !!row.channels[source]?.sourceRow.isUnanswered;
}

interface Props {
  /** Внешний фильтр по источнику из дропдауна «Сообщения». Undefined = «Все». */
  sourceFilter?: SourceFilter;
  /** Поднимает канонические счётчики карточек в общий header контакт-центра. */
  onCountsChange?: (counts: UnifiedInboxCounts) => void;
  /** Авторизованный deep-link из Telegram-уведомления на конкретный диалог. */
  deepLinkTelegramUserId?: string | null;
}

export function UnifiedInboxView({
  sourceFilter = "all",
  onCountsChange,
  deepLinkTelegramUserId = null,
}: Props) {
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  const serverSearch = normalizeTelegramSearchInput(debouncedSearch);
  const {
    contactRows,
    isLoading,
    loadingBySource,
    errors,
    counts,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useUnifiedInbox({ enabled: true, search: serverSearch });
  const viewIsLoading = sourceFilter === "all" ? isLoading : loadingBySource[sourceFilter];
  useEffect(() => {
    onCountsChange?.(counts);
  }, [counts, onCountsChange]);
  type FilterKind = "all" | "unread" | "favorite" | "pinned" | "mine";
  const [filterKind, setFilterKind] = useState<FilterKind>("all");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [managerFilter, setManagerFilter] = useState<string>("all");

  const { data: assignees = [] } = useQuery({
    queryKey: ["contact-center-assignees"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_contact_center_assignees_v1" as any);
      if (error) throw error;
      return (data || []) as Array<{ user_id: string; display_name: string }>;
    },
    staleTime: 60_000,
  });
  const { data: assignments = [] } = useQuery({
    queryKey: ["contact-center-assignments"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_contact_center_assignments_v2" as any);
      if (error) throw error;
      return (data || []) as Array<{
        id: string;
        source_message_id: string;
        telegram_user_id: string;
        assignee_user_id: string;
        assignee_name: string;
        is_answered: boolean;
      }>;
    },
    staleTime: 15_000,
  });
  const assignmentByTelegramUserId = useMemo(
    () => {
      const byDialog = new Map<string, (typeof assignments)[number]>();
      for (const assignment of assignments) {
        // RPC returns newest first. Keep one canonical folder card per dialog.
        if (!byDialog.has(assignment.telegram_user_id)) {
          byDialog.set(assignment.telegram_user_id, assignment);
        }
      }
      return byDialog;
    },
    [assignments],
  );
  const myAssignmentCount = useMemo(
    () => new Set(
      assignments
        .filter((assignment) => assignment.assignee_user_id === user?.id)
        .map((assignment) => assignment.telegram_user_id),
    ).size,
    [assignments, user?.id],
  );

  /**
   * Per-contact override активного канала. Если override отсутствует —
   * берётся defaultActiveSource (source последнего сообщения). Sourced
   * from source filter при первом выборе строки.
   */
  const [activeSourceByKey, setActiveSourceByKey] = useState<Record<string, UnifiedSource>>({});

  /**
   * Track последнего выбранного sourceRow.key — если после regroup grouped
   * row сменил ключ (attach IG → сливается в profile-row), fallback найдёт
   * новую grouped row, содержащую тот же source key.
   */
  const [lastSelectedSourceKey, setLastSelectedSourceKey] = useState<string | null>(null);
  const openedDeepLinkRef = useRef<string | null>(null);

  // PATCH-ADMIN-INITIATE-SUPPORT-TICKET: диалог создания обращения из карточки контакта.
  const [initiateFor, setInitiateFor] = useState<UnifiedContactRow | null>(null);
  const [pendingSupportForProfileId, setPendingSupportForProfileId] = useState<string | null>(null);

  const [panelSize] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(PANEL_KEY);
      if (saved) return JSON.parse(saved).left || 40;
    } catch {}
    return 40;
  });
  const savePanel = (sizes: number[]) => {
    try {
      localStorage.setItem(PANEL_KEY, JSON.stringify({ left: sizes[0] }));
    } catch {}
  };

  const matchesSearch = (r: UnifiedContactRow, q: string): boolean => {
    if (!q) return true;
    const normalized = normalizeTelegramSearchInput(q);
    const lc = normalized.toLowerCase();
    const usernameSearch = normalizeTelegramUsernameSearch(normalized);
    const numericSearch = normalizeTelegramNumericSearch(normalized);

    if (r.displayName.toLowerCase().includes(lc)) return true;
    for (const src of r.availableSources) {
      const ch = r.channels[src]!;
      if (ch.lastMessagePreview.toLowerCase().includes(lc)) return true;
      const sl = ch.sourceRow.sourceLabel || "";
      if (sl.toLowerCase().includes(lc)) return true;
      const meta = ch.sourceRow.meta;
      const tgUsername = normalizeTelegramUsernameSearch(meta.telegramUsername);
      if (usernameSearch && tgUsername.includes(usernameSearch)) return true;
      if (numericSearch && String(meta.telegramNumericId || "") === numericSearch) return true;
      if (meta.telegramUserId?.toLowerCase().includes(lc)) return true;
      if (meta.profileId?.toLowerCase().includes(lc)) return true;
      if (meta.instagramSenderName?.toLowerCase().includes(lc)) return true;
      if (meta.instagramUserId?.toLowerCase().includes(lc)) return true;
      if (meta.ticketUserId?.toLowerCase().includes(lc)) return true;
    }
    return false;
  };

  const filtered = useMemo(() => {
    return contactRows.filter((r) => {
      if (sourceFilter !== "all" && !r.channels[sourceFilter]) return false;
      if (filterKind === "unread" && !isUnansweredForSource(r, sourceFilter)) return false;
      if (filterKind === "favorite" && !r.isFavorite) return false;
      if (filterKind === "pinned" && !r.isPinned) return false;
      const tgUserId = r.channels.telegram?.sourceRow.meta.telegramUserId;
      const assignment = tgUserId ? assignmentByTelegramUserId.get(tgUserId) : undefined;
      if (filterKind === "mine" && assignment?.assignee_user_id !== user?.id) return false;
      if (managerFilter !== "all" && assignment?.assignee_user_id !== managerFilter) return false;
      if (serverSearch && r.channels.telegram) return true;
      if (!matchesSearch(r, serverSearch)) return false;
      return true;
    });
  }, [contactRows, sourceFilter, filterKind, serverSearch, assignmentByTelegramUserId, managerFilter, user?.id]);

  const counts2 = useMemo(() => {
    let all = 0, unread = 0, fav = 0, pinned = 0;
    for (const r of contactRows) {
      if (sourceFilter !== "all" && !r.channels[sourceFilter]) continue;
      all++;
      if (isUnansweredForSource(r, sourceFilter)) unread++;
      if (r.isFavorite) fav++;
      if (r.isPinned) pinned++;
    }
    return { all, unread, fav, pinned };
  }, [contactRows, sourceFilter]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 88,
    overscan: 5,
  });
  const virtualItems = virtualizer.getVirtualItems();

  // Подгружаем следующую страницу до того, как оператор упрётся в конец.
  // Список остаётся виртуализированным: количество DOM-узлов не растёт вместе
  // с историей, поэтому длинная лента не блокирует скролл на iOS.
  useEffect(() => {
    const last = virtualItems[virtualItems.length - 1];
    if (
      last &&
      last.index >= filtered.length - 8 &&
      hasNextPage &&
      !isFetchingNextPage
    ) {
      void fetchNextPage();
    }
  }, [
    virtualItems,
    filtered.length,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  ]);

  // Resolve selected: сначала пробуем текущий key; если исчез — ищем grouped
  // row, содержащую lastSelectedSourceKey (обработка attach IG → merge).
  const selected: UnifiedContactRow | null = useMemo(() => {
    if (!selectedKey) return null;
    const direct = contactRows.find((r) => r.key === selectedKey);
    if (direct) return direct;
    if (lastSelectedSourceKey) {
      const fallback = contactRows.find((r) =>
        r.availableSources.some((s) => r.channels[s]!.key === lastSelectedSourceKey),
      );
      if (fallback) return fallback;
    }
    return null;
  }, [contactRows, selectedKey, lastSelectedSourceKey]);

  // Если selected сменил key — обновим selectedKey (без мигания).
  useEffect(() => {
    if (selected && selected.key !== selectedKey) {
      setSelectedKey(selected.key);
    }
  }, [selected, selectedKey]);

  // Выбор активного source внутри selected-контакта.
  const activeSource: UnifiedSource = useMemo(() => {
    if (!selected) return "telegram";
    const override = selected.key ? activeSourceByKey[selected.key] : undefined;
    if (override && selected.channels[override]) return override;
    // Source filter влияет на default active source (если канал есть у контакта).
    if (sourceFilter !== "all" && selected.channels[sourceFilter]) return sourceFilter;
    return selected.defaultActiveSource;
  }, [selected, activeSourceByKey, sourceFilter]);

  const activeChannel: SourceChannelRef | null = selected ? getActiveChannel(selected, activeSource) : null;

  const selectContact = (row: UnifiedContactRow) => {
    setSelectedKey(row.key);
    const initialSource: UnifiedSource =
      sourceFilter !== "all" && row.channels[sourceFilter]
        ? sourceFilter
        : row.defaultActiveSource;
    // Freeze the operator's chosen channel for this contact. Background list
    // refreshes may change defaultActiveSource when another integration gets
    // a message; they must not remount/switch the open chat under the cursor.
    setActiveSourceByKey((prev) => ({ ...prev, [row.key]: initialSource }));
    const ch = row.channels[initialSource]!;
    setLastSelectedSourceKey(ch.key);
  };

  // Ссылка из Telegram открывает именно назначенный диалог, включая mobile/PWA.
  // Повторные фоновые refetch не должны перехватывать ручной выбор оператора.
  useEffect(() => {
    if (!deepLinkTelegramUserId || openedDeepLinkRef.current === deepLinkTelegramUserId) return;
    const row = contactRows.find(
      (candidate) => candidate.channels.telegram?.sourceRow.meta.telegramUserId === deepLinkTelegramUserId,
    );
    if (!row?.channels.telegram) return;
    openedDeepLinkRef.current = deepLinkTelegramUserId;
    setSelectedKey(row.key);
    setActiveSourceByKey((prev) => ({ ...prev, [row.key]: "telegram" }));
    setLastSelectedSourceKey(row.channels.telegram.key);
  }, [contactRows, deepLinkTelegramUserId]);

  const changeActiveSource = (source: UnifiedSource) => {
    if (!selected || !selected.channels[source]) return;
    setActiveSourceByKey((prev) => ({ ...prev, [selected.key]: source }));
    setLastSelectedSourceKey(selected.channels[source]!.key);
  };

  // После создания тикета: как только support-канал появится в grouped row
  // ждущего profile, переключаем правую панель на 'support' и снимаем pending.
  useEffect(() => {
    if (!pendingSupportForProfileId) return;
    const row = contactRows.find((r) => r.profileId === pendingSupportForProfileId);
    if (row && row.channels.support) {
      setActiveSourceByKey((prev) => ({ ...prev, [row.key]: "support" }));
      setSelectedKey(row.key);
      setLastSelectedSourceKey(row.channels.support!.key);
      setPendingSupportForProfileId(null);
    }
  }, [contactRows, pendingSupportForProfileId]);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: INBOX_DIALOGS_QK });
    queryClient.invalidateQueries({ queryKey: ["unified-inbox-telegram"] });
    queryClient.invalidateQueries({ queryKey: ["unified-ig-dialogs"] });
    queryClient.invalidateQueries({ queryKey: ["unified-ig-contacts"] });
    queryClient.invalidateQueries({ queryKey: ["unified-support-tickets"] });
    queryClient.invalidateQueries({ queryKey: ["profile-channels"] });
    queryClient.invalidateQueries({ queryKey: ["contact-center-unanswered-dialogs"] });
    queryClient.invalidateQueries({ queryKey: ["contact-center-assignments"] });
  };

  // ------- Row actions apply to activeChannel of the row (V1 safe) -------
  const togglePinFavoriteOnRow = async (
    row: UnifiedContactRow,
    field: "is_pinned" | "is_favorite",
  ) => {
    if (busyKey) return;
    const src: UnifiedSource =
      row.key === selected?.key
        ? activeSource
        : (activeSourceByKey[row.key] as UnifiedSource | undefined) ??
          (sourceFilter !== "all" && row.channels[sourceFilter] ? sourceFilter : row.defaultActiveSource);
    const ch = row.channels[src];
    if (!ch) return;
    const source = ch.source;
    const sr = ch.sourceRow;
    setBusyKey(row.key);
    try {
      if (source === "telegram") {
        if (!user?.id) throw new Error("Не авторизован");
        const contactUserId = sr.meta.telegramUserId!;
        const nextValue = field === "is_pinned" ? !ch.pinned : !ch.favorite;
        const { data: existing } = await supabase
          .from("chat_preferences")
          .select("id")
          .eq("admin_user_id", user.id)
          .eq("contact_user_id", contactUserId)
          .maybeSingle();
        if (existing) {
          const { error } = await supabase
            .from("chat_preferences")
            .update({ [field]: nextValue, updated_at: new Date().toISOString() } as any)
            .eq("id", existing.id);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from("chat_preferences")
            .insert({
              admin_user_id: user.id,
              contact_user_id: contactUserId,
              [field]: nextValue,
            } as any);
          if (error) throw error;
        }
        queryClient.invalidateQueries({ queryKey: ["chat-preferences", user.id] });
        queryClient.invalidateQueries({ queryKey: ["chat-preferences"] });
      } else if (source === "instagram") {
        if (!user?.id) throw new Error("Не авторизован");
        const nextValue = field === "is_pinned" ? !ch.pinned : !ch.favorite;
        const nowIso = new Date().toISOString();
        const patch: Record<string, any> = {
          admin_user_id: user.id,
          instagram_account_id: sr.meta.instagramAccountId!,
          thread_key: sr.meta.instagramThreadKey!,
          [field]: nextValue,
        };
        if (field === "is_pinned") patch.pinned_at = nextValue ? nowIso : null;
        if (field === "is_favorite") patch.favorited_at = nextValue ? nowIso : null;
        const { error } = await supabase
          .from("instagram_dialog_preferences")
          .upsert(patch, { onConflict: "admin_user_id,instagram_account_id,thread_key" });
        if (error) throw error;
        queryClient.invalidateQueries({ queryKey: ["unified-ig-dialogs"] });
        queryClient.invalidateQueries({ queryKey: ["unified-ig-prefs"] });
      } else if (source === "support") {
        const nextValue = field === "is_pinned" ? !ch.pinned : !ch.favorite;
        const nowIso = new Date().toISOString();
        const patch: Record<string, any> =
          field === "is_pinned"
            ? { is_pinned: nextValue, pinned_at: nextValue ? nowIso : null }
            : { is_starred: nextValue };
        const { error } = await supabase
          .from("support_tickets")
          .update(patch as any)
          .eq("id", sr.meta.ticketId!);
        if (error) throw error;
        queryClient.invalidateQueries({ queryKey: ["unified-support-tickets"] });
        queryClient.invalidateQueries({ queryKey: ["admin-tickets"] });
      }
      const srcLabel = source === "telegram" ? "Telegram" : source === "instagram" ? "Instagram" : "Техподдержка";
      toast.success(
        `${field === "is_pinned" ? (ch.pinned ? "Открепить" : "Закреплено") : ch.favorite ? "Убрано из избранного" : "В избранном"} · ${srcLabel}`,
      );
    } catch (e: any) {
      toast.error("Не удалось: " + (e?.message || "ошибка"));
    } finally {
      setBusyKey(null);
    }
  };

  const markReadOnRow = async (row: UnifiedContactRow) => {
    if (busyKey) return;
    const src: UnifiedSource =
      row.key === selected?.key
        ? activeSource
        : (activeSourceByKey[row.key] as UnifiedSource | undefined) ??
          (sourceFilter !== "all" && row.channels[sourceFilter] ? sourceFilter : row.defaultActiveSource);
    const ch = row.channels[src];
    if (!ch) return;
    const sr = ch.sourceRow;
    setBusyKey(row.key);
    try {
      if (ch.source === "telegram") {
        const userId = sr.meta.telegramUserId!;
        let boundary: string | null = null;
        const msgs = queryClient.getQueryData<any[]>(["telegram-messages", userId]);
        if (Array.isArray(msgs)) {
          for (const m of msgs) {
            if (m?.direction === "incoming" && typeof m?.created_at === "string") {
              if (!boundary || m.created_at > boundary) boundary = m.created_at;
            }
          }
        }
        if (!boundary) boundary = sr.lastMessageAt || null;
        if (!boundary) throw new Error("нет observed boundary");
        const { registerSelfMark, clearSelfMark } = await import(
          "@/hooks/inboxMarkReadCoordinator"
        );
        registerSelfMark(userId, 2500);
        try {
          const { data, error } = await supabase.rpc("mark_dialog_read_v2" as any, {
            p_user_id: userId,
            p_boundary: boundary,
          });
          if (error) {
            clearSelfMark(userId);
            throw error;
          }
          const result = Array.isArray(data) ? data[0] : data;
          if (!result) throw new Error("сервер не вернул результат");
          const remainingUnread = Number((result as any).remaining_unread_count) || 0;

          // UnifiedInbox uses a dedicated raw-RPC cache. Updating only
          // INBOX_DIALOGS_QK leaves the unified row and its badges stale even
          // though the database update succeeded.
          queryClient.setQueriesData<any>(
            { queryKey: ["unified-inbox-telegram"] },
            (old) => {
              if (!old?.pages) return old;
              return {
                ...old,
                pages: old.pages.map((page: any) => ({
                  ...page,
                  rows: Array.isArray(page.rows)
                    ? page.rows.map((dialog: any) =>
                        dialog?.user_id === userId
                          ? { ...dialog, unread_count: remainingUnread }
                          : dialog,
                      )
                    : page.rows,
                })),
              };
            },
          );
          queryClient.setQueriesData<any[]>(
            { queryKey: INBOX_DIALOGS_QK },
            (old) =>
              Array.isArray(old)
                ? old.map((dialog: any) =>
                    dialog?.user_id === userId
                      ? { ...dialog, unread_count: remainingUnread }
                      : dialog,
                  )
                : old,
          );
          queryClient.setQueryData<any[]>(
            ["contact-center-unanswered-dialogs"],
            (old) => {
              if (!Array.isArray(old)) return old;
              if (remainingUnread === 0) {
                return old.filter((dialog: any) => dialog?.user_id !== userId);
              }
              return old.map((dialog: any) =>
                dialog?.user_id === userId
                  ? { ...dialog, unanswered_count: remainingUnread }
                  : dialog,
              );
            },
          );
        } catch (e) {
          clearSelfMark(userId);
          throw e;
        }
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["unified-inbox-telegram"] }),
          queryClient.invalidateQueries({ queryKey: INBOX_DIALOGS_QK }),
          queryClient.invalidateQueries({ queryKey: UNREAD_MESSAGES_COUNT_QK }),
          queryClient.invalidateQueries({ queryKey: ["contact-center-unanswered-dialogs"] }),
          queryClient.invalidateQueries({ queryKey: ["contact-center-assignments"] }),
        ]);
        toast.success("Отмечено прочитанным · Telegram");
        return;
      }
      if (ch.source === "instagram") {
        const { error } = await supabase.functions.invoke("instagram-admin-chat", {
          body: {
            action: "mark_read",
            instagram_account_id: sr.meta.instagramAccountId,
            thread_id: sr.meta.instagramThreadId ?? undefined,
            sender_id: sr.meta.instagramPeerId ?? undefined,
          },
        });
        if (error) throw error;
        queryClient.invalidateQueries({ queryKey: ["unified-ig-dialogs"] });
        toast.success("Отмечено прочитанным · Instagram");
        return;
      }
      if (ch.source === "support") {
        const { error } = await supabase
          .from("support_tickets")
          .update({ has_unread_admin: false })
          .eq("id", sr.meta.ticketId!);
        if (error) throw error;
        queryClient.invalidateQueries({ queryKey: ["unified-support-tickets"] });
        toast.success("Отмечено прочитанным · Техподдержка");
      }
    } catch (e: any) {
      toast.error("Не удалось отметить: " + (e?.message || "ошибка"));
    } finally {
      setBusyKey(null);
    }
  };

  const assignTelegramRow = async (row: UnifiedContactRow, assigneeUserId: string) => {
    const telegramUserId = row.channels.telegram?.sourceRow.meta.telegramUserId;
    if (!telegramUserId) return;
    setBusyKey(row.key);
    try {
      const { data: assignmentId, error } = await supabase.rpc(
        "assign_contact_center_dialog_v2" as any,
        {
          p_user_id: telegramUserId,
          p_assignee_user_id: assigneeUserId,
          p_note: null,
        } as any,
      );
      if (error) throw error;
      let notificationDelivered = false;
      if (assignmentId) {
        const { data: notification, error: notificationError } = await supabase.functions.invoke(
          "contact-center-assignment-notify",
          { body: { assignment_id: assignmentId } },
        );
        notificationDelivered = !notificationError && notification?.success === true;
      }
      await queryClient.invalidateQueries({ queryKey: ["contact-center-assignments"] });
      const employee = assignees.find((candidate) => candidate.user_id === assigneeUserId);
      if (notificationDelivered) {
        toast.success(`Передано: ${employee?.display_name || "сотрудник"}`);
      } else {
        toast.warning(`Передано: ${employee?.display_name || "сотрудник"}. Telegram-уведомление не доставлено`);
      }
    } catch (error: any) {
      const message = String(error?.message || "ошибка");
      toast.error(
        message.includes("unanswered_message_not_found")
          ? "Вопрос уже закрыт или был обработан другим сотрудником"
          : "Не удалось передать вопрос: " + message,
      );
    } finally {
      setBusyKey(null);
    }
  };

  const removeOwnAssignment = async (row: UnifiedContactRow, assignmentId: string) => {
    setBusyKey(row.key);
    try {
      const { error } = await supabase.rpc("unassign_contact_center_dialog_v1" as any, {
        p_assignment_id: assignmentId,
      } as any);
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ["contact-center-assignments"] });
      toast.success("Убрано из «Мои»");
    } catch (error: any) {
      toast.error("Не удалось убрать из «Мои»: " + (error?.message || "ошибка"));
    } finally {
      setBusyKey(null);
    }
  };

  const resolveSupportOnRow = async (row: UnifiedContactRow) => {
    const ticketId = row.channels.support?.sourceRow.meta.ticketId;
    if (!ticketId) return;
    setBusyKey(row.key);
    try {
      const { error } = await supabase
        .from("support_tickets")
        .update({ status: "resolved", has_unread_admin: false })
        .eq("id", ticketId);
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ["unified-support-tickets"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-tickets"] });
      toast.success("Обращение техподдержки закрыто");
    } catch (error: any) {
      toast.error("Не удалось закрыть обращение: " + (error?.message || "ошибка"));
    } finally {
      setBusyKey(null);
    }
  };


  const totalUnread = sourceFilter === "all"
    ? counts.totalUnread
    : sourceFilter === "telegram"
      ? counts.telegramUnread
      : sourceFilter === "instagram"
        ? counts.instagramUnread
        : counts.supportUnread;

  const sourceLabelByKey: Record<UnifiedSource, string> = {
    telegram: "Telegram",
    instagram: "Instagram",
    support: "Техподдержка",
  };

  const dialogList = (
    <div className="h-full flex flex-col">
      <div className="p-1.5 space-y-1.5 border-b border-border/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5">
              <MessageSquare className="h-3.5 w-3.5 text-primary" />
            </div>
            <h2 className="text-xs font-semibold">
              {sourceFilter === "all" ? "Все сообщения" : sourceLabelByKey[sourceFilter]}
            </h2>
            {totalUnread > 0 && (
              <Badge className="bg-primary text-primary-foreground text-[10px] h-4 min-w-4 px-1 rounded-full">
                {totalUnread}
              </Badge>
            )}
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={invalidateAll}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 bg-card/80 border-border/30 rounded-xl"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {([
            { key: "all", label: "Все", count: counts2.all },
            { key: "unread", label: "Новые", count: counts2.unread },
            { key: "favorite", label: "Избранное", count: counts2.fav },
            { key: "pinned", label: "Закреплённые", count: counts2.pinned },
            { key: "mine", label: "Мои", count: myAssignmentCount },
          ] as { key: FilterKind; label: string; count: number }[]).map((chip) => (
            <Button
              key={chip.key}
              variant="ghost"
              size="sm"
              className={cn(
                "h-7 px-2.5 text-xs rounded-full",
                filterKind === chip.key
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "bg-card/60 text-muted-foreground",
              )}
              onClick={() => setFilterKind(chip.key)}
            >
              {chip.label}
              {chip.count > 0 ? ` · ${chip.count}` : ""}
            </Button>
          ))}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-2.5 text-xs rounded-full bg-card/60 text-muted-foreground">
                {managerFilter === "all"
                  ? "По менеджеру"
                  : assignees.find((item) => item.user_id === managerFilter)?.display_name || "Менеджер"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
              <DropdownMenuItem onSelect={() => setManagerFilter("all")}>Все менеджеры</DropdownMenuItem>
              {assignees.map((person) => (
                <DropdownMenuItem key={person.user_id} onSelect={() => setManagerFilter(person.user_id)}>
                  {person.display_name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {(errors.telegram || errors.instagram || errors.support) && (
          <div className="text-[10px] text-destructive px-1">
            {errors.telegram && <div>Telegram: ошибка загрузки</div>}
            {errors.instagram && <div>Instagram: ошибка загрузки</div>}
            {errors.support && <div>Техподдержка: ошибка загрузки</div>}
          </div>
        )}
      </div>

      <div ref={parentRef} className="touch-scroll flex-1 min-h-0 overflow-y-auto overscroll-contain">
        {viewIsLoading ? (
          <div className="p-8 text-center text-muted-foreground">
            <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
            <span className="text-sm">Загрузка...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center">
            <MessageSquare className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
            <p className="text-muted-foreground text-sm">Ничего не найдено</p>
          </div>
        ) : (
          <div
            className="relative p-1.5"
            style={{ height: `${virtualizer.getTotalSize() + (isFetchingNextPage ? 36 : 0)}px` }}
          >
            {virtualItems.map((vr) => {
              const row = filtered[vr.index];
              const rowActiveSource: UnifiedSource =
                sourceFilter !== "all" && row.channels[sourceFilter]
                  ? sourceFilter
                  : row.key === selected?.key
                    ? activeSource
                    : (activeSourceByKey[row.key] as UnifiedSource | undefined) ?? row.defaultActiveSource;
              const rowActive = row.channels[rowActiveSource] ?? row.channels[row.defaultActiveSource]!;
              const rowDisplayUnread = sourceFilter === "all" ? row.totalUnread : rowActive.unread;
              const telegramAssignment = row.channels.telegram?.sourceRow.meta.telegramUserId
                ? assignmentByTelegramUserId.get(row.channels.telegram.sourceRow.meta.telegramUserId)
                : undefined;
              return (
                <div
                  key={row.key}
                  className="absolute top-0 left-0 w-full px-1.5"
                  style={{ transform: `translateY(${vr.start}px)` }}
                >
                  <button
                    type="button"
                    onClick={() => selectContact(row)}
                    className={cn(
                      "w-full text-left grid grid-cols-[auto_1fr_auto] items-start gap-2 p-1.5 rounded-lg border transition-colors duration-200 group",
                      selectedKey === row.key
                        ? "bg-primary/10 border-primary"
                        : "border-transparent hover:bg-muted/40",
                    )}
                  >
                    <div className="relative shrink-0">
                      <Avatar className="h-9 w-9 ring-1 ring-border/20">
                        <AvatarImage src={row.avatarUrl || undefined} />
                        <AvatarFallback className="bg-gradient-to-br from-primary/20 to-accent/20 text-foreground font-semibold text-xs">
                          {row.displayName[0]?.toUpperCase() || "?"}
                        </AvatarFallback>
                      </Avatar>
                      {rowDisplayUnread > 0 && (
                        <div className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[9px] font-bold">
                          {rowDisplayUnread > 99 ? "99+" : rowDisplayUnread}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 overflow-hidden">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs font-semibold truncate flex-1">{row.displayName}</span>
                        {(sourceFilter === "all" ? row.isPinned : rowActive.pinned) && (
                          <Pin className="h-2.5 w-2.5 text-primary shrink-0" />
                        )}
                        {(sourceFilter === "all" ? row.isFavorite : rowActive.favorite) && (
                          <Star className="h-2.5 w-2.5 text-amber-500 shrink-0 fill-current" />
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1 flex-wrap">
                        {row.availableSources.map((s) => (
                          <SourceBadge
                            key={s}
                            source={s}
                            label={row.channels[s]?.sourceRow.sourceLabel ?? null}
                          />
                        ))}
                        {telegramAssignment && (
                          <Badge
                            variant="secondary"
                            className={cn(
                              "h-4 max-w-[180px] truncate px-1 text-[9px] font-medium",
                              telegramAssignment.is_answered && "bg-emerald-100 text-emerald-800",
                            )}
                          >
                            {telegramAssignment.is_answered ? "Ответ дан · " : ""}
                            {telegramAssignment.assignee_name}
                          </Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                        <span className="opacity-70">{sourceLabelByKey[rowActive.source]} · </span>
                        {rowActive.lastMessagePreview}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                        {rowActive.lastMessageAt
                          ? formatDistanceToNow(new Date(rowActive.lastMessageAt), { locale: ru, addSuffix: false })
                          : ""}
                      </span>
                      <div
                        className="flex items-center gap-0.5 opacity-60 md:opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
                      >
                        {rowActive.sourceRow.capabilities.canPin && (
                          <IconAction
                            title={`${rowActive.pinned ? "Открепить" : "Закрепить"} · ${sourceLabelByKey[rowActive.source]}`}
                            disabled={busyKey === row.key}
                            active={rowActive.pinned}
                            onActivate={() => togglePinFavoriteOnRow(row, "is_pinned")}
                          >
                            <Pin className={cn("h-3 w-3", rowActive.pinned && "fill-current text-primary")} />
                          </IconAction>
                        )}
                        {rowActive.sourceRow.capabilities.canFavorite && (
                          <IconAction
                            title={`${rowActive.favorite ? "Убрать из избранного" : "В избранное"} · ${sourceLabelByKey[rowActive.source]}`}
                            disabled={busyKey === row.key}
                            active={rowActive.favorite}
                            onActivate={() => togglePinFavoriteOnRow(row, "is_favorite")}
                          >
                            <Star className={cn("h-3 w-3", rowActive.favorite && "fill-amber-500 text-amber-500")} />
                          </IconAction>
                        )}
                        {rowActive.sourceRow.capabilities.canMarkRead && rowActive.unread > 0 && (
                          <IconAction
                            title={`Отметить прочитанным · ${sourceLabelByKey[rowActive.source]}`}
                            disabled={busyKey === row.key}
                            onActivate={() => markReadOnRow(row)}
                          >
                            <Check className="h-3 w-3" />
                          </IconAction>
                        )}
                        {row.channels.telegram?.sourceRow.meta.telegramUserId &&
                          row.channels.telegram.sourceRow.isUnanswered && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <span
                                role="button"
                                tabIndex={0}
                                title="Передать менеджеру"
                                onClick={(event) => event.stopPropagation()}
                                className={cn(
                                  "h-5 w-5 rounded-full inline-flex items-center justify-center cursor-pointer transition-colors hover:bg-primary/10",
                                  busyKey === row.key && "pointer-events-none opacity-50",
                                )}
                              >
                                <UserRoundCheck className="h-3 w-3" />
                              </span>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
                              {assignees.map((person) => (
                                <DropdownMenuItem key={person.user_id} onSelect={() => assignTelegramRow(row, person.user_id)}>
                                  {person.display_name}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                        {telegramAssignment?.assignee_user_id === user?.id && (
                          <IconAction
                            title="Убрать из «Мои»"
                            disabled={busyKey === row.key}
                            onActivate={() => removeOwnAssignment(row, telegramAssignment.id)}
                          >
                            <UserMinus className="h-3 w-3" />
                          </IconAction>
                        )}
                        {row.channels.support?.sourceRow.meta.ticketId && (
                          <IconAction
                            title="Закрыть обращение техподдержки"
                            disabled={busyKey === row.key}
                            onActivate={() => resolveSupportOnRow(row)}
                          >
                            <CheckCircle2 className="h-3 w-3" />
                          </IconAction>
                        )}
                      </div>
                    </div>
                  </button>
                </div>
              );
            })}
            {isFetchingNextPage && (
              <div
                className="absolute inset-x-0 flex h-9 items-center justify-center text-muted-foreground"
                style={{ transform: `translateY(${virtualizer.getTotalSize()}px)` }}
                aria-live="polite"
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                <span className="text-[11px]">Загружаю ещё…</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  const rightPanel = selected && activeChannel ? (
    <div className="h-full flex flex-col">
      <UnifiedChatHeader
        contact={selected}
        activeSource={activeSource}
        onBack={isMobile ? () => setSelectedKey(null) : undefined}
        compactMobile={isMobile}
      />
      <ChannelPicker
        contact={selected}
        activeSource={activeSource}
        onChange={changeActiveSource}
        onRequestCreateSupport={(c) => setInitiateFor(c)}
      />
      <div className="flex-1 min-h-0">
        <ChatPanel channel={activeChannel} onBack={isMobile ? () => setSelectedKey(null) : undefined} />
      </div>
    </div>
  ) : (
    <div className="h-full flex items-center justify-center p-8 text-center">
      <div>
        <MessageSquare className="h-12 w-12 mx-auto mb-3 text-muted-foreground/40" />
        <p className="text-muted-foreground">Выберите чат</p>
        <p className="text-xs text-muted-foreground/70 mt-1">для просмотра сообщений</p>
      </div>
    </div>
  );
  const initiateDialog = (
    <AdminInitiateTicketDialog
      open={!!initiateFor}
      onOpenChange={(v) => {
        if (!v) setInitiateFor(null);
      }}
      profileId={initiateFor?.profileId ?? null}
      displayName={initiateFor?.displayName ?? ""}
      onCreated={(_ticketId, _createdNew) => {
        if (initiateFor?.profileId) {
          setPendingSupportForProfileId(initiateFor.profileId);
        }
        setInitiateFor(null);
      }}
    />
  );


  if (isMobile) {
    return (
      <div className="h-full min-h-0 flex flex-col overflow-hidden">
        {selected ? (
          <div className="flex-1 min-h-0 h-full max-h-full overflow-hidden touch-pan-y">{rightPanel}</div>
        ) : (
          dialogList
        )}
        {initiateDialog}
      </div>
    );
  }

  return (
    <>
      <ResizablePanelGroup direction="horizontal" onLayout={savePanel} className="h-full">
        <ResizablePanel defaultSize={panelSize} minSize={25} maxSize={60}>
          {dialogList}
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={100 - panelSize} minSize={40}>
          {rightPanel}
        </ResizablePanel>
      </ResizablePanelGroup>
      {initiateDialog}
    </>
  );
}

/**
 * Диспетчер правой панели: рендерит per-source чат по SourceChannelRef.
 */
function ChatPanel({ channel, onBack }: { channel: SourceChannelRef; onBack?: () => void }) {
  const row = channel.sourceRow;
  if (channel.source === "telegram") {
    return (
      <ContactTelegramChat
        userId={row.meta.telegramUserId!}
        telegramUserId={row.meta.telegramNumericId ?? null}
        telegramUsername={row.meta.telegramUsername ?? null}
        clientName={row.displayName}
        clientFirstName={row.meta.profileFirstName ?? null}
        clientLastName={row.meta.profileLastName ?? null}
        clientEmail={row.meta.profileEmail ?? null}
        clientPhone={row.meta.profilePhone ?? null}
        avatarUrl={row.avatarUrl}
        isActive
      />
    );
  }
  if (channel.source === "instagram") {
    return (
      <ContactInstagramChat
        accountId={row.meta.instagramAccountId!}
        senderId={row.meta.instagramPeerId!}
        threadId={row.meta.instagramThreadId ?? null}
        senderName={row.displayName}
        avatarUrl={row.avatarUrl}
        accountName={row.sourceLabel}
        onBack={onBack}
        hideHeader
      />
    );
  }
  if (channel.source === "support") {
    return <TicketChat ticketId={row.meta.ticketId!} isAdmin isClosed={false} />;
  }
  return null;
}

/**
 * Иконка hover-действия строки. Изолирована от выбора строки.
 */
function IconAction({
  title,
  disabled,
  active,
  onActivate,
  children,
}: {
  title: string;
  disabled?: boolean;
  active?: boolean;
  onActivate: () => void;
  children: React.ReactNode;
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={title}
      aria-pressed={active}
      title={title}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!disabled) onActivate();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          if (!disabled) onActivate();
        }
      }}
      className={cn(
        "h-5 w-5 rounded-full inline-flex items-center justify-center cursor-pointer transition-colors",
        disabled
          ? "opacity-50 cursor-not-allowed"
          : "hover:bg-primary/10",
        active && "text-primary",
      )}
    >
      {children}
    </span>
  );
}
