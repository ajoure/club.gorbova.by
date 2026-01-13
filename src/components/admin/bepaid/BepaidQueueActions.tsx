import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ShoppingCart, User, RefreshCw, Search } from "lucide-react";
import { useBepaidQueueActions } from "@/hooks/useBepaidMappings";
import { useBepaidMappings } from "@/hooks/useBepaidMappings";
import { useProductsV2, useTariffs } from "@/hooks/useProductsV2";
import { useTariffOffers } from "@/hooks/useTariffOffers";
import { QueueItem } from "@/hooks/useBepaidData";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

interface BepaidQueueActionsProps {
  item: QueueItem;
  onSuccess?: () => void;
  onLinkProfile?: (profile: { id: string; full_name: string | null; phone: string | null }) => void;
}

export function CreateOrderButton({ item, onSuccess }: BepaidQueueActionsProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { createOrderFromQueue, isCreatingOrder } = useBepaidQueueActions();
  const { mappings } = useBepaidMappings();
  const { data: products } = useProductsV2();
  const { data: allTariffs } = useTariffs();
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [selectedTariffId, setSelectedTariffId] = useState<string>("");
  const [selectedOfferId, setSelectedOfferId] = useState<string>("");

  // Fetch all offers for selected tariff (including inactive ones)
  const { data: tariffOffers } = useQuery({
    queryKey: ["tariff-offers-all", selectedTariffId],
    queryFn: async () => {
      if (!selectedTariffId) return [];
      const { data, error } = await supabase
        .from("tariff_offers")
        .select("id, offer_type, button_label, amount, is_active")
        .eq("tariff_id", selectedTariffId)
        .order("sort_order");
      if (error) throw error;
      return data || [];
    },
    enabled: !!selectedTariffId,
  });

  // Find matching mapping - check product_name, description, and fuzzy match
  const matchedMapping = mappings.find(m => {
    // Exact match on product_name
    if (m.bepaid_plan_title === item.product_name || m.bepaid_description === item.product_name) {
      return true;
    }
    // Fuzzy match on description
    if (item.description) {
      const descLower = item.description.toLowerCase();
      const titleLower = (m.bepaid_plan_title || '').toLowerCase();
      const mappingDescLower = (m.bepaid_description || '').toLowerCase();
      
      // Check for tariff type matches
      if (descLower.includes('триал') || descLower.includes('trial')) {
        if (titleLower.includes('trial')) return true;
      }
      if (descLower.includes('chat') || descLower.includes('чат')) {
        if (titleLower.includes('chat') || mappingDescLower.includes('chat')) return true;
      }
      if (descLower.includes('итоги') || descLower.includes('full')) {
        if (titleLower.includes('full') || mappingDescLower.includes('full')) return true;
      }
      if (descLower.includes('business') || descLower.includes('бизнес')) {
        if (titleLower.includes('business') || mappingDescLower.includes('business')) return true;
      }
    }
    return false;
  });

  // Auto-select offer based on payment amount
  useEffect(() => {
    if (tariffOffers && tariffOffers.length > 0 && item.amount) {
      // If amount <= 10 and there's a trial offer, select trial
      const trialOffer = tariffOffers.find(o => o.offer_type === "trial");
      const payNowOffer = tariffOffers.find(o => o.offer_type === "pay_now" && o.is_active);
      
      if (item.amount <= 10 && trialOffer) {
        setSelectedOfferId(trialOffer.id);
      } else if (payNowOffer) {
        setSelectedOfferId(payNowOffer.id);
      } else if (tariffOffers.length > 0) {
        setSelectedOfferId(tariffOffers[0].id);
      }
    }
  }, [tariffOffers, item.amount]);

  const handleOpen = () => {
    if (matchedMapping) {
      setSelectedProductId(matchedMapping.product_id || "");
      setSelectedTariffId(matchedMapping.tariff_id || "");
      setSelectedOfferId(matchedMapping.offer_id || "");
    }
    setDialogOpen(true);
  };

  const handleCreate = () => {
    if (!item.matched_profile_id) {
      toast.error("Сначала свяжите с контактом");
      return;
    }

    createOrderFromQueue({
      queueItemId: item.id,
      profileId: item.matched_profile_id,
      productId: selectedProductId || matchedMapping?.product_id || undefined,
      tariffId: selectedTariffId || matchedMapping?.tariff_id || undefined,
      offerId: selectedOfferId || matchedMapping?.offer_id || undefined,
    }, {
      onSuccess: () => {
        setDialogOpen(false);
        onSuccess?.();
      },
    });
  };

  if (!item.matched_profile_id) {
    return (
      <Button variant="ghost" size="sm" disabled className="text-muted-foreground">
        <ShoppingCart className="h-4 w-4 mr-1" />
        Нет контакта
      </Button>
    );
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={handleOpen} disabled={isCreatingOrder}>
        <ShoppingCart className="h-4 w-4 mr-1" />
        Создать сделку
      </Button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>Создать сделку</DialogTitle>
            <DialogDescription>
              Создать заказ и платёж из записи очереди bePaid
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Customer data from bePaid */}
            <div className="bg-muted/50 p-3 rounded-lg space-y-2 text-sm">
              <div className="font-medium text-xs uppercase text-muted-foreground mb-2">Данные из bePaid</div>
              
              {/* Name from card_holder (always available in file imports) */}
              {item.card_holder && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Владелец карты:</span>
                  <span className="font-medium">{item.card_holder}</span>
                </div>
              )}
              
              {/* Customer name if different from card_holder */}
              {(item.customer_name || item.customer_surname) && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ФИО клиента:</span>
                  <span className="font-medium">
                    {[item.customer_name, item.customer_surname].filter(Boolean).join(" ")}
                  </span>
                </div>
              )}
              
              {item.customer_email && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Email:</span>
                  <span className="font-medium">{item.customer_email}</span>
                </div>
              )}
              
              {item.customer_phone && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Телефон:</span>
                  <span className="font-medium">{item.customer_phone}</span>
                </div>
              )}
              
              {item.ip_address && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">IP адрес:</span>
                  <span className="font-mono text-xs">{item.ip_address}</span>
                </div>
              )}
              
              <div className="flex justify-between">
                <span className="text-muted-foreground">Дата платежа:</span>
                <span className="font-medium">
                  {item.paid_at ? new Date(item.paid_at).toLocaleString("ru-RU") : new Date(item.created_at).toLocaleString("ru-RU")}
                </span>
              </div>
              
              {item.description && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Описание:</span>
                  <span className="font-medium text-xs max-w-[200px] truncate" title={item.description}>
                    {item.description}
                  </span>
                </div>
              )}
            </div>

            {/* Deal info */}
            <div className="bg-muted/50 p-3 rounded-lg space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Связанный контакт:</span>
                <span className="font-medium">{item.matched_profile_name || "Не связан"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Сумма:</span>
                <span className="font-medium">{item.amount ? item.amount.toFixed(2) : "0.00"} {item.currency}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Продукт (определён):</span>
                <span className="font-medium">{item.product_name || item.description?.slice(0, 30) || "—"}</span>
              </div>
              {matchedMapping ? (
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Маппинг:</span>
                  <Badge variant="default">{matchedMapping.bepaid_plan_title || "Настроен"}</Badge>
                </div>
              ) : (
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Маппинг:</span>
                  <Badge variant="outline" className="text-amber-600">Не найден</Badge>
                </div>
              )}
            </div>

            {/* Always show product/tariff selection for manual override */}
            <div className="space-y-2">
              <Label>Продукт в системе {matchedMapping && <span className="text-muted-foreground text-xs">(авто: {matchedMapping.product_name})</span>}</Label>
              <Select value={selectedProductId} onValueChange={(v) => { setSelectedProductId(v); setSelectedTariffId(""); setSelectedOfferId(""); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите продукт" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Без продукта</SelectItem>
                  {products?.map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedProductId && selectedProductId !== "__none__" && allTariffs && allTariffs.filter(t => t.product_id === selectedProductId).length > 0 && (
              <div className="space-y-2">
                <Label>Тариф {matchedMapping?.tariff_name && <span className="text-muted-foreground text-xs">(авто: {matchedMapping.tariff_name})</span>}</Label>
                <Select value={selectedTariffId} onValueChange={(v) => { setSelectedTariffId(v); setSelectedOfferId(""); }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите тариф" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Без тарифа</SelectItem>
                    {allTariffs.filter(t => t.product_id === selectedProductId).map((tariff) => (
                      <SelectItem key={tariff.id} value={tariff.id}>
                        {tariff.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Offer selection - always show if tariff is selected */}
            {(selectedTariffId || matchedMapping?.tariff_id) && (selectedTariffId !== "__none__") && (
              <div className="space-y-2">
                <Label>Оффер (кнопка оплаты)</Label>
                <Select value={selectedOfferId} onValueChange={setSelectedOfferId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите оффер" />
                  </SelectTrigger>
                  <SelectContent>
                    {tariffOffers?.map((offer) => (
                      <SelectItem key={offer.id} value={offer.id}>
                        {offer.offer_type === "trial" ? "🎁 " : "💳 "}
                        {offer.button_label} ({offer.amount} BYN)
                        {!offer.is_active && " (неактивен)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Выбранный оффер определяет getcourse_offer_id для интеграции
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Отмена
            </Button>
            <Button onClick={handleCreate} disabled={isCreatingOrder}>
              {isCreatingOrder && <RefreshCw className="h-4 w-4 animate-spin mr-2" />}
              Создать сделку
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function LinkToProfileButton({ item, onSuccess, onLinkProfile }: BepaidQueueActionsProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [isLinking, setIsLinking] = useState(false);

  // Search profiles
  const { data: searchResults, isLoading: searching } = useQuery({
    queryKey: ["profile-search", search],
    queryFn: async () => {
      if (search.length < 2) return [];
      
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, phone")
        .or(`full_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`)
        .limit(10);

      if (error) throw error;
      return data || [];
    },
    enabled: search.length >= 2,
  });

  const handleLink = (profile: { id: string; full_name: string | null; phone: string | null }) => {
    setIsLinking(true);
    if (onLinkProfile) {
      onLinkProfile(profile);
    }
    setDialogOpen(false);
    setIsLinking(false);
    onSuccess?.();
  };

  if (item.matched_profile_id) {
    return null;
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
        <User className="h-4 w-4 mr-1" />
        Связать
      </Button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Связать с контактом</DialogTitle>
            <DialogDescription>
              Найдите контакт для связи с этим платежом
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="bg-muted/50 p-3 rounded-lg space-y-1 text-sm">
              {item.card_holder && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Владелец карты:</span>
                  <span className="font-medium">{item.card_holder}</span>
                </div>
              )}
              {item.customer_email && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Email bePaid:</span>
                  <span className="font-medium">{item.customer_email}</span>
                </div>
              )}
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Поиск по имени, email или телефону..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>

            {searching && (
              <div className="flex items-center justify-center py-4">
                <RefreshCw className="h-4 w-4 animate-spin" />
              </div>
            )}

            {searchResults && searchResults.length > 0 && (
              <ScrollArea className="max-h-[200px]">
                <div className="space-y-2">
                  {searchResults.map((profile) => (
                    <div
                      key={profile.id}
                      className="flex items-center justify-between p-2 rounded-lg border hover:bg-accent/50 cursor-pointer"
                      onClick={() => handleLink(profile)}
                    >
                      <div>
                        <p className="font-medium">{profile.full_name || "Без имени"}</p>
                        <p className="text-sm text-muted-foreground">{profile.email}</p>
                      </div>
                      <Button variant="ghost" size="sm" disabled={isLinking}>
                        Выбрать
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}

            {search.length >= 2 && searchResults?.length === 0 && !searching && (
              <p className="text-center text-muted-foreground py-4">Ничего не найдено</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface BulkActionsProps {
  selectedItems: QueueItem[];
  onSuccess?: () => void;
}

export function BulkProcessButton({ selectedItems, onSuccess }: BulkActionsProps) {
  const { bulkProcess, isBulkProcessing } = useBepaidQueueActions();
  const { mappings } = useBepaidMappings();

  const processableItems = selectedItems.filter(item => 
    item.matched_profile_id && 
    mappings.some(m => m.bepaid_plan_title === item.product_name)
  );

  const handleBulkProcess = () => {
    const items = processableItems.map(item => {
      const mapping = mappings.find(m => m.bepaid_plan_title === item.product_name);
      return {
        queueItemId: item.id,
        profileId: item.matched_profile_id!,
        productId: mapping?.product_id || undefined,
        tariffId: mapping?.tariff_id || undefined,
        offerId: mapping?.offer_id || undefined,
      };
    });

    bulkProcess(items, {
      onSuccess: () => onSuccess?.(),
    });
  };

  if (processableItems.length === 0) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        Выбрано: {selectedItems.length} (обработать: 0)
      </Badge>
    );
  }

  return (
    <Button onClick={handleBulkProcess} disabled={isBulkProcessing}>
      {isBulkProcessing && <RefreshCw className="h-4 w-4 animate-spin mr-2" />}
      <ShoppingCart className="h-4 w-4 mr-2" />
      Создать сделки ({processableItems.length})
    </Button>
  );
}
