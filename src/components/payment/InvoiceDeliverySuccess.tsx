/**
 * InvoiceDeliverySuccess — success-состояние выпуска счёта.
 * Общее для InvoiceCheckoutDialog (публичный /cb) и AdminPaymentLinkDialog.
 *
 * Показывает отдельные статусы: PDF, Email, Telegram. Кнопка «Скачать PDF»
 * активна только когда бэкенд подтвердил pdf_ready. По каждому каналу видно
 * queued / sent / error / not_linked / no_recipient. Retry-кнопка появляется
 * только для error.
 *
 * Polling — invoice-delivery-status раз в 3 с, до 40 попыток (~2 мин). Как
 * только оба канала перешли в финальное состояние и PDF готов — polling
 * останавливается.
 *
 * Никакого ложного текста «отправлено» пока бэкенд не подтвердит.
 */
import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Download,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { downloadDocumentBlob } from "@/utils/downloadDocumentBlob";
import {
  isDeliveryFinal,
  type ChannelState,
  type DeliveryStatusResponse,
} from "@/lib/invoiceDelivery";

function formatDate(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${d.getFullYear()}`;
}

export interface InvoiceDeliverySuccessProps {
  documentId: string | null;
  invoiceNumber: string;
  documentNumber: string | null;
  documentIssuedAt: string | null;
  onClose: () => void;
  /**
   * "dialog"    — используется внутри многошагового DialogContent (footer с sticky).
   * "embedded"  — рендерится внутри другого диалога/панели без DialogContent.
   */
  layout?: "dialog" | "embedded";
  /**
   * ID заказа. Нужен для UI-кнопки «Повторить генерацию PDF», когда
   * первичная попытка не создала documentId (баг ORD-26-02829). Idempotent
   * retry через edge function `invoice-pdf-retry` (без дублей заказа).
   */
  orderId?: string | null;
  /**
   * Колбэк — вызывается когда retry успешно вернул documentId (родитель
   * может обновить своё состояние invoiceIssueResult, чтобы polling работал).
   */
  onDocumentReady?: (result: {
    document_id: string;
    document_number: string | null;
    document_issued_at: string | null;
  }) => void;
}

export function InvoiceDeliverySuccess({
  documentId,
  invoiceNumber,
  documentNumber,
  documentIssuedAt,
  onClose,
  layout = "dialog",
  orderId,
  onDocumentReady,
}: InvoiceDeliverySuccessProps) {
  const displayNumber = documentNumber ?? invoiceNumber;
  const displayDate = formatDate(documentIssuedAt);
  const purposeText = `Оплата по счёту №${displayNumber} от ${displayDate}`;

  const [status, setStatus] = useState<DeliveryStatusResponse | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [retrying, setRetrying] = useState<"email" | "telegram" | null>(null);
  const [retryingPdf, setRetryingPdf] = useState(false);
  const [pdfRetryError, setPdfRetryError] = useState<string | null>(null);


  const canPoll = !!documentId;

  const pollTick = async (): Promise<DeliveryStatusResponse | null> => {
    if (!documentId) return null;
    try {
      const { data, error } = await supabase.functions.invoke(
        "invoice-delivery-status",
        { body: { document_id: documentId } },
      );
      if (error) {
        setStatusError(error.message || "status_error");
        return null;
      }
      setStatusError(null);
      setStatus(data as DeliveryStatusResponse);
      return data as DeliveryStatusResponse;
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : "status_error");
      return null;
    }
  };

  useEffect(() => {
    if (!canPoll) return;
    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 40;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      if (cancelled) return;
      attempts += 1;
      const fresh = await pollTick();
      if (cancelled) return;
      if (fresh && isDeliveryFinal(fresh)) return;
      if (attempts >= MAX_ATTEMPTS) return;
      timer = setTimeout(loop, 3000);
    };
    loop();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  async function handleDownload() {
    if (!documentId || !status?.pdf_ready) return;
    setDownloading(true);
    try {
      const r = await downloadDocumentBlob(documentId, "pdf");
      if (r.ok === false) toast.error(r.message);
      else toast.success("Скачивание началось");
    } finally {
      setDownloading(false);
    }
  }

  async function handleRetry(channel: "email" | "telegram") {
    if (!documentId) return;
    setRetrying(channel);
    try {
      const { data, error } = await supabase.functions.invoke(
        "invoice-delivery-retry",
        { body: { document_id: documentId, channel } },
      );
      if (error) {
        toast.error(error.message || "Не удалось повторить отправку");
      } else if ((data as any)?.already_sent) {
        toast.success("Уже отправлено");
      } else if ((data as any)?.ok) {
        toast.success(
          channel === "email" ? "Email отправлен повторно" : "Отправлено в Telegram",
        );
      } else {
        toast.error(`Ошибка: ${(data as any)?.error || "неизвестно"}`);
      }
      await pollTick();
    } finally {
      setRetrying(null);
    }
  }

  async function handleRetryPdf() {
    if (!orderId || retryingPdf) return;
    setRetryingPdf(true);
    setPdfRetryError(null);
    try {
      const { data, error } = await supabase.functions.invoke(
        "invoice-pdf-retry",
        { body: { order_id: orderId } },
      );
      if (error) {
        setPdfRetryError(error.message || "Не удалось сформировать PDF");
        toast.error(error.message || "Не удалось сформировать PDF");
        return;
      }
      const payload = data as any;
      if (payload?.ok && payload.document_id) {
        toast.success("PDF сформирован");
        onDocumentReady?.({
          document_id: payload.document_id,
          document_number: payload.document_number ?? null,
          document_issued_at: payload.document_issued_at ?? null,
        });
      } else {
        const msg = payload?.error || "generation_failed";
        setPdfRetryError(msg);
        toast.error(`Ошибка PDF: ${msg}`);
      }
    } catch (e) {
      const msg = (e as Error).message || "network_error";
      setPdfRetryError(msg);
      toast.error(msg);
    } finally {
      setRetryingPdf(false);
    }
  }

  const rootBody = "space-y-4";
  const wrapBody =
    layout === "dialog"
      ? `flex-1 overflow-y-auto px-6 py-4 ${rootBody}`
      : rootBody;
  const wrapFooter =
    layout === "dialog"
      ? "shrink-0 border-t bg-background px-6 py-3 flex flex-col sm:flex-row gap-2"
      : "pt-4 border-t flex flex-col sm:flex-row gap-2";

  if (!documentId) {
    return (
      <>
        <div className={wrapBody + " text-center"}>
          <div className="flex justify-center">
            <AlertCircle className="h-12 w-12 text-amber-500" />
          </div>
          <div>
            <div className="text-lg font-semibold">
              Счёт № {displayNumber} создан, но PDF не удалось сформировать
            </div>
            <div className="text-sm text-muted-foreground mt-1">
              {orderId
                ? "Заказ уже сохранён — попробуйте сформировать PDF повторно. Дубликата не будет."
                : "Заказ в системе есть. Свяжитесь с поддержкой — мы вышлем PDF вручную."}
            </div>
            {pdfRetryError && (
              <div className="text-xs text-rose-600 mt-2">
                Причина: {pdfRetryError}
              </div>
            )}
          </div>
        </div>
        <div className={wrapFooter}>
          {orderId && (
            <Button
              variant="default"
              onClick={handleRetryPdf}
              disabled={retryingPdf}
              className="sm:mr-auto"
            >
              {retryingPdf ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Формируем…
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Повторить генерацию PDF
                </>
              )}
            </Button>
          )}
          <Button
            variant={orderId ? "outline" : "default"}
            className={orderId ? "" : "sm:ml-auto ml-auto"}
            onClick={onClose}
          >
            Закрыть
          </Button>
        </div>
      </>
    );
  }


  return (
    <>
      <div className={wrapBody}>
        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <CheckCircle2 className="h-12 w-12 text-green-600" />
          </div>
          <div className="text-lg font-semibold">
            Счёт № {displayNumber} сформирован
          </div>
          <div className="text-sm text-muted-foreground">
            Ниже — реальные статусы доставки. Обновляются автоматически.
          </div>
        </div>

        <div className="space-y-2">
          <DeliveryRow
            label="PDF-документ"
            state={
              !status
                ? { kind: "pending", text: "Готовим…" }
                : status.pdf_ready
                  ? { kind: "success", text: "Готов к скачиванию" }
                  : { kind: "pending", text: "Формируется…" }
            }
          />
          <DeliveryRow
            label="Email"
            state={renderRow("email", status?.delivery.email)}
            action={
              status?.delivery.email.status === "error"
                ? {
                    label: retrying === "email" ? "…" : "Повторить",
                    onClick: () => handleRetry("email"),
                    disabled: !!retrying,
                  }
                : null
            }
          />
          <DeliveryRow
            label="Telegram"
            state={renderRow("telegram", status?.delivery.telegram)}
            action={
              status?.delivery.telegram.status === "error"
                ? {
                    label: retrying === "telegram" ? "…" : "Повторить",
                    onClick: () => handleRetry("telegram"),
                    disabled: !!retrying,
                  }
                : null
            }
          />
        </div>

        {statusError && (
          <div className="text-xs text-amber-600 text-center">
            Не удалось получить статус: {statusError}. Повторим автоматически.
          </div>
        )}

        <Card className="p-3 text-left text-sm bg-muted/40">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <div className="text-muted-foreground text-xs uppercase tracking-wide mb-1">
                При оплате в назначении платежа укажите
              </div>
              <div className="font-medium break-words select-all">{purposeText}</div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(purposeText);
                  toast.success("Скопировано");
                } catch {
                  toast.error("Не удалось скопировать");
                }
              }}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      </div>
      <div className={wrapFooter}>
        <Button
          variant="outline"
          disabled={!status?.pdf_ready || downloading}
          onClick={handleDownload}
        >
          {downloading ? (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          ) : status?.pdf_ready ? (
            <Download className="h-4 w-4 mr-1" />
          ) : (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          )}
          {status?.pdf_ready ? "Скачать PDF" : "PDF готовится…"}
        </Button>
        <Button className="sm:ml-auto" onClick={onClose}>
          Готово
        </Button>
      </div>
    </>
  );
}

type RowState =
  | { kind: "success"; text: string }
  | { kind: "pending"; text: string }
  | { kind: "error"; text: string; detail?: string | null }
  | { kind: "muted"; text: string };

function renderRow(channel: "email" | "telegram", state?: ChannelState): RowState {
  if (!state) return { kind: "pending", text: "Готовим…" };
  switch (state.status) {
    case "sent":
      return {
        kind: "success",
        text: channel === "email" ? "Отправлено на email" : "Отправлено в Telegram",
      };
    case "queued":
      return { kind: "pending", text: "В очереди…" };
    case "error":
      return {
        kind: "error",
        text: channel === "email" ? "Ошибка отправки email" : "Ошибка отправки в Telegram",
        detail: state.error,
      };
    case "not_linked":
      return { kind: "muted", text: "Telegram не привязан" };
    case "no_recipient":
      return { kind: "muted", text: "Нет email-адреса" };
    default:
      return { kind: "muted", text: "—" };
  }
}

function DeliveryRow({
  label,
  state,
  action,
}: {
  label: string;
  state: RowState;
  action?: { label: string; onClick: () => void; disabled?: boolean } | null;
}) {
  const iconCls = "h-4 w-4 shrink-0";
  const icon =
    state.kind === "success" ? (
      <CheckCircle2 className={`${iconCls} text-green-600`} />
    ) : state.kind === "pending" ? (
      <Loader2 className={`${iconCls} animate-spin text-muted-foreground`} />
    ) : state.kind === "error" ? (
      <XCircle className={`${iconCls} text-destructive`} />
    ) : (
      <AlertCircle className={`${iconCls} text-muted-foreground`} />
    );
  return (
    <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm">
      {icon}
      <div className="flex-1 min-w-0">
        <div className="font-medium">{label}</div>
        <div
          className={
            state.kind === "error"
              ? "text-destructive text-xs truncate"
              : "text-muted-foreground text-xs truncate"
          }
        >
          {state.text}
          {state.kind === "error" && state.detail ? ` · ${state.detail}` : ""}
        </div>
      </div>
      {action && (
        <Button size="sm" variant="outline" onClick={action.onClick} disabled={action.disabled}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" /> {action.label}
        </Button>
      )}
    </div>
  );
}
