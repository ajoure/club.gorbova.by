import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import {
  AlertTriangle,
  CreditCard,
  RefreshCw,
  Package,
  CheckCircle,
} from "lucide-react";

interface NeedsMappingOrder {
  id: string;
  order_number: string;
  user_id: string | null;
  final_price: number;
  currency: string;
  created_at: string;
  meta: Record<string, any> | null;
  payments_v2: Array<{
    id: string;
    card_last4: string | null;
    card_brand: string | null;
    paid_at: string | null;
    provider_payment_id: string | null;
  }>;
}

export function NeedsMappingTabContent() {
  const queryClient = useQueryClient();
  const [selectedOrder, setSelectedOrder] = useState<NeedsMappingOrder | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [selectedTariffId, setSelectedTariffId] = useState<string>("");
  const [grantAccess, setGrantAccess] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Fetch needs_mapping orders
  const { data: orders, isLoading } = useQuery({
    queryKey: ["needs-mapping-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders_v2")
        .select(`
          id,
          order_number,
          user_id,
          final_price,
          currency,
          created_at,
          meta,
          payments_v2(id, card_last4, card_brand, paid_at, provider_payment_id)
        `)
        .eq("status", "needs_mapping")
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) throw error;
      return data as NeedsMappingOrder[];
    },
  });

  // Fetch products for mapping
  const { data: products } = useQuery({
    queryKey: ["products-for-mapping"],
    queryFn: async () => {
      const { data } = await supabase
        .from("products_v2")
        .select("id, name, code")
        .eq("is_active", true)
        .order("name");
      return data || [];
    },
  });

  // Fetch tariffs for selected product
  const { data: tariffs } = useQuery({
    queryKey: ["tariffs-for-mapping", selectedProductId],
    enabled: !!selectedProductId,
    queryFn: async () => {
      const { data } = await supabase
        .from("tariffs")
        .select("id, name, code")
        .eq("product_id", selectedProductId)
        .eq("is_active", true)
        .order("name");
      return data || [];
    },
  });

  // Mapping mutation
  const mapMutation = useMutation({
    mutationFn: async ({
      orderId,
      productId,
      tariffId,
      grantAccess,
    }: {
      orderId: string;
      productId: string;
      tariffId: string | null;
      grantAccess: boolean;
    }) => {
      const { data, error } = await supabase.functions.invoke("admin-map-order-product", {
        body: {
          order_id: orderId,
          product_id: productId,
          tariff_id: tariffId || null,
          grant_access: grantAccess,
          dry_run: false,
        },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success("Продукт успешно привязан к заказу");
      setIsDialogOpen(false);
      setSelectedOrder(null);
      setSelectedProductId("");
      setSelectedTariffId("");
      setGrantAccess(false);
      queryClient.invalidateQueries({ queryKey: ["needs-mapping-orders"] });
      queryClient.invalidateQueries({ queryKey: ["admin-deals"] });
    },
    onError: (error: Error) => {
      toast.error(`Ошибка маппинга: ${error.message}`);
    },
  });

  const handleOpenDialog = (order: NeedsMappingOrder) => {
    setSelectedOrder(order);
    setSelectedProductId("");
    setSelectedTariffId("");
    setGrantAccess(false);
    setIsDialogOpen(true);
  };

  const handleMap = () => {
    if (!selectedOrder || !selectedProductId) return;
    
    mapMutation.mutate({
      orderId: selectedOrder.id,
      productId: selectedProductId,
      tariffId: selectedTariffId || null,
      grantAccess,
    });
  };

  const getMappingReason = (meta: Record<string, any> | null): string => {
    if (!meta) return "Неизвестно";
    const reason = meta.mapping_reason;
    switch (reason) {
      case "card_collision":
        return "Конфликт карт (несколько профилей)";
      case "no_user_id":
        return "Нет user_id";
      case "no_subscription_or_order_found":
        return "Нет подписок/заказов";
      default:
        return reason || "Неизвестно";
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-5 w-5 text-purple-500" />
        <h2 className="text-lg font-semibold">Заказы, требующие маппинга продукта</h2>
        <Badge variant="secondary">{orders?.length || 0}</Badge>
      </div>

      {orders?.length === 0 ? (
        <GlassCard className="p-8 text-center">
          <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
          <p className="text-muted-foreground">Нет заказов, требующих маппинга</p>
        </GlassCard>
      ) : (
        <GlassCard className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Заказ</TableHead>
                <TableHead>Сумма</TableHead>
                <TableHead>Карта</TableHead>
                <TableHead>Причина</TableHead>
                <TableHead>Дата</TableHead>
                <TableHead className="text-right">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders?.map((order) => {
                const payment = order.payments_v2?.[0];
                return (
                  <TableRow key={order.id}>
                    <TableCell className="font-mono text-sm">
                      {order.order_number}
                    </TableCell>
                    <TableCell>
                      {order.final_price} {order.currency}
                    </TableCell>
                    <TableCell>
                      {payment?.card_last4 ? (
                        <div className="flex items-center gap-1.5">
                          <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="font-mono text-sm">
                            *{payment.card_last4} {payment.card_brand}
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {getMappingReason(order.meta)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(order.created_at), "dd.MM.yy HH:mm", { locale: ru })}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleOpenDialog(order)}
                      >
                        <Package className="h-3.5 w-3.5 mr-1.5" />
                        Смаппить
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </GlassCard>
      )}

      {/* Mapping Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Привязка продукта к заказу</DialogTitle>
            <DialogDescription>
              Заказ: <span className="font-mono">{selectedOrder?.order_number}</span>
              <br />
              Сумма: {selectedOrder?.final_price} {selectedOrder?.currency}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Продукт *</Label>
              <Select value={selectedProductId} onValueChange={setSelectedProductId}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите продукт" />
                </SelectTrigger>
                <SelectContent>
                  {products?.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedProductId && tariffs && tariffs.length > 0 && (
              <div className="space-y-2">
                <Label>Тариф (опционально)</Label>
                <Select value={selectedTariffId} onValueChange={setSelectedTariffId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите тариф" />
                  </SelectTrigger>
                  <SelectContent>
                    {tariffs.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Checkbox
                id="grant-access"
                checked={grantAccess}
                onCheckedChange={(checked) => setGrantAccess(checked as boolean)}
              />
              <Label htmlFor="grant-access" className="cursor-pointer">
                Выдать доступ после маппинга
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={handleMap}
              disabled={!selectedProductId || mapMutation.isPending}
            >
              {mapMutation.isPending ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Сохранение...
                </>
              ) : (
                "Сохранить"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
