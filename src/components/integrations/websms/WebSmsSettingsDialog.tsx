// ============================================================================
// WebSmsSettingsDialog — настройки интеграции с SMS.by.
// Поля: token (API-ключ), alphaname (отображаемое имя), alphaname_id (числовой
// идентификатор отправителя из кабинета SMS.by, опционально).
// Внутренний provider-ключ оставлен 'websms' для обратной совместимости с
// сохранёнными записями integration_credentials/integrations.
// ============================================================================

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

const PROVIDER = "websms";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WebSmsSettingsDialog({ open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [token, setToken] = useState("");
  const [alphaname, setAlphaname] = useState("");
  const [alphanameId, setAlphanameId] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: integ }, { data: credRows }] = await Promise.all([
        supabase
          .from("integrations")
          .select("is_enabled")
          .eq("provider", PROVIDER)
          .maybeSingle(),
        supabase
          .from("integration_credentials")
          .select("config,secrets")
          .eq("provider", PROVIDER),
      ]);
      if (cancelled) return;
      setEnabled(!!(integ as any)?.is_enabled);
      const merged = (credRows ?? []).reduce<{ config: any; secrets: any }>(
        (acc, row: any) => ({
          config: { ...acc.config, ...(row.config ?? {}) },
          secrets: { ...acc.secrets, ...(row.secrets ?? {}) },
        }),
        { config: {}, secrets: {} },
      );
      setToken(merged.secrets?.token || merged.secrets?.apikey || "");
      setAlphaname(merged.config?.alphaname || merged.config?.sender || "");
      setAlphanameId(
        merged.config?.alphaname_id != null
          ? String(merged.config.alphaname_id)
          : "",
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const save = async () => {
    setSaving(true);
    try {
      const integPayload = {
        provider: PROVIDER,
        display_name: "SMS.by",
        is_enabled: enabled,
        config: {},
      };
      const credPayload = {
        provider: PROVIDER,
        display_name: "SMS.by",
        config: {
          base_url: "https://app.sms.by",
          alphaname: alphaname.trim(),
          alphaname_id: alphanameId.trim() || null,
        },
        secrets: { token: token.trim() },
        status: token.trim() ? "connected" : "pending",
      };
      const [r1, r2] = await Promise.all([
        supabase
          .from("integrations")
          .upsert(integPayload, { onConflict: "workspace_id,provider" }),
        supabase
          .from("integration_credentials")
          .upsert(credPayload, { onConflict: "workspace_id,provider" }),
      ]);
      if (r1.error) throw r1.error;
      if (r2.error) throw r2.error;
      toast.success("Настройки SMS.by сохранены");
      queryClient.invalidateQueries({ queryKey: ["websms-card-state"] });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Настройки SMS.by</DialogTitle>
          <DialogDescription>
            API-токен из личного кабинета SMS.by (раздел «API»). Имя отправителя
            (alphaname) и его числовой ID — опционально, если используете брендовое
            имя.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Загрузка...
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="smsby-token" className="text-xs">
                API-токен
              </Label>
              <Input
                id="smsby-token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="••••••••"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Получить токен:{" "}
                <a
                  href="https://sms.by/cabinet/api"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  sms.by → Кабинет → API
                </a>
                .
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="smsby-alphaname" className="text-xs">
                  Alphaname (имя)
                </Label>
                <Input
                  id="smsby-alphaname"
                  value={alphaname}
                  onChange={(e) => setAlphaname(e.target.value)}
                  placeholder="напр. GorbovaCo"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="smsby-alphaname-id" className="text-xs">
                  Alphaname ID
                </Label>
                <Input
                  id="smsby-alphaname-id"
                  value={alphanameId}
                  onChange={(e) => setAlphanameId(e.target.value)}
                  placeholder="напр. 12345"
                  inputMode="numeric"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground -mt-2">
              Если ID не указан — SMS уйдут с системного отправителя SMS.by.
            </p>

            <div className="flex items-center gap-3 pt-2 border-t">
              <Switch
                id="smsby-enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
              />
              <Label htmlFor="smsby-enabled" className="text-sm cursor-pointer">
                Интеграция включена
              </Label>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={save} disabled={saving || loading || !token.trim()}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

