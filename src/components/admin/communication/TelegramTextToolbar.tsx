import { Button } from "@/components/ui/button";
import { Bold, Italic, Code, Link } from "lucide-react";

interface TelegramTextToolbarProps {
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  value: string;
  onChange: (value: string) => void;
}

export function TelegramTextToolbar({ textareaRef, value, onChange }: TelegramTextToolbarProps) {
  const wrapSelection = (prefix: string, suffix: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = value.substring(start, end);
    
    const newText = 
      value.substring(0, start) + 
      prefix + selectedText + suffix + 
      value.substring(end);
    
    onChange(newText);
    
    // Restore cursor position
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(
        start + prefix.length,
        end + prefix.length
      );
    }, 0);
  };

  const handleLinkClick = () => {
    const url = prompt('Введите URL:');
    if (url) wrapSelection('[', `](${url})`);
  };

  return (
    <div className="flex gap-1 mb-2">
      <Button 
        type="button" 
        variant="outline" 
        size="sm" 
        onClick={() => wrapSelection('*', '*')}
        title="Жирный"
      >
        <Bold className="h-4 w-4" />
      </Button>
      <Button 
        type="button" 
        variant="outline" 
        size="sm" 
        onClick={() => wrapSelection('_', '_')}
        title="Курсив"
      >
        <Italic className="h-4 w-4" />
      </Button>
      <Button 
        type="button" 
        variant="outline" 
        size="sm" 
        onClick={() => wrapSelection('`', '`')}
        title="Код"
      >
        <Code className="h-4 w-4" />
      </Button>
      <Button 
        type="button" 
        variant="outline" 
        size="sm" 
        onClick={handleLinkClick}
        title="Ссылка"
      >
        <Link className="h-4 w-4" />
      </Button>
    </div>
  );
}
