/**
 * TableRepeatsEditor — Stage E.2 UI/config редактор повторяемых строк таблиц
 * (PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1).
 *
 * Scope (UI/config only):
 *  • CRUD конфигов `metadata.table_repeats[]` для текущего template_item.
 *  • Выбор роли-источника, маппинг колонок (через `TableRepeatColumnRow`).
 *  • Copy marker `{{tableRepeat:TR-XXXXXX}}` — служебный.
 *  • Preview числа строк = число активных назначений роли в текущей сессии
 *    (без обращения к генератору).
 *
 * НЕ в scope (это E.3 / E.4):
 *  • Валидация маркера `{{tableRepeat:TR-XXXXXX}}` в genеральном валидаторе.
 *  • Резолвер табличных значений в `package-tokens-dry-run`.
 *  • Реальное DOCX row expansion в `canonical-document-generate-strict`.
 *
 * Save:
 *  • merge-only через `useTemplateItemTableRepeats` (свежий read + merge).
 *  • Никаких прямых INSERT/DELETE, никаких новых RPC, никаких миграций.
 */
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertCircle, AlertTriangle, ClipboardCopy, FlaskConical, Loader2, Plus, Save, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

import { useTemplateItemTableRepeats } from "@/hooks/useTemplateItemTableRepeats";
import { usePackageFieldCatalog } from "@/hooks/usePackageFieldCatalog";
import {
  nextTableRepeatId,
  validateTableRepeatConfig,
  type TableRepeatColumn,
  type TableRepeatConfig,
  type TableRepeatAggregate,
  type TableRepeatIssue,
} from "@/lib/documents/tableRepeatSpec";
import { readAssignmentCustomFieldDefs } from "@/lib/documents/assignmentCustomFieldsSpec";
import type { PackageDocumentCardRole } from "./PackageDocumentCard";
import {
  TableRepeatColumnRow,
  type PackageFieldChoice,
} from "./TableRepeatColumnRow";

export interface TableRepeatsEditorProps {
  itemId: string;
  packageTemplateId: string;
  /** Stage E.3: session UUID нужен для dry-run preview через `package-tokens-dry-run`. */
  packageSessionId: string;
  activeRoles: PackageDocumentCardRole[];
  /** Map role_catalog_id → число активных назначений в текущей сессии. */
  assignmentsCountByRole: Map<string, number>;
  /** false — текущий пользователь не super_admin (скрыть assignment_metadata source + dry-run). */
  isSuperAdmin: boolean;
  /** Карточка свёрнута, если у item ещё нет TR-конфигов и пользователь не открыл редактор. */
  defaultExpanded?: boolean;
}

function configsEqual(a: TableRepeatConfig[], b: TableRepeatConfig[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function blankColumn(cellIndex: number): TableRepeatColumn {
  return { cell_index: cellIndex, source_type: "role_person" };
}

function nextAggregateId(existing: Iterable<string>): string {
  let max = 0;
  for (const id of existing) {
    const match = /^TT-(\d{6,})$/.exec(id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `TT-${String(max + 1).padStart(6, "0")}`;
}

function ensureRoleCustomDefs(
  role: PackageDocumentCardRole | undefined,
) {
  if (!role) return [];
  return readAssignmentCustomFieldDefs(role.metadata);
}

export function TableRepeatsEditor({
  itemId,
  packageTemplateId,
  packageSessionId,
  activeRoles,
  assignmentsCountByRole,
  isSuperAdmin,
  defaultExpanded = false,
}: TableRepeatsEditorProps) {
  const repeatsState = useTemplateItemTableRepeats(itemId, packageTemplateId);
  const fieldCatalog = usePackageFieldCatalog(packageTemplateId);

  const packageFields = useMemo<PackageFieldChoice[]>(() => {
    const rows = (fieldCatalog.fields ?? []) as Array<{ public_id: string; label: string }>;
    return rows.map((r) => ({ public_id: r.public_id, label: r.label }));
  }, [fieldCatalog.fields]);

  const [draft, setDraft] = useState<TableRepeatConfig[] | null>(null);
  const [expanded, setExpanded] = useState<boolean>(defaultExpanded);

  // Stage E.3 — dry-run dialog state.
  const [dryRunTrId, setDryRunTrId] = useState<string | null>(null);
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<unknown>(null);
  const [dryRunError, setDryRunError] = useState<string | null>(null);

  const runDryRun = async (trId: string) => {
    setDryRunTrId(trId);
    setDryRunLoading(true);
    setDryRunError(null);
    setDryRunResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("package-tokens-dry-run", {
        body: {
          package_session_id: packageSessionId,
          package_template_item_id: itemId,
          alias_tokens: [`{{tableRepeat:${trId}}}`],
        },
      });
      if (error) {
        setDryRunError(error.message ?? "Не удалось выполнить dry-run");
      } else {
        setDryRunResult(data);
      }
    } catch (e) {
      setDryRunError(e instanceof Error ? e.message : String(e));
    } finally {
      setDryRunLoading(false);
    }
  };



  // Гидратируем draft из БД ровно один раз / при изменении set'а из БД.
  useEffect(() => {
    if (repeatsState.isLoading) return;
    if (draft === null) {
      setDraft(repeatsState.repeats);
    }
  }, [repeatsState.isLoading, repeatsState.repeats, draft]);

  // Если БД-набор сменился извне (refetch после save) — синхронизируем.
  useEffect(() => {
    if (repeatsState.isLoading || draft === null) return;
    if (configsEqual(draft, repeatsState.repeats)) return;
    // Если у нас нет несохранённых отличий от прошлой базы — подтягиваем новое.
    // Простая эвристика: dirty только если draft != repeats И мы редактировали.
    // Здесь не трогаем draft, если он dirty (пользователь не должен потерять правки).
  }, [repeatsState.repeats, draft, repeatsState.isLoading]);

  const dirty = useMemo(
    () => draft !== null && !configsEqual(draft, repeatsState.repeats),
    [draft, repeatsState.repeats],
  );

  // Авто-раскрыть если уже есть конфиги.
  useEffect(() => {
    if (!expanded && (repeatsState.repeats.length > 0)) {
      setExpanded(true);
    }
    // Только при первом приходе данных.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repeatsState.repeats.length]);

  const roleById = useMemo(() => {
    const m = new Map<string, PackageDocumentCardRole>();
    for (const r of activeRoles) m.set(r.id, r);
    return m;
  }, [activeRoles]);

  // Валидируем каждый конфиг для UI-индикаторов.
  const issuesByCfg = useMemo(() => {
    const m = new Map<string, TableRepeatIssue[]>();
    for (const cfg of draft ?? []) {
      const role = roleById.get(cfg.role_catalog_id ?? "");
      const knownKeys = new Set(ensureRoleCustomDefs(role).map((d) => d.key));
      m.set(cfg.id, validateTableRepeatConfig(cfg, { knownCustomKeysForRole: knownKeys }));
    }
    return m;
  }, [draft, roleById]);

  // Глобальные блокеры save: duplicate TR id + per-config errors.
  const trIds = (draft ?? []).map((c) => c.id);
  const duplicateTrIds = new Set(
    trIds.filter((id, idx) => trIds.indexOf(id) !== idx),
  );

  const hasBlockingErrors = useMemo(() => {
    if (duplicateTrIds.size > 0) return true;
    for (const issues of issuesByCfg.values()) {
      if (issues.some((i) => i.severity === "error")) return true;
    }
    return false;
  }, [duplicateTrIds, issuesByCfg]);

  // ---------- mutations ----------
  const addRepeat = () => {
    setDraft((prev) => {
      const cur = prev ?? [];
      const id = nextTableRepeatId(cur.map((c) => c.id));
      const next: TableRepeatConfig = {
        id,
        source_kind: "role_assignments",
        role_catalog_id: "",
        label: "",
        columns: [],
      };
      return [...cur, next];
    });
    setExpanded(true);
  };
  const removeRepeat = (id: string) => {
    setDraft((prev) => (prev ?? []).filter((c) => c.id !== id));
  };
  const updateRepeat = (id: string, patch: Partial<TableRepeatConfig>) => {
    setDraft((prev) =>
      (prev ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c)),
    );
  };
  const addColumn = (cfgId: string) => {
    setDraft((prev) =>
      (prev ?? []).map((c) => {
        if (c.id !== cfgId) return c;
        const usedIdxs = new Set(c.columns.map((col) => col.cell_index));
        let next = 0;
        while (usedIdxs.has(next)) next += 1;
        return { ...c, columns: [...c.columns, blankColumn(next)] };
      }),
    );
  };
  const updateColumn = (cfgId: string, colIdx: number, patch: Partial<TableRepeatColumn>) => {
    setDraft((prev) =>
      (prev ?? []).map((c) => {
        if (c.id !== cfgId) return c;
        const nextCols = c.columns.map((col, i) => (i === colIdx ? { ...col, ...patch } : col));
        return { ...c, columns: nextCols };
      }),
    );
  };
  const removeColumn = (cfgId: string, colIdx: number) => {
    setDraft((prev) =>
      (prev ?? []).map((c) => {
        if (c.id !== cfgId) return c;
        return { ...c, columns: c.columns.filter((_, i) => i !== colIdx) };
      }),
    );
  };
  const addAggregate = (cfgId: string) => {
    setDraft((prev) => (prev ?? []).map((cfg) => {
      if (cfg.id !== cfgId) return cfg;
      const id = nextAggregateId((cfg.aggregates ?? []).map((aggregate) => aggregate.id));
      const aggregate: TableRepeatAggregate = { id, label: "Итог по строкам", source_field_public_id: "" };
      return { ...cfg, aggregates: [...(cfg.aggregates ?? []), aggregate] };
    }));
  };
  const updateAggregate = (cfgId: string, aggregateIndex: number, patch: Partial<TableRepeatAggregate>) => {
    setDraft((prev) => (prev ?? []).map((cfg) => {
      if (cfg.id !== cfgId) return cfg;
      return { ...cfg, aggregates: (cfg.aggregates ?? []).map((aggregate, index) => index === aggregateIndex ? { ...aggregate, ...patch } : aggregate) };
    }));
  };
  const removeAggregate = (cfgId: string, aggregateIndex: number) => {
    setDraft((prev) => (prev ?? []).map((cfg) => cfg.id === cfgId ? { ...cfg, aggregates: (cfg.aggregates ?? []).filter((_, index) => index !== aggregateIndex) } : cfg));
  };

  const copyMarker = async (id: string) => {
    const marker = `{{tableRepeat:${id}}}`;
    try {
      await navigator.clipboard.writeText(marker);
      toast.success(`Маркер ${marker} скопирован`);
    } catch {
      toast.error("Не удалось скопировать в буфер обмена");
    }
  };

  const onSave = async () => {
    if (!draft) return;
    if (hasBlockingErrors) {
      toast.error("Сохранение заблокировано: исправьте ошибки конфигурации.");
      return;
    }
    try {
      await repeatsState.save(draft);
    } catch {
      // toast уже показан хуком
    }
  };

  const onRevert = () => {
    setDraft(repeatsState.repeats);
  };

  // ---------- render ----------
  const headerCount = (draft ?? repeatsState.repeats).length;

  return (
    <section className="rounded-lg border border-border/50 bg-card/30 p-3 space-y-3">
      <header className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-semibold text-foreground">
            Повторяемые строки таблиц
          </div>
          <div className="text-[10px] text-muted-foreground leading-snug">
            Конфиг для DOCX-таблиц, где одна строка-шаблон размножается по числу
            назначений выбранной роли. UI/config-слой — реальное размножение
            строк подключится в Stage E.4.
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {headerCount} конфиг.
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-[11px]"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Свернуть" : "Развернуть"}
          </Button>
        </div>
      </header>

      {expanded && (
        <>
          {repeatsState.isLoading || draft === null ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Загружаем конфиги…
            </div>
          ) : (
            <>
              {duplicateTrIds.size > 0 && (
                <div className="text-[11px] text-rose-700 dark:text-rose-400 border border-rose-500/30 bg-rose-500/5 rounded-md p-2 flex items-start gap-1.5">
                  <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                  <span>Найдены дубликаты TR-id — сохранение заблокировано.</span>
                </div>
              )}

              {draft.length === 0 ? (
                <div className="text-[11px] text-muted-foreground border border-dashed border-border/60 rounded-md p-3 text-center">
                  Конфигов пока нет. Добавьте первый, чтобы начать.
                </div>
              ) : (
                <div className="space-y-3">
                  {draft.map((cfg) => {
                    const role = roleById.get(cfg.role_catalog_id ?? "");
                    const customDefs = ensureRoleCustomDefs(role);
                    const knownCustomKeys = new Set(customDefs.map((d) => d.key));
                    const issues = issuesByCfg.get(cfg.id) ?? [];
                    const cellCount = new Map<number, number>();
                    for (const col of cfg.columns) {
                      cellCount.set(col.cell_index, (cellCount.get(col.cell_index) ?? 0) + 1);
                    }
                    const isExternal = cfg.source_kind === "external_submission";
                    const previewN = role
                      ? assignmentsCountByRole.get(role.id) ?? 0
                      : null;
                    return (
                      <div
                        key={cfg.id}
                        className={cn(
                          "rounded-md border border-border/60 bg-background/50 p-3 space-y-2",
                          duplicateTrIds.has(cfg.id) && "border-rose-500/40",
                        )}
                      >
                        <div className="flex items-start gap-1.5 flex-wrap">
                          <code className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-muted text-foreground">
                            {cfg.id}
                          </code>
                          <Input
                            value={cfg.label ?? ""}
                            onChange={(e) => updateRepeat(cfg.id, { label: e.target.value })}
                            placeholder="Название (опционально, только для UI)"
                            className="h-7 text-[11px] flex-1 min-w-[160px]"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 text-[11px]"
                            onClick={() => copyMarker(cfg.id)}
                          >
                            <ClipboardCopy className="h-3 w-3 mr-1" /> Скопировать маркер
                          </Button>
                          {isSuperAdmin && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 text-[11px]"
                              onClick={() => runDryRun(cfg.id)}
                              title="Stage E.3 — резолвит preview из package-tokens-dry-run (super_admin only)."
                            >
                              <FlaskConical className="h-3 w-3 mr-1" /> Dry-run preview
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Удалить конфиг ${cfg.id}?\n\n` +
                                    `Если маркер {{tableRepeat:${cfg.id}}} уже вставлен в DOCX-шаблон, ` +
                                    `его нужно удалить из файла вручную. Автоматическое редактирование DOCX не выполняется.`,
                                )
                              ) {
                                removeRepeat(cfg.id);
                              }
                            }}
                            aria-label="Удалить конфиг"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <div className="text-[10px] text-muted-foreground font-medium">
                              Источник строк
                            </div>
                            <Select
                              value={cfg.source_kind ?? "role_assignments"}
                              onValueChange={(v) => updateRepeat(cfg.id, v === "external_submission"
                                ? {
                                  source_kind: "external_submission",
                                  role_catalog_id: undefined,
                                  columns: cfg.columns.map((column) =>
                                    ["role_person", "assignment_custom_field", "assignment_metadata"].includes(column.source_type)
                                      ? { ...column, source_type: "submission_field", source_key: undefined, case: undefined, format: undefined }
                                      : column,
                                  ),
                                }
                                : { source_kind: "role_assignments", repeat_group_key: undefined, role_catalog_id: "" })}
                            >
                              <SelectTrigger className="h-7 text-[11px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="role_assignments" className="text-[11px]">Назначения ролей в анкете</SelectItem>
                                <SelectItem value="external_submission" className="text-[11px]">Повторяемая группа внешней анкеты</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <div className="text-[10px] text-muted-foreground font-medium">
                              {isExternal ? "Ключ повторяемой группы" : "Роль-источник"}
                            </div>
                            {isExternal ? (
                              <Input className="h-7 text-[11px]" value={cfg.repeat_group_key ?? ""}
                                placeholder="Напр.: expenses"
                                onChange={(e) => updateRepeat(cfg.id, { repeat_group_key: e.target.value.replace(/[^a-z0-9_]/g, "") })} />
                            ) : (
                              <Select value={cfg.role_catalog_id ?? ""} onValueChange={(v) => updateRepeat(cfg.id, { role_catalog_id: v })}>
                                <SelectTrigger className="h-7 text-[11px]"><SelectValue placeholder="Выберите роль…" /></SelectTrigger>
                                <SelectContent>{activeRoles.map((r) => <SelectItem key={r.id} value={r.id} className="text-[11px]">{r.label} <span className="text-muted-foreground font-mono">{r.public_id}</span></SelectItem>)}</SelectContent>
                              </Select>
                            )}
                          </div>
                          <div className="space-y-1 md:col-span-2">
                            <div className="text-[10px] text-muted-foreground font-medium">Предпросмотр количества строк</div>
                            <div className="text-[11px] text-foreground border border-border/40 rounded h-7 px-2 flex items-center bg-muted/40">
                              {isExternal ? <span className="text-muted-foreground">Число строк появится после заполнения внешней анкеты.</span> : previewN === null ? (
                                <span className="text-muted-foreground">
                                  Сначала выберите роль
                                </span>
                              ) : (
                                <span>
                                  <span className="font-semibold tabular-nums">{previewN}</span>{" "}
                                  активных назначений роли в этой анкете.
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                              Колонки
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 text-[11px]"
                              onClick={() => addColumn(cfg.id)}
                            >
                              <Plus className="h-3 w-3 mr-1" /> Колонка
                            </Button>
                          </div>
                          {cfg.columns.length === 0 ? (
                            <div className="text-[11px] text-muted-foreground border border-dashed border-border/60 rounded-md p-2 text-center">
                              Колонок ещё нет. Добавьте хотя бы одну.
                            </div>
                          ) : (
                            <div className="space-y-1.5">
                              {cfg.columns.map((col, i) => (
                                <TableRepeatColumnRow
                                  key={i}
                                  column={col}
                                  index={i}
                                  isSuperAdmin={isSuperAdmin}
                                  roleCustomDefs={customDefs}
                                  packageFields={packageFields}
                                  isExternalSource={isExternal}
                                  duplicateCellIndex={(cellCount.get(col.cell_index) ?? 0) > 1}
                                  onChange={(patch) => updateColumn(cfg.id, i, patch)}
                                  onRemove={() => removeColumn(cfg.id, i)}
                                />
                              ))}
                            </div>
                          )}
                        </div>

                        {isExternal && (
                          <div className="space-y-1.5 rounded-md border border-dashed border-border/60 p-2">
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Итоги по строкам</div>
                                <div className="text-[10px] text-muted-foreground">Суммы считаются при генерации из заполненных строк. Скопируйте токен в DOCX; с <code>|format=words</code> он выводится прописью.</div>
                              </div>
                              <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => addAggregate(cfg.id)}>
                                <Plus className="h-3 w-3 mr-1" /> Итог
                              </Button>
                            </div>
                            {(cfg.aggregates ?? []).map((aggregate, aggregateIndex) => (
                              <div key={aggregate.id} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto] gap-1.5 items-end rounded border border-border/40 p-2">
                                <div className="space-y-1"><div className="text-[10px] text-muted-foreground">Название</div><Input className="h-7 text-[11px]" value={aggregate.label ?? ""} onChange={(event) => updateAggregate(cfg.id, aggregateIndex, { label: event.target.value })} placeholder="Например: Личные средства" /></div>
                                <div className="space-y-1"><div className="text-[10px] text-muted-foreground">Суммировать поле</div><Select value={aggregate.source_field_public_id} onValueChange={(value) => updateAggregate(cfg.id, aggregateIndex, { source_field_public_id: value })}><SelectTrigger className="h-7 text-[11px]"><SelectValue placeholder="Числовое поле…" /></SelectTrigger><SelectContent>{packageFields.map((field) => <SelectItem key={field.public_id} value={field.public_id} className="text-[11px]">{field.label} · {field.public_id}</SelectItem>)}</SelectContent></Select></div>
                                <div className="space-y-1"><div className="text-[10px] text-muted-foreground">Фильтр (поле=значения)</div><Input className="h-7 text-[11px] font-mono" value={aggregate.filter_field_public_id ? `${aggregate.filter_field_public_id}=${(aggregate.filter_values ?? []).join(",")}` : ""} onChange={(event) => { const [field, values] = event.target.value.split("="); updateAggregate(cfg.id, aggregateIndex, { filter_field_public_id: /^pf-\d{6}$/.test(field?.trim() ?? "") ? field.trim() : undefined, filter_values: values ? values.split(",").map((value) => value.trim()).filter(Boolean) : undefined }); }} placeholder="pf-000030=own_cash,personal_card" /></div>
                                <div className="flex gap-1"><Button type="button" variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => navigator.clipboard.writeText(`{{tableTotal:${aggregate.id}}}`).then(() => toast.success("Токен итога скопирован"), () => toast.error("Не удалось скопировать"))}><ClipboardCopy className="h-3 w-3" /></Button><Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeAggregate(cfg.id, aggregateIndex)}><Trash2 className="h-3.5 w-3.5" /></Button></div>
                                <div className="md:col-span-4 text-[10px] text-muted-foreground">Токены: <code>{`{{tableTotal:${aggregate.id}}}`}</code> · <code>{`{{tableTotal:${aggregate.id}|format=words}}`}</code></div>
                              </div>
                            ))}
                            {(cfg.aggregates ?? []).length === 0 && <div className="text-[11px] text-muted-foreground">Итогов пока нет.</div>}
                          </div>
                        )}

                        {issues.length > 0 && (
                          <ul className="space-y-1">
                            {issues.map((iss, idx) => (
                              <li
                                key={`${iss.code}-${idx}`}
                                className={cn(
                                  "text-[11px] flex items-start gap-1",
                                  iss.severity === "error"
                                    ? "text-rose-700 dark:text-rose-400"
                                    : "text-amber-700 dark:text-amber-400",
                                )}
                              >
                                {iss.severity === "error" ? (
                                  <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                                ) : (
                                  <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                                )}
                                <span>{iss.message}</span>
                              </li>
                            ))}
                          </ul>
                        )}

                        {role && knownCustomKeys.size === 0 && (
                          <div className="text-[10px] text-muted-foreground leading-snug">
                            У роли «{role.label}» пока нет custom assignment
                            fields — источник «Доп. поле роли» будет недоступен.
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex items-center justify-between gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={addRepeat}
                >
                  <Plus className="h-3 w-3 mr-1" /> Добавить повторяемую строку
                </Button>
                <div className="flex items-center gap-1.5">
                  {dirty && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-[11px]"
                      onClick={onRevert}
                      disabled={repeatsState.isSaving}
                    >
                      Отменить
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={onSave}
                    disabled={!dirty || hasBlockingErrors || repeatsState.isSaving}
                  >
                    {repeatsState.isSaving ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <Save className="h-3 w-3 mr-1" />
                    )}
                    Сохранить конфиги
                  </Button>
                </div>
              </div>

              <div className="text-[10px] text-muted-foreground leading-snug border-t border-border/40 pt-2">
                Это служебный маркер строки таблицы. Реальное размножение строк
                DOCX подключится на Stage E.4. Stage E.3 даёт только
                structured dry-run preview (super_admin) — значения в preview
                ограничены 200 символами и 5 строками.
              </div>
            </>
          )}
        </>
      )}

      <Dialog
        open={dryRunTrId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDryRunTrId(null);
            setDryRunResult(null);
            setDryRunError(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm">
              Dry-run preview {dryRunTrId ? `{{tableRepeat:${dryRunTrId}}}` : ""}
            </DialogTitle>
            <DialogDescription className="text-[11px]">
              Stage E.3 — резолв через `package-tokens-dry-run`. Не пишет в
              snapshot/storage, не запускает генерацию DOCX. Значения в preview
              усечены до 200 символов; показано не более 5 строк.
            </DialogDescription>
          </DialogHeader>
          {dryRunLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Резолвим…
            </div>
          )}
          {dryRunError && (
            <div className="text-[11px] text-rose-700 dark:text-rose-400 border border-rose-500/30 bg-rose-500/5 rounded p-2">
              {dryRunError}
            </div>
          )}
          {dryRunResult !== null && (
            <pre className="text-[11px] font-mono overflow-auto max-h-[60vh] bg-muted/40 border border-border/40 rounded p-2 whitespace-pre-wrap break-words">
              {JSON.stringify(dryRunResult, null, 2)}
            </pre>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
