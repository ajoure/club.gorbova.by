import { useState } from "react";
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

  // Find matching mapping
  const matchedMapping = mappings.find(m => 
    m.bepaid_plan_title === item.product_name ||
    m.bepaid_description === item.product_name
  );

  const handleOpen = () => {
    if (matchedMapping) {
      setSelectedProductId(matchedMapping.product_id || "");
      setSelectedTariffId(matchedMapping.tariff_id || "");
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
      offerId: matchedMapping?.offer_id || undefined,
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
            <div className="bg-muted/50 p-3 rounded-lg space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Клиент:</span>
                <span className="font-medium">{item.matched_profile_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Сумма:</span>
                <span className="font-medium">{item.amount ? item.amount / 100 : 0} {item.currency}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Продукт bePaid:</span>
                <span className="font-medium">{item.product_name || "—"}</span>
              </div>
              {matchedMapping && (
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Найден маппинг:</span>
                  <Badge variant="default">{matchedMapping.product_name || "Настроен"}</Badge>
                </div>
              )}
            </div>

            {!matchedMapping && (
              <>
                <div className="space-y-2">
                  <Label>Продукт в системе</Label>
                  <Select value={selectedProductId} onValueChange={setSelectedProductId}>
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
                    <Label>Тариф</Label>
                    <Select value={selectedTariffId} onValueChange={setSelectedTariffId}>
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
              </>
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
