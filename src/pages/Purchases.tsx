import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ShoppingBag, Receipt, CheckCircle, XCircle, Clock, CreditCard, Download, FileText } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { toast } from "sonner";

interface Order {
  id: string;
  amount: number;
  currency: string;
  status: string;
  payment_method: string | null;
  bepaid_uid: string | null;
  customer_email: string | null;
  created_at: string;
  products: {
    name: string;
    product_type: string;
  } | null;
}

interface Entitlement {
  id: string;
  product_code: string;
  status: string;
  expires_at: string | null;
  created_at: string;
  meta: Record<string, any> | null;
}

export default function Purchases() {
  const { user } = useAuth();

  const { data: orders, isLoading: ordersLoading } = useQuery({
    queryKey: ["user-orders", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("orders")
        .select("*, products(name, product_type)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return data as Order[];
    },
    enabled: !!user,
  });

  const { data: entitlements, isLoading: entitlementsLoading } = useQuery({
    queryKey: ["user-entitlements", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("entitlements")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return data as Entitlement[];
    },
    enabled: !!user,
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return (
          <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
            <CheckCircle className="mr-1 h-3 w-3" />
            Оплачено
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="destructive">
            <XCircle className="mr-1 h-3 w-3" />
            Ошибка
          </Badge>
        );
      case "processing":
      case "pending":
        return (
          <Badge variant="secondary">
            <Clock className="mr-1 h-3 w-3" />
            В обработке
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getEntitlementStatusBadge = (entitlement: Entitlement) => {
    const isExpired = entitlement.expires_at && new Date(entitlement.expires_at) < new Date();
    
    if (entitlement.status === "active" && !isExpired) {
      return (
        <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
          <CheckCircle className="mr-1 h-3 w-3" />
          Активна
        </Badge>
      );
    }
    
    if (isExpired) {
      return (
        <Badge variant="secondary">
          <Clock className="mr-1 h-3 w-3" />
          Истекла
        </Badge>
      );
    }
    
    return <Badge variant="outline">{entitlement.status}</Badge>;
  };

  const formatPrice = (amount: number, currency: string) => {
    return `${(amount / 100).toFixed(2)} ${currency}`;
  };

  const formatDate = (dateString: string) => {
    return format(new Date(dateString), "d MMMM yyyy, HH:mm", { locale: ru });
  };

  const getProductCodeName = (code: string) => {
    const names: Record<string, string> = {
      pro: "PRO подписка",
      premium: "PREMIUM подписка",
      webinar: "Вебинар",
    };
    return names[code] || code;
  };

  const downloadReceipt = (order: Order) => {
    const priceFormatted = formatPrice(order.amount, order.currency);
    const dateFormatted = formatDate(order.created_at);
    
    const receiptContent = `
═══════════════════════════════════════════════════════════════
                         КВИТАНЦИЯ ОБ ОПЛАТЕ
                           Gorbova Club
═══════════════════════════════════════════════════════════════

Номер заказа:        ${order.id}
ID транзакции:       ${order.bepaid_uid || "—"}
Дата и время:        ${dateFormatted}

───────────────────────────────────────────────────────────────
                           ДЕТАЛИ ЗАКАЗА
───────────────────────────────────────────────────────────────

Продукт:             ${order.products?.name || "Подписка"}
Тип:                 ${order.products?.product_type === "subscription" ? "Подписка" : 
                       order.products?.product_type === "webinar" ? "Вебинар" : "Разовая покупка"}

───────────────────────────────────────────────────────────────
                         ИНФОРМАЦИЯ ОБ ОПЛАТЕ
───────────────────────────────────────────────────────────────

Способ оплаты:       ${order.payment_method || "Банковская карта"}
Статус:              ${order.status === "completed" ? "Оплачено" : order.status}
Email покупателя:    ${order.customer_email || "—"}

───────────────────────────────────────────────────────────────
                              ИТОГО
───────────────────────────────────────────────────────────────

                    СУММА: ${priceFormatted}

═══════════════════════════════════════════════════════════════

Исполнитель: ЗАО "АЖУР инкам"
УНП: 193405000
Адрес: 220035, г. Минск, ул. Панфилова, 2, офис 49Л
Email: info@ajoure.by

Данный документ сформирован автоматически и является 
подтверждением оплаты.

═══════════════════════════════════════════════════════════════
`;

    const blob = new Blob([receiptContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `receipt_${order.id.slice(0, 8)}_${format(new Date(order.created_at), "yyyyMMdd")}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    toast.success("Квитанция скачана");
  };

  const activeEntitlements = entitlements?.filter(e => {
    const isExpired = e.expires_at && new Date(e.expires_at) < new Date();
    return e.status === "active" && !isExpired;
  }) || [];

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Мои покупки</h1>
          <p className="text-muted-foreground">История заказов и активные подписки</p>
        </div>

        {/* Active Subscriptions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Активные подписки
            </CardTitle>
            <CardDescription>
              Ваши текущие подписки и продукты
            </CardDescription>
          </CardHeader>
          <CardContent>
            {entitlementsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : activeEntitlements.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2">
                {activeEntitlements.map((entitlement) => (
                  <div
                    key={entitlement.id}
                    className="rounded-lg border p-4 bg-gradient-to-br from-primary/5 to-accent/5"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-semibold text-foreground">
                          {(entitlement.meta as Record<string, any>)?.product_name || getProductCodeName(entitlement.product_code)}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          Активирована: {formatDate(entitlement.created_at)}
                        </p>
                        {entitlement.expires_at && (
                          <p className="text-sm text-muted-foreground">
                            Действует до: {formatDate(entitlement.expires_at)}
                          </p>
                        )}
                      </div>
                      {getEntitlementStatusBadge(entitlement)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <CreditCard className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>У вас пока нет активных подписок</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Order History */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShoppingBag className="h-5 w-5" />
              История заказов
            </CardTitle>
            <CardDescription>
              Все ваши покупки и платежи
            </CardDescription>
          </CardHeader>
          <CardContent>
            {ordersLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : orders && orders.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Дата</TableHead>
                    <TableHead>Продукт</TableHead>
                    <TableHead>Сумма</TableHead>
                    <TableHead>Способ оплаты</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead className="text-right">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="whitespace-nowrap">
                        {formatDate(order.created_at)}
                      </TableCell>
                      <TableCell className="font-medium">
                        {order.products?.name || "—"}
                      </TableCell>
                      <TableCell>
                        {formatPrice(order.amount, order.currency)}
                      </TableCell>
                      <TableCell>
                        {order.payment_method ? (
                          <span className="flex items-center gap-1">
                            <Receipt className="h-3 w-3" />
                            {order.payment_method}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>{getStatusBadge(order.status)}</TableCell>
                      <TableCell className="text-right">
                        {order.status === "completed" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => downloadReceipt(order)}
                            className="gap-1"
                          >
                            <Download className="h-4 w-4" />
                            <span className="hidden sm:inline">Чек</span>
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <ShoppingBag className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>История покупок пуста</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
