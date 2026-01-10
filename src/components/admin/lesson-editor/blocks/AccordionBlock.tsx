import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { 
  Accordion, 
  AccordionContent, 
  AccordionItem, 
  AccordionTrigger 
} from "@/components/ui/accordion";
import { Plus, Trash2, GripVertical } from "lucide-react";

export interface AccordionItem {
  id: string;
  title: string;
  content: string;
}

export interface AccordionContent {
  items: AccordionItem[];
  allowMultiple?: boolean;
}

interface AccordionBlockProps {
  content: AccordionContent;
  onChange: (content: AccordionContent) => void;
  isEditing?: boolean;
}

export function AccordionBlock({ content, onChange, isEditing = true }: AccordionBlockProps) {
  const items = content.items || [];

  const addItem = () => {
    const newItem: AccordionItem = {
      id: crypto.randomUUID(),
      title: "",
      content: "",
    };
    onChange({ ...content, items: [...items, newItem] });
  };

  const updateItem = (id: string, field: "title" | "content", value: string) => {
    onChange({
      ...content,
      items: items.map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      ),
    });
  };

  const removeItem = (id: string) => {
    onChange({ ...content, items: items.filter((item) => item.id !== id) });
  };

  if (!isEditing) {
    return (
      <Accordion type={content.allowMultiple ? "multiple" : "single"} collapsible className="w-full">
        {items.map((item, index) => (
          <AccordionItem key={item.id} value={item.id} className="border rounded-lg mb-2 px-4 bg-card/50 backdrop-blur-sm">
            <AccordionTrigger className="hover:no-underline text-left">
              <span className="font-medium">{item.title || `Секция ${index + 1}`}</span>
            </AccordionTrigger>
            <AccordionContent>
              <div 
                className="prose prose-sm max-w-none dark:prose-invert pb-2"
                dangerouslySetInnerHTML={{ __html: item.content }}
              />
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div 
          key={item.id} 
          className="border rounded-xl p-4 bg-card/30 backdrop-blur-sm space-y-3"
        >
          <div className="flex items-center gap-2">
            <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
            <span className="text-xs text-muted-foreground font-medium">
              Секция {index + 1}
            </span>
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => removeItem(item.id)}
              className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <Input
            value={item.title}
            onChange={(e) => updateItem(item.id, "title", e.target.value)}
            placeholder="Заголовок секции..."
            className="font-medium"
          />
          <Textarea
            value={item.content}
            onChange={(e) => updateItem(item.id, "content", e.target.value)}
            placeholder="Содержимое секции (HTML)..."
            className="min-h-[80px] font-mono text-sm"
          />
        </div>
      ))}
      <Button
        variant="outline"
        onClick={addItem}
        className="w-full border-dashed"
      >
        <Plus className="h-4 w-4 mr-2" />
        Добавить секцию
      </Button>
    </div>
  );
}
