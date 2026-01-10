import { Separator } from "@/components/ui/separator";

interface DividerBlockProps {
  isEditing?: boolean;
}

export function DividerBlock({ isEditing = true }: DividerBlockProps) {
  return (
    <div className={isEditing ? "py-2" : "py-4"}>
      <Separator />
    </div>
  );
}
