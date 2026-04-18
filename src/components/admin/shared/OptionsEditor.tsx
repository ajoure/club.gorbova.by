/**
 * Малый общий компонент: редактор списка вариантов (для select/multiselect полей формы).
 * Не лезем в lesson-editor quiz-блоки в этом спринте — оставляем для будущего reuse.
 */
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";

interface OptionsEditorProps {
  options: string[];
  onChange: (options: string[]) => void;
  label?: string;
  placeholder?: string;
}

export function OptionsEditor({
  options,
  onChange,
  label = "Варианты ответа",
  placeholder = "Вариант",
}: OptionsEditorProps) {
  const list = Array.isArray(options) ? options : [];

  const update = (i: number, v: string) => {
    const next = list.map((o, idx) => (idx === i ? v : o));
    onChange(next);
  };
  const add = () => onChange([...list, ""]);
  const remove = (i: number) => onChange(list.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {list.length === 0 && (
        <p className="text-[11px] text-muted-foreground">Нет вариантов. Добавьте хотя бы один.</p>
      )}
      {list.map((opt, i) => (
        <div key={i} className="flex items-center gap-1">
          <Input
            value={opt}
            onChange={(e) => update(i, e.target.value)}
            placeholder={`${placeholder} ${i + 1}`}
            className="h-8 text-xs"
          />
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => move(i, -1)} disabled={i === 0}>
            <ArrowUp className="h-3 w-3" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => move(i, 1)} disabled={i === list.length - 1}>
            <ArrowDown className="h-3 w-3" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(i)}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="w-full h-7 text-xs" onClick={add}>
        <Plus className="h-3 w-3 mr-1" /> Добавить вариант
      </Button>
    </div>
  );
}
