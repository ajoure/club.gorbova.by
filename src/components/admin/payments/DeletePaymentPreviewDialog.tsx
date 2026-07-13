// Stage 4: Payment Delete Preview + Execute Dialog
// Two-step: fetch preview (checksum/version/expiry) → confirm → execute.
// Modes: payment_only (paymentIds) | order_with_all_linked_payments (orderId).
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Loader2, ShieldAlert, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Mode = "payment_only" | "order_with_all_linked_payments";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: Mode;
  paymentIds?: string[];
  orderId?: string | null;
  onSuccess: () => void;
}

interface Preview {
  operation_id: string;
  operation_type: Mode;
  version: number;
  checksum: string;
  expires_at: string;
  payment_ids: string[];
  order_id: string | null;
  before_state: Array<Record<string, any>>;
  predicted_after: Array<Record<string, any>>;
  access_decisions: Array<Record<string, any>>;
  manual_review_required: boolean;
}

export default function DeletePaymentPreviewDialog({
  open, onOpenChange, mode, paymentIds, orderId, onSuccess,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPreview(null);
      setError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null); setPreview(null);
      const { data, error: err } = await supabase.functions.invoke("admin-delete-payment-preview", {
        body: { mode, paymentIds: paymentIds ?? [], orderId: orderId ?? null },
      });
      if (cancelled) return;
      setLoading(false);
      if (err) { setError(err.message || "preview_failed"); return; }
      if (!data?.ok) { setError(data?.error || "preview_failed"); return; }
      setPreview(data as Preview);
    })();
    return () => { cancelled = true; };
  }, [open, mode, JSON.stringify(paymentIds), orderId]);

  const handleExecute = async () => {
    if (!preview) return;
    setExecuting(true);
    const { data, error: err } = await supabase.functions.invoke("admin-delete-payment-execute", {
      body: {
        operationId: preview.operation_id,
        checksum: preview.checksum,
        version: preview.version,
      },
    });
    setExecuting(false);
    if (err) {
      toast.error(`Ошибка удаления: ${err.message}`);
      return;
    }
    if (!data?.ok) {
      const codeMap: Record<string, string> = {
        checksum_mismatch: "Состояние платежей изменилось. Повторите операцию.",
        version_mismatch: "Операция устарела. Повторите.",
        operation_expired: "Срок предпросмотра истёк (10 минут). Повторите.",
        operation_not_pending: "Операция уже была выполнена.",
        already_deleted: "Один из платежей уже удалён.",
      };
      toast.error(codeMap[data?.error as string] ?? `Ошибка: ${data?.error ?? "unknown"}`);
      return;
    }
    toast.success(
      `Удалено платежей: ${data.deleted_payment_ids?.length ?? 0}` +
      (data.affected_order_ids?.length ? `, пересчитано заказов: ${data.affected_order_ids.length}` : "")
    );
    onSuccess();
    onOpenChange(false);
  };

  const title = mode === "order_with_all_linked_payments"
    ? "Удалить сделку и все связанные платежи"
    : (paymentIds && paymentIds.length > 1 ? `Удалить платежи (${paymentIds.length})` : "Удалить платёж");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="delete-preview-dialog" data-operation-id={preview?.operation_id ?? ""} data-preview-count={preview?.before_state.length ?? 0} className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-destructive" />
            {title}
          </DialogTitle>
          <DialogDescription>
            Soft-delete. Платежи скрываются из отчётов и создают tombstone. Webhook/reconcile не восстанавливают их повторно.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-8 text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Расчёт предпросмотра…
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>Ошибка предпросмотра: {error}</AlertDescription>
          </Alert>
        )}

        {preview && (
          <div className="space-y-4">
            {preview.manual_review_required && (
              <Alert>
                <ShieldAlert className="h-4 w-4" />
                <AlertDescription>
                  <strong>Требуется ручной пересмотр доступа.</strong> Найдены записи access_grant_ledger на связанных заказах. Автоматический отзыв доступа не выполняется — проверьте вручную после удаления.
                </AlertDescription>
              </Alert>
            )}

            <div>
              <div className="text-xs text-muted-foreground mb-2">
                operation_id: <code>{preview.operation_id.slice(0, 8)}…</code> · version {preview.version} · TTL 10 мин · checksum <code>{preview.checksum.slice(0, 8)}…</code>
              </div>
              <div className="text-sm font-medium mb-2">Будут удалены платежи ({preview.before_state.length}):</div>
              <div className="rounded border max-h-56 overflow-y-auto text-xs">
                <table className="w-full">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr><th className="text-left p-2">ID</th><th className="text-left p-2">Провайдер</th><th className="text-left p-2">Статус</th><th className="text-right p-2">Сумма</th><th className="text-left p-2">Заказ</th></tr>
                  </thead>
                  <tbody>
                    {preview.before_state.map((p: any) => (
                      <tr key={p.payment_id} className="border-t">
                        <td className="p-2 font-mono">{String(p.payment_id).slice(0, 8)}…</td>
                        <td className="p-2"><Badge variant="outline">{p.provider}</Badge></td>
                        <td className="p-2">{p.status}</td>
                        <td className="p-2 text-right">{p.amount} {p.currency}</td>
                        <td className="p-2 font-mono">{p.order_id ? String(p.order_id).slice(0, 8) + "…" : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {preview.predicted_after.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-2">Затронутые заказы ({preview.predicted_after.length}):</div>
                <div className="rounded border text-xs">
                  <table className="w-full">
                    <thead className="bg-muted/50">
                      <tr><th className="text-left p-2">Заказ</th><th className="text-left p-2">Статус (до)</th><th className="text-right p-2">Оплачено (до)</th><th className="text-left p-2">Валюта</th></tr>
                    </thead>
                    <tbody>
                      {preview.predicted_after.map((o: any) => (
                        <tr key={o.order_id} className="border-t">
                          <td className="p-2 font-mono">{String(o.order_id).slice(0, 8)}…</td>
                          <td className="p-2">{o.before_status}</td>
                          <td className="p-2 text-right">{o.before_paid_amount}</td>
                          <td className="p-2">{o.currency}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Точное after-состояние (статус/paid_amount) вычисляется в момент выполнения через recalc_order_totals('payment_removed').
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={executing}>Отмена</Button>
          <Button
            variant="destructive"
            onClick={handleExecute}
            disabled={!preview || executing || loading}
          >
            {executing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
            Подтвердить удаление
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
