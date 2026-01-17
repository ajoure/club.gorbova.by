import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Edit, Loader2 } from "lucide-react";

interface BulkEditDealsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: string[];
  onSuccess: () => void;
}

const STATUS_OPTIONS = [
  { value: "paid", label: "Оплачен" },
  { value: "pending", label: "Ожидает оплаты" },
  { value: "cancelled", label: "Отменён" },
  { value: "refunded", label: "Возврат" },
  { value: "draft", label: "Черновик" },
];

export function BulkEditDealsDialog({
  open,
  onOpenChange,
  selectedIds,
  onSuccess,
}: BulkEditDealsDialogProps) {
  const queryClient = useQueryClient();

  // Which fields to change
  const [changeStatus, setChangeStatus] = useState(false);
  const [changeProduct, setChangeProduct] = useState(false);
  const [changeTrial, setChangeTrial] = useState(false);

  // New values
  const [newStatus, setNewStatus] = useState<string>("");
  const [newProductId, setNewProductId] = useState<string>("");
  const [newIsTrial, setNewIsTrial] = useState(false);

  // Fetch products for select
  const { data: products } = useQuery({
    queryKey: ["products-for-edit"],
    queryFn: async () => {
      const { data } = await supabase
        .from("products_v2")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      return data || [];
    },
    enabled: open,
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const updates: Record<string, any> = {};
      
      if (changeStatus && newStatus) {
        updates.status = newStatus;
      }
      if (changeProduct && newProductId) {
        updates.product_id = newProductId;
      }
      if (changeTrial) {
        updates.is_trial = newIsTrial;
      }

      if (Object.keys(updates).length === 0) {
        throw new Error("Не выбраны поля для изменения");
      }

      const { error } = await supabase
        .from("orders_v2")
        .update(updates)
        .in("id", selectedIds);

      if (error) throw error;
      return selectedIds.length;
    },
    onSuccess: (count) => {
      toast.success(`Обновлено ${count} сделок`);
      resetForm();
      onSuccess();
    },
    onError: (error: any) => {
      toast.error("Ошибка обновления: " + (error?.message || String(error)));
    },
  });

  const resetForm = () => {
    setChangeStatus(false);
    setChangeProduct(false);
    setChangeTrial(false);
    setNewStatus("");
    setNewProductId("");
    setNewIsTrial(false);
  };

  const hasChanges = 
    (changeStatus && newStatus) || 
    (changeProduct && newProductId) || 
    changeTrial;

  return (
    <Dialog open={open} onOpenChange={(v) => {
      if (!v) resetForm();
      onOpenChange(v);
    }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit className="h-5 w-5 text-primary" />
            Изменить {selectedIds.length} сделок
          </DialogTitle>
          <DialogDescription>
            Отметьте поля, которые нужно изменить, и выберите новые значения
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Status */}
          <div className="flex items-start gap-3 p-3 rounded-xl bg-muted/30 border border-border/50">
            <Checkbox
              id="change-status"
              checked={changeStatus}
              onCheckedChange={(checked) => {
                setChangeStatus(!!checked);
                if (!checked) setNewStatus("");
              }}
            />
            <div className="flex-1 space-y-2">
              <Label htmlFor="change-status" className="cursor-pointer">
                Статус
              </Label>
              <Select 
                disabled={!changeStatus} 
                value={newStatus} 
                onValueChange={setNewStatus}
              >
                <SelectTrigger className="bg-background/50">
                  <SelectValue placeholder="Выберите статус" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Product */}
          <div className="flex items-start gap-3 p-3 rounded-xl bg-muted/30 border border-border/50">
            <Checkbox
              id="change-product"
              checked={changeProduct}
              onCheckedChange={(checked) => {
                setChangeProduct(!!checked);
                if (!checked) setNewProductId("");
              }}
            />
            <div className="flex-1 space-y-2">
              <Label htmlFor="change-product" className="cursor-pointer">
                Продукт
              </Label>
              <Select 
                disabled={!changeProduct} 
                value={newProductId} 
                onValueChange={setNewProductId}
              >
                <SelectTrigger className="bg-background/50">
                  <SelectValue placeholder="Выберите продукт" />
                </SelectTrigger>
                <SelectContent>
                  {products?.map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Trial */}
          <div className="flex items-start gap-3 p-3 rounded-xl bg-muted/30 border border-border/50">
            <Checkbox
              id="change-trial"
              checked={changeTrial}
              onCheckedChange={(checked) => {
                setChangeTrial(!!checked);
                if (!checked) setNewIsTrial(false);
              }}
            />
            <div className="flex-1 space-y-2">
              <Label htmlFor="change-trial" className="cursor-pointer">
                Триал
              </Label>
              <div className="flex items-center gap-3">
                <Switch
                  disabled={!changeTrial}
                  checked={newIsTrial}
                  onCheckedChange={setNewIsTrial}
                />
                <span className="text-sm text-muted-foreground">
                  {newIsTrial ? "Триал" : "Обычная сделка"}
                </span>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button 
            onClick={() => updateMutation.mutate()} 
            disabled={!hasChanges || updateMutation.isPending}
          >
            {updateMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Применить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
