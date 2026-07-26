/**
 * TableRepeatColumnRow — Stage E.2 UI компонент строки колонки
 * в редакторе повторяемых строк таблиц (PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1).
 *
 * UI показывает `cell_index` 1-based (Колонка 1, 2, ...),
 * но в storage пишет 0-based (см. tableRepeatSpec).
 *
 * Условный рендер подполей по `source_type`:
 *   role_person              → sub-field + (case|format по applicable kind)
 *   assignment_custom_field  → key только из schema выбранной роли
 *   package_field            → выбор из pf-* пакета
 *   static_text              → литерал
 *   row_number / empty       → без подполей
 *   assignment_metadata      → advanced fallback (super_admin)
 *
 * Stage E.2 ограничен UI/config: маркер `{{tableRepeat:TR-...}}` — служебный.
 * Реальное row-expansion — Stage E.4.
 */
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Trash2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

import type {
  TableRepeatColumn,
  TableRepeatColumnSourceType,
} from "@/lib/documents/tableRepeatSpec";
import { LN_SUB_FIELD_SPECS } from "@/lib/documents/lnSubFieldSpec";
import type { AssignmentCustomFieldDef } from "@/lib/documents/assignmentCustomFieldsSpec";

export interface PackageFieldChoice {
  /** pf-XXXXXX */
  public_id: string;
  label: string;
}

export interface TableRepeatColumnRowProps {
  column: TableRepeatColumn;
  index: number; // 0-based для отображения «Колонка {index+1}»
  isSuperAdmin: boolean;
  /** Custom fields текущей роли TR-конфига (может быть пусто). */
  roleCustomDefs: AssignmentCustomFieldDef[];
  /** Поля пакета (pf-XXXXXX). */
  packageFields: PackageFieldChoice[];
  /** Внешняя анкета хранит строки без назначений ролей. */
  isExternalSource?: boolean;
  /** Признак дубля cell_index с другой колонкой — для подсветки. */
  duplicateCellIndex?: boolean;
  onChange: (next: Partial<TableRepeatColumn>) => void;
  onRemove: () => void;
}

const SOURCE_TYPE_LABELS: Record<TableRepeatColumnSourceType, string> = {
  role_person: "Физлицо роли",
  assignment_custom_field: "Доп. поле роли",
  package_field: "Поле пакета",
  static_text: "Статичный текст",
  row_number: "Номер строки",
  empty: "Пусто",
  assignment_metadata: "Сырое metadata (advanced)",
  submission_field: "Поле строки внешней анкеты",
  submission_template: "Шаблон ячейки из полей строки",
};

const CASE_OPTIONS = [
  { value: "nominative", label: "Им. (кто/что)" },
  { value: "genitive", label: "Род. (кого/чего)" },
  { value: "dative", label: "Дат. (кому/чему)" },
  { value: "accusative", label: "Вин. (кого/что)" },
  { value: "instrumental", label: "Тв. (кем/чем)" },
  { value: "prepositional", label: "Предл. (о ком/чём)" },
];

/**
 * Whitelist sub-fields где имеет смысл выбор грамматического падежа.
 * Соответствует refinement #8 + lnSubFieldSpec.supports_case.
 */
function subFieldSupportsCase(key: string): boolean {
  const spec = LN_SUB_FIELD_SPECS.find((s) => s.key === key);
  return !!spec?.supports_case;
}

/** Sub-fields где имеет смысл format (имена + даты). */
function subFieldSupportsFormat(key: string): boolean {
  const spec = LN_SUB_FIELD_SPECS.find((s) => s.key === key);
  if (!spec) return false;
  return spec.kind === "name" || spec.kind === "date";
}

function formatOptionsForSubField(key: string): { value: string; label: string }[] {
  const spec = LN_SUB_FIELD_SPECS.find((s) => s.key === key);
  if (!spec) return [];
  if (spec.kind === "name") {
    return [
      { value: "full", label: "Полное (Иванов Иван Иванович)" },
      { value: "short", label: "Краткое (Иванов И. И.)" },
    ];
  }
  if (spec.kind === "date") {
    return [
      { value: "short", label: "Краткое (01.01.2026)" },
      { value: "full", label: "Полное (1 января 2026 г.)" },
      { value: "long", label: "Длинное (первое января 2026 года)" },
    ];
  }
  return [];
}

export function TableRepeatColumnRow({
  column,
  index,
  isSuperAdmin,
  roleCustomDefs,
  packageFields,
  isExternalSource = false,
  duplicateCellIndex,
  onChange,
  onRemove,
}: TableRepeatColumnRowProps) {
  // Список source_type без advanced для non-super_admin.
  const sourceTypes: TableRepeatColumnSourceType[] = isExternalSource ? [
    "submission_field",
    "submission_template",
    "package_field",
    "static_text",
    "row_number",
    "empty",
  ] : [
    "role_person",
    "assignment_custom_field",
    "package_field",
    "static_text",
    "row_number",
    "empty",
    ...(isSuperAdmin ? (["assignment_metadata"] as const) : []),
  ];

  const showSourceKey =
    column.source_type === "role_person" ||
    column.source_type === "assignment_custom_field" ||
    column.source_type === "package_field" ||
    column.source_type === "static_text" ||
    column.source_type === "assignment_metadata" ||
    column.source_type === "submission_field" ||
    column.source_type === "submission_template";

  const sourceKeyMissing =
    showSourceKey && (!column.source_key || column.source_key.trim() === "");

  // Подсказка-помощник для package_field и static_text (refinement #9/#10).
  const helperHint =
    column.source_type === "package_field"
      ? "Значение пакетного поля одинаковое для всех строк."
      : column.source_type === "submission_field"
        ? "Значение выбирается из каждой строки повторяемой группы внешней анкеты."
      : column.source_type === "submission_template"
        ? "Соберите содержимое одной ячейки из нескольких полей строки. Допустимы {{pf-XXXXXX}}, |format=words для суммы и |format=short для даты."
      : column.source_type === "static_text"
        ? "Статичный текст будет одинаковым во всех строках."
        : column.source_type === "row_number"
          ? "Подставит порядковый номер строки начиная с 1."
          : column.source_type === "assignment_metadata"
            ? "Advanced fallback: произвольный ключ metadata.custom без проверки schema."
            : null;

  return (
    <div
      className={cn(
        "rounded-md border p-2 space-y-1.5 bg-background/60",
        duplicateCellIndex
          ? "border-rose-500/50 bg-rose-500/[0.04]"
          : "border-border/60",
      )}
    >
      <div className="flex items-start gap-1.5">
        <div className="flex flex-col gap-1 w-20 shrink-0">
          <div className="text-[10px] text-muted-foreground font-medium">Колонка</div>
          <Input
            type="number"
            min={1}
            step={1}
            value={column.cell_index + 1}
            onChange={(e) => {
              const raw = Number(e.target.value);
              if (!Number.isFinite(raw)) return;
              const next = Math.max(1, Math.trunc(raw)) - 1;
              onChange({ cell_index: next });
            }}
            className="h-8 text-[11px]"
            aria-label={`Номер колонки (1-based UI, 0-based storage), сейчас ${column.cell_index}`}
          />
        </div>

        <div className="flex flex-col gap-1 flex-1 min-w-0">
          <div className="text-[10px] text-muted-foreground font-medium">Источник</div>
          <Select
            value={column.source_type}
            onValueChange={(v) =>
              onChange({
                source_type: v as TableRepeatColumnSourceType,
                // Сбрасываем зависимые поля при смене типа.
                source_key: undefined,
                case: undefined,
                format: undefined,
              })
            }
          >
            <SelectTrigger className="h-8 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sourceTypes.map((st) => (
                <SelectItem key={st} value={st} className="text-[11px]">
                  {SOURCE_TYPE_LABELS[st]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive mt-5"
          onClick={onRemove}
          aria-label="Удалить колонку"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Условные подполя по source_type */}
      {column.source_type === "role_person" && (
        <div className="grid grid-cols-3 gap-1.5">
          <div className="space-y-1 col-span-3 md:col-span-1">
            <div className="text-[10px] text-muted-foreground font-medium">
              Sub-field физлица
            </div>
            <Select
              value={column.source_key ?? ""}
              onValueChange={(v) =>
                onChange({
                  source_key: v,
                  case: subFieldSupportsCase(v) ? column.case : undefined,
                  format: subFieldSupportsFormat(v) ? column.format : undefined,
                })
              }
            >
              <SelectTrigger className="h-7 text-[11px]">
                <SelectValue placeholder="Выберите…" />
              </SelectTrigger>
              <SelectContent>
                {LN_SUB_FIELD_SPECS.map((s) => (
                  <SelectItem key={s.key} value={s.key} className="text-[11px]">
                    {s.label_ru}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {column.source_key && subFieldSupportsCase(column.source_key) && (
            <div className="space-y-1">
              <div className="text-[10px] text-muted-foreground font-medium">Падеж</div>
              <Select
                value={column.case ?? ""}
                onValueChange={(v) => onChange({ case: v || undefined })}
              >
                <SelectTrigger className="h-7 text-[11px]">
                  <SelectValue placeholder="По умолчанию" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="" className="text-[11px]">По умолчанию</SelectItem>
                  {CASE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-[11px]">
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {column.source_key && subFieldSupportsFormat(column.source_key) && (
            <div className="space-y-1">
              <div className="text-[10px] text-muted-foreground font-medium">Формат</div>
              <Select
                value={column.format ?? ""}
                onValueChange={(v) => onChange({ format: v || undefined })}
              >
                <SelectTrigger className="h-7 text-[11px]">
                  <SelectValue placeholder="По умолчанию" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="" className="text-[11px]">По умолчанию</SelectItem>
                  {formatOptionsForSubField(column.source_key).map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-[11px]">
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}

      {column.source_type === "assignment_custom_field" && (
        <div className="space-y-1">
          <div className="text-[10px] text-muted-foreground font-medium">
            Доп. поле роли (из schema)
          </div>
          {roleCustomDefs.length === 0 ? (
            <div className="text-[11px] text-amber-700 dark:text-amber-400 border border-amber-500/30 bg-amber-500/5 rounded-md p-1.5 flex items-start gap-1.5">
              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
              <span>
                У выбранной роли пока нет custom fields. Создайте их в карточке
                роли («Роли и поля пакета» → редактирование роли → раздел
                «Дополнительные поля назначения»), затем вернитесь сюда.
              </span>
            </div>
          ) : (
            <>
              <Select
                value={column.source_key ?? ""}
                onValueChange={(v) => onChange({ source_key: v })}
              >
                <SelectTrigger className="h-7 text-[11px]">
                  <SelectValue placeholder="Выберите доп. поле…" />
                </SelectTrigger>
                <SelectContent>
                  {roleCustomDefs.map((d) => (
                    <SelectItem key={d.key} value={d.key} className="text-[11px]">
                      {d.label}{" "}
                      <span className="text-muted-foreground font-mono">{d.key}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {column.source_key &&
                !roleCustomDefs.some((d) => d.key === column.source_key) && (
                  <div className="text-[11px] text-amber-700 dark:text-amber-400 flex items-start gap-1 mt-1">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                    <span>
                      Доп. поле <code className="font-mono">{column.source_key}</code>{" "}
                      больше не определено в schema роли (orphan-ref). Конфиг
                      сохранится, но рекомендуется выбрать другое поле или
                      пересоздать его в роли.
                    </span>
                  </div>
                )}
            </>
          )}
        </div>
      )}

      {(column.source_type === "package_field" || column.source_type === "submission_field") && (
        <div className="space-y-1">
          <div className="text-[10px] text-muted-foreground font-medium">
            {column.source_type === "submission_field" ? "Поле строки (pf-XXXXXX)" : "Поле пакета (pf-XXXXXX)"}
          </div>
          {packageFields.length === 0 ? (
            <div className="text-[11px] text-muted-foreground">
              В пакете пока нет custom-полей.
            </div>
          ) : (
            <Select
              value={column.source_key ?? ""}
              onValueChange={(v) => onChange({ source_key: v })}
            >
              <SelectTrigger className="h-7 text-[11px]">
                <SelectValue placeholder="Выберите поле пакета…" />
              </SelectTrigger>
              <SelectContent>
                {packageFields.map((pf) => (
                  <SelectItem key={pf.public_id} value={pf.public_id} className="text-[11px]">
                    {pf.label}{" "}
                    <span className="text-muted-foreground font-mono">{pf.public_id}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}

      {column.source_type === "submission_template" && (
        <div className="space-y-1">
          <div className="text-[10px] text-muted-foreground font-medium">Шаблон содержимого ячейки</div>
          <Textarea
            value={column.source_key ?? ""}
            onChange={(e) => onChange({ source_key: e.target.value })}
            placeholder={"{{pf-000017}}\nУНП: {{pf-000019}}"}
            className="min-h-20 text-[11px] font-mono"
          />
          <div className="text-[10px] text-muted-foreground">
            Поля пакета: {packageFields.map((field) => `{{${field.public_id}}}`).join(" · ")}
          </div>
        </div>
      )}

      {column.source_type === "static_text" && (
        <div className="space-y-1">
          <div className="text-[10px] text-muted-foreground font-medium">Текст</div>
          <Input
            value={column.source_key ?? ""}
            onChange={(e) => onChange({ source_key: e.target.value })}
            placeholder="Например: %"
            className="h-7 text-[11px]"
          />
        </div>
      )}

      {column.source_type === "assignment_metadata" && (
        <div className="space-y-1">
          <div className="text-[10px] text-muted-foreground font-medium">
            Сырой ключ metadata.custom
          </div>
          <Input
            value={column.source_key ?? ""}
            onChange={(e) => onChange({ source_key: e.target.value })}
            placeholder="произвольный_ключ"
            className="h-7 text-[11px] font-mono"
          />
        </div>
      )}

      {sourceKeyMissing && column.source_type !== "assignment_custom_field" && (
        <div className="text-[11px] text-rose-700 dark:text-rose-400 flex items-start gap-1">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
          <span>Для этого источника обязательно заполните значение.</span>
        </div>
      )}

      {helperHint && (
        <div className="text-[10px] text-muted-foreground leading-snug">
          {helperHint}
        </div>
      )}

      {duplicateCellIndex && (
        <div className="text-[11px] text-rose-700 dark:text-rose-400 flex items-start gap-1">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
          <span>
            Колонка {column.cell_index + 1} уже используется в другой колонке
            этого TR-конфига. Каждая колонка должна иметь уникальный номер.
          </span>
        </div>
      )}
    </div>
  );
}
