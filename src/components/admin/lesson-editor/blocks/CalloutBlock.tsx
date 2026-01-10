import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { 
  AlertCircle, 
  CheckCircle2, 
  Info, 
  Lightbulb, 
  AlertTriangle,
  Quote,
  FileText
} from "lucide-react";
import { cn } from "@/lib/utils";

export type CalloutType = 'info' | 'success' | 'warning' | 'error' | 'tip' | 'quote' | 'summary';

export interface CalloutContent {
  type: CalloutType;
  content: string;
  title?: string;
}

interface CalloutBlockProps {
  content: CalloutContent;
  onChange: (content: CalloutContent) => void;
  isEditing?: boolean;
}

const calloutConfig: Record<CalloutType, { 
  icon: React.ElementType; 
  label: string; 
  className: string;
  iconClass: string;
}> = {
  info: { 
    icon: Info, 
    label: "Информация", 
    className: "bg-blue-500/10 border-blue-500/30",
    iconClass: "text-blue-500"
  },
  success: { 
    icon: CheckCircle2, 
    label: "Успех / Вывод", 
    className: "bg-green-500/10 border-green-500/30",
    iconClass: "text-green-500"
  },
  warning: { 
    icon: AlertTriangle, 
    label: "Внимание", 
    className: "bg-amber-500/10 border-amber-500/30",
    iconClass: "text-amber-500"
  },
  error: { 
    icon: AlertCircle, 
    label: "Важно / Ошибка", 
    className: "bg-red-500/10 border-red-500/30",
    iconClass: "text-red-500"
  },
  tip: { 
    icon: Lightbulb, 
    label: "Совет", 
    className: "bg-purple-500/10 border-purple-500/30",
    iconClass: "text-purple-500"
  },
  quote: { 
    icon: Quote, 
    label: "Цитата", 
    className: "bg-muted/50 border-muted-foreground/30 italic",
    iconClass: "text-muted-foreground"
  },
  summary: { 
    icon: FileText, 
    label: "Итог / Резюме", 
    className: "bg-cyan-500/10 border-cyan-500/30",
    iconClass: "text-cyan-500"
  },
};

export function CalloutBlock({ content, onChange, isEditing = true }: CalloutBlockProps) {
  const type = content.type || 'info';
  const config = calloutConfig[type];
  const Icon = config.icon;

  if (!isEditing) {
    return (
      <div className={cn(
        "flex gap-3 p-4 rounded-xl border backdrop-blur-sm",
        config.className
      )}>
        <Icon className={cn("h-5 w-5 mt-0.5 flex-shrink-0", config.iconClass)} />
        <div className="flex-1 min-w-0">
          {content.title && (
            <div className="font-semibold mb-1">{content.title}</div>
          )}
          <div 
            className="prose prose-sm max-w-none dark:prose-invert"
            dangerouslySetInnerHTML={{ __html: content.content }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Select 
        value={type} 
        onValueChange={(value: CalloutType) => onChange({ ...content, type: value })}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Выберите тип" />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(calloutConfig) as CalloutType[]).map((key) => {
            const cfg = calloutConfig[key];
            const ItemIcon = cfg.icon;
            return (
              <SelectItem key={key} value={key}>
                <span className="flex items-center gap-2">
                  <ItemIcon className={cn("h-4 w-4", cfg.iconClass)} />
                  {cfg.label}
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      
      <div className={cn(
        "rounded-xl border p-4 space-y-3",
        config.className
      )}>
        <div className="flex items-center gap-2">
          <Icon className={cn("h-5 w-5", config.iconClass)} />
          <input
            type="text"
            value={content.title || ""}
            onChange={(e) => onChange({ ...content, title: e.target.value })}
            placeholder="Заголовок (опционально)..."
            className="flex-1 bg-transparent border-none outline-none font-semibold placeholder:text-muted-foreground/50"
          />
        </div>
        <Textarea
          value={content.content || ""}
          onChange={(e) => onChange({ ...content, content: e.target.value })}
          placeholder="Содержимое блока (HTML)..."
          className="min-h-[80px] font-mono text-sm bg-background/50"
        />
      </div>
    </div>
  );
}
