import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { supabase } from "@/integrations/supabase/client";
import { INBOX_DIALOGS_QK, UNREAD_MESSAGES_COUNT_QK } from "@/constants/inboxQueryKeys";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ContactTelegramChat } from "@/components/admin/ContactTelegramChat";
import { EmailInboxView } from "@/components/admin/email";
import { SupportTabContent } from "@/components/admin/communication/SupportTabContent";
import { InstagramInboxView } from "@/components/admin/communication/instagram/InstagramInboxView";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Calendar } from "@/components/ui/calendar";
import { ContactDetailSheet } from "@/components/admin/ContactDetailSheet";
import { SwipeableDialogCard } from "@/components/admin/communication/SwipeableDialogCard";
import { formatContactName } from "@/lib/nameUtils";
import { 
  Search, 
  MessageSquare, 
  MailCheck, 
  MailQuestion,
  RefreshCw,
  ArrowLeft,
  Filter,
  X,
  Calendar as CalendarIcon,
  Handshake,
  Package,
  ExternalLink,
  Star,
  Pin,
  Check,
  CheckCheck,
  MoreHorizontal,
  Mail,
  CheckSquare,
  RotateCcw,
  LifeBuoy,
  Bot,
} from "lucide-react";
import { format, formatDistanceToNow, isAfter, isBefore, startOfDay, endOfDay } from "date-fns";
import { ru } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// Звуковое уведомление о новых входящих живёт в глобальном хуке
// `useIncomingMessageAlert` (mounted в AdminLayout). Локальный playNotificationSound
// удалён в S1 PATCH-CONTACT-CENTER-FIX-V1, чтобы исключить дубль звука.

interface Dialog {
  user_id: string;
  profile: {
    id: string;
    full_name: string | null;
    email: string | null;
    phone: string | null;
    telegram_username: string | null;
    telegram_user_id: number | null;
    avatar_url: string | null;
  } | null;
  last_message: string;
  last_message_at: string;
  unread_count: number;
  is_pinned?: boolean;
  is_favorite?: boolean;
  last_bot_id?: string | null;
  last_bot_username?: string | null;
  last_bot_name?: string | null;
  orders?: {
    id: string;
    order_number: string;
    product_name: string | null;
    status: string;
  }[];
  subscriptions?: {
    id: string;
    product_name: string | null;
    status: string;
  }[];
}

interface Filters {
  dateFrom: Date | undefined;
  dateTo: Date | undefined;
  orderNumber: string;
  productId: string;
  hasActiveSubscription: "all" | "yes" | "no";
}

const initialFilters: Filters = {
  dateFrom: undefined,
  dateTo: undefined,
  orderNumber: "",
  productId: "",
  hasActiveSubscription: "all",
};

interface InboxTabContentProps {
  defaultChannel?: "telegram" | "email" | "support" | "instagram";
}

const PANEL_SIZE_KEY = "communication-panel-sizes";

const TELEGRAM_HTML_TAG_PATTERN = /<\/?(b|strong|i|em|u|s|strike|del|code|pre|a|tg-spoiler|br)\b/i;

function getTelegramPlainText(text: string | null | undefined): string {
  const value = text || "";
  if (!TELEGRAM_HTML_TAG_PATTERN.test(value) || typeof DOMParser === "undefined") return value;
  const doc = new DOMParser().parseFromString(`<div>${value}</div>`, "text/html");
  return doc.body.textContent || "";
}

export function InboxTabContent({ defaultChannel = "telegram" }: InboxTabContentProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [channel, setChannel] = useState<"telegram" | "email" | "support" | "instagram">(defaultChannel);
  
  // Load saved panel size from localStorage
  // Default: 40% for contacts panel (user wants contacts list fully visible)
  const [savedPanelSize] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(PANEL_SIZE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.left || 40;
      }
    } catch {}
    return 40;
  });
  
  // Save panel size to localStorage
  const handlePanelResize = (sizes: number[]) => {
    try {
      localStorage.setItem(PANEL_SIZE_KEY, JSON.stringify({ left: sizes[0] }));
    } catch {}
  };
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [contactSheetUserId, setContactSheetUserId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "unread" | "read" | "favorites" | "pinned">("all");
  const [advancedFilters, setAdvancedFilters] = useState<Filters>(initialFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedChats, setSelectedChats] = useState<Set<string>>(new Set());
  const [botFilter, setBotFilter] = useState<string>("all");
  const lastMessageCountRef = useRef<number>(0);
  // soundEnabledRef и autoplay-gate удалены вместе с локальным playNotificationSound.
  // Звук теперь играет глобальный `useIncomingMessageAlert` со своим AudioContext-gate'ом.

  // Sync channel with defaultChannel prop
  useEffect(() => {
    setChannel(defaultChannel);
  }, [defaultChannel]);

  const hasActiveFilters = useMemo(() => {
    return (
      advancedFilters.dateFrom !== undefined ||
      advancedFilters.dateTo !== undefined ||
      advancedFilters.orderNumber !== "" ||
      advancedFilters.productId !== "" ||
      advancedFilters.hasActiveSubscription !== "all"
    );
  }, [advancedFilters]);

  // Fetch chat preferences
  const { data: chatPreferences = [] } = useQuery({
    queryKey: ["chat-preferences", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from("chat_preferences")
        .select("*")
        .eq("admin_user_id", user.id);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id,
  });

  const prefsMap = useMemo(() => {
    const map = new Map<string, { is_pinned: boolean; is_favorite: boolean }>();
    chatPreferences.forEach(p => {
      map.set(p.contact_user_id, { is_pinned: p.is_pinned || false, is_favorite: p.is_favorite || false });
    });
    return map;
  }, [chatPreferences]);

  // Fetch products for filter
  const { data: products } = useQuery({
    queryKey: ["products-for-inbox-filter"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products_v2")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // === P1 OPTIMIZED: Use get_inbox_dialogs_v1 RPC instead of loading all messages ===
  const { data: dialogs = [], isLoading, refetch } = useQuery({
    queryKey: INBOX_DIALOGS_QK,
    queryFn: async () => {
      // Call optimized RPC that does server-side aggregation
      const { data: rpcDialogs, error: rpcError } = await supabase
        .rpc('get_inbox_dialogs_v1', { 
          p_limit: 100, 
          p_offset: 0,
          p_search: null  // Search is done client-side for now
        });

      if (rpcError) {
        console.error("[Inbox] RPC error:", rpcError);
        throw rpcError;
      }

      if (!rpcDialogs || rpcDialogs.length === 0) return [];

      const userIds = rpcDialogs.map((d: any) => d.user_id);

      // Fetch profiles, orders, subscriptions IN PARALLEL (not sequentially)
      const [profilesRes, ordersRes, subsRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, user_id, full_name, email, phone, telegram_username, telegram_user_id, avatar_url")
          .in("user_id", userIds),
        supabase
          .from("orders_v2")
          .select("id, user_id, order_number, status, products_v2(name)")
          .in("user_id", userIds)
          .limit(500),
        supabase
          .from("subscriptions_v2")
          .select("id, user_id, status, products_v2(name)")
          .in("user_id", userIds)
          .limit(500)
      ]);

      const profiles = profilesRes.data || [];
      const orders = ordersRes.data || [];
      const subscriptions = subsRes.data || [];

      const profileMap = new Map(profiles.map(p => [p.user_id, p]));
      
      const ordersMap = new Map<string, any[]>();
      orders.forEach(o => {
        const existing = ordersMap.get(o.user_id) || [];
        existing.push({
          id: o.id,
          order_number: o.order_number,
          product_name: (o.products_v2 as any)?.name || null,
          status: o.status,
        });
        ordersMap.set(o.user_id, existing);
      });

      const subsMap = new Map<string, any[]>();
      subscriptions.forEach(s => {
        const existing = subsMap.get(s.user_id) || [];
        existing.push({
          id: s.id,
          product_name: (s.products_v2 as any)?.name || null,
          status: s.status,
        });
        subsMap.set(s.user_id, existing);
      });

      // Map RPC result to Dialog interface
      const result: Dialog[] = rpcDialogs.map((d: any) => ({
        user_id: d.user_id,
        last_message: getTelegramPlainText(d.last_message_text) || (d.last_message_type ? `[${d.last_message_type}]` : ""),
        last_message_at: d.last_message_at,
        unread_count: Number(d.unread_count) || 0,
        profile: profileMap.get(d.user_id) || null,
        orders: ordersMap.get(d.user_id) || [],
        subscriptions: subsMap.get(d.user_id) || [],
        last_bot_id: d.last_bot_id || null,
        last_bot_username: d.last_bot_username || null,
        last_bot_name: d.last_bot_name || null,
      }));

      // Already sorted by last_message_at DESC from RPC
      return result;
    },
    refetchInterval: 30000,
    staleTime: 30000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const totalUnread = dialogs.reduce((sum, d) => sum + d.unread_count, 0);

  // Toggle preference mutation
  const togglePrefMutation = useMutation({
    mutationFn: async ({ contactUserId, field, value }: { contactUserId: string; field: "is_pinned" | "is_favorite"; value: boolean }) => {
      if (!user?.id) throw new Error("Not authenticated");
      
      const { data: existing } = await supabase
        .from("chat_preferences")
        .select("id")
        .eq("admin_user_id", user.id)
        .eq("contact_user_id", contactUserId)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from("chat_preferences")
          .update({ [field]: value, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("chat_preferences")
          .insert({
            admin_user_id: user.id,
            contact_user_id: contactUserId,
            [field]: value,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-preferences"] });
    },
    onError: (error) => {
      toast.error("Ошибка: " + (error as Error).message);
    },
  });

  // Mark messages as read — атомарно через RPC с server-side boundary (no client Date).
  // p_boundary=null → сервер использует now(); входящие, пришедшие после атомарного
  // UPDATE, остаются unread по серверной отсечке.
  const markAsRead = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.rpc("mark_dialog_read_atomic" as any, {
        p_user_id: userId,
        p_boundary: null,
      });
      if (error) throw error;
    },
    onMutate: async (userId: string) => {
      await queryClient.cancelQueries({ queryKey: INBOX_DIALOGS_QK });
      const prev = queryClient.getQueriesData<any>({ queryKey: INBOX_DIALOGS_QK });
      queryClient.setQueriesData<any>({ queryKey: INBOX_DIALOGS_QK }, (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.map((d: any) =>
          d?.user_id === userId ? { ...d, unread_count: 0 } : d,
        );
      });
      return { prev };
    },
    onError: (_e, _v, ctx: any) => {
      ctx?.prev?.forEach(([key, data]: [any, any]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: INBOX_DIALOGS_QK });
      queryClient.invalidateQueries({ queryKey: UNREAD_MESSAGES_COUNT_QK });
    },
  });

  // Bulk mark as read — единый атомарный RPC, без N запросов.
  const bulkMarkAsRead = useMutation({
    mutationFn: async (userIds: string[]) => {
      if (!userIds.length) return;
      const { error } = await supabase.rpc("bulk_mark_dialogs_read_atomic" as any, {
        p_user_ids: userIds,
        p_boundary: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INBOX_DIALOGS_QK });
      queryClient.invalidateQueries({ queryKey: UNREAD_MESSAGES_COUNT_QK });
      setSelectedChats(new Set());
      setSelectionMode(false);
      toast.success("Чаты отмечены как прочитанные");
    },
  });

  const markChatAsRead = (userId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    markAsRead.mutate(userId);
    toast.success("Отмечено как прочитанное");
  };

  const handleSelectDialog = (userId: string) => {
    setSelectedUserId(userId);
    // НЕ вызываем markAsRead — чат остаётся "новым" до явного действия или ответа
  };

  // Realtime-подписка перенесена в глобальный `useInboxRealtimeInvalidation`
  // (mounted в AdminLayout). Здесь больше не нужна: invalidate приходит из общего
  // bus-хука с trailing debounce 300 мс и event-aware матрицей.

  const toggleChatSelection = (userId: string, e: React.MouseEvent | React.ChangeEvent) => {
    e.stopPropagation();
    setSelectedChats(prev => {
      const newSet = new Set(prev);
      if (newSet.has(userId)) {
        newSet.delete(userId);
      } else {
        newSet.add(userId);
      }
      return newSet;
    });
  };

  // Filter dialogs
  const filteredDialogs = useMemo(() => {
    let result = dialogs.map(d => ({
      ...d,
      is_pinned: prefsMap.get(d.user_id)?.is_pinned || false,
      is_favorite: prefsMap.get(d.user_id)?.is_favorite || false,
    }));

    if (filter === "unread") {
      result = result.filter(d => d.unread_count > 0);
    } else if (filter === "read") {
      result = result.filter(d => d.unread_count === 0);
    } else if (filter === "favorites") {
      result = result.filter(d => d.is_favorite);
    } else if (filter === "pinned") {
      result = result.filter(d => d.is_pinned);
    }

    // Bot filter (client-side)
    if (botFilter !== "all") {
      result = result.filter(d => d.last_bot_id === botFilter);
    }

    if (searchQuery) {
      const search = searchQuery.toLowerCase();
      result = result.filter(dialog => 
        dialog.profile?.full_name?.toLowerCase().includes(search) ||
        dialog.profile?.email?.toLowerCase().includes(search) ||
        dialog.profile?.phone?.toLowerCase().includes(search) ||
        dialog.profile?.telegram_username?.toLowerCase().includes(search) ||
        dialog.last_message?.toLowerCase().includes(search) ||
        dialog.orders?.some(o => o.order_number.toLowerCase().includes(search))
      );
    }

    if (advancedFilters.dateFrom) {
      result = result.filter(d => !isBefore(new Date(d.last_message_at), startOfDay(advancedFilters.dateFrom!)));
    }
    if (advancedFilters.dateTo) {
      result = result.filter(d => !isAfter(new Date(d.last_message_at), endOfDay(advancedFilters.dateTo!)));
    }
    if (advancedFilters.orderNumber) {
      result = result.filter(d => d.orders?.some(o => o.order_number.toLowerCase().includes(advancedFilters.orderNumber.toLowerCase())));
    }
    if (advancedFilters.hasActiveSubscription === "yes") {
      result = result.filter(d => d.subscriptions?.some(s => s.status === "active"));
    } else if (advancedFilters.hasActiveSubscription === "no") {
      result = result.filter(d => !d.subscriptions?.some(s => s.status === "active"));
    }

    result.sort((a, b) => {
      if (a.is_pinned && !b.is_pinned) return -1;
      if (!a.is_pinned && b.is_pinned) return 1;
      return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime();
    });

    return result;
  }, [dialogs, searchQuery, advancedFilters, filter, prefsMap, botFilter]);

  // Unified bot display label: bot_name -> @bot_username -> "Бот"
  const displayBotLabel = (botName?: string | null, botUsername?: string | null) => {
    const name = botName?.trim();
    if (name) return name;
    const u = botUsername?.trim();
    if (u) return `@${u}`;
    return "Бот";
  };

  const selectedDialog = filteredDialogs.find(d => d.user_id === selectedUserId) || dialogs.find(d => d.user_id === selectedUserId);
  const clearFilters = () => setAdvancedFilters(initialFilters);

  // Unique bots from dialogs for filter
  const uniqueBots = useMemo(() => {
    const botsMap = new Map<string, { id: string; username: string; name: string }>();
    dialogs.forEach(d => {
      if (d.last_bot_id && d.last_bot_username) {
        botsMap.set(d.last_bot_id, {
          id: d.last_bot_id,
          username: d.last_bot_username,
          name: d.last_bot_name || d.last_bot_username,
        });
      }
    });
    return Array.from(botsMap.values());
  }, [dialogs]);

  // Virtualization
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filteredDialogs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 82,
    overscan: 5,
    measureElement: (element) => element.getBoundingClientRect().height,
  });
  const selectAllChats = () => setSelectedChats(new Set(filteredDialogs.map(d => d.user_id)));

  // Dialog list content (shared between mobile & desktop)
  const dialogListContent = (
    <>
      {/* Header */}
      <div className="p-1.5 space-y-1.5 border-b border-border/10">
        {selectionMode ? (
          /* Selection Mode Header */
          <div className="flex items-center justify-between bg-primary/5 rounded-xl p-2">
            <div className="flex items-center gap-2">
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-8 rounded-full hover:bg-card" 
                onClick={() => { setSelectionMode(false); setSelectedChats(new Set()); }}
              >
                <X className="h-4 w-4 mr-1" />
                Отмена
              </Button>
              <span className="text-sm font-medium">
                {selectedChats.size} выбрано
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-8 rounded-full" 
                onClick={selectAllChats}
              >
                Все
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    size="sm" 
                    className="h-8 rounded-full"
                    disabled={selectedChats.size === 0}
                    onClick={() => bulkMarkAsRead.mutate(Array.from(selectedChats))}
                  >
                    <CheckCheck className="h-4 w-4 mr-1" />
                    Прочитать
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Отметить прочитанными</TooltipContent>
              </Tooltip>
            </div>
          </div>
        ) : (
          /* Normal Header */
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5">
                <MessageSquare className="h-3.5 w-3.5 text-primary" />
              </div>
              <h2 className="text-xs font-semibold">Telegram</h2>
              {totalUnread > 0 && (
                <Badge className="bg-primary text-primary-foreground text-[10px] h-4 min-w-4 px-1 rounded-full">
                  {totalUnread}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-8 w-8 rounded-full hover:bg-card"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent 
                  align="end" 
                  className="w-48 bg-card/95 backdrop-blur-xl border-border/30 rounded-xl shadow-2xl"
                >
                  <DropdownMenuItem 
                    onClick={() => setSelectionMode(true)} 
                    className="gap-2 rounded-lg cursor-pointer"
                  >
                    <CheckSquare className="h-4 w-4" />
                    Режим выделения
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    onClick={() => {
                      const unreadIds = dialogs.filter(d => d.unread_count > 0).map(d => d.user_id);
                      if (unreadIds.length > 0) bulkMarkAsRead.mutate(unreadIds);
                    }}
                    disabled={dialogs.filter(d => d.unread_count > 0).length === 0}
                    className="gap-2 rounded-lg cursor-pointer"
                  >
                    <CheckCheck className="h-4 w-4" />
                    Прочитать все
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-border/30" />
                  <DropdownMenuItem 
                    onClick={() => setFilter("all")}
                    className="gap-2 rounded-lg cursor-pointer"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Сбросить фильтры
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-8 w-8 rounded-full hover:bg-card" 
                    onClick={() => refetch()}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Обновить</TooltipContent>
              </Tooltip>
            </div>
          </div>
        )}
        
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-10 bg-card/80 border-border/30 rounded-xl focus:border-primary/50 focus:ring-primary/20"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
          {[
            { value: "all", label: "Все" },
            { value: "unread", label: "Новые", count: dialogs.filter(d => d.unread_count > 0).length },
            { value: "favorites", label: "Избранные" },
            { value: "pinned", label: "Закреплённые" },
          ]
            .filter(tab => tab.value !== "unread" || (tab.count ?? 0) > 0)
            .map((tab) => (
            <Button
              key={tab.value}
              variant="ghost"
              size="sm"
              className={cn(
                "h-7 px-2.5 text-xs whitespace-nowrap rounded-full transition-all",
                filter === tab.value
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "bg-card/60 hover:bg-card text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setFilter(tab.value as any)}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className="ml-1 text-[10px] opacity-80">
                  {tab.count}
                </span>
              )}
            </Button>
          ))}
          {/* Bot filter */}
          {uniqueBots.length > 1 && (
            <Select value={botFilter} onValueChange={setBotFilter}>
              <SelectTrigger className={cn(
                "h-7 w-auto min-w-[80px] text-xs rounded-full border-0",
                botFilter !== "all"
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "bg-card/60 text-muted-foreground"
              )}>
                <Bot className="h-3 w-3 mr-1" />
                <SelectValue placeholder="Бот" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все боты</SelectItem>
                {uniqueBots.map(bot => (
                  <SelectItem key={bot.id} value={bot.id}>
                    {displayBotLabel(bot.name, bot.username)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* Dialog List - Virtualized */}
      <div 
        ref={parentRef} 
        className="flex-1 min-h-0 overflow-y-auto"
      >
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">
            <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
            <span className="text-sm">Загрузка...</span>
          </div>
        ) : filteredDialogs.length === 0 ? (
          <div className="p-8 text-center">
            <MessageSquare className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
            <p className="text-muted-foreground">
              {searchQuery || hasActiveFilters ? "Ничего не найдено" : "Нет сообщений"}
            </p>
          </div>
        ) : (
          <div
            className="relative p-1.5"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const dialog = filteredDialogs[virtualRow.index];
              return (
                <div
                  key={dialog.user_id}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  className="absolute top-0 left-0 w-full px-1.5"
                  style={{
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <SwipeableDialogCard
                    disabled={selectionMode}
                    onSwipeRight={dialog.unread_count > 0 ? () => markChatAsRead(dialog.user_id) : undefined}
                    onSwipeLeft={() => toast.info("Архивирование пока не реализовано")}
                    onClick={() => handleSelectDialog(dialog.user_id)}
                    className={cn(
                      "group relative grid grid-cols-[auto_1fr_24px] items-start gap-1.5 p-1.5 cursor-pointer rounded-lg border transition-colors duration-200",
                      selectedUserId === dialog.user_id 
                        ? "bg-primary/10 border-primary" 
                        : "border-transparent hover:bg-muted/40"
                    )}
                  >
                    {selectionMode && (
                      <Checkbox
                        checked={selectedChats.has(dialog.user_id)}
                        onCheckedChange={() => toggleChatSelection(dialog.user_id, { stopPropagation: () => {} } as any)}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-1.5"
                      />
                    )}
                    <div className="relative shrink-0">
                      <Avatar className="h-8 w-8 ring-1 ring-border/20">
                        <AvatarImage src={dialog.profile?.avatar_url || undefined} />
                        <AvatarFallback className="bg-gradient-to-br from-primary/20 to-accent/20 text-foreground font-semibold">
                          {dialog.profile?.full_name?.[0] || dialog.profile?.email?.[0] || "?"}
                        </AvatarFallback>
                      </Avatar>
                      {dialog.unread_count > 0 && (
                        <div className="absolute -top-0.5 -right-0.5 h-5 min-w-5 px-1 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold shadow-lg">
                          {dialog.unread_count > 99 ? "99+" : dialog.unread_count}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs font-semibold truncate flex-1 min-w-0 whitespace-nowrap">
                          {dialog.profile?.full_name 
                            ? formatContactName({ full_name: dialog.profile.full_name }) 
                            : dialog.profile?.email || "Неизвестный"}
                        </span>
                        {(dialog.last_bot_name || dialog.last_bot_username) && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 shrink-0 font-normal text-muted-foreground border-border/40 whitespace-nowrap max-w-[100px] truncate">
                            {displayBotLabel(dialog.last_bot_name, dialog.last_bot_username)}
                          </Badge>
                        )}
                        <span className="text-[10px] text-muted-foreground shrink-0 whitespace-nowrap">
                          {formatDistanceToNow(new Date(dialog.last_message_at), { addSuffix: false, locale: ru })}
                        </span>
                      </div>
                      <p className={cn(
                        "text-xs line-clamp-2 break-words mt-0.5 min-w-0",
                        dialog.unread_count > 0 
                          ? "text-foreground font-medium" 
                          : "text-muted-foreground"
                      )}>
                        {dialog.last_message}
                      </p>
                    </div>

                    {/* Quick Actions - vertical stack, hover-only */}
                    {!selectionMode && (
                      <div className="self-stretch flex flex-col items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto">
                        <button
                          type="button"
                          className={cn(
                            "h-6 w-6 rounded-md flex items-center justify-center transition-colors hover:bg-primary/15",
                            dialog.is_favorite && "text-yellow-500"
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePrefMutation.mutate({
                              contactUserId: dialog.user_id,
                              field: "is_favorite",
                              value: !dialog.is_favorite
                            });
                          }}
                        >
                          <Star className={cn("h-3.5 w-3.5", dialog.is_favorite && "fill-yellow-500")} />
                        </button>
                        <button
                          type="button"
                          className={cn(
                            "h-6 w-6 rounded-md flex items-center justify-center transition-colors hover:bg-primary/15",
                            dialog.is_pinned && "text-primary"
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePrefMutation.mutate({
                              contactUserId: dialog.user_id,
                              field: "is_pinned",
                              value: !dialog.is_pinned
                            });
                          }}
                        >
                          <Pin className={cn("h-3.5 w-3.5", dialog.is_pinned && "fill-primary")} />
                        </button>
                        <button
                          type="button"
                          disabled={dialog.unread_count === 0}
                          className={cn(
                            "h-6 w-6 rounded-md flex items-center justify-center transition-colors",
                            dialog.unread_count > 0
                              ? "hover:bg-primary/15"
                              : "opacity-40 cursor-not-allowed"
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (dialog.unread_count > 0) {
                              markChatAsRead(dialog.user_id, e);
                            }
                          }}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </SwipeableDialogCard>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );

  // Chat panel content (shared between mobile & desktop)
  const chatPanelContent = selectedUserId ? (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <div className="p-3 border-b border-border/20 bg-card/80 backdrop-blur flex items-center gap-3">
        {isMobile && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full shrink-0"
            onClick={() => setSelectedUserId(null)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <button 
          onClick={() => {
            const profile = selectedDialog?.profile;
            if (profile?.id) {
              setContactSheetUserId(profile.id);
            } else {
              toast.error("Контакт не привязан к профилю");
            }
          }}
          className="shrink-0 hover:opacity-80 transition-opacity cursor-pointer"
        >
          <Avatar className="h-10 w-10 ring-2 ring-border/20">
            <AvatarImage src={selectedDialog?.profile?.avatar_url || undefined} />
            <AvatarFallback className="bg-gradient-to-br from-primary/20 to-accent/20 font-semibold">
              {selectedDialog?.profile?.full_name?.[0] || "?"}
            </AvatarFallback>
          </Avatar>
        </button>
        <button 
          onClick={() => {
            const profile = selectedDialog?.profile;
            if (profile?.id) {
              setContactSheetUserId(profile.id);
            } else {
              toast.error("Контакт не привязан к профилю");
            }
          }}
          className="flex-1 min-w-0 text-left hover:opacity-80 transition-opacity cursor-pointer"
        >
          <p className="font-semibold truncate">
            {selectedDialog?.profile?.full_name || selectedDialog?.profile?.email || "Контакт"}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {selectedDialog?.profile?.telegram_username 
              ? `@${selectedDialog.profile.telegram_username}` 
              : selectedDialog?.profile?.email}
          </p>
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <ContactTelegramChat
          userId={selectedUserId}
          telegramUserId={selectedDialog?.profile?.telegram_user_id || null}
          telegramUsername={selectedDialog?.profile?.telegram_username || null}
          clientName={selectedDialog?.profile?.full_name}
          avatarUrl={selectedDialog?.profile?.avatar_url}
          onAvatarUpdated={() => refetch()}
          hidePhotoButton
          onMessageSent={() => markAsRead.mutate(selectedUserId)}
        />
      </div>
    </div>
  ) : (
    <div className="h-full flex items-center justify-center text-center text-muted-foreground p-8">
      <div>
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/10 to-accent/10 flex items-center justify-center mx-auto mb-4">
          <MessageSquare className="h-8 w-8 text-primary/50" />
        </div>
        <p className="font-medium">Выберите чат</p>
        <p className="text-sm text-muted-foreground/70 mt-1">для просмотра сообщений</p>
      </div>
    </div>
  );

  return (
    <TooltipProvider>
      <div className="h-full min-h-0 flex flex-col overflow-hidden p-2">

        {channel === "support" ? (
          <div className="flex-1 min-h-0 bg-card/40 backdrop-blur-md border border-border/20 rounded-xl shadow-md overflow-hidden">
            <SupportTabContent />
          </div>
        ) : channel === "email" ? (
          <div className="flex-1 min-h-0 bg-card/40 backdrop-blur-md border border-border/20 rounded-xl shadow-md overflow-hidden">
            <EmailInboxView
              onContactClick={(userId) => navigate(`/admin/contacts?contact=${userId}`)}
            />
          </div>
        ) : channel === "instagram" ? (
          <div className="flex-1 min-h-0 bg-card/40 backdrop-blur-md border border-border/20 rounded-xl shadow-md overflow-hidden">
            <InstagramInboxView />
          </div>
        ) : isMobile ? (
          <div className="flex-1 min-h-0 overflow-x-hidden">
            {!selectedUserId ? (
              <div className="flex flex-col h-full min-h-0 bg-card/40 backdrop-blur-md border border-border/20 rounded-xl shadow-md overflow-hidden">
                {dialogListContent}
              </div>
            ) : (
              <div className="flex flex-col h-full min-h-0 bg-card/60 backdrop-blur-xl border border-border/30 rounded-2xl shadow-xl overflow-x-hidden">
                {chatPanelContent}
              </div>
            )}
          </div>
        ) : (
          <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0 gap-3" onLayout={handlePanelResize}>
            <ResizablePanel 
              defaultSize={savedPanelSize} 
              minSize={15} 
              maxSize={40}
              className="flex flex-col min-w-0 bg-card/40 backdrop-blur-md border border-border/20 rounded-xl shadow-md"
            >
              {dialogListContent}
            </ResizablePanel>
            <ResizableHandle withHandle className="mx-1" />
            <ResizablePanel defaultSize={75} minSize={50} className="min-w-0 bg-card/60 backdrop-blur-xl border border-border/30 rounded-2xl shadow-xl overflow-hidden">
              {chatPanelContent}
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </div>
      
      {/* Contact Detail Sheet */}
      {contactSheetUserId && (
        <ContactDetailSheet
          contact={{ 
            id: contactSheetUserId,
            ...(selectedDialog?.profile || {})
          } as any}
          open={!!contactSheetUserId}
          onOpenChange={(open) => {
            if (!open) setContactSheetUserId(null);
          }}
        />
      )}
    </TooltipProvider>
  );
}
