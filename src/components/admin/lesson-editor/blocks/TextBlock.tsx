import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { TextContent } from "@/hooks/useLessonBlocks";

interface TextBlockProps {
  content: TextContent;
  onChange: (content: TextContent) => void;
  isEditing?: boolean;
}

export function TextBlock({ content, onChange, isEditing = true }: TextBlockProps) {
  const [localHtml, setLocalHtml] = useState(content.html || "");
  
  const handleBlur = () => {
    onChange({ html: localHtml });
  };

  if (!isEditing) {
    return (
      <div 
        className="prose prose-sm max-w-none dark:prose-invert"
        dangerouslySetInnerHTML={{ __html: content.html || "" }}
      />
    );
  }

  return (
    <Textarea
      value={localHtml}
      onChange={(e) => setLocalHtml(e.target.value)}
      onBlur={handleBlur}
      placeholder="Введите текст (поддерживается HTML)..."
      className="min-h-[100px] font-mono text-sm"
    />
  );
}
