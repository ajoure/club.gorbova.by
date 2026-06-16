/**
 * PackageFieldsManager — PATCH-PACKAGE-CUSTOM-FIELDS-V1.
 *
 * Управление каталогом `document_package_field_catalog` для одного пакета.
 * Канонический токен: `{{pf-XXXXXX}}`. Одно поле — одно значение на сессию —
 * используется во всех шаблонах пакета, где встречается соответствующий токен.
 *
 * Контракт:
 *  • data_type, field_key, public_id — immutable после создания (защита БД);
 *  • архивация через soft is_active=false; physical DELETE заблокирован, если
 *    есть assignments / session values (защита триггером);
 *  • для select/multiselect редактируется набор choices; value уже использованного
 *    choice менять запрещено (в UI блокируется на edit).
 */
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Copy, Plus, Pencil, Archive, RotateCcw, Search, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import {
  usePackageFieldCatalog,
  type PackageFieldRow,
  type PackageFieldDataType,
  type PackageFieldChoice,
  type SmartDateKind,
} from "@/hooks/usePackageFieldCatalog";
import { usePackageDetectedFields } from "@/hooks/usePackageDetectedFields";
import {
  SMART_DATE_KIND_LABELS,
  allowedSmartDateKindsForType,
  isSmartDateKindAllowedForType,
} from "@/lib/packageFields/smartDate";

interface Props {
  packageTemplateId: string | null;
}

const DATA_TYPE_LABELS: Record<PackageFieldDataType, string> = {
  text: "Текст",
  number: "Число",
  date: "Дата",
  datetime: "Дата и время",
  time: "Время",
  year: "Год",
  select: "Список (один)",
  multiselect: "Список (несколько)",
  checkbox: "Флажок (да/нет)",
};

export function PackageFieldsManager({ packageTemplateId }: Props) {
  const { fields, isLoading, upsert, upserting, archive, restore, remove, loadDependencyReport } =
    usePackageFieldCatalog(packageTemplateId);
  const { byPublicId } = usePackageDetectedFields(packageTemplateId);

  const [createOpen, setCreateOpen] = useState(false);
  const [editRow, setEditRow] = useState<PackageFieldRow | null>(null);
  const [tab, setTab] = useState<"active" | "archive">("active");
  const [search, setSearch] = useState("");

  // Сколько шаблонов содержит токен этого поля (по реальному DOCX, без assignments).
  const usageMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of fields) {
      const items = byPublicId[f.public_id] ?? [];
      if (items.length > 0) map.set(f.id, items.length);
    }
    return map;
  }, [fields, byPublicId]);

  const { activeFields, archivedFields } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = (r: PackageFieldRow) =>
      !q ||
      r.label.toLowerCase().includes(q) ||
      r.public_id.toLowerCase().includes(q) ||
      r.field_key.toLowerCase().includes(q) ||
      (r.description ?? "").toLowerCase().includes(q);
    return {
      activeFields: fields.filter((r) => r.is_active).filter(matches),
      archivedFields: fields.filter((r) => !r.is_active).filter(matches),
    };
  }, [fields, search]);

  if (!packageTemplateId) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        Выберите пакет, чтобы управлять его полями.
      </Card>
    );
  }

  function copyToken(publicId: string) {
    const token = `{{${publicId}}}`;
    navigator.clipboard.writeText(token);
    toast.success(`Скопировано: ${token}`);
  }

  const renderRow = (r: PackageFieldRow, opts: { showArchive?: boolean; showRestore?: boolean }) => {
    const usage = usageMap.get(r.id) ?? 0;
    return (
      <div
        key={r.id}
        className={`p-3 grid grid-cols-12 gap-3 items-center text-sm ${r.is_active ? "" : "opacity-60"}`}
      >
        <div className="col-span-3 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <code className="text-[11px] font-mono bg-muted px-1.5 py-0.5 rounded">{r.public_id}</code>
            <Badge variant="outline" className="h-5 text-[10px]">
              {DATA_TYPE_LABELS[r.data_type]}
            </Badge>
          </div>
        </div>
        <div className="col-span-5 min-w-0">
          <div className="font-medium truncate">{r.label}</div>
          {r.description && (
            <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{r.description}</div>
          )}
        </div>
        <div className="col-span-2 text-xs text-muted-foreground">
          {usage > 0 ? `В ${usage} шаблон(ах)` : "Не назначено"}
          {r.required && <Badge variant="secondary" className="ml-1 h-4 text-[10px]">Обязат.</Badge>}
        </div>
        <div className="col-span-2 flex justify-end gap-1">
          <Button size="icon" variant="ghost" onClick={() => copyToken(r.public_id)} title="Скопировать токен">
            <Copy className="h-3.5 w-3.5" />
          </Button>
          {r.is_active && (
            <Button
              size="icon"
              variant="ghost"
              onClick={() => assignToAll(r.id)}
              disabled={assigningToAll}
              title="Назначить во все шаблоны пакета"
            >
              <Layers className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button size="icon" variant="ghost" onClick={() => setEditRow(r)} title="Редактировать">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          {opts.showArchive && (
            <ArchiveButton
              field={r}
              loadReport={() => loadDependencyReport(r.id)}
              onArchive={() => archive(r.id)}
            />
          )}
          {opts.showRestore && (
            <Button size="icon" variant="ghost" onClick={() => restore(r.id)} title="Восстановить">
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          )}
          {!r.is_active && (
            <DeleteButton
              field={r}
              loadReport={() => loadDependencyReport(r.id)}
              onDelete={() => remove(r.id)}
            />
          )}
        </div>
      </div>
    );
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-semibold text-sm flex items-center gap-1.5">
            <Wand2 className="h-3.5 w-3.5" /> Поля пакета
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Дополнительные данные для документов пакета: даты, числа, выбираемые значения, флаги и т.&nbsp;п.
            Один токен {"{{pf-XXXXXX}}"} — одно значение на анкету — используется во всех шаблонах пакета,
            где он встречается.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)} disabled={upserting}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Добавить поле
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
            Активные <Badge variant="secondary" className="ml-1.5 h-4 text-[10px]">{activeFields.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="archive" className="text-xs">
            Архив <Badge variant="secondary" className="ml-1.5 h-4 text-[10px]">{archivedFields.length}</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-3">
          {isLoading ? (
            <div className="text-sm text-muted-foreground py-6 text-center">Загрузка…</div>
          ) : activeFields.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center space-y-2">
              <p>Полей пока нет.</p>
              <p className="text-xs">
                Добавьте первое поле — например, «Дата приказа». Его можно будет указать в анкете
                и использовать токеном {"{{pf-XXXXXX}}"} в любом DOCX-шаблоне пакета.
              </p>
            </div>
          ) : (
            <div className="rounded-md border border-border/40 divide-y divide-border/40">
              {activeFields.map((r) => renderRow(r, { showArchive: true }))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="archive" className="mt-3">
          {archivedFields.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">Архив пуст.</div>
          ) : (
            <div className="rounded-md border border-border/40 divide-y divide-border/40">
              {archivedFields.map((r) => renderRow(r, { showRestore: true }))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <FieldDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        loading={upserting}
        title="Новое поле пакета"
        onSubmit={(input) =>
          upsert(
            { ...input, package_template_id: packageTemplateId },
            { onSuccess: () => setCreateOpen(false) },
          )
        }
      />

      <FieldDialog
        open={!!editRow}
        onOpenChange={(o) => !o && setEditRow(null)}
        loading={upserting}
        title={editRow ? `Редактирование · ${editRow.public_id}` : ""}
        existing={editRow ?? undefined}
        onSubmit={(input) =>
          editRow &&
          upsert(
            { ...input, id: editRow.id, package_template_id: packageTemplateId, expected_version: editRow.version },
            { onSuccess: () => setEditRow(null) },
          )
        }
      />
    </Card>
  );
}

function ArchiveButton({
  field, loadReport, onArchive,
}: {
  field: PackageFieldRow;
  loadReport: () => Promise<{ templates_using_token: number; active_sessions_with_value: number; historical_sessions_with_value: number; generation_snapshots_count: number }>;
  onArchive: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<Awaited<ReturnType<typeof loadReport>> | null>(null);

  async function handleOpen(o: boolean) {
    setOpen(o);
    if (o) {
      try { setReport(await loadReport()); } catch { setReport(null); }
    } else {
      setReport(null);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpen}>
      <AlertDialogTrigger asChild>
        <Button size="icon" variant="ghost" title="Архивировать">
          <Archive className="h-3.5 w-3.5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Архивировать поле «{field.label}»?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                Поле станет неактивным: новых анкет оно не коснётся, но уже сохранённые
                значения продолжат подставляться в существующих сессиях и исторических документах.
              </p>
              {report && (
                <div className="text-xs rounded border border-border/50 bg-muted/30 p-2 space-y-1">
                  <div>Назначений в шаблонах: <strong>{report.templates_using_token}</strong></div>
                  <div>Активных анкет со значением: <strong>{report.active_sessions_with_value}</strong></div>
                  <div>Завершённых анкет со значением: <strong>{report.historical_sessions_with_value}</strong></div>
                </div>
              )}
            </div>
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

function DeleteButton({
  field, loadReport, onDelete,
}: {
  field: PackageFieldRow;
  loadReport: () => Promise<{ templates_using_token: number; active_sessions_with_value: number; historical_sessions_with_value: number; generation_snapshots_count: number }>;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<Awaited<ReturnType<typeof loadReport>> | null>(null);

  async function handleOpen(o: boolean) {
    setOpen(o);
    if (o) {
      try { setReport(await loadReport()); } catch { setReport(null); }
    } else {
      setReport(null);
    }
  }

  const canDelete =
    !!report &&
    report.templates_using_token === 0 &&
    report.active_sessions_with_value === 0 &&
    report.historical_sessions_with_value === 0 &&
    report.generation_snapshots_count === 0;

  return (
    <AlertDialog open={open} onOpenChange={handleOpen}>
      <AlertDialogTrigger asChild>
        <Button size="icon" variant="ghost" title="Удалить безвозвратно">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Удалить поле «{field.label}» безвозвратно?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>Операция необратима. Удаление возможно только если поле не используется нигде.</p>
              {report && (
                <div className="text-xs rounded border border-border/50 bg-muted/30 p-2 space-y-1">
                  <div>Назначений в шаблонах: <strong>{report.templates_using_token}</strong></div>
                  <div>Активных анкет: <strong>{report.active_sessions_with_value}</strong></div>
                  <div>Завершённых анкет: <strong>{report.historical_sessions_with_value}</strong></div>
                </div>
              )}
              {!canDelete && report && (
                <p className="text-xs text-destructive">
                  Удалить нельзя: есть зависимости. Используйте архивирование.
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction
            disabled={!canDelete}
            onClick={onDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Удалить безвозвратно
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface FieldDialogSubmit {
  label: string;
  description: string | null;
  data_type: PackageFieldDataType;
  options: Record<string, unknown>;
  usage_scope: PackageFieldUsageScope;
  client_visible: boolean;
  admin_editable: boolean;
  auto_assign_to_new_items: boolean;
  required: boolean;
  sort_order: number;
}

function FieldDialog({
  open, onOpenChange, loading, title, existing, onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  loading: boolean;
  title: string;
  existing?: PackageFieldRow;
  onSubmit: (input: FieldDialogSubmit) => void;
}) {
  const [label, setLabel] = useState(existing?.label ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [dataType, setDataType] = useState<PackageFieldDataType>(existing?.data_type ?? "text");
  const [usageScope, setUsageScope] = useState<PackageFieldUsageScope>(existing?.usage_scope ?? "package_all");
  const [clientVisible, setClientVisible] = useState(existing?.client_visible ?? true);
  const [adminEditable, setAdminEditable] = useState(existing?.admin_editable ?? true);
  const [autoAssign, setAutoAssign] = useState(existing?.auto_assign_to_new_items ?? false);
  const [required, setRequired] = useState(existing?.required ?? false);
  const [sortOrder, setSortOrder] = useState<number>(existing?.sort_order ?? 100);
  const [defaultKind, setDefaultKind] = useState<SmartDateKind>(
    (existing?.options?.default_kind as SmartDateKind | undefined) ?? "none",
  );
  const [choices, setChoices] = useState<PackageFieldChoice[]>(
    (existing?.options?.choices as PackageFieldChoice[] | undefined) ?? [],
  );
  const [separator, setSeparator] = useState<string>((existing?.options?.separator as string | undefined) ?? ", ");
  const [trueLabel, setTrueLabel] = useState<string>((existing?.options?.true_label as string | undefined) ?? "Да");
  const [falseLabel, setFalseLabel] = useState<string>((existing?.options?.false_label as string | undefined) ?? "Нет");

  const isDateLike = dataType === "date" || dataType === "datetime" || dataType === "year";
  const isChoiceLike = dataType === "select" || dataType === "multiselect";
  const isCheckbox = dataType === "checkbox";

  // Reset when opening for a different row
  function handleOpenChange(o: boolean) {
    if (o && existing) {
      setLabel(existing.label);
      setDescription(existing.description ?? "");
      setDataType(existing.data_type);
      setUsageScope(existing.usage_scope);
      setClientVisible(existing.client_visible);
      setAdminEditable(existing.admin_editable);
      setAutoAssign(existing.auto_assign_to_new_items);
      setRequired(existing.required);
      setSortOrder(existing.sort_order);
      setDefaultKind((existing.options?.default_kind as SmartDateKind | undefined) ?? "none");
      setChoices((existing.options?.choices as PackageFieldChoice[] | undefined) ?? []);
      setSeparator((existing.options?.separator as string | undefined) ?? ", ");
      setTrueLabel((existing.options?.true_label as string | undefined) ?? "Да");
      setFalseLabel((existing.options?.false_label as string | undefined) ?? "Нет");
    } else if (o && !existing) {
      setLabel(""); setDescription(""); setDataType("text"); setUsageScope("package_all");
      setClientVisible(true); setAdminEditable(true); setAutoAssign(false); setRequired(false);
      setSortOrder(100); setDefaultKind("none"); setChoices([]); setSeparator(", ");
      setTrueLabel("Да"); setFalseLabel("Нет");
    }
    onOpenChange(o);
  }

  function buildOptions(): Record<string, unknown> {
    const opts: Record<string, unknown> = {};
    if (isDateLike && defaultKind !== "none") opts.default_kind = defaultKind;
    if (isChoiceLike) opts.choices = choices.filter((c) => c.value.trim() && c.label.trim());
    if (dataType === "multiselect") opts.separator = separator;
    if (isCheckbox) {
      opts.true_label = trueLabel || "Да";
      opts.false_label = falseLabel || "Нет";
    }
    return opts;
  }

  function handleSubmit() {
    if (!label.trim()) {
      toast.error("Название поля обязательно");
      return;
    }
    if (isChoiceLike) {
      const vals = choices.map((c) => c.value.trim()).filter(Boolean);
      const dup = vals.find((v, i) => vals.indexOf(v) !== i);
      if (dup) {
        toast.error(`Дублирующееся значение в списке: "${dup}"`);
        return;
      }
      if (vals.length === 0) {
        toast.error("Добавьте хотя бы один вариант ответа");
        return;
      }
    }
    onSubmit({
      label: label.trim(),
      description: description.trim() || null,
      data_type: dataType,
      options: buildOptions(),
      usage_scope: usageScope,
      client_visible: clientVisible,
      admin_editable: adminEditable,
      auto_assign_to_new_items: autoAssign,
      required,
      sort_order: sortOrder,
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Поле создаётся один раз в каталоге пакета. Назначить его конкретным шаблонам можно
            во вкладке «Анкеты документов». Один токен {"{{pf-XXXXXX}}"} — одно значение на анкету.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Название поля *</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Например: Дата приказа" autoFocus />
            </div>
            <div className="col-span-2">
              <Label>Описание</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            </div>
            <div>
              <Label>Тип данных</Label>
              <Select
                value={dataType}
                onValueChange={(v) => {
                  const next = v as PackageFieldDataType;
                  setDataType(next);
                  // PATCH-PACKAGE-CUSTOM-FIELDS-V1 итерация 2 (B4):
                  // авто-сброс defaultKind, если он несовместим с новым типом
                  // (например, year → date или date → text).
                  if (!isSmartDateKindAllowedForType(defaultKind, next)) {
                    setDefaultKind("none");
                  }
                }}
                disabled={!!existing}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(DATA_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {existing && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  Тип нельзя изменить после создания.
                </p>
              )}
            </div>
            <div>
              <Label>Видимость</Label>
              <Select value={usageScope} onValueChange={(v) => setUsageScope(v as PackageFieldUsageScope)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(USAGE_SCOPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {isDateLike && (
            <div>
              <Label>Значение по умолчанию</Label>
              <Select value={defaultKind} onValueChange={(v) => setDefaultKind(v as SmartDateKind)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {allowedSmartDateKindsForType(dataType).map((k) => (
                    <SelectItem key={k} value={k}>{SMART_DATE_KIND_LABELS[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-1">
                Значение подставляется в анкете автоматически (в часовом поясе Минск).
                Записывается в БД только после сохранения клиентом или администратором.
                {dataType === "year"
                  ? " Для типа «Год» используются только годовые сдвиги (прошлый/текущий/будущий год)."
                  : ""}
              </p>
            </div>
          )}

          {isChoiceLike && (
            <ChoicesEditor choices={choices} onChange={setChoices} />
          )}

          {dataType === "multiselect" && (
            <div>
              <Label>Разделитель при выводе</Label>
              <Input value={separator} onChange={(e) => setSeparator(e.target.value)} className="w-32" />
            </div>
          )}

          {isCheckbox && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Текст при «Да»</Label>
                <Input value={trueLabel} onChange={(e) => setTrueLabel(e.target.value)} />
              </div>
              <div>
                <Label>Текст при «Нет»</Label>
                <Input value={falseLabel} onChange={(e) => setFalseLabel(e.target.value)} />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/40">
            <div className="flex items-center gap-2">
              <Switch checked={required} onCheckedChange={setRequired} />
              <Label className="cursor-pointer">Обязательно</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={clientVisible} onCheckedChange={setClientVisible} />
              <Label className="cursor-pointer">Виден клиенту</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={adminEditable} onCheckedChange={setAdminEditable} />
              <Label className="cursor-pointer">Редактирует админ</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={autoAssign} onCheckedChange={setAutoAssign} />
              <Label className="cursor-pointer">Автоматически добавлять в новые шаблоны</Label>
            </div>
            <div>
              <Label>Порядок</Label>
              <Input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value) || 100)}
                className="w-24"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>Отмена</Button>
          <Button disabled={loading || !label.trim()} onClick={handleSubmit}>
            {existing ? "Сохранить" : "Создать"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChoicesEditor({
  choices, onChange,
}: {
  choices: PackageFieldChoice[];
  onChange: (next: PackageFieldChoice[]) => void;
}) {
  function add() {
    onChange([...choices, { value: "", label: "", sort_order: (choices.length + 1) * 10 }]);
  }
  function updateAt(i: number, patch: Partial<PackageFieldChoice>) {
    const next = choices.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }
  function removeAt(i: number) {
    const next = choices.slice();
    next.splice(i, 1);
    onChange(next);
  }

  return (
    <div className="space-y-2">
      <Label>Варианты ответа</Label>
      <div className="rounded-md border border-border/40 divide-y divide-border/40">
        {choices.length === 0 && (
          <div className="p-3 text-xs text-muted-foreground text-center">Вариантов пока нет.</div>
        )}
        {choices.map((c, i) => (
          <div key={i} className="p-2 grid grid-cols-12 gap-2 items-center">
            <Input
              className="col-span-4 h-7 text-xs font-mono"
              placeholder="value (стабильный код)"
              value={c.value}
              onChange={(e) => updateAt(i, { value: e.target.value })}
            />
            <Input
              className="col-span-6 h-7 text-xs"
              placeholder="Отображаемый текст"
              value={c.label}
              onChange={(e) => updateAt(i, { label: e.target.value })}
            />
            <div className="col-span-2 flex justify-end">
              <Button size="icon" variant="ghost" onClick={() => removeAt(i)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>
      <Button size="sm" variant="outline" onClick={add}>
        <Plus className="h-3.5 w-3.5 mr-1" /> Добавить вариант
      </Button>
      <p className="text-[10px] text-muted-foreground">
        Стабильный <code>value</code> записывается в БД и не должен меняться после первого использования;
        <code>label</code> можно менять свободно.
      </p>
    </div>
  );
}
