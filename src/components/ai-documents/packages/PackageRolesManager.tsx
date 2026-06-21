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
import { Copy, Plus, Pencil, Archive, RotateCcw, Lock, Shield, ChevronDown, ChevronRight, Search, IdCard } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  usePackageRoleCatalog,
  type PackageRoleRow,
} from "@/hooks/usePackageRoleCatalog";
import {
  readAssignmentCustomFieldDefs,
  validateCustomFieldKey,
  type AssignmentCustomFieldDef,
} from "@/lib/documents/assignmentCustomFieldsSpec";
import { Trash2 } from "lucide-react";

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
          {Boolean((r.metadata as Record<string, unknown> | null | undefined)?.["enable_person_subfields"]) && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="h-5 gap-1 text-[10px]">
                    <IdCard className="h-3 w-3" /> реквизиты ФЛ
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  В каталоге плейсхолдеров для этой роли видны паспорт, адрес, дата рождения и другие данные физлица.
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
    metadata?: Record<string, unknown>;
  }) => void;
}) {
  const [label, setLabel] = useState(row?.label ?? "");
  const [description, setDescription] = useState(row?.description ?? "");
  const [enableSubfields, setEnableSubfields] = useState<boolean>(
    Boolean((row?.metadata as Record<string, unknown> | null | undefined)?.["enable_person_subfields"]),
  );
  const initialEnableSubfields = Boolean(
    (row?.metadata as Record<string, unknown> | null | undefined)?.["enable_person_subfields"],
  );

  // PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1 / Stage E.1a: custom assignment fields schema.
  const initialDefs = useMemo<AssignmentCustomFieldDef[]>(
    () => readAssignmentCustomFieldDefs(row?.metadata),
    [row?.metadata],
  );
  const [customDefs, setCustomDefs] = useState<AssignmentCustomFieldDef[]>(initialDefs);
  const [keyErrors, setKeyErrors] = useState<Record<number, string>>({});

  useEffect(() => {
    if (row) {
      setLabel(row.label ?? "");
      setDescription(row.description ?? "");
      setEnableSubfields(
        Boolean((row.metadata as Record<string, unknown> | null | undefined)?.["enable_person_subfields"]),
      );
      setCustomDefs(readAssignmentCustomFieldDefs(row.metadata));
      setKeyErrors({});
    }
  }, [row]);

  if (!row) return null;

  const addDef = () => {
    setCustomDefs((prev) => [
      ...prev,
      { key: "", label: "", type: "text", kind: "scalar_text" },
    ]);
  };
  const updateDef = (idx: number, patch: Partial<AssignmentCustomFieldDef>) => {
    setCustomDefs((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  };
  const removeDef = (idx: number) => {
    setCustomDefs((prev) => prev.filter((_, i) => i !== idx));
    setKeyErrors((prev) => {
      const next: Record<number, string> = {};
      Object.entries(prev).forEach(([k, v]) => {
        const ki = Number(k);
        if (ki < idx) next[ki] = v;
        else if (ki > idx) next[ki - 1] = v;
      });
      return next;
    });
  };

  const validateAll = (): boolean => {
    const errors: Record<number, string> = {};
    const seen = new Set<string>();
    customDefs.forEach((d, i) => {
      const key = d.key.trim();
      const label = d.label.trim();
      if (!key && !label) return; // пустая строка — игнор при save
      if (!key) {
        errors[i] = "Укажите технический ключ";
        return;
      }
      const v = validateCustomFieldKey(key);
      if (!v.ok) {
        errors[i] = v.code === "reserved" ? "Ключ зарезервирован" : "Только латиница, цифры, _, начало с буквы (≤50)";
        return;
      }
      if (seen.has(key)) {
        errors[i] = "Дублирующийся ключ";
        return;
      }
      seen.add(key);
      if (!label) errors[i] = "Укажите название";
    });
    setKeyErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = () => {
    if (!validateAll()) {
      toast.error("Исправьте ошибки в доп. полях роли");
      return;
    }
    // Соберём metadata-patch ТОЛЬКО из тех ключей, что реально меняются.
    // usePackageRoleCatalog re-читает текущий metadata и делает shallow merge —
    // чтобы не затереть прочие ключи (например, enable_person_subfields).
    const metaPatch: Record<string, unknown> = {};
    if (enableSubfields !== initialEnableSubfields) {
      metaPatch.enable_person_subfields = enableSubfields;
    }
    const cleanDefs = customDefs
      .map((d) => ({ ...d, key: d.key.trim(), label: d.label.trim() }))
      .filter((d) => d.key.length > 0 && d.label.length > 0);
    const defsChanged =
      cleanDefs.length !== initialDefs.length ||
      cleanDefs.some((d, i) =>
        !initialDefs[i] ||
        d.key !== initialDefs[i].key ||
        d.label !== initialDefs[i].label ||
        d.type !== initialDefs[i].type ||
        d.kind !== initialDefs[i].kind,
      );
    if (defsChanged) {
      // Storage: оставляем `type:'text'` для forward-compat, plus v1-kind alias.
      metaPatch.assignment_custom_fields = cleanDefs.map((d) => ({
        key: d.key,
        label: d.label,
        type: d.type ?? "text",
        kind: d.kind ?? "scalar_text",
      }));
    }
    const patch: {
      label?: string;
      description?: string | null;
      metadata?: Record<string, unknown>;
    } = {
      label: label.trim(),
      description: description?.trim() || null,
    };
    if (Object.keys(metaPatch).length > 0) patch.metadata = metaPatch;
    onSave(patch);
  };

  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Редактирование роли · <span className="font-mono text-sm">{row.public_id}</span>
          </DialogTitle>
          <DialogDescription>
            Меняйте название и описание свободно — внутренний код роли
            остаётся прежним, поэтому уже настроенные шаблоны продолжат работать.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 max-h-[70vh] overflow-y-auto">
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
          {/* PATCH-ROLE-SCOPED-PLACEHOLDERS-CATALOG-VISIBILITY-V1 */}
          <div className="rounded-md border p-3 space-y-2 bg-muted/30">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-sm">Расширенные данные физлица</Label>
                <p className="text-xs text-muted-foreground">
                  Показывать паспортные, адресные и личные данные для этой роли
                  в каталоге плейсхолдеров. Бэкенд продолжит резолвить
                  <code className="mx-1">{`{{${row.public_id}.<sub_field>}}`}</code>
                  даже если переключатель выключен — это управляет только
                  видимостью в каталоге.
                </p>
              </div>
              <Switch
                checked={enableSubfields}
                onCheckedChange={setEnableSubfields}
                aria-label="Показывать расширенные данные физлица"
              />
            </div>
          </div>

          {/* PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1 / Stage E.1a: custom fields schema */}
          <div className="rounded-md border p-3 space-y-3 bg-muted/30">
            <div className="space-y-1">
              <Label className="text-sm">Доп. поля назначения роли</Label>
              <p className="text-xs text-muted-foreground">
                Скалярные поля, которые администратор пакета заполняет на каждое
                назначение роли в анкете документа. Токен в Word:
                <code className="mx-1">{`{{${row.public_id}.custom.<key>}}`}</code>.
                Для обычного scalar-токена роль должна иметь ровно одно активное
                назначение — иначе при dry-run появится предупреждение.
                Реальная DOCX-подстановка появится в Stage E.4.
              </p>
            </div>
            {customDefs.length === 0 ? (
              <div className="text-xs text-muted-foreground italic">
                Доп. полей пока нет. Можно добавить, например, «Голоса» или «Доля».
              </div>
            ) : (
              <div className="space-y-2">
                {customDefs.map((d, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-start">
                    <div className="col-span-4">
                      <Input
                        value={d.key}
                        onChange={(e) => updateDef(i, { key: e.target.value })}
                        placeholder="ключ (votes)"
                        className="h-8 font-mono text-xs"
                      />
                    </div>
                    <div className="col-span-7">
                      <Input
                        value={d.label}
                        onChange={(e) => updateDef(i, { label: e.target.value })}
                        placeholder="Название (Голоса)"
                        className="h-8 text-xs"
                      />
                      {keyErrors[i] && (
                        <p className="text-[10px] text-destructive mt-0.5">{keyErrors[i]}</p>
                      )}
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => removeDef(i)}
                        aria-label="Удалить поле"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <Button size="sm" variant="outline" onClick={addDef} className="h-8">
              <Plus className="h-3.5 w-3.5 mr-1" /> Добавить доп. поле
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button
            disabled={updating || !label.trim()}
            onClick={handleSave}
          >
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
