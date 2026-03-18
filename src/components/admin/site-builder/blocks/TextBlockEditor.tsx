import { RichTextarea } from "@/components/ui/RichTextarea";

interface TextBlockEditorProps {
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
}

export function TextBlockEditor({ content, onChange }: TextBlockEditorProps) {
  return (
    <RichTextarea
      value={(content.html as string) || ""}
      onChange={(html) => onChange({ ...content, html })}
      placeholder="Введите текст..."
      minHeight="120px"
    />
  );
}
