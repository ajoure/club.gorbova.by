import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useDocumentPackages,
  useDocumentPackageItems,
  type DocumentPackageTemplate,
} from "@/hooks/useDocumentPackages";
import { useDocumentTemplates, type DocumentTemplate } from "@/hooks/useDocumentTemplates";
import {
  Plus,
  Pencil,
  Trash2,
  ArrowLeft,
  Package,
  Loader2,
  ChevronUp,
  ChevronDown,
  FileText,
  X,
} from "lucide-react";
import { SHEET_SHELL_CLASS } from "@/lib/sheetShell";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

type Mode = "list" | "create" | "edit";

export function AiDocumentPackagesManager({ open, onOpenChange }: Props) {
  const { packages, isLoading, createPackage, updatePackage, deletePackage } = useDocumentPackages();
  const { templates } = useDocumentTemplates();

  const [mode, setMode] = useState<Mode>("list");
  const [editingPkg, setEditingPkg] = useState<DocumentPackageTemplate | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);

  // Items management for edit mode
  const currentPkgId = editingPkg?.id ?? null;
  const { items, isLoading: itemsLoading, addItem, removeItem, reorderItem } = useDocumentPackageItems(currentPkgId);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");

  // Filter AI-scope templates only, exclude already-added ones
  const aiTemplates = templates.filter(
    (t) => {
      const scope = t.template_scope as string;
      if (scope && scope !== "ai" && scope !== "both") return false;
      if (!t.is_active) return false;
      return !items.some((item) => item.template_id === t.id);
    }
  );

  const resetForm = () => {
    setName("");
    setDescription("");
    setIsActive(true);
    setEditingPkg(null);
    setSelectedTemplateId("");
  };

  const goList = () => {
    setMode("list");
    resetForm();
  };

  const startCreate = () => {
    resetForm();
    setMode("create");
  };

  const startEdit = (pkg: DocumentPackageTemplate) => {
    setEditingPkg(pkg);
    setName(pkg.name);
    setDescription(pkg.description || "");
    setIsActive(pkg.is_active);
    setMode("edit");
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    if (mode === "create") {
      await createPackage.mutateAsync({ name: name.trim(), description: description.trim() || undefined });
      goList();
    } else if (mode === "edit" && editingPkg) {
      await updatePackage.mutateAsync({
        id: editingPkg.id,
        name: name.trim(),
        description: description.trim() || undefined,
        is_active: isActive,
      });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Удалить пакет? Это действие необратимо.")) return;
    await deletePackage.mutateAsync(id);
    if (editingPkg?.id === id) goList();
  };

  const handleAddTemplate = async () => {
    if (!selectedTemplateId || !currentPkgId) return;
    await addItem.mutateAsync({ packageId: currentPkgId, templateId: selectedTemplateId });
    setSelectedTemplateId("");
  };

  const handleMoveUp = async (index: number) => {
    if (index <= 0) return;
    const item = items[index];
    const prevItem = items[index - 1];
    await Promise.all([
      reorderItem.mutateAsync({ itemId: item.id, newSortOrder: prevItem.sort_order }),
      reorderItem.mutateAsync({ itemId: prevItem.id, newSortOrder: item.sort_order }),
    ]);
  };

  const handleMoveDown = async (index: number) => {
    if (index >= items.length - 1) return;
    const item = items[index];
    const nextItem = items[index + 1];
    await Promise.all([
      reorderItem.mutateAsync({ itemId: item.id, newSortOrder: nextItem.sort_order }),
      reorderItem.mutateAsync({ itemId: nextItem.id, newSortOrder: item.sort_order }),
    ]);
  };

  const activePackages = packages.filter((p) => p.is_active);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className={SHEET_SHELL_CLASS}>
        {/* Header */}
        <SheetHeader className="p-4 sm:p-6 pb-3 sm:pb-4 pr-14 sm:pr-16 flex-shrink-0">
          <div className="flex items-center gap-3">
            {mode !== "list" && (
              <Button variant="ghost" size="icon" className="shrink-0" onClick={goList}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary shrink-0" />
              <SheetTitle className="text-lg">
                {mode === "list" && "Пакеты документов"}
                {mode === "create" && "Новый пакет"}
                {mode === "edit" && "Редактирование пакета"}
              </SheetTitle>
            </div>
          </div>
          <SheetDescription className="text-sm">
            {mode === "list" && "Группируйте шаблоны в пакеты для сценариев генерации."}
            {mode === "create" && "Укажите название и описание пакета."}
            {mode === "edit" && "Настройте пакет и управляйте шаблонами внутри."}
          </SheetDescription>
        </SheetHeader>

        <Separator className="flex-shrink-0" />

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
          {mode === "list" && (
            <div className="space-y-3">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : packages.length === 0 ? (
                <div className="text-center py-12">
                  <Package className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground mb-4">Пакетов пока нет</p>
                  <Button onClick={startCreate}>
                    <Plus className="h-4 w-4 mr-2" />
                    Создать пакет
                  </Button>
                </div>
              ) : (
                <>
                  <Button size="sm" onClick={startCreate} className="mb-3">
                    <Plus className="h-4 w-4 mr-2" />
                    Создать пакет
                  </Button>
                  {packages.map((pkg) => (
                    <Card key={pkg.id} className="cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => startEdit(pkg)}>
                      <CardContent className="p-4 flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium truncate">{pkg.name}</span>
                            {!pkg.is_active && <Badge variant="secondary" className="text-xs">Неактивен</Badge>}
                          </div>
                          {pkg.description && (
                            <p className="text-xs text-muted-foreground line-clamp-1">{pkg.description}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); startEdit(pkg); }}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={(e) => { e.stopPropagation(); handleDelete(pkg.id); }}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </>
              )}
            </div>
          )}

          {(mode === "create" || mode === "edit") && (
            <div className="space-y-5">
              {/* Basic fields */}
              <div className="space-y-3">
                <div>
                  <Label htmlFor="pkg-name">Название пакета</Label>
                  <Input id="pkg-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: Годовое собрание участников" className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="pkg-desc">Описание</Label>
                  <Input id="pkg-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Краткое описание сценария" className="mt-1" />
                </div>
                {mode === "edit" && (
                  <div className="flex items-center justify-between">
                    <Label htmlFor="pkg-active">Активен</Label>
                    <Switch id="pkg-active" checked={isActive} onCheckedChange={setIsActive} />
                  </div>
                )}
              </div>

              {/* Items section (edit only) */}
              {mode === "edit" && currentPkgId && (
                <>
                  <Separator />
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold">Шаблоны в пакете</h4>

                    {itemsLoading ? (
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    ) : items.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Добавьте шаблоны документов в пакет.</p>
                    ) : (
                      <div className="space-y-2">
                        {items.map((item, idx) => (
                          <Card key={item.id}>
                            <CardContent className="p-3 flex items-center gap-2">
                              <div className="flex flex-col gap-0.5 shrink-0">
                                <Button variant="ghost" size="icon" className="h-5 w-5" disabled={idx === 0} onClick={() => handleMoveUp(idx)}>
                                  <ChevronUp className="h-3 w-3" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-5 w-5" disabled={idx === items.length - 1} onClick={() => handleMoveDown(idx)}>
                                  <ChevronDown className="h-3 w-3" />
                                </Button>
                              </div>
                              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium truncate">{item.template_name}</p>
                                <p className="text-xs text-muted-foreground">{item.template_document_type}</p>
                              </div>
                              <Badge variant="outline" className="text-xs shrink-0">#{idx + 1}</Badge>
                              {!item.is_required && <Badge variant="secondary" className="text-xs shrink-0">Опц.</Badge>}
                              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-destructive" onClick={() => removeItem.mutateAsync(item.id)}>
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}

                    {/* Add template */}
                    {aiTemplates.length > 0 && (
                      <div className="flex gap-2">
                        <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                          <SelectTrigger className="flex-1">
                            <SelectValue placeholder="Выберите шаблон..." />
                          </SelectTrigger>
                          <SelectContent>
                            {aiTemplates.map((t) => (
                              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button size="sm" disabled={!selectedTemplateId || addItem.isPending} onClick={handleAddTemplate}>
                          <Plus className="h-4 w-4 mr-1" />
                          Добавить
                        </Button>
                      </div>
                    )}
                    {aiTemplates.length === 0 && items.length > 0 && (
                      <p className="text-xs text-muted-foreground">Все доступные шаблоны уже добавлены.</p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {(mode === "create" || mode === "edit") && (
          <div className="flex-shrink-0 border-t p-4 sm:p-6 pt-3 sm:pt-4 flex gap-2 justify-end">
            <Button variant="outline" onClick={goList}>Отмена</Button>
            <Button
              onClick={handleSave}
              disabled={!name.trim() || createPackage.isPending || updatePackage.isPending}
            >
              {(createPackage.isPending || updatePackage.isPending) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {mode === "create" ? "Создать" : "Сохранить"}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
