import { useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { FileText, RotateCcw, Info } from "lucide-react";
import type { OfferDocumentDefaults } from "@/hooks/useTariffOffers";

interface Props {
  value: OfferDocumentDefaults | undefined;
  onChange: (next: OfferDocumentDefaults) => void;
  /** Сумма кнопки оплаты (offer.amount) — основной источник суммы акта */
  offerAmount?: number;
  /** Валюта кнопки (если есть). Сейчас в системе BYN. */
  offerCurrency?: string;
}

/** Системный список валют. НЕ создаём отдельную таблицу, переиспользуем плоский enum. */
const CURRENCIES = ["BYN", "USD", "EUR", "RUB"] as const;
const DEFAULT_CURRENCY = "BYN";

const num = (s: string): number | null => (s === "" ? null : (Number(s) || 0));

interface TemplateOpt {
  id: string;
  name: string;
  code: string;
  current_version: number | string | null;
  has_active_version: boolean;
}
interface ExecutorOpt { id: string; short_name: string | null; full_name: string; is_default: boolean; }

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/80 pt-2 border-t first:border-t-0 first:pt-0">
      {children}
    </div>
  );
}

export function OfferDocumentDefaultsCard({ value, onChange, offerAmount, offerCurrency }: Props) {
  const v = value ?? {};
  const set = (patch: Partial<OfferDocumentDefaults>) => onChange({ ...v, ...patch });

  const [templates, setTemplates] = useState<TemplateOpt[]>([]);
  const [executors, setExecutors] = useState<ExecutorOpt[]>([]);
  const [showTechIds, setShowTechIds] = useState(false);
  const initRef = useRef(false);
  const lastOfferAmount = useRef<number | undefined>(offerAmount);
  const lastOfferCurrency = useRef<string | undefined>(offerCurrency);

  // PATCH UI-BLOCKER-1: реально подтягиваем шаблоны и исполнителей из тех же таблиц,
  // что и разделы /admin/ai → Документы → Шаблоны / Исполнители. Никакого хардкода.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [tpl, exe] = await Promise.all([
        supabase
          .from("document_templates")
          .select("id, name, code, is_active, current_version_id, document_template_versions:document_template_versions!document_templates_current_version_id_fkey(version)")
          .eq("is_active", true)
          .order("name", { ascending: true }),
        supabase
          .from("executors")
          .select("id, short_name, full_name, is_default, is_active")
          .eq("is_active", true)
          .order("is_default", { ascending: false })
          .order("short_name", { ascending: true }),
      ]);
      if (cancelled) return;
      if (!tpl.error && tpl.data) {
        setTemplates(
          (tpl.data as any[]).map((t) => ({
            id: t.id,
            name: t.name,
            code: t.code,
            current_version: t.document_template_versions?.version ?? null,
            has_active_version: !!t.current_version_id,
          })),
        );
      } else if (tpl.error) {
        // Fallback: канонические версии могут отсутствовать как relation — берём без версий.
        const fallback = await supabase
          .from("document_templates")
          .select("id, name, code, is_active")
          .eq("is_active", true)
          .order("name", { ascending: true });
        if (!cancelled && !fallback.error && fallback.data) {
          setTemplates(
            (fallback.data as any[]).map((t) => ({
              id: t.id, name: t.name, code: t.code, current_version: null, has_active_version: true,
            })),
          );
        }
      }
      if (!exe.error && exe.data) {
        setExecutors(exe.data as ExecutorOpt[]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // PATCH DOC-OFFER-1/2: первичный авто-fill при открытии вкладки.
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    const patch: Partial<OfferDocumentDefaults> = {};
    if ((v.unit_price ?? null) === null && typeof offerAmount === "number") patch.unit_price = offerAmount;
    if ((v.quantity ?? null) === null) patch.quantity = 1;
    const up = patch.unit_price ?? v.unit_price ?? offerAmount ?? null;
    const qty = patch.quantity ?? v.quantity ?? 1;
    if ((v.amount ?? null) === null && typeof up === "number") patch.amount = Number((up * qty).toFixed(2));
    if ((v.currency ?? null) === null) patch.currency = offerCurrency || DEFAULT_CURRENCY;
    if (Object.keys(patch).length > 0) onChange({ ...v, ...patch });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // PATCH HIDE-EXECUTOR: автопреселект default-исполнителя при первом
  // появлении списка, ТОЛЬКО если значение ещё не выставлено. Ручной выбор
  // пользователя никогда не перетирается.
  const executorPreselectRef = useRef(false);
  useEffect(() => {
    if (executorPreselectRef.current) return;
    if (executors.length === 0) return;
    executorPreselectRef.current = true;
    if (v.executor_id) return;
    const def = executors.find((e) => e.is_default);
    if (def) onChange({ ...v, executor_id: def.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executors]);

  // PATCH DOC-OFFER-2: реакция на смену суммы кнопки.
  useEffect(() => {
    if (!initRef.current) return;
    if (offerAmount === lastOfferAmount.current) return;
    lastOfferAmount.current = offerAmount;
    if (typeof offerAmount !== "number") return;
    if (v.amount_manual_override) return; // уважаем ручной override — не перетираем
    const qty = v.quantity ?? 1;
    onChange({
      ...v,
      unit_price: offerAmount,
      quantity: qty,
      amount: Number((offerAmount * qty).toFixed(2)),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerAmount]);

  // PATCH DOC-OFFER-3: реакция на смену валюты кнопки.
  useEffect(() => {
    if (!initRef.current) return;
    if (offerCurrency === lastOfferCurrency.current) return;
    lastOfferCurrency.current = offerCurrency;
    if (!offerCurrency) return;
    if (v.currency_manual_override) return;
    onChange({ ...v, currency: offerCurrency });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerCurrency]);

  const handleQuantityChange = (raw: string) => {
    const qty = num(raw);
    const up = v.unit_price ?? null;
    const next: Partial<OfferDocumentDefaults> = { quantity: qty };
    if (!v.amount_manual_override && typeof up === "number" && typeof qty === "number") {
      next.amount = Number((up * qty).toFixed(2));
    }
    set(next);
  };

  const handleUnitPriceChange = (raw: string) => {
    const up = num(raw);
    const qty = v.quantity ?? 1;
    const next: Partial<OfferDocumentDefaults> = { unit_price: up };
    if (!v.amount_manual_override && typeof up === "number") {
      next.amount = Number((up * qty).toFixed(2));
    }
    set(next);
  };

  const handleAmountChange = (raw: string) => {
    set({ amount: num(raw), amount_manual_override: true });
  };

  const handleResetAmountFromOffer = () => {
    if (typeof offerAmount !== "number") return;
    const qty = v.quantity ?? 1;
    onChange({
      ...v,
      unit_price: offerAmount,
      quantity: qty,
      amount: Number((offerAmount * qty).toFixed(2)),
      amount_manual_override: false,
    });
  };

  const handleCurrencyChange = (val: string) => {
    set({ currency: val, currency_manual_override: val !== (offerCurrency || DEFAULT_CURRENCY) });
  };

  const computedAmount =
    typeof v.unit_price === "number" && typeof v.quantity === "number"
      ? Number((v.unit_price * v.quantity).toFixed(2))
      : null;
  const amountMismatch =
    v.amount_manual_override && computedAmount !== null && computedAmount !== v.amount;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
          <FileText className="h-4 w-4 text-indigo-500" />
          Данные для документов
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-md bg-muted/40 border border-border/40 p-2.5 text-xs text-muted-foreground flex gap-2">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-indigo-500" />
          <span>
            По умолчанию сумма акта берётся из суммы кнопки оплаты. Количество = 1.
            Если изменить количество или цену за единицу, сумма акта пересчитается автоматически.
          </span>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <Label>Формировать акт</Label>
            <p className="text-xs text-muted-foreground">
              Будет ли при оплате готовиться акт выполненных работ.
            </p>
          </div>
          <Switch
            checked={!!v.generate_act}
            onCheckedChange={(c) => set({ generate_act: c })}
          />
        </div>

        {/* Шаблон и исполнитель */}
        <SectionTitle>Шаблон и исполнитель</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Шаблон акта</Label>
            <Select
              value={v.template_id ?? ""}
              onValueChange={(val) => set({ template_id: val || null })}
            >
              <SelectTrigger><SelectValue placeholder="Выберите шаблон" /></SelectTrigger>
              <SelectContent>
                {templates.length === 0 ? (
                  <div className="p-2 text-sm text-muted-foreground">
                    Нет активных шаблонов. Добавьте шаблон в Нейросеть → Документы → Шаблоны.
                  </div>
                ) : templates.map(t => (
                  <SelectItem key={t.id} value={t.id} disabled={!t.has_active_version}>
                    {t.name}
                    {t.code ? ` · ${t.code}` : ""}
                    {t.current_version != null ? ` · v${t.current_version}` : ""}
                    {!t.has_active_version ? " · нет активной версии" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {showTechIds && v.template_id && (
              <p className="text-[10px] font-mono text-muted-foreground">{v.template_id}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Исполнитель</Label>
            <Select
              value={v.executor_id ?? ""}
              onValueChange={(val) => set({ executor_id: val || null })}
            >
              <SelectTrigger><SelectValue placeholder="Выберите исполнителя" /></SelectTrigger>
              <SelectContent>
                {executors.length === 0 ? (
                  <div className="p-2 text-sm text-muted-foreground">
                    Нет активных исполнителей. Добавьте в Нейросеть → Документы → Исполнители.
                  </div>
                ) : executors.map(ex => (
                  <SelectItem key={ex.id} value={ex.id}>
                    {ex.short_name || ex.full_name}{ex.is_default ? " · по умолчанию" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {showTechIds && v.executor_id && (
              <p className="text-[10px] font-mono text-muted-foreground">{v.executor_id}</p>
            )}
            {executors.length > 0 && !executors.some((e) => e.is_default) && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                Исполнитель по умолчанию не задан. Откройте Нейросеть → Документы → Исполнители и отметьте одного как «по умолчанию».
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="doc-tech-ids" checked={showTechIds} onCheckedChange={setShowTechIds} />
          <Label htmlFor="doc-tech-ids" className="text-[11px] text-muted-foreground">
            Показывать технические ID
          </Label>
        </div>

        {/* Услуга */}
        <SectionTitle>Услуга</SectionTitle>
        <div className="space-y-1.5">
          <Label className="text-xs">Наименование услуги</Label>
          <Input
            value={v.service_name ?? ""}
            onChange={(e) => set({ service_name: e.target.value || null })}
            placeholder="Например: Доступ к курсу «Корпоративный блок»"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Описание услуги</Label>
          <Textarea
            value={v.service_description ?? ""}
            onChange={(e) => set({ service_description: e.target.value || null })}
            rows={2}
          />
        </div>

        {/* Стоимость */}
        <SectionTitle>Стоимость</SectionTitle>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Единица измерения</Label>
            <Input
              value={v.unit ?? ""}
              onChange={(e) => set({ unit: e.target.value || null })}
              placeholder="шт / мес"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Количество</Label>
            <Input type="number" value={v.quantity ?? ""} onChange={(e) => handleQuantityChange(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Цена за единицу</Label>
            <Input type="number" value={v.unit_price ?? ""} onChange={(e) => handleUnitPriceChange(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">
              Сумма акта
              {v.amount_manual_override && <span className="ml-1 text-amber-600">(вручную)</span>}
            </Label>
            <Input type="number" value={v.amount ?? ""} onChange={(e) => handleAmountChange(e.target.value)} />
            <p className="text-[10px] text-muted-foreground">
              Рассчитывается автоматически: цена × количество. Можно изменить вручную.
            </p>
            {amountMismatch && (
              <p className="text-[10px] text-amber-600">
                Расчёт: {computedAmount}. Сейчас сохранено вручную.
              </p>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <div className="space-y-1.5">
            <Label className="text-xs">Валюта</Label>
            <Select value={v.currency ?? DEFAULT_CURRENCY} onValueChange={handleCurrencyChange}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleResetAmountFromOffer}
              disabled={typeof offerAmount !== "number"}
              className="gap-1.5"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Пересчитать из цены кнопки {typeof offerAmount === "number" ? `(${offerAmount})` : ""}
            </Button>
          </div>
        </div>

        {/* Сроки */}
        <SectionTitle>Сроки</SectionTitle>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Срок оплаты, дней</Label>
            <Input type="number" value={v.payment_due_days ?? ""} onChange={(e) => set({ payment_due_days: num(e.target.value) })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Срок оказания услуги, дней</Label>
            <Input type="number" value={v.execution_days ?? ""} onChange={(e) => set({ execution_days: num(e.target.value) })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Количество месяцев</Label>
            <Input type="number" value={v.months_count ?? ""} onChange={(e) => set({ months_count: num(e.target.value) })} />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Период оказания услуг с</Label>
            <DatePicker
              value={v.service_period_from ?? ""}
              onChange={(val) => set({ service_period_from: val || null })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Период оказания услуг по</Label>
            <DatePicker
              value={v.service_period_to ?? ""}
              onChange={(val) => set({ service_period_to: val || null })}
            />
          </div>
        </div>

        {/* Расчёты */}
        <SectionTitle>Расчёты</SectionTitle>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Предоплата, %</Label>
            <Input type="number" value={v.prepayment_percent ?? ""} onChange={(e) => set({ prepayment_percent: num(e.target.value) })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Предоплата, сумма</Label>
            <Input type="number" value={v.prepayment_amount ?? ""} onChange={(e) => set({ prepayment_amount: num(e.target.value) })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Скидка, сумма</Label>
            <Input type="number" value={v.discount_amount ?? ""} onChange={(e) => set({ discount_amount: num(e.target.value) })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Первый платёж</Label>
            <Input type="number" value={v.first_payment ?? ""} onChange={(e) => set({ first_payment: num(e.target.value) })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Цена для банковской рассрочки</Label>
            <Input type="number" value={v.bank_credit_price ?? ""} onChange={(e) => set({ bank_credit_price: num(e.target.value) })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Окончательный расчёт</Label>
            <Input type="number" value={v.final_payment ?? ""} onChange={(e) => set({ final_payment: num(e.target.value) })} />
          </div>
        </div>

        {/* Комментарий */}
        <SectionTitle>Комментарий</SectionTitle>
        <div className="space-y-1.5">
          <Label className="text-xs">Комментарий для документа</Label>
          <Textarea
            value={v.comment ?? ""}
            onChange={(e) => set({ comment: e.target.value || null })}
            rows={2}
          />
        </div>
      </CardContent>
    </Card>
  );
}
