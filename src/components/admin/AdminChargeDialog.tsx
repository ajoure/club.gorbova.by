import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CreditCard, AlertTriangle, Loader2, Package, Tag } from "lucide-react";
import { useProductsV2, useTariffs } from "@/hooks/useProductsV2";

interface PaymentMethod {
  id: string;
  brand: string | null;
  last4: string | null;
  exp_month: number | null;
  exp_year: number | null;
  is_default: boolean;
  status: string;
}

interface AdminChargeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userName?: string;
  userEmail?: string;
}

export function AdminChargeDialog({
  open,
  onOpenChange,
  userId,
  userName,
  userEmail,
}: AdminChargeDialogProps) {
  const queryClient = useQueryClient();
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [selectedTariffId, setSelectedTariffId] = useState<string>("");
  const [customAmount, setCustomAmount] = useState<string>("");
  const [description, setDescription] = useState("");
  const [selectedMethodId, setSelectedMethodId] = useState<string>("");

  // Fetch products
  const { data: products, isLoading: productsLoading } = useProductsV2();
  
  // Fetch tariffs for selected product
  const { data: tariffs, isLoading: tariffsLoading } = useTariffs(selectedProductId);

  // Fetch tariff prices
  const { data: tariffPrices } = useQuery({
    queryKey: ["tariff_prices_for_charge", selectedTariffId],
    queryFn: async () => {
      if (!selectedTariffId) return null;
      const { data, error } = await supabase
        .from("tariff_prices")
        .select("*")
        .eq("tariff_id", selectedTariffId)
        .eq("is_active", true)  // PATCH-6: Only use active prices
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return data?.[0] || null;
    },
    enabled: !!selectedTariffId,
  });

  // Fetch user's payment methods
  const { data: paymentMethods, isLoading: methodsLoading } = useQuery({
    queryKey: ["user-payment-methods-admin", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_methods")
        .select("id, brand, last4, exp_month, exp_year, is_default, status")
        .eq("user_id", userId)
        .eq("status", "active")
        .order("is_default", { ascending: false });

      if (error) throw error;
      return data as PaymentMethod[];
    },
    enabled: open && !!userId,
  });

  // Set default payment method when loaded
  useEffect(() => {
    if (paymentMethods && paymentMethods.length > 0 && !selectedMethodId) {
      const defaultMethod = paymentMethods.find(m => m.is_default) || paymentMethods[0];
      setSelectedMethodId(defaultMethod.id);
    }
  }, [paymentMethods, selectedMethodId]);

  // Reset tariff when product changes
  useEffect(() => {
    setSelectedTariffId("");
    setCustomAmount("");
  }, [selectedProductId]);

  // Auto-fill amount from tariff price
  useEffect(() => {
    if (tariffPrices?.price) {
      setCustomAmount(String(tariffPrices.price));
    }
  }, [tariffPrices]);

  // Reset form on close
  useEffect(() => {
    if (!open) {
      setSelectedProductId("");
      setSelectedTariffId("");
      setCustomAmount("");
      setDescription("");
      setSelectedMethodId("");
    }
  }, [open]);

  const selectedProduct = products?.find(p => p.id === selectedProductId);
  const selectedTariff = tariffs?.find(t => t.id === selectedTariffId);
  const amount = parseFloat(customAmount) || 0;

  const chargeMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProductId || !selectedTariffId) {
        throw new Error("Выберите продукт и тариф");
      }
      if (amount <= 0) {
        throw new Error("Введите корректную сумму");
      }
      if (!selectedMethodId) {
        throw new Error("Выберите карту для списания");
      }

      const { data, error } = await supabase.functions.invoke("admin-manual-charge", {
        body: {
          action: "manual_charge",
          user_id: userId,
          payment_method_id: selectedMethodId,
          amount: Math.round(amount * 100), // Convert to kopecks
          product_id: selectedProductId,
          tariff_id: selectedTariffId,
          description: description || `Списание за ${selectedProduct?.name} - ${selectedTariff?.name}`,
        },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error || "Ошибка списания");
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Успешно списано ${amount} BYN. Сделка #${data.order_number}`);
      queryClient.invalidateQueries({ queryKey: ["admin-payments"] });
      queryClient.invalidateQueries({ queryKey: ["orders-v2"] });
      queryClient.invalidateQueries({ queryKey: ["subscriptions-v2"] });
      queryClient.invalidateQueries({ queryKey: ["admin-deals"] });
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error("Ошибка: " + (error as Error).message);
    },
  });

  const formatExpiry = (month: number | null, year: number | null) => {
    if (!month || !year) return "";
    return `${String(month).padStart(2, "0")}/${String(year).slice(-2)}`;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    chargeMutation.mutate();
  };

  const activeProducts = products?.filter(p => p.is_active) || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Списание с карты (создание сделки)
          </DialogTitle>
          <DialogDescription>
            Создаёт полноценную сделку с историей платежей и возможностью возврата
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* User info */}
          <div className="p-3 rounded-lg bg-muted/50">
            <p className="font-medium">{userName || "—"}</p>
            <p className="text-sm text-muted-foreground">{userEmail}</p>
          </div>

          {/* Product selection */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              Продукт
            </Label>
            {productsLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <Select value={selectedProductId} onValueChange={setSelectedProductId}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите продукт" />
                </SelectTrigger>
                <SelectContent>
                  {activeProducts.map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Tariff selection */}
          {selectedProductId && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Tag className="h-4 w-4" />
                Тариф
              </Label>
              {tariffsLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : tariffs && tariffs.length > 0 ? (
                <Select value={selectedTariffId} onValueChange={setSelectedTariffId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите тариф" />
                  </SelectTrigger>
                  <SelectContent>
                    {tariffs.filter(t => t.is_active).map((tariff) => (
                      <SelectItem key={tariff.id} value={tariff.id}>
                        {tariff.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm text-muted-foreground">Нет доступных тарифов</p>
              )}
            </div>
          )}

          {/* Amount */}
          {selectedTariffId && (
            <div className="space-y-2">
              <Label htmlFor="amount">Сумма (BYN)</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
                required
              />
              {tariffPrices?.price && (
                <p className="text-xs text-muted-foreground">
                  Рекомендуемая цена тарифа: {tariffPrices.price} BYN
                </p>
              )}
            </div>
          )}

          {/* Payment methods */}
          {selectedTariffId && amount > 0 && (
            <div className="space-y-2">
              <Label>Карта для списания</Label>
              {methodsLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : paymentMethods && paymentMethods.length > 0 ? (
                <RadioGroup
                  value={selectedMethodId}
                  onValueChange={setSelectedMethodId}
                  className="space-y-2"
                >
                  {paymentMethods.map((method) => (
                    <div
                      key={method.id}
                      className="flex items-center space-x-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/30"
                      onClick={() => setSelectedMethodId(method.id)}
                    >
                      <RadioGroupItem value={method.id} id={method.id} />
                      <Label htmlFor={method.id} className="flex-1 cursor-pointer">
                        <div className="flex items-center gap-2">
                          <CreditCard className="h-4 w-4 text-muted-foreground" />
                          <span>
                            {method.brand?.toUpperCase() || "Карта"} •••• {method.last4}
                          </span>
                          {method.is_default && (
                            <Badge variant="secondary" className="text-xs">
                              Основная
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          До {formatExpiry(method.exp_month, method.exp_year)}
                        </p>
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              ) : (
                <div className="p-4 rounded-lg border border-destructive/30 bg-destructive/5 text-center">
                  <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-destructive" />
                  <p className="text-sm text-muted-foreground">
                    У клиента нет привязанных карт
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Description */}
          {selectedTariffId && (
            <div className="space-y-2">
              <Label htmlFor="description">Комментарий (опционально)</Label>
              <Textarea
                id="description"
                placeholder="Причина/комментарий..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>
          )}

          {/* Summary */}
          {selectedProduct && selectedTariff && amount > 0 && (
            <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 space-y-1">
              <p className="font-medium">Будет создана сделка:</p>
              <p className="text-sm text-muted-foreground">
                {selectedProduct.name} — {selectedTariff.name}
              </p>
              <p className="text-lg font-bold">{amount} BYN</p>
            </div>
          )}

          {/* Warning */}
          {selectedTariffId && amount > 0 && selectedMethodId && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <div className="text-sm text-amber-800 dark:text-amber-200">
                <p>Деньги будут списаны немедленно.</p>
                <p className="mt-1">Сделка появится в истории. Возврат возможен через карточку сделки.</p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Отмена
            </Button>
            <Button
              type="submit"
              disabled={
                chargeMutation.isPending ||
                !paymentMethods?.length ||
                !selectedMethodId ||
                !selectedProductId ||
                !selectedTariffId ||
                amount <= 0
              }
            >
              {chargeMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <CreditCard className="h-4 w-4 mr-2" />
              )}
              Списать {amount > 0 ? `${amount} BYN` : ""}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
