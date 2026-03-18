import { RichTextarea } from "@/components/ui/RichTextarea";
import { SafeHtml } from "@/components/ui/SafeHtml";
import { TextContent } from "@/hooks/useLessonBlocks";

interface TextBlockProps {
  content: TextContent;
  onChange: (content: TextContent) => void;
  isEditing?: boolean;
}

export function TextBlock({ content, onChange, isEditing = true }: TextBlockProps) {
  if (!isEditing) {
    return (
      <div 
        className="prose prose-sm max-w-none dark:prose-invert"
        dangerouslySetInnerHTML={{ __html: content.html || "" }}
      />
    );
  }

  return (
    <RichTextarea
      value={content.html || ""}
      onChange={(html) => onChange({ html })}
      placeholder="Введите текст (поддерживается HTML)..."
      minHeight="100px"
    />
  );
}
