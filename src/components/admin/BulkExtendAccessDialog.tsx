import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveAccessRuleProducts, checkExtendEligibility, isCurrentValidAccess } from "@/hooks/useAccessValidation";
import { useRbac } from "@/hooks/useRbac";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, CheckCircle, XCircle, AlertTriangle, ShieldAlert, Shield } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import type { ExtendBlockReason } from "@/hooks/useAccessValidation";

type Step = "setup" | "preview" | "executing" | "done";
type ExtendMode = "days" | "date";

type ReasonTone = "success" | "warning" | "danger" | "muted";

const REASON_META: Record<string, { label: string; tone: ReasonTone }> = {
  "не_оплачено": { label: "Сделка не оплачена — продление не выполняется", tone: "muted" },
  "нет_user_id": { label: "Контакт ещё не зарегистрирован на платформе — выдать доступ нельзя. После первого входа по email сделка и доступ привяжутся автоматически (handle_new_user).", tone: "warning" },
  "нет_product_id": { label: "У сделки не указан продукт", tone: "danger" },
  "продукт_деактивирован": { label: "Продукт деактивирован — доступ не выдаётся", tone: "danger" },
  "тариф_деактивирован": { label: "Тариф деактивирован", tone: "danger" },
  "нет_правила_доступа_в_системе": { label: "Нет активного правила доступа для этого продукта", tone: "danger" },
  "нет_активного_правила_доступа": { label: "Нет активного правила доступа для этого продукта", tone: "danger" },
  "subscription_expired": { label: "Срок подписки истёк", tone: "warning" },
  "subscription_canceled": { label: "Подписка отменена", tone: "warning" },
  "admin_override_historical_allowed": { label: "Админ-продление: предыдущий срок истёк, доступ будет продлён вне обычных ограничений", tone: "warning" },
  "order_subscription_product_mismatch": { label: "Продукт сделки не совпадает с продуктом подписки", tone: "danger" },
  "историческая_покупка_без_текущего_основания": { label: "Историческая покупка без текущего активного доступа", tone: "muted" },
  "неполные_данные_для_проверки": { label: "Неполные данные подписки для проверки", tone: "danger" },
  "новый_срок_короче_текущего": { label: "Новый срок короче текущего — сокращение заблокировано", tone: "danger" },
};

function getReasonLabel(reasonCode?: string, fallback?: string): string {
  if (reasonCode && REASON_META[reasonCode]) return REASON_META[reasonCode].label;
  return fallback || reasonCode || "";
}

interface PreviewRow {
  orderId: string;
  orderNumber: string;
  productName: string;
  userName: string;
  currentEnd: string | null;
  newEnd: string | null;
  action: "применить" | "пропустить" | "заблокировано";
  reason: string;
  reasonCode?: ExtendBlockReason;
  subscriptionId?: string;
}

interface BulkExtendAccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedOrderIds: string[];
  onSuccess: () => void;
}

function PreviewCard({ row, formatDate }: { row: PreviewRow; formatDate: (d: string | null) => string }) {
  const isOverride = row.reasonCode === "admin_override_historical_allowed";
  return (
    <div
      className={`p-3 rounded-lg border text-sm ${
        isOverride
          ? "border-amber-300 bg-amber-50 dark:bg-amber-900/10"
          : row.action === "применить"
          ? "border-green-200 bg-green-50 dark:bg-green-900/10"
          : row.action === "заблокировано"
          ? "border-destructive/30 bg-destructive/5"
          : "border-muted bg-muted/30"
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="font-medium">{row.productName}</span>
        <div className="flex items-center gap-1">
          {row.reasonCode && (
            <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0 text-muted-foreground">
              {row.reasonCode}
            </Badge>
          )}
          <Badge
            variant={
              isOverride ? "secondary" :
              row.action === "применить" ? "default" :
              row.action === "заблокировано" ? "destructive" : "secondary"
            }
            className={`text-xs ${isOverride ? "bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-100" : ""}`}
          >
            {isOverride && <Shield className="w-3 h-3 mr-1" />}
            {!isOverride && row.action === "применить" && <CheckCircle className="w-3 h-3 mr-1" />}
            {row.action === "заблокировано" && <XCircle className="w-3 h-3 mr-1" />}
            {row.action === "пропустить" && <AlertTriangle className="w-3 h-3 mr-1" />}
            {isOverride ? "админ" : row.action}
          </Badge>
        </div>
      </div>
      <div className="text-xs text-muted-foreground">
        {row.userName} · #{row.orderNumber}
      </div>
      {row.action === "применить" && (
        <div className="text-xs mt-1">
          {formatDate(row.currentEnd)} → <span className={`font-medium ${isOverride ? "text-amber-700 dark:text-amber-400" : "text-green-700 dark:text-green-400"}`}>{formatDate(row.newEnd)}</span>
        </div>
      )}
      <div className="text-xs mt-1 text-muted-foreground">
        {row.reasonCode === "нет_user_id" ? row.reason : getReasonLabel(row.reasonCode, row.reason)}
      </div>
    </div>
  );
}

export function BulkExtendAccessDialog({
  open, onOpenChange, selectedOrderIds, onSuccess,
}: BulkExtendAccessDialogProps) {
  const queryClient = useQueryClient();
  const { data: productsWithRules = new Set<string>() } = useActiveAccessRuleProducts();
  const { isAdmin, isSuperAdmin } = useRbac();
  const isAdminOverride = isAdmin || isSuperAdmin;

  const [step, setStep] = useState<Step>("setup");
  const [days, setDays] = useState(30);
  const [extendFromCurrent, setExtendFromCurrent] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<{ success: number; skipped: number; errors: number }>({ success: 0, skipped: 0, errors: 0 });

  // PATCH-MODE-DATE-OR-DAYS
  const [mode, setMode] = useState<ExtendMode>("days");
  const [targetDate, setTargetDate] = useState<Date | undefined>(undefined);
  const [targetTime, setTargetTime] = useState("");

  // PATCH-PREVIEW-SNAPSHOT: immutable snapshot of selected order IDs
  const snapshotRef = useRef<string[]>([]);
  const prevSelectedRef = useRef<string[]>([]);

  // PATCH-SCROLL-RESET: ref for scroll container
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // PATCH-SELECTION-RESET: full reset function
  const resetState = useCallback(() => {
    setStep("setup");
    setDays(30);
    setMode("days");
    setTargetDate(undefined);
    setTargetTime("");
    setExtendFromCurrent(true);
    setResults({ success: 0, skipped: 0, errors: 0 });
    setProcessing(false);
    snapshotRef.current = [];
    // Reset scroll position
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, []);

  // Auto-reset when selection changes while dialog is open
  useEffect(() => {
    if (open) {
      const prevIds = prevSelectedRef.current;
      const changed = prevIds.length !== selectedOrderIds.length ||
        prevIds.some((id, i) => id !== selectedOrderIds[i]);
      if (changed && prevIds.length > 0) {
        resetState();
      }
      prevSelectedRef.current = [...selectedOrderIds];
    }
  }, [open, selectedOrderIds, resetState]);

  // Reset on open
  useEffect(() => {
    if (open) {
      resetState();
      prevSelectedRef.current = [...selectedOrderIds];
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset scroll when entering preview step
  useEffect(() => {
    if (step === "preview" && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [step]);

  // Compute target end date for "date" mode
  const targetEndDateFromPicker = useMemo(() => {
    if (mode !== "date" || !targetDate) return null;
    const d = new Date(targetDate);
    if (targetTime) {
      const [h, m] = targetTime.split(":").map(Number);
      d.setHours(h || 0, m || 0, 0, 0);
    } else {
      d.setHours(23, 59, 59, 0);
    }
    return d;
  }, [mode, targetDate, targetTime]);

  // PATCH-PREVIEW-SNAPSHOT: use snapshot for queries
  const activeOrderIds = snapshotRef.current.length > 0 ? snapshotRef.current : selectedOrderIds;

  // Fetch order data for preview
  const { data: orderData, isLoading } = useQuery({
    queryKey: ["bulk-extend-preview", activeOrderIds],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders_v2")
        .select(`
          id, order_number, user_id, product_id, status,
          products_v2(id, name, is_active),
          profiles!orders_v2_profile_id_fkey(id, email, full_name)
        `)
        .in("id", activeOrderIds);
      if (error) throw error;
      return data;
    },
    enabled: open && activeOrderIds.length > 0,
  });

  // Fetch subscriptions for these users+products
  const { data: subsData } = useQuery({
    queryKey: ["bulk-extend-subs", activeOrderIds],
    queryFn: async () => {
      if (!orderData) return [];
      const pairs = orderData
        .filter(o => o.user_id && o.product_id)
        .map(o => ({ user_id: o.user_id!, product_id: o.product_id! }));
      if (!pairs.length) return [];

      const userIds = [...new Set(pairs.map(p => p.user_id))];
      const productIds = [...new Set(pairs.map(p => p.product_id))];

      const { data, error } = await supabase
        .from("subscriptions_v2")
        .select("id, user_id, product_id, status, access_end_at, products_v2(id, name, is_active), tariffs(id, name, is_active)")
        .in("user_id", userIds)
        .in("product_id", productIds);
      if (error) throw error;
      return data;
    },
    enabled: !!orderData && orderData.length > 0,
  });

  const previewRows = useMemo((): PreviewRow[] => {
    if (!orderData || step !== "preview") return [];

    return orderData.map(order => {
      const product = order.products_v2 as any;
      const profile = order.profiles as any;
      const userName = profile?.full_name || profile?.email || "—";
      const productName = product?.name || "—";

      // Find best subscription candidate
      const sub = subsData?.find(
        s => s.user_id === order.user_id && s.product_id === order.product_id
      ) || null;

      // Calculate potential new end based on mode
      let newEnd: Date;
      if (mode === "date" && targetEndDateFromPicker) {
        newEnd = targetEndDateFromPicker;
      } else {
        const baseDate = extendFromCurrent && sub?.access_end_at
          ? new Date(sub.access_end_at)
          : new Date();
        newEnd = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);
      }

      // Use unified predicate with admin override
      const subForCheck = sub ? {
        status: sub.status,
        access_end_at: sub.access_end_at,
        product_id: sub.product_id,
        products_v2: (sub as any).products_v2 || null,
        tariffs: (sub as any).tariffs || null,
      } : null;

      const check = checkExtendEligibility(
        order as any,
        subForCheck,
        productsWithRules,
        newEnd,
        { isAdminOverride },
      );

      if (check.action !== "применить") {
        // Обогащаем reason для orphan-сделок: показываем email, по которому при регистрации произойдёт автоматический мердж (handle_new_user).
        let enrichedReason = check.reason;
        if (check.reasonCode === "нет_user_id") {
          const orphanEmail = profile?.email || "—";
          enrichedReason = `Контакт «${userName}» (email: ${orphanEmail}) ещё не входил в платформу. Доступ выдать нельзя — нет user_id. После первой регистрации/входа по этому email сделка автоматически привяжется и доступ можно будет продлить.`;
        }
        return {
          orderId: order.id, orderNumber: order.order_number || "—",
          productName, userName,
          currentEnd: sub?.access_end_at || null,
          newEnd: null,
          action: check.action,
          reason: enrichedReason,
          reasonCode: check.reasonCode,
        };
      }

      const reasonText = mode === "date" && targetEndDateFromPicker
        ? `До ${format(targetEndDateFromPicker, "dd.MM.yyyy HH:mm")}`
        : `Продление от ${extendFromCurrent ? "текущего срока" : "сегодня"} на ${days} дн.`;

      return {
        orderId: order.id, orderNumber: order.order_number || "—",
        productName, userName,
        currentEnd: sub?.access_end_at || null,
        newEnd: newEnd.toISOString(),
        action: "применить" as const,
        reason: check.reasonCode === "admin_override_historical_allowed" ? check.reason : reasonText,
        reasonCode: check.reasonCode,
        subscriptionId: sub?.id,
      };
    });
  }, [orderData, subsData, days, extendFromCurrent, productsWithRules, step, mode, targetEndDateFromPicker, isAdminOverride]);

  const applicable = previewRows.filter(r => r.action === "применить");
  const blocked = previewRows.filter(r => r.action === "заблокировано");
  const skipped = previewRows.filter(r => r.action === "пропустить");
  const adminOverrideCount = applicable.filter(r => r.reasonCode === "admin_override_historical_allowed").length;

  const handlePreview = () => {
    // PATCH-PREVIEW-SNAPSHOT: freeze selection at preview time
    snapshotRef.current = [...selectedOrderIds];
    setStep("preview");
  };

  const handleExecute = async () => {
    setStep("executing");
    setProcessing(true);
    let success = 0, errors = 0;

    for (const row of applicable) {
      if (!row.orderId) continue;
      try {
        // PATCH-EXECUTE-TARGET-DATE: for admin manual edits send the exact previewed
        // date per row. This bypasses replay/idempotency no-op and also allows
        // decreasing an incorrectly set access window.
        const shouldManualEditExistingAccess = isAdminOverride && !!row.currentEnd && !!row.newEnd;
        const body: Record<string, any> = {
          orderId: row.orderId,
          extendFromCurrent,
          adminManualAccessEdit: shouldManualEditExistingAccess,
        };

        if (shouldManualEditExistingAccess) {
          body.customAccessEndAt = row.newEnd;
        } else if (mode === "date" && targetEndDateFromPicker) {
          body.customAccessEndAt = targetEndDateFromPicker.toISOString();
        } else {
          body.customAccessDays = days;
        }

        const { data, error } = await supabase.functions.invoke("grant-access-for-order", { body });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        success++;
      } catch (e: any) {
        console.error(`[BulkExtend] Error for order ${row.orderId}:`, e);
        errors++;
      }
    }

    setResults({ success, skipped: skipped.length + blocked.length, errors });
    setProcessing(false);
    setStep("done");
    queryClient.invalidateQueries({ queryKey: ["admin-deals"] });
    queryClient.invalidateQueries({ queryKey: ["deals-access-map"] });
    queryClient.invalidateQueries({ queryKey: ["contact-subscriptions"] });
  };

  const handleClose = () => {
    const wasDone = step === "done";
    resetState();
    onOpenChange(false);
    if (wasDone) onSuccess();
  };

  const formatDate = (d: string | null) =>
    d ? format(new Date(d), "dd.MM.yy HH:mm") : "∞";

  const canPreview = mode === "days" ? days > 0 : !!targetEndDateFromPicker;

  const hasNoPreviewData = previewRows.length === 0 && !isLoading;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            {step === "setup" && "Массовое продление доступа"}
            {step === "preview" && "Предварительный просмотр"}
            {step === "executing" && "Выполнение..."}
            {step === "done" && "Результат"}
          </DialogTitle>
          <DialogDescription>
            {step === "setup" && `Выбрано ${selectedOrderIds.length} сделок`}
            {step === "preview" && (
              <>
                <span className="text-green-600">Применить: {applicable.length}</span>
                {adminOverrideCount > 0 && <span className="ml-2 text-amber-600">(из них админ: {adminOverrideCount})</span>}
                {blocked.length > 0 && <span className="ml-3 text-destructive">Заблокировано: {blocked.length}</span>}
                {skipped.length > 0 && <span className="ml-3 text-muted-foreground">Пропущено: {skipped.length}</span>}
              </>
            )}
            {step === "done" && `Успешно: ${results.success}, Пропущено: ${results.skipped}, Ошибки: ${results.errors}`}
          </DialogDescription>
        </DialogHeader>

        {step === "setup" && (
          <div className="space-y-4 py-4">
            {/* Mode selector */}
            <div>
              <Label className="mb-2 block">Режим продления</Label>
              <RadioGroup value={mode} onValueChange={(v) => setMode(v as ExtendMode)} className="flex gap-4">
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="days" id="mode-days" />
                  <Label htmlFor="mode-days" className="cursor-pointer">+N дней</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="date" id="mode-date" />
                  <Label htmlFor="mode-date" className="cursor-pointer">До конкретной даты</Label>
                </div>
              </RadioGroup>
            </div>

            {mode === "days" ? (
              <>
                <div>
                  <Label>Количество дней</Label>
                  <Input
                    type="number"
                    value={days}
                    onChange={e => setDays(parseInt(e.target.value) || 30)}
                    min={1}
                    className="w-40 mt-1"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    variant={extendFromCurrent ? "default" : "outline"}
                    size="sm"
                    onClick={() => setExtendFromCurrent(true)}
                  >
                    От текущего срока
                  </Button>
                  <Button
                    variant={!extendFromCurrent ? "default" : "outline"}
                    size="sm"
                    onClick={() => setExtendFromCurrent(false)}
                  >
                    От сегодня
                  </Button>
                </div>
              </>
            ) : (
              <div>
                <Label className="mb-1 block">Целевая дата и время</Label>
                <DateTimePicker
                  date={targetDate}
                  time={targetTime}
                  onDateChange={setTargetDate}
                  onTimeChange={setTargetTime}
                />
              </div>
            )}

            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm">
              <div className="flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 mt-0.5 text-amber-600 flex-shrink-0" />
                <div>
                  <p className="font-medium text-amber-800 dark:text-amber-300">Гард основания</p>
                  <p className="text-amber-700 dark:text-amber-400 mt-1">
                    {isAdminOverride
                      ? "Админ-режим: разрешено продление исторических и истёкших кейсов. Такие строки будут помечены предупреждением."
                      : "Продление доступно только для сделок с текущим активным доступом. Исторические, архивные и спорные случаи будут заблокированы."
                    }
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {step === "preview" && (
          <div
            ref={scrollContainerRef}
            className="flex-1 min-h-0 overflow-y-auto pr-1 overscroll-contain"
          >
            {hasNoPreviewData ? (
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                Нет данных для предварительного просмотра
              </div>
            ) : (
              <div className="space-y-4">
                {/* К продлению */}
                {applicable.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-green-700 dark:text-green-400 mb-2 flex items-center gap-1.5 sticky top-0 bg-background/95 backdrop-blur-sm py-1 z-10">
                      <CheckCircle className="w-4 h-4" />
                      К продлению ({applicable.length})
                    </h4>
                    <div className="space-y-2">
                      {applicable.map(row => (
                        <PreviewCard key={row.orderId} row={row} formatDate={formatDate} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Пропущено */}
                {skipped.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1.5 sticky top-0 bg-background/95 backdrop-blur-sm py-1 z-10">
                      <AlertTriangle className="w-4 h-4" />
                      Пропущено ({skipped.length})
                    </h4>
                    <div className="space-y-2">
                      {skipped.map(row => (
                        <PreviewCard key={row.orderId} row={row} formatDate={formatDate} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Заблокировано */}
                {blocked.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-destructive mb-2 flex items-center gap-1.5 sticky top-0 bg-background/95 backdrop-blur-sm py-1 z-10">
                      <XCircle className="w-4 h-4" />
                      Заблокировано ({blocked.length})
                    </h4>
                    <div className="space-y-2">
                      {blocked.map(row => (
                        <PreviewCard key={row.orderId} row={row} formatDate={formatDate} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {step === "executing" && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        )}

        {step === "done" && (
          <div className="py-8 text-center space-y-2">
            <CheckCircle className="w-12 h-12 mx-auto text-green-600" />
            <p className="text-lg font-medium">Готово</p>
            <p className="text-sm text-muted-foreground">
              Успешно продлено: {results.success}
              {results.errors > 0 && ` · Ошибки: ${results.errors}`}
            </p>
          </div>
        )}

        <DialogFooter>
          {step === "setup" && (
            <>
              <Button variant="outline" onClick={handleClose}>Отмена</Button>
              <Button onClick={handlePreview} disabled={isLoading || !canPreview}>
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Предварительный просмотр
              </Button>
            </>
          )}
          {step === "preview" && (
            <>
              <Button variant="outline" onClick={() => setStep("setup")}>Назад</Button>
              <Button
                onClick={handleExecute}
                disabled={applicable.length === 0}
                className="gap-2"
              >
                Применить ({applicable.length})
              </Button>
            </>
          )}
          {step === "done" && (
            <Button onClick={handleClose}>Закрыть</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}