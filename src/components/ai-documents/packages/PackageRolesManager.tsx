/**
 * PackageRolesManager — Sprint 3F Phase 2.
 *
 * Admin CRUD per-package для `document_package_role_catalog`.
 *  • Один token-формат для роли в Word: `{{package.role.PKR-XXXXXX}}`.
 *  • PKR (public_id) — стабильный ID, неизменяемый после создания (защищено триггером БД).
 *  • Системные роли (is_system=true): нельзя удалить, нельзя менять public_id / role_key
 *    (защищено триггером БД); UI не показывает кнопку удаления и поле role_key для них.
 *  • Удаление любой роли — только soft archive (is_active=false). Hard delete заблокирован.
 *  • Output_template управляет ВЫВОДОМ в документе: `{{full_name}} / {{short_name}} / {{position}}`.
 *    NULL → дефолт «{{position}}, {{full_name}}» в резолвере.
 */
import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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

const DEFAULT_OUTPUT_HINT =
  "Доступные переменные: {{full_name}}, {{short_name}}, {{position}}. Пусто → «{{position}}, {{full_name}}».";

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
            Один placeholder на роль: <code className="text-[11px]">{`{{package.role.PKR-XXXXXX}}`}</code>.
            Вывод управляется полем «Как выводить в документе».
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
                <div className="flex items-center gap-1.5">
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
                          Нельзя удалить, нельзя менять public_id и role_key.
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-1 truncate font-mono">
                  {r.role_key}
                </div>
              </div>
              <div className="col-span-5 min-w-0">
                <div className="font-medium truncate">{r.label}</div>
                {r.description && (
                  <div className="text-xs text-muted-foreground mt-0.5 truncate">
                    {r.description}
                  </div>
                )}
                {r.output_template && (
                  <div className="text-[11px] text-muted-foreground mt-1">
                    Вывод: <code className="font-mono">{r.output_template}</code>
                  </div>
                )}
              </div>
              <div className="col-span-2 text-xs text-muted-foreground space-y-0.5">
                <div>порядок: {r.sort_order}</div>
                <div>
                  {r.required ? "обязательна" : "опциональна"}
                  {r.min_count != null || r.max_count != null
                    ? ` · ${r.min_count ?? 0}–${r.max_count ?? "∞"}`
                    : ""}
                </div>
                {!r.is_active && (
                  <Badge variant="outline" className="h-4 text-[10px]">архивирована</Badge>
                )}
              </div>
              <div className="col-span-2 flex justify-end gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => copyToken(r.public_id)}
                  title="Скопировать placeholder"
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
                    <Button size="icon" variant="ghost" disabled title="Системную роль архивировать осторожно">
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
            Роль будет помечена неактивной (is_active=false). Существующие участники не пострадают,
            но новые участники с этой ролью не смогут быть назначены через анкету. Hard delete заблокирован
            политикой — placeholder {`{{package.role.${role.public_id}}}`} в старых DOCX продолжит
            давать понятный warning, а не молчаливую ошибку.
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

function CreateRoleDialog({
  open, onOpenChange, creating, onCreate,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  creating: boolean;
  onCreate: (input: {
    label: string;
    description?: string | null;
    required?: boolean;
    sort_order?: number;
    output_template?: string | null;
  }) => void;
}) {
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [outputTemplate, setOutputTemplate] = useState("");
  const [required, setRequired] = useState(false);
  const [sortOrder, setSortOrder] = useState(100);

  function reset() {
    setLabel(""); setDescription(""); setOutputTemplate(""); setRequired(false); setSortOrder(100);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Новая роль пакета</DialogTitle>
          <DialogDescription>
            PKR-код будет назначен автоматически и не будет меняться при переименовании роли.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Название роли *</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Например: Ответственный за подготовку"
              autoFocus
            />
          </div>
          <div>
            <Label>Описание</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Кто это и зачем — для администратора"
              rows={2}
            />
          </div>
          <div>
            <Label>Как выводить в документе (output_template)</Label>
            <Input
              value={outputTemplate}
              onChange={(e) => setOutputTemplate(e.target.value)}
              placeholder="Например: {{position}}, {{full_name}}"
            />
            <p className="text-[11px] text-muted-foreground mt-1">{DEFAULT_OUTPUT_HINT}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center justify-between gap-3 border border-border/40 rounded-md px-3 py-2">
              <Label className="text-sm">Обязательна</Label>
              <Switch checked={required} onCheckedChange={setRequired} />
            </div>
            <div>
              <Label className="text-sm">Сортировка</Label>
              <Input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value) || 0)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button
            disabled={!label.trim() || creating}
            onClick={() => onCreate({
              label: label.trim(),
              description: description.trim() || null,
              required,
              sort_order: sortOrder,
              output_template: outputTemplate.trim() || null,
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
    required?: boolean;
    sort_order?: number;
    output_template?: string | null;
    min_count?: number | null;
    max_count?: number | null;
  }) => void;
}) {
  const [label, setLabel] = useState(row?.label ?? "");
  const [description, setDescription] = useState(row?.description ?? "");
  const [outputTemplate, setOutputTemplate] = useState(row?.output_template ?? "");
  const [required, setRequired] = useState(row?.required ?? false);
  const [sortOrder, setSortOrder] = useState(row?.sort_order ?? 100);
  const [minCount, setMinCount] = useState<string>(row?.min_count?.toString() ?? "");
  const [maxCount, setMaxCount] = useState<string>(row?.max_count?.toString() ?? "");

  useEffect(() => {
    if (row) {
      setLabel(row.label ?? "");
      setDescription(row.description ?? "");
      setOutputTemplate(row.output_template ?? "");
      setRequired(row.required ?? false);
      setSortOrder(row.sort_order ?? 100);
      setMinCount(row.min_count?.toString() ?? "");
      setMaxCount(row.max_count?.toString() ?? "");
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
            {row.is_system
              ? "Системная роль. role_key и public_id защищены триггером БД и не меняются."
              : "Custom-роль. public_id зафиксирован при создании и не меняется."}
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
          <div>
            <Label>Как выводить в документе (output_template)</Label>
            <Input
              value={outputTemplate ?? ""}
              onChange={(e) => setOutputTemplate(e.target.value)}
              placeholder="{{position}}, {{full_name}}"
            />
            <p className="text-[11px] text-muted-foreground mt-1">{DEFAULT_OUTPUT_HINT}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center justify-between gap-3 border border-border/40 rounded-md px-3 py-2">
              <Label className="text-sm">Обязательна</Label>
              <Switch checked={required} onCheckedChange={setRequired} />
            </div>
            <div>
              <Label className="text-sm">Сортировка</Label>
              <Input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value) || 0)}
              />
            </div>
            <div>
              <Label className="text-sm">min_count</Label>
              <Input
                type="number"
                value={minCount}
                onChange={(e) => setMinCount(e.target.value)}
                placeholder="—"
              />
            </div>
            <div>
              <Label className="text-sm">max_count</Label>
              <Input
                type="number"
                value={maxCount}
                onChange={(e) => setMaxCount(e.target.value)}
                placeholder="—"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button
            disabled={updating || !label.trim()}
            onClick={() => onSave({
              label: label.trim(),
              description: description?.trim() || null,
              output_template: outputTemplate?.trim() || null,
              required,
              sort_order: sortOrder,
              min_count: minCount.trim() === "" ? null : Number(minCount),
              max_count: maxCount.trim() === "" ? null : Number(maxCount),
            })}
          >
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
