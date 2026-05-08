import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
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

interface TemplateOpt { id: string; name: string; code: string; }
interface ExecutorOpt { id: string; short_name: string | null; full_name: string; is_default: boolean; }

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/80 pt-2 border-t first:border-t-0 first:pt-0">
      {children}
    </div>
  );
}

export function OfferDocumentDefaultsCard({ value, onChange }: Props) {
  const v = value ?? {};
  const set = (patch: Partial<OfferDocumentDefaults>) => onChange({ ...v, ...patch });

  const [templates, setTemplates] = useState<TemplateOpt[]>([]);
  const [executors, setExecutors] = useState<ExecutorOpt[]>([]);
  const [showTechIds, setShowTechIds] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: tpl }, { data: exec }] = await Promise.all([
        supabase
          .from("document_templates")
          .select("id, name, code")
          .eq("is_active", true)
          .order("name", { ascending: true }),
        supabase
          .from("executors")
          .select("id, short_name, full_name, is_default")
          .eq("is_active", true)
          .order("is_default", { ascending: false })
          .order("short_name", { ascending: true }),
      ]);
      setTemplates((tpl ?? []) as TemplateOpt[]);
      setExecutors((exec ?? []) as ExecutorOpt[]);
    })();
  }, []);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
          <FileText className="h-4 w-4 text-indigo-500" />
          Данные для документов
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
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
                  <div className="p-2 text-sm text-muted-foreground">Нет активных шаблонов</div>
                ) : templates.map(t => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}{t.code ? ` (${t.code})` : ""}
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
                  <div className="p-2 text-sm text-muted-foreground">Нет активных исполнителей</div>
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
            <Input type="number" value={v.quantity ?? ""} onChange={(e) => set({ quantity: num(e.target.value) })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Цена за единицу</Label>
            <Input type="number" value={v.unit_price ?? ""} onChange={(e) => set({ unit_price: num(e.target.value) })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Сумма акта</Label>
            <Input type="number" value={v.amount ?? ""} onChange={(e) => set({ amount: num(e.target.value) })} />
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Валюта</Label>
            <Input
              value={v.currency ?? ""}
              onChange={(e) => set({ currency: e.target.value || null })}
              placeholder="BYN"
            />
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
