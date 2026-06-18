/**
 * PackageDocumentCard — Stage 5 / Stage 5.0 visual redesign of
 * PATCH-PACKAGE-CROSS-PARITY-V1.
 *
 * Единая карточка документа пакета. Используется одинаково в любом пакете
 * (Идеология, Годовое собрание, новые пакеты) без специальных условий по
 * UUID/названию. Один atomic save на документ: поля + роли уходят одной
 * транзакцией через RPC `save_session_document_atomic` (Stage 2).
 *
 * Контракт:
 *  • Поля = sparse-патч только из явно изменённых пользователем pf-полей
 *    этого документа (orphan-поля никогда не попадают сюда).
 *  • Роли = полный desired-state управляемых ролей этого документа.
 *    Сохранение блокируется, пока desired-state ролей не гидратирован.
 *  • Версия шаблона = `document_templates.current_version_id`
 *    (поле приходит как `active_version_id` в проп item). Если активной
 *    версии нет — save заблокирован, карточка показывает inline-CTA.
 *  • Никаких ветвлений по `package_template_id`, названию или UUID.
 *
 * Бейджи:
 *  • «X/Y полей» — token-driven (detected pf), required-aware ✓/●.
 *  • «K/N обязательных ролей» — только required-роли пакета.
 *    Доп. nullable-бейдж «+N доп.» для необязательных назначений.
 *  • «Сохранено» / «Есть несохранённые изменения» — отдельный indicator,
 *    не смешивается со статусом полноты.
 *  • «Нет активной версии» — warning, если у шаблона нет current_version_id.
 *
 * Empty-state:
 *  • Если у шаблона нет detected pf-токенов — показываем
 *    «В этом документе нет дополнительных полей», а не пустую секцию.
 *  • Если в каталоге пакета нет активных ролей — отдельный helper-блок
 *    с CTA для админа.
 *
 * Все цвета — через семантические токены (bg-card/border/foreground/…).
 * Никакого hardcoded `text-white`/`#hex`. Карточка корректно работает
 * в light и dark.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import {
  AccordionItem, AccordionContent, AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertCircle, AlertTriangle, CheckCircle2, FileText, Info, ListChecks,
  Loader2, Plus, Save, Trash2, Users, Circle, Sparkles,
} from "lucide-react";
import { HelpTooltip } from "@/components/help/HelpComponents";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

import { useDocumentItemRoleAssignments } from "@/hooks/useDocumentItemRoleAssignments";
import { usePackageSessionFields } from "@/hooks/usePackageSessionFields";
import { useAtomicDocumentSave } from "@/hooks/useAtomicDocumentSave";
import { PackageFieldsClientForm, type PackageFieldsSubmitHandle } from "./PackageFieldsClientForm";
import { InlineCreateRoleDialog } from "./InlineCreateRoleDialog";

export interface PackageDocumentCardItem {
  id: string;
  sort_order: number;
  template_id: string;
  template_name: string;
  active_version_id: string | null;
}

export interface PackageDocumentCardRole {
  id: string;
  label: string;
  role_key: string;
  public_id: string;
  required?: boolean;
}

export interface PackageDocumentCardProps {
  item: PackageDocumentCardItem;
  /** Index in the rendered (filtered + sorted) list. Used for the badge number. */
  index: number;
  packageTemplateId: string;
  sessionId: string;
  sessionCreatedAt: string | null;
  activeRoles: PackageDocumentCardRole[];
  persons: { id: string; full_name: string | null; is_active: boolean }[];
  personsLoading: boolean;
  isAdmin: boolean;
}

interface DraftRow {
  uid: string;
  role_catalog_id: string;
  person_id: string;
  position: string;
}

function newUid() {
  return Math.random().toString(36).slice(2);
}

function rowsEqual(a: DraftRow[], b: DraftRow[]): boolean {
  if (a.length !== b.length) return false;
  const norm = (r: DraftRow) =>
    `${r.role_catalog_id}|${r.person_id}|${r.position.trim()}`;
  const sa = a.map(norm).sort();
  const sb = b.map(norm).sort();
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false;
  return true;
}

type CardStatus = "ready" | "partial" | "empty";

export function PackageDocumentCard({
  item,
  index,
  packageTemplateId,
  sessionId,
  sessionCreatedAt,
  activeRoles,
  persons,
  personsLoading,
  isAdmin,
}: PackageDocumentCardProps) {
  const { assignments, isLoading: rolesLoading } = useDocumentItemRoleAssignments(sessionId, item.id);
  const fieldsRef = useRef<PackageFieldsSubmitHandle>(null);
  const fieldsState = usePackageSessionFields(sessionId, packageTemplateId);
  const itemQuestions = fieldsState.getItemQuestions(item.id);
  const itemProgress = fieldsState.getItemProgress(item.id);
  const atomicSave = useAtomicDocumentSave();

  // role draft: null до гидратации (Stage 5 требование #4)
  const [draft, setDraft] = useState<DraftRow[] | null>(null);
  const [baseline, setBaseline] = useState<DraftRow[] | null>(null);
  const [fieldsDirty, setFieldsDirty] = useState(false);

  useEffect(() => {
    if (rolesLoading) return;
    if (draft !== null) return;
    const initial = assignments.map((a) => ({
      uid: a.id,
      role_catalog_id: a.role_catalog_id,
      person_id: a.person_id ?? "",
      position: ((a.metadata as any)?.position as string) ?? "",
    }));
    setDraft(initial);
    setBaseline(initial);
  }, [rolesLoading, assignments, draft]);

  // ---------- роли: required vs optional ----------
  const requiredRoleIds = useMemo(
    () => new Set(activeRoles.filter((r) => r.required).map((r) => r.id)),
    [activeRoles],
  );
  const requiredRolesTotal = requiredRoleIds.size;

  const filledRows = (draft ?? []).filter((r) => r.role_catalog_id && r.person_id);
  const requiredRolesFilled = useMemo(() => {
    const filledRequiredIds = new Set<string>();
    for (const r of filledRows) {
      if (requiredRoleIds.has(r.role_catalog_id)) filledRequiredIds.add(r.role_catalog_id);
    }
    return filledRequiredIds.size;
  }, [filledRows, requiredRoleIds]);
  const optionalRolesFilled = filledRows.filter((r) => !requiredRoleIds.has(r.role_catalog_id)).length;
  const rolesAllRequiredFilled = requiredRolesTotal === 0 || requiredRolesFilled >= requiredRolesTotal;

  const rolesDirty = useMemo(() => {
    if (draft === null || baseline === null) return false;
    return !rowsEqual(draft, baseline);
  }, [draft, baseline]);

  const isDirty = fieldsDirty || rolesDirty;

  const rolesHydrated = draft !== null;
  const hasActiveVersion = !!item.active_version_id;
  const hasFields = itemQuestions.length > 0;
  const canSave =
    isDirty &&
    !rolesLoading &&
    !fieldsState.isLoading &&
    rolesHydrated &&
    hasActiveVersion &&
    !atomicSave.isPending;

  // ---------- общий статус карточки ----------
  const fieldsReady = !hasFields || itemProgress.allRequiredFilled;
  const rolesReady = rolesAllRequiredFilled;
  const anythingFilled =
    (hasFields && itemProgress.filled > 0) || filledRows.length > 0;

  const status: CardStatus = !hasActiveVersion
    ? "empty"
    : fieldsReady && rolesReady && (anythingFilled || (!hasFields && requiredRolesTotal === 0))
      ? (anythingFilled ? "ready" : "empty")
      : anythingFilled
        ? "partial"
        : "empty";

  const addRow = (preselectRoleKey?: string) => {
    const role = preselectRoleKey
      ? activeRoles.find((r) => r.role_key === preselectRoleKey)
      : undefined;
    setDraft((prev) => [
      ...(prev ?? []),
      { uid: newUid(), role_catalog_id: role?.id ?? "", person_id: "", position: "" },
    ]);
  };
  const updateRow = (uid: string, patch: Partial<DraftRow>) => {
    setDraft((prev) => (prev ?? []).map((r) => (r.uid === uid ? { ...r, ...patch } : r)));
  };
  const removeRow = (uid: string) => {
    setDraft((prev) => (prev ?? []).filter((r) => r.uid !== uid));
  };

  const handleSaveAll = async () => {
    if (!canSave) return;
    if (!hasActiveVersion) {
      toast.error("У шаблона документа нет активной версии. Сохранение невозможно.");
      return;
    }
    const fieldsPatch = fieldsRef.current?.getDirtyPatch() ?? [];
    const rolesDesired = (draft ?? [])
      .filter((r) => r.role_catalog_id && r.person_id)
      .map((r, idx) => ({
        role_catalog_id: r.role_catalog_id,
        person_id: r.person_id,
        position: r.position.trim() || null,
        sort_order: (idx + 1) * 10,
      }));

    try {
      const res = await atomicSave.mutateAsync({
        sessionId,
        packageTemplateItemId: item.id,
        fields: fieldsPatch,
        rolesDesired,
        expectedTemplateVersionId: item.active_version_id,
      });
      if (res?.ok) {
        fieldsRef.current?.markSaved();
        setBaseline(draft);
        toast.success("Анкета документа сохранена");
      }
    } catch (e: any) {
      const code = e?.code ?? e?.details?.code;
      const msg = e?.message ?? String(e);
      if (msg?.includes("stale_template_version") || code === "22023") {
        toast.error("Шаблон документа был обновлён. Откройте карточку заново.");
      } else if (msg?.includes("person_not_accessible") || msg?.includes("person_outside_session_owner")) {
        toast.error("Выбранное физлицо недоступно в этой сессии.");
      } else {
        toast.error(`Не удалось сохранить документ: ${msg}`);
      }
    }
  };

  // ---------- header presentation ----------
  const displayName = item.template_name?.trim()
    ? item.template_name
    : `Документ №${index + 1}`;

  const fieldsBadge = hasFields ? (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] h-5 px-1.5 gap-1 font-medium",
        itemProgress.allRequiredFilled
          ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5"
          : "text-muted-foreground",
      )}
    >
      {itemProgress.allRequiredFilled
        ? <CheckCircle2 className="h-3 w-3" />
        : <Circle className="h-3 w-3" />}
      {itemProgress.filled}/{itemProgress.total} полей
    </Badge>
  ) : null;

  const requiredRolesBadge = requiredRolesTotal > 0 ? (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] h-5 px-1.5 gap-1 font-medium",
        rolesAllRequiredFilled
          ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5"
          : "border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/5",
      )}
    >
      {rolesAllRequiredFilled
        ? <CheckCircle2 className="h-3 w-3" />
        : <AlertCircle className="h-3 w-3" />}
      {requiredRolesFilled}/{requiredRolesTotal} обяз. ролей
    </Badge>
  ) : null;

  const optionalRolesBadge = optionalRolesFilled > 0 ? (
    <Badge variant="outline" className="text-[10px] h-5 px-1.5 gap-1 font-medium text-muted-foreground">
      <Users className="h-3 w-3" />
      +{optionalRolesFilled} доп.
    </Badge>
  ) : null;

  const dirtyBadge = isDirty ? (
    <Badge
      variant="outline"
      className="text-[10px] h-5 px-1.5 gap-1 font-medium border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/5"
    >
      <Circle className="h-2 w-2 fill-current" />
      Есть несохранённые изменения
    </Badge>
  ) : (
    <Badge
      variant="outline"
      className="text-[10px] h-5 px-1.5 gap-1 font-medium text-muted-foreground"
    >
      <CheckCircle2 className="h-3 w-3" />
      Сохранено
    </Badge>
  );

  const statusAccent =
    status === "ready"
      ? "before:bg-emerald-500/60"
      : status === "partial"
        ? "before:bg-amber-500/60"
        : "before:bg-border";

  return (
    <AccordionItem
      value={item.id}
      className={cn(
        "relative rounded-xl border border-border/60 bg-card/40 mb-3 overflow-hidden",
        "before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1",
        statusAccent,
      )}
    >
      <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/30 transition-colors group">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="flex items-center gap-2 shrink-0">
            <span className="inline-flex items-center justify-center h-6 min-w-6 px-1.5 rounded-md bg-muted text-[11px] font-semibold text-muted-foreground tabular-nums">
              {item.sort_order + 1}
            </span>
            <FileText className="h-4 w-4 text-primary shrink-0" />
          </div>

          <div className="flex flex-col items-start min-w-0 flex-1">
            <span className="text-sm font-semibold truncate text-left text-foreground max-w-full">
              {displayName}
            </span>
            <div className="flex items-center gap-1.5 flex-wrap mt-1">
              {!hasActiveVersion && (
                <Badge
                  variant="outline"
                  className="text-[10px] h-5 px-1.5 gap-1 font-medium border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/5"
                >
                  <AlertTriangle className="h-3 w-3" />
                  Нет активной версии
                </Badge>
              )}
              {fieldsBadge}
              {requiredRolesBadge}
              {optionalRolesBadge}
              {dirtyBadge}
            </div>
          </div>
        </div>
      </AccordionTrigger>

      <AccordionContent className="px-4 pb-4 pt-1 space-y-4 border-t border-border/40 bg-background/40">
        {/* ---------- Поля документа ---------- */}
        <section className="rounded-lg border border-border/50 bg-card/30 p-3 space-y-2">
          <header className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-md bg-primary/10 text-primary flex items-center justify-center">
                <ListChecks className="h-3.5 w-3.5" />
              </div>
              <div>
                <div className="text-xs font-semibold text-foreground">Поля документа</div>
                <div className="text-[10px] text-muted-foreground">
                  Пер-документные значения. Пустое поле использует общее значение пакета.
                </div>
              </div>
            </div>
            {hasFields && (
              <div className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                {itemProgress.filled} / {itemProgress.total}
              </div>
            )}
          </header>

          {!hasActiveVersion ? (
            <div className="text-xs text-muted-foreground border border-dashed border-amber-500/30 rounded-md p-3 flex items-start gap-2 bg-amber-500/5">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <div>
                <div className="font-medium text-foreground">Нет активной версии шаблона</div>
                <div className="mt-0.5">
                  Активируйте версию DOCX-шаблона в разделе «Шаблоны документов»,
                  чтобы появились поля и стало возможно сохранение.
                </div>
              </div>
            </div>
          ) : !hasFields ? (
            <div className="text-xs text-muted-foreground border border-dashed border-border/60 rounded-md p-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-muted-foreground/70 shrink-0" />
              <span>В этом документе нет дополнительных полей — все нужные значения берутся из общих полей пакета.</span>
            </div>
          ) : (
            <PackageFieldsClientForm
              ref={fieldsRef}
              sessionId={sessionId}
              packageTemplateId={packageTemplateId}
              packageTemplateItemId={item.id}
              sessionCreatedAt={sessionCreatedAt}
              hideSaveButton
              onDirtyChange={setFieldsDirty}
            />
          )}
        </section>

        {/* ---------- Роли документа ---------- */}
        <section className="rounded-lg border border-border/50 bg-card/30 p-3 space-y-2">
          <header className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-md bg-primary/10 text-primary flex items-center justify-center">
                <Users className="h-3.5 w-3.5" />
              </div>
              <div>
                <div className="text-xs font-semibold text-foreground">Роли документа</div>
                <div className="text-[10px] text-muted-foreground">
                  Кто подписывает / отвечает за этот конкретный документ.
                </div>
              </div>
            </div>
            {requiredRolesTotal > 0 && (
              <div className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                {requiredRolesFilled} / {requiredRolesTotal} обяз.
              </div>
            )}
          </header>

          {rolesLoading || draft === null ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Загружаем назначения…
            </div>
          ) : activeRoles.length === 0 ? (
            <div className="text-xs text-muted-foreground border border-dashed border-border/60 rounded-md p-3 text-center space-y-2">
              <div>В пакете пока нет активных ролей.</div>
              {isAdmin && <InlineCreateRoleDialog packageTemplateId={packageTemplateId} />}
            </div>
          ) : (
            <div className="space-y-2">
              {draft.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-3 border border-dashed border-border/60 rounded-md">
                  Пока нет назначений. Добавьте первую роль.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {draft.map((row) => {
                    const isRequired = requiredRoleIds.has(row.role_catalog_id);
                    return (
                      <div
                        key={row.uid}
                        className={cn(
                          "flex items-start gap-1.5 rounded-md border p-2 transition-colors",
                          isRequired
                            ? "border-primary/30 bg-primary/[0.03]"
                            : "border-border/60 bg-background/40",
                        )}
                      >
                        <Select
                          value={row.role_catalog_id}
                          onValueChange={(v) => updateRow(row.uid, { role_catalog_id: v })}
                        >
                          <SelectTrigger className="h-8 text-[11px] flex-1">
                            <SelectValue placeholder="Роль…" />
                          </SelectTrigger>
                          <SelectContent>
                            {activeRoles.map((r) => (
                              <SelectItem key={r.id} value={r.id} className="text-[11px]">
                                {r.label}
                                {r.required && (
                                  <span className="ml-1 text-[9px] text-amber-600 dark:text-amber-400">
                                    (обяз.)
                                  </span>
                                )}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={row.person_id}
                          onValueChange={(v) => updateRow(row.uid, { person_id: v })}
                        >
                          <SelectTrigger className="h-8 text-[11px] flex-1">
                            <SelectValue placeholder="Физлицо…" />
                          </SelectTrigger>
                          <SelectContent>
                            {personsLoading ? (
                              <div className="px-2 py-1 text-[11px] text-muted-foreground">Загрузка…</div>
                            ) : persons.filter((p) => p.is_active).length === 0 ? (
                              <div className="px-2 py-1 text-[11px] text-muted-foreground">
                                Нет физлиц. Добавьте их во вкладке «Реквизиты».
                              </div>
                            ) : (
                              persons.filter((p) => p.is_active).map((p) => (
                                <SelectItem key={p.id} value={p.id} className="text-[11px]">
                                  {p.full_name ?? "—"}
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                        <Input
                          value={row.position}
                          onChange={(e) => updateRow(row.uid, { position: e.target.value })}
                          placeholder="Должность (опц.)"
                          className="h-8 text-[11px] flex-1"
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => removeRow(row.uid)}
                          aria-label="Удалить назначение"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
              <Button size="sm" variant="outline" onClick={() => addRow()} className="h-8">
                <Plus className="h-3.5 w-3.5 mr-1" /> Добавить роль
              </Button>
            </div>
          )}
        </section>

        {/* ---------- Footer: atomic save ---------- */}
        <footer
          className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-3 border-t border-border/40"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        >
          <p className="text-[10px] text-muted-foreground flex items-start gap-1.5 leading-relaxed">
            <Info className="h-3 w-3 mt-0.5 shrink-0" />
            Поля и роли этого документа сохраняются одной транзакцией.
            Если поле не заполнено здесь — используется общее значение пакета.
          </p>
          <HelpTooltip
            helpKey=""
            customShort={
              !hasActiveVersion
                ? "Сначала активируйте версию шаблона."
                : !isDirty
                  ? "Нет изменений для сохранения."
                  : "Сохранить поля и роли этого документа одной транзакцией."
            }
            alwaysShow
          >
            <Button
              size="sm"
              onClick={handleSaveAll}
              disabled={!canSave}
              className="w-full sm:w-auto"
            >
              {atomicSave.isPending ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5 mr-1" />
              )}
              {atomicSave.isPending ? "Сохранение…" : "Сохранить документ"}
            </Button>
          </HelpTooltip>
        </footer>
      </AccordionContent>
    </AccordionItem>
  );
}
