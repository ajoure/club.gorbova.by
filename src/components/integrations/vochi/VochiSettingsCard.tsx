// ============================================================================
// VochiSettingsCard — карточка интеграции VOCHI (телефония) на /admin/integrations
// CRM-вкладка. Показывает webhook URL для копирования (вставляется в поле
// «Эндпоинт» в панели VOCHI API), позволяет редактировать base_url, clientId,
// api_token (для записей), sip_code, и переключает integrations.is_enabled.
// SOT: integrations.is_enabled — флаг включения; integration_credentials —
// только секреты/конфиг подключения (PATCH-INTEGRATIONS-SOT).
// ============================================================================

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Phone, Copy, Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const PROVIDER = "vochi";

interface CredentialsRow {
  id?: string;
  config: { base_url?: string; sip_code?: string } | null;
  secrets: { client_id?: string; api_token?: string } | null;
}

interface IntegrationRow {
  id?: string;
  is_enabled: boolean;
}

export function VochiSettingsCard() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [baseUrl, setBaseUrl] = useState("https://bot.vochi.by");
  const [clientId, setClientId] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [sipCode, setSipCode] = useState("");
  const [copied, setCopied] = useState(false);

  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vochi-webhook`;

  const load = async () => {
    setLoading(true);
    const [{ data: integ }, { data: cred }] = await Promise.all([
      supabase.from("integrations").select("id,is_enabled").eq("provider", PROVIDER).maybeSingle(),
      supabase
        .from("integration_credentials")
        .select("id,config,secrets")
        .eq("provider", PROVIDER)
        .maybeSingle(),
    ]);
    setEnabled(!!(integ as IntegrationRow | null)?.is_enabled);
    const c = (cred as CredentialsRow | null) ?? null;
    setBaseUrl(c?.config?.base_url || "https://bot.vochi.by");
    setSipCode(c?.config?.sip_code || "");
    setClientId(c?.secrets?.client_id || "");
    setApiToken(c?.secrets?.api_token || "");
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

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
        config: { base_url: baseUrl.trim().replace(/\/+$/, ""), sip_code: sipCode.trim() },
        secrets: { client_id: clientId.trim(), api_token: apiToken.trim() },
        status: clientId.trim() ? "connected" : "pending",
      };
      const [r1, r2] = await Promise.all([
        supabase.from("integrations").upsert(integPayload, { onConflict: "provider" }),
        supabase
          .from("integration_credentials")
          .upsert(credPayload, { onConflict: "provider" }),
      ]);
      if (r1.error) throw r1.error;
      if (r2.error) throw r2.error;
      toast.success("Настройки VOCHI сохранены");
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const isConfigured = !!clientId;

  return (
    <Card className="relative overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${enabled ? "bg-primary/10" : "bg-muted"}`}>
              <Phone className={`h-5 w-5 ${enabled ? "text-primary" : "text-muted-foreground"}`} />
            </div>
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                VOCHI
                <Badge variant={enabled ? "default" : isConfigured ? "secondary" : "outline"}>
                  {enabled ? "Включена" : isConfigured ? "Настроена" : "Не настроена"}
                </Badge>
              </CardTitle>
              <CardDescription className="text-sm mt-1">
                Облачная телефония: входящие/исходящие звонки и запись разговоров
              </CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Загрузка...
          </div>
        ) : (
          <>
            {/* Webhook URL */}
            <div className="space-y-1.5">
              <Label className="text-xs">Webhook URL (вставьте в поле «Эндпоинт» в панели VOCHI)</Label>
              <div className="flex gap-2">
                <Input value={webhookUrl} readOnly className="font-mono text-xs" />
                <Button type="button" variant="outline" size="icon" onClick={copyWebhook} title="Скопировать">
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {/* Credentials */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="vochi-base-url" className="text-xs">URL предприятия (base_url)</Label>
                <Input
                  id="vochi-base-url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://bot.vochi.by"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vochi-sip" className="text-xs">SIP-code (общий для предприятия)</Label>
                <Input
                  id="vochi-sip"
                  value={sipCode}
                  onChange={(e) => setSipCode(e.target.value)}
                  placeholder="напр. 0371"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vochi-client" className="text-xs">clientId (secret предприятия)</Label>
                <Input
                  id="vochi-client"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="e37ac1e4a7dd4d378bfc869aa9dc345a"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vochi-token" className="text-xs">API-токен для получения записей</Label>
                <Input
                  id="vochi-token"
                  type="password"
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t">
              <div className="flex items-center gap-3">
                <Switch id="vochi-enabled" checked={enabled} onCheckedChange={setEnabled} />
                <Label htmlFor="vochi-enabled" className="text-sm cursor-pointer">
                  Интеграция включена
                </Label>
              </div>
              <Button onClick={save} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Сохранить
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
