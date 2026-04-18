import { RichTextarea } from "@/components/ui/RichTextarea";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";

interface FaqItem {
  question: string;
  answer: string;
}

interface FaqBlockEditorProps {
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
}

export function FaqBlockEditor({ content, onChange }: FaqBlockEditorProps) {
  const items = (content.items as FaqItem[]) || [];

  const addItem = () => {
    onChange({ ...content, items: [...items, { question: "", answer: "" }] });
  };

  const updateItem = (idx: number, field: string, value: string) => {
    const updated = items.map((item, i) => (i === idx ? { ...item, [field]: value } : item));
    onChange({ ...content, items: updated });
  };

  const removeItem = (idx: number) => {
    onChange({ ...content, items: items.filter((_, i) => i !== idx) });
  };

  return (
    <div className="space-y-3">
      {items.map((item, idx) => (
        <div key={idx} className="border rounded p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Вопрос {idx + 1}</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeItem(idx)}>
              <Trash2 className="h-3 w-3 text-destructive" />
            </Button>
          </div>
          <RichTextarea inline value={item.question} onChange={(v) => updateItem(idx, "question", v)} placeholder="Вопрос" />
          <RichTextarea value={item.answer} onChange={(v) => updateItem(idx, "answer", v)} placeholder="Ответ" minHeight="60px" />
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={addItem}>
        <Plus className="h-3.5 w-3.5 mr-1" />
        Добавить вопрос
      </Button>
    </div>
  );
}
