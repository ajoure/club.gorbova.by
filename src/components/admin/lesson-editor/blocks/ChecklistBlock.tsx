import { useState, useCallback, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { RichTextarea } from "@/components/ui/RichTextarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { SafeHtml } from "@/components/ui/SafeHtml";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Trash2, GripVertical, FolderPlus, ListChecks, Check, Loader2 } from "lucide-react";

export interface ChecklistItem {
  id: string;
  label: string;
  description?: string;
}

export interface ChecklistGroup {
  id: string;
  title: string;
  items: ChecklistItem[];
}

export interface ChecklistContentData {
  title?: string;
  description?: string;
  groups: ChecklistGroup[];
}

interface ChecklistBlockProps {
  content: ChecklistContentData;
  onChange: (content: ChecklistContentData) => void;
  isEditing?: boolean;
  blockId?: string;
  lessonId?: string;
  savedResponse?: any;
  onSave?: (checkedIds: string[]) => Promise<void>;
}

function generateId() {
  return crypto.randomUUID().slice(0, 8);
}

// ─── Admin Editor ───
function ChecklistEditor({ content, onChange }: { content: ChecklistContentData; onChange: (c: ChecklistContentData) => void }) {
  const addGroup = () => {
    onChange({
      ...content,
      groups: [...content.groups, { id: generateId(), title: "Новая группа", items: [] }],
    });
  };

  const updateGroup = (gIdx: number, patch: Partial<ChecklistGroup>) => {
    const groups = content.groups.map((g, i) => i === gIdx ? { ...g, ...patch } : g);
    onChange({ ...content, groups });
  };

  const removeGroup = (gIdx: number) => {
    onChange({ ...content, groups: content.groups.filter((_, i) => i !== gIdx) });
  };

  const addItem = (gIdx: number) => {
    const groups = [...content.groups];
    groups[gIdx] = {
      ...groups[gIdx],
      items: [...groups[gIdx].items, { id: generateId(), label: "", description: "" }],
    };
    onChange({ ...content, groups });
  };

  const updateItem = (gIdx: number, iIdx: number, patch: Partial<ChecklistItem>) => {
    const groups = [...content.groups];
    groups[gIdx] = {
      ...groups[gIdx],
      items: groups[gIdx].items.map((item, i) => i === iIdx ? { ...item, ...patch } : item),
    };
    onChange({ ...content, groups });
  };

  const removeItem = (gIdx: number, iIdx: number) => {
    const groups = [...content.groups];
    groups[gIdx] = {
      ...groups[gIdx],
      items: groups[gIdx].items.filter((_, i) => i !== iIdx),
    };
    onChange({ ...content, groups });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3">
        <div className="space-y-1.5">
          <Label>Заголовок</Label>
          <RichTextarea
            value={content.title || ''}
            onChange={(html) => onChange({ ...content, title: html })}
            placeholder="Чек-лист действий"
            inline
          />
        </div>
        <div className="space-y-1.5">
          <Label>Описание</Label>
          <RichTextarea
            value={content.description || ''}
            onChange={(html) => onChange({ ...content, description: html })}
            placeholder="Отметьте выполненные пункты"
            inline
          />
        </div>
      </div>

      {content.groups.map((group, gIdx) => (
        <div key={group.id} className="border rounded-lg p-3 space-y-3">
          <div className="flex items-center gap-2">
            <GripVertical className="h-4 w-4 text-muted-foreground" />
            <RichTextarea
              value={group.title}
              onChange={(html) => updateGroup(gIdx, { title: html })}
              placeholder="Название группы"
              inline
              className="flex-1"
            />
            <Button variant="ghost" size="icon" onClick={() => removeGroup(gIdx)} className="h-8 w-8 text-destructive">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-2 pl-6">
            {group.items.map((item, iIdx) => (
              <div key={item.id} className="flex items-start gap-2">
                <Checkbox disabled className="mt-2.5" />
                <div className="flex-1 space-y-1">
                  <RichTextarea
                    value={item.label}
                    onChange={(html) => updateItem(gIdx, iIdx, { label: html })}
                    placeholder="Текст пункта"
                    minHeight="40px"
                  />
                  <RichTextarea
                    value={item.description || ''}
                    onChange={(html) => updateItem(gIdx, iIdx, { description: html })}
                    placeholder="Подсказка (опционально)"
                    minHeight="32px"
                  />
                </div>
                <Button variant="ghost" size="icon" onClick={() => removeItem(gIdx, iIdx)} className="h-8 w-8 text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => addItem(gIdx)} className="ml-6">
              <Plus className="h-3.5 w-3.5 mr-1" />Пункт
            </Button>
          </div>
        </div>
      ))}

      <Button variant="outline" onClick={addGroup}>
        <FolderPlus className="h-4 w-4 mr-2" />Добавить группу
      </Button>
    </div>
  );
}

// ─── Student View ───
function ChecklistStudentView({ content, savedResponse, onSave }: {
  content: ChecklistContentData;
  savedResponse?: any;
  onSave?: (checkedIds: string[]) => Promise<void>;
}) {
  const initialChecked: string[] = savedResponse?.checkedIds || savedResponse?.checked_ids || [];
  const [checked, setChecked] = useState<Set<string>>(new Set(initialChecked));

  // Sync checked state when savedResponse loads asynchronously
  useEffect(() => {
    const ids: string[] = savedResponse?.checkedIds || savedResponse?.checked_ids || [];
    if (ids.length > 0) {
      setChecked(new Set(ids));
    }
  }, [savedResponse]);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const allItems = content.groups.flatMap(g => g.items);
  const total = allItems.length;
  const done = allItems.filter(item => checked.has(item.id)).length;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const isComplete = total > 0 && done === total;

  const toggle = useCallback(async (id: string) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      const arr = Array.from(next);

      // Save with status indicator
      if (onSave) {
        setSaveStatus("saving");
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        onSave(arr).then(() => {
          setSaveStatus("saved");
          saveTimeoutRef.current = setTimeout(() => setSaveStatus("idle"), 2000);
        }).catch(() => setSaveStatus("idle"));
      }

      return next;
    });
  }, [onSave]);

  return (
    <Card className="border-primary/20">
      <CardContent className="pt-4 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-primary shrink-0" />
            <div>
              <SafeHtml html={content.title || "Чек-лист"} as="p" className="font-medium" />
              {content.description && (
                <SafeHtml html={content.description} as="p" className="text-sm text-muted-foreground" />
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
            {saveStatus === "saving" && (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Сохранение...
              </>
            )}
            {saveStatus === "saved" && (
              <>
                <Check className="h-3 w-3 text-green-500" />
                Сохранено
              </>
            )}
          </div>
        </div>

        {/* Groups */}
        <div className="space-y-5">
          {content.groups.map(group => (
            <div key={group.id} className="space-y-2">
              <div className="border-l-2 border-primary/30 pl-3">
                <h4 className="font-medium text-xs text-muted-foreground uppercase tracking-wide">
                  <SafeHtml html={group.title} />
                </h4>
              </div>
              <div className="space-y-1">
                {group.items.map(item => {
                  const isChecked = checked.has(item.id);
                  return (
                    <label
                      key={item.id}
                      className="flex items-start gap-3 p-3 rounded-xl hover:bg-primary/5 cursor-pointer transition-all duration-200"
                    >
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={() => toggle(item.id)}
                        className="mt-0.5 h-5 w-5"
                      />
                      <div className={`flex-1 min-w-0 transition-opacity duration-200 ${isChecked ? 'opacity-60' : ''}`}>
                        <SafeHtml
                          html={item.label}
                          className={`text-sm ${isChecked ? 'line-through text-muted-foreground' : ''}`}
                        />
                        {item.description && (
                          <SafeHtml
                            html={item.description}
                            as="div"
                            className="text-xs text-muted-foreground mt-0.5"
                          />
                        )}
                      </div>
                      {isChecked && (
                        <Check className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Progress */}
        {total > 0 && (
          <div className="rounded-xl bg-muted/30 p-3 space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{isComplete ? "✅ Всё выполнено!" : "Прогресс"}</span>
              <span>{done} из {total} ({percent}%)</span>
            </div>
            <Progress
              value={percent}
              className={`h-2 ${isComplete ? '[&>div]:bg-green-500' : ''}`}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ChecklistBlock({ content, onChange, isEditing = true, savedResponse, onSave }: ChecklistBlockProps) {
  if (!isEditing) {
    return <ChecklistStudentView content={content} savedResponse={savedResponse} onSave={onSave} />;
  }
  return <ChecklistEditor content={content} onChange={onChange} />;
}
