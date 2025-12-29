import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { 
  CreditCard, Settings, ShoppingCart, CheckCircle, XCircle, Clock, 
  BookOpen, AlertTriangle, UserX, Link2, ExternalLink 
} from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { OrderFilters, OrderFilters as OrderFiltersType } from "@/components/admin/OrderFilters";

interface PaymentSetting {
  id: string;
  key: string;
  value: string;
  description: string | null;
}

interface Order {
  id: string;
  user_id: string;
  amount: number;
  currency: string;
  status: string;
  bepaid_uid: string | null;
  payment_method: string | null;
  customer_email: string | null;
  created_at: string;
  possible_duplicate: boolean;
  duplicate_reason: string | null;
  product_id: string | null;
  products: {
    name: string;
  } | null;
}

interface Profile {
  id: string;
  user_id: string;
  email: string | null;
  full_name: string | null;
}

const defaultFilters: OrderFiltersType = {
  statuses: [],
  dateFrom: undefined,
  dateTo: undefined,
  email: "",
  productId: "",
  amountMin: "",
  amountMax: "",
  paymentMethod: "",
};

interface AdminPaymentsProps {
  embedded?: boolean;
}

export default function AdminPayments({ embedded }: AdminPaymentsProps = {}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [editingSettings, setEditingSettings] = useState<Record<string, string>>({});
  
  // Initialize filters from URL
  const [filters, setFilters] = useState<OrderFiltersType>(() => {
    const statuses = searchParams.get("statuses")?.split(",").filter(Boolean) || [];
    const dateFrom = searchParams.get("dateFrom") ? new Date(searchParams.get("dateFrom")!) : undefined;
    const dateTo = searchParams.get("dateTo") ? new Date(searchParams.get("dateTo")!) : undefined;
    return {
      statuses,
      dateFrom,
      dateTo,
      email: searchParams.get("email") || "",
      productId: searchParams.get("productId") || "",
      amountMin: searchParams.get("amountMin") || "",
      amountMax: searchParams.get("amountMax") || "",
      paymentMethod: searchParams.get("paymentMethod") || "",
    };
  });

  // Sync filters to URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.statuses.length) params.set("statuses", filters.statuses.join(","));
    if (filters.dateFrom) params.set("dateFrom", filters.dateFrom.toISOString());
    if (filters.dateTo) params.set("dateTo", filters.dateTo.toISOString());
    if (filters.email) params.set("email", filters.email);
    if (filters.productId) params.set("productId", filters.productId);
    if (filters.amountMin) params.set("amountMin", filters.amountMin);
    if (filters.amountMax) params.set("amountMax", filters.amountMax);
    if (filters.paymentMethod) params.set("paymentMethod", filters.paymentMethod);
    setSearchParams(params, { replace: true });
  }, [filters, setSearchParams]);

  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ["payment-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_settings")
        .select("*")
        .order("key");
      
      if (error) throw error;
      return data as PaymentSetting[];
    },
  });

  const { data: products } = useQuery({
    queryKey: ["products-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: orders, isLoading: ordersLoading } = useQuery({
    queryKey: ["admin-orders", filters],
    queryFn: async () => {
      let query = supabase
        .from("orders")
        .select("*, products(name)")
        .order("created_at", { ascending: false })
        .limit(200);

      // Apply filters
      if (filters.statuses.length > 0) {
        query = query.in("status", filters.statuses);
      }
      if (filters.dateFrom) {
        query = query.gte("created_at", filters.dateFrom.toISOString());
      }
      if (filters.dateTo) {
        const endDate = new Date(filters.dateTo);
        endDate.setHours(23, 59, 59, 999);
        query = query.lte("created_at", endDate.toISOString());
      }
      if (filters.email) {
        query = query.ilike("customer_email", filters.email);
      }
      if (filters.productId) {
        query = query.eq("product_id", filters.productId);
      }
      if (filters.amountMin) {
        query = query.gte("amount", parseInt(filters.amountMin) * 100);
      }
      if (filters.amountMax) {
        query = query.lte("amount", parseInt(filters.amountMax) * 100);
      }
      if (filters.paymentMethod) {
        query = query.eq("payment_method", filters.paymentMethod);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data as Order[];
    },
  });

  // Fetch profiles for linking
  const { data: profiles } = useQuery({
    queryKey: ["profiles-lookup"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, user_id, email, full_name");
      if (error) throw error;
      return data as Profile[];
    },
  });

  const updateSettingMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      const { error } = await supabase
        .from("payment_settings")
        .update({ value })
        .eq("key", key);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payment-settings"] });
      toast.success("Настройка сохранена");
    },
    onError: (error) => {
      toast.error("Ошибка сохранения: " + error.message);
    },
  });

  const handleSettingChange = (key: string, value: string) => {
    setEditingSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleSaveSetting = (key: string) => {
    const value = editingSettings[key];
    if (value !== undefined) {
      updateSettingMutation.mutate({ key, value });
      setEditingSettings((prev) => {
        const newState = { ...prev };
        delete newState[key];
        return newState;
      });
    }
  };

  const getSettingLabel = (key: string): string => {
    const labels: Record<string, string> = {
      bepaid_shop_id: "ID магазина",
      bepaid_test_mode: "Тестовый режим",
      bepaid_success_url: "URL успешной оплаты",
      bepaid_fail_url: "URL неудачной оплаты",
      bepaid_notification_url: "URL вебхука",
    };
    return labels[key] || key;
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; icon: typeof CheckCircle }> = {
      completed: { variant: "default", icon: CheckCircle },
      pending: { variant: "outline", icon: Clock },
      processing: { variant: "secondary", icon: Clock },
      failed: { variant: "destructive", icon: XCircle },
      refunded: { variant: "outline", icon: XCircle },
    };
    const { variant, icon: Icon } = variants[status] || { variant: "outline" as const, icon: Clock };
    
    return (
      <Badge variant={variant} className="gap-1">
        <Icon className="h-3 w-3" />
        {status === "completed" ? "Оплачен" :
         status === "pending" ? "Ожидает" :
         status === "processing" ? "Обработка" :
         status === "failed" ? "Ошибка" :
         status === "refunded" ? "Возврат" : status}
      </Badge>
    );
  };

  const formatPrice = (amount: number, currency: string) => {
    return `${(amount / 100).toFixed(2)} ${currency}`;
  };

  // Find profile by email (strict match)
  const findProfileByEmail = (email: string | null): Profile | undefined => {
    if (!email || !profiles) return undefined;
    return profiles.find(p => p.email?.toLowerCase() === email.toLowerCase());
  };

  const handleEmailClick = (order: Order) => {
    const profile = findProfileByEmail(order.customer_email);
    if (profile) {
      navigate(`/admin/users?search=${encodeURIComponent(order.customer_email || "")}`);
    }
  };

  return (
    <div className="space-y-6">
      {!embedded && (
        <div>
          <h1 className="text-2xl font-bold text-foreground">Платежи</h1>
          <p className="text-muted-foreground">Настройки bePaid и история заказов</p>
        </div>
      )}

      {/* Instructions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Инструкция по настройке платежей
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="quick-start">
              <AccordionTrigger>Быстрый старт</AccordionTrigger>
              <AccordionContent className="text-sm text-muted-foreground space-y-2">
                <p><strong>1.</strong> Убедитесь, что ID магазина указан верно (14588)</p>
                <p><strong>2.</strong> Перейдите в раздел «Продукты» и создайте товары для продажи</p>
                <p><strong>3.</strong> На странице тарифов появится кнопка «Оплатить»</p>
                <p><strong>4.</strong> После оплаты пользователю автоматически предоставляется доступ</p>
              </AccordionContent>
            </AccordionItem>
            
            <AccordionItem value="test-mode">
              <AccordionTrigger>Тестовый режим</AccordionTrigger>
              <AccordionContent className="text-sm text-muted-foreground space-y-2">
                <p>Включите тестовый режим для проверки интеграции без реальных платежей.</p>
                <p>В тестовом режиме используйте тестовые карты bePaid:</p>
                <ul className="list-disc pl-4 space-y-1">
                  <li>Успешная оплата: 4200000000000000</li>
                  <li>Отклонённая оплата: 4111111111111111</li>
                  <li>CVV: любые 3 цифры, срок: любой будущий</li>
                </ul>
              </AccordionContent>
            </AccordionItem>
            
            <AccordionItem value="webhook">
              <AccordionTrigger>Настройка вебхука</AccordionTrigger>
              <AccordionContent className="text-sm text-muted-foreground space-y-2">
                <p>Вебхук уже настроен автоматически. bePaid отправляет уведомления на:</p>
                <code className="block bg-muted p-2 rounded text-xs mt-2">
                  https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/bepaid-webhook
                </code>
                <p className="mt-2">После успешной оплаты система автоматически:</p>
                <ul className="list-disc pl-4 space-y-1">
                  <li>Обновляет статус заказа</li>
                  <li>Активирует подписку пользователя</li>
                  <li>Создаёт запись в журнале аудита</li>
                </ul>
              </AccordionContent>
            </AccordionItem>
            
            <AccordionItem value="products">
              <AccordionTrigger>Управление продуктами</AccordionTrigger>
              <AccordionContent className="text-sm text-muted-foreground space-y-2">
                <p>В разделе «Продукты» вы можете:</p>
                <ul className="list-disc pl-4 space-y-1">
                  <li>Создавать новые продукты (подписки, разовые покупки, вебинары)</li>
                  <li>Устанавливать цены и сроки действия</li>
                  <li>Связывать продукты с тарифами подписки (pro, premium)</li>
                  <li>Включать/отключать продукты для продажи</li>
                </ul>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>

      {/* Payment Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Настройки bePaid
          </CardTitle>
          <CardDescription>
            Конфигурация платёжного шлюза
          </CardDescription>
        </CardHeader>
        <CardContent>
          {settingsLoading ? (
            <div className="text-center py-4 text-muted-foreground">Загрузка...</div>
          ) : settings && settings.length > 0 ? (
            <div className="space-y-4">
              {settings.map((setting) => (
                <div key={setting.id} className="flex items-center gap-4">
                  <div className="w-48 shrink-0">
                    <Label>{getSettingLabel(setting.key)}</Label>
                    {setting.description && (
                      <p className="text-xs text-muted-foreground">{setting.description}</p>
                    )}
                  </div>
                  
                  {setting.key === "bepaid_test_mode" ? (
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={
                          editingSettings[setting.key] !== undefined
                            ? editingSettings[setting.key] === "true"
                            : setting.value === "true"
                        }
                        onCheckedChange={(checked) => {
                          handleSettingChange(setting.key, checked ? "true" : "false");
                          updateSettingMutation.mutate({ key: setting.key, value: checked ? "true" : "false" });
                        }}
                      />
                      <span className="text-sm text-muted-foreground">
                        {setting.value === "true" ? "Включён" : "Выключен"}
                      </span>
                    </div>
                  ) : (
                    <div className="flex-1 flex gap-2">
                      <Input
                        value={editingSettings[setting.key] ?? setting.value}
                        onChange={(e) => handleSettingChange(setting.key, e.target.value)}
                        className="max-w-md"
                      />
                      {editingSettings[setting.key] !== undefined && 
                       editingSettings[setting.key] !== setting.value && (
                        <Button
                          size="sm"
                          onClick={() => handleSaveSetting(setting.key)}
                          disabled={updateSettingMutation.isPending}
                        >
                          Сохранить
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-4 text-muted-foreground">
              Настройки не найдены
            </div>
          )}
        </CardContent>
      </Card>

      {/* Orders */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            Последние заказы
          </CardTitle>
          <CardDescription>
            История платежей через bePaid
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <OrderFilters
            filters={filters}
            onFiltersChange={setFilters}
            products={products || []}
            totalCount={orders?.length || 0}
          />

          {ordersLoading ? (
            <div className="text-center py-8 text-muted-foreground">Загрузка...</div>
          ) : orders && orders.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Дата</TableHead>
                    <TableHead>Продукт</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Сумма</TableHead>
                    <TableHead>Способ</TableHead>
                    <TableHead>Статус</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((order) => {
                    const profile = findProfileByEmail(order.customer_email);
                    const isLinked = !!profile;
                    
                    return (
                      <TableRow key={order.id}>
                        <TableCell className="text-sm">
                          {format(new Date(order.created_at), "dd MMM yyyy, HH:mm", { locale: ru })}
                        </TableCell>
                        <TableCell className="font-medium">
                          {order.products?.name || "—"}
                        </TableCell>
                        <TableCell>
                          <TooltipProvider>
                            <div className="flex items-center gap-2">
                              {order.customer_email ? (
                                isLinked ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        onClick={() => handleEmailClick(order)}
                                        className="text-sm text-primary hover:underline cursor-pointer flex items-center gap-1"
                                      >
                                        {order.customer_email}
                                        <ExternalLink className="h-3 w-3" />
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      Перейти к клиенту: {profile?.full_name || order.customer_email}
                                    </TooltipContent>
                                  </Tooltip>
                                ) : (
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm text-muted-foreground">{order.customer_email}</span>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Badge variant="outline" className="gap-1 text-xs">
                                          <UserX className="h-3 w-3" />
                                          Не привязан
                                        </Badge>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        Клиент не найден в системе
                                      </TooltipContent>
                                    </Tooltip>
                                  </div>
                                )
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                              
                              {order.possible_duplicate && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Badge variant="destructive" className="gap-1 text-xs">
                                      <AlertTriangle className="h-3 w-3" />
                                      Дубль
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {order.duplicate_reason || "Возможный дубликат контакта"}
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          </TooltipProvider>
                        </TableCell>
                        <TableCell>{formatPrice(order.amount, order.currency)}</TableCell>
                        <TableCell className="text-sm">
                          {order.payment_method || "—"}
                        </TableCell>
                        <TableCell>{getStatusBadge(order.status)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <CreditCard className="h-12 w-12 mx-auto mb-2 opacity-50" />
              {filters.email || filters.statuses.length > 0 || filters.productId
                ? "Заказы не найдены по заданным фильтрам"
                : "Заказов пока нет"}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
