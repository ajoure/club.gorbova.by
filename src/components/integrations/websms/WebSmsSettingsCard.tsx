// ============================================================================
// WebSmsSettingsCard — карточка интеграции websms.by для вкладки «Разное».
// UI-паттерн повторяет VochiSettingsCard.
// ============================================================================

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  MessageSquare,
  Check,
  X,
  Settings,
  Trash2,
  Loader2,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
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
import { WebSmsSettingsDialog } from "./WebSmsSettingsDialog";
import { BulkSmsDialog } from "@/components/admin/sms/BulkSmsDialog";
import { Send } from "lucide-react";

const PROVIDER = "websms";

interface WebSmsState {
  enabled: boolean;
  hasApiKey: boolean;
  sender: string | null;
  status: string | null;
}

export function WebSmsSettingsCard() {
  const queryClient = useQueryClient();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["websms-card-state"],
    queryFn: async (): Promise<WebSmsState> => {
      const [{ data: integ }, { data: credRows }] = await Promise.all([
        supabase
          .from("integrations")
          .select("is_enabled")
          .eq("provider", PROVIDER)
          .maybeSingle(),
        supabase
          .from("integration_credentials")
          .select("config,secrets,status")
          .eq("provider", PROVIDER),
      ]);
      const merged = (credRows ?? []).reduce<{
        config: any;
        secrets: any;
        status: string | null;
      }>(
        (acc, row: any) => ({
          config: { ...acc.config, ...(row.config ?? {}) },
          secrets: { ...acc.secrets, ...(row.secrets ?? {}) },
          status: row.status ?? acc.status,
        }),
        { config: {}, secrets: {}, status: null },
      );
      return {
        enabled: !!(integ as any)?.is_enabled,
        hasApiKey: !!merged.secrets?.apikey,
        sender: merged.config?.sender ?? null,
        status: merged.status,
      };
    },
  });

  const isConfigured = !!data?.hasApiKey;
  const isOn = !!data?.enabled && isConfigured;

  const handleDelete = async () => {
    try {
      const [r1, r2] = await Promise.all([
        supabase.from("integration_credentials").delete().eq("provider", PROVIDER),
        supabase
          .from("integrations")
          .update({ is_enabled: false })
          .eq("provider", PROVIDER),
      ]);
      if (r1.error) throw r1.error;
      if (r2.error) throw r2.error;
      toast.success("Подключение websms удалено");
      setDeleteOpen(false);
      queryClient.invalidateQueries({ queryKey: ["websms-card-state"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Ошибка удаления");
    }
  };

  const badge = (() => {
    if (isLoading) return null;
    if (data?.status === "error") {
      return (
        <Badge variant="destructive">
          <X className="h-3 w-3 mr-1" /> Ошибка
        </Badge>
      );
    }
    if (isOn) {
      return (
        <Badge variant="default">
          <Check className="h-3 w-3 mr-1" /> Подключено
        </Badge>
      );
    }
    if (isConfigured) return <Badge variant="secondary">Отключена</Badge>;
    return <Badge variant="outline">Не настроена</Badge>;
  })();

  return (
    <>
      <Card className="relative overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div
                className={`p-2 rounded-lg ${isOn ? "bg-primary/10" : "bg-muted"}`}
              >
                <MessageSquare
                  className={`h-5 w-5 ${isOn ? "text-primary" : "text-muted-foreground"}`}
                />
              </div>
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  websms.by {badge}
                </CardTitle>
                <CardDescription className="text-sm mt-1">
                  SMS-рассылки: индивидуальные и массовые сообщения по контактам CRM
                </CardDescription>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="flex items-center text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Загрузка...
            </div>
          ) : isConfigured ? (
            <>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Отправитель:</span>
                  <span className="ml-2 font-medium">{data?.sender || "—"}</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => setBulkOpen(true)}
                  disabled={!isOn}
                  title={isOn ? "" : "Включите интеграцию в настройках"}
                >
                  <Send className="h-4 w-4 mr-2" />
                  Массовая рассылка
                </Button>
                <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
                  <Settings className="h-4 w-4 mr-2" />
                  Настройки
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Удалить
                </Button>
              </div>
            </>
          ) : (
            <div className="text-center py-4">
              <p className="text-muted-foreground mb-4">
                Подключите SMS-провайдера websms.by, чтобы отправлять SMS из карточек
                контактов и делать массовые рассылки.
              </p>
              <Button onClick={() => setSettingsOpen(true)}>
                <MessageSquare className="h-4 w-4 mr-2" />
                Подключить websms.by
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <WebSmsSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить подключение websms?</AlertDialogTitle>
            <AlertDialogDescription>
              Будут удалены сохранённые секреты и интеграция отключится. История
              отправленных SMS сохранится.
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
