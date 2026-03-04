import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GlassCard } from "@/components/ui/GlassCard";
import { Plus, Copy, Save } from "lucide-react";
import { toast } from "sonner";
import { usePermissions } from "@/hooks/usePermissions";
import { copyToClipboard } from "@/utils/clipboardUtils";

interface FieldRegistry {
  id: string;
  entity_type: string;
  key: string;
  label: string;
  data_type: string;
  options: any;
  archived_at: string | null;
  created_at: string;
}

interface FieldValue {
  id: string;
  field_id: string;
  entity_id: string;
  value: any;
}

const DATA_TYPES = [
  { value: "text", label: "Текст" },
  { value: "number", label: "Число" },
  { value: "boolean", label: "Да/Нет" },
  { value: "date", label: "Дата" },
  { value: "json", label: "JSON" },
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

interface Props {
  entityId: string;
  entityType?: string;
}

export function ProductCustomFields({ entityId, entityType = "product" }: Props) {
  const queryClient = useQueryClient();
  const { isSuperAdmin } = usePermissions();
  const [createDialog, setCreateDialog] = useState(false);
  const [newField, setNewField] = useState({ label: "", data_type: "text" });
  const [dirtyValues, setDirtyValues] = useState<Record<string, any>>({});

  // Fetch fields
  const { data: fields, isLoading: fieldsLoading } = useQuery({
    queryKey: ["fields_registry", entityType],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fields_registry" as any)
        .select("*")
        .eq("entity_type", entityType)
        .is("archived_at", null)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as FieldRegistry[];
    },
  });

  // Fetch values
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

  // Create field
  const createFieldMutation = useMutation({
    mutationFn: async (field: { label: string; data_type: string }) => {
      const key = slugify(field.label);
      if (!key) throw new Error("Невалидный ключ поля");
      const { data, error } = await supabase
        .from("fields_registry" as any)
        .insert({ entity_type: entityType, key, label: field.label, data_type: field.data_type })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fields_registry", entityType] });
      setCreateDialog(false);
      setNewField({ label: "", data_type: "text" });
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

  // Save value
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

  const handleCopyToken = (fieldId: string) => {
    copyToClipboard(`{{cf.product.${fieldId}}}`, "Токен скопирован");
  };

  if (fieldsLoading) {
    return <div className="text-sm text-muted-foreground py-4">Загрузка полей...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-semibold">Доп. поля</h2>
          <p className="text-sm text-muted-foreground">
            Кастомные поля продукта. Токены можно использовать в шаблонах.
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
            const currentValue = getFieldValue(field.id);
            return (
              <div key={field.id} className="flex items-start gap-3">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs font-medium">{field.label}</Label>
                  {field.data_type === "boolean" ? (
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={!!currentValue}
                        onCheckedChange={(v) => handleValueChange(field.id, v)}
                      />
                      <span className="text-xs text-muted-foreground">
                        {currentValue ? "Да" : "Нет"}
                      </span>
                    </div>
                  ) : (
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
                  )}
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
                    onClick={() => handleCopyToken(field.id)}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </GlassCard>
      )}

      {/* Create Field Dialog */}
      <Dialog open={createDialog} onOpenChange={setCreateDialog}>
        <DialogContent className="max-w-sm">
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
              <Select value={newField.data_type} onValueChange={(v) => setNewField({ ...newField, data_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DATA_TYPES.map((dt) => (
                    <SelectItem key={dt.value} value={dt.value}>{dt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialog(false)}>Отмена</Button>
            <Button
              onClick={() => createFieldMutation.mutate(newField)}
              disabled={!newField.label.trim() || createFieldMutation.isPending}
            >
              Создать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
