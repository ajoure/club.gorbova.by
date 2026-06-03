// Phase 2 — Stripe Connection Settings Dialog
// Self-service form. Submits to acquiring-save-connection.
// SECURITY: secret_key & webhook_signing_secret are write-only — never preloaded
// or echoed back. Empty submit = "keep current".

import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, AlertCircle, CheckCircle2, Copy } from "lucide-react";
import { toast } from "sonner";
import { normalizeEdgeFunctionError } from "@/utils/normalizeEdgeFunctionError";
import { PUBLIC_APP_HOST, isForbiddenRedirectUrl, isCurrentHostPreview } from "@/utils/publicAppHost";

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

/** Map server-side error codes to Russian messages. */
function translateServerError(raw: string): string {
  if (/live_mode_disabled/i.test(raw)) {
    return "Боевой режим Stripe отключён в Фазе 2. Сейчас доступен только тестовый режим.";
  }
  if (/forbidden_redirect_host/i.test(raw)) {
    return "URL после оплаты не должен указывать на preview-домен или Supabase Edge Function. Используйте домен сайта (например, gorbova.by).";
  }
  if (/mode_mismatch|invalid_publishable_key_prefix|invalid_secret_key_prefix/i.test(raw)) {
    return "Ключ не соответствует выбранному режиму Stripe. Для тестового режима используйте ключи с префиксом pk_test / sk_test.";
  }
  if (/invalid_webhook_secret_prefix/i.test(raw)) {
    return "Секрет подписи webhook должен начинаться с whsec_.";
  }
  return raw;
}

export function StripeConnectionDialog({ open, onOpenChange, connection, existingStripeCodes = [], onSaved }: Props) {
  const isEdit = !!connection?.id;
  const [accountName, setAccountName] = useState("Stripe Poland");
  const [accountCode, setAccountCode] = useState("stripe_poland");
  // Фаза 2: режим залочен на «test». Боевой режим в UI disabled.
  const [mode, setMode] = useState<"test" | "live">("test");
  const [publishableKey, setPublishableKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [successUrl, setSuccessUrl] = useState("");
  const [cancelUrl, setCancelUrl] = useState("");
  const [locale, setLocale] = useState("ru");
  const [isDefault, setIsDefault] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const projectId = (import.meta as any)?.env?.VITE_SUPABASE_PROJECT_ID ?? "";
  const webhookUrl = useMemo(
    () => (projectId ? `https://${projectId}.supabase.co/functions/v1/stripe-webhook` : ""),
    [projectId],
  );

  useEffect(() => {
    if (!open) return;
    setAccountName(connection?.account_name ?? "Stripe Poland");
    setAccountCode(connection?.account_code ?? nextStripeAccountCode(existingStripeCodes));
    setMode(connection?.test_mode === false ? "live" : "test");
    setPublishableKey(connection?.publishable_key ?? "");
    setSecretKey("");
    setWebhookSecret("");
    setSuccessUrl(
      connection?.success_url ??
        `${PUBLIC_APP_HOST}/admin/integrations/payments?stripe_result=success`,
    );
    setCancelUrl(
      connection?.cancel_url ??
        `${PUBLIC_APP_HOST}/admin/integrations/payments?stripe_result=cancel`,
    );
    setLocale(connection?.locale ?? "ru");
    setIsDefault(connection?.is_default ?? true);
  }, [open, connection, existingStripeCodes]);

  const successUrlError = isForbiddenRedirectUrl(successUrl)
    ? "Этот домен нельзя использовать для возврата клиента (preview / Supabase / localhost)."
    : null;
  const cancelUrlError = isForbiddenRedirectUrl(cancelUrl)
    ? "Этот домен нельзя использовать для возврата клиента (preview / Supabase / localhost)."
    : null;

  const handleSave = async (alsoTest = false) => {
    if (successUrlError || cancelUrlError) {
      toast.error("Проверьте URL после оплаты и URL после отмены оплаты.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        id: connection?.id,
        provider: "stripe" as const,
        account_code: accountCode.trim(),
        account_name: accountName,
        is_default: isDefault,
        test_mode: mode === "test",
        publishable_key: publishableKey.trim() || null,
        secret_key: secretKey.trim() || null,
        webhook_signing_secret: webhookSecret.trim() || null,
        success_url: successUrl || null,
        cancel_url: cancelUrl || null,
        locale,
      };
      const { data, error } = await supabase.functions.invoke("acquiring-save-connection", {
        body: payload,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "save_failed");
      toast.success("Подключение Stripe сохранено");
      const connection_id = data.connection_id;
      if (alsoTest && connection_id) {
        await handleTest(connection_id);
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      const raw = normalizeEdgeFunctionError(e, "Не удалось сохранить подключение");
      toast.error(translateServerError(raw));
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
        toast.error(`Проверка не пройдена: ${data?.code ?? "неизвестная ошибка"}`);
      } else {
        toast.success("Подключение проверено — Stripe доступен");
      }
      onSaved();
    } catch (e) {
      toast.error(normalizeEdgeFunctionError(e, "Ошибка проверки подключения"));
    } finally {
      setTesting(false);
    }
  };

  const copyWebhook = async () => {
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      toast.success("URL для webhook скопирован");
    } catch {
      toast.error("Не удалось скопировать URL");
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
              <p className="text-xs text-muted-foreground">
                Произвольное название для удобства администратора.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Внутренний код подключения</Label>
              <Input
                value={accountCode}
                onChange={(e) => setAccountCode(e.target.value.replace(/[^a-z0-9_]/gi, "_").toLowerCase())}
                disabled={isEdit}
                className="font-mono"
                placeholder="stripe_poland"
              />
              <p className="text-xs text-muted-foreground">
                {isEdit
                  ? "Код подключения изменить нельзя."
                  : "Уникальный код. Можно подключить несколько Stripe-аккаунтов."}
              </p>
            </div>
          </div>

          {/* Режим Stripe */}
          <div className="space-y-2 border rounded-md p-3">
            <Label>Режим Stripe</Label>
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as "test" | "live")} className="space-y-2">
              <div className="flex items-start gap-2">
                <RadioGroupItem value="test" id="stripe-mode-test" className="mt-0.5" />
                <Label htmlFor="stripe-mode-test" className="font-normal cursor-pointer">
                  <span className="font-medium">Тестовый режим</span>
                  <span className="block text-xs text-muted-foreground">
                    Для проверки оплаты без реального списания денег. Ключи тестового режима Stripe: pk_test_… и sk_test_…
                  </span>
                </Label>
              </div>
              <div className="flex items-start gap-2 opacity-60">
                <RadioGroupItem value="live" id="stripe-mode-live" disabled className="mt-0.5" />
                <Label htmlFor="stripe-mode-live" className="font-normal cursor-not-allowed">
                  <span className="font-medium">Боевой режим</span>
                  <span className="block text-xs text-muted-foreground">
                    Для реальных платежей. Ключи боевого режима Stripe: pk_live_… и sk_live_… Live-режим будет включён отдельным согласованием после sandbox-проверки.
                  </span>
                </Label>
              </div>
            </RadioGroup>
            <p className="text-xs text-muted-foreground pt-1">
              Stripe-аккаунт реальный. В тестовом режиме Stripe платежи проверяются без реального списания денег.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Публичный ключ Stripe</Label>
            <Input
              value={publishableKey}
              onChange={(e) => setPublishableKey(e.target.value)}
              placeholder="pk_test_..."
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Используется для публичных клиентских сценариев Stripe. Не является секретом.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>
              Секретный ключ Stripe {connection?.has_secret_key && (
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
            <p className="text-xs text-muted-foreground">
              Используется сервером для создания платежей. В браузер не возвращается.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>
              Секрет подписи webhook {connection?.has_webhook_secret && (
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
              Нужен для проверки, что уведомления действительно пришли от Stripe.
            </p>
          </div>

          {/* Webhook URL (read-only) */}
          {webhookUrl && (
            <div className="space-y-1.5 border rounded-md p-3 bg-muted/40">
              <Label>URL для webhook в Stripe Dashboard</Label>
              <div className="flex gap-2">
                <Input value={webhookUrl} readOnly className="font-mono text-xs" />
                <Button type="button" variant="outline" size="sm" onClick={copyWebhook}>
                  <Copy className="h-3.5 w-3.5 mr-1" /> Копировать
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Это server-to-server endpoint, клиент его не видит. Вставьте этот URL в Stripe Dashboard → Developers → Webhooks. Полученный <code>whsec_…</code> вставьте в поле «Секрет подписи webhook» выше.
              </p>
            </div>
          )}

          {isCurrentHostPreview() && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Сейчас открыт preview-домен. Для реальных платежей будут использоваться URL основного сайта ({PUBLIC_APP_HOST.replace("https://", "")}).
              </AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-1 gap-3">
            <div className="space-y-1.5">
              <Label>URL после успешной оплаты</Label>
              <Input
                value={successUrl}
                onChange={(e) => setSuccessUrl(e.target.value)}
                className="text-sm"
                placeholder={`${PUBLIC_APP_HOST}/dashboard?payment=success`}
              />
              {successUrlError ? (
                <p className="text-xs text-destructive">{successUrlError}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Куда клиент вернётся после оплаты. Используйте домен сайта, не указывайте Supabase или preview-домен.
                  Для клиентских платежей рекомендуется <code>{PUBLIC_APP_HOST}/dashboard?payment=success</code>.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>URL после отмены оплаты</Label>
              <Input
                value={cancelUrl}
                onChange={(e) => setCancelUrl(e.target.value)}
                className="text-sm"
                placeholder={`${PUBLIC_APP_HOST}/pricing?payment=cancel`}
              />
              {cancelUrlError ? (
                <p className="text-xs text-destructive">{cancelUrlError}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Куда клиент вернётся, если отменит оплату. Рекомендуется{" "}
                  <code>{PUBLIC_APP_HOST}/pricing?payment=cancel</code>.
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Язык писем/чеков</Label>
              <Input value={locale} onChange={(e) => setLocale(e.target.value)} placeholder="ru" />
              <p className="text-xs text-muted-foreground">
                Код языка для писем Stripe и квитанций (например, ru, en).
              </p>
            </div>
            <div className="flex items-center justify-between border rounded-md p-3">
              <div className="space-y-0.5">
                <Label>Подключение по умолчанию</Label>
                <p className="text-xs text-muted-foreground">Один по умолчанию на провайдера.</p>
              </div>
              <Switch checked={isDefault} onCheckedChange={setIsDefault} />
            </div>
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
