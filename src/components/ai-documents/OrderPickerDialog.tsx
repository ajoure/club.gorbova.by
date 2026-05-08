/**
 * OrderPickerDialog — Sprint 8
 *
 * Поиск заказа по номеру / email / имени клиента / продукту.
 * Возвращает orderId + краткую сводку для UI.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, Package } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

export interface OrderPickResult {
  id: string;
  order_number: string;
  customer_email: string | null;
  product_name?: string | null;
  final_price: number;
  currency: string;
  status: string;
  created_at: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSelect: (order: OrderPickResult) => void;
}

const STATUS_LABEL: Record<string, string> = {
  paid: "Оплачен",
  pending: "Ожидает",
  draft: "Черновик",
  cancelled: "Отменён",
  refunded: "Возврат",
  partial_refund: "Частичный возврат",
};

export function OrderPickerDialog({ open, onOpenChange, onSelect }: Props) {
  const [q, setQ] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["order-picker", q],
    enabled: open,
    queryFn: async () => {
      const term = q.trim();
      let query = supabase
        .from("orders_v2")
        .select("id, order_number, customer_email, final_price, currency, status, created_at, product_id, products:product_id(name)")
        .order("created_at", { ascending: false })
        .limit(40);

      if (term) {
        // OR by number / email
        query = query.or(`order_number.ilike.%${term}%,customer_email.ilike.%${term}%`);
      } else {
        // default: show recent paid first
        query = query.in("status", ["paid", "pending", "partial_refund"]);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data || []).map((r: any) => ({
        id: r.id,
        order_number: r.order_number,
        customer_email: r.customer_email,
        product_name: r.products?.name ?? null,
        final_price: Number(r.final_price ?? 0),
        currency: r.currency,
        status: r.status,
        created_at: r.created_at,
      })) as OrderPickResult[];
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Выбрать заказ</DialogTitle>
          <DialogDescription>
            Найдите заказ по номеру, email клиента или просто выберите из последних.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Номер заказа или email клиента"
            className="pl-9"
          />
        </div>

        <div className="max-h-[460px] overflow-y-auto border rounded-md divide-y">
          {isLoading && (
            <div className="flex items-center justify-center p-8 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Загрузка…
            </div>
          )}
          {!isLoading && rows.length === 0 && (
            <div className="p-8 text-center text-sm text-muted-foreground">Заказов не найдено</div>
          )}
          {!isLoading && rows.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => { onSelect(r); onOpenChange(false); }}
              className="w-full text-left p-3 hover:bg-muted/40 transition-colors flex items-start gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs font-medium">{r.order_number}</span>
                  <Badge
                    variant="outline"
                    className={
                      r.status === "paid" ? "text-emerald-700 border-emerald-300"
                      : r.status === "pending" ? "text-amber-700 border-amber-300"
                      : "text-muted-foreground"
                    }
                  >
                    {STATUS_LABEL[r.status] ?? r.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(r.created_at), "d MMM yyyy", { locale: ru })}
                  </span>
                </div>
                <div className="text-sm mt-1 flex items-center gap-2 flex-wrap">
                  {r.product_name && (
                    <span className="inline-flex items-center gap-1 text-foreground">
                      <Package className="h-3 w-3 text-indigo-500" />
                      {r.product_name}
                    </span>
                  )}
                  {r.customer_email && (
                    <span className="text-muted-foreground">· {r.customer_email}</span>
                  )}
                </div>
              </div>
              <div className="text-right text-sm font-medium whitespace-nowrap">
                {r.final_price.toFixed(2)} {r.currency}
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
