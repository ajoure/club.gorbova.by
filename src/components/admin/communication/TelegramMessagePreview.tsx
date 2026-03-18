import { useMemo } from "react";
import { SafeHtml } from "@/components/ui/SafeHtml";

interface TelegramMessagePreviewProps {
  text: string;
}

export function TelegramMessagePreview({ text }: TelegramMessagePreviewProps) {
  const formattedHtml = useMemo(() => {
    if (!text) return "";
    
    // Process lines individually to handle [[align:...]] prefixes
    const lines = text.split("\n");
    const processedLines = lines.map((line) => {
      const alignMatch = line.match(/^\[\[align:(left|center|right)\]\]/);
      const align = alignMatch ? alignMatch[1] : null;
      const cleanLine = alignMatch ? line.slice(alignMatch[0].length) : line;
      
      let html = cleanLine
        // Escape HTML
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        // Bold: *text*
        .replace(/\*([^*]+)\*/g, "<strong>$1</strong>")
        // Italic: _text_
        .replace(/\_([^_]+)\_/g, "<em>$1</em>")
        // Code: `text`
        .replace(/\`([^`]+)\`/g, "<code class='bg-muted px-1 rounded text-sm font-mono'>$1</code>")
        // Links: [text](url)
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<a href='$2' class='text-primary underline' target='_blank' rel='noopener'>$1</a>");
      
      const style = align ? ` style="text-align:${align};"` : "";
      return `<div${style}>${html || "&nbsp;"}</div>`;
    });
    
    return processedLines.join("");
  }, [text]);

  if (!text) {
    return (
      <div className="text-muted-foreground text-sm italic">
        Введите текст сообщения...
      </div>
    );
  }

  return (
    <div 
      className="prose prose-sm dark:prose-invert max-w-none"
      dangerouslySetInnerHTML={{ __html: formattedHtml }}
    />
  );
}
