/**
 * PackageDocumentCard — Stage 5 of PATCH-PACKAGE-CROSS-PARITY-V1.
 *
 * Единая карточка документа пакета. Используется одинаково в любом пакете
 * (Идеология, Годовое собрание, новые пакеты) без специальных условий по
 * UUID/названию. Один atomic save на документ: поля + роли уходят одной
 * транзакцией через RPC `save_session_document_atomic` (Stage 2).
 *
 * Контракт:
 *  • Поля — sparse-патч только из явно изменённых пользователем pf-полей
 *    этого документа (orphan-поля никогда не попадают сюда).
 *  • Роли — полный desired-state управляемых ролей этого документа.
 *    Сохранение блокируется, пока desired-state ролей не гидратирован.
 *  • Версия шаблона — `document_templates.active_version_id` (приходит
 *    с item). Если активная версия отсутствует — save заблокирован.
 *  • Никаких ветвлений по `package_template_id`, названию или UUID.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
  AlertCircle, CheckCircle2, FileText, Info, ListChecks, Loader2, Plus, Save, Trash2, Users,
} from "lucide-react";
import { HelpTooltip } from "@/components/help/HelpComponents";
import { toast } from "sonner";

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

export interface PackageDocumentCardProps {
  item: PackageDocumentCardItem;
  packageTemplateId: string;
  sessionId: string;
  sessionCreatedAt: string | null;
  activeRoles: { id: string; label: string; role_key: string; public_id: string }[];
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

export function PackageDocumentCard({
  item,
  packageTemplateId,
  sessionId,
  sessionCreatedAt,
  activeRoles,
  persons,
  personsLoading,
  isAdmin,
}: PackageDocumentCardProps) {
  const qc = useQueryClient();
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

  const filledRolesCount = (draft ?? []).filter((r) => r.role_catalog_id && r.person_id).length;
  const rolesDirty = useMemo(() => {
    if (draft === null || baseline === null) return false;
    return !rowsEqual(draft, baseline);
  }, [draft, baseline]);

  const isDirty = fieldsDirty || rolesDirty;

  const rolesHydrated = draft !== null;
  const hasActiveVersion = !!item.active_version_id;
  const canSave =
    isDirty &&
    !rolesLoading &&
    !fieldsState.isLoading &&
    rolesHydrated &&
    hasActiveVersion &&
    !atomicSave.isPending;

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
    // Поля: только sparse-патч изменённых пользователем (orphan не попадает по контракту PackageFieldsClientForm).
    const fieldsPatch = fieldsRef.current?.getDirtyPatch() ?? [];

    // Роли: ВСЕГДА полный desired-state управляемых ролей этого item (даже если dirty только поля),
    // иначе RPC архивирует все назначения (см. v_kept_ids в save_session_document_atomic).
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
        // baseline ролей — текущий draft (без soft-deleted uid не важны: после refetch регенерируются)
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

  const hasFields = itemQuestions.length > 0;
  const fieldsBadge = hasFields
    ? `${itemProgress.filled}/${itemProgress.total} полей`
    : null;
  const rolesBadge = `${filledRolesCount} ролей`;

  return (
    <AccordionItem value={item.id}>
      <AccordionTrigger className="px-2 hover:no-underline">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Badge variant="outline" className="text-[10px] h-4 px-1.5 shrink-0">
            #{item.sort_order}
          </Badge>
          <FileText className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
          <span className="text-sm font-medium truncate text-left">{item.template_name}</span>
          <div className="flex items-center gap-1 ml-auto shrink-0">
            {!hasActiveVersion && (
              <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-amber-300 text-amber-700">
                нет активной версии
              </Badge>
            )}
            {fieldsBadge && (
              <Badge variant="outline"
                className={`text-[10px] h-4 px-1.5 ${
                  itemProgress.allRequiredFilled
                    ? "border-emerald-300 text-emerald-700"
                    : "text-muted-foreground"
                }`}>
                {itemProgress.allRequiredFilled
                  ? <CheckCircle2 className="h-2.5 w-2.5 mr-1" />
                  : <AlertCircle className="h-2.5 w-2.5 mr-1" />}
                {fieldsBadge}
              </Badge>
            )}
            <Badge variant="outline"
              className={`text-[10px] h-4 px-1.5 ${
                filledRolesCount === 0 ? "text-muted-foreground" : "border-emerald-300 text-emerald-700"
              }`}>
              {filledRolesCount === 0
                ? <AlertCircle className="h-2.5 w-2.5 mr-1" />
                : <CheckCircle2 className="h-2.5 w-2.5 mr-1" />}
              {rolesBadge}
            </Badge>
            {isDirty && (
              <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-amber-300 text-amber-700">
                есть несохранённые изменения
              </Badge>
            )}
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-3 pb-3 space-y-4">
        {hasFields && (
          <div className="space-y-2">
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <ListChecks className="h-3 w-3" /> Поля документа
            </div>
            <div onInput={() => setFieldsDirtyTick((t) => t + 1)} onChange={() => setFieldsDirtyTick((t) => t + 1)} onClick={() => setFieldsDirtyTick((t) => t + 1)}>
              <PackageFieldsClientForm
                ref={fieldsRef}
                sessionId={sessionId}
                packageTemplateId={packageTemplateId}
                packageTemplateItemId={item.id}
                sessionCreatedAt={sessionCreatedAt}
                hideSaveButton
              />
            </div>
          </div>
        )}

        <div className="space-y-2">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <Users className="h-3 w-3" /> Роли документа
          </div>
          {rolesLoading || draft === null ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : activeRoles.length === 0 ? (
            <div className="text-xs text-muted-foreground border border-dashed rounded p-3 text-center">
              В пакете нет активных ролей. Создайте роль в подвкладке «Роли пакета»
              {isAdmin && (
                <div className="mt-2">
                  <InlineCreateRoleDialog packageTemplateId={packageTemplateId} />
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                {(draft ?? []).length === 0 && (
                  <div className="text-xs text-muted-foreground text-center py-2">
                    Пока нет назначений. Добавьте первую роль.
                  </div>
                )}
                {(draft ?? []).map((row) => (
                  <div key={row.uid} className="flex items-start gap-1.5 border rounded p-2">
                    <Select value={row.role_catalog_id}
                      onValueChange={(v) => updateRow(row.uid, { role_catalog_id: v })}>
                      <SelectTrigger className="h-8 text-[11px] flex-1">
                        <SelectValue placeholder="Роль…" />
                      </SelectTrigger>
                      <SelectContent>
                        {activeRoles.map((r) => (
                          <SelectItem key={r.id} value={r.id} className="text-[11px]">
                            {r.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={row.person_id}
                      onValueChange={(v) => updateRow(row.uid, { person_id: v })}>
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
                    <Input value={row.position}
                      onChange={(e) => updateRow(row.uid, { position: e.target.value })}
                      placeholder="Должность (опц.)" className="h-8 text-[11px] flex-1" />
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0"
                      onClick={() => removeRow(row.uid)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button size="sm" variant="outline" onClick={() => addRow()}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Добавить роль
              </Button>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/40">
          <p className="text-[10px] text-muted-foreground flex items-start gap-1">
            <Info className="h-2.5 w-2.5 mt-0.5 shrink-0" />
            Поля и роли этого документа сохраняются одной транзакцией. Если поле
            не заполнено здесь — используется общее значение пакета.
          </p>
          <HelpTooltip
            helpKey=""
            customShort="Сохранить поля и роли этого документа одной транзакцией."
            alwaysShow
          >
            <Button size="sm" onClick={handleSaveAll} disabled={!canSave}>
              <Save className="h-3.5 w-3.5 mr-1" />
              {atomicSave.isPending ? "Сохранение…" : "Сохранить документ"}
            </Button>
          </HelpTooltip>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
