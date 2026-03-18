import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeToISO } from "@/services/sitePages/adapters/TimerAdapter";

interface TimerBlockEditorProps {
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
}

export function TimerBlockEditor({ content, onChange }: TimerBlockEditorProps) {
  const handleDateChange = (value: string) => {
    const iso = normalizeToISO(value);
    onChange({ ...content, targetDate: iso || value });
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Заголовок</Label>
        <Input
          value={(content.title as string) || ""}
          onChange={(e) => onChange({ ...content, title: e.target.value })}
        />
      </div>
      <div>
        <Label className="text-xs">Дата окончания</Label>
        <Input
          type="datetime-local"
          value={
            (content.targetDate as string)
              ? new Date(content.targetDate as string).toISOString().slice(0, 16)
              : ""
          }
          onChange={(e) => handleDateChange(e.target.value)}
        />
      </div>
      <div>
        <Label className="text-xs">Сообщение после окончания</Label>
        <Input
          value={(content.expiredMessage as string) || "Время вышло"}
          onChange={(e) => onChange({ ...content, expiredMessage: e.target.value })}
        />
      </div>
    </div>
  );
}
