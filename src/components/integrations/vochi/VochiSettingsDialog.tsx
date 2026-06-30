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

function StaffSipSection() {
  const { users, loading } = useAdminUsers();
  const [query, setQuery] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [localSip, setLocalSip] = useState<Record<string, string | null>>({});

  const staff = (users ?? []).filter((u) => (u.roles?.length ?? 0) > 0);
  const q = query.trim().toLowerCase();
  const filtered = q
    ? staff.filter(
        (u) =>
          (u.full_name ?? "").toLowerCase().includes(q) ||
          (u.email ?? "").toLowerCase().includes(q),
      )
    : staff;

  const save = async (userId: string, value: string, prev: string | null) => {
    const next = value.trim() || null;
    if (next === (prev ?? null)) return;
    if (next && !/^\d{2,8}$/.test(next)) {
      toast.error("SIP-номер: только цифры, 2–8 знаков");
      return;
    }
    setSavingId(userId);
    const { error } = await supabase
      .from("profiles")
      .update({ vochi_sip_extension: next })
      .eq("user_id", userId);
    setSavingId(null);
    if (error) {
      toast.error("Не удалось сохранить: " + error.message);
      return;
    }
    setLocalSip((p) => ({ ...p, [userId]: next }));
    toast.success(next ? `SIP-номер сохранён: ${next}` : "SIP-номер очищен");
  };

  return (
    <div className="space-y-3 pt-4 border-t">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Label className="text-sm font-medium">SIP-номера сотрудников</Label>
          <p className="text-xs text-muted-foreground">
            Внутренний номер VOCHI для каждого сотрудника — используется как
            caller при click-to-call.
          </p>
        </div>
      </div>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по имени или email..."
          className="pl-8 h-9 text-sm"
        />
      </div>
      <div className="max-h-72 overflow-y-auto rounded-lg border border-border/40 divide-y divide-border/30">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Загрузка...
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">
            Сотрудники не найдены
          </div>
        ) : (
          filtered.map((u) => {
            const current =
              localSip[u.user_id] !== undefined
                ? localSip[u.user_id]
                : u.vochi_sip_extension;
            return (
              <div
                key={u.user_id}
                className="flex items-center gap-3 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">
                    {u.full_name || "—"}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {u.email}
                  </div>
                </div>
                <div className="relative">
                  <Input
                    defaultValue={current ?? ""}
                    placeholder="напр. 150"
                    maxLength={8}
                    className="h-8 w-[120px] font-mono text-sm"
                    onBlur={(e) => save(u.user_id, e.target.value, current)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter")
                        (e.target as HTMLInputElement).blur();
                    }}
                  />
                  {savingId === u.user_id && (
                    <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
