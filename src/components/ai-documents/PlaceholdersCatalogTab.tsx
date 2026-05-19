/**
 * PlaceholdersCatalogTab — Sprint 11 C5-E.
 *
 * Каталог FLD-плейсхолдеров для копирования в Microsoft Word.
 * Inline-настройки формата/падежа прямо в строке таблицы.
 *
 * SOT: fields_registry.public_id (FLD-XXXXXX).
 * Формат placeholder строго whitelisted:
 *   {{field:FLD-XXXXXX}}
 *   {{field:FLD-XXXXXX|format=words}}
 *   {{field:FLD-XXXXXX|format=text}}
 *   {{field:FLD-XXXXXX|case=<падеж>}}
 *   {{field:FLD-XXXXXX|format=words|case=<падеж>}}
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { Loader2, Copy, Search, ChevronDown, ChevronRight, AlertTriangle, Info, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  buildFieldPlaceholder,
  type FieldCase,
  type FieldFormat,
} from "./extensions/FieldChipNode";
import { classifyDataType } from "./FieldFormatPicker";
import { copyToClipboard } from "@/utils/clipboardUtils";

interface CatalogRow {
  id: string;
  token_key: string;            // legacy, только для поиска
  ui_label: string;
  description: string | null;
  category: string;
  source_type: string | null;
  field_id: string | null;
  resolver_key: string | null;
  data_type: string | null;
  is_required: boolean | null;
  display_order: number | null;
  example_value: string | null;
  field_public_id: string | null;
  field_label: string | null;
  field_data_type: string | null;
}

interface RowSettings {
  format: FieldFormat | null;
  caseModifier: FieldCase | null;
}

/**
 * Маппинг category → пользовательский ярлык группы (короткий — для бейджа в строке).
 */
const GROUP_LABELS: Record<string, string> = {
  contact: "Контакт",
  customer: "Заказчик (универс.)",
  "customer.individual": "Заказчик ФЛ",
  "customer.legal": "Заказчик ЮЛ",
  "customer.entrepreneur": "Заказчик ИП",
  "customer.signer": "Подписант (override)",
  executor: "Исполнитель (универс.)",
  "executor.individual": "Исполнитель ФЛ",
  "executor.legal": "Исполнитель ЮЛ",
  "executor.entrepreneur": "Исполнитель ИП",
  "executor.signer": "Подписант (override)",
  deal: "Сделка",
  product: "Продукт",
  tariff: "Тариф",
  offer: "Кнопка оплаты",
  document: "Документ",
  payment: "Оплата",
  system: "Системные",
  legal_details: "Custom-поля",
};

/**
 * Секции каталога (Execute v4 — PLACEHOLDERS-NORMALIZATION-v4).
 * Типизированные группы Заказчик/Исполнитель ФЛ/ЮЛ/ИП больше не пустые:
 * UI-фильтр FLD-only снят, runtime-токены рендерятся как {{token_key}}.
 * Порядок здесь = порядок отображения в UI.
 */
const SECTION_DEFINITIONS: Array<{ id: string; label: string; categories: string[] }> = [
  { id: "customer_ind", label: "1. Заказчик ФЛ", categories: ["customer.individual"] },
  { id: "customer_leg", label: "2. Заказчик ЮЛ", categories: ["customer.legal"] },
  { id: "customer_ent", label: "3. Заказчик ИП", categories: ["customer.entrepreneur"] },
  { id: "executor_ind", label: "4. Исполнитель ФЛ", categories: ["executor.individual"] },
  { id: "executor_leg", label: "5. Исполнитель ЮЛ", categories: ["executor.legal"] },
  { id: "executor_ent", label: "6. Исполнитель ИП", categories: ["executor.entrepreneur"] },
  { id: "dynamic", label: "7. Универсальные поля (по типу плательщика)", categories: ["customer", "executor"] },
  { id: "document", label: "8. Документ", categories: ["document"] },
  { id: "deal", label: "9. Сделка", categories: ["deal"] },
  { id: "payment", label: "10. Оплата", categories: ["payment"] },
  { id: "system", label: "11. Системные поля", categories: ["system"] },
  {
    id: "technical",
    label: "12. Технические / override",
    categories: ["customer.signer", "executor.signer", "contact", "product", "tariff", "offer", "legal_details"],
  },
];

const CATEGORY_TO_SECTION: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const s of SECTION_DEFINITIONS) for (const c of s.categories) m[c] = s.id;
  return m;
})();

const SECTION_LABEL: Record<string, string> = Object.fromEntries(
  SECTION_DEFINITIONS.map((s) => [s.id, s.label]),
);

const DATA_TYPE_LABEL: Record<string, string> = {
  text: "Текст", string: "Текст", number: "Число", currency: "Сумма",
  money: "Сумма", date: "Дата", datetime: "Дата/время", boolean: "Да/Нет",
  uuid: "UUID", email: "Email", phone: "Телефон", enum: "Список", json: "JSON",
};

const CASE_OPTIONS: { value: "none" | FieldCase; label: string }[] = [
  { value: "none", label: "— без падежа" },
  { value: "nominative", label: "И — кто? что?" },
  { value: "genitive", label: "Р — кого? чего?" },
  { value: "dative", label: "Д — кому? чему?" },
  { value: "accusative", label: "В — кого? что?" },
  { value: "instrumental", label: "Т — кем? чем?" },
  { value: "prepositional", label: "П — о ком? о чём?" },
];

function isDefault(s: RowSettings | undefined): boolean {
  return !s || (s.format === null && s.caseModifier === null);
}

export function PlaceholdersCatalogTab() {
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [runtimeCount, setRuntimeCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showTechnical, setShowTechnical] = useState(false);
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [onlyRequired, setOnlyRequired] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [rowSettings, setRowSettings] = useState<Map<string, RowSettings>>(new Map());

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("document_token_registry")
        .select(`
          id, token_key, ui_label, description, category, source_type,
          field_id, resolver_key, data_type, is_required, display_order, example_value,
          field:fields_registry!document_token_registry_field_id_fkey(
            public_id, label, data_type
          )
        `)
        .is("archived_at", null)
        .order("display_order", { ascending: true });
      if (!mounted) return;
      if (error) {
        toast.error("Не удалось загрузить каталог плейсхолдеров");
        setLoading(false);
        return;
      }
      const all = (data ?? []) as any[];
      const mapped: CatalogRow[] = [];
      let runtime = 0;
      for (const r of all) {
        const publicId = r.field?.public_id ?? null;
        // Execute v4: runtime-токены (без field_id, но с resolver_key) тоже
        // отображаются — они работают через _shared/document-render.ts по token_key.
        if (!publicId) runtime += 1;
        mapped.push({
          ...r,
          field_public_id: publicId,
          field_label: r.field?.label ?? null,
          field_data_type: r.field?.data_type ?? null,
        });
      }
      setRows(mapped);
      setRuntimeCount(runtime);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, []);

  // Группа = одна из 9 секций. «Все группы» = все секции по порядку.
  const groupOptions = SECTION_DEFINITIONS.map((s) => ({ id: s.id, label: s.label }));

  const typeOptions = useMemo(() => {
    const set = new Set(rows.map(r => r.data_type).filter(Boolean) as string[]);
    return Array.from(set);
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      const sectionId = CATEGORY_TO_SECTION[r.category ?? "system"] ?? "system";
      if (groupFilter !== "all" && sectionId !== groupFilter) return false;
      if (typeFilter !== "all" && r.data_type !== typeFilter) return false;
      if (onlyRequired && !r.is_required) return false;
      if (q && !(
        (r.field_public_id ?? "").toLowerCase().includes(q) ||
        r.token_key.toLowerCase().includes(q) ||
        (r.ui_label ?? "").toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q) ||
        (r.field_label ?? "").toLowerCase().includes(q) ||
        (r.example_value ?? "").toLowerCase().includes(q) ||
        (SECTION_LABEL[sectionId] ?? "").toLowerCase().includes(q) ||
        (r.category ?? "").toLowerCase().includes(q)
      )) return false;
      return true;
    });
  }, [rows, search, groupFilter, typeFilter, onlyRequired]);

  // Группировка отфильтрованных строк по 9 секциям с сохранением порядка.
  const grouped = useMemo(() => {
    const map = new Map<string, CatalogRow[]>();
    for (const s of SECTION_DEFINITIONS) map.set(s.id, []);
    for (const r of filtered) {
      const sid = CATEGORY_TO_SECTION[r.category ?? "system"] ?? "system";
      map.get(sid)!.push(r);
    }
    return SECTION_DEFINITIONS
      .map((s) => ({ id: s.id, label: s.label, rows: map.get(s.id) ?? [] }))
      .filter((s) => s.rows.length > 0);
  }, [filtered]);

  const updateRowSettings = (id: string, patch: Partial<RowSettings>) => {
    setRowSettings(prev => {
      const next = new Map(prev);
      const current = next.get(id) ?? { format: null, caseModifier: null };
      const merged: RowSettings = { ...current, ...patch };
      if (merged.format === null && merged.caseModifier === null) {
        next.delete(id);
      } else {
        next.set(id, merged);
      }
      return next;
    });
  };

  const resetRow = (id: string) => {
    setRowSettings(prev => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  };

  const copyPlaceholder = async (text: string) => {
    await copyToClipboard(text, "Плейсхолдер скопирован");
  };

  const toggleRow = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4">
        {/* Инструктивный баннер */}
        <div className="flex gap-3 rounded-lg border border-blue-200 bg-blue-50/60 dark:bg-blue-950/30 dark:border-blue-900 p-3">
          <Info className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-blue-900 dark:text-blue-100 leading-relaxed">
            Редактируйте шаблон в Microsoft Word. Найдите нужное поле, при необходимости
            настройте формат и падеж прямо в строке, скопируйте плейсхолдер и вставьте
            его в DOCX. После загрузки система проверит корректность всех плейсхолдеров.
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <div>
            <h2 className="text-lg font-semibold">Плейсхолдеры для Word</h2>
            <p className="text-sm text-muted-foreground">
              Формат:&nbsp;
              <code className="text-foreground">{`{{field:FLD-XXXXXX}}`}</code>.
              Всего: <span className="font-medium text-foreground">{rows.length}</span>,
              показано: <span className="font-medium text-foreground">{filtered.length}</span>.
              {runtimeCount > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 text-muted-foreground">
                  <Info className="h-3.5 w-3.5" /> runtime-токенов (без FLD-ID): {runtimeCount}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="tech-toggle" className="text-xs text-muted-foreground">
              Технические данные
            </Label>
            <Switch id="tech-toggle" checked={showTechnical} onCheckedChange={setShowTechnical} />
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-12">
          <div className="relative sm:col-span-5">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по названию, FLD-ID, категории, token_key…"
              className="pl-9"
            />
          </div>
          <div className="sm:col-span-3">
            <Select value={groupFilter} onValueChange={setGroupFilter}>
              <SelectTrigger><SelectValue placeholder="Группа" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все группы</SelectItem>
                {groupOptions.map(g => (
                  <SelectItem key={g.id} value={g.id}>{g.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-3">
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger><SelectValue placeholder="Тип" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все типы</SelectItem>
                {typeOptions.map(t => (
                  <SelectItem key={t} value={t}>{DATA_TYPE_LABEL[t] ?? t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-1 flex items-center justify-end gap-2">
            <Switch id="req-toggle" checked={onlyRequired} onCheckedChange={setOnlyRequired} />
            <Label htmlFor="req-toggle" className="text-xs text-muted-foreground whitespace-nowrap">обяз.</Label>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <div className="max-h-[70vh] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10 shadow-[0_1px_0_0_hsl(var(--border))]">
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead className="w-[120px]">Группа</TableHead>
                    <TableHead className="min-w-[180px]">Название</TableHead>
                    <TableHead className="w-[110px]">FLD-ID</TableHead>
                    <TableHead className="w-[90px]">Тип</TableHead>
                    <TableHead className="w-[260px]">Настройки</TableHead>
                    <TableHead className="min-w-[180px]">Пример</TableHead>
                    <TableHead className="min-w-[240px]">Плейсхолдер</TableHead>
                    <TableHead className="w-[90px] text-right">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-8">
                        Ничего не найдено
                      </TableCell>
                    </TableRow>
                  ) : (
                    grouped.flatMap((section) => [
                      <TableRow key={`section-${section.id}`} className="bg-muted/60 hover:bg-muted/60 sticky">
                        <TableCell colSpan={9} className="py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {section.label}
                          <span className="ml-2 text-[10px] font-normal lowercase text-muted-foreground/70">
                            ({section.rows.length})
                          </span>
                        </TableCell>
                      </TableRow>,
                      ...section.rows.map(t => {
                      const isOpen = expanded.has(t.id);
                      const settings = rowSettings.get(t.id) ?? { format: null, caseModifier: null };
                      const dirty = !isDefault(rowSettings.get(t.id));
                      const placeholder = buildFieldPlaceholder(
                        t.field_public_id!,
                        settings.format,
                        settings.caseModifier,
                      );
                      const kind = classifyDataType(t.field_data_type ?? t.data_type);

                      return (
                        <Fragment key={t.id}>
                          <TableRow className="hover:bg-muted/40 align-top">
                            <TableCell className="p-1">
                              <Button
                                size="icon" variant="ghost" className="h-6 w-6"
                                onClick={() => toggleRow(t.id)}
                              >
                                {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                              </Button>
                            </TableCell>
                            <TableCell className="py-2">
                              <Badge variant="outline" className="text-[10px] font-normal">
                                {GROUP_LABELS[t.category?.toLowerCase()] ?? GROUP_LABELS[t.category] ?? t.category}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-medium text-sm py-2">
                              {t.ui_label}
                              {t.field_label && t.field_label !== t.ui_label && (
                                <span className="block text-[10px] text-muted-foreground">{t.field_label}</span>
                              )}
                            </TableCell>
                            <TableCell className="py-2">
                              <Badge variant="secondary" className="font-mono text-[10px]">
                                {t.field_public_id}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground py-2">
                              {(() => {
                                const dt = t.field_data_type ?? t.data_type;
                                return dt ? (DATA_TYPE_LABEL[dt] ?? dt) : "—";
                              })()}
                            </TableCell>
                            <TableCell className="py-2">
                              <RowSettingsCell
                                kind={kind}
                                settings={settings}
                                onChange={(patch) => updateRowSettings(t.id, patch)}
                              />
                            </TableCell>
                            <TableCell className="py-2 text-xs text-foreground/80">
                              {t.example_value
                                ? <span className="italic">{t.example_value}</span>
                                : <span className="text-muted-foreground/60 italic">— нет примера —</span>}
                            </TableCell>
                            <TableCell className="py-2">
                              <code className="text-[11px] text-foreground/90 break-all font-mono">
                                {placeholder}
                              </code>
                            </TableCell>
                            <TableCell className="text-right py-2">
                              <div className="flex justify-end gap-0.5">
                                {dirty && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="icon" variant="ghost" className="h-7 w-7"
                                        onClick={() => resetRow(t.id)}
                                      >
                                        <RotateCcw className="h-3.5 w-3.5" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Сбросить настройки</TooltipContent>
                                  </Tooltip>
                                )}
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="icon" variant="ghost" className="h-7 w-7"
                                      onClick={() => copyPlaceholder(placeholder)}
                                    >
                                      <Copy className="h-3.5 w-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Копировать плейсхолдер</TooltipContent>
                                </Tooltip>
                              </div>
                            </TableCell>
                          </TableRow>
                          {(isOpen || showTechnical) && (
                            <TableRow key={`${t.id}-detail`} className={cn("bg-muted/20", !isOpen && !showTechnical && "hidden")}>
                              <TableCell></TableCell>
                              <TableCell colSpan={7} className="py-2">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-[11px] font-mono text-muted-foreground">
                                  {t.description && (
                                    <div className="md:col-span-2 font-sans text-xs text-foreground/80 mb-1">
                                      {t.description}
                                    </div>
                                  )}
                                  <div>field_public_id: <span className="text-foreground/80">{t.field_public_id ?? "—"}</span></div>
                                  <div>field_id: <span className="text-foreground/80">{t.field_id ?? "—"}</span></div>
                                  <div>category: <span className="text-foreground/80">{t.category ?? "—"}</span></div>
                                  <div>source_type: <span className="text-foreground/80">{t.source_type ?? "—"}</span></div>
                                  <div className="md:col-span-2 text-muted-foreground/70">
                                    token_key (legacy, только для поиска):{" "}
                                    <span className="text-foreground/60">{t.token_key}</span>
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                      }),
                    ])
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

/** Inline настройки формата/падежа для одной строки. */
function RowSettingsCell({
  kind,
  settings,
  onChange,
}: {
  kind: ReturnType<typeof classifyDataType>;
  settings: RowSettings;
  onChange: (patch: Partial<RowSettings>) => void;
}) {
  // Для прочих типов модификаторы недоступны.
  if (kind === "other") {
    return <span className="text-[10px] text-muted-foreground italic">Без модификаторов</span>;
  }

  const showFormatToggle = kind === "numeric" || kind === "boolean";
  // Падеж: text — всегда; numeric — только при words; boolean — никогда.
  const caseEnabled =
    kind === "text" || (kind === "numeric" && settings.format === "words");

  // Значение для format toggle
  const formatValue =
    kind === "numeric"
      ? settings.format === "words" ? "words" : "asis"
      : kind === "boolean"
        ? settings.format === "text" ? "text" : "asis"
        : "asis";

  const handleFormatChange = (val: string) => {
    if (!val) return; // ToggleGroup может вернуть "" при дабл-клике
    if (kind === "numeric") {
      const fmt: FieldFormat | null = val === "words" ? "words" : null;
      // Если уходим с words — сбрасываем падеж
      onChange({
        format: fmt,
        ...(fmt === null ? { caseModifier: null } : {}),
      });
    } else if (kind === "boolean") {
      const fmt: FieldFormat | null = val === "text" ? "text" : null;
      onChange({ format: fmt });
    }
  };

  const handleCaseChange = (val: string) => {
    const next: FieldCase | null = val === "none" ? null : (val as FieldCase);
    onChange({ caseModifier: next });
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {showFormatToggle && (
        <ToggleGroup
          type="single"
          size="sm"
          value={formatValue}
          onValueChange={handleFormatChange}
          className="h-7"
        >
          <ToggleGroupItem value="asis" className="h-7 px-2 text-[10px]">
            Обычный
          </ToggleGroupItem>
          {kind === "numeric" && (
            <ToggleGroupItem value="words" className="h-7 px-2 text-[10px]">
              Прописью
            </ToggleGroupItem>
          )}
          {kind === "boolean" && (
            <ToggleGroupItem value="text" className="h-7 px-2 text-[10px]">
              Текстом
            </ToggleGroupItem>
          )}
        </ToggleGroup>
      )}

      {(kind === "text" || kind === "numeric") && (
        caseEnabled ? (
          <Select
            value={settings.caseModifier ?? "none"}
            onValueChange={handleCaseChange}
          >
            <SelectTrigger className="h-7 w-[140px] text-[10px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CASE_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-[10px] text-muted-foreground italic cursor-help">
                Падеж недоступен
              </span>
            </TooltipTrigger>
            <TooltipContent>
              Падеж доступен только для значения «прописью»
            </TooltipContent>
          </Tooltip>
        )
      )}

      {kind === "boolean" && (
        <span className="text-[10px] text-muted-foreground italic">Падеж недоступен</span>
      )}
    </div>
  );
}
