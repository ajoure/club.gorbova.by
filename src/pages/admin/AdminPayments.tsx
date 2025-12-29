import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { toast } from "sonner";
import { CreditCard, Settings, ShoppingCart, CheckCircle, XCircle, Clock, HelpCircle, BookOpen } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

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
  products: {
    name: string;
  } | null;
}

export default function AdminPayments() {
  const queryClient = useQueryClient();
  const [editingSettings, setEditingSettings] = useState<Record<string, string>>({});

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

  const { data: orders, isLoading: ordersLoading } = useQuery({
    queryKey: ["admin-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*, products(name)")
        .order("created_at", { ascending: false })
        .limit(50);
      
      if (error) throw error;
      return data as Order[];
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
    };
    const { variant, icon: Icon } = variants[status] || { variant: "outline" as const, icon: Clock };
    
    return (
      <Badge variant={variant} className="gap-1">
        <Icon className="h-3 w-3" />
        {status === "completed" ? "Оплачен" :
         status === "pending" ? "Ожидает" :
         status === "processing" ? "Обработка" :
         status === "failed" ? "Ошибка" : status}
      </Badge>
    );
  };

  const formatPrice = (amount: number, currency: string) => {
    return `${(amount / 100).toFixed(2)} ${currency}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Платежи</h1>
        <p className="text-muted-foreground">Настройки bePaid и история заказов</p>
      </div>

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
          {ordersLoading ? (
            <div className="text-center py-8 text-muted-foreground">Загрузка...</div>
          ) : orders && orders.length > 0 ? (
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
                {orders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="text-sm">
                      {format(new Date(order.created_at), "dd MMM yyyy, HH:mm", { locale: ru })}
                    </TableCell>
                    <TableCell className="font-medium">
                      {order.products?.name || "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {order.customer_email || "—"}
                    </TableCell>
                    <TableCell>{formatPrice(order.amount, order.currency)}</TableCell>
                    <TableCell className="text-sm">
                      {order.payment_method || "—"}
                    </TableCell>
                    <TableCell>{getStatusBadge(order.status)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <CreditCard className="h-12 w-12 mx-auto mb-2 opacity-50" />
              Заказов пока нет
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}