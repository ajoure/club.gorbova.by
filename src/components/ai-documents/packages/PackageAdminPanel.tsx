/**
 * PackageAdminPanel — Sprint 3F Phase 2b + Sprint 3S v2 (CRUD без slug/code).
 *
 * Admin-only композитная панель для пакетов документов:
 *  0) CRUD глобальных пакетов (Sprint 3S v2): только Название/Описание/Активен; UUID = единственный ID.
 *  1) выбор пакета;
 *  2) per-package CRUD ролей (PackageRolesManager);
 *  3) привязка шаблонов через RPC (TemplateBindingControl);
 *  4) read-only контролируемая валидация DOCX (PackageTemplateValidationPanel).
 *
 * Никаких прямых INSERT/UPDATE/DELETE в `document_package_template_items`,
 * `document_templates.template_scope`, `document_package_role_catalog.public_id`.
 * Никаких slug/code/транслитерации названия пакета. Связи доступа работают только через UUID.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FileStack, Shield, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PackageRolesManager } from "./PackageRolesManager";
import { TemplateBindingControl } from "./TemplateBindingControl";
import { PackageTemplateValidationPanel } from "./PackageTemplateValidationPanel";

interface PackageRow {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  profile_id: string | null;
}

// Audit is enforced server-side by the CRUD RPCs (create_global_document_package,
// update_global_document_package, deactivate_global_document_package, safe_delete_document_package).
// UI must NOT perform direct insert/update/delete on `document_package_templates` for global packages.

export function PackageAdminPanel() {
  const queryClient = useQueryClient();
  const [packageId, setPackageId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PackageRow | null>(null);
  const [form, setForm] = useState({ name: "", description: "", is_active: true });
  const [saving, setSaving] = useState(false);

  const packagesQuery = useQuery({
    queryKey: ["pkg-admin-packages"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_package_templates")
        .select("id, name, description, is_active, profile_id")
        .is("profile_id", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PackageRow[];
    },
  });

  useEffect(() => {
    if (!packageId && packagesQuery.data && packagesQuery.data.length > 0) {
      setPackageId(packagesQuery.data[0].id);
    }
  }, [packageId, packagesQuery.data]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", description: "", is_active: true });
    setDialogOpen(true);
  };

  const openEdit = (pkg: PackageRow) => {
    setEditing(pkg);
    setForm({ name: pkg.name, description: pkg.description ?? "", is_active: pkg.is_active });
    setDialogOpen(true);
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
        if (res?.status !== "created" || !res.package_id) throw new Error(`create failed: ${res?.status}`);
        toast.success("Пакет создан");
        setPackageId(res.package_id);
      }
      await queryClient.invalidateQueries({ queryKey: ["pkg-admin-packages"] });
      await queryClient.invalidateQueries({ queryKey: ["workspace-package-templates"] });
      await queryClient.invalidateQueries({ queryKey: ["access-rule-document-packages"] });
      setDialogOpen(false);
    } catch (e: any) {
      toast.error(`Не удалось сохранить пакет: ${e?.message ?? e}`);
    } finally {
      setSaving(false);
    }
  };

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const handleDelete = async (pkg: PackageRow) => {
    setDeleting(true);
    try {
      const { data, error } = await supabase.rpc("safe_delete_document_package", {
        _package_id: pkg.id,
      });
      if (error) throw error;
      const res = data as { status: string; reason?: string; dependencies?: Record<string, number>; suggestion?: string };
      if (res.status === "deleted") {
        toast.success("Пакет удалён");
        setPackageId(null);
        await queryClient.invalidateQueries({ queryKey: ["pkg-admin-packages"] });
        await queryClient.invalidateQueries({ queryKey: ["workspace-package-templates"] });
        await queryClient.invalidateQueries({ queryKey: ["access-rule-document-packages"] });
      } else if (res.status === "blocked") {
        const d = res.dependencies ?? {};
        toast.error(
          `Удалить нельзя: используется (шаблонов: ${d.items ?? 0}, сессий: ${d.sessions ?? 0}, правил доступа: ${d.access_rules ?? 0}). Деактивируйте пакет вместо удаления.`,
          { duration: 8000 }
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

  const selectedPackage = packagesQuery.data?.find(p => p.id === packageId) ?? null;



  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-md bg-emerald-50 flex items-center justify-center shrink-0">
          <FileStack className="h-5 w-5 text-emerald-500" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            Пакеты документов — администрирование
            <Badge variant="outline" className="text-[10px] h-4 px-1.5">
              <Shield className="h-3 w-3 mr-1" /> admin only
            </Badge>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            CRUD глобальных пакетов, per-package роли, привязка шаблонов и read-only валидация.
            Доступ к пакетам у клиентов настраивается в «Правилах доступа» продукта по UUID.
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1.5" /> Новый пакет
        </Button>
      </div>

      <Card className="p-3 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground shrink-0">Пакет:</span>
          <Select value={packageId ?? ""} onValueChange={(v) => setPackageId(v || null)}>
            <SelectTrigger className="flex-1 max-w-md">
              <SelectValue placeholder="Выберите пакет…" />
            </SelectTrigger>
            <SelectContent>
              {(packagesQuery.data ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                  {!p.is_active && (
                    <span className="ml-2 text-[10px] text-muted-foreground">(неактивен)</span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedPackage && (
            <>
              <Button size="sm" variant="outline" onClick={() => openEdit(selectedPackage)}>
                <Pencil className="h-3.5 w-3.5 mr-1" /> Редактировать
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => setDeleteOpen(true)}
                disabled={deleting}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" /> Удалить
              </Button>
            </>
          )}
        </div>
        {selectedPackage?.description && (
          <p className="text-[11px] text-muted-foreground pl-1">{selectedPackage.description}</p>
        )}
      </Card>

      <PackageRolesManager packageTemplateId={packageId} />
      <TemplateBindingControl packageTemplateId={packageId} />
      <PackageTemplateValidationPanel packageTemplateId={packageId} />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Редактировать пакет" : "Новый пакет документов"}</DialogTitle>
            <DialogDescription>
              Глобальный пакет, доступный для выдачи всем клиентам. Идентифицируется UUID — переименование не ломает доступ.
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
                id="pkg-active"
                checked={form.is_active}
                onCheckedChange={(v) => setForm({ ...form, is_active: Boolean(v) })}
              />
              <Label htmlFor="pkg-active" className="text-xs cursor-pointer">Активен</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Отмена</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Сохранение…" : (editing ? "Сохранить" : "Создать")}
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
              onClick={(e) => { e.preventDefault(); if (selectedPackage) handleDelete(selectedPackage); }}
            >
              {deleting ? "Удаление…" : "Удалить"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

