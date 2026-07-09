import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Wallet,
  Check,
  X,
  RefreshCw,
  Settings,
  Trash2,
  ExternalLink,
} from "lucide-react";
import {
  IntegrationInstance,
  useIntegrationMutations,
} from "@/hooks/useIntegrations";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { RRConnectionDialog } from "./RRConnectionDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface RRSettingsCardProps {
  instance: IntegrationInstance | null;
}

export function RRSettingsCard({ instance }: RRSettingsCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isChecking, setIsChecking] = useState(false);

  const queryClient = useQueryClient();
  const { deleteInstance } = useIntegrationMutations();

  const config = (instance?.config ?? {}) as Record<string, unknown>;
  const hasError = instance?.status === "error";
  const mode = (config.mode as string) || "test";
  const testConfigured = !!config.test_password_configured;
  const battleConfigured = !!config.battle_password_configured;
  const secretConfigured = !!config.secret_key_configured;
  const testLogin = (config.test_login as string) || "";
  const battleLogin = (config.battle_login as string) || "";

  const activeLogin = mode === "battle" ? battleLogin : testLogin;
  const activePasswordConfigured =
    mode === "battle" ? battleConfigured : testConfigured;

  // Пока backend-адаптер РР не подключён, статус "connected" не выставляется.
  // Показываем честный промежуточный статус.
  const credentialsReady =
    secretConfigured && !!activeLogin && activePasswordConfigured;
  const isBackendConnected = instance?.status === "connected";
  const isPartial = !!instance && !isBackendConnected && !hasError;

  const handleHealthCheck = async () => {
    if (!instance) return;
    setIsChecking(true);
    toast.info("Проверка подключения «Ресурс Развития»...");
    try {
      const { data, error } = await supabase.functions.invoke(
        "integration-healthcheck",
        {
          body: { provider: "rr", instance_id: instance.id },
        },
      );
      queryClient.invalidateQueries({ queryKey: ["integration-instances"] });
      if (error) {
        toast.warning(
          "Backend-проверка недоступна. Настройки сохранены безопасно.",
        );
        return;
      }
      if (data?.success && data?.data?.api_test === "pending_backend") {
        toast.success(
          "Ключи сохранены. API-проверка будет доступна после подключения backend-адаптера РР.",
        );
      } else if (data?.success) {
        toast.success("«Ресурс Развития» подключён");
      } else {
        toast.error(`Ошибка: ${data?.error || "проверка не пройдена"}`);
      }
    } catch {
      toast.warning(
        "Backend-проверка недоступна. Настройки сохранены безопасно.",
      );
    } finally {
      setIsChecking(false);
    }
  };

  const handleDelete = async () => {
    if (!instance) return;
    try {
      await deleteInstance.mutateAsync(instance.id);
      setDeleteDialogOpen(false);
    } catch {
      /* handled */
    }
  };

  const lastCheckFormatted = instance?.last_check_at
    ? new Date(instance.last_check_at).toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <>
      <Card className="relative overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div
                className={`p-2 rounded-lg ${
                  isConnected ? "bg-primary/10" : "bg-muted"
                }`}
              >
                <Wallet
                  className={`h-5 w-5 ${
                    isConnected ? "text-primary" : "text-muted-foreground"
                  }`}
                />
              </div>
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  Ресурс Развития
                  {instance && (
                    <Badge
                      variant={
                        isConnected
                          ? "default"
                          : hasError
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {isConnected ? (
                        <>
                          <Check className="h-3 w-3 mr-1" />
                          Подключено
                        </>
                      ) : hasError ? (
                        <>
                          <X className="h-3 w-3 mr-1" />
                          Ошибка
                        </>
                      ) : (
                        "Настроено"
                      )}
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-xs">
                    {mode === "battle" ? "Боевой" : "Тестовый"}
                  </Badge>
                </CardTitle>
                <CardDescription className="text-sm mt-1">
                  Рассрочка для RUB-заказов от 9 900 ₽. Ключи вводятся здесь,
                  хранятся зашифрованно.
                </CardDescription>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {instance ? (
            <>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Ключ:</span>
                  {secretConfigured ? (
                    <span className="flex items-center gap-1 text-primary font-medium">
                      <Check className="h-3 w-3" /> configured
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <X className="h-3 w-3" /> не задан
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Пароль:</span>
                  {activePasswordConfigured ? (
                    <span className="flex items-center gap-1 text-primary font-medium">
                      <Check className="h-3 w-3" /> configured
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <X className="h-3 w-3" /> не задан
                    </span>
                  )}
                </div>
                {activeLogin && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Логин:</span>
                    <span className="ml-1.5 font-mono text-xs">
                      {activeLogin}
                    </span>
                  </div>
                )}
                <div className="col-span-2 text-xs text-muted-foreground">
                  Тест: {testConfigured ? "••••••••" : "—"} · Боевой:{" "}
                  {battleConfigured ? "••••••••" : "—"}
                </div>
                {lastCheckFormatted && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">
                      Последняя проверка:
                    </span>
                    <span className="ml-1.5 text-xs">{lastCheckFormatted}</span>
                    <Badge
                      variant={isConnected ? "outline" : "destructive"}
                      className="ml-2 text-xs"
                    >
                      {isConnected ? "OK" : hasError ? "ERROR" : "—"}
                    </Badge>
                  </div>
                )}
              </div>

              {hasError && instance.error_message && (
                <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                  {instance.error_message}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleHealthCheck}
                  disabled={isChecking}
                >
                  <RefreshCw
                    className={`h-4 w-4 mr-2 ${
                      isChecking ? "animate-spin" : ""
                    }`}
                  />
                  Проверить подключение
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDialogOpen(true)}
                >
                  <Settings className="h-4 w-4 mr-2" />
                  Настройки
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setDeleteDialogOpen(true)}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Удалить
                </Button>
                <Button variant="ghost" size="sm" asChild>
                  <a
                    href="https://partner.rrllc.ru/public-api-v20/docs/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Документация РР
                  </a>
                </Button>
              </div>
            </>
          ) : (
            <div className="text-center py-4">
              <p className="text-muted-foreground mb-4">
                Подключите «Ресурс Развития» для приёма оплаты в рассрочку по
                RUB-заказам от 9 900 ₽.
              </p>
              <Button onClick={() => setDialogOpen(true)}>
                <Wallet className="h-4 w-4 mr-2" />
                Подключить Ресурс Развития
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <RRConnectionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        existingInstance={instance}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Удалить подключение «Ресурс Развития»?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Настройки и сохранённые ключи будут удалены. Действие нельзя
              отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
