// PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve C
// Read-only Sheet/Drawer that consumes canonical resolver.
//
// Strict rules:
//   - Auto-resolve only after the drawer actually opens (no prefetch).
//   - First call: refresh_provider=false.
//   - refresh_provider=true ONLY after explicit user confirmation via
//     canonical AlertDialog.
//   - No frontend merge of provider documents (canonical replacement).
//   - On close: reset() invalidates pending requests and drops signed URLs.

import { useEffect, useState } from "react";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, RefreshCw } from "lucide-react";
import { useRbac } from "@/hooks/useRbac";
import { usePaymentDocuments } from "@/hooks/usePaymentDocuments";
import { PaymentDocumentCard } from "./PaymentDocumentCard";
import {
  localizeMachineCode,
  maskUuid,
  providerLabel,
} from "@/utils/paymentDocumentUi";
import type { ResolverResponse } from "@/types/paymentDocuments";

interface Props {
  paymentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatAmount(amount: number | null, currency: string | null) {
  if (amount == null) return "—";
  const fmt = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2 });
  return `${fmt.format(amount)} ${currency ?? ""}`.trim();
}

export function PaymentDocumentsDrawer({
  paymentId,
  open,
  onOpenChange,
}: Props) {
  const rbac = useRbac();
  const canRefresh = rbac.canWrite("payments") || rbac.isAdmin;
  const canSeeDiagnostics = rbac.isSuperAdmin;

  const docs = usePaymentDocuments(paymentId);
  const [confirmRefreshOpen, setConfirmRefreshOpen] = useState(false);

  // Auto-resolve once after the drawer opens for the current paymentId.
  // Strictly NOT a render-time prefetch.
  useEffect(() => {
    if (open && paymentId && !docs.data && !docs.loading && !docs.error) {
      docs.resolveDocuments();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, paymentId]);

  // On close — reset state, invalidate in-flight, drop signed URLs from memory.
  useEffect(() => {
    if (!open) docs.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleConfirmRefresh = () => {
    setConfirmRefreshOpen(false);
    docs.refreshProviderDocuments();
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Документы платежа</SheetTitle>
            <SheetDescription>
              Документы эквайринга и внутренние документы платежа.
            </SheetDescription>
          </SheetHeader>

          {docs.loading && !docs.data && <DrawerSkeleton />}

          {docs.error && <ErrorBlock kind={docs.error.kind} />}

          {docs.data && (
            <DrawerBody
              data={docs.data}
              canRefresh={canRefresh}
              canSeeDiagnostics={canSeeDiagnostics}
              refreshing={docs.refreshing}
              onRequestRefresh={() => setConfirmRefreshOpen(true)}
            />
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={confirmRefreshOpen}
        onOpenChange={setConfirmRefreshOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Обновить данные провайдера?</AlertDialogTitle>
            <AlertDialogDescription>
              Подтвердите получение актуальных документов у платёжного
              провайдера. Локальные документы будут заменены ответом сервиса.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmRefresh}>
              Обновить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────────────

function DrawerSkeleton() {
  return (
    <div className="space-y-3 mt-4">
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}

function ErrorBlock({ kind }: { kind: "forbidden" | "not_found" | "network" | "malformed" }) {
  const msg = kind === "forbidden"
    ? "Недостаточно прав для просмотра документов"
    : kind === "not_found"
    ? "Платёж не найден"
    : "Не удалось загрузить документы платежа";
  return (
    <div className="mt-6 text-sm text-muted-foreground">{msg}</div>
  );
}

interface BodyProps {
  data: ResolverResponse;
  canRefresh: boolean;
  canSeeDiagnostics: boolean;
  refreshing: boolean;
  onRequestRefresh: () => void;
}

function DrawerBody({
  data, canRefresh, canSeeDiagnostics, refreshing, onRequestRefresh,
}: BodyProps) {
  const { payment, provider_documents, internal_documents, generation, diagnostics, warnings } = data;

  const refreshUnavailable = warnings.find(
    (w) => w.code === "BEPAID_REFRESH_NOT_AVAILABLE_READ_ONLY",
  );
  const refundParentUnresolved = warnings.some(
    (w) => w.code === "REFUND_PARENT_NOT_RESOLVED",
  );

  return (
    <div className="space-y-5 mt-4">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline">{providerLabel(payment.provider)}</Badge>
          <Badge variant="outline">{payment.status}</Badge>
          {payment.is_refund && (
            <Badge variant="outline" className="border-amber-500 text-amber-600">
              Возврат
            </Badge>
          )}
        </div>
        <div className="text-sm">
          <span className="font-medium">{formatAmount(payment.amount, payment.currency)}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          ID: <code>{maskUuid(payment.id)}</code>
          {payment.order_id && (
            <> · Заказ: <code>{maskUuid(payment.order_id)}</code></>
          )}
        </div>
      </div>

      {/* Refresh action */}
      {canRefresh && (
        <div>
          <Button
            size="sm"
            variant="outline"
            disabled={refreshing}
            onClick={onRequestRefresh}
          >
            {refreshing
              ? <Loader2 className="h-3 w-3 mr-2 animate-spin" />
              : <RefreshCw className="h-3 w-3 mr-2" />}
            Обновить данные провайдера
          </Button>
          {refreshUnavailable && (
            <div className="text-xs text-muted-foreground mt-2">
              {localizeMachineCode("BEPAID_REFRESH_NOT_AVAILABLE_READ_ONLY")}
            </div>
          )}
        </div>
      )}

      <Separator />

      {/* Provider documents */}
      <section>
        <h3 className="text-sm font-semibold mb-2">Документы эквайринга</h3>
        {provider_documents.length === 0
          ? (
            <div className="text-xs text-muted-foreground">
              Документы эквайринга отсутствуют
            </div>
          )
          : (
            <div className="space-y-2">
              {provider_documents.map((d, i) => (
                <PaymentDocumentCard
                  key={`${d.type}:${d.external_id ?? i}`}
                  entry={{ kind: "provider", doc: d }}
                />
              ))}
            </div>
          )}
        {payment.is_refund && (
          <div className="text-xs text-muted-foreground mt-2">
            {refundParentUnresolved
              ? localizeMachineCode("REFUND_PARENT_NOT_RESOLVED")
              : localizeMachineCode("REFUND_USES_PARENT_DOCUMENTS")}
          </div>
        )}
      </section>

      <Separator />

      {/* Internal documents */}
      <section>
        <h3 className="text-sm font-semibold mb-2">Внутренние документы</h3>
        {internal_documents.length === 0
          ? (
            <div className="text-xs text-muted-foreground">
              Внутренние документы ещё не сформированы
            </div>
          )
          : (
            <div className="space-y-2">
              {internal_documents.map((d) => (
                <PaymentDocumentCard
                  key={d.id}
                  entry={{ kind: "internal", doc: d }}
                />
              ))}
            </div>
          )}
      </section>

      <Separator />

      {/* Generation status (read-only — Approve C does not add Generate button.
          Existing generation flow was not found that matches the strict
          "production endpoint + invocation pattern + RBAC + result flow"
          requirement, so the action is intentionally deferred. See proof. */}
      <section>
        <h3 className="text-sm font-semibold mb-2">Сценарий генерации</h3>
        <div className="text-xs text-muted-foreground">
          {generation.scenario_found
            ? (generation.can_generate
              ? "Доступна генерация документа (действие будет добавлено отдельным патчем)"
              : localizeMachineCode(generation.blocked_reason))
            : localizeMachineCode(
              generation.blocked_reason ?? "NO_DOCUMENT_SCENARIO",
            )}
        </div>
      </section>

      {/* Warnings */}
      {warnings.length > 0 && (
        <>
          <Separator />
          <section>
            <h3 className="text-sm font-semibold mb-2">Предупреждения</h3>
            <ul className="text-xs text-muted-foreground space-y-1">
              {warnings.map((w, i) => (
                <li key={i}>
                  {localizeMachineCode(w.detail ?? w.code)}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {/* Diagnostics — super_admin only AND backend actually returned them */}
      {canSeeDiagnostics && diagnostics && (
        <>
          <Separator />
          <section>
            <h3 className="text-sm font-semibold mb-2">Диагностика</h3>
            <pre className="text-[11px] bg-muted/40 p-2 rounded overflow-x-auto">
              {JSON.stringify(diagnostics, null, 2)}
            </pre>
          </section>
        </>
      )}
    </div>
  );
}
