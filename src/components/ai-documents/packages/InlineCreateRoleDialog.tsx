/**
 * InlineCreateRoleDialog — Sprint 3F Phase 2c.
 *
 * Быстрое inline-создание новой роли пакета прямо из анкеты
 * (dropdown «Роль участника»). Открывается только под admin/super_admin
 * (вызывающий компонент проверяет RBAC).
 *
 * Контракт:
 *  • Создание идёт через `usePackageRoleCatalog.create` → INSERT в
 *    `document_package_role_catalog`. `public_id` (PKR-XXXXXX) и
 *    уникальный `role_key` назначаются автоматически (BEFORE INSERT trigger
 *    + slugify в хуке).
 *  • Никаких «технических» полей в форме: только Название и Описание.
 *    `is_system=false`, `is_active=true`, `allowed_entity_types=["person"]`.
 *  • После успешного INSERT инвалидируется и каталог анкеты
 *    (`doc-package-role-catalog`), и админский (`package-role-catalog`),
 *    чтобы новая роль сразу появилась в выпадающем списке.
 *  • НИЧЕГО не генерируется, биллинговый резолвер не трогается.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { usePackageRoleCatalog } from "@/hooks/usePackageRoleCatalog";

interface Props {
  packageTemplateId: string;
  /** Опционально: вызывается после создания, чтобы parent мог выбрать новую роль. */
  onCreated?: (roleKey: string) => void;
}

export function InlineCreateRoleDialog({ packageTemplateId, onCreated }: Props) {
  const qc = useQueryClient();
  const { create, creating } = usePackageRoleCatalog(packageTemplateId);
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");

  const submit = () => {
    const trimmed = label.trim();
    if (!trimmed) return;
    create(
      {
        package_template_id: packageTemplateId,
        label: trimmed,
        description: description.trim() || null,
        allowed_entity_types: ["person"],
        required: false,
      },
      {
        onSuccess: (row) => {
          // Refresh обоих query-ключей: админского и анкетного.
          qc.invalidateQueries({ queryKey: ["package-role-catalog", packageTemplateId] });
          qc.invalidateQueries({ queryKey: ["doc-package-role-catalog", packageTemplateId] });
          setLabel("");
          setDescription("");
          setOpen(false);
          onCreated?.(row.role_key);
        },
      },
    );
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-[11px] w-full justify-start text-indigo-600 hover:text-indigo-700"
        onMouseDown={(e) => {
          // Не даём Select закрыться/выбрать значение до открытия диалога.
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Plus className="h-3 w-3 mr-1" /> Создать новую роль…
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Новая роль пакета</DialogTitle>
            <DialogDescription className="text-xs">
              Технический ключ и PKR-идентификатор будут присвоены автоматически.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="pkr-role-name" className="text-xs">Название</Label>
              <Input
                id="pkr-role-name"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Например: Главный бухгалтер"
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pkr-role-desc" className="text-xs">
                Описание <span className="text-muted-foreground">(необязательно)</span>
              </Label>
              <Textarea
                id="pkr-role-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Кратко: кто это и зачем нужен в пакете"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={creating}>
              Отмена
            </Button>
            <Button size="sm" onClick={submit} disabled={creating || !label.trim()}>
              {creating ? "Создание…" : "Создать роль"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
