import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, CheckCircle, XCircle, Users, FileText, Settings } from "lucide-react";
import { toast } from "sonner";

interface AmoCRMAccount {
  id: number;
  name: string;
  subdomain: string;
}

interface CustomField {
  id: number;
  name: string;
  type: string;
  code?: string;
}

interface Pipeline {
  id: number;
  name: string;
  is_main: boolean;
  statuses: Array<{
    id: number;
    name: string;
    color: string;
  }>;
}

interface AdminAmoCRMProps {
  embedded?: boolean;
}

export default function AdminAmoCRM({ embedded }: AdminAmoCRMProps = {}) {
  const queryClient = useQueryClient();
  const [testingConnection, setTestingConnection] = useState(false);

  const { data: connectionData, isLoading: isTestingInitial, refetch: refetchConnection } = useQuery({
    queryKey: ["amocrm-connection"],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Не авторизован");

      const response = await fetch(
        `https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/amocrm-sync?action=test-connection`,
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Ошибка подключения");
      }

      return response.json();
    },
    retry: false,
  });

  const { data: fieldsData, isLoading: isLoadingFields } = useQuery({
    queryKey: ["amocrm-fields"],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Не авторизован");

      const response = await fetch(
        `https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/amocrm-sync?action=get-fields`,
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        throw new Error("Ошибка загрузки полей");
      }

      return response.json();
    },
    enabled: !!connectionData?.success,
  });

  const { data: pipelinesData, isLoading: isLoadingPipelines } = useQuery({
    queryKey: ["amocrm-pipelines"],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Не авторизован");

      const response = await fetch(
        `https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/amocrm-sync?action=get-pipelines`,
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        throw new Error("Ошибка загрузки воронок");
      }

      return response.json();
    },
    enabled: !!connectionData?.success,
  });

  const testConnectionMutation = useMutation({
    mutationFn: async () => {
      setTestingConnection(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Не авторизован");

      const response = await fetch(
        `https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/amocrm-sync?action=test-connection`,
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
        }
      );

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Ошибка подключения");
      }

      return data;
    },
    onSuccess: (data) => {
      toast.success(`Подключено к ${data.account?.name || "amoCRM"}`);
      queryClient.invalidateQueries({ queryKey: ["amocrm-connection"] });
    },
    onError: (error: Error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
    onSettled: () => {
      setTestingConnection(false);
    },
  });

  const isConnected = connectionData?.success;
  const account = connectionData?.account as AmoCRMAccount | undefined;

  return (
    <div className="space-y-6">
      {!embedded && (
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Интеграция amoCRM</h1>
          <p className="text-muted-foreground">
            Настройка синхронизации данных с amoCRM
          </p>
        </div>
      )}

      {/* Connection Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Статус подключения
          </CardTitle>
          <CardDescription>
            Проверьте подключение к вашему аккаунту amoCRM
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {isTestingInitial ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : isConnected ? (
                <>
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  <div>
                    <p className="font-medium">Подключено</p>
                    {account && (
                      <p className="text-sm text-muted-foreground">
                        {account.name} ({account.subdomain}.amocrm.ru)
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <XCircle className="h-5 w-5 text-red-500" />
                  <div>
                    <p className="font-medium">Не подключено</p>
                    <p className="text-sm text-muted-foreground">
                      Проверьте настройки секретов
                    </p>
                  </div>
                </>
              )}
            </div>
            <Button
              variant="outline"
              onClick={() => testConnectionMutation.mutate()}
              disabled={testingConnection}
            >
              {testingConnection ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Проверить
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Integration Features */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Контакты
            </CardTitle>
            <CardDescription>
              Автоматическое создание контактов при регистрации и оплате
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>При регистрации</span>
                <Badge variant="outline">Активно</Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span>При оплате</span>
                <Badge variant="outline">Активно</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Сделки
            </CardTitle>
            <CardDescription>
              Автоматическое создание сделок при успешной оплате
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>При оплате</span>
                <Badge variant="outline">Активно</Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span>Сумма сделки</span>
                <Badge variant="secondary">Из заказа</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Custom Fields */}
      {isConnected && (
        <Card>
          <CardHeader>
            <CardTitle>Поля контактов в amoCRM</CardTitle>
            <CardDescription>
              Доступные поля для маппинга данных
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingFields ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : (
              <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                {(fieldsData?.contacts as CustomField[] || []).slice(0, 12).map((field) => (
                  <div
                    key={field.id}
                    className="flex items-center justify-between p-2 rounded-md border"
                  >
                    <span className="text-sm truncate">{field.name}</span>
                    <Badge variant="secondary" className="text-xs">
                      {field.type}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Pipelines */}
      {isConnected && (
        <Card>
          <CardHeader>
            <CardTitle>Воронки продаж</CardTitle>
            <CardDescription>
              Доступные воронки и этапы сделок
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingPipelines ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : (
              <div className="space-y-4">
                {(pipelinesData?.pipelines as Pipeline[] || []).map((pipeline) => (
                  <div key={pipeline.id} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium">{pipeline.name}</h4>
                      {pipeline.is_main && (
                        <Badge variant="default" className="text-xs">
                          Основная
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {pipeline.statuses?.map((status) => (
                        <Badge
                          key={status.id}
                          variant="outline"
                          style={{ borderColor: status.color }}
                        >
                          {status.name}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Webhook Info */}
      <Card>
        <CardHeader>
          <CardTitle>Webhooks из amoCRM</CardTitle>
          <CardDescription>
            URL для настройки вебхуков в amoCRM
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">URL вебхука:</label>
              <div className="flex mt-1">
                <code className="flex-1 p-2 bg-muted rounded-l-md text-sm overflow-x-auto">
                  https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/amocrm-webhook
                </code>
                <Button
                  variant="secondary"
                  className="rounded-l-none"
                  onClick={() => {
                    navigator.clipboard.writeText(
                      "https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/amocrm-webhook"
                    );
                    toast.success("Скопировано");
                  }}
                >
                  Копировать
                </Button>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Добавьте этот URL в настройках вашей интеграции в amoCRM для получения
              уведомлений об изменениях сделок и контактов.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
