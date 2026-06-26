import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRbac } from "@/hooks/useRbac";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Lock, ShieldAlert, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { normalizeEdgeFunctionError } from "@/utils/normalizeEdgeFunctionError";

const TRANSLIT: Record<string, string> = {
  а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"yo",ж:"zh",з:"z",и:"i",й:"y",к:"k",л:"l",м:"m",
  н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"kh",ц:"ts",ч:"ch",ш:"sh",щ:"shch",
  ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya",
};
const RESERVED = new Set([
  "super_admin","admin","user","support","editor",
  "admin_gost","news_editor","staff",
  "roles","permissions","admins","system","root",
]);
function slugifyRoleCode(name: string, existing: string[]): string {
  const slug = name.toLowerCase().split("").map(ch => TRANSLIT[ch] ?? ch).join("")
    .replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_").replace(/^_|_$/g, "");
  if (!slug) return "";
  const all = [...RESERVED, ...existing.map(c => c.toLowerCase())];
  if (!all.includes(slug)) return slug;
  let i = 2;
  while (all.includes(`${slug}_${i}`)) i++;
  return `${slug}_${i}`;
}

/**
 * RBAC v3 — UI-редактор Section/Resource access.
 * Три уровня: none / view / manage. (edit опускаем в UI; backend поддерживает, но не используется отсюда.)
 * Source of truth — roles-admin actions: list_catalog, get_role_access, preview_access_change,
 * set_section_access, set_resource_access.
 */

type UiLevel = "none" | "view" | "manage";

interface CatalogSection {
  id: string;
  code: string;
  label: string;
  group_code: string;
  route_prefix: string;
  sort_order: number;
}
interface CatalogResource {
  id: string;
  section_id: string;
  code: string;
  label: string;
  route: string;
  sort_order: number;
}
interface CatalogRole {
  id: string;
  code: string;
  name: string | null;
  description: string | null;
  is_system: boolean;
  is_editable: boolean;
}
interface CatalogResp {
  success: true;
  sections: CatalogSection[];
  resources: CatalogResource[];
  roles: CatalogRole[];
}
interface RoleAccessResp {
  success: true;
  sections: { section_code: string; access_level: UiLevel | "edit" }[];
  resources: { section_code: string; resource_code: string; access_level: UiLevel | "edit" }[];
}

const LEVEL_LABEL: Record<UiLevel, string> = {
  none: "Нет",
  view: "Только просмотр",
  manage: "Полный доступ",
};

function toUiLevel(level: string | undefined | null, fallback: UiLevel = "none"): UiLevel {
  if (level === "manage" || level === "edit") return "manage";
  if (level === "view") return "view";
  if (level === "none") return "none";
  return fallback;
}

async function callRolesAdmin<T = any>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("roles-admin", {
    body: { action, ...payload },
  });
  if (error) {
    const msg = await normalizeEdgeFunctionError(error, "Ошибка операции");
    throw new Error(typeof msg === "string" ? msg : "Ошибка операции");
  }
  if ((data as any)?.error) {
    throw new Error((data as any).error);
  }
  return data as T;
}

export function RoleAccessEditor() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { hasPermission } = useRbac();
  const canManageRoles = hasPermission("roles.manage");
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);

  // Создание роли
  const [createOpen, setCreateOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleDesc, setNewRoleDesc] = useState("");
  const [creating, setCreating] = useState(false);

  // Удаление роли
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; code: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const catalogQ = useQuery({
    queryKey: ["roles-admin", "catalog"],
    queryFn: () => callRolesAdmin<CatalogResp>("list_catalog"),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!selectedRoleId && catalogQ.data?.roles?.length) {
      const firstEditable = catalogQ.data.roles.find((r) => r.is_editable && r.code !== "super_admin");
      setSelectedRoleId(firstEditable?.id ?? catalogQ.data.roles[0].id);
    }
  }, [catalogQ.data, selectedRoleId]);

  const accessQ = useQuery({
    queryKey: ["roles-admin", "role-access", selectedRoleId],
    enabled: !!selectedRoleId,
    queryFn: () => callRolesAdmin<RoleAccessResp>("get_role_access", { roleId: selectedRoleId }),
    staleTime: 30_000,
  });

  // Локальный draft: section_code → UiLevel; "section:resource" → UiLevel
  const [draftSections, setDraftSections] = useState<Map<string, UiLevel>>(new Map());
  const [draftResources, setDraftResources] = useState<Map<string, UiLevel>>(new Map());
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Когда подгрузились права роли — инициализируем draft
  useEffect(() => {
    if (!accessQ.data) return;
    const s = new Map<string, UiLevel>();
    for (const row of accessQ.data.sections) {
      s.set(row.section_code, toUiLevel(row.access_level));
    }
    setDraftSections(s);
    const r = new Map<string, UiLevel>();
    for (const row of accessQ.data.resources) {
      r.set(`${row.section_code}:${row.resource_code}`, toUiLevel(row.access_level));
    }
    setDraftResources(r);
  }, [accessQ.data, selectedRoleId]);

  const selectedRole = useMemo(
    () => catalogQ.data?.roles.find((r) => r.id === selectedRoleId) ?? null,
    [catalogQ.data, selectedRoleId],
  );

  const resourcesBySection = useMemo(() => {
    const m = new Map<string, CatalogResource[]>();
    for (const r of catalogQ.data?.resources ?? []) {
      const arr = m.get(r.section_id) ?? [];
      arr.push(r);
      m.set(r.section_id, arr);
    }
    return m;
  }, [catalogQ.data]);

  const initial = useMemo(() => {
    const s = new Map<string, UiLevel>();
    const r = new Map<string, UiLevel>();
    for (const row of accessQ.data?.sections ?? []) s.set(row.section_code, toUiLevel(row.access_level));
    for (const row of accessQ.data?.resources ?? []) r.set(`${row.section_code}:${row.resource_code}`, toUiLevel(row.access_level));
    return { s, r };
  }, [accessQ.data]);

  const diff = useMemo(() => {
    const changes: Array<
      | { kind: "section"; sectionCode: string; from: UiLevel; to: UiLevel }
      | { kind: "resource"; sectionCode: string; resourceCode: string; from: UiLevel; to: UiLevel }
    > = [];
    const allSecKeys = new Set([...initial.s.keys(), ...draftSections.keys()]);
    for (const k of allSecKeys) {
      const from = initial.s.get(k) ?? "none";
      const to = draftSections.get(k) ?? "none";
      if (from !== to) changes.push({ kind: "section", sectionCode: k, from, to });
    }
    const allResKeys = new Set([...initial.r.keys(), ...draftResources.keys()]);
    for (const k of allResKeys) {
      const from = initial.r.get(k) ?? "none";
      const to = draftResources.get(k) ?? "none";
      if (from !== to) {
        const [sectionCode, resourceCode] = k.split(":");
        changes.push({ kind: "resource", sectionCode, resourceCode, from, to });
      }
    }
    return changes;
  }, [initial, draftSections, draftResources]);

  const readOnly = !selectedRole?.is_editable || selectedRole?.code === "super_admin";

  const setSectionLevel = (code: string, lvl: UiLevel) => {
    if (readOnly) return;
    setDraftSections((m) => {
      const n = new Map(m);
      n.set(code, lvl);
      return n;
    });
  };
  const setResourceLevel = (sectionCode: string, resourceCode: string, lvl: UiLevel) => {
    if (readOnly) return;
    setDraftResources((m) => {
      const n = new Map(m);
      n.set(`${sectionCode}:${resourceCode}`, lvl);
      return n;
    });
  };
  const applyToAllResources = (section: CatalogSection, lvl: UiLevel) => {
    if (readOnly) return;
    const list = resourcesBySection.get(section.id) ?? [];
    setDraftResources((m) => {
      const n = new Map(m);
      for (const r of list) n.set(`${section.code}:${r.code}`, lvl);
      return n;
    });
  };

  const runPreview = async () => {
    if (!selectedRoleId || diff.length === 0) return;
    setPreviewLoading(true);
    try {
      const changes = diff.map((c) =>
        c.kind === "section"
          ? { kind: "section" as const, sectionCode: c.sectionCode, accessLevel: c.to }
          : { kind: "resource" as const, sectionCode: c.sectionCode, resourceCode: c.resourceCode, accessLevel: c.to },
      );
      const resp = await callRolesAdmin<any>("preview_access_change", { roleId: selectedRoleId, changes });
      setPreview(resp);
      setPreviewOpen(true);
    } catch (e: any) {
      toast.error(e?.message ?? "Не удалось получить предпросмотр");
    } finally {
      setPreviewLoading(false);
    }
  };

  const applyChanges = async () => {
    if (!selectedRoleId || diff.length === 0) return;
    setSaving(true);
    let applied = 0;
    let failed = 0;
    const errors: string[] = [];
    try {
      for (const c of diff) {
        try {
          if (c.kind === "section") {
            await callRolesAdmin("set_section_access", {
              roleId: selectedRoleId,
              sectionCode: c.sectionCode,
              accessLevel: c.to,
            });
          } else {
            await callRolesAdmin("set_resource_access", {
              roleId: selectedRoleId,
              sectionCode: c.sectionCode,
              resourceCode: c.resourceCode,
              accessLevel: c.to,
            });
          }
          applied++;
        } catch (e: any) {
          failed++;
          errors.push(`${c.kind === "section" ? c.sectionCode : `${c.sectionCode}.${c.resourceCode}`}: ${e?.message ?? e}`);
        }
      }
      if (failed === 0) {
        toast.success(`Применено изменений: ${applied}`);
      } else {
        toast.error(`Применено ${applied}, ошибок ${failed}. ${errors.slice(0, 2).join("; ")}`);
      }
      setPreviewOpen(false);
      await qc.invalidateQueries({ queryKey: ["roles-admin", "role-access", selectedRoleId] });
      // Инвалидируем кэш useAdminAccess для всех — после relogin/refresh применится автоматически
      await qc.invalidateQueries({ queryKey: ["admin-access"] });
    } finally {
      setSaving(false);
    }
  };

  if (catalogQ.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-6">
        <Loader2 className="h-4 w-4 animate-spin" /> Загрузка каталога...
      </div>
    );
  }
  if (catalogQ.error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        Не удалось загрузить каталог: {(catalogQ.error as Error).message}
      </div>
    );
  }

  const catalog = catalogQ.data!;
  const sectionsSorted = [...catalog.sections].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4">
      {/* Роли */}
      <div className="border rounded-md p-2 h-fit md:sticky md:top-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground px-2 py-1">Роль</div>
        <div className="flex flex-col gap-1">
          {catalog.roles.map((r) => {
            const isActive = r.id === selectedRoleId;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelectedRoleId(r.id)}
                className={`text-left px-2 py-2 rounded-md text-sm flex items-center justify-between gap-2 ${
                  isActive ? "bg-muted font-medium" : "hover:bg-muted/50"
                }`}
              >
                <span>{r.name ?? r.code}</span>
                {!r.is_editable && <Lock className="h-3 w-3 text-muted-foreground" />}
                {r.is_system && r.is_editable && (
                  <Badge variant="outline" className="text-[10px]">sys</Badge>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Каталог секций */}
      <div className="space-y-3">
        {selectedRole && (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-lg font-semibold">{selectedRole.name ?? selectedRole.code}</div>
              <div className="text-xs text-muted-foreground">{selectedRole.code}</div>
            </div>
            <div className="flex items-center gap-2">
              {readOnly && (
                <Badge variant="secondary" className="gap-1">
                  <Lock className="h-3 w-3" /> Read-only (системная роль)
                </Badge>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setDraftSections(new Map(initial.s));
                  setDraftResources(new Map(initial.r));
                }}
                disabled={diff.length === 0 || saving}
              >
                Сбросить
              </Button>
              <Button
                size="sm"
                onClick={runPreview}
                disabled={readOnly || diff.length === 0 || previewLoading}
              >
                {previewLoading && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                Предпросмотр ({diff.length})
              </Button>
            </div>
          </div>
        )}

        {accessQ.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Загрузка прав роли...
          </div>
        )}

        {sectionsSorted.map((s) => {
          const secLevel = draftSections.get(s.code) ?? "none";
          const resources = (resourcesBySection.get(s.id) ?? []).sort((a, b) => a.sort_order - b.sort_order);
          return (
            <div key={s.id} className="border rounded-md">
              <div className="flex items-center justify-between gap-3 p-3 bg-muted/30">
                <div>
                  <div className="font-medium text-sm">{s.label}</div>
                  <div className="text-xs text-muted-foreground">{s.code} · {s.route_prefix}</div>
                </div>
                <LevelRadio
                  value={secLevel}
                  onChange={(lvl) => setSectionLevel(s.code, lvl)}
                  disabled={readOnly}
                  name={`sec-${s.code}`}
                />
              </div>
              {resources.length > 0 && (
                <div className="divide-y">
                  <div className="flex items-center justify-end gap-2 px-3 py-2 text-xs text-muted-foreground">
                    <span>Применить ко всем ресурсам:</span>
                    {(["none", "view", "manage"] as UiLevel[]).map((lvl) => (
                      <button
                        key={lvl}
                        type="button"
                        className="underline disabled:opacity-50"
                        disabled={readOnly}
                        onClick={() => applyToAllResources(s, lvl)}
                      >
                        {LEVEL_LABEL[lvl]}
                      </button>
                    ))}
                  </div>
                  {resources.map((r) => {
                    const key = `${s.code}:${r.code}`;
                    const explicit = draftResources.get(key);
                    const effective: UiLevel = explicit ?? secLevel;
                    return (
                      <div key={r.id} className="flex items-center justify-between gap-3 p-3 pl-6">
                        <div>
                          <div className="text-sm">{r.label}</div>
                          <div className="text-xs text-muted-foreground">
                            {r.code} · {r.route}
                            {!explicit && <span className="ml-1 italic">(наследуется от секции)</span>}
                          </div>
                        </div>
                        <LevelRadio
                          value={effective}
                          onChange={(lvl) => setResourceLevel(s.code, r.code, lvl)}
                          disabled={readOnly}
                          name={`res-${s.code}-${r.code}`}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Предпросмотр изменений</DialogTitle>
            <DialogDescription>
              Роль: <b>{preview?.roleCode ?? selectedRole?.code}</b>. Backend dry-run выполнен.
            </DialogDescription>
          </DialogHeader>

          {preview?.violations?.length > 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <div className="flex items-center gap-2 font-medium mb-2">
                <ShieldAlert className="h-4 w-4" /> Обнаружены блокирующие нарушения
              </div>
              <ul className="space-y-1 list-disc list-inside">
                {preview.violations.map((v: any, i: number) => (
                  <li key={i}>
                    [{v.kind}] {v.sectionCode}{v.resourceCode ? `.${v.resourceCode}` : ""}: {v.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="max-h-80 overflow-auto border rounded-md">
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr>
                  <th className="text-left p-2">Узел</th>
                  <th className="text-left p-2">Было</th>
                  <th className="text-left p-2">Станет</th>
                </tr>
              </thead>
              <tbody>
                {diff.map((c, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-2 font-mono text-xs">
                      {c.kind === "section" ? c.sectionCode : `${c.sectionCode}.${c.resourceCode}`}
                    </td>
                    <td className="p-2">{LEVEL_LABEL[c.from]}</td>
                    <td className="p-2 font-medium">{LEVEL_LABEL[c.to]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)} disabled={saving}>
              Отмена
            </Button>
            <Button
              onClick={applyChanges}
              disabled={saving || !preview?.canApply || diff.length === 0}
            >
              {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Применить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LevelRadio({
  value, onChange, disabled, name,
}: {
  value: UiLevel;
  onChange: (lvl: UiLevel) => void;
  disabled?: boolean;
  name: string;
}) {
  return (
    <RadioGroup
      value={value}
      onValueChange={(v) => onChange(v as UiLevel)}
      className="flex items-center gap-3"
      disabled={disabled}
    >
      {(["none", "view", "manage"] as UiLevel[]).map((lvl) => (
        <div key={lvl} className="flex items-center gap-1">
          <RadioGroupItem id={`${name}-${lvl}`} value={lvl} disabled={disabled} />
          <Label htmlFor={`${name}-${lvl}`} className="text-xs cursor-pointer">
            {LEVEL_LABEL[lvl]}
          </Label>
        </div>
      ))}
    </RadioGroup>
  );
}
