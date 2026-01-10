import { useState, useEffect } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { GripVertical, Plus, Trash2, Gift, Calendar as CalendarIcon, Link, Check } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import {
  useTariffFeatures,
  useCreateTariffFeature,
  useUpdateTariffFeature,
  useDeleteTariffFeature,
  useBulkUpdateTariffFeatures,
  type TariffFeature,
} from "@/hooks/useTariffFeatures";

interface TariffFeaturesEditorProps {
  tariffId: string;
  onCopyFromTariff?: (sourceTariffId: string) => void;
  availableTariffs?: Array<{ id: string; name: string }>;
}

function SortableFeatureItem({
  feature,
  onUpdate,
  onDelete,
}: {
  feature: TariffFeature;
  onUpdate: (id: string, updates: Partial<TariffFeature>) => void;
  onDelete: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: feature.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(feature.text);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const handleSave = () => {
    if (editText.trim()) {
      onUpdate(feature.id, { text: editText.trim() });
    }
    setIsEditing(false);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 p-3 border rounded-lg bg-card group"
    >
      <div {...attributes} {...listeners} className="cursor-grab">
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </div>

      <div className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 shrink-0">
        <Check className="h-3 w-3 text-primary" />
      </div>

      <div className="flex-1 min-w-0">
        {isEditing ? (
          <Input
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onBlur={handleSave}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            className="h-8"
            name="feature_edit_text"
          />
        ) : (
          <div
            className="text-sm cursor-pointer hover:text-primary"
            onClick={() => setIsEditing(true)}
          >
            {feature.text}
            {feature.label && (
              <span className="ml-2 text-xs text-muted-foreground">
                ({feature.label})
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {feature.is_bonus && (
          <Badge variant="secondary" className="gap-1">
            <Gift className="h-3 w-3" />
            Бонус
          </Badge>
        )}

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <Gift className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80" align="end">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Бонус/акция</Label>
                <Switch
                  checked={feature.is_bonus}
                  onCheckedChange={(checked) => onUpdate(feature.id, { is_bonus: checked })}
                />
              </div>

              {feature.is_bonus && (
                <>
                  <div className="space-y-2">
                    <Label>Режим показа</Label>
                    <Select
                      value={feature.visibility_mode}
                      onValueChange={(value: "always" | "date_range" | "until_date") =>
                        onUpdate(feature.id, { visibility_mode: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="always">Всегда</SelectItem>
                        <SelectItem value="until_date">До даты</SelectItem>
                        <SelectItem value="date_range">Период</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {feature.visibility_mode !== "always" && (
                    <div className="space-y-2">
                      {feature.visibility_mode === "date_range" && (
                        <div>
                          <Label>С</Label>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="outline" className="w-full justify-start">
                                <CalendarIcon className="h-4 w-4 mr-2" />
                                {feature.active_from
                                  ? format(new Date(feature.active_from), "dd.MM.yyyy", { locale: ru })
                                  : "Выбрать дату"}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0">
                              <Calendar
                                mode="single"
                                selected={feature.active_from ? new Date(feature.active_from) : undefined}
                                onSelect={(date) =>
                                  onUpdate(feature.id, { active_from: date?.toISOString() || null })
                                }
                              />
                            </PopoverContent>
                          </Popover>
                        </div>
                      )}
                      <div>
                        <Label>До</Label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="outline" className="w-full justify-start">
                              <CalendarIcon className="h-4 w-4 mr-2" />
                              {feature.active_to
                                ? format(new Date(feature.active_to), "dd.MM.yyyy", { locale: ru })
                                : "Выбрать дату"}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0">
                            <Calendar
                              mode="single"
                              selected={feature.active_to ? new Date(feature.active_to) : undefined}
                              onSelect={(date) =>
                                onUpdate(feature.id, { active_to: date?.toISOString() || null })
                              }
                            />
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label>Метка (до 15 января)</Label>
                    <Input
                      value={feature.label || ""}
                      onChange={(e) => onUpdate(feature.id, { label: e.target.value || null })}
                      placeholder="до 15 января"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Ссылка</Label>
                    <Input
                      value={feature.link_url || ""}
                      onChange={(e) => onUpdate(feature.id, { link_url: e.target.value || null })}
                      placeholder="https://..."
                    />
                  </div>
                </>
              )}
            </div>
          </PopoverContent>
        </Popover>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive"
          onClick={() => onDelete(feature.id)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export function TariffFeaturesEditor({
  tariffId,
  onCopyFromTariff,
  availableTariffs,
}: TariffFeaturesEditorProps) {
  const { data: features = [], isLoading } = useTariffFeatures(tariffId);
  const createFeature = useCreateTariffFeature();
  const updateFeature = useUpdateTariffFeature();
  const deleteFeature = useDeleteTariffFeature();
  const bulkUpdate = useBulkUpdateTariffFeatures();

  const [localFeatures, setLocalFeatures] = useState<TariffFeature[]>([]);
  const [newFeatureText, setNewFeatureText] = useState("");

  useEffect(() => {
    setLocalFeatures(features);
  }, [features]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = localFeatures.findIndex((f) => f.id === active.id);
      const newIndex = localFeatures.findIndex((f) => f.id === over.id);

      const newFeatures = arrayMove(localFeatures, oldIndex, newIndex);
      setLocalFeatures(newFeatures);

      // Update sort_order for all items
      const updates = newFeatures.map((f, index) => ({
        id: f.id,
        sort_order: index,
      }));

      await bulkUpdate.mutateAsync(updates);
    }
  };

  const handleAddFeature = async () => {
    if (!newFeatureText.trim()) return;

    await createFeature.mutateAsync({
      tariff_id: tariffId,
      text: newFeatureText.trim(),
      icon: "check",
      is_bonus: false,
      is_highlighted: false,
      sort_order: localFeatures.length,
      visibility_mode: "always",
      active_from: null,
      active_to: null,
      label: null,
      link_url: null,
      bonus_type: null,
    });

    setNewFeatureText("");
  };

  const handleUpdateFeature = async (id: string, updates: Partial<TariffFeature>) => {
    await updateFeature.mutateAsync({ id, ...updates });
  };

  const handleDeleteFeature = async (id: string) => {
    await deleteFeature.mutateAsync(id);
  };

  if (isLoading) {
    return <div className="text-muted-foreground text-sm">Загрузка...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Пункты тарифа (птички)</Label>
        {availableTariffs && availableTariffs.length > 0 && (
          <Select onValueChange={(v) => onCopyFromTariff?.(v)}>
            <SelectTrigger className="w-[180px] h-8">
              <SelectValue placeholder="Копировать из..." />
            </SelectTrigger>
            <SelectContent>
              {availableTariffs
                .filter((t) => t.id !== tariffId)
                .map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={localFeatures.map((f) => f.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-2">
            {localFeatures.map((feature) => (
              <SortableFeatureItem
                key={feature.id}
                feature={feature}
                onUpdate={handleUpdateFeature}
                onDelete={handleDeleteFeature}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <div className="flex gap-2">
        <Input
          value={newFeatureText}
          onChange={(e) => setNewFeatureText(e.target.value)}
          placeholder="Новый пункт..."
          onKeyDown={(e) => e.key === "Enter" && handleAddFeature()}
        />
        <Button onClick={handleAddFeature} disabled={!newFeatureText.trim()}>
          <Plus className="h-4 w-4 mr-1" />
          Добавить
        </Button>
      </div>

      {localFeatures.some((f) => f.is_bonus) && (
        <div className="text-xs text-muted-foreground flex items-center gap-1">
          <Gift className="h-3 w-3" />
          Бонусные пункты отображаются с подсветкой и исчезают по окончании срока действия
        </div>
      )}
    </div>
  );
}
