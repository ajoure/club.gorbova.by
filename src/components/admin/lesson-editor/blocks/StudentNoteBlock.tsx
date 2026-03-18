import { useState, useEffect, useRef, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SafeHtml } from "@/components/ui/SafeHtml";
import { Card, CardContent } from "@/components/ui/card";
import { PenLine, Check, Loader2 } from "lucide-react";

export interface StudentNoteContentData {
  title: string;
  hint?: string;
  required: boolean;
  // Backward compat: old blocks may have mode/placeholder — we just ignore them
  mode?: "short" | "long";
  placeholder?: string;
}

interface StudentNoteBlockProps {
  content: StudentNoteContentData;
  onChange: (content: StudentNoteContentData) => void;
  isEditing?: boolean;
  // Student-view props
  blockId?: string;
  lessonId?: string;
  savedResponse?: any;
  onSave?: (text: string) => Promise<void>;
}

export function StudentNoteBlock({
  content,
  onChange,
  isEditing = true,
  blockId,
  lessonId,
  savedResponse,
  onSave,
}: StudentNoteBlockProps) {
  // Admin mode
  if (isEditing) {
    return (
      <div className="space-y-4">
        <div>
          <Label>Заголовок вопроса</Label>
          <Input
            value={content.title || ""}
            onChange={(e) => onChange({ ...content, title: e.target.value })}
            placeholder="Например: Опишите вашу ситуацию"
          />
        </div>
        <div>
          <Label>Подсказка (необязательно)</Label>
          <Input
            value={content.hint || ""}
            onChange={(e) => onChange({ ...content, hint: e.target.value })}
            placeholder="Подсказка для ученика"
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={content.required ?? false}
            onCheckedChange={(v) => onChange({ ...content, required: v })}
          />
          <Label>Обязательный</Label>
        </div>
      </div>
    );
  }

  // Student mode
  return (
    <StudentNoteStudentView
      content={content}
      blockId={blockId}
      lessonId={lessonId}
      savedResponse={savedResponse}
      onSave={onSave}
    />
  );
}

function StudentNoteStudentView({
  content,
  blockId,
  lessonId,
  savedResponse,
  onSave,
}: {
  content: StudentNoteContentData;
  blockId?: string;
  lessonId?: string;
  savedResponse?: any;
  onSave?: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedRef = useRef(false);

  // Load saved response once
  useEffect(() => {
    if (!initializedRef.current && savedResponse?.type === "note" && savedResponse.text) {
      setText(savedResponse.text);
      initializedRef.current = true;
    }
  }, [savedResponse]);

  const doSave = useCallback(
    async (value: string) => {
      if (!onSave || !blockId || !lessonId) return;
      setSaveStatus("saving");
      try {
        await onSave(value);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
      } catch {
        setSaveStatus("idle");
      }
    },
    [onSave, blockId, lessonId]
  );

  const handleChange = (value: string) => {
    setText(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (value.trim()) doSave(value);
    }, 1500);
  };

  // STOP-guard
  if (!blockId || !lessonId) {
    return (
      <Card className="border-dashed">
        <CardContent className="pt-4 text-center text-muted-foreground">
          Блок ввода недоступен (нет контекста урока)
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/20">
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <PenLine className="h-5 w-5 text-primary shrink-0" />
            <div>
              <p className="font-medium" dangerouslySetInnerHTML={{ __html: content.title || "Ваш ответ" }} />
              {content.hint && (
                <p className="text-sm text-muted-foreground" dangerouslySetInnerHTML={{ __html: content.hint }} />
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
            {saveStatus === "saving" && (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Сохранение...
              </>
            )}
            {saveStatus === "saved" && (
              <>
                <Check className="h-3 w-3 text-green-500" />
                Сохранено
              </>
            )}
          </div>
        </div>

        <Textarea
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={content.hint || "Введите ваш ответ..."}
          rows={3}
          className="resize-y min-h-[80px]"
        />

        {content.required && !text.trim() && (
          <p className="text-xs text-destructive">* Обязательное поле</p>
        )}
      </CardContent>
    </Card>
  );
}
