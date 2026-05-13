// ============================================================================
// OfferDocumentScenariosCard.tsx — Sprint 12.
//
// Массив сценариев документа в `tariff_offers.meta.document_scenarios[]`.
// UI предзаполняет два базовых сценария «Физлицо» и «Юрлицо», но storage и
// компонент работают как массив — можно добавить/удалить произвольные сценарии
// без переписывания UI.
//
// Канон контракта см. mem://architecture/documents/document-scenarios-sot.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { FileStack, Info, Plus, Trash2, AlertTriangle } from 'lucide-react';
import {
  PAYMENT_CHANNEL_OPTIONS,
  CHANNEL_LABELS_RU,
  type PaymentChannel,
} from '@/utils/derivePaymentChannel';
import type {
  OfferDocumentScenario,
  DocumentScenarioPayerType,
} from '@/hooks/useTariffOffers';

interface Props {
  value: OfferDocumentScenario[] | undefined;
  onChange: (next: OfferDocumentScenario[]) => void;
}

interface TemplateOpt { id: string; name: string; }
interface ExecutorOpt { id: string; full_name: string | null; short_name: string | null; is_default: boolean; }

const PAYER_LABEL: Record<DocumentScenarioPayerType, string> = {
  individual: 'Физлицо',
  legal_entity: 'Юрлицо',
};

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `scn_${Math.random().toString(36).slice(2, 10)}`;
}

function makeBlank(payer: DocumentScenarioPayerType): OfferDocumentScenario {
  return {
    id: uid(),
    payer_type: payer,
    payment_channels: [],
    template_id: null,
    executor_id: null,
    requires_required_requisites: payer === 'legal_entity',
    is_enabled: true,
  };
}

/**
 * Гарантируем минимум две предзаполненные строки (Физлицо / Юрлицо), не
 * затирая существующие записи. Legacy `payment_methods` нормализуем в
 * `payment_channels` (read-merge, write-only-canonical).
 */
function ensureBaseRows(input: OfferDocumentScenario[] | undefined): OfferDocumentScenario[] {
  const list = Array.isArray(input) ? input.map(normalizeRow) : [];
  const hasInd = list.some((s) => s.payer_type === 'individual');
  const hasLeg = list.some((s) => s.payer_type === 'legal_entity');
  const out = [...list];
  if (!hasInd) out.unshift(makeBlank('individual'));
  if (!hasLeg) out.push(makeBlank('legal_entity'));
  return out;
}

function normalizeRow(raw: any): OfferDocumentScenario {
  const channels: string[] = Array.isArray(raw?.payment_channels)
    ? raw.payment_channels
    : Array.isArray(raw?.payment_methods)
      ? raw.payment_methods
      : [];
  return {
    id: raw?.id || uid(),
    payer_type: (raw?.payer_type as DocumentScenarioPayerType) || 'individual',
    payment_channels: channels.filter((c): c is PaymentChannel =>
      ['card', 'apple_pay', 'google_pay', 'erip', 'bank_transfer'].includes(c),
    ) as any,
    template_id: raw?.template_id || null,
    executor_id: raw?.executor_id || null,
    requires_required_requisites: raw?.requires_required_requisites === true,
    is_enabled: raw?.is_enabled !== false,
  };
}

export function OfferDocumentScenariosCard({ value, onChange }: Props) {
  const [templates, setTemplates] = useState<TemplateOpt[]>([]);
  const [executors, setExecutors] = useState<ExecutorOpt[]>([]);

  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    // One-shot нормализация при первом открытии: подмешать базовые строки и
    // конвертировать legacy `payment_methods` → `payment_channels`. Запись
    // произойдёт только при сохранении оффера (общий save handler).
    const next = ensureBaseRows(value);
    if (JSON.stringify(next) !== JSON.stringify(value || [])) onChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [tpl, exe] = await Promise.all([
        supabase
          .from('document_templates')
          .select('id, name, is_active, current_version_id, template_status')
          .eq('is_active', true)
          .eq('template_status', 'active')
          .is('deleted_at', null)
          .not('current_version_id', 'is', null)
          .order('name', { ascending: true }),
        supabase
          .from('executors')
          .select('id, full_name, short_name, is_default, is_active')
          .eq('is_active', true)
          .order('is_default', { ascending: false })
          .order('short_name', { ascending: true }),
      ]);
      if (cancelled) return;
      if (tpl.data) setTemplates(tpl.data as TemplateOpt[]);
      if (exe.data) setExecutors(exe.data as ExecutorOpt[]);
    })();
    return () => { cancelled = true; };
  }, []);

  const rows = ensureBaseRows(value);

  const update = (id: string, patch: Partial<OfferDocumentScenario>) => {
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  const remove = (id: string) => {
    onChange(rows.filter((r) => r.id !== id));
  };
  const toggleChannel = (id: string, channel: PaymentChannel, checked: boolean) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const set = new Set<string>(row.payment_channels);
    if (checked) set.add(channel); else set.delete(channel);
    update(id, { payment_channels: Array.from(set) as OfferDocumentScenario['payment_channels'] });
  };
  const addExtra = (payer: DocumentScenarioPayerType) => {
    onChange([...rows, makeBlank(payer)]);
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
          <FileStack className="h-4 w-4 text-indigo-500" />
          Сценарии документов по способу оплаты
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md bg-muted/40 border border-border/40 p-2.5 text-xs text-muted-foreground space-y-1.5">
          <div className="flex gap-2">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-indigo-500" />
            <span>
              Это единственное место, где задаются <strong>шаблон документа</strong> и
              <strong> исполнитель</strong>. При создании сделки система подберёт сценарий
              по <strong>типу плательщика</strong> и <strong>способу оплаты</strong>.
            </span>
          </div>
          <div className="flex gap-2">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-500" />
            <span>
              Если ни один сценарий не включён и нет legacy-значений в «Данные для
              документов», документ не будет создан — в карточке сделки появится
              причина «Не выбран шаблон документа для сценария».
            </span>
          </div>
          <div className="flex gap-2">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-500" />
            <span>
              Apple Pay / Google Pay могут определяться провайдером как «Карта».
              Если провайдер не передал отдельный канал, будет применён
              сценарий «Карта».
            </span>
          </div>
        </div>

        <div className="space-y-4">
          {rows.map((row, idx) => {
            const dupIndex = rows
              .slice(0, idx)
              .filter((r) => r.payer_type === row.payer_type).length;
            const isExtra = dupIndex > 0;
            return (
              <div
                key={row.id}
                className={`rounded-lg border p-3 space-y-3 ${row.is_enabled ? '' : 'opacity-60'}`}
              >
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      Сценарий: {PAYER_LABEL[row.payer_type]}
                      {isExtra ? ` · #${dupIndex + 1}` : ''}
                    </Badge>
                    {!row.is_enabled && (
                      <Badge variant="secondary" className="text-[10px]">Выключен</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <Switch
                        checked={row.is_enabled}
                        onCheckedChange={(c) => update(row.id, { is_enabled: c })}
                      />
                      <Label className="text-xs">Включён</Label>
                    </div>
                    {isExtra && (
                      <Button
                        type="button" variant="ghost" size="sm"
                        className="h-7 px-2 text-rose-600 hover:text-rose-700"
                        onClick={() => remove(row.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Применять при способе оплаты</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {PAYMENT_CHANNEL_OPTIONS.map((opt) => {
                      const checked = (row.payment_channels as string[]).includes(opt.value);
                      return (
                        <label
                          key={opt.value}
                          className="flex items-center gap-2 text-xs cursor-pointer"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(c) => toggleChannel(row.id, opt.value, c === true)}
                          />
                          <span>{opt.label}</span>
                        </label>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Если не отмечено ни одного — сценарий применяется для любого канала
                    того же типа плательщика.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Шаблон документа</Label>
                    <Select
                      value={row.template_id ?? ''}
                      onValueChange={(v) => update(row.id, { template_id: v || null })}
                    >
                      <SelectTrigger><SelectValue placeholder="Не выбран" /></SelectTrigger>
                      <SelectContent>
                        {templates.length === 0 ? (
                          <div className="p-2 text-xs text-muted-foreground">
                            Нет активных шаблонов
                          </div>
                        ) : templates.map((t) => (
                          <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Исполнитель</Label>
                    <Select
                      value={row.executor_id ?? ''}
                      onValueChange={(v) => update(row.id, { executor_id: v || null })}
                    >
                      <SelectTrigger><SelectValue placeholder="Не выбран" /></SelectTrigger>
                      <SelectContent>
                        {executors.length === 0 ? (
                          <div className="p-2 text-xs text-muted-foreground">
                            Нет активных исполнителей
                          </div>
                        ) : executors.map((e) => (
                          <SelectItem key={e.id} value={e.id}>
                            {e.short_name || e.full_name || e.id.slice(0, 8)}
                            {e.is_default ? ' · по умолчанию' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Switch
                    checked={row.requires_required_requisites === true}
                    onCheckedChange={(c) => update(row.id, { requires_required_requisites: c })}
                  />
                  <div>
                    <Label className="text-xs">Требовать обязательные реквизиты</Label>
                    <p className="text-[10px] text-muted-foreground">
                      Если включено — без заполненных реквизитов карточки плательщика
                      документ создан не будет.
                    </p>
                  </div>
                </div>
                {row.payment_channels.length > 0 && (
                  <div className="text-[10px] text-muted-foreground">
                    Каналы: {row.payment_channels.map((c) => CHANNEL_LABELS_RU[c as PaymentChannel] || c).join(', ')}
                  </div>
                )}
                {row.is_enabled && (!row.template_id || !row.executor_id) && (
                  <div className="flex items-start gap-2 text-[11px] text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>
                      {!row.template_id && !row.executor_id
                        ? 'Не выбран шаблон и исполнитель — документ по этому сценарию создан не будет.'
                        : !row.template_id
                          ? 'Не выбран шаблон — документ по этому сценарию создан не будет.'
                          : 'Не выбран исполнитель — документ по этому сценарию создан не будет.'}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => addExtra('individual')}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Ещё сценарий «Физлицо»
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => addExtra('legal_entity')}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Ещё сценарий «Юрлицо»
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
