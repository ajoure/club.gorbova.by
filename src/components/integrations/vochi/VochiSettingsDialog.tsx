// ============================================================================
// VochiSettingsDialog — модалка с полями credentials + webhook URL для VOCHI.
// SOT: integrations.is_enabled — флаг включения; integration_credentials —
// только секреты/конфиг (base_url, sip_code, client_id, api_token).
// onConflict использует канонический ключ (workspace_id, provider) с
// NULLS NOT DISTINCT — соответствует UNIQUE на обеих таблицах.
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
import { Copy, Loader2, Check, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useAdminUsers } from "@/hooks/useAdminUsers";

const PROVIDER = "vochi";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VochiSettingsDialog({ open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [baseUrl, setBaseUrl] = useState("https://bot.vochi.by");
  const [clientId, setClientId] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [sipCode, setSipCode] = useState("");
  const [copied, setCopied] = useState(false);

  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vochi-webhook`;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: integ }, { data: cred }] = await Promise.all([
        supabase
          .from("integrations")
          .select("is_enabled")
          .eq("provider", PROVIDER)
          .maybeSingle(),
        supabase
          .from("integration_credentials")
          .select("config,secrets")
          .eq("provider", PROVIDER)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      setEnabled(!!(integ as any)?.is_enabled);
      const c = (cred as any) ?? null;
      setBaseUrl(c?.config?.base_url || "https://bot.vochi.by");
      setSipCode(c?.config?.sip_code || "");
      setClientId(c?.secrets?.client_id || "");
      setApiToken(c?.secrets?.api_token || "");
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const copyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.success("Webhook URL скопирован");
    } catch {
      toast.error("Не удалось скопировать");
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const integPayload = {
        provider: PROVIDER,
        display_name: "VOCHI",
        is_enabled: enabled,
        config: {},
      };
      const credPayload = {
        provider: PROVIDER,
        display_name: "VOCHI",
        config: {
          base_url: baseUrl.trim().replace(/\/+$/, ""),
          sip_code: sipCode.trim(),
        },
        secrets: { client_id: clientId.trim(), api_token: apiToken.trim() },
        status: clientId.trim() ? "connected" : "pending",
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
      toast.success("Настройки VOCHI сохранены");
      queryClient.invalidateQueries({ queryKey: ["vochi-card-state"] });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">

        <DialogHeader>
          <DialogTitle>Настройки VOCHI</DialogTitle>
          <DialogDescription>
            Webhook принимает события звонков из панели VOCHI. Секреты используются
            для click-to-call и получения записей разговоров.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center text-sm text-muted-foreground py-6">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Загрузка...
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">
                Webhook URL (вставьте в поле «Эндпоинт» в панели VOCHI)
              </Label>
              <div className="flex gap-2">
                <Input value={webhookUrl} readOnly className="font-mono text-xs" />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={copyWebhook}
                  title="Скопировать"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="vochi-base-url" className="text-xs">
                  URL предприятия (base_url)
                </Label>
                <Input
                  id="vochi-base-url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://bot.vochi.by"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vochi-sip" className="text-xs">
                  SIP-code предприятия
                </Label>
                <Input
                  id="vochi-sip"
                  value={sipCode}
                  onChange={(e) => setSipCode(e.target.value)}
                  placeholder="напр. 0371"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vochi-client" className="text-xs">
                  clientId (secret предприятия)
                </Label>
                <Input
                  id="vochi-client"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="e37ac1e4a7dd4d378bfc869aa9dc345a"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vochi-token" className="text-xs">
                  API-токен (для получения записей)
                </Label>
                <Input
                  id="vochi-token"
                  type="password"
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2 border-t">
              <Switch
                id="vochi-enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
              />
              <Label htmlFor="vochi-enabled" className="text-sm cursor-pointer">
                Интеграция включена
              </Label>
            </div>

            <StaffSipSection />
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
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
