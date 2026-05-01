import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Handshake,
  Layers,
  ChevronDown,
  ChevronRight,
  CalendarDays,
  Calendar as CalendarIcon,
  CreditCard,
  Pencil,
  Eye,
  Undo2,
  Download,
} from "lucide-react";
import { format, parse } from "date-fns";
import { ru } from "date-fns/locale";
import { getDealDisplayName, getShortDisplayName } from "@/lib/deals/getDealDisplayName";
import { getEffectiveDealDate } from "@/utils/getEffectiveDealDate";

// ── Types ───────────────────────────────────────────────────────────

type AnyDeal = any;

interface ContactDealsTabProps {
  deals: AnyDeal[] | undefined;
  isLoading: boolean;
  moduleMetaMap?: Map<string, any>;
  onOpenDeal: (id: string) => void;
  onEditDeal: (id: string) => void;
  onRefund: (id: string) => void;
}

interface DealsGroup {
  key: string;
  label: string;
  productId: string | null;
  category: string | null;
  items: AnyDeal[];
  paidCount: number;
  totalSum: number;
  currency: string;
  sortTs: number;
}

// ── Helpers ─────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  draft: "Черновик",
  pending: "Ожидает",
  paid: "Оплачен",
  partial: "Частично",
  cancelled: "Отменён",
  refunded: "Возврат",
  expired: "Истёк",
  failed: "Ошибка",
};

function statusBadgeClass(status: string) {
  switch (status) {
    case "paid": return "bg-green-500/15 text-green-700 border-green-200 dark:text-green-400";
    case "pending": return "bg-amber-500/15 text-amber-700 border-amber-200 dark:text-amber-400";
    case "refunded": return "bg-orange-500/15 text-orange-700 border-orange-200 dark:text-orange-400";
    case "cancelled":
    case "failed":
      return "bg-red-500/15 text-red-700 border-red-200 dark:text-red-400";
    default: return "bg-muted text-muted-foreground border-border";
  }
}

function formatDealMonth(monthStr: string | null | undefined): string | null {
  if (!monthStr) return null;
  try {
    const d = parse(`${monthStr}-01`, "yyyy-MM-dd", new Date());
    return format(d, "LLL yy", { locale: ru });
  } catch {
    return monthStr;
  }
}

function groupDealsByProduct(deals: AnyDeal[], moduleMetaMap?: Map<string, any>): DealsGroup[] {
  const map = new Map<string, AnyDeal[]>();
  const labelMap = new Map<string, string>();
  const pidMap = new Map<string, string | null>();
  const catMap = new Map<string, string | null>();

  for (const d of deals) {
    const fullName = getDealDisplayName({
      productsV2: d.products_v2,
      purchaseSnapshot: d.purchase_snapshot,
      moduleProduct: moduleMetaMap?.get(d.id)?.moduleProduct,
      fallback: "Без продукта",
    });
    const key = d.product_id || fullName;
    if (!map.has(key)) {
      map.set(key, []);
      labelMap.set(key, fullName);
      pidMap.set(key, d.product_id || null);
      catMap.set(key, d.products_v2?.category ?? null);
    }
    map.get(key)!.push(d);
  }

  const groups: DealsGroup[] = [];
  for (const [key, items] of map) {
    const sorted = [...items].sort((a, b) => {
      const da = new Date(getEffectiveDealDate(a)).getTime();
      const db = new Date(getEffectiveDealDate(b)).getTime();
      return db - da;
    });
    const paidCount = items.filter(i => i.status === "paid").length;
    const totalSum = items
      .filter(i => i.status === "paid")
      .reduce((sum, i) => sum + Number(i.final_price || 0), 0);
    const currency = items[0]?.currency || "BYN";
    groups.push({
      key,
      label: labelMap.get(key) || "Без продукта",
      productId: pidMap.get(key) ?? null,
      category: catMap.get(key) ?? null,
      items: sorted,
      paidCount,
      totalSum,
      currency,
    });
  }

  groups.sort((a, b) => a.label.localeCompare(b.label, "ru"));
  return groups;
}

// ── Main component ──────────────────────────────────────────────────

export function ContactDealsTab({
  deals,
  isLoading,
  moduleMetaMap,
  onOpenDeal,
  onEditDeal,
  onRefund,
}: ContactDealsTabProps) {
  const groups = useMemo(
    () => groupDealsByProduct(deals || [], moduleMetaMap),
    [deals, moduleMetaMap]
  );

  // Single-deal groups → expanded by default. Multi-deal groups → collapsed by default.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const g of groups) {
      if (g.items.length > 1) s.add(g.key);
    }
    return s;
  });

  const toggle = (key: string) =>
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)}
      </div>
    );
  }

  if (!deals?.length) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Handshake className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
          <p className="text-muted-foreground text-sm">Нет сделок</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-2">
        {groups.map(group => (
          <DealsGroupSection
            key={group.key}
            group={group}
            isOpen={!collapsed.has(group.key)}
            onToggle={() => toggle(group.key)}
            moduleMetaMap={moduleMetaMap}
            onOpenDeal={onOpenDeal}
            onEditDeal={onEditDeal}
            onRefund={onRefund}
          />
        ))}
      </div>
    </TooltipProvider>
  );
}

// ── Group ───────────────────────────────────────────────────────────

function DealsGroupSection({
  group,
  isOpen,
  onToggle,
  moduleMetaMap,
  onOpenDeal,
  onEditDeal,
  onRefund,
}: {
  group: DealsGroup;
  isOpen: boolean;
  onToggle: () => void;
  moduleMetaMap?: Map<string, any>;
  onOpenDeal: (id: string) => void;
  onEditDeal: (id: string) => void;
  onRefund: (id: string) => void;
}) {
  const sumLabel = group.totalSum > 0
    ? new Intl.NumberFormat("ru-BY", { style: "currency", currency: group.currency, maximumFractionDigits: 0 }).format(group.totalSum)
    : null;

  return (
    <Collapsible open={isOpen} onOpenChange={onToggle}>
      <div className="bg-card border border-border/60 border-l-4 border-l-indigo-300 rounded-lg shadow-sm overflow-hidden">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-accent/30 transition-colors text-left group"
          >
            <div className="w-7 h-7 rounded-md bg-indigo-50 flex items-center justify-center shrink-0">
              <Layers className="w-3.5 h-3.5 text-indigo-500" />
            </div>
            <span className="text-sm font-medium truncate flex-1">{group.label}</span>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {group.paidCount > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-green-50 text-green-700 border-green-200">
                  {group.paidCount} оплач.
                </Badge>
              )}
              {group.items.length > group.paidCount && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                  {group.items.length} всего
                </Badge>
              )}
              {sumLabel && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                  {sumLabel}
                </Badge>
              )}
            </div>
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isOpen ? "" : "-rotate-90"}`} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-1 px-2 pb-2">
            {group.items.map(deal => (
              <DealRow
                key={deal.id}
                deal={deal}
                moduleMeta={moduleMetaMap?.get(deal.id)}
                onOpen={() => onOpenDeal(deal.id)}
                onEdit={() => onEditDeal(deal.id)}
                onRefund={() => onRefund(deal.id)}
              />
            ))}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

// ── Row ─────────────────────────────────────────────────────────────

function DealRow({
  deal,
  moduleMeta,
  onOpen,
  onEdit,
  onRefund,
}: {
  deal: AnyDeal;
  moduleMeta?: any;
  onOpen: () => void;
  onEdit: () => void;
  onRefund: () => void;
}) {
  const meta = (deal.meta || {}) as Record<string, any>;
  const snapshot = (deal.purchase_snapshot || {}) as Record<string, any>;
  const dealMonth = formatDealMonth(meta.deal_month);
  const isPaid = deal.status === "paid";
  const isSplitParent = meta.split_status === "children_created";

  const payments = deal.payments_v2 as any[] | undefined;
  const successfulPayment = payments?.find(p => p.status === "succeeded");
  const receiptUrl = successfulPayment?.receipt_url
    || successfulPayment?.provider_response?.transaction?.receipt_url;

  const tariffName = (deal.tariffs as any)?.name;
  const fullName = getDealDisplayName({
    productsV2: deal.products_v2,
    purchaseSnapshot: deal.purchase_snapshot,
    moduleProduct: moduleMeta?.moduleProduct,
    fallback: "Сделка",
  });
  const titleText = tariffName || getShortDisplayName(fullName, (deal.products_v2 as any)?.category);

  return (
    <div
      className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md cursor-pointer hover:bg-accent/40 transition-colors ${
        isSplitParent ? "opacity-60" : ""
      }`}
      onClick={onOpen}
    >
      <div className="w-7 h-7 rounded-full bg-indigo-50 flex items-center justify-center shrink-0">
        <Layers className="w-3.5 h-3.5 text-indigo-500" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm truncate">{titleText}</span>
          {isSplitParent && (
            <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 text-amber-600 border-amber-300">
              Разделена
            </Badge>
          )}
          {meta.split_from_order_id && (
            <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 text-blue-600 border-blue-300">
              Модуль
            </Badge>
          )}
          {snapshot.historical_purchase_type === "module_only_standalone" && (
            <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 text-amber-600 border-amber-300">
              Модульная
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
          <CalendarIcon className="w-2.5 h-2.5" />
          <span>{format(new Date(getEffectiveDealDate(deal)), "dd.MM.yy HH:mm")}</span>
          <span>·</span>
          <span className="font-mono">{deal.order_number}</span>
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        {dealMonth && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 h-5 bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 capitalize"
              >
                <CalendarDays className="w-2.5 h-2.5 mr-0.5" />
                {dealMonth}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p className="text-xs">Месяц контента, к которому относится сделка</p>
            </TooltipContent>
          </Tooltip>
        )}

        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-5 ${statusBadgeClass(deal.status)}`}>
          {STATUS_LABELS[deal.status] || deal.status}
        </Badge>

        <span className="text-xs font-medium flex items-center gap-1 whitespace-nowrap">
          <CreditCard className="w-3 h-3 text-muted-foreground" />
          {new Intl.NumberFormat("ru-BY", {
            style: "currency",
            currency: deal.currency,
            maximumFractionDigits: 0,
          }).format(Number(deal.final_price))}
        </span>

        {receiptUrl && (
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            title="Чек"
            onClick={(e) => {
              e.stopPropagation();
              window.open(receiptUrl, "_blank");
            }}
          >
            <Download className="w-3 h-3" />
          </Button>
        )}

        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 text-muted-foreground hover:text-primary"
          title="Редактировать"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
        >
          <Pencil className="w-3 h-3" />
        </Button>

        {isPaid && (
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-purple-600 hover:text-purple-700"
            title="Возврат"
            onClick={(e) => {
              e.stopPropagation();
              onRefund();
            }}
          >
            <Undo2 className="w-3 h-3" />
          </Button>
        )}

        <Eye className="w-3.5 h-3.5 text-muted-foreground" />
        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
      </div>
    </div>
  );
}
