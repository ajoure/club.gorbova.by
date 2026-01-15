import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { 
  Loader2, 
  Package, 
  CreditCard, 
  Calendar as CalendarIcon, 
  User, 
  ExternalLink,
  Sparkles,
  Tag,
  RefreshCw,
  Ghost,
  UserPlus,
  X
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface EditDealDialogProps {
  deal: any | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

const STATUS_OPTIONS = [
  { value: "draft", label: "Черновик", color: "bg-muted" },
  { value: "pending", label: "Ожидает оплаты", color: "bg-amber-500/20" },
  { value: "paid", label: "Оплачен", color: "bg-green-500/20" },
  { value: "partial", label: "Частично оплачен", color: "bg-blue-500/20" },
  { value: "cancelled", label: "Отменён", color: "bg-red-500/20" },
  { value: "refunded", label: "Возврат", color: "bg-red-500/20" },
  { value: "expired", label: "Истёк", color: "bg-muted" },
];

export function EditDealDialog({ deal, open, onOpenChange, onSuccess }: EditDealDialogProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    status: "",
    final_price: "",
    product_id: "",
    tariff_id: "",
    offer_id: "",
    access_start_at: null as Date | null,
    access_end_at: null as Date | null,
    next_charge_at: null as Date | null,
    auto_renew: false,
    profile_id: "" as string | null,
    user_id: "" as string | null,
  });
  const [showContactSearch, setShowContactSearch] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Load products
  const { data: products } = useQuery({
    queryKey: ["products-for-edit"],
    queryFn: async () => {
      const { data } = await supabase.from("products_v2").select("id, name, code").order("name");
      return data || [];
    },
    enabled: open,
  });

  // Load tariffs for selected product
  const { data: tariffs } = useQuery({
    queryKey: ["tariffs-for-edit", formData.product_id],
    queryFn: async () => {
      if (!formData.product_id) return [];
      const { data } = await supabase.from("tariffs").select("id, name, code, access_days").eq("product_id", formData.product_id).order("name");
      return data || [];
    },
    enabled: !!formData.product_id,
  });

  // Load offers for selected tariff
  const { data: offers } = useQuery({
    queryKey: ["offers-for-edit", formData.tariff_id],
    queryFn: async () => {
      if (!formData.tariff_id) return [];
      const { data } = await supabase
        .from("tariff_offers")
        .select("id, offer_type, button_label, amount, trial_days, is_active")
        .eq("tariff_id", formData.tariff_id)
        .order("sort_order");
      return data || [];
    },
    enabled: !!formData.tariff_id,
  });

  // Load subscription for this deal
  const { data: subscription } = useQuery({
    queryKey: ["deal-subscription-edit", deal?.id],
    queryFn: async () => {
      if (!deal?.id) return null;
      const { data } = await supabase
        .from("subscriptions_v2")
        .select("*")
        .eq("order_id", deal.id)
        .maybeSingle();
      return data;
    },
    enabled: !!deal?.id && open,
  });

  // Load profile info for display
  const { data: profile } = useQuery({
    queryKey: ["deal-profile-edit", deal?.user_id],
    queryFn: async () => {
      if (!deal?.user_id) return null;
      const { data } = await supabase
        .from("profiles")
        .select("id, user_id, full_name, email, avatar_url")
        .or(`user_id.eq.${deal.user_id},id.eq.${deal.user_id}`)
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!deal?.user_id && open,
  });

  useEffect(() => {
    if (deal) {
      setFormData({
        status: deal.status || "",
        final_price: String(deal.final_price || ""),
        product_id: deal.product_id || "",
        tariff_id: deal.tariff_id || "",
        offer_id: deal.offer_id || "",
        access_start_at: subscription?.access_start_at ? new Date(subscription.access_start_at) : null,
        access_end_at: subscription?.access_end_at ? new Date(subscription.access_end_at) : null,
        next_charge_at: subscription?.next_charge_at ? new Date(subscription.next_charge_at) : null,
        auto_renew: subscription?.auto_renew ?? false,
        profile_id: deal.profile_id || profile?.id || null,
        user_id: deal.user_id || profile?.user_id || null,
      });
      setShowContactSearch(false);
      setContactSearch("");
      setSearchResults([]);
    }
  }, [deal, subscription, profile]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!deal?.id) throw new Error("No deal ID");
      
      const previousStatus = deal.status;
      const newStatus = formData.status;

      // 1. Update orders_v2
      const { error: orderError } = await supabase
        .from("orders_v2")
        .update({
          status: formData.status as any,
          final_price: parseFloat(formData.final_price) || 0,
          base_price: parseFloat(formData.final_price) || 0,
          product_id: formData.product_id || null,
          tariff_id: formData.tariff_id || null,
          offer_id: formData.offer_id || null,
          profile_id: formData.profile_id || null,
          user_id: formData.user_id || deal.user_id,
        })
        .eq("id", deal.id);
      
      if (orderError) throw orderError;

      // 2. Update subscription dates if they changed
      if (subscription) {
        const subscriptionUpdate: any = {
          auto_renew: formData.auto_renew,
        };
        
        if (formData.access_start_at) {
          subscriptionUpdate.access_start_at = formData.access_start_at.toISOString();
        }
        if (formData.access_end_at) {
          subscriptionUpdate.access_end_at = formData.access_end_at.toISOString();
        }
        if (formData.next_charge_at) {
          subscriptionUpdate.next_charge_at = formData.next_charge_at.toISOString();
        } else if (!formData.auto_renew) {
          // If auto-renew is disabled and no next_charge_at, clear it
          subscriptionUpdate.next_charge_at = null;
        }
        if (formData.tariff_id) {
          subscriptionUpdate.tariff_id = formData.tariff_id;
        }
        if (formData.offer_id) {
          subscriptionUpdate.offer_id = formData.offer_id;
        }

        // If enabling auto-renew, make sure status is active
        if (formData.auto_renew && subscription.status === 'canceled') {
          subscriptionUpdate.status = 'active';
          subscriptionUpdate.canceled_at = null;
          subscriptionUpdate.cancel_reason = null;
        }
        
        await supabase
          .from("subscriptions_v2")
          .update(subscriptionUpdate)
          .eq("order_id", deal.id);
      }

      // 3. Update entitlements based on status and dates
      const product = products?.find(p => p.id === formData.product_id);
      const productCode = product?.code || 'club';

      if (newStatus === 'paid' && deal.user_id) {
        // Create or update entitlement
        await supabase.from('entitlements').upsert({
          user_id: deal.user_id,
          profile_id: deal.profile_id,
          order_id: deal.id,
          product_code: productCode,
          status: 'active',
          expires_at: formData.access_end_at?.toISOString() || subscription?.access_end_at,
          meta: { source: 'admin_edit', tariff_id: formData.tariff_id }
        }, { onConflict: 'user_id,product_code' });
      }

      // 4. Handle status change to cancelled/refunded - check for other active deals before revoking
      if (['cancelled', 'refunded'].includes(newStatus) && previousStatus === 'paid' && deal.user_id) {
        // Check if user has other active deals with same product
        const { count: otherActiveDeals } = await supabase
          .from('orders_v2')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', deal.user_id)
          .eq('product_id', formData.product_id)
          .eq('status', 'paid')
          .neq('id', deal.id);

        // Check for other active subscriptions
        const { count: activeSubscriptions } = await supabase
          .from('subscriptions_v2')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', deal.user_id)
          .eq('product_id', formData.product_id)
          .in('status', ['active', 'trial'])
          .neq('order_id', deal.id);

        // Only revoke if no other active deals/subscriptions
        if (!otherActiveDeals && !activeSubscriptions) {
          // Delete entitlement
          await supabase
            .from('entitlements')
            .delete()
            .eq('user_id', deal.user_id)
            .eq('product_code', productCode);

          // Revoke Telegram access if product has telegram_club_id
          if (product) {
            const { data: productData } = await supabase
              .from('products_v2')
              .select('telegram_club_id')
              .eq('id', formData.product_id)
              .single();
            
            if (productData?.telegram_club_id) {
              await supabase.functions.invoke('telegram-revoke-access', {
                body: { 
                  user_id: deal.user_id, 
                  club_id: productData.telegram_club_id,
                  reason: 'deal_status_changed'
                }
              }).catch(console.error);
            }
          }
        }
      }
    },
    onSuccess: () => {
      toast.success("Сделка обновлена");
      queryClient.invalidateQueries({ queryKey: ["admin-deals"] });
      queryClient.invalidateQueries({ queryKey: ["deal-payments"] });
      queryClient.invalidateQueries({ queryKey: ["deal-subscription"] });
      queryClient.invalidateQueries({ queryKey: ["admin-entitlements"] });
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error) => {
      toast.error("Ошибка: " + (error as Error).message);
    },
  });

  const handleOpenContact = () => {
    const contactId = formData.profile_id || profile?.user_id || deal?.user_id;
    if (contactId) {
      onOpenChange(false);
      navigate(`/admin/contacts?contact=${contactId}&from=deals`);
    }
  };

  // Search contacts for linking
  const handleContactSearch = async (query: string) => {
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }
    
    setSearchLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-search-profiles', {
        body: { query, limit: 20, include_ghosts: true }
      });
      
      if (error) throw error;
      setSearchResults(data?.results || []);
    } catch (e) {
      console.error('Contact search error:', e);
    } finally {
      setSearchLoading(false);
    }
  };

  // Get selected profile info
  const selectedProfile = searchResults.find(p => p.id === formData.profile_id) || profile;

  if (!deal) return null;

  const selectedOffer = offers?.find(o => o.id === formData.offer_id);
  const currentProfile = selectedProfile || profile;
  const isGhost = currentProfile && !currentProfile.user_id;
  const displayName = currentProfile?.full_name || deal.customer_email || "Не привязан";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden border-0 shadow-2xl">
        {/* Glass Header */}
        <div className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-primary/10 to-transparent" />
          <div className="absolute inset-0 backdrop-blur-3xl" />
          <DialogHeader className="relative p-6 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-lg shadow-primary/25">
                <Sparkles className="w-6 h-6 text-primary-foreground" />
              </div>
              <div>
                <DialogTitle className="text-xl font-semibold">
                  Сделка #{deal.order_number}
                </DialogTitle>
                <p className="text-sm text-muted-foreground">
                  Редактирование параметров
                </p>
              </div>
            </div>
          </DialogHeader>
        </div>

        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          {/* Product & Tariff Section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Package className="w-4 h-4" />
              Продукт и тариф
            </div>
            
            <div className="grid gap-4 p-4 rounded-2xl bg-muted/30 border border-border/50">
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Продукт</Label>
                <Select 
                  value={formData.product_id} 
                  onValueChange={(v) => setFormData(prev => ({ ...prev, product_id: v, tariff_id: "", offer_id: "" }))}
                >
                  <SelectTrigger className="bg-background/80 border-border/50">
                    <SelectValue placeholder="Выберите продукт" />
                  </SelectTrigger>
                  <SelectContent>
                    {products?.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Тариф</Label>
                <Select 
                  value={formData.tariff_id} 
                  onValueChange={(v) => setFormData(prev => ({ ...prev, tariff_id: v, offer_id: "" }))}
                  disabled={!formData.product_id}
                >
                  <SelectTrigger className="bg-background/80 border-border/50">
                    <SelectValue placeholder="Выберите тариф" />
                  </SelectTrigger>
              <SelectContent>
                {tariffs?.map((t: any) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Кнопка оплаты</Label>
                <Select 
                  value={formData.offer_id} 
                  onValueChange={(v) => {
                    const offer = offers?.find(o => o.id === v);
                    setFormData(prev => ({ 
                      ...prev, 
                      offer_id: v,
                      final_price: offer ? String(offer.amount) : prev.final_price
                    }));
                  }}
                  disabled={!formData.tariff_id}
                >
                  <SelectTrigger className="bg-background/80 border-border/50">
                    <SelectValue placeholder="Выберите оффер" />
                  </SelectTrigger>
                  <SelectContent>
                    {offers?.map(o => (
                      <SelectItem key={o.id} value={o.id}>
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "w-2 h-2 rounded-full",
                            o.offer_type === 'trial' ? "bg-blue-500" : "bg-green-500"
                          )} />
                          <span>{o.button_label}</span>
                          <span className="text-muted-foreground">• {o.amount} BYN</span>
                          {o.trial_days && (
                            <span className="text-xs text-blue-600">({o.trial_days} дней)</span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Price & Status Section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <CreditCard className="w-4 h-4" />
              Оплата
            </div>
            
            <div className="grid gap-4 sm:grid-cols-2 p-4 rounded-2xl bg-muted/30 border border-border/50">
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Цена</Label>
                <div className="relative">
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.final_price}
                    onChange={(e) => setFormData(prev => ({ ...prev, final_price: e.target.value }))}
                    className="bg-background/80 border-border/50 pr-14"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    BYN
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Статус</Label>
                <Select value={formData.status} onValueChange={(v) => setFormData(prev => ({ ...prev, status: v }))}>
                  <SelectTrigger className="bg-background/80 border-border/50">
                    <SelectValue placeholder="Выберите статус" />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>
                        <div className="flex items-center gap-2">
                          <span className={cn("w-2 h-2 rounded-full", opt.color)} />
                          {opt.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Dates Section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <CalendarIcon className="w-4 h-4" />
              Период доступа
            </div>
            
            <div className="grid gap-4 p-4 rounded-2xl bg-muted/30 border border-border/50">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">Начало доступа</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal bg-background/80 border-border/50",
                          !formData.access_start_at && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {formData.access_start_at ? format(formData.access_start_at, "dd.MM.yyyy", { locale: ru }) : "Выберите"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={formData.access_start_at || undefined}
                        onSelect={(date) => setFormData(prev => ({ ...prev, access_start_at: date || null }))}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">Конец доступа</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal bg-background/80 border-border/50",
                          !formData.access_end_at && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {formData.access_end_at ? format(formData.access_end_at, "dd.MM.yyyy", { locale: ru }) : "Выберите"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={formData.access_end_at || undefined}
                        onSelect={(date) => setFormData(prev => ({ ...prev, access_end_at: date || null }))}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              {/* Auto-renew toggle */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-background/60 border border-border/30">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center",
                    formData.auto_renew ? "bg-green-500/20" : "bg-muted"
                  )}>
                    <RefreshCw className={cn(
                      "w-4 h-4",
                      formData.auto_renew ? "text-green-600" : "text-muted-foreground"
                    )} />
                  </div>
                  <div>
                    <Label className="text-sm font-medium">Автопродление</Label>
                    <p className="text-xs text-muted-foreground">
                      {formData.auto_renew ? "Включено - карта будет списываться автоматически" : "Отключено"}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={formData.auto_renew}
                  onCheckedChange={(checked) => setFormData(prev => ({ 
                    ...prev, 
                    auto_renew: checked,
                    // If enabling and no next_charge_at, set to access_end_at
                    next_charge_at: checked && !prev.next_charge_at ? prev.access_end_at : prev.next_charge_at
                  }))}
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Следующее списание</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      disabled={!formData.auto_renew}
                      className={cn(
                        "w-full justify-start text-left font-normal bg-background/80 border-border/50",
                        !formData.next_charge_at && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {formData.next_charge_at ? format(formData.next_charge_at, "dd.MM.yyyy", { locale: ru }) : "Не задано"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={formData.next_charge_at || undefined}
                      onSelect={(date) => setFormData(prev => ({ ...prev, next_charge_at: date || null }))}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                {formData.auto_renew && !subscription?.payment_token && (
                  <p className="text-xs text-amber-600">
                    ⚠️ У клиента нет привязанной карты. Автосписание не будет работать.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Client Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <User className="w-4 h-4" />
                Клиент
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowContactSearch(!showContactSearch)}
                className="h-7 text-xs"
              >
                <UserPlus className="w-3 h-3 mr-1" />
                {showContactSearch ? "Скрыть" : "Изменить"}
              </Button>
            </div>
            
            {/* Current linked contact */}
            {!showContactSearch && (
              <button
                type="button"
                onClick={handleOpenContact}
                disabled={!currentProfile}
                className={cn(
                  "w-full p-4 rounded-2xl border transition-all",
                  "bg-gradient-to-r from-muted/50 to-muted/30 border-border/50",
                  currentProfile && "hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 cursor-pointer"
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10 ring-2 ring-background">
                      <AvatarImage src={currentProfile?.avatar_url} alt={displayName} />
                      <AvatarFallback className={cn(
                        "text-primary",
                        isGhost ? "bg-muted" : "bg-primary/10"
                      )}>
                        {isGhost ? <Ghost className="w-5 h-5 text-muted-foreground" /> : <User className="w-5 h-5" />}
                      </AvatarFallback>
                    </Avatar>
                    <div className="text-left">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{displayName}</span>
                        {isGhost && (
                          <Badge variant="outline" className="text-[10px]">Ghost</Badge>
                        )}
                      </div>
                      {currentProfile?.email && currentProfile.email !== displayName && (
                        <div className="text-sm text-muted-foreground">{currentProfile.email}</div>
                      )}
                    </div>
                  </div>
                  {currentProfile && (
                    <ExternalLink className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
              </button>
            )}

            {/* Contact search */}
            {showContactSearch && (
              <div className="space-y-3 p-4 rounded-2xl bg-muted/30 border border-border/50">
                <div className="relative">
                  <Input
                    placeholder="Поиск по имени, email или телефону..."
                    value={contactSearch}
                    onChange={(e) => {
                      setContactSearch(e.target.value);
                      handleContactSearch(e.target.value);
                    }}
                    className="bg-background/80"
                  />
                  {searchLoading && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
                  )}
                </div>
                
                {searchResults.length > 0 && (
                  <ScrollArea className="max-h-[200px]">
                    <div className="space-y-1">
                      {searchResults.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setFormData(prev => ({ 
                              ...prev, 
                              profile_id: p.id,
                              user_id: p.user_id || null 
                            }));
                            setShowContactSearch(false);
                          }}
                          className={cn(
                            "w-full p-2 rounded-lg text-left transition-colors flex items-center gap-2",
                            formData.profile_id === p.id
                              ? "bg-primary/10 border border-primary" 
                              : "hover:bg-muted"
                          )}
                        >
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className={!p.user_id ? "bg-muted" : "bg-primary/10"}>
                              {!p.user_id ? <Ghost className="w-4 h-4 text-muted-foreground" /> : <User className="w-4 h-4 text-primary" />}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium truncate">{p.full_name || "Без имени"}</span>
                              {!p.user_id && (
                                <Badge variant="outline" className="text-[10px] shrink-0">Ghost</Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {p.email || p.phone || "—"}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                )}
                
                {contactSearch.length >= 2 && searchResults.length === 0 && !searchLoading && (
                  <p className="text-xs text-muted-foreground text-center py-2">
                    Контакты не найдены
                  </p>
                )}

                {formData.profile_id && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setFormData(prev => ({ ...prev, profile_id: null, user_id: null }))}
                    className="w-full gap-1"
                  >
                    <X className="w-3 h-3" />
                    Отвязать контакт
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <DialogFooter className="p-6 pt-4 border-t bg-muted/20">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1 sm:flex-none">
            Отмена
          </Button>
          <Button 
            onClick={() => updateMutation.mutate()} 
            disabled={updateMutation.isPending}
            className="flex-1 sm:flex-none bg-gradient-to-r from-primary to-primary/80 shadow-lg shadow-primary/25"
          >
            {updateMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Сохранить изменения
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
