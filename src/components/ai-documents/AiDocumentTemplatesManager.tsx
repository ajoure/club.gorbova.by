import { useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useDocumentTemplates,
  type DocumentTemplate,
} from "@/hooks/useDocumentTemplates";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Upload,
  Pencil,
  Trash2,
  Download,
  FileText,
  Loader2,
  Plus,
  X,
} from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

type FormMode = "list" | "create" | "edit";

interface TemplateForm {
  name: string;
  code: string;
  description: string;
  document_type: string;
  template_scope: string;
  is_active: boolean;
  placeholders_text: string;
  file: File | null;
}

const emptyForm: TemplateForm = {
  name: "",
  code: "",
  description: "",
  document_type: "счёт-акт",
  template_scope: "ai",
  is_active: true,
  placeholders_text: "",
  file: null,
};

export function AiDocumentTemplatesManager({ open, onOpenChange }: Props) {
  const {
    templates,
    isLoading,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    uploadTemplateFile,
    isCreating,
    isUpdating,
    isDeleting,
  } = useDocumentTemplates();

  const [mode, setMode] = useState<FormMode>("list");
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<TemplateForm>(emptyForm);

  // Show all ai/both templates (including inactive) for management
  const aiTemplates = templates.filter(
    (t) => t.template_scope === "ai" || t.template_scope === "both"
  );

  const parsePlaceholders = (text: string): string[] => {
    if (!text.trim()) return [];
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  };

  const handleCreate = () => {
    setForm(emptyForm);
    setEditId(null);
    setMode("create");
  };

  const handleEdit = (t: DocumentTemplate) => {
    setEditId(t.id);
    setForm({
      name: t.name,
      code: t.code,
      description: t.description || "",
      document_type: t.document_type,
      template_scope: t.template_scope || "ai",
      is_active: t.is_active,
      placeholders_text: Array.isArray(t.placeholders)
        ? t.placeholders.join("\n")
        : "",
      file: null,
    });
    setMode("edit");
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("Укажите название шаблона");
      return;
    }
    if (!form.code.trim()) {
      toast.error("Укажите код шаблона");
      return;
    }

    try {
      const placeholders = parsePlaceholders(form.placeholders_text);

      if (mode === "create") {
        if (!form.file) {
          toast.error("Загрузите файл шаблона (.docx)");
          return;
        }
        const filePath = await uploadTemplateFile(form.file, form.code);
        await createTemplate({
          name: form.name,
          code: form.code,
          description: form.description || null,
          document_type: form.document_type,
          template_scope: form.template_scope,
          template_path: filePath,
          placeholders,
          is_active: form.is_active,
        });
      } else if (mode === "edit" && editId) {
        const updates: Partial<DocumentTemplate> & { id: string } = {
          id: editId,
          name: form.name,
          code: form.code,
          description: form.description || null,
          document_type: form.document_type,
          template_scope: form.template_scope,
          placeholders,
          is_active: form.is_active,
        };
        // If new file uploaded, replace template file
        if (form.file) {
          const filePath = await uploadTemplateFile(form.file, form.code);
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

  const handleDelete = async (id: string) => {
    if (!confirm("Удалить шаблон? Это действие необратимо.")) return;
    try {
      await deleteTemplate(id);
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

  const renderForm = () => (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Название *</Label>
        <Input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Счёт-акт для ИП"
        />
      </div>

      <div className="space-y-2">
        <Label>Код *</Label>
        <Input
          value={form.code}
          onChange={(e) => setForm({ ...form, code: e.target.value })}
          placeholder="invoice_act_ip"
        />
      </div>

      <div className="space-y-2">
        <Label>Описание</Label>
        <Input
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="Краткое описание шаблона"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Тип документа</Label>
          <Input
            value={form.document_type}
            onChange={(e) => setForm({ ...form, document_type: e.target.value })}
            placeholder="счёт-акт"
          />
        </div>
        <div className="space-y-2">
          <Label>Область</Label>
          <Select
            value={form.template_scope}
            onValueChange={(v) => setForm({ ...form, template_scope: v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ai">AI</SelectItem>
              <SelectItem value="both">AI + Billing</SelectItem>
              <SelectItem value="billing">Billing</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Файл шаблона (.docx) {mode === "create" ? "*" : ""}</Label>
        <Input
          type="file"
          accept=".docx"
          onChange={(e) =>
            setForm({ ...form, file: e.target.files?.[0] || null })
          }
        />
        {mode === "edit" && !form.file && (
          <p className="text-xs text-muted-foreground">
            Оставьте пустым, чтобы сохранить текущий файл
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label>Плейсхолдеры (по одному на строку)</Label>
        <Textarea
          value={form.placeholders_text}
          onChange={(e) =>
            setForm({ ...form, placeholders_text: e.target.value })
          }
          placeholder={"{{document_number}}\n{{document_date}}\n{{client_name}}"}
          rows={6}
          className="font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground">
          Укажите токены из шаблона в формате {"{{имя_токена}}"} — по одному на строку.
          Эти токены будут показаны в preview перед генерацией документа.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Switch
          checked={form.is_active}
          onCheckedChange={(v) => setForm({ ...form, is_active: v })}
        />
        <Label>Активен</Label>
      </div>

      <div className="flex gap-2 pt-2">
        <Button
          variant="outline"
          onClick={() => {
            setMode("list");
            setEditId(null);
          }}
        >
          Отмена
        </Button>
        <Button onClick={handleSave} disabled={isCreating || isUpdating}>
          {(isCreating || isUpdating) && (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          )}
          {mode === "create" ? "Создать" : "Сохранить"}
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
              className="flex items-center gap-3 p-3 rounded-lg border bg-card"
            >
              <FileText className="h-4 w-4 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{t.name}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Badge variant="outline" className="text-[10px]">
                    {t.template_scope}
                  </Badge>
                  {!t.is_active && (
                    <Badge variant="secondary" className="text-[10px]">
                      неактивен
                    </Badge>
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
                  onClick={() => handleToggleActive(t)}
                  title={t.is_active ? "Деактивировать" : "Активировать"}
                >
                  {t.is_active ? (
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <Plus className="h-3.5 w-3.5 text-green-600" />
                  )}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => handleDownload(t)}
                  title="Скачать"
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => handleDelete(t.id)}
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
            Управление AI-шаблонами
          </DialogTitle>
          <DialogDescription>
            {mode === "list"
              ? "Загрузка, редактирование и активация шаблонов документов"
              : mode === "create"
                ? "Загрузите новый шаблон DOCX"
                : "Редактирование шаблона"}
          </DialogDescription>
        </DialogHeader>

        {mode === "list" ? renderList() : renderForm()}
      </DialogContent>
    </Dialog>
  );
}
