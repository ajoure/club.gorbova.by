import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, addDays, differenceInDays } from "date-fns";
import { ru } from "date-fns/locale";
import { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";
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
import { Textarea } from "@/components/ui/textarea";
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
import { toast } from "sonner";
import { Loader2, CalendarIcon } from "lucide-react";

interface EditSubscriptionDialogProps {
  subscription: any | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

const STATUS_OPTIONS = [
  { value: "active", label: "Активна" },
  { value: "trial", label: "Пробный период" },
  { value: "expired", label: "Истекла" },
  { value: "cancelled", label: "Отменена" },
  { value: "paused", label: "Приостановлена" },
];

export function EditSubscriptionDialog({ 
  subscription, 
  open, 
  onOpenChange, 
  onSuccess 
}: EditSubscriptionDialogProps) {
  const queryClient = useQueryClient();
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [formData, setFormData] = useState({
    status: "",
    product_id: "",
    tariff_id: "",
    comment: "",
  });

  // Load products
  const { data: products } = useQuery({
    queryKey: ["products-for-edit-sub"],
    queryFn: async () => {
      const { data } = await supabase.from("products_v2").select("id, name").eq("is_active", true).order("name");
      return data || [];
    },
    enabled: open,
  });

  // Load tariffs for selected product
  const { data: tariffs } = useQuery({
    queryKey: ["tariffs-for-edit-sub", formData.product_id],
    queryFn: async () => {
      if (!formData.product_id) return [];
      const { data } = await supabase.from("tariffs").select("id, name").eq("product_id", formData.product_id).eq("is_active", true).order("name");
      return data || [];
    },
    enabled: !!formData.product_id,
  });

  useEffect(() => {
    if (subscription) {
      setFormData({
        status: subscription.status || "",
        product_id: subscription.product_id || "",
        tariff_id: subscription.tariff_id || "",
        comment: "",
      });
      setDateRange({
        from: new Date(subscription.access_start_at),
        to: subscription.access_end_at ? new Date(subscription.access_end_at) : undefined,
      });
    }
  }, [subscription]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!subscription?.id) throw new Error("No subscription ID");
      
      const { error } = await supabase
        .from("subscriptions_v2")
        .update({
          status: formData.status as any,
          product_id: formData.product_id || null,
          tariff_id: formData.tariff_id || null,
          access_start_at: dateRange?.from?.toISOString(),
          access_end_at: dateRange?.to?.toISOString() || null,
          meta: {
            ...(subscription.meta as object || {}),
            last_edit_comment: formData.comment || undefined,
            last_edit_at: new Date().toISOString(),
          },
        })
        .eq("id", subscription.id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Подписка обновлена");
      queryClient.invalidateQueries({ queryKey: ["contact-subscriptions"] });
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error) => {
      toast.error("Ошибка: " + (error as Error).message);
    },
  });

  if (!subscription) return null;

  const days = dateRange?.from && dateRange?.to 
    ? differenceInDays(dateRange.to, dateRange.from) + 1 
    : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Редактирование подписки</DialogTitle>
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

          <div className="space-y-2">
            <Label>Период доступа</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !dateRange && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dateRange?.from ? (
                    dateRange.to ? (
                      <>
                        {format(dateRange.from, "dd.MM.yy")} — {format(dateRange.to, "dd.MM.yy")}
                        <span className="ml-auto text-muted-foreground text-xs">
                          ({days} дн.)
                        </span>
                      </>
                    ) : (
                      format(dateRange.from, "dd.MM.yy")
                    )
                  ) : (
                    <span>Выберите период</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  initialFocus
                  mode="range"
                  defaultMonth={dateRange?.from}
                  selected={dateRange}
                  onSelect={setDateRange}
                  numberOfMonths={1}
                  locale={ru}
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <Label>Комментарий к изменениям</Label>
            <Textarea
              value={formData.comment}
              onChange={(e) => setFormData(prev => ({ ...prev, comment: e.target.value }))}
              placeholder="Причина изменения..."
              className="min-h-[60px] resize-none"
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
