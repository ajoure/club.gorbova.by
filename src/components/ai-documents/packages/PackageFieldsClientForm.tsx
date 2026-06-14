/**
 * PackageFieldsClientForm — PATCH-PACKAGE-CUSTOM-FIELDS-V1 (B2).
 *
 * Клиентская часть «анкеты полей пакета»: рендерит дедуплицированный список
 * вопросов pf-XXXXXX по сессии пакета и сохраняет значения через RPC
 * `upsert_session_field_values`.
 *
 * Контракт SOT:
 *   • Список и эффективные метаданные — `usePackageSessionFields` (дедуп).
 *   • Smart-date prefill — `resolveSmartDatePrefill` (TZ Europe/Minsk).
 *   • Серверная типовая валидация выполняется в RPC; на клиенте — мягкая
 *     проверка и нормализация перед отправкой.
 *
 * STOP: не дёргает таблицы напрямую, не дублирует логику каталога, не пишет
 * audit (это делает RPC + триггеры).
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
      // Smart-date prefill только для date-подобных типов.
      if (
        q.field.data_type === "date" ||
        q.field.data_type === "datetime" ||
        q.field.data_type === "year"
      ) {
        const prefill = resolveSmartDatePrefill(q.field.options?.default_kind, {
          sessionCreatedAt,
        });
        if (prefill) {
          // datetime: добавляем 00:00 для input[type=datetime-local].
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
      <GlassCard className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Загрузка полей пакета…
      </GlassCard>
    );
  }
  if (questions.length === 0) {
    return null; // нет ask_client назначений — раздел просто не показываем
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
    <GlassCard className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-indigo-500" />
            Поля пакета
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Эти значения подставятся во все документы пакета, где используется
            токен <code className="px-1 py-0.5 rounded bg-muted text-[10px]">{"{{pf-XXXXXX}}"}</code>.
            Каждое поле спрашивается один раз.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Badge variant={progress.allRequiredFilled ? "default" : "secondary"}>
            {progress.requiredFilled}/{progress.requiredTotal} обязательных
          </Badge>
          <Badge variant="outline">{filledPercent}%</Badge>
        </div>
      </div>

      <div className="space-y-3">
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
        <div className="text-xs text-muted-foreground flex items-center gap-1">
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

function FieldRow({ question, value, onChange, disabled }: FieldRowProps) {
  const { field, effective, occurrences } = question;
  const labelEl = (
    <Label className="text-xs flex items-center gap-2">
      <span className="font-medium">{effective.label}</span>
      {effective.required && <span className="text-red-500">*</span>}
      <span className="text-[10px] text-muted-foreground font-mono">
        {field.public_id}
      </span>
      {occurrences > 1 && (
        <Badge variant="outline" className="text-[10px] h-4 px-1">
          в {occurrences} док.
        </Badge>
      )}
    </Label>
  );

  const help = effective.help ? (
    <p className="text-[11px] text-muted-foreground mt-1">{effective.help}</p>
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
        />
      );
      break;
    case "year":
      control = (
        <Input
          type="number"
          min={1900}
          max={2999}
          step={1}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      );
      break;
    case "date":
      control = (
        <Input
          type="date"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      );
      break;
    case "datetime":
      control = (
        <Input
          type="datetime-local"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      );
      break;
    case "time":
      control = (
        <Input
          type="time"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      );
      break;
    case "checkbox":
      control = (
        <div className="flex items-center gap-2 pt-1">
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
          <SelectTrigger>
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
        <div className="flex flex-wrap gap-2 pt-1">
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
        />
      );
  }

  return (
    <div className="space-y-1">
      {labelEl}
      {control}
      {help}
    </div>
  );
}
