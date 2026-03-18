import { useState } from "react";
import { RichTextarea } from "@/components/ui/RichTextarea";
import { SafeHtml } from "@/components/ui/SafeHtml";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HeadingContent } from "@/hooks/useLessonBlocks";

interface HeadingBlockProps {
  content: HeadingContent;
  onChange: (content: HeadingContent) => void;
  isEditing?: boolean;
}

export function HeadingBlock({ content, onChange, isEditing = true }: HeadingBlockProps) {
  const handleLevelChange = (level: string) => {
    onChange({ ...content, level: parseInt(level) as 1 | 2 | 3 | 4 });
  };

  if (!isEditing) {
    const Tag = `h${content.level || 2}` as keyof JSX.IntrinsicElements;
    const sizeClasses = {
      1: "text-3xl font-bold",
      2: "text-2xl font-semibold",
      3: "text-xl font-semibold",
      4: "text-lg font-medium",
    };
    return (
      <SafeHtml 
        html={content.text || "Заголовок"}
        as={Tag as any}
        className={sizeClasses[content.level || 2]}
      />
    );
  }

  return (
    <div className="flex gap-2 items-start">
      <Select value={String(content.level || 2)} onValueChange={handleLevelChange}>
        <SelectTrigger className="w-20 shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="1">H1</SelectItem>
          <SelectItem value="2">H2</SelectItem>
          <SelectItem value="3">H3</SelectItem>
          <SelectItem value="4">H4</SelectItem>
        </SelectContent>
      </Select>
      <RichTextarea
        value={content.text || ""}
        onChange={(html) => onChange({ ...content, text: html })}
        placeholder="Введите заголовок..."
        inline
        className="flex-1 text-lg font-semibold"
      />
    </div>
  );
}
