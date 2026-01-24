import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ContactTelegramChat } from "@/components/admin/ContactTelegramChat";
import { EmailInboxView } from "@/components/admin/email";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
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
} from "lucide-react";
import { format, formatDistanceToNow, isAfter, isBefore, startOfDay, endOfDay } from "date-fns";
import { ru } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// Notification sound using Web Audio API
const playNotificationSound = () => {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    
    const audioContext = new AudioContextClass();
    
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
    
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
    oscillator.frequency.setValueAtTime(1100, audioContext.currentTime + 0.1);
    oscillator.type = 'sine';
    
    gainNode.gain.setValueAtTime(0.4, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.4);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.4);
    
    oscillator.onended = () => {
      audioContext.close();
    };
  } catch (e) {
    console.log('Sound notification not available:', e);
  }
};

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

export function InboxTabContent() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [channel, setChannel] = useState<"telegram" | "email">("telegram");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [contactSheetUserId, setContactSheetUserId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "unread" | "read" | "favorites" | "pinned">("all");
  const [advancedFilters, setAdvancedFilters] = useState<Filters>(initialFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedChats, setSelectedChats] = useState<Set<string>>(new Set());
  const lastMessageCountRef = useRef<number>(0);
  const soundEnabledRef = useRef<boolean>(false);

  // Enable sound after first user interaction
  useEffect(() => {
    const enableSound = () => {
      soundEnabledRef.current = true;
      document.removeEventListener('click', enableSound);
      document.removeEventListener('keydown', enableSound);
    };
    document.addEventListener('click', enableSound);
    document.addEventListener('keydown', enableSound);
    return () => {
      document.removeEventListener('click', enableSound);
      document.removeEventListener('keydown', enableSound);
    };
  }, []);

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
    queryKey: ["inbox-dialogs"],
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
        last_message: d.last_message_text || (d.last_message_type ? `[${d.last_message_type}]` : ""),
        last_message_at: d.last_message_at,
        unread_count: Number(d.unread_count) || 0,
        profile: profileMap.get(d.user_id) || null,
        orders: ordersMap.get(d.user_id) || [],
        subscriptions: subsMap.get(d.user_id) || [],
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

  // Mark messages as read
  const markAsRead = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase
        .from("telegram_messages")
        .update({ is_read: true })
        .eq("user_id", userId)
        .eq("direction", "incoming")
        .eq("is_read", false);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox-dialogs"] });
      queryClient.invalidateQueries({ queryKey: ["unread-messages-count"] });
    },
  });

  // Bulk mark as read
  const bulkMarkAsRead = useMutation({
    mutationFn: async (userIds: string[]) => {
      const { error } = await supabase
        .from("telegram_messages")
        .update({ is_read: true })
        .in("user_id", userIds)
        .eq("direction", "incoming")
        .eq("is_read", false);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox-dialogs"] });
      queryClient.invalidateQueries({ queryKey: ["unread-messages-count"] });
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

  // Subscribe to realtime updates for new messages
  useEffect(() => {
    const channel = supabase
      .channel("inbox-messages-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "telegram_messages" },
        (payload) => {
          refetch();
          const newMsg = payload.new as any;
          if (newMsg?.direction === "incoming" && soundEnabledRef.current) {
            playNotificationSound();
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "telegram_messages" },
        () => refetch()
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [refetch]);

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
  }, [dialogs, searchQuery, advancedFilters, filter, prefsMap]);

  const selectedDialog = filteredDialogs.find(d => d.user_id === selectedUserId) || dialogs.find(d => d.user_id === selectedUserId);
  const clearFilters = () => setAdvancedFilters(initialFilters);
  const selectAllChats = () => setSelectedChats(new Set(filteredDialogs.map(d => d.user_id)));

  return (
    <TooltipProvider>
      <div className="h-full min-h-0 flex flex-col overflow-hidden p-4">
        {/* Glass Channel Tabs */}
        <div className="mb-4 shrink-0">
          <div className="inline-flex p-1 rounded-full bg-card/60 backdrop-blur-xl border border-border/30 shadow-lg">
            <button
              onClick={() => setChannel("telegram")}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all duration-300",
                channel === "telegram"
                  ? "bg-card text-foreground shadow-md"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <MessageSquare className="h-4 w-4" />
              Telegram
              {totalUnread > 0 && (
                <Badge className="h-5 min-w-5 px-1.5 text-xs rounded-full bg-primary text-primary-foreground">
                  {totalUnread}
                </Badge>
              )}
            </button>
            <button
              onClick={() => setChannel("email")}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all duration-300",
                channel === "email"
                  ? "bg-card text-foreground shadow-md"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Mail className="h-4 w-4" />
              Email
            </button>
          </div>
        </div>

        {channel === "email" ? (
          <div className="flex-1 bg-card/60 backdrop-blur-xl border border-border/30 rounded-2xl shadow-xl overflow-hidden">
            <EmailInboxView 
              onContactClick={(userId) => navigate(`/admin/contacts?contact=${userId}`)}
            />
          </div>
        ) : (
          <div className="flex flex-1 gap-3 min-h-0 w-full min-w-0">
            {/* Dialog List - Glass Panel */}
            <div className={cn(
              "flex flex-col w-full md:w-[380px] shrink-0 min-w-0",
              "bg-card/60 backdrop-blur-xl border border-border/30 rounded-2xl shadow-xl",
              selectedUserId ? "hidden md:flex" : "flex"
            )}>
              {/* Header */}
              <div className="p-3 space-y-3 border-b border-border/20">
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
                      <div className="p-2 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5">
                        <MessageSquare className="h-4 w-4 text-primary" />
                      </div>
                      <h2 className="font-semibold">Чаты</h2>
                      {totalUnread > 0 && (
                        <Badge className="bg-primary text-primary-foreground text-xs h-5 min-w-5 px-1.5 rounded-full">
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
                        "h-8 px-3 text-xs whitespace-nowrap rounded-full transition-all",
                        filter === tab.value
                          ? "bg-primary text-primary-foreground shadow-md"
                          : "bg-card/60 hover:bg-card text-muted-foreground hover:text-foreground"
                      )}
                      onClick={() => setFilter(tab.value as any)}
                    >
                      {tab.label}
                      {tab.count !== undefined && tab.count > 0 && (
                        <span className="ml-1.5 text-[10px] opacity-80">
                          {tab.count}
                        </span>
                      )}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Dialog List */}
              <ScrollArea className="flex-1">
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
                  <div className="p-1.5 min-w-0">
                    {filteredDialogs.map((dialog) => (
                      <SwipeableDialogCard
                        key={dialog.user_id}
                        disabled={selectionMode}
                        onSwipeRight={dialog.unread_count > 0 ? () => markChatAsRead(dialog.user_id) : undefined}
                        onSwipeLeft={() => toast.info("Архивирование пока не реализовано")}
                        onClick={() => handleSelectDialog(dialog.user_id)}
                      className={cn(
                        "group relative grid grid-cols-[auto_1fr_auto] items-center gap-3 p-3 cursor-pointer rounded-xl border transition-colors duration-200",
                        selectedUserId === dialog.user_id 
                          ? "bg-primary/10 border-primary" 
                          : "border-transparent hover:bg-muted/40"
                      )}
                      >
                        {/* Col 1: Checkbox + Avatar */}
                        <div className="flex items-center gap-3">
                          {selectionMode && (
                            <Checkbox
                              checked={selectedChats.has(dialog.user_id)}
                              onCheckedChange={() => toggleChatSelection(dialog.user_id, { stopPropagation: () => {} } as any)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          )}
                          <div className="relative shrink-0">
                            <Avatar className="h-12 w-12 ring-2 ring-border/20">
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
                        </div>

                        {/* Col 2: Content */}
                        <div className="min-w-0 overflow-hidden">
                          <div className="flex items-center justify-between gap-2 min-w-0">
                            <span className="font-semibold truncate min-w-0">
                              {dialog.profile?.full_name || dialog.profile?.email || "Неизвестный"}
                            </span>
                            <span className="text-[11px] text-muted-foreground shrink-0">
                              {formatDistanceToNow(new Date(dialog.last_message_at), { addSuffix: false, locale: ru })}
                            </span>
                          </div>
                          <p className={cn(
                            "text-sm line-clamp-2 break-words mt-1 min-w-0",
                            dialog.unread_count > 0 
                              ? "text-foreground font-medium" 
                              : "text-muted-foreground"
                          )}>
                            {dialog.last_message}
                          </p>
                        </div>

                        {/* Col 3: Quick Actions - hover only */}
                        {!selectionMode && (
                          <div className="w-[92px] flex justify-end self-center">
                            <div className={cn(
                              "flex items-center gap-1 rounded-lg p-1 bg-card/90 border border-border/40 shadow-sm",
                              "opacity-0 group-hover:opacity-100 transition-opacity duration-200",
                              "pointer-events-none group-hover:pointer-events-auto"
                            )}>
                              {/* ⭐ Favorite */}
                              <button
                                type="button"
                                className={cn(
                                  "h-7 w-7 rounded-full flex items-center justify-center transition-colors",
                                  "hover:bg-primary/15",
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
                                <Star className={cn("h-4 w-4", dialog.is_favorite && "fill-yellow-500")} />
                              </button>

                              {/* 📌 Pin */}
                              <button
                                type="button"
                                className={cn(
                                  "h-7 w-7 rounded-full flex items-center justify-center transition-colors",
                                  "hover:bg-primary/15",
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
                                <Pin className={cn("h-4 w-4", dialog.is_pinned && "fill-primary")} />
                              </button>

                              {/* ✓ Mark as Read */}
                              <button
                                type="button"
                                disabled={dialog.unread_count === 0}
                                className={cn(
                                  "h-7 w-7 rounded-full flex items-center justify-center transition-colors",
                                  dialog.unread_count > 0
                                    ? "hover:bg-primary/15"
                                    : "opacity-40 cursor-not-allowed"
                                )}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (dialog.unread_count > 0) {
                                    markChatAsRead(dialog.user_id);
                                  }
                                }}
                              >
                                <Check className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        )}
                      </SwipeableDialogCard>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>

            {/* Chat View - Glass Panel */}
            <div className={cn(
              "flex-1 min-w-0 bg-card/60 backdrop-blur-xl border border-border/30 rounded-2xl shadow-xl overflow-hidden",
              !selectedUserId && "hidden md:flex items-center justify-center"
            )}>
              {selectedUserId ? (
                <div className="h-full min-h-0 flex flex-col overflow-hidden">
                  {/* Chat Header with clickable contact */}
                  <div className="p-3 border-b border-border/20 bg-card/80 backdrop-blur flex items-center gap-3">
                    {/* Mobile back button */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="md:hidden h-8 w-8 rounded-full shrink-0"
                      onClick={() => setSelectedUserId(null)}
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                    
                    {/* Clickable Avatar */}
                    <button 
                      onClick={() => {
                        const profile = selectedDialog?.profile;
                        if (profile?.id) {
                          // Diagnostic logging for mismatch detection
                          console.log("[ContactSheet] Opening contact:", {
                            dialogUserId: selectedDialog?.user_id,
                            profileId: profile.id,
                            profileTelegramUserId: profile.telegram_user_id,
                            profileName: profile.full_name,
                            profileEmail: profile.email,
                          });
                          setContactSheetUserId(profile.id);
                        } else {
                          toast.error("Контакт не привязан к профилю");
                          console.warn("[ContactSheet] No profile for dialog:", selectedDialog?.user_id);
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
                    
                    {/* Clickable Name */}
                    <button 
                      onClick={() => {
                        const profile = selectedDialog?.profile;
                        if (profile?.id) {
                          console.log("[ContactSheet] Opening contact:", {
                            dialogUserId: selectedDialog?.user_id,
                            profileId: profile.id,
                            profileTelegramUserId: profile.telegram_user_id,
                            profileName: profile.full_name,
                            profileEmail: profile.email,
                          });
                          setContactSheetUserId(profile.id);
                        } else {
                          toast.error("Контакт не привязан к профилю");
                          console.warn("[ContactSheet] No profile for dialog:", selectedDialog?.user_id);
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
                  <div className="flex-1 min-h-0 overflow-hidden">
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
                <div className="text-center text-muted-foreground p-8">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/10 to-accent/10 flex items-center justify-center mx-auto mb-4">
                    <MessageSquare className="h-8 w-8 text-primary/50" />
                  </div>
                  <p className="font-medium">Выберите чат</p>
                  <p className="text-sm text-muted-foreground/70 mt-1">для просмотра сообщений</p>
                </div>
              )}
            </div>
          </div>
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
