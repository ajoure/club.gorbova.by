import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  useDocumentTemplates,
  type DocumentTemplate,
} from "@/hooks/useDocumentTemplates";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { extractDocxPlaceholders } from "@/utils/extractDocxPlaceholders";
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
} from "lucide-react";

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

  // Show all ai/both templates (including inactive) for management
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
    });
    setMode("edit");
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("Укажите название шаблона");
      return;
    }

    try {
      // Use parsed placeholders from DOCX, or keep existing ones on edit without new file
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
        });
      } else if (mode === "edit" && editId) {
        const updates: Partial<DocumentTemplate> & { id: string } = {
          id: editId,
          name: form.name,
          description: form.description || null,
          document_type: form.document_type,
          is_active: form.is_active,
        };
        // Update placeholders only if new file was parsed or existing ones changed
        if (form.file || form.parsedPlaceholders.length > 0) {
          updates.placeholders = placeholders;
        }
        if (form.file) {
          const code = generateCode();
          const filePath = await uploadTemplateFile(form.file, code);
          (updates as any).template_path = filePath;
        }
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

  const handleToggleActive = async (t: DocumentTemplate) => {
    try {
      await updateTemplate({ id: t.id, is_active: !t.is_active });
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
      if (data?.signedUrl) {
        window.open(data.signedUrl, "_blank");
      }
    } catch {
      toast.error("Ошибка скачивания шаблона");
    }
  };

  const renderPlaceholdersDiagnostics = () => {
    if (form.isParsing) {
      return (
        <div className="flex items-center gap-2 p-3 rounded-xl border border-border/50 bg-muted/30">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Анализ шаблона…</span>
        </div>
      );
    }

    if (form.parseError) {
      return (
        <div className="flex items-start gap-2 p-3 rounded-xl border border-amber-500/30 bg-amber-500/5">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <span className="text-sm text-amber-700 dark:text-amber-400">{form.parseError}</span>
        </div>
      );
    }

    if (form.parsedPlaceholders.length > 0) {
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            <span className="text-sm font-medium">
              Найдено токенов: {form.parsedPlaceholders.length}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {form.parsedPlaceholders.map((p) => (
              <Badge key={p} variant="secondary" className="text-xs font-mono">
                {`{{${p}}}`}
              </Badge>
            ))}
          </div>
        </div>
      );
    }

    if (mode === "edit" && !form.file) {
      // Show existing placeholders from DB
      const existing = form.parsedPlaceholders;
      if (existing.length > 0) {
        return (
          <div className="space-y-2">
            <span className="text-sm font-medium">Текущие токены:</span>
            <div className="flex flex-wrap gap-1.5">
              {existing.map((p) => (
                <Badge key={p} variant="secondary" className="text-xs font-mono">
                  {`{{${p}}}`}
                </Badge>
              ))}
            </div>
          </div>
        );
      }
    }

    return null;
  };

  const renderForm = () => (
    <div className="space-y-5">
      {/* Name */}
      <div className="space-y-1.5">
        <Label className="text-sm font-medium">Название шаблона</Label>
        <Input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Например: Счёт-акт для ИП"
        />
      </div>

      {/* Description */}
      <div className="space-y-1.5">
        <Label className="text-sm font-medium">Описание</Label>
        <Input
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="Краткое описание назначения шаблона"
        />
      </div>

      <Separator />

      {/* DOCX file */}
      <div className="space-y-1.5">
        <Label className="text-sm font-medium">
          Файл шаблона (.docx) {mode === "create" ? "*" : ""}
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

      {/* Placeholders diagnostics */}
      {renderPlaceholdersDiagnostics()}

      <Separator />

      {/* Active switch */}
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Активен</Label>
        <Switch
          checked={form.is_active}
          onCheckedChange={(v) => setForm({ ...form, is_active: v })}
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => {
            setMode("list");
            setEditId(null);
            setForm(emptyForm);
          }}
        >
          Отмена
        </Button>
        <Button className="flex-1" onClick={handleSave} disabled={isCreating || isUpdating}>
          {(isCreating || isUpdating) && (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          )}
          {mode === "create" ? "Загрузить" : "Сохранить"}
        </Button>
      </div>
    </div>
  );

  const renderList = () => (
    <div className="space-y-3">
      <Button onClick={handleCreate} variant="outline" className="w-full">
        <Plus className="h-4 w-4 mr-2" />
        Загрузить новый шаблон
      </Button>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : aiTemplates.length === 0 ? (
        <div className="text-center py-8">
          <FileText className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            Нет AI-шаблонов. Загрузите первый шаблон DOCX.
          </p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {aiTemplates.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-3 p-3 rounded-xl border border-border/50 bg-card"
            >
              <FileText className="h-4 w-4 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{t.name}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {t.is_active ? (
                    <Badge variant="default" className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                      активен
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px]">
                      неактивен
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
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => handleEdit(t)}
                  title="Редактировать"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => handleDownload(t)}
                  title="Скачать исходный файл"
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => handleDelete(t)}
                  title="Удалить"
                  disabled={isDeleting}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            Управление шаблонами
          </DialogTitle>
          <DialogDescription>
            {mode === "list"
              ? "Загрузка, редактирование и удаление шаблонов документов"
              : mode === "create"
                ? "Загрузите новый шаблон DOCX с токенами для автозаполнения"
                : "Редактирование шаблона"}
          </DialogDescription>
        </DialogHeader>

        {mode === "list" ? renderList() : renderForm()}
      </DialogContent>
    </Dialog>
  );
}
