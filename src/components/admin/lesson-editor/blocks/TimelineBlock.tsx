import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TimelineItem {
  id: string;
  title: string;
  description: string;
  date?: string;
}

export interface TimelineContent {
  items: TimelineItem[];
}

interface TimelineBlockProps {
  content: TimelineContent;
  onChange: (content: TimelineContent) => void;
  isEditing?: boolean;
}

export function TimelineBlock({ content, onChange, isEditing = true }: TimelineBlockProps) {
  const items = content.items || [];

  const addItem = () => {
    const newItem: TimelineItem = {
      id: crypto.randomUUID(),
      title: "",
      description: "",
      date: "",
    };
    onChange({ ...content, items: [...items, newItem] });
  };

  const updateItem = (id: string, field: keyof TimelineItem, value: string) => {
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
      <div className="relative pl-8">
        {/* Vertical line */}
        <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-gradient-to-b from-primary/50 via-primary to-primary/50 rounded-full" />
        
        <div className="space-y-6">
          {items.map((item, index) => (
            <div key={item.id} className="relative">
              {/* Dot */}
              <div className={cn(
                "absolute -left-8 top-1 w-6 h-6 rounded-full flex items-center justify-center",
                "bg-primary/20 border-2 border-primary"
              )}>
                <Circle className="h-2 w-2 fill-primary text-primary" />
              </div>
              
              <div className="bg-card/30 backdrop-blur-sm rounded-xl p-4 border border-border/50">
                {item.date && (
                  <div className="text-xs text-muted-foreground mb-1 font-medium">
                    {item.date}
                  </div>
                )}
                <div className="font-semibold text-foreground">
                  {item.title || `Шаг ${index + 1}`}
                </div>
                {item.description && (
                  <div 
                    className="prose prose-sm max-w-none dark:prose-invert mt-2 text-muted-foreground"
                    dangerouslySetInnerHTML={{ __html: item.description }}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
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
            <div className="w-6 h-6 rounded-full bg-primary/20 border-2 border-primary flex items-center justify-center">
              <span className="text-xs font-bold text-primary">{index + 1}</span>
            </div>
            <span className="text-sm text-muted-foreground font-medium">
              Точка {index + 1}
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
          <div className="grid grid-cols-2 gap-3">
            <Input
              value={item.title}
              onChange={(e) => updateItem(item.id, "title", e.target.value)}
              placeholder="Заголовок..."
              className="font-medium"
            />
            <Input
              value={item.date || ""}
              onChange={(e) => updateItem(item.id, "date", e.target.value)}
              placeholder="Дата / метка..."
            />
          </div>
          <Textarea
            value={item.description}
            onChange={(e) => updateItem(item.id, "description", e.target.value)}
            placeholder="Описание (HTML)..."
            className="min-h-[60px] font-mono text-sm"
          />
        </div>
      ))}
      <Button
        variant="outline"
        onClick={addItem}
        className="w-full border-dashed"
      >
        <Plus className="h-4 w-4 mr-2" />
        Добавить точку
      </Button>
    </div>
  );
}
