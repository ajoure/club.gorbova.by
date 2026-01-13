import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { 
  DndContext, 
  closestCenter, 
  KeyboardSensor, 
  PointerSensor, 
  useSensor, 
  useSensors,
  DragEndEvent 
} from "@dnd-kit/core";
import { 
  arrayMove, 
  SortableContext, 
  sortableKeyboardCoordinates, 
  useSortable, 
  rectSortingStrategy 
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ImageIcon, Plus, Trash2, GripVertical, X, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface GalleryItem {
  id: string;
  url: string;
  caption?: string;
}

export interface GalleryContent {
  items: GalleryItem[];
  layout: 'grid' | 'carousel';
  columns?: number;
}

interface GalleryBlockProps {
  content: GalleryContent;
  onChange: (content: GalleryContent) => void;
  isEditing?: boolean;
}

interface SortableGalleryItemProps {
  item: GalleryItem;
  onUpdate: (id: string, field: keyof GalleryItem, value: string) => void;
  onDelete: (id: string) => void;
}

function SortableGalleryItem({ item, onUpdate, onDelete }: SortableGalleryItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div 
      ref={setNodeRef} 
      style={style} 
      className="relative group border rounded-lg overflow-hidden bg-muted/30"
    >
      <div 
        {...attributes} 
        {...listeners}
        className="absolute top-2 left-2 p-1 bg-background/80 rounded cursor-grab active:cursor-grabbing z-10 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </div>
      
      <Button
        variant="destructive"
        size="icon"
        onClick={() => onDelete(item.id)}
        className="absolute top-2 right-2 h-7 w-7 z-10 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <Trash2 className="h-4 w-4" />
      </Button>

      {item.url ? (
        <img 
          src={item.url} 
          alt={item.caption || ''} 
          className="w-full aspect-square object-cover"
        />
      ) : (
        <div className="w-full aspect-square flex items-center justify-center bg-muted">
          <ImageIcon className="h-8 w-8 text-muted-foreground" />
        </div>
      )}
      
      <div className="p-2 space-y-2">
        <Input
          value={item.url}
          onChange={(e) => onUpdate(item.id, 'url', e.target.value)}
          placeholder="URL изображения..."
          className="text-xs"
        />
        <Input
          value={item.caption || ''}
          onChange={(e) => onUpdate(item.id, 'caption', e.target.value)}
          placeholder="Подпись..."
          className="text-xs"
        />
      </div>
    </div>
  );
}

export function GalleryBlock({ content, onChange, isEditing = true }: GalleryBlockProps) {
  const items = content.items || [];
  const layout = content.layout || 'grid';
  const columns = content.columns || 3;
  
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = items.findIndex((item) => item.id === active.id);
      const newIndex = items.findIndex((item) => item.id === over.id);
      onChange({
        ...content,
        items: arrayMove(items, oldIndex, newIndex),
      });
    }
  };

  const addItem = () => {
    const newItem: GalleryItem = {
      id: crypto.randomUUID(),
      url: '',
      caption: '',
    };
    onChange({ ...content, items: [...items, newItem] });
  };

  const updateItem = (id: string, field: keyof GalleryItem, value: string) => {
    onChange({
      ...content,
      items: items.map((item) => 
        item.id === id ? { ...item, [field]: value } : item
      ),
    });
  };

  const deleteItem = (id: string) => {
    onChange({ ...content, items: items.filter((item) => item.id !== id) });
  };

  const openLightbox = (index: number) => {
    setLightboxIndex(index);
    setLightboxOpen(true);
  };

  const navigateLightbox = (direction: 'prev' | 'next') => {
    if (direction === 'prev') {
      setLightboxIndex((i) => (i > 0 ? i - 1 : items.length - 1));
    } else {
      setLightboxIndex((i) => (i < items.length - 1 ? i + 1 : 0));
    }
  };

  // Student view
  if (!isEditing) {
    const validItems = items.filter(item => item.url);
    
    if (validItems.length === 0) {
      return (
        <div className="flex items-center justify-center h-48 bg-muted rounded-lg">
          <ImageIcon className="h-12 w-12 text-muted-foreground" />
        </div>
      );
    }

    return (
      <>
        <div 
          className="grid gap-3"
          style={{ 
            gridTemplateColumns: `repeat(${Math.min(columns, validItems.length)}, 1fr)` 
          }}
        >
          {validItems.map((item, index) => (
            <div 
              key={item.id} 
              className="group relative cursor-pointer overflow-hidden rounded-lg"
              onClick={() => openLightbox(index)}
            >
              <img 
                src={item.url} 
                alt={item.caption || ''} 
                className="w-full aspect-square object-cover transition-transform group-hover:scale-105"
              />
              {item.caption && (
                <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/70 to-transparent">
                  <p className="text-white text-sm truncate">{item.caption}</p>
                </div>
              )}
            </div>
          ))}
        </div>

        <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
          <DialogContent className="max-w-4xl p-0 bg-black/95 border-0">
            <VisuallyHidden>
              <DialogTitle>Просмотр изображения</DialogTitle>
            </VisuallyHidden>
            <div className="relative flex items-center justify-center min-h-[60vh]">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setLightboxOpen(false)}
                className="absolute top-4 right-4 z-20 text-white hover:bg-white/20"
              >
                <X className="h-6 w-6" />
              </Button>
              
              {validItems.length > 1 && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => navigateLightbox('prev')}
                    className="absolute left-4 z-20 text-white hover:bg-white/20"
                  >
                    <ChevronLeft className="h-8 w-8" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => navigateLightbox('next')}
                    className="absolute right-4 z-20 text-white hover:bg-white/20"
                  >
                    <ChevronRight className="h-8 w-8" />
                  </Button>
                </>
              )}
              
              <img 
                src={validItems[lightboxIndex]?.url} 
                alt={validItems[lightboxIndex]?.caption || ''} 
                className="max-h-[80vh] max-w-full object-contain"
              />
              
              {validItems[lightboxIndex]?.caption && (
                <div className="absolute bottom-4 left-4 right-4 text-center">
                  <p className="text-white text-lg">{validItems[lightboxIndex].caption}</p>
                </div>
              )}
            </div>
            
            <div className="text-center text-white/70 pb-4 text-sm">
              {lightboxIndex + 1} / {validItems.length}
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // Editor view
  return (
    <div className="space-y-4">
      <div className="flex gap-4">
        <div className="space-y-1.5 flex-1">
          <Label>Макет</Label>
          <Select 
            value={layout} 
            onValueChange={(value: 'grid' | 'carousel') => 
              onChange({ ...content, layout: value })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="grid">Сетка</SelectItem>
              <SelectItem value="carousel">Карусель</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        <div className="space-y-1.5 w-32">
          <Label>Колонок</Label>
          <Select 
            value={String(columns)} 
            onValueChange={(value) => 
              onChange({ ...content, columns: parseInt(value) })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="2">2</SelectItem>
              <SelectItem value="3">3</SelectItem>
              <SelectItem value="4">4</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Изображения</Label>
        
        {items.length > 0 ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={items.map((i) => i.id)} strategy={rectSortingStrategy}>
              <div 
                className="grid gap-3"
                style={{ gridTemplateColumns: `repeat(${Math.min(columns, 4)}, 1fr)` }}
              >
                {items.map((item) => (
                  <SortableGalleryItem
                    key={item.id}
                    item={item}
                    onUpdate={updateItem}
                    onDelete={deleteItem}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <div className="text-center py-8 border-2 border-dashed rounded-lg text-muted-foreground">
            <ImageIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Нет изображений</p>
          </div>
        )}

        <Button
          variant="outline"
          onClick={addItem}
          className="w-full border-dashed"
        >
          <Plus className="h-4 w-4 mr-2" />
          Добавить изображение
        </Button>
      </div>
    </div>
  );
}
