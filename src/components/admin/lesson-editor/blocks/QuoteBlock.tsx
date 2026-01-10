import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Quote } from "lucide-react";

export interface QuoteContent {
  text: string;
  author?: string;
  source?: string;
}

interface QuoteBlockProps {
  content: QuoteContent;
  onChange: (content: QuoteContent) => void;
  isEditing?: boolean;
}

export function QuoteBlock({ content, onChange, isEditing = true }: QuoteBlockProps) {
  if (!isEditing) {
    return (
      <blockquote className="relative pl-6 pr-4 py-4 bg-muted/30 backdrop-blur-sm rounded-xl border-l-4 border-primary/50 italic">
        <Quote className="absolute -left-3 -top-3 h-6 w-6 text-primary/30 rotate-180" />
        <div className="prose prose-sm max-w-none dark:prose-invert">
          <p className="text-lg leading-relaxed mb-2">
            "{content.text}"
          </p>
          {(content.author || content.source) && (
            <footer className="text-sm text-muted-foreground not-italic mt-3">
              {content.author && <span className="font-medium">— {content.author}</span>}
              {content.source && <span className="ml-1">({content.source})</span>}
            </footer>
          )}
        </div>
      </blockquote>
    );
  }

  return (
    <div className="space-y-3">
      <Textarea
        value={content.text || ""}
        onChange={(e) => onChange({ ...content, text: e.target.value })}
        placeholder="Текст цитаты..."
        className="min-h-[80px] italic"
      />
      <div className="grid grid-cols-2 gap-3">
        <Input
          value={content.author || ""}
          onChange={(e) => onChange({ ...content, author: e.target.value })}
          placeholder="Автор..."
        />
        <Input
          value={content.source || ""}
          onChange={(e) => onChange({ ...content, source: e.target.value })}
          placeholder="Источник..."
        />
      </div>
    </div>
  );
}
