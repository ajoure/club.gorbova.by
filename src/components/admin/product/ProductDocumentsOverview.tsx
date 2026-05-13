import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { useTariffs } from "@/hooks/useProductsV2";
import { useProductOffers, type TariffOffer, type OfferDocumentDefaults } from "@/hooks/useTariffOffers";
import { FileText, Copy, Layers, Search } from "lucide-react";
import { toast } from "sonner";

interface Props { productId: string; }

interface TemplateOpt { id: string; name: string; code: string; }
interface ExecutorOpt { id: string; short_name: string | null; full_name: string; is_default: boolean; }

type Source =
  | "from_offer"
  | "from_defaults"
  | "computed"
  | "manual"
  | "default"
  | "deal"
  | "client"
  | "empty";

const SOURCE_LABEL: Record<Source, string> = {
  from_offer: "из кнопки",
  from_defaults: "из document_defaults",
  computed: "рассчитано",
  manual: "вручную",
  default: "по умолчанию",
  deal: "из сделки",
  client: "из реквизитов клиента",
  empty: "пусто",
};

const SOURCE_CLASS: Record<Source, string> = {
  from_offer: "bg-indigo-500/10 text-indigo-600 border-indigo-200/50",
  from_defaults: "bg-sky-500/10 text-sky-600 border-sky-200/50",
  computed: "bg-emerald-500/10 text-emerald-600 border-emerald-200/50",
  manual: "bg-amber-500/10 text-amber-600 border-amber-200/50",
  default: "bg-muted text-muted-foreground",
  deal: "bg-violet-500/10 text-violet-600 border-violet-200/50",
  client: "bg-violet-500/10 text-violet-600 border-violet-200/50",
  empty: "bg-muted text-muted-foreground/70",
};

interface Row {
  label: string;
  value: string | null;
  token: string;
  source: Source;
  hint?: string;
}

function copyToken(token: string) {
  navigator.clipboard.writeText(token);
  toast.success(`Скопировано: ${token}`);
}

function fmtMoney(n: number | null | undefined, currency: string | null | undefined) {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  return `${n} ${currency || "BYN"}`;
}

function fmtDate(s: string | null | undefined) {
  if (!s) return null;
  // храним yyyy-mm-dd → показываем как dd.mm.yyyy
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
}

function buildRows(
  offer: TariffOffer,
  templates: TemplateOpt[],
  executors: ExecutorOpt[],
): Row[] {
  const dd: OfferDocumentDefaults = (offer.meta?.document_defaults as any) || {};

  const tpl = dd.template_id ? templates.find((t) => t.id === dd.template_id) : null;
  const exe = dd.executor_id ? executors.find((e) => e.id === dd.executor_id) : null;

  const offerAmount = offer.amount;
  const currency = dd.currency || "BYN";
  const currencySource: Source = dd.currency
    ? (dd.currency_manual_override ? "manual" : "from_defaults")
    : "default";

  // unit_price: либо явное → from_defaults; иначе offer.amount → from_offer
  const unitPrice = dd.unit_price ?? offerAmount ?? null;
  const unitPriceSource: Source =
    dd.unit_price !== null && dd.unit_price !== undefined ? "from_defaults" : (offerAmount != null ? "from_offer" : "empty");

  const quantity = dd.quantity ?? 1;
  const quantitySource: Source = dd.quantity !== null && dd.quantity !== undefined ? "from_defaults" : "default";

  const computedAmount = unitPrice != null ? Number((unitPrice * quantity).toFixed(2)) : null;
  const amount = dd.amount_manual_override
    ? dd.amount ?? null
    : (dd.amount ?? computedAmount);
  const amountSource: Source = dd.amount_manual_override
    ? "manual"
    : (dd.amount != null ? "from_defaults" : (computedAmount != null ? "computed" : "empty"));

  const rows: Row[] = [
    // Документ
    {
      label: "Шаблон акта",
      value: tpl ? `${tpl.name}${tpl.code ? ` · ${tpl.code}` : ""}` : null,
      token: "{{document.template_name}}",
      source: tpl ? "from_defaults" : "empty",
    },
    {
      label: "Исполнитель",
      value: exe ? (exe.short_name || exe.full_name) : null,
      token: "{{executor.short_name}}",
      source: exe ? "from_defaults" : "empty",
    },
    // Услуга
    {
      label: "Наименование услуги",
      value: dd.service_name ?? null,
      token: "{{document.service_name}}",
      source: dd.service_name ? "from_defaults" : "empty",
    },
    {
      label: "Описание услуги",
      value: dd.service_description ?? null,
      token: "{{document.service_description}}",
      source: dd.service_description ? "from_defaults" : "empty",
    },
    {
      label: "Единица измерения",
      value: dd.unit ?? null,
      token: "{{document.unit}}",
      source: dd.unit ? "from_defaults" : "empty",
    },
    // Стоимость
    {
      label: "Цена за единицу",
      value: fmtMoney(unitPrice, currency),
      token: "{{document.unit_price}}",
      source: unitPriceSource,
    },
    {
      label: "Количество",
      value: String(quantity),
      token: "{{document.quantity}}",
      source: quantitySource,
    },
    {
      label: "Сумма акта",
      value: fmtMoney(amount, currency),
      token: "{{deal.amount}}",
      source: amountSource,
      hint: dd.amount_manual_override && computedAmount !== null && computedAmount !== amount
        ? `Расчёт: ${computedAmount}, сохранено вручную`
        : undefined,
    },
    {
      label: "Сумма прописью",
      value: null,
      token: "{{deal.amount_words}}",
      source: "deal",
      hint: "Будет вычислена при создании сделки",
    },
    {
      label: "Валюта",
      value: currency,
      token: "{{deal.currency}}",
      source: currencySource,
    },
    // Сроки
    {
      label: "Срок оплаты, дней",
      value: dd.payment_due_days != null ? String(dd.payment_due_days) : null,
      token: "{{document.payment_due_days}}",
      source: dd.payment_due_days != null ? "from_defaults" : "empty",
    },
    {
      label: "Срок оказания услуги, дней",
      value: dd.execution_days != null ? String(dd.execution_days) : null,
      token: "{{document.execution_days}}",
      source: dd.execution_days != null ? "from_defaults" : "empty",
    },
    {
      label: "Количество месяцев",
      value: dd.months_count != null ? String(dd.months_count) : null,
      token: "{{document.months_count}}",
      source: dd.months_count != null ? "from_defaults" : "empty",
    },
    {
      label: "Период оказания услуг с",
      value: fmtDate(dd.service_period_from),
      token: "{{document.service_period_from}}",
      source: dd.service_period_from ? "from_defaults" : "empty",
    },
    {
      label: "Период оказания услуг по",
      value: fmtDate(dd.service_period_to),
      token: "{{document.service_period_to}}",
      source: dd.service_period_to ? "from_defaults" : "empty",
    },
    // Расчёты
    {
      label: "Предоплата, %",
      value: dd.prepayment_percent != null ? String(dd.prepayment_percent) : null,
      token: "{{document.prepayment_percent}}",
      source: dd.prepayment_percent != null ? "from_defaults" : "empty",
    },
    {
      label: "Предоплата, сумма",
      value: fmtMoney(dd.prepayment_amount ?? null, currency),
      token: "{{document.prepayment_amount}}",
      source: dd.prepayment_amount != null ? "from_defaults" : "empty",
    },
    {
      label: "Скидка, сумма",
      value: fmtMoney(dd.discount_amount ?? null, currency),
      token: "{{document.discount_amount}}",
      source: dd.discount_amount != null ? "from_defaults" : "empty",
    },
    {
      label: "Первый платёж",
      value: fmtMoney(dd.first_payment ?? null, currency),
      token: "{{document.first_payment}}",
      source: dd.first_payment != null ? "from_defaults" : "empty",
    },
    {
      label: "Цена для банковской рассрочки",
      value: fmtMoney(dd.bank_credit_price ?? null, currency),
      token: "{{document.bank_credit_price}}",
      source: dd.bank_credit_price != null ? "from_defaults" : "empty",
    },
    {
      label: "Окончательный расчёт",
      value: fmtMoney(dd.final_payment ?? null, currency),
      token: "{{document.final_payment}}",
      source: dd.final_payment != null ? "from_defaults" : "empty",
    },
    // Клиент — заполняется в сделке
    {
      label: "Заказчик (клиент)",
      value: null,
      token: "{{client.legal_name}}",
      source: "client",
      hint: "Будет взято из реквизитов клиента в сделке",
    },
  ];

  return rows;
}

function FieldRow({ row, showOnlyFilled }: { row: Row; showOnlyFilled: boolean }) {
  if (showOnlyFilled && (row.value === null || row.value === "")) return null;
  const empty = row.value === null || row.value === "";
  return (
    <div className="grid grid-cols-12 gap-2 items-center py-1.5 text-sm border-b border-border/30 last:border-0">
      <div className="col-span-4 text-muted-foreground">{row.label}</div>
      <div className={`col-span-4 ${empty ? "text-muted-foreground/60 italic" : ""}`}>
        {empty ? "не заполнено" : row.value}
        {row.hint && <div className="text-[10px] text-muted-foreground mt-0.5">{row.hint}</div>}
      </div>
      <div className="col-span-2">
        <Badge variant="outline" className={`text-[10px] ${SOURCE_CLASS[row.source]}`}>
          {SOURCE_LABEL[row.source]}
        </Badge>
      </div>
      <div className="col-span-2 flex items-center justify-end gap-1">
        <code className="text-[10px] text-muted-foreground truncate max-w-[140px]" title={row.token}>
          {row.token}
        </code>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => copyToken(row.token)}
          title="Скопировать плейсхолдер"
        >
          <Copy className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

function OfferCard({
  offer, templates, executors, showOnlyFilled,
}: {
  offer: TariffOffer & { tariffs?: { id: string; name: string; code: string } };
  templates: TemplateOpt[];
  executors: ExecutorOpt[];
  showOnlyFilled: boolean;
}) {
  const dd: OfferDocumentDefaults = (offer.meta?.document_defaults as any) || {};
  const generateAct = !!dd.generate_act;
  const rows = useMemo(
    () => buildRows(offer, templates, executors),
    [offer, templates, executors],
  );

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <CardTitle className="text-sm">{offer.button_label}</CardTitle>
            <Badge variant="outline" className="text-[10px]">
              {offer.amount} {dd.currency || "BYN"}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {offer.offer_type === "pay_now" ? "Оплата" : offer.offer_type === "trial" ? "Trial" : "Pre-reg"}
            </Badge>
            {offer.is_primary && (
              <Badge variant="outline" className="text-[10px] bg-primary/5 text-primary/70">основная</Badge>
            )}
            {!offer.is_active && (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">выключена</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {generateAct ? (
              <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-200/50">
                акт формируется
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                акт не формируется
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border border-border/40 bg-muted/20 p-2">
          {rows.map((r, i) => (
            <FieldRow key={i} row={r} showOnlyFilled={showOnlyFilled} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function ProductDocumentsOverview({ productId }: Props) {
  const { data: tariffs = [] } = useTariffs(productId);
  const { data: offers = [] } = useProductOffers(productId);
  const [templates, setTemplates] = useState<TemplateOpt[]>([]);
  const [executors, setExecutors] = useState<ExecutorOpt[]>([]);
  const [showOnlyFilled, setShowOnlyFilled] = useState(false);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [tpl, exe] = await Promise.all([
        supabase.from("document_templates").select("id, name, code, is_active").eq("is_active", true).is("deleted_at", null),
        supabase.from("executors").select("id, short_name, full_name, is_default, is_active").eq("is_active", true),
      ]);
      if (cancelled) return;
      if (!tpl.error && tpl.data) setTemplates(tpl.data as TemplateOpt[]);
      if (!exe.error && exe.data) setExecutors(exe.data as ExecutorOpt[]);
    })();
    return () => { cancelled = true; };
  }, []);

  const offersByTariff = useMemo(() => {
    const map = new Map<string, (typeof offers)>();
    for (const o of offers as any[]) {
      const arr = map.get(o.tariff_id) || [];
      arr.push(o);
      map.set(o.tariff_id, arr);
    }
    return map;
  }, [offers]);

  const totalDefaults = useMemo(
    () => (offers as any[]).filter((o) => !!o.meta?.document_defaults).length,
    [offers],
  );

  const visibleTariffs = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return tariffs;
    return (tariffs as any[]).filter((t) =>
      (t.name || "").toLowerCase().includes(q) ||
      (t.code || "").toLowerCase().includes(q),
    );
  }, [tariffs, filter]);

  return (
    <div className="space-y-4">
      {/* Header card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-500 shrink-0">
              <FileText className="h-4 w-4" />
            </div>
            <div className="space-y-1 flex-1">
              <CardTitle className="text-base">Документы продукта</CardTitle>
              <p className="text-xs text-muted-foreground">
                Сводка полей, которые попадут в акт по каждой кнопке оплаты. Источник данных:
                {" "}<code className="text-[11px]">tariff_offers.meta.document_defaults</code>{" "}
                + сумма/валюта самой кнопки. Эти значения будут зафиксированы в{" "}
                <code className="text-[11px]">orders_v2.meta.document_data</code> при оплате.
              </p>
              <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
                <Badge variant="outline" className="bg-primary/5 text-primary/70">
                  <Layers className="h-3 w-3 mr-1" /> Тарифов: {tariffs.length}
                </Badge>
                <Badge variant="outline">Кнопок оплаты: {offers.length}</Badge>
                <Badge variant="outline">С document_defaults: {totalDefaults}</Badge>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Поиск по тарифу"
                className="pl-7 h-8 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="only-filled"
                checked={showOnlyFilled}
                onCheckedChange={setShowOnlyFilled}
              />
              <Label htmlFor="only-filled" className="text-xs text-muted-foreground">
                Только заполненные поля
              </Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tariffs accordion */}
      {visibleTariffs.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Тарифы не найдены.
          </CardContent>
        </Card>
      ) : (
        <Accordion type="multiple" defaultValue={(visibleTariffs as any[]).map((t) => t.id)} className="space-y-2">
          {(visibleTariffs as any[]).map((t) => {
            const tariffOffers = offersByTariff.get(t.id) || [];
            return (
              <AccordionItem key={t.id} value={t.id} className="border border-border/40 rounded-lg bg-card">
                <AccordionTrigger className="px-4 py-2 hover:no-underline">
                  <div className="flex items-center gap-2 flex-wrap text-left">
                    <Layers className="h-4 w-4 text-indigo-500" />
                    <span className="font-medium text-sm">{t.name}</span>
                    {t.code && (
                      <code className="text-[10px] text-muted-foreground">{t.code}</code>
                    )}
                    <Badge variant="outline" className="text-[10px]">
                      кнопок: {tariffOffers.length}
                    </Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-3">
                  {tariffOffers.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2">
                      Нет кнопок оплаты для этого тарифа.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {tariffOffers.map((o: any) => (
                        <OfferCard
                          key={o.id}
                          offer={o}
                          templates={templates}
                          executors={executors}
                          showOnlyFilled={showOnlyFilled}
                        />
                      ))}
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
    </div>
  );
}
