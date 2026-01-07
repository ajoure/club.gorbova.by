import { useState } from "react";
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
import { CreditCard, AlertTriangle, Loader2 } from "lucide-react";

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
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [selectedMethodId, setSelectedMethodId] = useState<string>("");

  // Fetch user's payment methods
  const { data: paymentMethods, isLoading } = useQuery({
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
  useState(() => {
    if (paymentMethods && paymentMethods.length > 0 && !selectedMethodId) {
      const defaultMethod = paymentMethods.find(m => m.is_default) || paymentMethods[0];
      setSelectedMethodId(defaultMethod.id);
    }
  });

  const chargeMutation = useMutation({
    mutationFn: async () => {
      const numericAmount = parseFloat(amount);
      if (isNaN(numericAmount) || numericAmount <= 0) {
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
          amount: Math.round(numericAmount * 100), // Convert to kopecks
          description: description || "Ручное списание администратором",
        },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error || "Ошибка списания");
      return data;
    },
    onSuccess: () => {
      toast.success(`Успешно списано ${amount} BYN`);
      queryClient.invalidateQueries({ queryKey: ["admin-payments"] });
      queryClient.invalidateQueries({ queryKey: ["payments-v2"] });
      onOpenChange(false);
      setAmount("");
      setDescription("");
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Ручное списание
          </DialogTitle>
          <DialogDescription>
            Списание средств с привязанной карты клиента
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* User info */}
          <div className="p-3 rounded-lg bg-muted/50">
            <p className="font-medium">{userName || "—"}</p>
            <p className="text-sm text-muted-foreground">{userEmail}</p>
          </div>

          {/* Payment methods */}
          <div className="space-y-2">
            <Label>Карта для списания</Label>
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
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

          {/* Amount */}
          <div className="space-y-2">
            <Label htmlFor="amount">Сумма (BYN)</Label>
            <Input
              id="amount"
              type="number"
              step="0.01"
              min="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Описание (опционально)</Label>
            <Textarea
              id="description"
              placeholder="Причина списания..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          {/* Warning */}
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-sm text-amber-800 dark:text-amber-200">
              Деньги будут списаны немедленно. Это действие нельзя отменить.
            </p>
          </div>

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
                !amount
              }
            >
              {chargeMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <CreditCard className="h-4 w-4 mr-2" />
              )}
              Списать {amount ? `${amount} BYN` : ""}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
