import { useState, useEffect } from "react";
import { usePromptAttachments } from "@/hooks/usePromptAttachments";
import { PromptAttachmentsSection } from "./PromptAttachmentsSection";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AiUserPrompt } from "@/hooks/useAiUserPrompts";

interface PromptFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prompt: AiUserPrompt | null; // null = create
  onSave: (data: Partial<AiUserPrompt>) => Promise<void>;
  saving: boolean;
}

const TYPES = [
  { value: "chat", label: "Чат" },
  { value: "file_analysis", label: "Анализ файлов" },
  { value: "document_review", label: "Обзор документов" },
  { value: "text_transform", label: "Трансформация текста" },
];

export function PromptFormDialog({ open, onOpenChange, prompt, onSave, saving }: PromptFormDialogProps) {
  const { attachments, loading: attachmentsLoading, uploading, fetchAttachments, uploadAttachment, deleteAttachment } = usePromptAttachments();
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [promptText, setPromptText] = useState("");
  const [type, setType] = useState<string>("chat");
  const [category, setCategory] = useState("");
  const [icon, setIcon] = useState("");
  const [inputHint, setInputHint] = useState("");
  const [responseFormatStr, setResponseFormatStr] = useState("");
  const [responseFormatError, setResponseFormatError] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [isVisibleInChat, setIsVisibleInChat] = useState(false);
  const [launcherTitle, setLauncherTitle] = useState("");
  const [launcherDescription, setLauncherDescription] = useState("");
  const [launcherOrder, setLauncherOrder] = useState(0);
  const [sortOrder, setSortOrder] = useState(0);

  useEffect(() => {
    if (prompt) {
      setCode(prompt.code);
      setTitle(prompt.title);
      setDescription(prompt.description || "");
      setPromptText(prompt.prompt_text);
      setType(prompt.type);
      setCategory(prompt.category || "");
      setIcon(prompt.icon || "");
      setInputHint(prompt.input_hint || "");
      setResponseFormatStr(prompt.response_format ? JSON.stringify(prompt.response_format, null, 2) : "");
      setResponseFormatError(null);
      setIsActive(prompt.is_active);
      setIsVisibleInChat(prompt.is_visible_in_chat);
      setLauncherTitle(prompt.launcher_title || "");
      setLauncherDescription(prompt.launcher_description || "");
      setLauncherOrder(prompt.launcher_order);
      setSortOrder(prompt.sort_order);
    } else {
      setCode("");
      setTitle("");
      setDescription("");
      setPromptText("");
      setType("chat");
      setCategory("");
      setIcon("");
      setInputHint("");
      setResponseFormatStr("");
      setResponseFormatError(null);
      setIsActive(true);
      setIsVisibleInChat(false);
      setLauncherTitle("");
      setLauncherDescription("");
      setLauncherOrder(0);
      setSortOrder(0);
    }
  }, [prompt, open]);

  const validateResponseFormat = (val: string): boolean => {
    if (!val.trim()) {
      setResponseFormatError(null);
      return true;
    }
    try {
      JSON.parse(val);
      setResponseFormatError(null);
      return true;
    } catch {
      setResponseFormatError("Невалидный JSON");
      return false;
    }
  };

  const handleSave = async () => {
    if (!code.trim() || !title.trim() || !promptText.trim()) return;
    if (!validateResponseFormat(responseFormatStr)) return;

    const data: Partial<AiUserPrompt> = {
      code: code.trim(),
      title: title.trim(),
      description: description.trim() || null,
      prompt_text: promptText,
      type: type as AiUserPrompt["type"],
      category: category.trim() || null,
      icon: icon.trim() || null,
      input_hint: inputHint.trim() || null,
      response_format: responseFormatStr.trim() ? JSON.parse(responseFormatStr) : null,
      is_active: isActive,
      is_visible_in_chat: isVisibleInChat,
      launcher_title: launcherTitle.trim() || null,
      launcher_description: launcherDescription.trim() || null,
      launcher_order: launcherOrder,
      sort_order: sortOrder,
    };

    await onSave(data);
    onOpenChange(false);
  };

  const isValid = code.trim() && title.trim() && promptText.trim() && !responseFormatError;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{prompt ? "Редактировать промпт" : "Создать промпт"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Код (slug) *</Label>
              <Input value={code} onChange={e => setCode(e.target.value)} placeholder="balance_analysis" disabled={!!prompt} />
            </div>
            <div>
              <Label>Тип *</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Название *</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Анализ баланса компании" />
          </div>

          <div>
            <Label>Описание</Label>
            <Input value={description} onChange={e => setDescription(e.target.value)} />
          </div>

          <div>
            <Label>Текст промпта *</Label>
            <Textarea value={promptText} onChange={e => setPromptText(e.target.value)} className="min-h-[120px] font-mono text-xs" />
          </div>

          <PromptAttachmentsSection
            promptId={prompt?.id ?? null}
            attachments={attachments}
            loading={attachmentsLoading}
            uploading={uploading}
            onFetch={fetchAttachments}
            onUpload={uploadAttachment}
            onDelete={deleteAttachment}
          />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Категория</Label>
              <Input value={category} onChange={e => setCategory(e.target.value)} />
            </div>
            <div>
              <Label>Иконка</Label>
              <Input value={icon} onChange={e => setIcon(e.target.value)} placeholder="FileText" />
            </div>
          </div>

          <div>
            <Label>Подсказка для ввода</Label>
            <Input value={inputHint} onChange={e => setInputHint(e.target.value)} placeholder="Загрузите файл для анализа" />
          </div>

          <div>
            <Label>Формат ответа (JSON)</Label>
            <Textarea
              value={responseFormatStr}
              onChange={e => {
                setResponseFormatStr(e.target.value);
                validateResponseFormat(e.target.value);
              }}
              className="min-h-[80px] font-mono text-xs"
              placeholder='{"sections": ["summary", "risks"]}'
            />
            {responseFormatError && <p className="text-xs text-destructive mt-1">{responseFormatError}</p>}
          </div>

          <div className="border rounded-lg p-4 space-y-3">
            <h4 className="text-sm font-medium">Настройки launcher (чат)</h4>
            <div>
              <Label>Заголовок в launcher</Label>
              <Input value={launcherTitle} onChange={e => setLauncherTitle(e.target.value)} placeholder="Анализ баланса компании" />
            </div>
            <div>
              <Label>Описание в launcher</Label>
              <Input value={launcherDescription} onChange={e => setLauncherDescription(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Порядок в launcher</Label>
                <Input type="number" min={0} value={launcherOrder} onChange={e => setLauncherOrder(Number(e.target.value))} />
              </div>
              <div>
                <Label>Порядок сортировки</Label>
                <Input type="number" min={0} value={sortOrder} onChange={e => setSortOrder(Number(e.target.value))} />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Switch checked={isActive} onCheckedChange={setIsActive} />
              <Label>Активен</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={isVisibleInChat} onCheckedChange={setIsVisibleInChat} />
              <Label>Виден в чате</Label>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button onClick={handleSave} disabled={!isValid || saving}>
            {saving ? "Сохранение..." : prompt ? "Сохранить" : "Создать"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
