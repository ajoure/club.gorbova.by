/**
 * OrderSummary — единый компонент состава заказа для публичного /cb и админ-панели.
 *
 * Требования:
 *  - На каждом шаге показывает основной продукт+тариф отдельной строкой и каждый
 *    выбранный модуль отдельной строкой (короткое имя, list_amount, discount badge,
 *    final_amount).
 *  - Нельзя показывать один только total.
 *  - Цены берутся из composable quote (list_amount / final_amount / discount_amount).
 *    Никакого hardcode.
 *  - Опционально показывает плательщика, способ оплаты, adjustment и итого.
 */
import { cn } from "@/lib/utils";
import { getAddonShortName } from "@/lib/addonShortName";

export type OrderSummaryLine = {
  role: "primary" | "addon";
  product_name: string;
  tariff_name?: string | null;
  list_amount: number;
  final_amount: number;
  discount_amount?: number;
  discount_percent?: number | null;
  pricing_mode?: "offer_price" | "fixed_price" | "percent_discount" | "free";
};

export interface OrderSummaryProps {
  items: OrderSummaryLine[];
  currency: string;
  total: number;
  subtotal?: number;
  adjustmentAmount?: number;
  adjustmentReason?: string | null;
  payerLabel?: string | null;
  paymentMethodLabel?: string | null;
  density?: "public" | "admin";
  className?: string;
  emptyHint?: string;
}

const money = (v: number, currency: string) =>
  new Intl.NumberFormat("ru-BY", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(v);

function computeDiscountPercent(line: OrderSummaryLine): number {
  if (line.pricing_mode === "percent_discount" && line.discount_percent != null) {
    return Math.round(Number(line.discount_percent));
  }
  if (line.list_amount > 0 && line.final_amount < line.list_amount) {
    return Math.round((1 - line.final_amount / line.list_amount) * 100);
  }
  return 0;
}

export function OrderSummary({
  items,
  currency,
  total,
  subtotal,
  adjustmentAmount,
  adjustmentReason,
  payerLabel,
  paymentMethodLabel,
  density = "public",
  className,
  emptyHint,
}: OrderSummaryProps) {
  const primary = items.find((it) => it.role === "primary");
  const addons = items.filter((it) => it.role === "addon");
  const compact = density === "admin";

  if (!primary && items.length === 0) {
    return (
      <div className="rounded-2xl border border-white/70 bg-white/60 p-4 text-sm text-slate-500">
        {emptyHint ?? "Нет позиций для отображения."}
      </div>
    );
  }

  return (
    <div
      data-testid="order-summary"
      className={cn(
        "rounded-2xl border bg-card/80 backdrop-blur-sm",
        compact ? "border-border p-3" : "border-white/70 bg-white/70 p-4 sm:p-5",
        className,
      )}
    >
      <div className={cn("text-xs uppercase tracking-[.14em] text-muted-foreground", compact ? "mb-2" : "mb-3")}>
        Состав заказа
      </div>

      <ul className={cn("space-y-1.5", compact ? "text-[13px]" : "text-sm")}>
        {primary && <SummaryRow line={primary} currency={currency} isPrimary />}
        {addons.map((line, i) => (
          <SummaryRow key={`${line.product_name}-${i}`} line={line} currency={currency} />
        ))}
      </ul>

      {(payerLabel || paymentMethodLabel) && (
        <dl className={cn("mt-3 grid gap-1 border-t pt-3", compact ? "text-[12px]" : "text-xs")}>
          {payerLabel && (
            <div className="flex items-start justify-between gap-3">
              <dt className="text-muted-foreground">Плательщик</dt>
              <dd className="text-right font-medium text-foreground">{payerLabel}</dd>
            </div>
          )}
          {paymentMethodLabel && (
            <div className="flex items-start justify-between gap-3">
              <dt className="text-muted-foreground">Способ оплаты</dt>
              <dd className="text-right font-medium text-foreground">{paymentMethodLabel}</dd>
            </div>
          )}
        </dl>
      )}

      <div className={cn("mt-3 space-y-1 border-t pt-3", compact ? "text-[12px]" : "text-xs")}>
        {typeof subtotal === "number" && subtotal !== total && (
          <div className="flex justify-between text-muted-foreground">
            <span>Подытог</span>
            <span className="tabular-nums">{money(subtotal, currency)}</span>
          </div>
        )}
        {typeof adjustmentAmount === "number" && adjustmentAmount !== 0 && (
          <div className="flex justify-between text-muted-foreground">
            <span>
              {adjustmentAmount < 0 ? "Скидка" : "Наценка"}
              {adjustmentReason ? ` · ${adjustmentReason}` : ""}
            </span>
            <span className="tabular-nums">
              {adjustmentAmount > 0 ? "+" : ""}
              {money(adjustmentAmount, currency)}
            </span>
          </div>
        )}
        <div className={cn("flex items-baseline justify-between pt-1", compact ? "text-[15px]" : "text-base")}>
          <span className="font-semibold text-foreground">Итого</span>
          <span className="text-lg font-semibold tabular-nums text-foreground sm:text-xl">
            {money(total, currency)}
          </span>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({
  line,
  currency,
  isPrimary,
}: {
  line: OrderSummaryLine;
  currency: string;
  isPrimary?: boolean;
}) {
  const displayName = isPrimary
    ? line.product_name
    : getAddonShortName(line.product_name) || line.product_name;
  const secondary = isPrimary ? line.tariff_name : null;
  const pct = computeDiscountPercent(line);
  const hasDiscount = line.final_amount < line.list_amount;
  const isFree = line.final_amount === 0 && line.list_amount > 0;

  return (
    <li className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className={cn("truncate", isPrimary ? "font-semibold text-foreground" : "text-foreground")}>
          {displayName}
        </div>
        {secondary && (
          <div className="truncate text-[11px] text-muted-foreground">{secondary}</div>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
        {isFree ? (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
            В подарок
          </span>
        ) : hasDiscount ? (
          <>
            <div className="flex items-center gap-1.5">
              <span className="font-semibold tabular-nums text-foreground">
                {money(line.final_amount, currency)}
              </span>
              {pct > 0 && (
                <span className="rounded-full bg-rose-500/90 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                  −{pct}%
                </span>
              )}
            </div>
            <span className="text-[11px] leading-none text-muted-foreground line-through tabular-nums">
              {money(line.list_amount, currency)}
            </span>
          </>
        ) : (
          <span className="font-semibold tabular-nums text-foreground">
            {money(line.final_amount, currency)}
          </span>
        )}
      </div>
    </li>
  );
}
