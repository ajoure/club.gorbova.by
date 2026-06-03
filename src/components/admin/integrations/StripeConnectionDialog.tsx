// Phase 2 — Stripe Connection Settings Dialog
// Self-service form. Submits to acquiring-save-connection.
// SECURITY: secret_key & webhook_signing_secret are write-only — never preloaded
// or echoed back. Empty submit = "keep current".

import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { normalizeEdgeFunctionError } from "@/utils/normalizeEdgeFunctionError";

export interface AcquiringConnectionRow {
  id: string;
  provider: "stripe" | "bepaid";
  account_code: string;
  account_name: string;
  is_default: boolean;
  test_mode: boolean;
  status: "pending" | "active" | "disabled" | "invalid";
  publishable_key: string | null;
  success_url: string | null;
  cancel_url: string | null;
  locale: string | null;
  has_secret_key: boolean;
  has_webhook_secret: boolean;
  last_error: string | null;
  last_verified_at: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection?: AcquiringConnectionRow | null;
  /** UI-only PATCH: when creating a new connection, parent passes the list of
   * already-used Stripe account_code values so we can auto-suggest a unique one
   * (stripe_poland, stripe_poland_2, ...). */
  existingStripeCodes?: string[];
  onSaved: () => void;
}

function nextStripeAccountCode(existing: string[]): string {
  const base = "stripe_poland";
  if (!existing.includes(base)) return base;
  let i = 2;
  while (existing.includes(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

export function StripeConnectionDialog({ open, onOpenChange, connection, existingStripeCodes = [], onSaved }: Props) {
  const isEdit = !!connection?.id;
  const [accountName, setAccountName] = useState("Stripe Poland");
  const [accountCode, setAccountCode] = useState("stripe_poland");
  const [testMode] = useState(true); // Phase 2: locked to test
  const [publishableKey, setPublishableKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [successUrl, setSuccessUrl] = useState("");
  const [cancelUrl, setCancelUrl] = useState("");
  const [locale, setLocale] = useState("ru");
  const [isDefault, setIsDefault] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!open) return;
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    setAccountName(connection?.account_name ?? "Stripe Poland");
    setAccountCode(connection?.account_code ?? nextStripeAccountCode(existingStripeCodes));
    setPublishableKey(connection?.publishable_key ?? "");
    setSecretKey("");
    setWebhookSecret("");
    setSuccessUrl(
      connection?.success_url ??
        `${origin}/admin/integrations/payments?stripe_result=success`,
    );
    setCancelUrl(
      connection?.cancel_url ??
        `${origin}/admin/integrations/payments?stripe_result=cancel`,
    );
    setLocale(connection?.locale ?? "ru");
    setIsDefault(connection?.is_default ?? true);
  }, [open, connection, existingStripeCodes]);


  const handleSave = async (alsoTest = false) => {
    setSaving(true);
    try {
      const payload = {
        id: connection?.id,
        provider: "stripe" as const,
        account_code: accountCode.trim(),
        account_name: accountName,

        is_default: isDefault,
        test_mode: testMode,
        publishable_key: publishableKey || null,
        secret_key: secretKey || null,
        webhook_signing_secret: webhookSecret || null,
        success_url: successUrl || null,
        cancel_url: cancelUrl || null,
        locale,
      };
      const { data, error } = await supabase.functions.invoke("acquiring-save-connection", {
        body: payload,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "save_failed");
      toast.success("Подключение сохранено");
      const connection_id = data.connection_id;
      if (alsoTest && connection_id) {
        await handleTest(connection_id);
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(normalizeEdgeFunctionError(e, "Не удалось сохранить подключение"));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (idOverride?: string) => {
    const id = idOverride ?? connection?.id;
    if (!id) {
      toast.error("Сначала сохраните подключение");
      return;
    }
    setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("acquiring-test-connection", {
        body: { connection_id: id },
      });
      if (error) throw error;
      if (!data?.ok) {
        toast.error(`Проверка не пройдена: ${data?.code ?? "unknown"}`);
      } else {
        toast.success("Подключение проверено — Stripe доступен");
      }
      onSaved();
    } catch (e) {
      toast.error(normalizeEdgeFunctionError(e, "Ошибка проверки"));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Настройки Stripe</DialogTitle>
          <DialogDescription>
            Самостоятельное подключение Stripe-аккаунта. Ключи передаются на сервер
            и сохраняются в зашифрованном хранилище. Браузер их обратно не получает.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Название подключения</Label>
              <Input value={accountName} onChange={(e) => setAccountName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Account code</Label>
              <Input
                value={accountCode}
                onChange={(e) => setAccountCode(e.target.value.replace(/[^a-z0-9_]/gi, "_").toLowerCase())}
                disabled={isEdit}
                className="font-mono"
                placeholder="stripe_poland"
              />
              {!isEdit && (
                <p className="text-xs text-muted-foreground">
                  Уникальный код подключения. Можно подключить несколько Stripe-аккаунтов.
                </p>
              )}
            </div>

          </div>

          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Фаза 2: только <strong>test mode</strong>. Live будет включён отдельным согласованием.
            </AlertDescription>
          </Alert>

          <div className="space-y-1.5">
            <Label>Publishable key (pk_test_...)</Label>
            <Input
              value={publishableKey}
              onChange={(e) => setPublishableKey(e.target.value)}
              placeholder="pk_test_..."
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label>
              Secret key (sk_test_...) {connection?.has_secret_key && (
                <span className="text-xs text-emerald-600 ml-2">
                  <CheckCircle2 className="inline h-3 w-3" /> сохранён — оставьте пустым, чтобы не менять
                </span>
              )}
            </Label>
            <Input
              type="password"
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              placeholder={connection?.has_secret_key ? "••••• (текущее значение)" : "sk_test_..."}
              className="font-mono text-sm"
              autoComplete="off"
            />
          </div>

          <div className="space-y-1.5">
            <Label>
              Webhook signing secret (whsec_...) {connection?.has_webhook_secret && (
                <span className="text-xs text-emerald-600 ml-2">
                  <CheckCircle2 className="inline h-3 w-3" /> сохранён — оставьте пустым, чтобы не менять
                </span>
              )}
            </Label>
            <Input
              type="password"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              placeholder={connection?.has_webhook_secret ? "••••• (текущее значение)" : "whsec_..."}
              className="font-mono text-sm"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Это не API-ключ — это секрет для проверки подписи входящих webhook.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3">
            <div className="space-y-1.5">
              <Label>Success URL</Label>
              <Input value={successUrl} onChange={(e) => setSuccessUrl(e.target.value)} className="text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label>Cancel URL</Label>
              <Input value={cancelUrl} onChange={(e) => setCancelUrl(e.target.value)} className="text-sm" />
            </div>
          </div>

          <div className="flex items-center justify-between border rounded-md p-3">
            <div className="space-y-0.5">
              <Label>Подключение по умолчанию</Label>
              <p className="text-xs text-muted-foreground">Один true per provider</p>
            </div>
            <Switch checked={isDefault} onCheckedChange={setIsDefault} />
          </div>
        </div>

        <DialogFooter className="gap-2">
          {connection?.id && (
            <Button
              variant="outline"
              onClick={() => handleTest()}
              disabled={testing || saving}
            >
              {testing && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Проверить подключение
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={() => handleSave(true)} disabled={saving || testing}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Сохранить и проверить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
