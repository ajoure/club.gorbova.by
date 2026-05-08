/**
 * FieldFormatPicker — Sprint 11 C4-B.
 *
 * Мини-мастер выбора формата и падежа после выбора поля.
 * Логика:
 *  - text/string         → формат «как есть», падеж (опционально).
 *  - number/money/date   → формат: цифрами / прописью; для прописью — падеж.
 *  - boolean             → формат: как есть / текстом; падеж не нужен.
 *  - прочие (json/email/phone/enum) → только «как есть».
 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import {
  FIELD_CASE_LABEL,
  FIELD_CASE_SHORT,
  type FieldCase,
  type FieldFormat,
} from "./extensions/FieldChipNode";

const TEXT_TYPES = new Set(["string", "text", "email", "phone"]);
const NUMERIC_TYPES = new Set(["number", "money", "date", "datetime"]);
const BOOLEAN_TYPES = new Set(["boolean"]);

export type SupportsKind = "text" | "numeric" | "boolean" | "other";

export function classifyDataType(dt: string | undefined | null): SupportsKind {
  const t = (dt ?? "").toLowerCase();
  if (TEXT_TYPES.has(t)) return "text";
  if (NUMERIC_TYPES.has(t)) return "numeric";
  if (BOOLEAN_TYPES.has(t)) return "boolean";
  return "other";
}

interface Props {
  dataType: string | undefined | null;
  fieldPublicId: string;
  fieldLabel: string;
  onConfirm: (sel: { format: FieldFormat | null; caseModifier: FieldCase | null }) => void;
  onCancel?: () => void;
}

const CASE_KEYS: FieldCase[] = [
  "nominative", "genitive", "dative", "accusative", "instrumental", "prepositional",
];

export function FieldFormatPicker({
  dataType, fieldPublicId, fieldLabel, onConfirm, onCancel,
}: Props) {
  const kind = useMemo(() => classifyDataType(dataType), [dataType]);
  // formatChoice: literal — для UI, mapping ниже
  const [formatChoice, setFormatChoice] = useState<string>(() => {
    if (kind === "numeric") return "asis"; // цифрами
    if (kind === "boolean") return "asis"; // как есть
    return "asis";
  });
  const [caseChoice, setCaseChoice] = useState<string>("none");

  const showCase = useMemo(() => {
    if (kind === "text") return true;
    if (kind === "numeric") return formatChoice === "words";
    return false;
  }, [kind, formatChoice]);

  const showFormat = kind === "numeric" || kind === "boolean";

  const handleConfirm = () => {
    let format: FieldFormat | null = null;
    if (kind === "numeric" && formatChoice === "words") format = "words";
    if (kind === "boolean" && formatChoice === "text") format = "text";

    let caseModifier: FieldCase | null = null;
    if (showCase && caseChoice !== "none") caseModifier = caseChoice as FieldCase;

    onConfirm({ format, caseModifier });
  };

  return (
    <div className="p-3 space-y-3 w-[360px]">
      <div>
        <div className="text-xs font-medium truncate">{fieldLabel}</div>
        <div className="font-mono text-[10px] text-muted-foreground">
          {fieldPublicId} · тип: {dataType || "—"}
        </div>
      </div>

      {showFormat && (
        <div className="space-y-1.5">
          <Label className="text-[11px] text-muted-foreground">Формат значения</Label>
          <RadioGroup value={formatChoice} onValueChange={setFormatChoice} className="gap-1.5">
            {kind === "numeric" ? (
              <>
                <FmtRow value="asis" label="Цифрами / как есть" hint="например: 250 или 08.01.2025" />
                <FmtRow value="words" label="Прописью" hint="например: «двести пятьдесят»" />
              </>
            ) : (
              <>
                <FmtRow value="asis" label="Как есть" hint="true / false" />
                <FmtRow value="text" label="Текстом" hint="да / нет" />
              </>
            )}
          </RadioGroup>
        </div>
      )}

      {showCase && (
        <>
          {showFormat && <Separator />}
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">
              Падеж {kind === "numeric" ? "(для значения прописью)" : ""}
            </Label>
            <RadioGroup value={caseChoice} onValueChange={setCaseChoice} className="gap-1">
              <CaseRow value="none" label="Без падежа" short="—" />
              {CASE_KEYS.map((c) => (
                <CaseRow key={c} value={c} label={FIELD_CASE_LABEL[c]} short={FIELD_CASE_SHORT[c]} />
              ))}
            </RadioGroup>
          </div>
        </>
      )}

      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={onCancel}>
            Отмена
          </Button>
        )}
        <Button type="button" size="sm" className="h-7 text-xs" onClick={handleConfirm}>
          Вставить
        </Button>
      </div>
    </div>
  );
}

function FmtRow({ value, label, hint }: { value: string; label: string; hint: string }) {
  return (
    <label className="flex items-start gap-2 cursor-pointer rounded px-1.5 py-1 hover:bg-muted/40">
      <RadioGroupItem value={value} className="mt-0.5" />
      <div className="text-xs leading-tight">
        <div>{label}</div>
        <div className="text-[10px] text-muted-foreground">{hint}</div>
      </div>
    </label>
  );
}

function CaseRow({ value, label, short }: { value: string; label: string; short: string }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer rounded px-1.5 py-1 hover:bg-muted/40">
      <RadioGroupItem value={value} />
      <span className="font-mono text-[10px] w-4 text-center text-amber-700">{short}</span>
      <span className="text-xs">{label}</span>
    </label>
  );
}
