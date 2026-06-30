// ============================================================================
// WebSmsSettingsDialog — настройки интеграции с websms.by.
// Поля: login (user), apikey, sender (alphaname), base_url.
// SOT: integrations.is_enabled — флаг включения; integration_credentials —
// секреты и конфиг (NULLS NOT DISTINCT по (workspace_id, provider)).
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
  const [baseUrl, setBaseUrl] = useState("https://cp.websms.by");
  const [login, setLogin] = useState("");
  const [apikey, setApikey] = useState("");
  const [sender, setSender] = useState("");

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
      setBaseUrl(merged.config?.base_url || "https://cp.websms.by");
      setLogin(merged.secrets?.user || merged.config?.user || "");
      setApikey(merged.secrets?.apikey || "");
      setSender(merged.config?.sender || "");
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
        display_name: "websms.by",
        is_enabled: enabled,
        config: {},
      };
      const credPayload = {
        provider: PROVIDER,
        display_name: "websms.by",
        config: {
          base_url: baseUrl.trim().replace(/\/+$/, ""),
          sender: sender.trim(),
        },
        secrets: { user: login.trim(), apikey: apikey.trim() },
        status: login.trim() && apikey.trim() ? "connected" : "pending",
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
      toast.success("Настройки websms сохранены");
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
          <DialogTitle>Настройки websms.by</DialogTitle>
          <DialogDescription>
            Логин, API-ключ и имя отправителя (alphaname), зарегистрированные в кабинете
            websms.by.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Загрузка...
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="websms-base" className="text-xs">
                URL API
              </Label>
              <Input
                id="websms-base"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://cp.websms.by"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="websms-user" className="text-xs">
                  Логин (user)
                </Label>
                <Input
                  id="websms-user"
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  placeholder="login"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="websms-apikey" className="text-xs">
                  API-key
                </Label>
                <Input
                  id="websms-apikey"
                  type="password"
                  value={apikey}
                  onChange={(e) => setApikey(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="websms-sender" className="text-xs">
                Имя отправителя (alphaname)
              </Label>
              <Input
                id="websms-sender"
                value={sender}
                onChange={(e) => setSender(e.target.value)}
                placeholder="напр. GorbovaCo"
              />
              <p className="text-xs text-muted-foreground">
                Alphaname должен быть зарегистрирован у websms.by, иначе сообщения не
                будут доставлены.
              </p>
            </div>

            <div className="flex items-center gap-3 pt-2 border-t">
              <Switch
                id="websms-enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
              />
              <Label htmlFor="websms-enabled" className="text-sm cursor-pointer">
                Интеграция включена
              </Label>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={save} disabled={saving || loading}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
