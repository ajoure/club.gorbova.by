import { RichTextarea } from "@/components/ui/RichTextarea";
import { SafeHtml } from "@/components/ui/SafeHtml";
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
          <div className="text-lg leading-relaxed mb-2">
            "<SafeHtml html={content.text} />"
          </div>
          {(content.author || content.source) && (
            <footer className="text-sm text-muted-foreground not-italic mt-3">
              {content.author && <span className="font-medium">— <SafeHtml html={content.author} /></span>}
              {content.source && <span className="ml-1">(<SafeHtml html={content.source} />)</span>}
            </footer>
          )}
        </div>
      </blockquote>
    );
  }

  return (
    <div className="space-y-3">
      <RichTextarea
        value={content.text || ""}
        onChange={(html) => onChange({ ...content, text: html })}
        placeholder="Текст цитаты..."
        minHeight="80px"
      />
      <div className="grid grid-cols-2 gap-3">
        <RichTextarea
          value={content.author || ""}
          onChange={(html) => onChange({ ...content, author: html })}
          placeholder="Автор..."
          inline
        />
        <RichTextarea
          value={content.source || ""}
          onChange={(html) => onChange({ ...content, source: html })}
          placeholder="Источник..."
          inline
        />
      </div>
    </div>
  );
}
