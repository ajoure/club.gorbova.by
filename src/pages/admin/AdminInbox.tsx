import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ContactTelegramChat } from "@/components/admin/ContactTelegramChat";
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
  Trash2,
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
    // Create audio context on demand
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    
    const audioContext = new AudioContextClass();
    
    // Resume context if suspended (required for autoplay policy)
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
    
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    // Two-tone notification sound
    oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
    oscillator.frequency.setValueAtTime(1100, audioContext.currentTime + 0.1);
    oscillator.type = 'sine';
    
    gainNode.gain.setValueAtTime(0.4, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.4);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.4);
    
    // Clean up
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

export default function AdminInbox() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
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
  const pinnedCount = dialogs.filter(d => prefsMap.get(d.user_id)?.is_pinned).length;
  const favoritesCount = dialogs.filter(d => prefsMap.get(d.user_id)?.is_favorite).length;

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

  // Mark single chat as read without opening
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
          console.log("New inbox message:", payload);
          refetch();
          // Play sound for incoming messages only
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

  // Handle chat selection toggle
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

  // Select all visible chats
  const selectAllChats = () => {
    setSelectedChats(new Set(filteredDialogs.map(d => d.user_id)));
  };

  // Play notification sound for new incoming messages
  useEffect(() => {
    const currentUnread = dialogs.reduce((sum, d) => sum + d.unread_count, 0);
    if (lastMessageCountRef.current > 0 && currentUnread > lastMessageCountRef.current) {
      // New messages arrived - play sound if enabled
      if (soundEnabledRef.current) {
        playNotificationSound();
      }
    }
    lastMessageCountRef.current = currentUnread;
  }, [dialogs]);

  // Filter dialogs
  const filteredDialogs = useMemo(() => {
    let result = dialogs.map(d => ({
      ...d,
      is_pinned: prefsMap.get(d.user_id)?.is_pinned || false,
      is_favorite: prefsMap.get(d.user_id)?.is_favorite || false,
    }));

    // Apply tab filter
    if (filter === "unread") {
      result = result.filter(d => d.unread_count > 0);
    } else if (filter === "read") {
      result = result.filter(d => d.unread_count === 0);
    } else if (filter === "favorites") {
      result = result.filter(d => d.is_favorite);
    } else if (filter === "pinned") {
      result = result.filter(d => d.is_pinned);
    }

    // Apply search
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

    // Apply advanced filters
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

    // Sort: pinned first, then by date
    result.sort((a, b) => {
      if (a.is_pinned && !b.is_pinned) return -1;
      if (!a.is_pinned && b.is_pinned) return 1;
      return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime();
    });

    return result;
  }, [dialogs, searchQuery, advancedFilters, filter, prefsMap]);

  const selectedDialog = filteredDialogs.find(d => d.user_id === selectedUserId) || dialogs.find(d => d.user_id === selectedUserId);
  const clearFilters = () => setAdvancedFilters(initialFilters);

  return (
    <AdminLayout>
      <TooltipProvider>
        <div className="flex h-[calc(100vh-8rem)] gap-3">
          {/* Dialog List - Glass Design */}
          <div className={cn(
            "flex flex-col w-full md:w-[380px] md:min-w-[320px] md:max-w-[400px] shrink-0 overflow-hidden",
            "bg-background/60 backdrop-blur-xl border border-border/50 rounded-2xl shadow-xl",
            selectedUserId ? "hidden md:flex" : "flex"
          )}>
            {/* Header */}
            <div className="p-3 space-y-2 border-b border-border/30">
              {selectionMode ? (
                // Selection mode header
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
                // Normal header
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
                    <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
                      <SheetTrigger asChild>
                        <Button
                          variant={hasActiveFilters ? "default" : "ghost"}
                          size="icon"
                          className="h-7 w-7 rounded-lg"
                        >
                          <Filter className="h-4 w-4" />
                        </Button>
                      </SheetTrigger>
                      <SheetContent side="right" className="w-full sm:max-w-md">
                        <SheetHeader>
                          <SheetTitle className="flex items-center justify-between">
                            <span className="flex items-center gap-2">
                              <Filter className="h-5 w-5" />
                              Фильтры
                            </span>
                            {hasActiveFilters && (
                              <Button variant="ghost" size="sm" onClick={clearFilters}>
                                <X className="h-4 w-4 mr-1" />
                                Сбросить
                              </Button>
                            )}
                          </SheetTitle>
                        </SheetHeader>
                        <div className="mt-6 space-y-6">
                          <div className="space-y-2">
                            <Label className="text-sm font-medium">Период</Label>
                            <div className="grid grid-cols-2 gap-2">
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button variant="outline" className={cn("justify-start text-left font-normal h-10", !advancedFilters.dateFrom && "text-muted-foreground")}>
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {advancedFilters.dateFrom ? format(advancedFilters.dateFrom, "dd.MM.yy") : "От"}
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                  <Calendar mode="single" selected={advancedFilters.dateFrom} onSelect={(date) => setAdvancedFilters(f => ({ ...f, dateFrom: date }))} locale={ru} />
                                </PopoverContent>
                              </Popover>
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button variant="outline" className={cn("justify-start text-left font-normal h-10", !advancedFilters.dateTo && "text-muted-foreground")}>
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {advancedFilters.dateTo ? format(advancedFilters.dateTo, "dd.MM.yy") : "До"}
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                  <Calendar mode="single" selected={advancedFilters.dateTo} onSelect={(date) => setAdvancedFilters(f => ({ ...f, dateTo: date }))} locale={ru} />
                                </PopoverContent>
                              </Popover>
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-sm font-medium flex items-center gap-2">
                              <Handshake className="h-4 w-4" />
                              Номер сделки
                            </Label>
                            <Input placeholder="ORD-25-00001" value={advancedFilters.orderNumber} onChange={(e) => setAdvancedFilters(f => ({ ...f, orderNumber: e.target.value }))} />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-sm font-medium flex items-center gap-2">
                              <Package className="h-4 w-4" />
                              Продукт
                            </Label>
                            <Select value={advancedFilters.productId || "all"} onValueChange={(v) => setAdvancedFilters(f => ({ ...f, productId: v === "all" ? "" : v }))}>
                              <SelectTrigger><SelectValue placeholder="Любой" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="all">Любой</SelectItem>
                                {products?.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-sm font-medium">Подписка</Label>
                            <Select value={advancedFilters.hasActiveSubscription} onValueChange={(v) => setAdvancedFilters(f => ({ ...f, hasActiveSubscription: v as any }))}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="all">Все</SelectItem>
                                <SelectItem value="yes">С активной</SelectItem>
                                <SelectItem value="no">Без активной</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <Button className="w-full" onClick={() => setFiltersOpen(false)}>Применить</Button>
                        </div>
                      </SheetContent>
                    </Sheet>
                    <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg" onClick={() => refetch()} disabled={isLoading}>
                      <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
                    </Button>
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
                  className="pl-9 h-9 bg-muted/50 border-0 rounded-xl focus-visible:ring-1"
                />
              </div>

              {/* Tabs */}
              <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
                <TabsList className="w-full grid grid-cols-5 h-9 p-1 bg-muted/50 rounded-xl">
                  <TabsTrigger value="all" className="text-xs rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm">Все</TabsTrigger>
                  <TabsTrigger value="unread" className="text-xs rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm gap-1">
                    Новые {totalUnread > 0 && <span className="text-destructive">{totalUnread}</span>}
                  </TabsTrigger>
                  <TabsTrigger value="read" className="text-xs rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm">Прочит.</TabsTrigger>
                  <TabsTrigger value="favorites" className="text-xs rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm">
                    <Star className="h-3 w-3" />
                  </TabsTrigger>
                  <TabsTrigger value="pinned" className="text-xs rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm">
                    <Pin className="h-3 w-3" />
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              {/* Active filters */}
              {hasActiveFilters && (
                <div className="flex flex-wrap gap-1">
                  {advancedFilters.dateFrom && (
                    <Badge variant="secondary" className="gap-1 text-xs h-6">
                      От: {format(advancedFilters.dateFrom, "dd.MM")}
                      <button onClick={() => setAdvancedFilters(f => ({ ...f, dateFrom: undefined }))}><X className="h-3 w-3" /></button>
                    </Badge>
                  )}
                  {advancedFilters.dateTo && (
                    <Badge variant="secondary" className="gap-1 text-xs h-6">
                      До: {format(advancedFilters.dateTo, "dd.MM")}
                      <button onClick={() => setAdvancedFilters(f => ({ ...f, dateTo: undefined }))}><X className="h-3 w-3" /></button>
                    </Badge>
                  )}
                  {advancedFilters.orderNumber && (
                    <Badge variant="secondary" className="gap-1 text-xs h-6">
                      {advancedFilters.orderNumber}
                      <button onClick={() => setAdvancedFilters(f => ({ ...f, orderNumber: "" }))}><X className="h-3 w-3" /></button>
                    </Badge>
                  )}
                </div>
              )}
            </div>

            {/* Dialog List */}
            <ScrollArea className="flex-1">
              {filteredDialogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  {filter === "unread" ? (
                    <>
                      <MailCheck className="h-10 w-10 mb-3 opacity-40" />
                      <p className="text-sm">Нет непрочитанных</p>
                    </>
                  ) : filter === "favorites" ? (
                    <>
                      <Star className="h-10 w-10 mb-3 opacity-40" />
                      <p className="text-sm">Нет избранных чатов</p>
                    </>
                  ) : filter === "pinned" ? (
                    <>
                      <Pin className="h-10 w-10 mb-3 opacity-40" />
                      <p className="text-sm">Нет закреплённых</p>
                    </>
                  ) : (
                    <>
                      <MailQuestion className="h-10 w-10 mb-3 opacity-40" />
                      <p className="text-sm">Нет сообщений</p>
                    </>
                  )}
                </div>
              ) : (
                <div className="p-1.5 space-y-0.5">
                  {filteredDialogs.map((dialog) => (
                    <div
                      key={dialog.user_id}
                      onClick={() => selectionMode 
                        ? toggleChatSelection(dialog.user_id, { stopPropagation: () => {} } as React.MouseEvent)
                        : handleSelectDialog(dialog.user_id)
                      }
                      className={cn(
                        "group relative flex items-center gap-2.5 p-2 rounded-lg cursor-pointer transition-all duration-150 overflow-hidden",
                        "hover:bg-muted/60",
                        selectedUserId === dialog.user_id && "bg-primary/10 ring-1 ring-primary/20",
                        dialog.is_pinned && "bg-amber-50/30 dark:bg-amber-950/10",
                        selectedChats.has(dialog.user_id) && "bg-primary/5 ring-1 ring-primary/30"
                      )}
                    >
                      {/* Selection checkbox in selection mode */}
                      {selectionMode && (
                        <Checkbox
                          checked={selectedChats.has(dialog.user_id)}
                          onCheckedChange={(checked) => {
                            setSelectedChats(prev => {
                              const newSet = new Set(prev);
                              if (checked) {
                                newSet.add(dialog.user_id);
                              } else {
                                newSet.delete(dialog.user_id);
                              }
                              return newSet;
                            });
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="shrink-0"
                        />
                      )}

                      {/* Pinned indicator */}
                      {dialog.is_pinned && !selectionMode && (
                        <div className="absolute -top-0.5 -left-0.5">
                          <Pin className="h-2.5 w-2.5 text-amber-500 fill-amber-500" />
                        </div>
                      )}

                      {/* Avatar */}
                      <div className="relative shrink-0">
                        <Avatar className="h-10 w-10 ring-1 ring-background shadow-sm">
                          {dialog.profile?.avatar_url && <AvatarImage src={dialog.profile.avatar_url} />}
                          <AvatarFallback className="bg-gradient-to-br from-primary/20 to-primary/5 text-primary text-sm font-medium">
                            {dialog.profile?.full_name?.[0]?.toUpperCase() || dialog.profile?.telegram_username?.[0]?.toUpperCase() || "?"}
                          </AvatarFallback>
                        </Avatar>
                        {dialog.unread_count > 0 && (
                          <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 flex items-center justify-center bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full px-1 ring-1 ring-background">
                            {dialog.unread_count}
                          </span>
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0 pr-1">
                        <div className="flex items-center justify-between gap-1">
                          <div className="flex items-center gap-1 min-w-0 flex-1">
                            <span className={cn(
                              "font-medium text-sm truncate",
                              dialog.unread_count > 0 && "font-semibold"
                            )}>
                              {dialog.profile?.full_name || dialog.profile?.telegram_username || "Без имени"}
                            </span>
                            {dialog.is_favorite && <Star className="h-3 w-3 text-amber-500 fill-amber-500 shrink-0" />}
                          </div>
                          <span className="text-[10px] text-muted-foreground shrink-0 ml-1">
                            {formatDistanceToNow(new Date(dialog.last_message_at), { addSuffix: false, locale: ru })}
                          </span>
                        </div>
                        <p className={cn(
                          "text-xs truncate max-w-[180px]",
                          dialog.unread_count > 0 ? "text-foreground" : "text-muted-foreground"
                        )}>
                          {dialog.last_message || "—"}
                        </p>
                        <div className="flex items-center gap-1 mt-0.5 max-w-[200px]">
                          {dialog.profile?.telegram_username && (
                            <span className="text-[10px] text-muted-foreground truncate max-w-[100px]">@{dialog.profile.telegram_username}</span>
                          )}
                          {dialog.subscriptions?.some(s => s.status === "active") && (
                            <Badge className="text-[9px] h-3.5 px-1 bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/30 border-0 shrink-0">
                              Активен
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Quick Actions - appear on hover (not in selection mode) */}
                      {!selectionMode && (
                        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-background/80 backdrop-blur-sm rounded-lg p-0.5">
                          {dialog.unread_count > 0 && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button size="icon" variant="ghost" className="h-6 w-6 rounded-md" onClick={(e) => markChatAsRead(dialog.user_id, e)}>
                                  <CheckCheck className="h-3 w-3" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Прочитано</TooltipContent>
                            </Tooltip>
                          )}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className={cn("h-6 w-6 rounded-md", dialog.is_favorite && "text-amber-500")}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  togglePrefMutation.mutate({ contactUserId: dialog.user_id, field: "is_favorite", value: !dialog.is_favorite });
                                }}
                              >
                                <Star className={cn("h-3 w-3", dialog.is_favorite && "fill-amber-500")} />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{dialog.is_favorite ? "Убрать из избранного" : "В избранное"}</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className={cn("h-6 w-6 rounded-md", dialog.is_pinned && "text-amber-500")}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  togglePrefMutation.mutate({ contactUserId: dialog.user_id, field: "is_pinned", value: !dialog.is_pinned });
                                }}
                              >
                                <Pin className={cn("h-3 w-3", dialog.is_pinned && "fill-amber-500")} />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{dialog.is_pinned ? "Открепить" : "Закрепить"}</TooltipContent>
                          </Tooltip>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>

          {/* Chat View - Glass Design */}
          <div className={cn(
            "flex-1 flex flex-col overflow-hidden min-w-0",
            "bg-background/60 backdrop-blur-xl border border-border/50 rounded-2xl shadow-xl",
            selectedUserId ? "flex" : "hidden md:flex"
          )}>
            {selectedUserId && selectedDialog ? (
              <>
                {/* Chat Header */}
                <div className="flex items-center gap-3 p-4 border-b border-border/30">
                  <Button variant="ghost" size="icon" className="md:hidden h-9 w-9 rounded-lg shrink-0" onClick={() => setSelectedUserId(null)}>
                    <ArrowLeft className="h-5 w-5" />
                  </Button>
                  <Avatar className="h-10 w-10 ring-2 ring-background shadow-md">
                    {selectedDialog.profile?.avatar_url && <AvatarImage src={selectedDialog.profile.avatar_url} />}
                    <AvatarFallback className="bg-gradient-to-br from-primary/20 to-primary/5 text-primary font-medium">
                      {selectedDialog.profile?.full_name?.[0]?.toUpperCase() || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-sm truncate">
                        {selectedDialog.profile?.full_name || selectedDialog.profile?.telegram_username || "Без имени"}
                      </h3>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => navigate(`/admin/contacts?contact=${selectedUserId}`)}>
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Открыть карточку</TooltipContent>
                      </Tooltip>
                    </div>
                    {selectedDialog.profile?.telegram_username && (
                      <p className="text-xs text-muted-foreground">@{selectedDialog.profile.telegram_username}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {selectedDialog.unread_count > 0 && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 rounded-lg"
                            onClick={() => markAsRead.mutate(selectedUserId)}
                          >
                            <CheckCheck className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Отметить прочитанным</TooltipContent>
                      </Tooltip>
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className={cn("h-8 w-8 rounded-lg", selectedDialog.is_favorite && "text-amber-500")}
                          onClick={() => togglePrefMutation.mutate({ contactUserId: selectedUserId, field: "is_favorite", value: !selectedDialog.is_favorite })}
                        >
                          <Star className={cn("h-4 w-4", selectedDialog.is_favorite && "fill-amber-500")} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{selectedDialog.is_favorite ? "Убрать из избранного" : "В избранное"}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className={cn("h-8 w-8 rounded-lg", selectedDialog.is_pinned && "text-amber-500")}
                          onClick={() => togglePrefMutation.mutate({ contactUserId: selectedUserId, field: "is_pinned", value: !selectedDialog.is_pinned })}
                        >
                          <Pin className={cn("h-4 w-4", selectedDialog.is_pinned && "fill-amber-500")} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{selectedDialog.is_pinned ? "Открепить" : "Закрепить"}</TooltipContent>
                    </Tooltip>
                  </div>
                </div>

                {/* Chat Content */}
                <div className="flex-1 p-4 overflow-hidden min-w-0">
                  <ContactTelegramChat 
                    userId={selectedUserId} 
                    telegramUserId={selectedDialog.profile?.telegram_user_id || null}
                    telegramUsername={selectedDialog.profile?.telegram_username || null}
                    clientName={selectedDialog.profile?.full_name}
                    avatarUrl={selectedDialog.profile?.avatar_url}
                    onAvatarUpdated={() => refetch()}
                    hidePhotoButton
                  />
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center mb-6 shadow-inner">
                  <MessageSquare className="h-10 w-10 text-primary/40" />
                </div>
                <p className="text-base font-medium text-foreground">Выберите чат</p>
                <p className="text-sm text-center mt-1">для просмотра переписки</p>
              </div>
            )}
          </div>
        </div>
      </TooltipProvider>
    </AdminLayout>
  );
}
