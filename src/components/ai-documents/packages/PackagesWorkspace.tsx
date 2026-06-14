/**
 * PackagesWorkspace — Sprint 3R + Sprint 3S v2 follow-up (admin CRUD).
 *
 * Единая рабочая область вкладки «Пакеты документов».
 *  • Селектор пакетов сверху (Идеология + grey placeholders).
 *  • Admin-режим: CRUD глобальных пакетов через RPC
 *    (create_global_document_package / update_global_document_package /
 *     deactivate_global_document_package / safe_delete_document_package).
 *    Никаких прямых INSERT/UPDATE/DELETE в `document_package_templates`.
 *    Поля только Название/Описание/Активность — без code/slug/public_id.
 *  • User-режим: только просмотр и работа с анкетами/генерацией.
 *  • Подвкладки зависят от режима:
 *      mode="user"  → Анкеты документов + Генерация
 *      mode="admin" → Шаблоны / Анкеты / Роли / Проверка / Генерация
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FileStack, ClipboardList, FileText, Users, ShieldCheck, Sparkles,
  Plus, Pencil, Trash2, MoreHorizontal, Power, PowerOff,
} from "lucide-react";
import { toast } from "sonner";
import { useRbac } from "@/hooks/useRbac";
import { HelpTooltip } from "@/components/help/HelpComponents";
import { DocumentPackageQuestionnairesView } from "./DocumentPackageQuestionnairesView";
import { PackageRolesManager } from "./PackageRolesManager";
import { TemplateBindingControl } from "./TemplateBindingControl";
import { PackageTemplateValidationPanel } from "./PackageTemplateValidationPanel";
import { PackageGenerationPanel } from "./PackageGenerationPanel";




interface PackageOption {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_active: boolean;
  profile_id: string | null;
}

interface PackagesWorkspaceProps {
  /** "user" — урезанный набор вкладок; "admin" — полный (по умолчанию). */
  mode?: "user" | "admin";
}

export function PackagesWorkspace({ mode = "admin" }: PackagesWorkspaceProps) {
  const rbac = useRbac();
  const isAdminUI = mode === "admin" && (rbac.isAdmin || rbac.isSuperAdmin);
  const queryClient = useQueryClient();

  const packagesQuery = useQuery({
    queryKey: ["workspace-package-templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_package_templates")
        .select("id, code, name, description, is_active, profile_id")
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PackageOption[];
    },
  });

  const packages = packagesQuery.data ?? [];
  const ideology = useMemo(
    () => packages.find((p) => p.code === "ideology") ?? packages[0] ?? null,
    [packages],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedId && ideology) setSelectedId(ideology.id);
  }, [selectedId, ideology]);

  const selectedPackage = packages.find((p) => p.id === selectedId) ?? null;
  const [tab, setTab] = useState<string>("anketa");

  // ---- Admin CRUD state ---------------------------------------------------
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PackageOption | null>(null);
  const [form, setForm] = useState({ name: "", description: "", is_active: true });
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", description: "", is_active: true });
    setDialogOpen(true);
  };

  const openEdit = (pkg: PackageOption) => {
    setEditing(pkg);
    setForm({ name: pkg.name, description: pkg.description ?? "", is_active: pkg.is_active });
    setDialogOpen(true);
  };

  const invalidatePackages = async () => {
    await queryClient.invalidateQueries({ queryKey: ["workspace-package-templates"] });
    await queryClient.invalidateQueries({ queryKey: ["pkg-admin-packages"] });
    await queryClient.invalidateQueries({ queryKey: ["access-rule-document-packages"] });
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("Укажите название пакета");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const { data, error } = await supabase.rpc("update_global_document_package", {
          _package_id: editing.id,
          _name: form.name.trim(),
          _description: form.description.trim() || null,
          _is_active: form.is_active,
        });
        if (error) throw error;
        const res = data as { status: string };
        if (res?.status !== "updated") throw new Error(`update failed: ${res?.status}`);
        toast.success("Пакет обновлён");
      } else {
        const { data, error } = await supabase.rpc("create_global_document_package", {
          _name: form.name.trim(),
          _description: form.description.trim() || null,
          _is_active: form.is_active,
        });
        if (error) throw error;
        const res = data as { status: string; package_id?: string };
        if (res?.status !== "created" || !res.package_id) {
          throw new Error(`create failed: ${res?.status}`);
        }
        toast.success("Пакет создан");
        setSelectedId(res.package_id);
      }
      await invalidatePackages();
      setDialogOpen(false);
    } catch (e: any) {
      toast.error(`Не удалось сохранить пакет: ${e?.message ?? e}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (pkg: PackageOption) => {
    setDeleting(true);
    try {
      const { data, error } = await supabase.rpc("safe_delete_document_package", {
        _package_id: pkg.id,
      });
      if (error) throw error;
      const res = data as {
        status: string;
        reason?: string;
        dependencies?: Record<string, number>;
      };
      if (res.status === "deleted") {
        toast.success("Пакет удалён");
        setSelectedId(null);
        await invalidatePackages();
      } else if (res.status === "blocked") {
        const d = res.dependencies ?? {};
        const parts = [
          ["шаблонов", d.items],
          ["сессий", d.sessions],
          ["участников", d.session_participants],
          ["ролей", d.role_catalog],
          ["назначений ролей", d.item_role_assignments],
          ["batch-генераций", d.generation_batches],
          ["сгенерированных документов", d.generated_documents],
          ["правил доступа", d.access_rules],
        ]
          .filter(([, n]) => typeof n === "number" && (n as number) > 0)
          .map(([label, n]) => `${label}: ${n}`)
          .join(", ");
        toast.error(
          `Удалить нельзя: используется (${parts || "есть зависимости"}). Деактивируйте пакет вместо удаления.`,
          { duration: 9000 },
        );
      } else {
        toast.error(`Не удалось удалить: ${res.reason ?? res.status}`);
      }
    } catch (e: any) {
      toast.error(`Ошибка удаления: ${e?.message ?? e}`);
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  };

  const handleToggleActive = async (pkg: PackageOption, next: boolean) => {
    try {
      if (!next) {
        const { data, error } = await supabase.rpc("deactivate_global_document_package", {
          _package_id: pkg.id,
        });
        if (error) throw error;
        const res = data as { status: string };
        if (res?.status !== "deactivated" && res?.status !== "already_inactive") {
          throw new Error(`deactivate failed: ${res?.status}`);
        }
        toast.success("Пакет деактивирован");
      } else {
        const { data, error } = await supabase.rpc("update_global_document_package", {
          _package_id: pkg.id,
          _name: pkg.name,
          _description: pkg.description,
          _is_active: true,
        });
        if (error) throw error;
        const res = data as { status: string };
        if (res?.status !== "updated") throw new Error(`activate failed: ${res?.status}`);
        toast.success("Пакет активирован");
      }
      await invalidatePackages();
    } catch (e: any) {
      toast.error(`Не удалось изменить статус: ${e?.message ?? e}`);
    }
  };

  const subtitle = isAdminUI
    ? "Настройте шаблоны пакета, роли, анкеты документов и запустите генерацию."
    : "Заполните анкеты документов и сформируйте готовый пакет.";

  return (
    <div className="space-y-3">
      {/* Заголовок */}
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-md bg-emerald-50 flex items-center justify-center shrink-0">
          <FileStack className="h-5 w-5 text-emerald-500" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold">Пакеты документов</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
        {isAdminUI && (
          <Button size="sm" onClick={openCreate} className="shrink-0">
            <Plus className="h-4 w-4 mr-1.5" /> Новый пакет
          </Button>
        )}
      </div>

      {/* Селектор пакетов */}
      <GlassCard className="p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground mr-1">Пакет:</span>
          {packages.length === 0 ? (
            <span className="text-xs text-muted-foreground">Загрузка…</span>
          ) : (
            packages.map((p) => {
              const active = p.id === selectedId;
              const disabled = !p.is_active;
              return (
                <HelpTooltip
                  key={p.id}
                  helpKey=""
                  customShort="Открыть пакет документов. Внутри — анкеты и кнопка формирования."
                  alwaysShow
                >
                  <Button
                    size="sm"
                    variant={active ? "default" : "outline"}
                    disabled={disabled && !isAdminUI}
                    onClick={() => setSelectedId(p.id)}
                    className="h-8"
                  >
                    {p.name}
                    {disabled && (
                      <Badge variant="secondary" className="ml-2 text-[10px] h-4 px-1.5">
                        неактивен
                      </Badge>
                    )}
                  </Button>
                </HelpTooltip>
              );
            })
          )}

          {isAdminUI && selectedPackage && (
            <div className="ml-auto">
              <DropdownMenu>
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          aria-label="Действия с пакетом документов"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="left">
                      Действия с выбранным пакетом документов
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem onSelect={() => openEdit(selectedPackage)}>
                    <Pencil className="h-3.5 w-3.5 mr-2" /> Редактировать пакет
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      handleToggleActive(selectedPackage, !selectedPackage.is_active)
                    }
                  >
                    {selectedPackage.is_active ? (
                      <>
                        <PowerOff className="h-3.5 w-3.5 mr-2" /> Деактивировать
                      </>
                    ) : (
                      <>
                        <Power className="h-3.5 w-3.5 mr-2" /> Активировать
                      </>
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    disabled={deleting}
                    onSelect={(e) => {
                      e.preventDefault();
                      setDeleteOpen(true);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-2" /> Удалить
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>

        {selectedPackage?.description && (
          <p className="text-[11px] text-muted-foreground pl-1">
            {selectedPackage.description}
          </p>
        )}
      </GlassCard>


      {/* Подвкладки пакета */}
      {selectedPackage ? (
        <Tabs value={tab} onValueChange={setTab} className="space-y-3">
          <TabsList className="flex-wrap h-auto">
            {isAdminUI && (
              <HelpTooltip helpKey="" customShort="Какие шаблоны входят в этот пакет. Здесь же привязка новых." alwaysShow>
                <TabsTrigger value="templates">
                  <FileText className="h-3.5 w-3.5 mr-1.5" /> Шаблоны пакета
                </TabsTrigger>
              </HelpTooltip>
            )}
            <HelpTooltip helpKey="" customShort="Какие данные нужно заполнить для каждого документа пакета." alwaysShow>
              <TabsTrigger value="anketa">
                <ClipboardList className="h-3.5 w-3.5 mr-1.5" /> Анкеты документов
              </TabsTrigger>
            </HelpTooltip>
            {isAdminUI && (
              <HelpTooltip helpKey="" customShort="Роли и кастомные поля, которые встречаются в шаблонах пакета." alwaysShow>
                <TabsTrigger value="roles">
                  <Users className="h-3.5 w-3.5 mr-1.5" /> Роли и поля пакета
                </TabsTrigger>
              </HelpTooltip>
            )}
            {isAdminUI && (
              <HelpTooltip helpKey="" customShort="Безопасная проверка: ищет плейсхолдеры и нехватку данных. Документы не создаёт." alwaysShow>
                <TabsTrigger value="validation">
                  <ShieldCheck className="h-3.5 w-3.5 mr-1.5" /> Проверка шаблонов
                </TabsTrigger>
              </HelpTooltip>
            )}
            <HelpTooltip helpKey="" customShort="Запуск формирования документов пакета по выбранным данным." alwaysShow>
              <TabsTrigger value="generation">
                <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Генерация
              </TabsTrigger>
            </HelpTooltip>
          </TabsList>

          {isAdminUI && (
            <TabsContent value="templates">
              <TemplateBindingControl packageTemplateId={selectedPackage.id} />
            </TabsContent>
          )}

          <TabsContent value="anketa">
            <DocumentPackageQuestionnairesView
              packageTemplateId={selectedPackage.id}
              packageName={selectedPackage.name}
            />
          </TabsContent>

          {isAdminUI && (
            <TabsContent value="roles" className="space-y-4">
              <PackageRolesManager packageTemplateId={selectedPackage.id} />
              <PackageFieldsManager packageTemplateId={selectedPackage.id} />
            </TabsContent>
          )}

          {isAdminUI && (
            <TabsContent value="validation">
              <PackageTemplateValidationPanel packageTemplateId={selectedPackage.id} />
            </TabsContent>
          )}

          <TabsContent value="generation">
            <PackageGenerationPanel
              packageCode={selectedPackage.code}
              packageName={selectedPackage.name}
            />
          </TabsContent>
        </Tabs>
      ) : (
        <GlassCard className="p-6 text-center text-sm text-muted-foreground">
          {isAdminUI
            ? "Нет доступных пакетов. Создайте новый через кнопку «Новый пакет»."
            : "Нет доступных пакетов. Обратитесь к администратору."}
        </GlassCard>
      )}

      {isAdminUI && (
        <>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editing ? "Редактировать пакет" : "Новый пакет документов"}
                </DialogTitle>
                <DialogDescription>
                  Глобальный пакет, доступный для выдачи всем клиентам. Идентифицируется UUID —
                  переименование не ломает доступ.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Название</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Напр.: Идеология"
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Описание (необязательно)</Label>
                  <Textarea
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Краткое описание пакета"
                    rows={3}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="pkg-active-form"
                    checked={form.is_active}
                    onCheckedChange={(v) => setForm({ ...form, is_active: Boolean(v) })}
                  />
                  <Label htmlFor="pkg-active-form" className="text-xs cursor-pointer">
                    Активен
                  </Label>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
                  Отмена
                </Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? "Сохранение…" : editing ? "Сохранить" : "Создать"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Удалить пакет «{selectedPackage?.name}»?</AlertDialogTitle>
                <AlertDialogDescription>
                  Удаление выполняется только если пакет нигде не используется
                  (шаблоны, сессии, правила доступа). Иначе удаление будет заблокировано —
                  в этом случае деактивируйте пакет.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleting}>Отмена</AlertDialogCancel>
                <AlertDialogAction
                  disabled={deleting}
                  onClick={(e) => {
                    e.preventDefault();
                    if (selectedPackage) handleDelete(selectedPackage);
                  }}
                >
                  {deleting ? "Удаление…" : "Удалить"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}
