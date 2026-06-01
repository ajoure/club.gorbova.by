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
import { useState, useEffect, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Copy, Plus, Pencil, Archive, RotateCcw, Lock, Shield, ChevronDown, ChevronRight, Search } from "lucide-react";
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
  const [tab, setTab] = useState<"active" | "archive">("active");
  const [systemOpen, setSystemOpen] = useState(false);
  const [search, setSearch] = useState("");

  const { activeRoles, archivedRoles, systemRoles } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = (r: PackageRoleRow) =>
      !q ||
      r.label.toLowerCase().includes(q) ||
      r.public_id.toLowerCase().includes(q) ||
      (r.description ?? "").toLowerCase().includes(q);
    return {
      activeRoles: roles.filter((r) => !r.is_system && r.is_active).filter(matches),
      archivedRoles: roles.filter((r) => !r.is_system && !r.is_active).filter(matches),
      systemRoles: roles.filter((r) => r.is_system),
    };
  }, [roles, search]);

  if (!packageTemplateId) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        Выберите пакет, чтобы управлять его ролями.
      </Card>
    );
  }

  function copyToken(publicId: string) {
    // Sprint 3H canon: Word-friendly token {{ln-XXXXXX}}.
    const token = `{{${publicId}}}`;
    navigator.clipboard.writeText(token);
    toast.success(`Скопировано: ${token}`);
  }

  const renderRow = (r: PackageRoleRow, opts: { showArchive?: boolean; showRestore?: boolean; readonly?: boolean }) => (
    <div
      key={r.id}
      className={`p-3 grid grid-cols-12 gap-3 items-center text-sm ${r.is_active ? "" : "opacity-60"}`}
    >
      <div className="col-span-3 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <code className="text-[11px] font-mono bg-muted px-1.5 py-0.5 rounded">{r.public_id}</code>
          {r.is_system && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="secondary" className="h-5 gap-1 text-[10px]">
                    <Shield className="h-3 w-3" /> Системная
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  Системную роль нельзя удалить и переименовать — она нужна для работы пакета.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>
      <div className="col-span-7 min-w-0">
        <div className="font-medium truncate">{r.label}</div>
        {r.description && (
          <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{r.description}</div>
        )}
      </div>
      <div className="col-span-2 flex justify-end gap-1">
        <Button size="icon" variant="ghost" onClick={() => copyToken(r.public_id)} title="Скопировать плейсхолдер">
          <Copy className="h-3.5 w-3.5" />
        </Button>
        {!opts.readonly && (
          <Button size="icon" variant="ghost" onClick={() => setEditRow(r)} title="Редактировать">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
        {opts.showArchive && <ArchiveButton role={r} onArchive={() => archive(r.id)} />}
        {opts.showRestore && (
          <Button size="icon" variant="ghost" onClick={() => restore(r.id)} title="Восстановить">
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        )}
        {opts.readonly && (
          <Button size="icon" variant="ghost" disabled title="Системную роль нельзя архивировать">
            <Lock className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-semibold text-sm">Роли пакета</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Список ролей, которые встречаются в шаблонах пакета (например,
            «Руководитель», «Ответственный»). В анкете документа на каждую роль
            назначается конкретный человек.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)} disabled={creating}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Добавить роль
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tab === "active" ? "Поиск по активным…" : "Поиск по архиву…"}
          className="h-8 pl-7 text-xs"
        />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "active" | "archive")}>
        <TabsList className="h-8">
          <TabsTrigger value="active" className="text-xs">
            Активные <Badge variant="secondary" className="ml-1.5 h-4 text-[10px]">{activeRoles.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="archive" className="text-xs">
            Архив <Badge variant="secondary" className="ml-1.5 h-4 text-[10px]">{archivedRoles.length}</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-3">
          {isLoading ? (
            <div className="text-sm text-muted-foreground py-6 text-center">Загрузка…</div>
          ) : activeRoles.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center space-y-2">
              <p>Ролей пока нет.</p>
              <p className="text-xs">
                Добавьте первую роль — её можно будет указывать в шаблонах и
                назначать на неё конкретного человека в анкете документа.
              </p>
            </div>
          ) : (
            <div className="rounded-md border border-border/40 divide-y divide-border/40">
              {activeRoles.map((r) => renderRow(r, { showArchive: true }))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="archive" className="mt-3">
          {isLoading ? (
            <div className="text-sm text-muted-foreground py-6 text-center">Загрузка…</div>
          ) : archivedRoles.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">
              Архив пуст.
            </div>
          ) : (
            <div className="rounded-md border border-border/40 divide-y divide-border/40">
              {archivedRoles.map((r) => renderRow(r, { showRestore: true }))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {systemRoles.length > 0 && (
        <Collapsible open={systemOpen} onOpenChange={setSystemOpen} className="border rounded-md">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium hover:bg-accent/40"
            >
              <span className="flex items-center gap-1.5">
                {systemOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                <Shield className="h-3.5 w-3.5" />
                Системные роли
                <Badge variant="secondary" className="ml-1 h-4 text-[10px]">{systemRoles.length}</Badge>
              </span>
              <span className="text-[10px] text-muted-foreground">только просмотр</span>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="border-t divide-y divide-border/40">
              {systemRoles.map((r) => renderRow(r, { readonly: true }))}
            </div>
          </CollapsibleContent>
        </Collapsible>
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
            Роль станет неактивной: уже сделанные назначения сохранятся, но
            новых людей с этой ролью назначить будет нельзя. Полное удаление
            не предусмотрено — ранее созданные документы должны продолжать работать.
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
            Укажите понятное название роли (например, «Ответственный за идеологическую работу»).
            Внутренний код за ролью закрепится автоматически, чтобы уже настроенные
            шаблоны продолжали работать.
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
            Меняйте название и описание свободно — внутренний код роли
            остаётся прежним, поэтому уже настроенные шаблоны продолжат работать.
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
