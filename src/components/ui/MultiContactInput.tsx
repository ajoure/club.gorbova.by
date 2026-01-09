import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Star, Mail, Phone } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ContactItem {
  value: string;
  is_primary: boolean;
  label?: string;
}

interface MultiContactInputProps {
  type: "phone" | "email";
  value: ContactItem[];
  onChange: (contacts: ContactItem[]) => void;
  disabled?: boolean;
  className?: string;
}

export function MultiContactInput({
  type,
  value = [],
  onChange,
  disabled = false,
  className
}: MultiContactInputProps) {
  const [newValue, setNewValue] = useState("");

  const Icon = type === "phone" ? Phone : Mail;
  const placeholder = type === "phone" ? "+375 29 123-45-67" : "email@example.com";
  const title = type === "phone" ? "Телефоны" : "Email адреса";

  const handleAdd = () => {
    if (!newValue.trim()) return;
    
    const newContact: ContactItem = {
      value: newValue.trim(),
      is_primary: value.length === 0, // First one is primary by default
      label: ""
    };
    
    onChange([...value, newContact]);
    setNewValue("");
  };

  const handleRemove = (index: number) => {
    const updated = value.filter((_, i) => i !== index);
    // If we removed the primary, make the first one primary
    if (value[index]?.is_primary && updated.length > 0) {
      updated[0].is_primary = true;
    }
    onChange(updated);
  };

  const handleSetPrimary = (index: number) => {
    const updated = value.map((item, i) => ({
      ...item,
      is_primary: i === index
    }));
    onChange(updated);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {title}
        </span>
      </div>

      {/* Existing contacts */}
      <div className="space-y-2">
        {value.map((contact, index) => (
          <div
            key={index}
            className="flex items-center gap-2 p-2 rounded-lg border border-border bg-card"
          >
            <span className="flex-1 text-sm truncate">{contact.value}</span>
            
            {contact.is_primary ? (
              <Badge variant="secondary" className="gap-1 shrink-0">
                <Star className="h-3 w-3 fill-current" />
                Основной
              </Badge>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleSetPrimary(index)}
                disabled={disabled}
                className="shrink-0 text-xs h-7"
              >
                Сделать основным
              </Button>
            )}
            
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => handleRemove(index)}
              disabled={disabled}
              className="shrink-0 h-7 w-7 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      {/* Add new */}
      <div className="flex gap-2">
        <Input
          type={type === "email" ? "email" : "tel"}
          placeholder={placeholder}
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          className="flex-1"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={handleAdd}
          disabled={disabled || !newValue.trim()}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
