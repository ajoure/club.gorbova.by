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
import { Calendar } from "@/components/ui/calendar";
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

  // Fetch dialogs with unread counts and related data
  const { data: dialogs = [], isLoading, refetch } = useQuery({
    queryKey: ["inbox-dialogs"],
    queryFn: async () => {
      const { data: messages, error } = await supabase
        .from("telegram_messages")
        .select(`user_id, message_text, created_at, direction, is_read`)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const dialogMap = new Map<string, {
        user_id: string;
        last_message: string;
        last_message_at: string;
        unread_count: number;
      }>();

      messages?.forEach((msg) => {
        if (!msg.user_id) return;
        const existing = dialogMap.get(msg.user_id);
        if (!existing) {
          dialogMap.set(msg.user_id, {
            user_id: msg.user_id,
            last_message: msg.message_text || "",
            last_message_at: msg.created_at,
            unread_count: msg.direction === "incoming" && !msg.is_read ? 1 : 0,
          });
        } else {
          if (msg.direction === "incoming" && !msg.is_read) {
            existing.unread_count++;
          }
        }
      });

      const userIds = Array.from(dialogMap.keys());
      if (userIds.length === 0) return [];

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, user_id, full_name, email, phone, telegram_username, telegram_user_id, avatar_url")
        .in("user_id", userIds);

      const { data: orders } = await supabase
        .from("orders_v2")
        .select("id, user_id, order_number, status, products_v2(name)")
        .in("user_id", userIds);

      const { data: subscriptions } = await supabase
        .from("subscriptions_v2")
        .select("id, user_id, status, products_v2(name)")
        .in("user_id", userIds);

      const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);
      
      const ordersMap = new Map<string, any[]>();
      orders?.forEach(o => {
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
      subscriptions?.forEach(s => {
        const existing = subsMap.get(s.user_id) || [];
        existing.push({
          id: s.id,
          product_name: (s.products_v2 as any)?.name || null,
          status: s.status,
        });
        subsMap.set(s.user_id, existing);
      });

      const result: Dialog[] = Array.from(dialogMap.values()).map(d => ({
        ...d,
        profile: profileMap.get(d.user_id) || null,
        orders: ordersMap.get(d.user_id) || [],
        subscriptions: subsMap.get(d.user_id) || [],
      }));

      result.sort((a, b) => 
        new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
      );

      return result;
    },
    refetchInterval: 30000,
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

  const markChatAsRead = (userId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    markAsRead.mutate(userId);
    toast.success("Отмечено как прочитанное");
  };

  const handleSelectDialog = (userId: string) => {
    setSelectedUserId(userId);
    markAsRead.mutate(userId);
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
      <div className="h-full flex flex-col overflow-hidden p-4">
        {/* Channel Tabs */}
        <div className="mb-4 shrink-0">
          <Tabs value={channel} onValueChange={(v) => setChannel(v as "telegram" | "email")}>
            <TabsList className="grid w-full max-w-md grid-cols-2">
              <TabsTrigger value="telegram" className="gap-2">
                <MessageSquare className="h-4 w-4" />
                Telegram
                {totalUnread > 0 && (
                  <Badge variant="destructive" className="h-5 px-1.5 text-xs">{totalUnread}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="email" className="gap-2">
                <Mail className="h-4 w-4" />
                Email
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {channel === "email" ? (
          <div className="flex-1 bg-background/60 backdrop-blur-xl border border-border/50 rounded-2xl shadow-xl overflow-hidden">
            <EmailInboxView 
              onContactClick={(userId) => navigate(`/admin/contacts?contact=${userId}`)}
            />
          </div>
        ) : (
          <div className="flex flex-1 gap-3 min-h-0 overflow-hidden">
            {/* Dialog List */}
            <div className={cn(
              "flex flex-col w-full md:w-[380px] md:min-w-[320px] md:max-w-[400px] shrink-0 overflow-hidden",
              "bg-background/60 backdrop-blur-xl border border-border/50 rounded-2xl shadow-xl",
              selectedUserId ? "hidden md:flex" : "flex"
            )}>
              {/* Header */}
              <div className="p-3 space-y-2 border-b border-border/30">
                {selectionMode ? (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="sm" className="h-8" onClick={() => { setSelectionMode(false); setSelectedChats(new Set()); }}>
                        <X className="h-4 w-4 mr-1" />
                        Отмена
                      </Button>
                      <span className="text-sm text-muted-foreground">
                        Выбрано: {selectedChats.size}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" className="h-8" onClick={selectAllChats}>
                        Все
                      </Button>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8"
                            disabled={selectedChats.size === 0}
                            onClick={() => bulkMarkAsRead.mutate(Array.from(selectedChats))}
                          >
                            <CheckCheck className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Отметить прочитанными</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-primary/10">
                        <MessageSquare className="h-4 w-4 text-primary" />
                      </div>
                      <h2 className="font-semibold">Чаты</h2>
                      {totalUnread > 0 && (
                        <Badge className="bg-destructive/90 text-destructive-foreground text-xs h-5 px-1.5">
                          {totalUnread}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg" onClick={() => setSelectionMode(true)}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Выбрать чаты</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg" onClick={() => refetch()}>
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
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Поиск..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8 h-9 bg-muted/50 border-transparent focus:border-primary/50"
                  />
                </div>

                {/* Filter Tabs */}
                <div className="flex gap-1 overflow-x-auto pb-1">
                  {[
                    { value: "all", label: "Все" },
                    { value: "unread", label: "Непрочитанные" },
                    { value: "favorites", label: "Избранные" },
                    { value: "pinned", label: "Закреплённые" },
                  ].map((tab) => (
                    <Button
                      key={tab.value}
                      variant={filter === tab.value ? "secondary" : "ghost"}
                      size="sm"
                      className="h-7 px-2.5 text-xs whitespace-nowrap"
                      onClick={() => setFilter(tab.value as any)}
                    >
                      {tab.label}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Dialog List */}
              <ScrollArea className="flex-1">
                {isLoading ? (
                  <div className="p-8 text-center text-muted-foreground">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2" />
                    Загрузка...
                  </div>
                ) : filteredDialogs.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    {searchQuery || hasActiveFilters ? "Ничего не найдено" : "Нет сообщений"}
                  </div>
                ) : (
                  <div className="divide-y divide-border/30">
                    {filteredDialogs.map((dialog) => (
                      <div
                        key={dialog.user_id}
                        className={cn(
                          "flex items-start gap-3 p-3 cursor-pointer hover:bg-muted/50 transition-colors",
                          selectedUserId === dialog.user_id && "bg-primary/5 border-l-2 border-primary"
                        )}
                        onClick={() => handleSelectDialog(dialog.user_id)}
                      >
                        {selectionMode && (
                          <Checkbox
                            checked={selectedChats.has(dialog.user_id)}
                            onCheckedChange={() => toggleChatSelection(dialog.user_id, { stopPropagation: () => {} } as any)}
                            onClick={(e) => e.stopPropagation()}
                            className="mt-1"
                          />
                        )}
                        <Avatar className="h-10 w-10 shrink-0">
                          <AvatarImage src={dialog.profile?.avatar_url || undefined} />
                          <AvatarFallback className="bg-primary/10 text-primary font-medium">
                            {dialog.profile?.full_name?.[0] || dialog.profile?.email?.[0] || "?"}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              {dialog.is_pinned && <Pin className="h-3 w-3 text-primary shrink-0" />}
                              {dialog.is_favorite && <Star className="h-3 w-3 text-yellow-500 fill-yellow-500 shrink-0" />}
                              <span className="font-medium truncate">
                                {dialog.profile?.full_name || dialog.profile?.email || "Неизвестный"}
                              </span>
                            </div>
                            <span className="text-xs text-muted-foreground shrink-0">
                              {formatDistanceToNow(new Date(dialog.last_message_at), { addSuffix: true, locale: ru })}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2 mt-0.5">
                            <p className="text-sm text-muted-foreground truncate">
                              {dialog.last_message}
                            </p>
                            {dialog.unread_count > 0 && (
                              <Badge variant="destructive" className="h-5 px-1.5 text-xs shrink-0">
                                {dialog.unread_count}
                              </Badge>
                            )}
                          </div>
                          {dialog.profile?.telegram_username && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              @{dialog.profile.telegram_username}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>

            {/* Chat View */}
            <div className={cn(
              "flex-1 min-w-0 bg-background/60 backdrop-blur-xl border border-border/50 rounded-2xl shadow-xl overflow-hidden",
              !selectedUserId && "hidden md:flex items-center justify-center"
            )}>
              {selectedUserId ? (
                <div className="h-full flex flex-col">
                  {/* Mobile back button */}
                  <div className="md:hidden p-2 border-b border-border/30">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedUserId(null)}
                    >
                      <ArrowLeft className="h-4 w-4 mr-2" />
                      Назад
                    </Button>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <ContactTelegramChat
                      userId={selectedUserId}
                      telegramUserId={selectedDialog?.profile?.telegram_user_id || null}
                      telegramUsername={selectedDialog?.profile?.telegram_username || null}
                      clientName={selectedDialog?.profile?.full_name}
                      avatarUrl={selectedDialog?.profile?.avatar_url}
                      onAvatarUpdated={() => refetch()}
                      hidePhotoButton
                    />
                  </div>
                </div>
              ) : (
                <div className="text-center text-muted-foreground p-8">
                  <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Выберите чат для просмотра</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
