import { useState, useCallback } from "react";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useDocumentTemplates,
  type DocumentTemplate,
} from "@/hooks/useDocumentTemplates";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { extractDocxPlaceholders } from "@/utils/extractDocxPlaceholders";
import { TokenizedRichInput } from "@/components/admin/TokenizedRichInput";
import {
  Upload,
  Pencil,
  Trash2,
  Download,
  FileText,
  Loader2,
  Plus,
  AlertTriangle,
  CheckCircle2,
  ArrowLeft,
  Tag,
  Code2,
} from "lucide-react";
import { SHEET_SHELL_CLASS } from "@/lib/sheetShell";
import { CorporateTemplateEditorDialog } from "@/components/corporate-editor/CorporateTemplateEditorDialog";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

type FormMode = "list" | "create" | "edit";

interface TemplateForm {
  name: string;
  description: string;
  document_type: string;
  is_active: boolean;
  file: File | null;
  parsedPlaceholders: string[];
  isParsing: boolean;
  parseError: string | null;
  /** Tokenized notes/instructions for the template — uses {{canonical.key}} tokens */
  template_notes: string;
}

const emptyForm: TemplateForm = {
  name: "",
  description: "",
  document_type: "документ",
  is_active: true,
  file: null,
  parsedPlaceholders: [],
  isParsing: false,
  parseError: null,
  template_notes: "",
};

function generateCode(): string {
  return `ai_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export function AiDocumentTemplatesManager({ open, onOpenChange }: Props) {
  const {
    templates,
    isLoading,
    createTemplate,
    updateTemplate,
    deleteTemplateWithFile,
    uploadTemplateFile,
    isCreating,
    isUpdating,
    isDeleting,
  } = useDocumentTemplates();

  const [mode, setMode] = useState<FormMode>("list");
  const [editId, setEditId] = useState<string | null>(null);
  const [editTemplatePath, setEditTemplatePath] = useState<string>("");
  const [form, setForm] = useState<TemplateForm>(emptyForm);
  const [editorTemplate, setEditorTemplate] = useState<DocumentTemplate | null>(null);

  const aiTemplates = templates.filter(
    (t) => t.template_scope === "ai" || t.template_scope === "both"
  );

  const handleFileChange = useCallback(async (file: File | null) => {
    if (!file) {
      setForm((prev) => ({ ...prev, file: null, parsedPlaceholders: [], isParsing: false, parseError: null }));
      return;
    }
    setForm((prev) => ({ ...prev, file, isParsing: true, parseError: null, parsedPlaceholders: [] }));
    try {
      const placeholders = await extractDocxPlaceholders(file);
      setForm((prev) => ({
        ...prev,
        isParsing: false,
        parsedPlaceholders: placeholders,
        parseError: placeholders.length === 0
          ? "Плейсхолдеры не найдены автоматически. Убедитесь, что в шаблоне используются токены в формате {{имя_токена}}."
          : null,
      }));
    } catch (err) {
      console.error("DOCX parse error:", err);
      setForm((prev) => ({
        ...prev,
        isParsing: false,
        parsedPlaceholders: [],
        parseError: "Не удалось прочитать файл. Проверьте, что это корректный DOCX.",
      }));
    }
  }, []);

  const handleCreate = () => {
    setForm(emptyForm);
    setEditId(null);
    setMode("create");
  };

  const handleEdit = (t: DocumentTemplate) => {
    setEditId(t.id);
    setEditTemplatePath(t.template_path);
    setForm({
      name: t.name,
      description: t.description || "",
      document_type: t.document_type,
      is_active: t.is_active,
      file: null,
      parsedPlaceholders: Array.isArray(t.placeholders) ? t.placeholders : [],
      isParsing: false,
      parseError: null,
      template_notes: (t as any).template_notes || "",
    });
    setMode("edit");
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("Укажите название шаблона");
      return;
    }
    try {
      const placeholders = form.parsedPlaceholders;
      if (mode === "create") {
        if (!form.file) {
          toast.error("Загрузите файл шаблона (.docx)");
          return;
        }
        const code = generateCode();
        const filePath = await uploadTemplateFile(form.file, code);
        await createTemplate({
          name: form.name,
          code,
          description: form.description || null,
          document_type: form.document_type,
          template_scope: "ai",
          template_path: filePath,
          placeholders,
          is_active: form.is_active,
          template_notes: form.template_notes || null,
        } as any);
      } else if (mode === "edit" && editId) {
        const updates: Partial<DocumentTemplate> & { id: string } = {
          id: editId,
          name: form.name,
          description: form.description || null,
          document_type: form.document_type,
          is_active: form.is_active,
        };
        if (form.file || form.parsedPlaceholders.length > 0) {
          updates.placeholders = placeholders;
        }
        if (form.file) {
          const code = generateCode();
          const filePath = await uploadTemplateFile(form.file, code);
          (updates as any).template_path = filePath;
        }
        (updates as any).template_notes = form.template_notes || null;
        await updateTemplate(updates);
      }
      setMode("list");
      setEditId(null);
      setForm(emptyForm);
    } catch {
      // errors handled in hook
    }
  };

  const handleDelete = async (t: DocumentTemplate) => {
    if (!confirm("Удалить шаблон? Файл шаблона и запись будут удалены безвозвратно.")) return;
    try {
      await deleteTemplateWithFile(t.id, t.template_path);
    } catch {
      // errors handled in hook
    }
  };

  const handleDownload = async (t: DocumentTemplate) => {
    try {
      const { data, error } = await supabase.storage
        .from("documents-templates")
        .createSignedUrl(t.template_path, 60);
      if (error) throw error;
      if (data?.signedUrl) window.open(data.signedUrl, "_blank");
    } catch {
      toast.error("Ошибка скачивания шаблона");
    }
  };

  const handleBack = () => {
    setMode("list");
    setEditId(null);
    setForm(emptyForm);
  };

  const headerTitle = mode === "list"
    ? "Управление шаблонами"
    : mode === "create"
      ? "Новый шаблон"
      : "Редактирование шаблона";

  const headerDesc = mode === "list"
    ? "Загрузка, редактирование и удаление шаблонов документов"
    : mode === "create"
      ? "Загрузите файл DOCX с токенами для автозаполнения"
      : "Измените параметры шаблона или загрузите обновлённый файл";

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className={SHEET_SHELL_CLASS}>
        {/* Fixed Header */}
        <SheetHeader className="p-4 sm:p-6 pb-3 sm:pb-4 pr-14 sm:pr-16 flex-shrink-0">
          <div className="flex items-center gap-3">
            {mode !== "list" && (
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={handleBack}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <div className="p-2 rounded-xl bg-primary/10 shrink-0">
              <Upload className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <SheetTitle className="text-left">{headerTitle}</SheetTitle>
              <SheetDescription className="text-left text-sm mt-0.5">{headerDesc}</SheetDescription>
            </div>
          </div>
          <Separator className="mt-3" />
        </SheetHeader>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 pb-24">
          {mode === "list" ? (
            /* ─── LIST MODE ─── */
            <div className="space-y-4">
              {isLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : aiTemplates.length === 0 ? (
                <div className="text-center py-12">
                  <div className="mx-auto mb-4 p-4 rounded-2xl bg-muted/40 w-fit">
                    <FileText className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">Нет AI-шаблонов</h3>
                  <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
                    Загрузите первый шаблон DOCX с токенами для автозаполнения.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {aiTemplates.map((t) => (
                    <Card key={t.id} className="border-border/50">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                            <FileText className="h-4 w-4 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium leading-tight break-words">{t.name}</p>
                            {t.description && (
                              <p className="text-sm text-muted-foreground mt-0.5 break-words">{t.description}</p>
                            )}
                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                              {t.is_active ? (
                                <Badge variant="default" className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                                  активен
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="text-[10px]">
                                  неактивен
                                </Badge>
                              )}
                              {(t as any).template_status && (
                                <Badge variant="outline" className="text-[10px]">
                                  {(t as any).template_status === "draft" ? "черновик" : (t as any).template_status === "approved" ? "утверждён" : "в разработке"}
                                </Badge>
                              )}
                              {(t as any).editor_draft_content && (
                                <Badge variant="secondary" className="text-[10px]">
                                  есть draft
                                </Badge>
                              )}
                              {Array.isArray(t.placeholders) && t.placeholders.length > 0 && (
                                <span className="text-[10px] text-muted-foreground">
                                  {t.placeholders.length} токенов
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {(t as any).editor_mvp_enabled && (
                              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditorTemplate(t)} title="Редактор шаблона">
                                <Code2 className="h-3.5 w-3.5 text-primary" />
                              </Button>
                            )}
                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleEdit(t)} title="Редактировать">
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleDownload(t)} title="Скачать">
                              <Download className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleDelete(t)} title="Удалить" disabled={isDeleting}>
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* ─── CREATE / EDIT MODE ─── */
            <div className="space-y-6 max-w-2xl">
              {/* Name */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">Основные данные</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-sm">Название шаблона</Label>
                    <Input
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="Например: Счёт-акт для ИП"
                    />
                  </div>
                   <div className="space-y-1.5">
                    <Label className="text-sm">Описание</Label>
                    <Input
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      placeholder="Краткое описание назначения шаблона"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm">Инструкции к шаблону</Label>
                    <p className="text-xs text-muted-foreground">
                      Заметки о токенах и особенностях заполнения. Нажмите [ для вставки токена.
                    </p>
                    <TokenizedRichInput
                      value={form.template_notes}
                      onChange={(v) => setForm({ ...form, template_notes: v })}
                      placeholder="Например: В этом шаблоне используется [Дата собрания] и [ФИО подписанта]..."
                      rows={3}
                      tokenContext="documents:act"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Активен</Label>
                    <Switch
                      checked={form.is_active}
                      onCheckedChange={(v) => setForm({ ...form, is_active: v })}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* File */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">Файл шаблона</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-sm">
                      Файл DOCX {mode === "create" && <span className="text-destructive">*</span>}
                    </Label>
                    <Input
                      type="file"
                      accept=".docx"
                      onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
                    />
                    {mode === "edit" && !form.file && (
                      <p className="text-xs text-muted-foreground">
                        Оставьте пустым, чтобы сохранить текущий файл
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Placeholders diagnostics */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Tag className="h-4 w-4" />
                    Найденные токены
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {form.isParsing ? (
                    <div className="flex items-center gap-2 p-3 rounded-xl border border-border/50 bg-muted/30">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Анализ шаблона…</span>
                    </div>
                  ) : form.parseError ? (
                    <div className="flex items-start gap-2 p-3 rounded-xl border border-amber-500/30 bg-amber-500/5">
                      <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                      <span className="text-sm text-amber-700 dark:text-amber-400">{form.parseError}</span>
                    </div>
                  ) : form.parsedPlaceholders.length > 0 ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        <span className="text-sm font-medium">
                          Найдено: {form.parsedPlaceholders.length}
                        </span>
                      </div>
                      <div className="max-h-[200px] overflow-y-auto rounded-lg border border-border/50 p-3">
                        <div className="flex flex-wrap gap-1.5">
                          {form.parsedPlaceholders.map((p) => (
                            <Badge key={p} variant="secondary" className="text-xs font-mono">
                              {`{{${p}}}`}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : mode === "edit" && !form.file ? (
                    <p className="text-sm text-muted-foreground">
                      Токены не обнаружены. Загрузите обновлённый файл DOCX для повторного анализа.
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Загрузите файл DOCX — токены будут определены автоматически.
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>

        {/* Fixed Footer */}
        <div className="flex-shrink-0 border-t bg-background px-4 sm:px-6 py-3 sm:py-4">
          {mode === "list" ? (
            <Button onClick={handleCreate} className="w-full sm:w-auto">
              <Plus className="h-4 w-4 mr-2" />
              Загрузить новый шаблон
            </Button>
          ) : (
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={handleBack}>
                Отмена
              </Button>
              <Button onClick={handleSave} disabled={isCreating || isUpdating}>
                {(isCreating || isUpdating) && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {mode === "create" ? "Загрузить" : "Сохранить"}
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>

    {/* Corporate Template Editor Dialog */}
    {editorTemplate && (
      <CorporateTemplateEditorDialog
        open={!!editorTemplate}
        onOpenChange={(open) => { if (!open) setEditorTemplate(null); }}
        templateId={editorTemplate.id}
        templateName={editorTemplate.name}
        templatePath={editorTemplate.template_path}
        templateStatus={(editorTemplate as any).template_status || "in_development"}
      />
    )}
    </>
  );
}
