/**
 * PackageRolesManager — Sprint 3F Phase 2c (UX simplified).
 *
 *  • Один token-формат для роли в Word: `{{package.role.PKR-XXXXXX}}`.
 *  • PKR (public_id) — стабильный ID, неизменяемый после создания (защищено триггером БД).
 *  • Системные роли (is_system=true): нельзя удалить, нельзя менять public_id / role_key.
 *  • Удаление любой роли — только soft archive (is_active=false).
 *
 * Sprint 3F Phase 2c: форма роли сведена к минимуму — только название и описание.
 * Поля required / min_count / max_count / sort_order / output_template / role_key
 * скрыты из UI: они либо имеют разумные дефолты, либо технические и не нужны
 * администратору. Любая роль multi-assignable: одну роль можно назначить
 * нескольким физлицам в анкете пакета. Формат вывода в DOCX определяется
 * дефолтом резолвера («должность + ФИО») и подключается в Sprint 3G.
 */
import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Copy, Plus, Pencil, Archive, RotateCcw, Lock, Shield } from "lucide-react";
import { toast } from "sonner";
import {
  usePackageRoleCatalog,
  type PackageRoleRow,
} from "@/hooks/usePackageRoleCatalog";

interface Props {
  packageTemplateId: string | null;
}

export function PackageRolesManager({ packageTemplateId }: Props) {
  const { roles, isLoading, create, creating, update, updating, archive, restore } =
    usePackageRoleCatalog(packageTemplateId);

  const [createOpen, setCreateOpen] = useState(false);
  const [editRow, setEditRow] = useState<PackageRoleRow | null>(null);

  if (!packageTemplateId) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        Выберите пакет, чтобы управлять его ролями.
      </Card>
    );
  }

  function copyToken(publicId: string) {
    const token = `{{package.role.${publicId}}}`;
    navigator.clipboard.writeText(token);
    toast.success(`Скопировано: ${token}`);
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">Роли пакета</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Один плейсхолдер на роль: <code className="text-[11px]">{`{{package.role.PKR-XXXXXX}}`}</code>.
            Одну роль можно назначить нескольким физлицам в анкете пакета.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)} disabled={creating}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Добавить роль
        </Button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground py-6 text-center">Загрузка…</div>
      ) : roles.length === 0 ? (
        <div className="text-sm text-muted-foreground py-6 text-center">
          В пакете ещё нет ролей.
        </div>
      ) : (
        <div className="rounded-md border border-border/40 divide-y divide-border/40">
          {roles.map((r) => (
            <div
              key={r.id}
              className={`p-3 grid grid-cols-12 gap-3 items-center text-sm ${r.is_active ? "" : "opacity-60"}`}
            >
              <div className="col-span-3 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <code className="text-[11px] font-mono bg-muted px-1.5 py-0.5 rounded">
                    {r.public_id}
                  </code>
                  {r.is_system && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="secondary" className="h-5 gap-1 text-[10px]">
                            <Shield className="h-3 w-3" /> Системная
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          Системные роли нельзя удалить и переименовать (защищено триггером БД).
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  {!r.is_active && (
                    <Badge variant="outline" className="h-5 text-[10px]">архив</Badge>
                  )}
                </div>
              </div>
              <div className="col-span-7 min-w-0">
                <div className="font-medium truncate">{r.label}</div>
                {r.description && (
                  <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                    {r.description}
                  </div>
                )}
              </div>
              <div className="col-span-2 flex justify-end gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => copyToken(r.public_id)}
                  title="Скопировать плейсхолдер"
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setEditRow(r)}
                  title="Редактировать"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                {r.is_active ? (
                  r.is_system ? (
                    <Button size="icon" variant="ghost" disabled title="Системную роль нельзя архивировать">
                      <Lock className="h-3.5 w-3.5" />
                    </Button>
                  ) : (
                    <ArchiveButton role={r} onArchive={() => archive(r.id)} />
                  )
                ) : (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => restore(r.id)}
                    title="Восстановить"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <CreateRoleDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        creating={creating}
        onCreate={(input) =>
          create(
            { ...input, package_template_id: packageTemplateId },
            { onSuccess: () => setCreateOpen(false) },
          )
        }
      />

      <EditRoleDialog
        row={editRow}
        onOpenChange={(o) => !o && setEditRow(null)}
        updating={updating}
        onSave={(patch) =>
          editRow &&
          update(
            { id: editRow.id, ...patch },
            { onSuccess: () => setEditRow(null) },
          )
        }
      />
    </Card>
  );
}

function ArchiveButton({ role, onArchive }: { role: PackageRoleRow; onArchive: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="icon" variant="ghost" title="Архивировать">
          <Archive className="h-3.5 w-3.5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Архивировать роль «{role.label}»?</AlertDialogTitle>
          <AlertDialogDescription>
            Роль будет помечена неактивной. Существующие назначения сохранятся,
            но новых физлиц с этой ролью назначить нельзя. Удалить роль навсегда
            нельзя по архитектурному правилу — плейсхолдер
            {` {{package.role.${role.public_id}}}`} в старых DOCX продолжит работать.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction onClick={onArchive}>Архивировать</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export interface CreateRoleSimpleInput {
  label: string;
  description?: string | null;
}

/**
 * Sprint 3F Phase 2c: предельно простая форма — только название и описание.
 * Экспортируется, чтобы переиспользовать в inline-сценарии «+ Добавить роль»
 * прямо из dropdown анкеты пакета.
 */
export function CreateRoleDialog({
  open, onOpenChange, creating, onCreate, title,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  creating: boolean;
  onCreate: (input: CreateRoleSimpleInput) => void;
  title?: string;
}) {
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");

  function reset() {
    setLabel(""); setDescription("");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title ?? "Новая роль пакета"}</DialogTitle>
          <DialogDescription>
            Система автоматически присвоит роли код PKR-XXXXXX. Он не меняется
            при переименовании роли, поэтому шаблоны с этим плейсхолдером
            продолжат работать.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Название роли *</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Например: Ответственный за идеологическую работу"
              autoFocus
            />
          </div>
          <div>
            <Label>Описание</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Краткое пояснение — необязательно"
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button
            disabled={!label.trim() || creating}
            onClick={() => onCreate({
              label: label.trim(),
              description: description.trim() || null,
            })}
          >
            Создать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditRoleDialog({
  row, onOpenChange, updating, onSave,
}: {
  row: PackageRoleRow | null;
  onOpenChange: (o: boolean) => void;
  updating: boolean;
  onSave: (patch: {
    label?: string;
    description?: string | null;
  }) => void;
}) {
  const [label, setLabel] = useState(row?.label ?? "");
  const [description, setDescription] = useState(row?.description ?? "");

  useEffect(() => {
    if (row) {
      setLabel(row.label ?? "");
      setDescription(row.description ?? "");
    }
  }, [row]);

  if (!row) return null;
  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Редактирование роли · <span className="font-mono text-sm">{row.public_id}</span>
          </DialogTitle>
          <DialogDescription>
            Плейсхолдер роли: <code>{`{{package.role.${row.public_id}}}`}</code>.
            Код PKR не меняется и не зависит от названия.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Название роли</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div>
            <Label>Описание</Label>
            <Textarea
              value={description ?? ""}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button
            disabled={updating || !label.trim()}
            onClick={() => onSave({
              label: label.trim(),
              description: description?.trim() || null,
            })}
          >
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
