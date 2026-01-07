import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface EditDealDialogProps {
  deal: any | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

const STATUS_OPTIONS = [
  { value: "draft", label: "Черновик" },
  { value: "pending", label: "Ожидает оплаты" },
  { value: "paid", label: "Оплачен" },
  { value: "partial", label: "Частично оплачен" },
  { value: "cancelled", label: "Отменён" },
  { value: "refunded", label: "Возврат" },
  { value: "expired", label: "Истёк" },
];

export function EditDealDialog({ deal, open, onOpenChange, onSuccess }: EditDealDialogProps) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    status: "",
    base_price: "",
    final_price: "",
    discount_percent: "",
    customer_email: "",
    customer_phone: "",
    product_id: "",
    tariff_id: "",
  });

  // Load products
  const { data: products } = useQuery({
    queryKey: ["products-for-edit"],
    queryFn: async () => {
      const { data } = await supabase.from("products_v2").select("id, name").order("name");
      return data || [];
    },
    enabled: open,
  });

  // Load tariffs for selected product
  const { data: tariffs } = useQuery({
    queryKey: ["tariffs-for-edit", formData.product_id],
    queryFn: async () => {
      if (!formData.product_id) return [];
      const { data } = await supabase.from("tariffs").select("id, name").eq("product_id", formData.product_id).order("name");
      return data || [];
    },
    enabled: !!formData.product_id,
  });

  useEffect(() => {
    if (deal) {
      setFormData({
        status: deal.status || "",
        base_price: String(deal.base_price || ""),
        final_price: String(deal.final_price || ""),
        discount_percent: String(deal.discount_percent || ""),
        customer_email: deal.customer_email || "",
        customer_phone: deal.customer_phone || "",
        product_id: deal.product_id || "",
        tariff_id: deal.tariff_id || "",
      });
    }
  }, [deal]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!deal?.id) throw new Error("No deal ID");
      
      const { error } = await supabase
        .from("orders_v2")
        .update({
          status: formData.status as any,
          base_price: parseFloat(formData.base_price) || 0,
          final_price: parseFloat(formData.final_price) || 0,
          discount_percent: parseFloat(formData.discount_percent) || 0,
          customer_email: formData.customer_email || null,
          customer_phone: formData.customer_phone || null,
          product_id: formData.product_id || null,
          tariff_id: formData.tariff_id || null,
        })
        .eq("id", deal.id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Сделка обновлена");
      queryClient.invalidateQueries({ queryKey: ["admin-deals"] });
      queryClient.invalidateQueries({ queryKey: ["deal-payments"] });
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error) => {
      toast.error("Ошибка: " + (error as Error).message);
    },
  });

  if (!deal) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Редактирование сделки #{deal.order_number}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Статус</Label>
            <Select value={formData.status} onValueChange={(v) => setFormData(prev => ({ ...prev, status: v }))}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите статус" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Продукт</Label>
            <Select 
              value={formData.product_id} 
              onValueChange={(v) => setFormData(prev => ({ ...prev, product_id: v, tariff_id: "" }))}
            >
              <SelectTrigger>
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
            <Label>Тариф</Label>
            <Select 
              value={formData.tariff_id} 
              onValueChange={(v) => setFormData(prev => ({ ...prev, tariff_id: v }))}
              disabled={!formData.product_id}
            >
              <SelectTrigger>
                <SelectValue placeholder="Выберите тариф" />
              </SelectTrigger>
              <SelectContent>
                {tariffs?.map(t => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Базовая цена</Label>
              <Input
                type="number"
                value={formData.base_price}
                onChange={(e) => setFormData(prev => ({ ...prev, base_price: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Итоговая цена</Label>
              <Input
                type="number"
                value={formData.final_price}
                onChange={(e) => setFormData(prev => ({ ...prev, final_price: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Скидка (%)</Label>
            <Input
              type="number"
              value={formData.discount_percent}
              onChange={(e) => setFormData(prev => ({ ...prev, discount_percent: e.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <Label>Email клиента</Label>
            <Input
              type="email"
              value={formData.customer_email}
              onChange={(e) => setFormData(prev => ({ ...prev, customer_email: e.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <Label>Телефон клиента</Label>
            <Input
              type="tel"
              value={formData.customer_phone}
              onChange={(e) => setFormData(prev => ({ ...prev, customer_phone: e.target.value }))}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
            {updateMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
