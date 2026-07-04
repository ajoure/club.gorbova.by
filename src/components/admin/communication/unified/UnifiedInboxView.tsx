import { useMemo, useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import { Search, MessageSquare, RefreshCw, ArrowLeft, Check, Star, Pin } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { INBOX_DIALOGS_QK } from "@/constants/inboxQueryKeys";

import { useUnifiedInbox, type UnifiedDialog, type UnifiedSource } from "@/hooks/useUnifiedInbox";
import { SourceBadge } from "./SourceBadge";
import { ContactTelegramChat } from "@/components/admin/ContactTelegramChat";
import { ContactInstagramChat } from "@/components/admin/communication/instagram/ContactInstagramChat";
import { TicketChat } from "@/components/support/TicketChat";
import { ChannelPicker } from "./ChannelPicker";
import { UnifiedChatHeader } from "./UnifiedChatHeader";

const PANEL_KEY = "unified-inbox-panel-sizes";

type SourceFilter = "all" | UnifiedSource;

interface Props {
  /** Внешний фильтр по источнику из дропдауна «Сообщения». Undefined = «Все». */
  sourceFilter?: SourceFilter;
}

export function UnifiedInboxView({ sourceFilter = "all" }: Props) {
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { rows, isLoading, errors, counts } = useUnifiedInbox({ enabled: true });

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  type FilterKind = "all" | "unread" | "favorite" | "pinned";
  const [filterKind, setFilterKind] = useState<FilterKind>("all");
  const [busyKey, setBusyKey] = useState<string | null>(null);

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

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (sourceFilter !== "all" && r.source !== sourceFilter) return false;
      if (readState === "unread" && !r.isUnanswered) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !r.displayName.toLowerCase().includes(q) &&
          !r.lastMessage.toLowerCase().includes(q) &&
          !(r.sourceLabel || "").toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [rows, sourceFilter, readState, search]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 88,
    overscan: 5,
  });

  const selected = filtered.find((r) => r.key === selectedKey) || rows.find((r) => r.key === selectedKey);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: INBOX_DIALOGS_QK });
    queryClient.invalidateQueries({ queryKey: ["unified-ig-dialogs"] });
    queryClient.invalidateQueries({ queryKey: ["unified-support-tickets"] });
  };

  // ------- Hover-actions (pin / favorite / mark read) -------
  // Все мутации используют СУЩЕСТВУЮЩИЕ таблицы и RPC:
  //   TG:      chat_preferences (upsert), mark_dialog_read_v2 (тот же контракт, что моно-TG)
  //   IG:      instagram_dialog_preferences (upsert), instagram-admin-chat/mark_read
  //   Support: support_tickets.is_starred / has_unread_admin
  // Никаких новых миграций/таблиц. Если capability отсутствует — иконка не рисуется.
  const togglePinFavorite = async (
    row: UnifiedDialog,
    field: "is_pinned" | "is_favorite",
  ) => {
    if (busyKey) return;
    setBusyKey(row.key);
    try {
      if (row.source === "telegram") {
        if (!user?.id) throw new Error("Не авторизован");
        const contactUserId = row.meta.telegramUserId!;
        const nextValue = field === "is_pinned" ? !row.isPinned : !row.isFavorite;
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
      } else if (row.source === "instagram" && (field === "is_pinned" || field === "is_favorite")) {
        if (!user?.id) throw new Error("Не авторизован");
        const nextValue = field === "is_pinned" ? !row.isPinned : !row.isFavorite;
        const nowIso = new Date().toISOString();
        const patch: Record<string, any> = {
          admin_user_id: user.id,
          instagram_account_id: row.meta.instagramAccountId!,
          thread_key: row.meta.instagramThreadKey!,
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
      } else if (row.source === "support" && (field === "is_pinned" || field === "is_favorite")) {
        const nextValue = field === "is_pinned" ? !row.isPinned : !row.isFavorite;
        const nowIso = new Date().toISOString();
        const patch: Record<string, any> =
          field === "is_pinned"
            ? { is_pinned: nextValue, pinned_at: nextValue ? nowIso : null }
            : { is_starred: nextValue };
        const { error } = await supabase
          .from("support_tickets")
          .update(patch as any)
          .eq("id", row.meta.ticketId!);
        if (error) throw error;
        queryClient.invalidateQueries({ queryKey: ["unified-support-tickets"] });
        queryClient.invalidateQueries({ queryKey: ["admin-tickets"] });
      } else {
        return;
      }
      toast.success(
        field === "is_pinned"
          ? row.isPinned ? "Открепить" : "Закреплено"
          : row.isFavorite ? "Убрано из избранного" : "В избранном",
      );
    } catch (e: any) {
      toast.error("Не удалось: " + (e?.message || "ошибка"));
    } finally {
      setBusyKey(null);
    }
  };

  // Единый mark-read.
  // Telegram: тот же контракт, что моно-TG (mark_dialog_read_v2 + observed boundary
  // из локального кэша ["telegram-messages"] с fallback на last_message_at строки).
  const markRead = async (row: UnifiedDialog) => {
    if (busyKey) return;
    setBusyKey(row.key);
    try {
      if (row.source === "telegram") {
        const userId = row.meta.telegramUserId!;
        // Observed boundary: точная граница из кэша чата, иначе last_message_at.
        let boundary: string | null = null;
        const msgs = queryClient.getQueryData<any[]>(["telegram-messages", userId]);
        if (Array.isArray(msgs)) {
          for (const m of msgs) {
            if (m?.direction === "incoming" && typeof m?.created_at === "string") {
              if (!boundary || m.created_at > boundary) boundary = m.created_at;
            }
          }
        }
        if (!boundary) boundary = row.lastMessageAt || null;
        if (!boundary) throw new Error("нет observed boundary");
        const { registerSelfMark, clearSelfMark } = await import(
          "@/hooks/inboxMarkReadCoordinator"
        );
        registerSelfMark(userId, 2500);
        try {
          const { error } = await supabase.rpc("mark_dialog_read_v2" as any, {
            p_user_id: userId,
            p_boundary: boundary,
          });
          if (error) {
            clearSelfMark(userId);
            throw error;
          }
        } catch (e) {
          clearSelfMark(userId);
          throw e;
        }
        queryClient.invalidateQueries({ queryKey: INBOX_DIALOGS_QK });
        toast.success("Отмечено прочитанным");
        return;
      }
      if (row.source === "instagram") {
        await supabase.functions.invoke("instagram-admin-chat", {
          body: {
            action: "mark_read",
            account_id: row.meta.instagramAccountId,
            thread_key: row.meta.instagramThreadKey,
          },
        });
        queryClient.invalidateQueries({ queryKey: ["unified-ig-dialogs"] });
        toast.success("Отмечено прочитанным");
        return;
      }
      if (row.source === "support") {
        const { error } = await supabase
          .from("support_tickets")
          .update({ has_unread_admin: false })
          .eq("id", row.meta.ticketId!);
        if (error) throw error;
        queryClient.invalidateQueries({ queryKey: ["unified-support-tickets"] });
        toast.success("Отмечено прочитанным");
      }
    } catch (e: any) {
      toast.error("Не удалось отметить: " + (e?.message || "ошибка"));
    } finally {
      setBusyKey(null);
    }
  };


  const totalUnread = counts.telegramUnread + counts.instagramUnread + counts.supportUnread;

  const dialogList = (
    <div className="h-full flex flex-col">
      <div className="p-1.5 space-y-1.5 border-b border-border/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5">
              <MessageSquare className="h-3.5 w-3.5 text-primary" />
            </div>
            <h2 className="text-xs font-semibold">
              {sourceFilter === "all" ? "Все сообщения" : sourceFilter}
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
        <div className="flex gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-7 px-2.5 text-xs rounded-full",
              readState === "all"
                ? "bg-primary text-primary-foreground shadow-md"
                : "bg-card/60 text-muted-foreground",
            )}
            onClick={() => setReadState("all")}
          >
            Все
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-7 px-2.5 text-xs rounded-full",
              readState === "unread"
                ? "bg-primary text-primary-foreground shadow-md"
                : "bg-card/60 text-muted-foreground",
            )}
            onClick={() => setReadState("unread")}
          >
            Неотвеченные{totalUnread > 0 ? ` · ${totalUnread}` : ""}
          </Button>
        </div>
        {(errors.telegram || errors.instagram || errors.support) && (
          <div className="text-[10px] text-destructive px-1">
            {errors.telegram && <div>Telegram: ошибка загрузки</div>}
            {errors.instagram && <div>Instagram: ошибка загрузки</div>}
            {errors.support && <div>Техподдержка: ошибка загрузки</div>}
          </div>
        )}
      </div>

      <div ref={parentRef} className="flex-1 min-h-0 overflow-y-auto">
        {isLoading ? (
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
          <div className="relative p-1.5" style={{ height: `${virtualizer.getTotalSize()}px` }}>
            {virtualizer.getVirtualItems().map((vr) => {
              const row = filtered[vr.index];
              return (
                <div
                  key={row.key}
                  className="absolute top-0 left-0 w-full px-1.5"
                  style={{ transform: `translateY(${vr.start}px)` }}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedKey(row.key)}
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
                      {row.unreadCount > 0 && (
                        <div className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[9px] font-bold">
                          {row.unreadCount > 99 ? "99+" : row.unreadCount}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 overflow-hidden">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs font-semibold truncate flex-1">{row.displayName}</span>
                        {row.isPinned && <Pin className="h-2.5 w-2.5 text-primary shrink-0" />}
                        {row.isFavorite && <Star className="h-2.5 w-2.5 text-amber-500 shrink-0 fill-current" />}
                      </div>
                      <div className="mt-0.5">
                        <SourceBadge source={row.source} label={row.sourceLabel} />
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate mt-0.5">{row.lastMessage}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                        {row.lastMessageAt
                          ? formatDistanceToNow(new Date(row.lastMessageAt), { locale: ru, addSuffix: false })
                          : ""}
                      </span>
                      <div
                        className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
                      >
                        {row.capabilities.canPin && (
                          <IconAction
                            title={row.isPinned ? "Открепить" : "Закрепить"}
                            disabled={busyKey === row.key}
                            active={row.isPinned}
                            onActivate={() => togglePinFavorite(row, "is_pinned")}
                          >
                            <Pin className={cn("h-3 w-3", row.isPinned && "fill-current text-primary")} />
                          </IconAction>
                        )}
                        {row.capabilities.canFavorite && (
                          <IconAction
                            title={row.isFavorite ? "Убрать из избранного" : "В избранное"}
                            disabled={busyKey === row.key}
                            active={row.isFavorite}
                            onActivate={() => togglePinFavorite(row, "is_favorite")}
                          >
                            <Star className={cn("h-3 w-3", row.isFavorite && "fill-amber-500 text-amber-500")} />
                          </IconAction>
                        )}
                        {row.capabilities.canMarkRead && row.unreadCount > 0 && (
                          <IconAction
                            title="Отметить прочитанным"
                            disabled={busyKey === row.key}
                            onActivate={() => markRead(row)}
                          >
                            <Check className="h-3 w-3" />
                          </IconAction>
                        )}
                      </div>
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  const rightPanel = selected ? (
    <div className="h-full flex flex-col">
      <UnifiedChatHeader row={selected} />
      <ChannelPicker currentRow={selected} allRows={rows} onSelect={setSelectedKey} />
      <div className="flex-1 min-h-0">
        <ChatPanel row={selected} onBack={isMobile ? () => setSelectedKey(null) : undefined} />
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

  if (isMobile) {
    return (
      <div className="h-full flex flex-col">
        {selected ? (
          <>
            <div className="p-2 border-b flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={() => setSelectedKey(null)}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm font-semibold truncate">{selected.displayName}</span>
              <SourceBadge source={selected.source} label={selected.sourceLabel} />
            </div>
            <div className="flex-1 min-h-0">{rightPanel}</div>
          </>
        ) : (
          dialogList
        )}
      </div>
    );
  }

  return (
    <ResizablePanelGroup direction="horizontal" onLayout={savePanel} className="h-full">
      <ResizablePanel defaultSize={panelSize} minSize={25} maxSize={60}>
        {dialogList}
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={100 - panelSize} minSize={40}>
        {rightPanel}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

/**
 * Диспетчер правой панели: рендерит существующий per-source чат-компонент
 * с его полным функционалом (медиа/файлы/голос/видеокружки — где источник поддерживает).
 * Composer с cross-channel reply picker — Phase 2, здесь только delegation.
 */
function ChatPanel({ row, onBack }: { row: UnifiedDialog; onBack?: () => void }) {
  if (row.source === "telegram") {
    return (
      <ContactTelegramChat
        userId={row.meta.telegramUserId!}
        telegramUserId={row.meta.telegramNumericId ?? null}
        telegramUsername={row.meta.telegramUsername ?? null}
        clientName={row.displayName}
        avatarUrl={row.avatarUrl}
        isActive
      />
    );
  }
  if (row.source === "instagram") {
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
  if (row.source === "support") {
    return <TicketChat ticketId={row.meta.ticketId!} isAdmin isClosed={false} />;
  }
  return null;
}

/**
 * Иконка hover-действия строки. Изолирована от выбора строки
 * (stopPropagation + preventDefault на click/keydown).
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
