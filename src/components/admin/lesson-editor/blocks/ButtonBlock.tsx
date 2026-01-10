import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ButtonContent } from "@/hooks/useLessonBlocks";
import { Plus, Trash2, ExternalLink, GripVertical } from "lucide-react";

interface ButtonBlockProps {
  content: ButtonContent;
  onChange: (content: ButtonContent) => void;
  isEditing?: boolean;
}

export function ButtonBlock({ content, onChange, isEditing = true }: ButtonBlockProps) {
  const buttons = content.buttons || [];

  const handleAddButton = () => {
    onChange({
      buttons: [...buttons, { label: "", url: "" }]
    });
  };

  const handleRemoveButton = (index: number) => {
    const newButtons = buttons.filter((_, i) => i !== index);
    onChange({ buttons: newButtons });
  };

  const handleButtonChange = (index: number, field: 'label' | 'url', value: string) => {
    const newButtons = [...buttons];
    newButtons[index] = { ...newButtons[index], [field]: value };
    onChange({ buttons: newButtons });
  };

  if (!isEditing) {
    if (buttons.length === 0) {
      return null;
    }
    
    return (
      <div className="flex flex-wrap gap-2">
        {buttons.map((btn, index) => (
          <a
            key={index}
            href={btn.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            {btn.label || "Ссылка"}
            <ExternalLink className="h-4 w-4" />
          </a>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {buttons.map((btn, index) => (
        <div key={index} className="flex gap-2 items-start p-2 border rounded-lg bg-muted/30">
          <GripVertical className="h-5 w-5 text-muted-foreground mt-2.5 shrink-0" />
          <div className="flex-1 grid grid-cols-2 gap-2">
            <Input
              value={btn.label}
              onChange={(e) => handleButtonChange(index, 'label', e.target.value)}
              placeholder="Текст кнопки"
            />
            <Input
              value={btn.url}
              onChange={(e) => handleButtonChange(index, 'url', e.target.value)}
              placeholder="https://..."
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleRemoveButton(index)}
            className="shrink-0 text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      
      <Button
        variant="outline"
        size="sm"
        onClick={handleAddButton}
        className="w-full"
      >
        <Plus className="h-4 w-4 mr-2" />
        Добавить кнопку
      </Button>
    </div>
  );
}
