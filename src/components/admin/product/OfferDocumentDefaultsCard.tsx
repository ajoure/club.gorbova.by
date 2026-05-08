import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FileText } from "lucide-react";
import type { OfferDocumentDefaults } from "@/hooks/useTariffOffers";

interface Props {
  value: OfferDocumentDefaults | undefined;
  onChange: (next: OfferDocumentDefaults) => void;
}

const num = (s: string): number | null => (s === "" ? null : (Number(s) || 0));

export function OfferDocumentDefaultsCard({ value, onChange }: Props) {
  const v = value ?? {};
  const set = (patch: Partial<OfferDocumentDefaults>) => onChange({ ...v, ...patch });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
          <FileText className="h-4 w-4 text-indigo-500" />
          Данные для документов
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label>Формировать акт</Label>
            <p className="text-xs text-muted-foreground">
              Будет ли при оплате этой кнопкой готовиться акт выполненных работ.
            </p>
          </div>
          <Switch
            checked={!!v.generate_act}
            onCheckedChange={(c) => set({ generate_act: c })}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Шаблон акта (template_id)</Label>
            <Input
              value={v.template_id ?? ""}
              onChange={(e) => set({ template_id: e.target.value || null })}
              placeholder="UUID шаблона"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Исполнитель (executor_id)</Label>
            <Input
              value={v.executor_id ?? ""}
              onChange={(e) => set({ executor_id: e.target.value || null })}
              placeholder="UUID исполнителя"
            />
          </div>
        </div>

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

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Ед. измерения</Label>
            <Input
              value={v.unit ?? ""}
              onChange={(e) => set({ unit: e.target.value || null })}
              placeholder="шт / мес"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Количество</Label>
            <Input
              type="number"
              value={v.quantity ?? ""}
              onChange={(e) => set({ quantity: num(e.target.value) })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Цена за единицу</Label>
            <Input
              type="number"
              value={v.unit_price ?? ""}
              onChange={(e) => set({ unit_price: num(e.target.value) })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Сумма акта</Label>
            <Input
              type="number"
              value={v.amount ?? ""}
              onChange={(e) => set({ amount: num(e.target.value) })}
            />
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
          <div className="space-y-1.5">
            <Label className="text-xs">Срок оплаты, дней</Label>
            <Input
              type="number"
              value={v.payment_due_days ?? ""}
              onChange={(e) => set({ payment_due_days: num(e.target.value) })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Срок оказания, дней</Label>
            <Input
              type="number"
              value={v.execution_days ?? ""}
              onChange={(e) => set({ execution_days: num(e.target.value) })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Кол-во месяцев</Label>
            <Input
              type="number"
              value={v.months_count ?? ""}
              onChange={(e) => set({ months_count: num(e.target.value) })}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Период оказания услуг с</Label>
            <Input
              type="date"
              value={v.service_period_from ?? ""}
              onChange={(e) => set({ service_period_from: e.target.value || null })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Период оказания услуг по</Label>
            <Input
              type="date"
              value={v.service_period_to ?? ""}
              onChange={(e) => set({ service_period_to: e.target.value || null })}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Предоплата, %</Label>
            <Input
              type="number"
              value={v.prepayment_percent ?? ""}
              onChange={(e) => set({ prepayment_percent: num(e.target.value) })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Предоплата, сумма</Label>
            <Input
              type="number"
              value={v.prepayment_amount ?? ""}
              onChange={(e) => set({ prepayment_amount: num(e.target.value) })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Скидка, сумма</Label>
            <Input
              type="number"
              value={v.discount_amount ?? ""}
              onChange={(e) => set({ discount_amount: num(e.target.value) })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Первый платёж</Label>
            <Input
              type="number"
              value={v.first_payment ?? ""}
              onChange={(e) => set({ first_payment: num(e.target.value) })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Цена для банк. рассрочки</Label>
            <Input
              type="number"
              value={v.bank_credit_price ?? ""}
              onChange={(e) => set({ bank_credit_price: num(e.target.value) })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Окончательный расчёт</Label>
            <Input
              type="number"
              value={v.final_payment ?? ""}
              onChange={(e) => set({ final_payment: num(e.target.value) })}
            />
          </div>
        </div>

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
