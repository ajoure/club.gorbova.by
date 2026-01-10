import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SpoilerContent {
  buttonText: string;
  content: string;
}

interface SpoilerBlockProps {
  content: SpoilerContent;
  onChange: (content: SpoilerContent) => void;
  isEditing?: boolean;
}

export function SpoilerBlock({ content, onChange, isEditing = true }: SpoilerBlockProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!isEditing) {
    return (
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <Button 
            variant="outline" 
            className="w-full justify-between bg-card/50 backdrop-blur-sm border-dashed hover:bg-card/80 transition-all"
          >
            <span className="flex items-center gap-2">
              {isOpen ? (
                <EyeOff className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Eye className="h-4 w-4 text-muted-foreground" />
              )}
              {content.buttonText || "Показать ответ"}
            </span>
            <ChevronDown className={cn(
              "h-4 w-4 text-muted-foreground transition-transform duration-200",
              isOpen && "rotate-180"
            )} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up">
          <div 
            className="prose prose-sm max-w-none dark:prose-invert p-4 mt-2 rounded-xl bg-card/30 backdrop-blur-sm border border-dashed"
            dangerouslySetInnerHTML={{ __html: content.content }}
          />
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <div className="space-y-3">
      <Input
        value={content.buttonText || ""}
        onChange={(e) => onChange({ ...content, buttonText: e.target.value })}
        placeholder="Текст кнопки (например: Показать ответ)..."
      />
      <Textarea
        value={content.content || ""}
        onChange={(e) => onChange({ ...content, content: e.target.value })}
        placeholder="Скрытое содержимое (HTML)..."
        className="min-h-[100px] font-mono text-sm"
      />
    </div>
  );
}
