import { useQuery } from "@tanstack/react-query";
import { FileText, ExternalLink, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

type InvoiceOrder = {
  id: string;
  order_number: string;
  status: string;
  final_price: number;
  currency: string;
  customer_email: string | null;
  created_at: string;
  meta: Record<string, unknown> | null;
  products_v2: { name: string } | null;
  tariffs: { name: string } | null;
};

const statusLabel: Record<string, string> = {
  pending: "Ожидает оплаты",
  paid: "Оплачен",
  partial: "Частично оплачен",
  cancelled: "Отменён",
  refunded: "Возврат",
};

/** Registry, not a separate sales funnel: every invoice stays attached to its
 * original order/deal, so a bank payment can be matched to it instead of a new
 * single-product deal being created manually. */
export function InvoicesTabContent() {
  const navigate = useNavigate();
  const invoices = useQuery({
    queryKey: ["admin-invoice-registry"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("orders_v2")
        .select("id,order_number,status,final_price,currency,customer_email,created_at,meta,products_v2(name),tariffs(name)")
        .eq("meta->>checkout_kind", "invoice")
        .order("created_at", { ascending: false })
        .limit(250);
      if (error) throw error;
      return (data ?? []) as InvoiceOrder[];
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-5 w-5 text-primary" />
              Счета на оплату
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Каждый счёт связан с исходной сделкой и её составом заказа.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => invoices.refetch()} disabled={invoices.isFetching}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${invoices.isFetching ? "animate-spin" : ""}`} />
            Обновить
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {invoices.isLoading ? (
          <div className="space-y-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
        ) : invoices.isError ? (
          <p className="py-6 text-center text-sm text-destructive">Не удалось загрузить реестр счетов.</p>
        ) : invoices.data?.length ? (
          <div className="space-y-2">
            {invoices.data.map((order) => {
              const invoiceNumber = String(order.meta?.invoice_number || order.order_number);
              const productLabel = [order.products_v2?.name, order.tariffs?.name].filter(Boolean).join(" · ");
              return (
                <div key={order.id} className="flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">Счёт № {invoiceNumber}</span>
                      <Badge variant="outline">{statusLabel[order.status] || order.status}</Badge>
                    </div>
                    <p className="mt-1 truncate text-sm text-muted-foreground">{productLabel || "Состав заказа"}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {format(new Date(order.created_at), "d MMMM yyyy, HH:mm", { locale: ru })}
                      {order.customer_email ? ` · ${order.customer_email}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-3 sm:justify-end">
                    <span className="font-semibold whitespace-nowrap">{Number(order.final_price).toLocaleString("ru-RU")} {order.currency || "BYN"}</span>
                    <Button size="sm" variant="outline" onClick={() => navigate(`/admin/deals?deal=${order.id}`)}>
                      Сделка <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-10 text-center text-sm text-muted-foreground">Счетов пока нет.</div>
        )}
      </CardContent>
    </Card>
  );
}
