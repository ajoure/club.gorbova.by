// ============================================================================
// VochiSettingsCard — карточка интеграции VOCHI для вкладки «Разное»
// (страница /admin/integrations). UI-паттерн: компактный заголовок со статусом
// (Подключено / Не настроена / Отключена), действия Проверить / Настройки /
// Удалить — единообразно с Kinescope, hoster.by и пр.
// SOT: integrations.is_enabled (включение), integration_credentials (секреты).
// ============================================================================

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Phone, Check, X, RefreshCw, Settings, Trash2, Loader2 } from "lucide-react";
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
import { VochiSettingsDialog } from "./VochiSettingsDialog";

const PROVIDER = "vochi";

interface VochiState {
  enabled: boolean;
  hasClientId: boolean;
  baseUrl: string | null;
  lastCheckedAt: string | null;
  status: string | null;
}

export function VochiSettingsCard() {
  const queryClient = useQueryClient();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [checking, setChecking] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["vochi-card-state"],
    queryFn: async (): Promise<VochiState> => {
      const [{ data: integ }, { data: cred }] = await Promise.all([
        supabase
          .from("integrations")
          .select("is_enabled")
          .eq("provider", PROVIDER)
          .maybeSingle(),
        supabase
          .from("integration_credentials")
          .select("config,secrets,status,last_checked_at")
          .eq("provider", PROVIDER)
          .maybeSingle(),
      ]);
      const c = (cred as any) ?? null;
      return {
        enabled: !!(integ as any)?.is_enabled,
        hasClientId: !!c?.secrets?.client_id,
        baseUrl: c?.config?.base_url ?? null,
        lastCheckedAt: c?.last_checked_at ?? null,
        status: c?.status ?? null,
      };
    },
  });

  const isConfigured = !!data?.hasClientId;
  const isOn = !!data?.enabled && isConfigured;

  const handleCheck = async () => {
    if (!isConfigured) {
      toast.info("Сначала заполните настройки VOCHI");
      return;
    }
    setChecking(true);
    try {
      const probeUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vochi-webhook`;
      // Достаточно убедиться, что webhook-функция отвечает (200 на OPTIONS/POST).
      const res = await fetch(probeUrl, { method: "OPTIONS" });
      const ok = res.ok || res.status === 204;
      const stamp = new Date().toISOString();
      await supabase
        .from("integration_credentials")
        .update({
          status: ok ? "connected" : "error",
          last_checked_at: stamp,
          last_error: ok ? null : `webhook HTTP ${res.status}`,
        })
        .eq("provider", PROVIDER);
      queryClient.invalidateQueries({ queryKey: ["vochi-card-state"] });
      toast[ok ? "success" : "error"](
        ok ? "Webhook VOCHI отвечает" : `Webhook недоступен (HTTP ${res.status})`,
      );
    } catch (e: any) {
      toast.error(e?.message ?? "Ошибка проверки");
    } finally {
      setChecking(false);
    }
  };

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
      toast.success("Подключение VOCHI удалено");
      setDeleteOpen(false);
      queryClient.invalidateQueries({ queryKey: ["vochi-card-state"] });
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
    if (isConfigured) {
      return <Badge variant="secondary">Отключена</Badge>;
    }
    return <Badge variant="outline">Не настроена</Badge>;
  })();

  return (
    <>
      <Card className="relative overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${isOn ? "bg-primary/10" : "bg-muted"}`}>
                <Phone className={`h-5 w-5 ${isOn ? "text-primary" : "text-muted-foreground"}`} />
              </div>
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  VOCHI {badge}
                </CardTitle>
                <CardDescription className="text-sm mt-1">
                  Облачная телефония: входящие/исходящие звонки и запись разговоров
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
                  <span className="text-muted-foreground">URL:</span>
                  <span className="ml-2 font-medium">{data?.baseUrl || "—"}</span>
                </div>
                {data?.lastCheckedAt && (
                  <div>
                    <span className="text-muted-foreground">Проверено:</span>
                    <span className="ml-2 font-medium">
                      {new Date(data.lastCheckedAt).toLocaleDateString("ru-RU", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={handleCheck} disabled={checking}>
                  <RefreshCw className={`h-4 w-4 mr-2 ${checking ? "animate-spin" : ""}`} />
                  Проверить
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
                Подключите облачную телефонию VOCHI: входящие/исходящие звонки с записью разговоров и привязкой к карточкам CRM.
              </p>
              <Button onClick={() => setSettingsOpen(true)}>
                <Phone className="h-4 w-4 mr-2" />
                Подключить VOCHI
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <VochiSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить подключение VOCHI?</AlertDialogTitle>
            <AlertDialogDescription>
              Будут удалены сохранённые секреты и интеграция отключится. История звонков сохранится. Это действие нельзя отменить.
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
