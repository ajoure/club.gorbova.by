/**
 * PackageFieldsClientForm V2 — per-document anchored questionnaire.
 *
 * Контракт:
 *   • Если задан `packageTemplateItemId` — рендерит только pf-поля,
 *     встречающиеся в этом конкретном документе, и сохраняет значения
 *     как per-item override (`package_template_item_id` в RPC).
 *   • Если `packageTemplateItemId` НЕ задан — fallback на старое поведение:
 *     все pf-поля пакета, session-level значения.
 *   • Effective value для поля: per-item override (если есть) →
 *     fallback к session-level (общее значение пакета).
 *
 * Канонические календари (DatePicker/DateTimePicker), компактная сетка.
 * Технический pf-XXXXXX клиенту не показывается.
 */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Save, RotateCcw, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DatePicker } from "@/components/ui/date-picker";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { format } from "date-fns";
import {
  usePackageSessionFields,
  readRawValue,
  type DedupedQuestion,
  type SessionFieldValueRow,
} from "@/hooks/usePackageSessionFields";
import { resolveSmartDatePrefill } from "@/lib/packageFields/smartDate";
import type { PackageFieldChoice } from "@/hooks/usePackageFieldCatalog";

interface Props {
  sessionId: string | null;
  packageTemplateId: string | null;
  /** Если задан — рендерим и сохраняем только поля этого документа. */
  packageTemplateItemId?: string | null;
  sessionCreatedAt?: string | null;
  disabled?: boolean;
  /** Внешний контроллер: вызывается после успешного save. */
  onSaved?: () => void;
  /** Скрыть собственную кнопку «Сохранить» (для интеграции в общую анкету). */
  hideSaveButton?: boolean;
  /**
   * Orphan-режим: рендерить ТОЛЬКО pf-поля каталога, которых нет ни в одном
   * активном DOCX-шаблоне пакета. Сохранение — session-level, без per-item
   * override, без reset, без бейджа «общее значение / переопределено».
   * Не учитывается в готовности документа и не блокирует генерацию.
   * Используется один раз в общем диагностическом блоке пакета.
   */
  orphanOnly?: boolean;
  /** Сообщает родителю об изменении dirty-state (для atomic save в карточке). */
  onDirtyChange?: (dirty: boolean) => void;
}

type DraftMap = Record<string, string | null>;

function parseMultiselect(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map((x) => String(x)) : [];
  } catch { return []; }
}

function parseLocalDate(s: string | null | undefined): Date | undefined {
  if (!s) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return undefined;
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(dt.getTime()) ? undefined : dt;
}
function serializeLocalDate(d: Date | undefined): string {
  return d ? format(d, "yyyy-MM-dd") : "";
}
function parseDateTime(s: string | null | undefined): { date: Date | undefined; time: string } {
  if (!s) return { date: undefined, time: "" };
  const [datePart, timePart = ""] = s.split("T");
  const date = parseLocalDate(datePart);
  const tm = /^(\d{2}):(\d{2})/.exec(timePart);
  return { date, time: tm ? `${tm[1]}:${tm[2]}` : "" };
}
function serializeDateTime(date: Date | undefined, time: string): string {
  if (!date) return "";
  const t = /^\d{2}:\d{2}$/.test(time) ? time : "00:00";
  return `${serializeLocalDate(date)}T${t}`;
}

export interface PackageFieldDirtyPatch {
  field_catalog_id: string;
  value: string | null;
}

export interface PackageFieldsSubmitHandle {
  /** Внутренний save (legacy путь — пишет через upsert_session_field_values). */
  submit: () => Promise<boolean>;
  /** Sparse-патч только из явно изменённых пользователем полей. */
  getDirtyPatch: () => PackageFieldDirtyPatch[];
  /** Сбросить dirty-state, приняв текущий draft как baseline (после atomic save). */
  markSaved: () => void;
  isDirty: boolean;
  isSaving: boolean;
}

export const PackageFieldsClientForm = forwardRef<PackageFieldsSubmitHandle, Props>(function PackageFieldsClientForm({
  sessionId,
  packageTemplateId,
  packageTemplateItemId = null,
  sessionCreatedAt,
  disabled,
  onSaved,
  hideSaveButton = false,
  orphanOnly = false,
  onDirtyChange,
}, ref) {
  const {
    questions: allQuestions,
    orphanQuestions,
    valuesByField,
    getEffectiveValue,
    getItemQuestions,
    isLoading,
    save,
    isSaving,
    resetOverride,
    isResettingOverride,
  } = usePackageSessionFields(sessionId, packageTemplateId);

  // orphanOnly игнорирует packageTemplateItemId — orphan-поля сохраняются строго session-level.
  const effectiveItemId = orphanOnly ? null : packageTemplateItemId;

  const questions = useMemo<DedupedQuestion[]>(() => {
    if (orphanOnly) return orphanQuestions;
    if (packageTemplateItemId) return getItemQuestions(packageTemplateItemId);
    return allQuestions;
  }, [orphanOnly, orphanQuestions, packageTemplateItemId, allQuestions, getItemQuestions]);

  const [draft, setDraft] = useState<DraftMap>({});
  const [baseline, setBaseline] = useState<DraftMap>({});
  const [dirtyFields, setDirtyFields] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isLoading) return;
    const next: DraftMap = {};
    for (const q of questions) {
      const existing = readRawValue(
        q.field,
        effectiveItemId
          ? getEffectiveValue(q.field.id, effectiveItemId)
          : valuesByField.get(q.field.id),
      );
      if (existing != null && existing !== "") {
        next[q.field.id] = existing;
        continue;
      }
      if (
        q.field.data_type === "date" ||
        q.field.data_type === "datetime" ||
        q.field.data_type === "year"
      ) {
        const prefill = resolveSmartDatePrefill(q.field.options?.default_kind, {
          sessionCreatedAt,
        });
        if (prefill) {
          next[q.field.id] = q.field.data_type === "datetime"
            ? `${prefill}T00:00`
            : q.field.data_type === "year"
              ? prefill.slice(0, 4)
              : prefill;
          continue;
        }
      }
      next[q.field.id] = null;
    }
    setDraft(next);
    setBaseline(next);
    setDirtyFields(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questions, valuesByField, isLoading, sessionCreatedAt, effectiveItemId]);

  const handleChange = (fieldId: string, value: string | null) => {
    setDraft((d) => ({ ...d, [fieldId]: value }));
    setDirtyFields((s) => {
      const n = new Set(s);
      n.add(fieldId);
      return n;
    });
  };

  const dirty = dirtyFields.size > 0;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const handleSave = async (): Promise<boolean> => {
    const payload = questions.map((q) => ({
      field_catalog_id: q.field.id,
      value: (draft[q.field.id] ?? null) === "" ? null : draft[q.field.id] ?? null,
      package_template_item_id: effectiveItemId ?? null,
    }));
    try {
      await save(payload);
      setBaseline(draft);
      setDirtyFields(new Set());
      onSaved?.();
      return true;
    } catch {
      return false;
    }
  };

  const getDirtyPatch = (): PackageFieldDirtyPatch[] => {
    const out: PackageFieldDirtyPatch[] = [];
    for (const fid of dirtyFields) {
      const v = draft[fid];
      out.push({ field_catalog_id: fid, value: v === "" ? null : v ?? null });
    }
    return out;
  };

  const markSaved = () => {
    setBaseline(draft);
    setDirtyFields(new Set());
  };

  useImperativeHandle(ref, () => ({
    submit: handleSave,
    getDirtyPatch,
    markSaved,
    isDirty: dirty,
    isSaving,
  }), [dirty, isSaving, handleSave, draft, dirtyFields]);


  if (!sessionId || !packageTemplateId) return null;
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Загрузка полей…
      </div>
    );
  }
  if (questions.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
        {questions.map((q) => {
          const sessionValue = valuesByField.get(q.field.id);
          const currentDraft = draft[q.field.id] ?? null;
          // В orphan-режиме per-item override недоступен по контракту:
          // никаких бейджей «общее значение / переопределено» и кнопки сброса.
          const hasItemOverride = !orphanOnly && !!packageTemplateItemId
            && isPerItemOverride(q.field.id, packageTemplateItemId, getEffectiveValue);
          const inheritedFromSession = !orphanOnly && !!packageTemplateItemId
            && isRowFilled(sessionValue)
            && !hasItemOverride;
          const handleReset = hasItemOverride && packageTemplateItemId
            ? async () => {
                await resetOverride({
                  field_catalog_id: q.field.id,
                  package_template_item_id: packageTemplateItemId,
                });
                setDirtyFields(new Set());
              }
            : undefined;
          return (
            <FieldRow
              key={q.field.id}
              question={q}
              value={currentDraft}
              onChange={(v) => handleChange(q.field.id, v)}
              disabled={!!disabled}
              inheritedFromSession={inheritedFromSession}
              hasItemOverride={hasItemOverride}
              onResetOverride={handleReset}
              isResettingOverride={isResettingOverride}
            />
          );
        })}
      </div>
      {!hideSaveButton && (
        <div className="flex justify-end pt-1">
          <Button onClick={handleSave} disabled={!dirty || isSaving || disabled} size="sm">
            {isSaving
              ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Сохраняем…</>
              : <><Save className="h-4 w-4 mr-1" /> Сохранить поля</>}
          </Button>
        </div>
      )}
    </div>
  );
});

function isRowFilled(v: SessionFieldValueRow | undefined): boolean {
  if (!v) return false;
  return (
    v.value_text != null ||
    v.value_number != null ||
    v.value_date != null ||
    v.value_datetime != null ||
    v.value_time != null ||
    v.value_boolean != null ||
    (v.value_json != null && JSON.stringify(v.value_json) !== "[]")
  );
}

function isPerItemOverride(
  fieldId: string,
  itemId: string,
  getEffectiveValue: (f: string, i: string | null) => SessionFieldValueRow | undefined,
): boolean {
  const effective = getEffectiveValue(fieldId, itemId);
  return !!effective && effective.package_template_item_id === itemId;
}



interface FieldRowProps {
  question: DedupedQuestion;
  value: string | null;
  onChange: (v: string | null) => void;
  disabled: boolean;
  inheritedFromSession?: boolean;
  hasItemOverride?: boolean;
  onResetOverride?: () => Promise<void> | void;
  isResettingOverride?: boolean;
}

function isWideField(q: DedupedQuestion): boolean {
  const t = q.field.data_type;
  if (t === "text") return true;
  if (t === "multiselect") return true;
  if (t === "select") {
    const choices = q.field.options?.choices ?? [];
    const hasLong = choices.some((c) => (c.label?.length ?? 0) > 32);
    if (hasLong || choices.length > 8) return true;
  }
  return false;
}

function FieldRow({ question, value, onChange, disabled, inheritedFromSession, hasItemOverride, onResetOverride, isResettingOverride }: FieldRowProps) {
  const { field, effective } = question;
  const wide = isWideField(question);

  const helpText = effective.help?.trim() ?? "";
  const helpIcon = helpText ? (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            tabIndex={0}
            aria-label={`Подсказка: ${effective.label}`}
            className="inline-flex items-center justify-center h-3.5 w-3.5 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" align="start" className="max-w-xs text-xs leading-snug">
          {helpText}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : null;

  const labelEl = (
    <Label className="text-xs flex items-center gap-1.5 leading-tight">
      <span className="font-medium text-foreground">{effective.label}</span>
      {effective.required && <span className="text-destructive">*</span>}
      {helpIcon}
      {inheritedFromSession && (
        <Badge variant="outline" className="text-[9px] h-3.5 px-1 leading-none font-normal text-muted-foreground">
          общее значение
        </Badge>
      )}
      {hasItemOverride && (
        <Badge variant="secondary" className="text-[9px] h-3.5 px-1 leading-none font-normal">
          переопределено
        </Badge>
      )}
      {hasItemOverride && onResetOverride && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-4 px-1 text-[10px] gap-1 text-muted-foreground hover:text-foreground"
          disabled={disabled || isResettingOverride}
          onClick={() => { void onResetOverride(); }}
        >
          <RotateCcw className="h-2.5 w-2.5" />
          Сбросить к общему
        </Button>
      )}
    </Label>
  );

  const choices: PackageFieldChoice[] = field.options?.choices ?? [];
  let control: React.ReactNode;

  switch (field.data_type) {
    case "text":
      control = (
        <Textarea value={value ?? ""} onChange={(e) => onChange(e.target.value)} rows={2}
          disabled={disabled} className="text-sm" />
      );
      break;
    case "number":
      control = (
        <Input type="number" inputMode="decimal" value={value ?? ""}
          onChange={(e) => onChange(e.target.value)} disabled={disabled}
          className="h-9 text-sm w-full" />
      );
      break;
    case "year":
      control = (
        <Input type="text" inputMode="numeric" maxLength={4} placeholder="ГГГГ"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
          disabled={disabled} className="h-9 text-sm w-full tabular-nums" />
      );
      break;
    case "date":
      control = (
        <div className="w-full [&_button]:w-full [&_button]:h-9 [&_button]:justify-start [&_button]:text-sm [&_button]:font-normal">
          <DatePicker value={value ?? ""} onChange={(v) => onChange(v || null)} disabled={disabled}
            placeholder="Выбрать дату" fromYear={2000}
            toYear={new Date().getFullYear() + 2} />
        </div>
      );
      break;
    case "datetime": {
      const { date, time } = parseDateTime(value);
      control = (
        <div className="w-full min-w-0 [&_button]:h-9 [&>div]:w-full [&_button]:justify-start [&_button]:truncate [&_button]:text-sm [&_button]:font-normal">
          <DateTimePicker
            date={date} time={time}
            onDateChange={(newDate) => {
              if (!newDate) { onChange(null); return; }
              onChange(serializeDateTime(newDate, time || "00:00"));
            }}
            onTimeChange={(newTime) => {
              if (!date) return;
              onChange(serializeDateTime(date, newTime));
            }}
            disabled={disabled} />
        </div>
      );
      break;
    }
    case "time":
      control = (
        <Input type="text" inputMode="numeric" placeholder="ЧЧ:ММ" value={value ?? ""}
          onChange={(e) => {
            let v = e.target.value.replace(/[^\d:]/g, "").slice(0, 5);
            if (v.length === 2 && !v.includes(":")) v = `${v}:`;
            onChange(v);
          }}
          onBlur={(e) => {
            const m = /^(\d{1,2}):(\d{1,2})$/.exec(e.target.value);
            if (!m) return;
            const h = Math.min(23, Number(m[1]));
            const mm = Math.min(59, Number(m[2]));
            onChange(`${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`);
          }}
          disabled={disabled} className="h-9 text-sm w-full tabular-nums" />
      );
      break;
    case "checkbox":
      control = (
        <div className="flex items-center gap-2 h-9">
          <Checkbox checked={value === "true"}
            onCheckedChange={(v) => onChange(v ? "true" : "false")} disabled={disabled} />
          <span className="text-xs text-muted-foreground">
            {value === "true"
              ? field.options?.true_label ?? "Да"
              : field.options?.false_label ?? "Нет"}
          </span>
        </div>
      );
      break;
    case "select":
      control = (
        <Select value={value ?? ""} onValueChange={(v) => onChange(v || null)} disabled={disabled}>
          <SelectTrigger className="h-9 text-sm">
            <SelectValue placeholder="Выберите значение" />
          </SelectTrigger>
          <SelectContent>
            {choices.filter((c) => !c.is_archived).map((c) => (
              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
      break;
    case "multiselect": {
      const selected = new Set(parseMultiselect(value));
      const toggle = (val: string) => {
        const next = new Set(selected);
        if (next.has(val)) next.delete(val); else next.add(val);
        onChange(JSON.stringify(Array.from(next)));
      };
      control = (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {choices.filter((c) => !c.is_archived).map((c) => (
            <button key={c.value} type="button" disabled={disabled} onClick={() => toggle(c.value)}
              className={"px-2 py-1 rounded-md text-xs border transition " +
                (selected.has(c.value)
                  ? "bg-indigo-500/10 border-indigo-500 text-indigo-700 dark:text-indigo-300"
                  : "bg-background border-border text-muted-foreground hover:text-foreground")}>
              {c.label}
            </button>
          ))}
        </div>
      );
      break;
    }
    default:
      control = (
        <Input value={value ?? ""} onChange={(e) => onChange(e.target.value)} disabled={disabled}
          className="h-9 text-sm" />
      );
  }

  return (
    <div className={"space-y-1 min-w-0 " + (wide ? "md:col-span-2" : "")}>
      {labelEl}
      {control}
    </div>
  );
}
