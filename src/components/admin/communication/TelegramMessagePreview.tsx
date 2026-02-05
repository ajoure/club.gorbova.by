import { useMemo } from "react";

interface TelegramMessagePreviewProps {
  text: string;
}

export function TelegramMessagePreview({ text }: TelegramMessagePreviewProps) {
  const formattedHtml = useMemo(() => {
    if (!text) return "";
    
    let html = text
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
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<a href='$2' class='text-primary underline' target='_blank' rel='noopener'>$1</a>")
      // Newlines
      .replace(/\n/g, "<br />");
    
    return html;
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
