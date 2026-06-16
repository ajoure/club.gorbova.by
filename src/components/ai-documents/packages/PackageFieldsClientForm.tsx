/**
 * PackageFieldsClientForm — компактная клиентская анкета полей пакета.
 *
 * UI-контракт:
 *   • Канонические календари: DatePicker / DateTimePicker (никаких нативных
 *     <input type="date" | "datetime-local">).
 *   • Компактная 2-колоночная сетка; широкие типы (text/multiselect) спанятся.
 *   • Технический pf-XXXXXX не показывается клиенту.
 *
 * Бекенд-контракт (НЕ менялся):
 *   • Список и эффективные метаданные — usePackageSessionFields (дедуп).
 *   • Smart-date prefill — resolveSmartDatePrefill (TZ Europe/Minsk).
 *   • Сохранение — RPC upsert_session_field_values.
 *   • Форматы хранения: date=yyyy-MM-dd, datetime=YYYY-MM-DDTHH:mm,
 *     time=HH:mm, number=строка, multiselect=JSON-array.
 */
import { useEffect, useMemo, useState } from "react";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Save, ListChecks, Sparkles } from "lucide-react";
import { DatePicker } from "@/components/ui/date-picker";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { format } from "date-fns";
import {
  usePackageSessionFields,
  readRawValue,
  type DedupedQuestion,
} from "@/hooks/usePackageSessionFields";
import { resolveSmartDatePrefill } from "@/lib/packageFields/smartDate";
import type { PackageFieldChoice } from "@/hooks/usePackageFieldCatalog";

interface Props {
  sessionId: string | null;
  packageTemplateId: string | null;
  /** ISO дата создания сессии — для smart-date `session_created_date`. */
  sessionCreatedAt?: string | null;
  /** Внешняя блокировка (locked-сессия). */
  disabled?: boolean;
}

type DraftMap = Record<string, string | null>;

function parseMultiselect(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

// ── Date/Time helpers (без timezone-сдвига) ──────────────────────────────────

/** Парсит "yyyy-MM-dd" в локальную дату без UTC-сдвига. */
function parseLocalDate(s: string | null | undefined): Date | undefined {
  if (!s) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return undefined;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  if (!y || !mo || !d) return undefined;
  const dt = new Date(y, mo - 1, d);
  return Number.isNaN(dt.getTime()) ? undefined : dt;
}

/** Сериализует Date → "yyyy-MM-dd". */
function serializeLocalDate(d: Date | undefined): string {
  return d ? format(d, "yyyy-MM-dd") : "";
}

/** Парсит "YYYY-MM-DDTHH:mm" → { date, time }. */
function parseDateTime(s: string | null | undefined): { date: Date | undefined; time: string } {
  if (!s) return { date: undefined, time: "" };
  const [datePart, timePart = ""] = s.split("T");
  const date = parseLocalDate(datePart);
  const tm = /^(\d{2}):(\d{2})/.exec(timePart);
  const time = tm ? `${tm[1]}:${tm[2]}` : "";
  return { date, time };
}

/** Собирает "YYYY-MM-DDTHH:mm" (или "" если даты нет). */
function serializeDateTime(date: Date | undefined, time: string): string {
  if (!date) return "";
  const ds = serializeLocalDate(date);
  const t = /^\d{2}:\d{2}$/.test(time) ? time : "00:00";
  return `${ds}T${t}`;
}

export function PackageFieldsClientForm({
  sessionId, packageTemplateId, sessionCreatedAt, disabled,
}: Props) {
  const {
    questions, valuesByField, isLoading, save, isSaving, progress,
  } = usePackageSessionFields(sessionId, packageTemplateId);

  const [draft, setDraft] = useState<DraftMap>({});
  const [dirty, setDirty] = useState(false);

  // Инициализация draft из сохранённых значений + smart-date prefill для пустых.
  useEffect(() => {
    if (isLoading) return;
    const next: DraftMap = {};
    for (const q of questions) {
      const existing = readRawValue(q.field, valuesByField.get(q.field.id));
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
    setDirty(false);
  }, [questions, valuesByField, isLoading, sessionCreatedAt]);

  const filledPercent = useMemo(() => {
    if (progress.requiredTotal === 0) return 100;
    return Math.round((progress.requiredFilled / progress.requiredTotal) * 100);
  }, [progress]);

  if (!sessionId || !packageTemplateId) return null;
  if (isLoading) {
    return (
      <GlassCard className="p-3 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Загрузка полей пакета…
      </GlassCard>
    );
  }
  if (questions.length === 0) {
    return null;
  }

  const handleChange = (fieldId: string, value: string | null) => {
    setDraft((d) => ({ ...d, [fieldId]: value }));
    setDirty(true);
  };

  const handleSave = async () => {
    const payload = questions.map((q) => ({
      field_catalog_id: q.field.id,
      raw_value: (draft[q.field.id] ?? null) === "" ? null : draft[q.field.id] ?? null,
    }));
    try {
      await save(payload);
      setDirty(false);
    } catch {
      /* toast handled in hook */
    }
  };

  return (
    <GlassCard className="p-3 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold flex items-center gap-2">
            <ListChecks className="h-3.5 w-3.5 text-indigo-500" />
            Поля пакета
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
            Эти значения подставятся во все документы пакета. Каждое поле спрашивается один раз.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge
            variant={progress.allRequiredFilled ? "default" : "secondary"}
            className="h-5 text-[10px] px-1.5"
          >
            {progress.requiredFilled}/{progress.requiredTotal} обязательных
          </Badge>
          <Badge variant="outline" className="h-5 text-[10px] px-1.5">{filledPercent}%</Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
        {questions.map((q) => (
          <FieldRow
            key={q.field.id}
            question={q}
            value={draft[q.field.id] ?? null}
            onChange={(v) => handleChange(q.field.id, v)}
            disabled={!!disabled}
          />
        ))}
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-border/40">
        <div className="text-[11px] text-muted-foreground flex items-center gap-1">
          <Sparkles className="h-3 w-3" />
          Smart-date prefill учитывает таймзону Europe/Minsk.
        </div>
        <Button onClick={handleSave} disabled={!dirty || isSaving || disabled} size="sm">
          {isSaving ? (
            <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Сохраняем…</>
          ) : (
            <><Save className="h-4 w-4 mr-1" /> Сохранить значения</>
          )}
        </Button>
      </div>
    </GlassCard>
  );
}

interface FieldRowProps {
  question: DedupedQuestion;
  value: string | null;
  onChange: (v: string | null) => void;
  disabled: boolean;
}

/** Решаем, занимает ли поле обе колонки. */
function isWideField(q: DedupedQuestion): boolean {
  const t = q.field.data_type;
  if (t === "text") return true;
  if (t === "multiselect") return true;
  // длинный select (опции с длинными лейблами) — на всю ширину
  if (t === "select") {
    const choices = q.field.options?.choices ?? [];
    const hasLong = choices.some((c) => (c.label?.length ?? 0) > 32);
    if (hasLong || choices.length > 8) return true;
  }
  return false;
}

function FieldRow({ question, value, onChange, disabled }: FieldRowProps) {
  const { field, effective, occurrences } = question;
  const wide = isWideField(question);

  const labelEl = (
    <Label className="text-xs flex items-center gap-1.5 leading-tight">
      <span className="font-medium text-foreground">{effective.label}</span>
      {effective.required && <span className="text-destructive">*</span>}
      {occurrences > 1 && (
        <Badge variant="outline" className="text-[9px] h-3.5 px-1 leading-none font-normal">
          в {occurrences} док.
        </Badge>
      )}
    </Label>
  );

  const help = effective.help ? (
    <p className="text-[10px] text-muted-foreground leading-snug">{effective.help}</p>
  ) : null;

  const choices: PackageFieldChoice[] = field.options?.choices ?? [];

  let control: React.ReactNode;
  switch (field.data_type) {
    case "text":
      control = (
        <Textarea
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          disabled={disabled}
          className="text-sm"
        />
      );
      break;
    case "number":
      control = (
        <Input
          type="number"
          inputMode="decimal"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="h-9 text-sm max-w-[260px]"
        />
      );
      break;
    case "year":
      control = (
        <Input
          type="text"
          inputMode="numeric"
          maxLength={4}
          placeholder="ГГГГ"
          value={value ?? ""}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "").slice(0, 4);
            onChange(v);
          }}
          disabled={disabled}
          className="h-9 text-sm max-w-[120px] tabular-nums"
        />
      );
      break;
    case "date":
      control = (
        <div className="max-w-[260px]">
          <DatePicker
            value={value ?? ""}
            onChange={(v) => onChange(v || null)}
            disabled={disabled}
            placeholder="Выбрать дату"
            fromYear={1970}
            toYear={new Date().getFullYear() + 10}
          />
        </div>
      );
      break;
    case "datetime": {
      const { date, time } = parseDateTime(value);
      control = (
        <div className="max-w-[320px]">
          <DateTimePicker
            date={date}
            time={time}
            onDateChange={(newDate) => {
              if (!newDate) {
                onChange(null);
                return;
              }
              onChange(serializeDateTime(newDate, time || "00:00"));
            }}
            onTimeChange={(newTime) => {
              if (!date) return; // нет даты — время игнорируем
              onChange(serializeDateTime(date, newTime));
            }}
            disabled={disabled}
          />
        </div>
      );
      break;
    }
    case "time":
      control = (
        <Input
          type="text"
          inputMode="numeric"
          placeholder="ЧЧ:ММ"
          value={value ?? ""}
          onChange={(e) => {
            let v = e.target.value.replace(/[^\d:]/g, "").slice(0, 5);
            if (v.length === 2 && !v.includes(":")) v = `${v}:`;
            onChange(v);
          }}
          onBlur={(e) => {
            const v = e.target.value;
            const m = /^(\d{1,2}):(\d{1,2})$/.exec(v);
            if (!m) return;
            const h = Math.min(23, Number(m[1]));
            const mm = Math.min(59, Number(m[2]));
            onChange(`${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`);
          }}
          disabled={disabled}
          className="h-9 text-sm max-w-[120px] tabular-nums"
        />
      );
      break;
    case "checkbox":
      control = (
        <div className="flex items-center gap-2 h-9">
          <Checkbox
            checked={value === "true"}
            onCheckedChange={(v) => onChange(v ? "true" : "false")}
            disabled={disabled}
          />
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
        <Select
          value={value ?? ""}
          onValueChange={(v) => onChange(v || null)}
          disabled={disabled}
        >
          <SelectTrigger className="h-9 text-sm">
            <SelectValue placeholder="Выберите значение" />
          </SelectTrigger>
          <SelectContent>
            {choices
              .filter((c) => !c.is_archived)
              .map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      );
      break;
    case "multiselect": {
      const selected = new Set(parseMultiselect(value));
      const toggle = (val: string) => {
        const next = new Set(selected);
        if (next.has(val)) next.delete(val);
        else next.add(val);
        onChange(JSON.stringify(Array.from(next)));
      };
      control = (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {choices
            .filter((c) => !c.is_archived)
            .map((c) => (
              <button
                key={c.value}
                type="button"
                disabled={disabled}
                onClick={() => toggle(c.value)}
                className={
                  "px-2 py-1 rounded-md text-xs border transition " +
                  (selected.has(c.value)
                    ? "bg-indigo-500/10 border-indigo-500 text-indigo-700 dark:text-indigo-300"
                    : "bg-background border-border text-muted-foreground hover:text-foreground")
                }
              >
                {c.label}
              </button>
            ))}
        </div>
      );
      break;
    }
    default:
      control = (
        <Input
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="h-9 text-sm"
        />
      );
  }

  return (
    <div className={"space-y-1 " + (wide ? "md:col-span-2" : "")}>
      {labelEl}
      {control}
      {help}
    </div>
  );
}
