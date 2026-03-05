import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { GlassCard } from "@/components/ui/GlassCard";
import { Plus, Copy, Save, Archive, X, Check, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { usePermissions } from "@/hooks/usePermissions";
import { copyToClipboard } from "@/utils/clipboardUtils";
import { cn } from "@/lib/utils";

// ── Types ──

interface FieldRegistry {
  id: string;
  entity_type: string;
  key: string;
  label: string;
  data_type: string;
  options: any;
  archived_at: string | null;
  created_at: string;
  public_id: string | null;
  display_order: number;
  description: string | null;
}

interface FieldValue {
  id: string;
  field_id: string;
  entity_id: string;
  value: any;
}

interface Choice {
  value: string;
  label: string;
}

// ── Constants ──

const DATA_TYPES = [
  { value: "text", label: "Текст" },
  { value: "number", label: "Число" },
  { value: "boolean", label: "Да/Нет" },
  { value: "date", label: "Дата" },
  { value: "json", label: "JSON" },
  { value: "url", label: "Ссылка (URL)" },
  { value: "select", label: "Список (один)" },
  { value: "multiselect", label: "Список (несколько)" },
];

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[а-яё]/g, (ch) => {
      const map: Record<string, string> = {
        а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh",
        з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
        п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts",
        ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
      };
      return map[ch] || ch;
    })
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function isValidUrl(str: string): boolean {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

// ── Props ──

interface Props {
  entityId: string;
  entityType: string;
  entityLabel?: string;
}

export function EntityCustomFields({ entityId, entityType, entityLabel }: Props) {
  const queryClient = useQueryClient();
  const { isSuperAdmin } = usePermissions();
  const [createDialog, setCreateDialog] = useState(false);
  const [newField, setNewField] = useState({ label: "", data_type: "text", description: "" });
  const [choices, setChoices] = useState<Choice[]>([]);
  const [dirtyValues, setDirtyValues] = useState<Record<string, any>>({});

  // ── Queries ──

  const { data: fields, isLoading: fieldsLoading } = useQuery({
    queryKey: ["fields_registry", entityType],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fields_registry" as any)
        .select("*")
        .eq("entity_type", entityType)
        .is("archived_at", null)
        .order("display_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as FieldRegistry[];
    },
  });

  const { data: values } = useQuery({
    queryKey: ["field_values_v2", entityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("field_values_v2" as any)
        .select("*")
        .eq("entity_id", entityId);
      if (error) throw error;
      return (data || []) as unknown as FieldValue[];
    },
    enabled: !!entityId,
  });

  // ── Mutations ──

  const createFieldMutation = useMutation({
    mutationFn: async (field: { label: string; data_type: string; description: string }) => {
      const key = slugify(field.label);
      if (!key) throw new Error("Невалидный ключ поля");

      const options =
        (field.data_type === "select" || field.data_type === "multiselect") && choices.length > 0
          ? { choices }
          : null;

      // Get max display_order for this entity_type
      const { data: existing } = await supabase
        .from("fields_registry" as any)
        .select("display_order")
        .eq("entity_type", entityType)
        .order("display_order", { ascending: false })
        .limit(1);

      const nextOrder = ((existing as any)?.[0]?.display_order ?? -1) + 1;

      const { data, error } = await supabase
        .from("fields_registry" as any)
        .insert({
          entity_type: entityType,
          key,
          label: field.label,
          data_type: field.data_type,
          description: field.description || null,
          options,
          display_order: nextOrder,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fields_registry", entityType] });
      setCreateDialog(false);
      setNewField({ label: "", data_type: "text", description: "" });
      setChoices([]);
      toast.success("Поле создано");
    },
    onError: (err: Error) => {
      if (err.message.includes("duplicate") || err.message.includes("unique")) {
        toast.error("Поле с таким ключом уже существует");
      } else {
        toast.error(`Ошибка: ${err.message}`);
      }
    },
  });

  const saveValueMutation = useMutation({
    mutationFn: async ({ fieldId, value }: { fieldId: string; value: any }) => {
      const { error } = await supabase
        .from("field_values_v2" as any)
        .upsert(
          { field_id: fieldId, entity_id: entityId, value },
          { onConflict: "field_id,entity_id" }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["field_values_v2", entityId] });
      toast.success("Сохранено");
    },
    onError: (err: Error) => toast.error(`Ошибка: ${err.message}`),
  });

  const archiveFieldMutation = useMutation({
    mutationFn: async (fieldId: string) => {
      const { error } = await supabase
        .from("fields_registry" as any)
        .update({ archived_at: new Date().toISOString() })
        .eq("id", fieldId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fields_registry", entityType] });
      toast.success("Поле архивировано");
    },
    onError: (err: Error) => toast.error(`Ошибка: ${err.message}`),
  });

  // ── Helpers ──

  const getFieldValue = (fieldId: string) => {
    if (dirtyValues[fieldId] !== undefined) return dirtyValues[fieldId];
    const fv = values?.find((v) => v.field_id === fieldId);
    return fv?.value ?? "";
  };

  const handleValueChange = (fieldId: string, val: any) => {
    setDirtyValues((prev) => ({ ...prev, [fieldId]: val }));
  };

  const handleSave = (fieldId: string) => {
    const val = dirtyValues[fieldId];
    if (val === undefined) return;
    saveValueMutation.mutate({ fieldId, value: val });
    setDirtyValues((prev) => {
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
  };

  const handleCopyToken = (field: FieldRegistry) => {
    const tokenId = field.public_id || field.id;
    copyToClipboard(`{{cf.${entityType}.${tokenId}}}`, "Токен скопирован");
  };

  const getChoicesFromField = (field: FieldRegistry): Choice[] => {
    return (field.options as any)?.choices || [];
  };

  // ── Choices editor ──

  const addChoice = () => {
    setChoices((prev) => [...prev, { value: "", label: "" }]);
  };

  const updateChoice = (index: number, key: "value" | "label", val: string) => {
    setChoices((prev) =>
      prev.map((c, i) => (i === index ? { ...c, [key]: val } : c))
    );
  };

  const removeChoice = (index: number) => {
    setChoices((prev) => prev.filter((_, i) => i !== index));
  };

  const autoFillChoiceValue = (index: number, label: string) => {
    setChoices((prev) =>
      prev.map((c, i) =>
        i === index ? { ...c, label, value: c.value || slugify(label) } : c
      )
    );
  };

  // ── Multiselect toggle ──

  const toggleMultiselectValue = (fieldId: string, choiceValue: string) => {
    const current = getFieldValue(fieldId);
    const arr: string[] = Array.isArray(current) ? [...current] : [];
    const idx = arr.indexOf(choiceValue);
    if (idx >= 0) arr.splice(idx, 1);
    else arr.push(choiceValue);
    handleValueChange(fieldId, arr);
  };

  // ── Render value editor by type ──

  const renderValueEditor = (field: FieldRegistry) => {
    const currentValue = getFieldValue(field.id);
    const fieldChoices = getChoicesFromField(field);

    switch (field.data_type) {
      case "boolean":
        return (
          <div className="flex items-center gap-2">
            <Switch
              checked={!!currentValue}
              onCheckedChange={(v) => handleValueChange(field.id, v)}
            />
            <span className="text-xs text-muted-foreground">
              {currentValue ? "Да" : "Нет"}
            </span>
          </div>
        );

      case "select":
        return (
          <Select
            value={currentValue || ""}
            onValueChange={(v) => handleValueChange(field.id, v)}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Выберите..." />
            </SelectTrigger>
            <SelectContent>
              {fieldChoices.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label || c.value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );

      case "multiselect": {
        const selectedArr: string[] = Array.isArray(currentValue) ? currentValue : [];
        return (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="h-8 text-xs justify-start font-normal w-full">
                {selectedArr.length > 0
                  ? `Выбрано: ${selectedArr.length}`
                  : "Выберите..."}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-2" align="start">
              {fieldChoices.map((c) => {
                const isSelected = selectedArr.includes(c.value);
                return (
                  <button
                    key={c.value}
                    className={cn(
                      "flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded-sm hover:bg-accent",
                      isSelected && "bg-accent/50"
                    )}
                    onClick={() => toggleMultiselectValue(field.id, c.value)}
                  >
                    <div className={cn(
                      "h-3.5 w-3.5 border rounded-sm flex items-center justify-center",
                      isSelected ? "bg-primary border-primary" : "border-input"
                    )}>
                      {isSelected && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                    </div>
                    {c.label || c.value}
                  </button>
                );
              })}
              {fieldChoices.length === 0 && (
                <p className="text-xs text-muted-foreground p-2">Нет вариантов</p>
              )}
            </PopoverContent>
          </Popover>
        );
      }

      case "url":
        return (
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <Input
                type="url"
                value={currentValue ?? ""}
                onChange={(e) => handleValueChange(field.id, e.target.value)}
                className="h-8 text-xs"
                placeholder="https://..."
              />
              {currentValue && isValidUrl(currentValue) && (
                <a href={currentValue} target="_blank" rel="noopener noreferrer">
                  <Button size="icon" variant="ghost" className="h-8 w-8" type="button">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                </a>
              )}
            </div>
            {currentValue && !isValidUrl(currentValue) && (
              <p className="text-xs text-destructive">Невалидный URL</p>
            )}
          </div>
        );

      default:
        return (
          <Input
            type={field.data_type === "number" ? "number" : field.data_type === "date" ? "date" : "text"}
            value={currentValue ?? ""}
            onChange={(e) =>
              handleValueChange(
                field.id,
                field.data_type === "number" ? Number(e.target.value) : e.target.value
              )
            }
            className="h-8 text-xs"
            placeholder={`Значение (${field.data_type})`}
          />
        );
    }
  };

  // ── Main render ──

  if (fieldsLoading) {
    return <div className="text-sm text-muted-foreground py-4">Загрузка полей...</div>;
  }

  const displayLabel = entityLabel || "сущности";

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-semibold">Доп. поля</h2>
          <p className="text-sm text-muted-foreground">
            Кастомные поля {displayLabel}. Токены можно использовать в шаблонах.
          </p>
        </div>
        {isSuperAdmin() && (
          <Button size="sm" variant="outline" onClick={() => setCreateDialog(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Добавить поле
          </Button>
        )}
      </div>

      {!fields?.length ? (
        <GlassCard className="p-6">
          <p className="text-sm text-muted-foreground text-center">
            Нет кастомных полей.{" "}
            {isSuperAdmin() && "Нажмите «Добавить поле» для создания."}
          </p>
        </GlassCard>
      ) : (
        <GlassCard className="p-4 space-y-3">
          {fields.map((field) => {
            const isDirty = dirtyValues[field.id] !== undefined;
            return (
              <div key={field.id} className="flex items-start gap-3">
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs font-medium">{field.label}</Label>
                    {field.public_id && (
                      <Badge variant="outline" className="text-[10px] px-1 py-0 font-mono">
                        {field.public_id}
                      </Badge>
                    )}
                  </div>
                  {field.description && (
                    <p className="text-[11px] text-muted-foreground">{field.description}</p>
                  )}
                  {renderValueEditor(field)}
                </div>
                <div className="flex items-center gap-1 pt-5">
                  {isDirty && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => handleSave(field.id)}
                      disabled={saveValueMutation.isPending}
                    >
                      <Save className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => handleCopyToken(field)}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  {isSuperAdmin() && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => archiveFieldMutation.mutate(field.id)}
                      disabled={archiveFieldMutation.isPending}
                    >
                      <Archive className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </GlassCard>
      )}

      {/* Create Field Dialog */}
      <Dialog open={createDialog} onOpenChange={setCreateDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Новое поле</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Название *</Label>
              <Input
                placeholder="Например: Ссылка на GetCourse"
                value={newField.label}
                onChange={(e) => setNewField({ ...newField, label: e.target.value })}
              />
              {newField.label && (
                <p className="text-xs text-muted-foreground">
                  Ключ: <code>{slugify(newField.label)}</code>
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Тип данных</Label>
              <Select
                value={newField.data_type}
                onValueChange={(v) => {
                  setNewField({ ...newField, data_type: v });
                  if (v !== "select" && v !== "multiselect") setChoices([]);
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DATA_TYPES.map((dt) => (
                    <SelectItem key={dt.value} value={dt.value}>{dt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Choices editor for select/multiselect */}
            {(newField.data_type === "select" || newField.data_type === "multiselect") && (
              <div className="space-y-2">
                <Label>Варианты</Label>
                <div className="space-y-1.5">
                  {choices.map((c, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <Input
                        className="h-7 text-xs flex-1"
                        placeholder="Название"
                        value={c.label}
                        onChange={(e) => {
                          autoFillChoiceValue(i, e.target.value);
                        }}
                      />
                      <Input
                        className="h-7 text-xs w-24"
                        placeholder="Ключ"
                        value={c.value}
                        onChange={(e) => updateChoice(i, "value", e.target.value)}
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 shrink-0"
                        onClick={() => removeChoice(i)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={addChoice}>
                  <Plus className="h-3 w-3 mr-1" /> Добавить вариант
                </Button>
              </div>
            )}

            <div className="space-y-2">
              <Label>Описание (необязательно)</Label>
              <Input
                placeholder="Для чего это поле"
                value={newField.description}
                onChange={(e) => setNewField({ ...newField, description: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialog(false)}>Отмена</Button>
            <Button
              onClick={() => createFieldMutation.mutate(newField)}
              disabled={
                !newField.label.trim() ||
                createFieldMutation.isPending ||
                ((newField.data_type === "select" || newField.data_type === "multiselect") &&
                  choices.filter((c) => c.value.trim()).length === 0)
              }
            >
              Создать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
