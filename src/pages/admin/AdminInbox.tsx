import { useState, useEffect, useMemo } from "react";
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
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { format, formatDistanceToNow, isAfter, isBefore, startOfDay, endOfDay } from "date-fns";
import { ru } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

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
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "unread" | "read">("all");
  const [advancedFilters, setAdvancedFilters] = useState<Filters>(initialFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const hasActiveFilters = useMemo(() => {
    return (
      advancedFilters.dateFrom !== undefined ||
      advancedFilters.dateTo !== undefined ||
      advancedFilters.orderNumber !== "" ||
      advancedFilters.productId !== "" ||
      advancedFilters.hasActiveSubscription !== "all"
    );
  }, [advancedFilters]);

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
    queryKey: ["inbox-dialogs", filter],
    queryFn: async () => {
      // First get all unique user_ids from messages
      const { data: messages, error } = await supabase
        .from("telegram_messages")
        .select(`
          user_id,
          message_text,
          created_at,
          direction,
          is_read
        `)
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Group by user_id and get stats
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

      // Get profiles for all users
      const userIds = Array.from(dialogMap.keys());
      if (userIds.length === 0) return [];

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, user_id, full_name, email, phone, telegram_username, telegram_user_id, avatar_url")
        .in("user_id", userIds);

      // Fetch orders for all users
      const { data: orders } = await supabase
        .from("orders_v2")
        .select("id, user_id, order_number, status, products_v2(name)")
        .in("user_id", userIds);

      // Fetch subscriptions for all users
      const { data: subscriptions } = await supabase
        .from("subscriptions_v2")
        .select("id, user_id, status, products_v2(name)")
        .in("user_id", userIds);

      // Map by user_id
      const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);
      
      // Group orders by user_id
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

      // Group subscriptions by user_id
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

      // Combine and filter
      let result: Dialog[] = Array.from(dialogMap.values()).map(d => ({
        ...d,
        profile: profileMap.get(d.user_id) || null,
        orders: ordersMap.get(d.user_id) || [],
        subscriptions: subsMap.get(d.user_id) || [],
      }));

      // Apply filter
      if (filter === "unread") {
        result = result.filter(d => d.unread_count > 0);
      } else if (filter === "read") {
        result = result.filter(d => d.unread_count === 0);
      }

      // Sort by last message date
      result.sort((a, b) => 
        new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
      );

      return result;
    },
    refetchInterval: 30000,
  });

  // Get total unread count
  const totalUnread = dialogs.reduce((sum, d) => sum + d.unread_count, 0);

  // Mark messages as read when selecting a dialog
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

  // Handle dialog selection
  const handleSelectDialog = (userId: string) => {
    setSelectedUserId(userId);
    markAsRead.mutate(userId);
  };

  // Subscribe to realtime updates
  useEffect(() => {
    const channel = supabase
      .channel("inbox-messages")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "telegram_messages",
        },
        () => {
          refetch();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refetch]);

  // Filter dialogs by search and advanced filters
  const filteredDialogs = useMemo(() => {
    return dialogs.filter((dialog) => {
      // Text search
      if (searchQuery) {
        const search = searchQuery.toLowerCase();
        const matchesSearch = 
          dialog.profile?.full_name?.toLowerCase().includes(search) ||
          dialog.profile?.email?.toLowerCase().includes(search) ||
          dialog.profile?.phone?.toLowerCase().includes(search) ||
          dialog.profile?.telegram_username?.toLowerCase().includes(search) ||
          dialog.last_message?.toLowerCase().includes(search) ||
          dialog.orders?.some(o => o.order_number.toLowerCase().includes(search));
        
        if (!matchesSearch) return false;
      }

      // Date filters
      if (advancedFilters.dateFrom) {
        const msgDate = new Date(dialog.last_message_at);
        if (isBefore(msgDate, startOfDay(advancedFilters.dateFrom))) return false;
      }
      if (advancedFilters.dateTo) {
        const msgDate = new Date(dialog.last_message_at);
        if (isAfter(msgDate, endOfDay(advancedFilters.dateTo))) return false;
      }

      // Order number filter
      if (advancedFilters.orderNumber) {
        const hasOrder = dialog.orders?.some(o => 
          o.order_number.toLowerCase().includes(advancedFilters.orderNumber.toLowerCase())
        );
        if (!hasOrder) return false;
      }

      // Product filter
      if (advancedFilters.productId) {
        const hasProduct = 
          dialog.orders?.some(o => o.product_name) ||
          dialog.subscriptions?.some(s => s.product_name);
        // For now, we match by product name since we have names, not IDs
        // This could be improved by storing product_id in the query
        if (!hasProduct) return false;
      }

      // Active subscription filter
      if (advancedFilters.hasActiveSubscription === "yes") {
        const hasActive = dialog.subscriptions?.some(s => s.status === "active");
        if (!hasActive) return false;
      } else if (advancedFilters.hasActiveSubscription === "no") {
        const hasActive = dialog.subscriptions?.some(s => s.status === "active");
        if (hasActive) return false;
      }

      return true;
    });
  }, [dialogs, searchQuery, advancedFilters]);

  const selectedDialog = dialogs.find(d => d.user_id === selectedUserId);

  const clearFilters = () => {
    setAdvancedFilters(initialFilters);
  };

  return (
    <AdminLayout>
      <div className="flex h-[calc(100vh-8rem)] gap-4">
        {/* Dialog List */}
        <Card className={`${selectedUserId ? "hidden md:flex" : "flex"} flex-col w-full md:w-[420px] shrink-0 overflow-hidden`}>
          <CardHeader className="pb-3 space-y-3 shrink-0">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-primary" />
                Входящие
                {totalUnread > 0 && (
                  <Badge variant="destructive" className="animate-pulse">{totalUnread}</Badge>
                )}
              </CardTitle>
              <div className="flex items-center gap-1">
                <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
                  <SheetTrigger asChild>
                    <Button
                      variant={hasActiveFilters ? "default" : "ghost"}
                      size="icon"
                      className="relative"
                    >
                      <Filter className="h-4 w-4" />
                      {hasActiveFilters && (
                        <span className="absolute -top-1 -right-1 h-3 w-3 bg-primary rounded-full border-2 border-background" />
                      )}
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
                      {/* Date Range */}
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Период сообщений</Label>
                        <div className="grid grid-cols-2 gap-2">
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                className={cn(
                                  "justify-start text-left font-normal h-10",
                                  !advancedFilters.dateFrom && "text-muted-foreground"
                                )}
                              >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {advancedFilters.dateFrom 
                                  ? format(advancedFilters.dateFrom, "dd.MM.yyyy")
                                  : "От"
                                }
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={advancedFilters.dateFrom}
                                onSelect={(date) => setAdvancedFilters(f => ({ ...f, dateFrom: date }))}
                                locale={ru}
                              />
                            </PopoverContent>
                          </Popover>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                className={cn(
                                  "justify-start text-left font-normal h-10",
                                  !advancedFilters.dateTo && "text-muted-foreground"
                                )}
                              >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {advancedFilters.dateTo 
                                  ? format(advancedFilters.dateTo, "dd.MM.yyyy")
                                  : "До"
                                }
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={advancedFilters.dateTo}
                                onSelect={(date) => setAdvancedFilters(f => ({ ...f, dateTo: date }))}
                                locale={ru}
                              />
                            </PopoverContent>
                          </Popover>
                        </div>
                      </div>

                      {/* Order Number */}
                      <div className="space-y-2">
                        <Label className="text-sm font-medium flex items-center gap-2">
                          <Handshake className="h-4 w-4" />
                          Номер сделки
                        </Label>
                        <Input
                          placeholder="Например: ORD-25-00001"
                          value={advancedFilters.orderNumber}
                          onChange={(e) => setAdvancedFilters(f => ({ ...f, orderNumber: e.target.value }))}
                        />
                      </div>

                      {/* Product */}
                      <div className="space-y-2">
                        <Label className="text-sm font-medium flex items-center gap-2">
                          <Package className="h-4 w-4" />
                          Продукт
                        </Label>
                        <Select
                          value={advancedFilters.productId}
                          onValueChange={(v) => setAdvancedFilters(f => ({ ...f, productId: v }))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Любой продукт" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="">Любой продукт</SelectItem>
                            {products?.map(p => (
                              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Active Subscription */}
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Активная подписка</Label>
                        <Select
                          value={advancedFilters.hasActiveSubscription}
                          onValueChange={(v) => setAdvancedFilters(f => ({ ...f, hasActiveSubscription: v as any }))}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">Все</SelectItem>
                            <SelectItem value="yes">С активной подпиской</SelectItem>
                            <SelectItem value="no">Без активной подписки</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <Button 
                        className="w-full" 
                        onClick={() => setFiltersOpen(false)}
                      >
                        Применить фильтры
                      </Button>
                    </div>
                  </SheetContent>
                </Sheet>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => refetch()}
                  disabled={isLoading}
                >
                  <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </div>
            
            {/* Search - no autofocus to prevent mobile keyboard issue */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Поиск: имя, email, телефон, сделка..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                autoFocus={false}
                autoComplete="off"
              />
            </div>

            <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
              <TabsList className="w-full grid grid-cols-3">
                <TabsTrigger value="all" className="text-xs sm:text-sm">Все</TabsTrigger>
                <TabsTrigger value="unread" className="text-xs sm:text-sm gap-1">
                  Новые
                  {totalUnread > 0 && (
                    <Badge variant="secondary" className="h-5 min-w-5 px-1 text-xs">
                      {totalUnread}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="read" className="text-xs sm:text-sm">Прочитано</TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Active filters badges */}
            {hasActiveFilters && (
              <div className="flex flex-wrap gap-1.5">
                {advancedFilters.dateFrom && (
                  <Badge variant="secondary" className="gap-1 text-xs">
                    От: {format(advancedFilters.dateFrom, "dd.MM")}
                    <button onClick={() => setAdvancedFilters(f => ({ ...f, dateFrom: undefined }))}>
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                )}
                {advancedFilters.dateTo && (
                  <Badge variant="secondary" className="gap-1 text-xs">
                    До: {format(advancedFilters.dateTo, "dd.MM")}
                    <button onClick={() => setAdvancedFilters(f => ({ ...f, dateTo: undefined }))}>
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                )}
                {advancedFilters.orderNumber && (
                  <Badge variant="secondary" className="gap-1 text-xs">
                    Сделка: {advancedFilters.orderNumber}
                    <button onClick={() => setAdvancedFilters(f => ({ ...f, orderNumber: "" }))}>
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                )}
                {advancedFilters.hasActiveSubscription !== "all" && (
                  <Badge variant="secondary" className="gap-1 text-xs">
                    {advancedFilters.hasActiveSubscription === "yes" ? "С подпиской" : "Без подписки"}
                    <button onClick={() => setAdvancedFilters(f => ({ ...f, hasActiveSubscription: "all" }))}>
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                )}
              </div>
            )}
          </CardHeader>

          <CardContent className="flex-1 p-0 overflow-hidden">
            <ScrollArea className="h-full">
              {filteredDialogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  {filter === "unread" ? (
                    <>
                      <MailCheck className="h-12 w-12 mb-3 opacity-50" />
                      <p>Нет непрочитанных сообщений</p>
                    </>
                  ) : hasActiveFilters ? (
                    <>
                      <Filter className="h-12 w-12 mb-3 opacity-50" />
                      <p>Ничего не найдено</p>
                      <Button variant="link" onClick={clearFilters}>Сбросить фильтры</Button>
                    </>
                  ) : (
                    <>
                      <MailQuestion className="h-12 w-12 mb-3 opacity-50" />
                      <p>Нет сообщений</p>
                    </>
                  )}
                </div>
              ) : (
                <div className="divide-y">
                  {filteredDialogs.map((dialog) => (
                    <button
                      key={dialog.user_id}
                      onClick={() => handleSelectDialog(dialog.user_id)}
                      className={cn(
                        "w-full p-4 flex items-start gap-3 hover:bg-muted/50 transition-colors text-left group",
                        selectedUserId === dialog.user_id && "bg-primary/5 border-l-2 border-primary"
                      )}
                    >
                      <div className="relative">
                        <Avatar className="h-12 w-12 shrink-0 ring-2 ring-background shadow-sm">
                          {dialog.profile?.avatar_url && (
                            <AvatarImage src={dialog.profile.avatar_url} alt={dialog.profile.full_name || ""} />
                          )}
                          <AvatarFallback className="bg-gradient-to-br from-primary/20 to-primary/5 text-primary font-medium">
                            {dialog.profile?.full_name?.[0]?.toUpperCase() || 
                             dialog.profile?.telegram_username?.[0]?.toUpperCase() || 
                             "?"}
                          </AvatarFallback>
                        </Avatar>
                        {dialog.unread_count > 0 && (
                          <span className="absolute -top-1 -right-1 h-5 min-w-5 flex items-center justify-center bg-destructive text-destructive-foreground text-xs font-medium rounded-full px-1 ring-2 ring-background">
                            {dialog.unread_count}
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className={cn(
                            "font-medium truncate",
                            dialog.unread_count > 0 && "text-foreground"
                          )}>
                            {dialog.profile?.full_name || 
                             dialog.profile?.telegram_username || 
                             dialog.profile?.email || 
                             "Неизвестный"}
                          </span>
                          <span className="text-xs text-muted-foreground shrink-0">
                            {formatDistanceToNow(new Date(dialog.last_message_at), {
                              addSuffix: false,
                              locale: ru,
                            })}
                          </span>
                        </div>
                        <p className={cn(
                          "text-sm truncate mt-0.5",
                          dialog.unread_count > 0 ? "text-foreground font-medium" : "text-muted-foreground"
                        )}>
                          {dialog.last_message || "Нет сообщений"}
                        </p>
                        <div className="flex items-center gap-2 mt-1.5">
                          {dialog.profile?.telegram_username && (
                            <span className="text-xs text-muted-foreground">
                              @{dialog.profile.telegram_username}
                            </span>
                          )}
                          {dialog.orders && dialog.orders.length > 0 && (
                            <Badge variant="outline" className="text-xs h-5 px-1.5 gap-0.5">
                              <Handshake className="h-3 w-3" />
                              {dialog.orders.length}
                            </Badge>
                          )}
                          {dialog.subscriptions?.some(s => s.status === "active") && (
                            <Badge className="text-xs h-5 px-1.5 bg-green-500/20 text-green-700 hover:bg-green-500/30">
                              Активен
                            </Badge>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground/50 shrink-0 self-center opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Chat View */}
        <Card className={`${selectedUserId ? "flex" : "hidden md:flex"} flex-1 flex-col overflow-hidden`}>
          {selectedUserId && selectedDialog ? (
            <>
              <CardHeader className="border-b pb-3 shrink-0">
                <div className="flex items-center gap-3">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="md:hidden shrink-0"
                    onClick={() => setSelectedUserId(null)}
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </Button>
                  <Avatar className="h-11 w-11 ring-2 ring-background shadow-sm">
                    {selectedDialog.profile?.avatar_url && (
                      <AvatarImage src={selectedDialog.profile.avatar_url} alt={selectedDialog.profile.full_name || ""} />
                    )}
                    <AvatarFallback className="bg-gradient-to-br from-primary/20 to-primary/5 text-primary font-medium">
                      {selectedDialog.profile?.full_name?.[0]?.toUpperCase() || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base truncate">
                        {selectedDialog.profile?.full_name || 
                         selectedDialog.profile?.telegram_username || 
                         "Неизвестный"}
                      </CardTitle>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0"
                        onClick={() => {
                          navigate(`/admin/contacts?contact=${selectedUserId}`);
                        }}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    {selectedDialog.profile?.telegram_username && (
                      <p className="text-sm text-muted-foreground">
                        @{selectedDialog.profile.telegram_username}
                      </p>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex-1 p-4 overflow-hidden">
                <ContactTelegramChat 
                  userId={selectedUserId} 
                  telegramUserId={selectedDialog.profile?.telegram_user_id || null}
                  telegramUsername={selectedDialog.profile?.telegram_username || null}
                  clientName={selectedDialog.profile?.full_name}
                  avatarUrl={selectedDialog.profile?.avatar_url}
                  onAvatarUpdated={() => refetch()}
                />
              </CardContent>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8">
              <div className="w-24 h-24 rounded-full bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center mb-6">
                <MessageSquare className="h-12 w-12 text-primary/50" />
              </div>
              <p className="text-lg font-medium text-foreground">Выберите диалог</p>
              <p className="text-sm text-center mt-1">для просмотра переписки с клиентом</p>
            </div>
          )}
        </Card>
      </div>
    </AdminLayout>
  );
}