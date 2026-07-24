import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAddonShortName, getAddonSecondaryLine } from "@/lib/addonShortName";

/**
 * Каноническая форма аддона, как её возвращает composable-checkout-quote.
 * Все цены берутся ИСКЛЮЧИТЕЛЬНО из этого объекта, никакого hardcode.
 */
export type AddonPickerItem = {
  addon_offer_id: string;
  addon_product_name: string;
  addon_tariff_name?: string | null;
  list_amount: number;
  pricing_mode: "offer_price" | "fixed_price" | "percent_discount" | "free";
  fixed_amount?: number | null;
  discount_percent?: number | null;
  is_required?: boolean;
  is_default_selected?: boolean;
};

interface AddonPickerProps {
  addons: AddonPickerItem[];
  selectedIds: string[];
  currency: string;
  onToggle: (addonOfferId: string, next: boolean) => void;
  loading?: boolean;
  /**
   * После скольких элементов включается сворачивание списка.
   * По умолчанию 6 — дальше показывается кнопка «Показать все».
   */
  collapseAfter?: number;
  /**
   * Плотность:
   *  - "public"  — публичный чекаут (немного крупнее для тач-таргетов)
   *  - "admin"   — плотный UI внутри админ-диалога
   */
  density?: "public" | "admin";
  className?: string;
}

const money = (value: number, currency: string) =>
  new Intl.NumberFormat("ru-BY", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);

function computeFinalPrice(a: AddonPickerItem): number {
  switch (a.pricing_mode) {
    case "free":
      return 0;
    case "fixed_price":
      return Number(a.fixed_amount ?? a.list_amount);
    case "percent_discount":
      return a.list_amount * (1 - Number(a.discount_percent ?? 0) / 100);
    default:
      return a.list_amount;
  }
}

export function AddonPicker({
  addons,
  selectedIds,
  currency,
  onToggle,
  loading = false,
  collapseAfter = 6,
  density = "public",
  className,
}: AddonPickerProps) {
  const [expanded, setExpanded] = useState(false);

  const canCollapse = addons.length > collapseAfter;
  const visible = canCollapse && !expanded ? addons.slice(0, collapseAfter) : addons;
  const hiddenCount = addons.length - visible.length;

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  if (loading && addons.length === 0) {
    return (
      <div className="flex min-h-24 items-center justify-center rounded-2xl border border-white/70 bg-white/50 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (addons.length === 0) {
    return (
      <div className="rounded-2xl border border-white/70 bg-white/60 p-4 text-sm text-slate-500">
        Для этого тарифа дополнительные модули пока не настроены.
      </div>
    );
  }

  const gapClass = density === "admin" ? "gap-1.5" : "gap-2";
  const gridClass =
    density === "admin"
      ? "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"
      : "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3";

  return (
    <div className={cn("space-y-2", className)}>
      <div className={cn(gridClass, gapClass)}>
        {visible.map((addon) => (
          <AddonRow
            key={addon.addon_offer_id}
            addon={addon}
            currency={currency}
            checked={addon.is_required || selectedSet.has(addon.addon_offer_id)}
            onToggle={(next) => onToggle(addon.addon_offer_id, next)}
            density={density}
          />
        ))}
      </div>

      {canCollapse && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-center gap-1.5 rounded-full border border-white/70 bg-white/60 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-white/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-300"
        >
          {expanded ? (
            <>
              Свернуть <ChevronUp className="h-3.5 w-3.5" />
            </>
          ) : (
            <>
              Показать все ({hiddenCount} ещё) <ChevronDown className="h-3.5 w-3.5" />
            </>
          )}
        </button>
      )}
    </div>
  );
}

interface RowProps {
  addon: AddonPickerItem;
  currency: string;
  checked: boolean;
  onToggle: (next: boolean) => void;
  density: "public" | "admin";
}

function AddonRow({ addon, currency, checked, onToggle, density }: RowProps) {
  const shortName = getAddonShortName(addon.addon_product_name);
  const secondary = getAddonSecondaryLine(addon.addon_tariff_name ?? null, shortName);

  const finalPrice = computeFinalPrice(addon);
  const listPrice = addon.list_amount;
  const hasDiscount =
    addon.pricing_mode === "percent_discount" &&
    Number(addon.discount_percent ?? 0) > 0 &&
    finalPrice < listPrice;
  const discountPct = hasDiscount ? Math.round(Number(addon.discount_percent ?? 0)) : 0;

  const disabled = Boolean(addon.is_required);

  const handleActivate = () => {
    if (disabled) return;
    onToggle(!checked);
  };

  const paddingClass = density === "admin" ? "px-2.5 py-2" : "px-3 py-2.5";

  return (
    <div
      role="checkbox"
      aria-checked={checked}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onClick={handleActivate}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          handleActivate();
        }
      }}
      className={cn(
        "group flex cursor-pointer select-none items-center gap-2.5 rounded-xl border text-left transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/70 focus-visible:ring-offset-1 focus-visible:ring-offset-white",
        paddingClass,
        checked
          ? "border-fuchsia-300/80 bg-white/90 shadow-[0_6px_18px_rgba(196,74,154,0.10)]"
          : "border-white/70 bg-white/55 hover:border-fuchsia-200 hover:bg-white/80",
        disabled && "cursor-not-allowed opacity-90",
      )}
    >
      <div
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors",
          checked
            ? "border-fuchsia-500 bg-fuchsia-500 text-white"
            : "border-slate-300 bg-white group-hover:border-fuchsia-300",
        )}
        aria-hidden
      >
        {checked && <Check className="h-3 w-3" strokeWidth={3} />}
      </div>

      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate font-medium leading-tight text-slate-800",
            density === "admin" ? "text-[13px]" : "text-sm",
          )}
          title={addon.addon_product_name}
        >
          {shortName || addon.addon_product_name}
        </div>
        {secondary && (
          <div className="mt-0.5 truncate text-[11px] leading-tight text-slate-400">
            {secondary}
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
        {finalPrice === 0 ? (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
            В подарок
          </span>
        ) : hasDiscount ? (
          <>
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  "font-semibold text-slate-900 tabular-nums",
                  density === "admin" ? "text-[13px]" : "text-sm",
                )}
              >
                {money(finalPrice, currency)}
              </span>
              <span className="rounded-full bg-rose-500/90 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white shadow-sm">
                −{discountPct}%
              </span>
            </div>
            <span className="text-[11px] leading-none text-slate-400 line-through tabular-nums">
              {money(listPrice, currency)}
            </span>
          </>
        ) : (
          <span
            className={cn(
              "font-semibold text-slate-900 tabular-nums",
              density === "admin" ? "text-[13px]" : "text-sm",
            )}
          >
            {money(finalPrice, currency)}
          </span>
        )}
        {addon.is_required && (
          <span className="text-[10px] font-medium uppercase tracking-wide text-fuchsia-500">
            включено
          </span>
        )}
      </div>
    </div>
  );
}
