/**
 * TemplateBindingControl — Sprint 3F Phase 2b.
 *
 * Admin-only UI для привязки/отвязки `document_templates` к
 * `document_package_templates` через канонические RPC:
 *   - package_template_bind_template(_template_id, _package_template_id, _sort_order?)
 *   - package_template_unbind_template(_template_id, _package_template_id?)
 *
 * Никаких direct INSERT/DELETE/UPDATE в `document_package_template_items`
 * или `document_templates.template_scope`. Все мутации проходят через RPC,
 * который пишет audit_logs и синхронизирует template_scope.
 *
 * Ничего не вызывает в canonical-document-generate-strict / Gotenberg
 * / ai_generated_documents.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Link2, Unlink, FileText } from "lucide-react";
import { toast } from "sonner";
import { HelpTooltip } from "@/components/help/HelpComponents";
import { usePackageItemGenerationMode } from "@/hooks/usePackageItemGenerationMode";

interface Props {
  packageTemplateId: string | null;
}

interface TemplateRow {
  id: string;
  name: string;
  template_scope: string | null;
  template_status: string;
}

interface BoundItem {
  id: string;
  template_id: string;
  sort_order: number;
  template_name: string;
  template_status: string;
  generation_mode: "single" | "per_role_person";
  repeat_role_catalog_id: string | null;
}

interface RoleOption {
  id: string;
  role_key: string;
  label: string;
  is_active: boolean;
}

const QK_BOUND = (pkgId: string | null) => ["pkg-bound-templates", pkgId];
const QK_ALL = ["pkg-all-templates"];

export function TemplateBindingControl({ packageTemplateId }: Props) {
  const qc = useQueryClient();
  const [pendingTemplateId, setPendingTemplateId] = useState<string>("");
  const [previewPerRole, setPreviewPerRole] = useState<Record<string, boolean>>({});

  const boundQuery = useQuery({
    queryKey: QK_BOUND(packageTemplateId),
    queryFn: async () => {
      if (!packageTemplateId) return [] as BoundItem[];
      const { data, error } = await supabase
        .from("document_package_template_items")
        .select("id, template_id, sort_order, generation_mode, repeat_role_catalog_id")
        .eq("package_template_id", packageTemplateId)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      const ids = (data ?? []).map((r) => r.template_id);
      if (ids.length === 0) return [];
      const { data: tpls } = await supabase
        .from("document_templates")
        .select("id, name, template_status, deleted_at")
        .in("id", ids);
      const map = new Map((tpls ?? []).map((t: any) => [t.id, t]));
      return (data ?? [])
        .map((r: any) => {
          const t: any = map.get(r.template_id);
          return {
            id: r.id,
            template_id: r.template_id,
            sort_order: r.sort_order,
            template_name: t?.name ?? "—",
            template_status: t?.template_status ?? "—",
            template_deleted: !!t?.deleted_at,
            generation_mode: (r.generation_mode ?? "single") as "single" | "per_role_person",
            repeat_role_catalog_id: r.repeat_role_catalog_id ?? null,
          };
        })
        .filter((r: any) => !r.template_deleted) as BoundItem[];
    },
    enabled: !!packageTemplateId,
  });

  const genMode = usePackageItemGenerationMode(packageTemplateId);
  const rolesQuery = { data: genMode.activeRoles, isLoading: genMode.rolesLoading };

  const allTemplatesQuery = useQuery({
    queryKey: QK_ALL,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_templates")
        .select("id, name, template_scope, template_status")
        .is("deleted_at", null)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as TemplateRow[];
    },
  });

  const bindMutation = useMutation({
    mutationFn: async (templateId: string) => {
      if (!packageTemplateId) throw new Error("Не выбран пакет");
      const { error } = await supabase.rpc("package_template_bind_template", {
        _template_id: templateId,
        _package_template_id: packageTemplateId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK_BOUND(packageTemplateId) });
      qc.invalidateQueries({ queryKey: QK_ALL });
      setPendingTemplateId("");
      toast.success("Шаблон привязан к пакету");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const unbindMutation = useMutation({
    mutationFn: async (templateId: string) => {
      if (!packageTemplateId) throw new Error("Не выбран пакет");
      const { error } = await supabase.rpc("package_template_unbind_template", {
        _template_id: templateId,
        _package_template_id: packageTemplateId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK_BOUND(packageTemplateId) });
      qc.invalidateQueries({ queryKey: QK_ALL });
      toast.success("Шаблон отвязан");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // updateModeMutation вынесен в shared hook usePackageItemGenerationMode.
  // Здесь оставлен тонкий wrapper, чтобы существующий ниже JSX продолжал работать.
  const updateModeMutation = {
    isPending: genMode.isSaving,
    variables: genMode.isSaving ? { itemId: genMode.savingItemId } : undefined,
    mutate: (input: {
      itemId: string;
      generation_mode: "single" | "per_role_person";
      repeat_role_catalog_id: string | null;
    }) => {
      genMode.update({
        itemId: input.itemId,
        packageTemplateId,
        generation_mode: input.generation_mode,
        repeat_role_catalog_id: input.repeat_role_catalog_id,
      });
      qc.invalidateQueries({ queryKey: QK_BOUND(packageTemplateId) });
    },
  } as const;

  const bound = boundQuery.data ?? [];
  const boundIds = new Set(bound.map((b) => b.template_id));
  const available = (allTemplatesQuery.data ?? []).filter((t) => !boundIds.has(t.id));

  if (!packageTemplateId) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        Выберите пакет, чтобы управлять привязкой шаблонов.
      </Card>
    );
  }

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Link2 className="h-4 w-4 text-emerald-500" />
            Шаблоны пакета
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Выберите шаблон из каталога и привяжите его к пакету. После привязки шаблон становится
            доступен в анкетах, проверке и генерации. Все действия записываются в журнал.
          </p>
        </div>
      </div>

      {/* Bind new */}
      <div className="flex items-center gap-2">
        <HelpTooltip helpKey="" customShort="Выберите шаблон из общего каталога, чтобы добавить его в этот пакет." alwaysShow>
          <Select value={pendingTemplateId} onValueChange={setPendingTemplateId}>
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Выберите шаблон для привязки…" />
            </SelectTrigger>
            <SelectContent>
              {available.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  Все шаблоны уже привязаны или каталог пуст.
                </div>
              ) : (
                available.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    <div className="flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>{t.name}</span>
                    </div>
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </HelpTooltip>
        <HelpTooltip helpKey="" customShort="Включает шаблон в состав пакета. Действие фиксируется в журнале." alwaysShow>
          <Button
            size="sm"
            disabled={!pendingTemplateId || bindMutation.isPending}
            onClick={() => bindMutation.mutate(pendingTemplateId)}
            aria-label="Привязать шаблон к пакету"
          >
            {bindMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <>
                <Link2 className="h-3.5 w-3.5 mr-1" /> Привязать
              </>
            )}
          </Button>
        </HelpTooltip>
      </div>

      {/* Bound list */}
      {boundQuery.isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : bound.length === 0 ? (
        <div className="text-xs text-muted-foreground py-3 text-center border border-dashed rounded">
          К пакету пока не привязано ни одного шаблона.
        </div>
      ) : (
        <ul className="divide-y border rounded">
          {bound.map((b) => {
            const roles = rolesQuery.data ?? [];
            const noRoles = roles.length === 0;
            const isPerRolePersisted = b.generation_mode === "per_role_person";
            const isPerRole = isPerRolePersisted || !!previewPerRole[b.id];
            const repeatRole = isPerRolePersisted
              ? roles.find((r) => r.id === b.repeat_role_catalog_id) ?? null
              : null;
            const saving = updateModeMutation.isPending && updateModeMutation.variables?.itemId === b.id;
            return (
              <li key={b.id} className="flex flex-col gap-2 px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                    #{b.sort_order}
                  </Badge>
                  <FileText className="h-3.5 w-3.5 text-emerald-500" />
                  <span className="flex-1 truncate">{b.template_name}</span>
                  {isPerRole && repeatRole && (
                    <Badge variant="default" className="text-[10px] h-4 px-1.5 bg-indigo-500 hover:bg-indigo-500">
                      × по роли «{repeatRole.label}»
                    </Badge>
                  )}
                  {isPerRole && !repeatRole && (
                    <Badge variant="destructive" className="text-[10px] h-4 px-1.5">
                      роль не задана
                    </Badge>
                  )}
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                    {b.template_status}
                  </Badge>
                  <HelpTooltip helpKey="" customShort="Убрать шаблон из пакета. На сам шаблон в каталоге не влияет." alwaysShow>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={unbindMutation.isPending}
                      onClick={() => unbindMutation.mutate(b.template_id)}
                      aria-label="Отвязать шаблон от пакета"
                    >
                      <Unlink className="h-3.5 w-3.5 mr-1" /> Отвязать
                    </Button>
                  </HelpTooltip>
                </div>
                <div className="flex items-center gap-2 pl-7 text-xs">
                  <span className="text-muted-foreground shrink-0">Режим генерации:</span>
                  <Select
                    value={b.generation_mode}
                    disabled={saving}
                    onValueChange={(v) => {
                      const next = v as "single" | "per_role_person";
                      if (next === b.generation_mode) return;
                      if (next === "single") {
                        updateModeMutation.mutate({
                          itemId: b.id,
                          generation_mode: "single",
                          repeat_role_catalog_id: null,
                        });
                      } else {
                        // per_role_person: требуем выбора роли, поэтому не сохраняем до выбора.
                        // Локально переключаем в селекте через optimistic? Нет — оставляем сохранение на выбор роли.
                        if (noRoles) {
                          toast.error("Сначала добавьте роль пакета, затем выберите её как источник повторения.");
                          return;
                        }
                        // Если есть хотя бы одна роль — мгновенно сохраняем с первой как дефолтом? Нет, безопаснее открыть селектор без коммита.
                        // Чтобы UI отразил выбор и одновременно соблюдал триггер: коммитим сразу с первой активной ролью.
                        updateModeMutation.mutate({
                          itemId: b.id,
                          generation_mode: "per_role_person",
                          repeat_role_catalog_id: roles[0].id,
                        });
                      }
                    }}
                  >
                    <SelectTrigger className="h-7 w-[200px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="single">Один документ</SelectItem>
                      <SelectItem value="per_role_person" disabled={noRoles}>
                        По одному на каждого участника роли
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {isPerRole && (
                    <>
                      <span className="text-muted-foreground shrink-0">Роль-источник:</span>
                      <Select
                        value={b.repeat_role_catalog_id ?? ""}
                        disabled={saving || noRoles}
                        onValueChange={(v) =>
                          updateModeMutation.mutate({
                            itemId: b.id,
                            generation_mode: "per_role_person",
                            repeat_role_catalog_id: v || null,
                          })
                        }
                      >
                        <SelectTrigger className="h-7 w-[220px] text-xs">
                          <SelectValue placeholder="Выберите роль…" />
                        </SelectTrigger>
                        <SelectContent>
                          {roles.map((r) => (
                            <SelectItem key={r.id} value={r.id}>
                              {r.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </>
                  )}
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                  {noRoles && (
                    <span className="text-muted-foreground italic">
                      Сначала добавьте роль пакета, затем выберите её как источник повторения.
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
