import { useState } from "react";
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
  verticalListSortingStrategy 
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { 
  Plus, 
  GripVertical, 
  Trash2, 
  Heading, 
  Type, 
  Video, 
  Music, 
  Image, 
  FileText, 
  Link, 
  Code, 
  Minus,
  Loader2
} from "lucide-react";
import { LessonBlock, BlockType, useLessonBlocks } from "@/hooks/useLessonBlocks";
import { HeadingBlock } from "./blocks/HeadingBlock";
import { TextBlock } from "./blocks/TextBlock";
import { VideoBlock } from "./blocks/VideoBlock";
import { AudioBlock } from "./blocks/AudioBlock";
import { ImageBlock } from "./blocks/ImageBlock";
import { FileBlock } from "./blocks/FileBlock";
import { ButtonBlock } from "./blocks/ButtonBlock";
import { EmbedBlock } from "./blocks/EmbedBlock";
import { DividerBlock } from "./blocks/DividerBlock";

const blockTypeConfig: Record<BlockType, { icon: React.ElementType; label: string; color: string }> = {
  heading: { icon: Heading, label: "Заголовок", color: "bg-blue-500/10 text-blue-600" },
  text: { icon: Type, label: "Текст", color: "bg-green-500/10 text-green-600" },
  video: { icon: Video, label: "Видео", color: "bg-purple-500/10 text-purple-600" },
  audio: { icon: Music, label: "Аудио", color: "bg-orange-500/10 text-orange-600" },
  image: { icon: Image, label: "Изображение", color: "bg-pink-500/10 text-pink-600" },
  file: { icon: FileText, label: "Файл", color: "bg-amber-500/10 text-amber-600" },
  button: { icon: Link, label: "Кнопки", color: "bg-cyan-500/10 text-cyan-600" },
  embed: { icon: Code, label: "Embed", color: "bg-indigo-500/10 text-indigo-600" },
  divider: { icon: Minus, label: "Разделитель", color: "bg-gray-500/10 text-gray-600" },
};

function getDefaultContent(blockType: BlockType): LessonBlock['content'] {
  switch (blockType) {
    case 'heading':
      return { text: "", level: 2 };
    case 'text':
      return { html: "" };
    case 'video':
      return { url: "", provider: undefined };
    case 'audio':
      return { url: "", title: "" };
    case 'image':
      return { url: "", alt: "", width: 100 };
    case 'file':
      return { url: "", name: "" };
    case 'button':
      return { buttons: [] };
    case 'embed':
      return { url: "", height: 400 };
    case 'divider':
    default:
      return {};
  }
}

interface SortableBlockItemProps {
  block: LessonBlock;
  onUpdate: (content: LessonBlock['content']) => void;
  onDelete: () => void;
}

function SortableBlockItem({ block, onUpdate, onDelete }: SortableBlockItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: block.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const config = blockTypeConfig[block.block_type];
  const Icon = config.icon;

  const renderBlockContent = () => {
    switch (block.block_type) {
      case 'heading':
        return <HeadingBlock content={block.content as any} onChange={onUpdate} />;
      case 'text':
        return <TextBlock content={block.content as any} onChange={onUpdate} />;
      case 'video':
        return <VideoBlock content={block.content as any} onChange={onUpdate} />;
      case 'audio':
        return <AudioBlock content={block.content as any} onChange={onUpdate} />;
      case 'image':
        return <ImageBlock content={block.content as any} onChange={onUpdate} />;
      case 'file':
        return <FileBlock content={block.content as any} onChange={onUpdate} />;
      case 'button':
        return <ButtonBlock content={block.content as any} onChange={onUpdate} />;
      case 'embed':
        return <EmbedBlock content={block.content as any} onChange={onUpdate} />;
      case 'divider':
        return <DividerBlock />;
      default:
        return <div>Неизвестный тип блока</div>;
    }
  };

  return (
    <Card ref={setNodeRef} style={style} className="p-0 overflow-hidden">
      <div className="flex items-start gap-2 p-3 border-b bg-muted/30">
        <button
          {...attributes}
          {...listeners}
          className="p-1 hover:bg-muted rounded cursor-grab active:cursor-grabbing mt-0.5"
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </button>
        <Badge variant="secondary" className={`${config.color} gap-1.5`}>
          <Icon className="h-3 w-3" />
          {config.label}
        </Badge>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          onClick={onDelete}
          className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <div className="p-4">
        {renderBlockContent()}
      </div>
    </Card>
  );
}

interface LessonBlockEditorProps {
  lessonId: string;
}

export function LessonBlockEditor({ lessonId }: LessonBlockEditorProps) {
  const { blocks, loading, addBlock, updateBlock, deleteBlock, reorderBlocks } = useLessonBlocks(lessonId);
  const [deleteBlockId, setDeleteBlockId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = blocks.findIndex((b) => b.id === active.id);
      const newIndex = blocks.findIndex((b) => b.id === over.id);
      const newOrder = arrayMove(blocks, oldIndex, newIndex);
      reorderBlocks(newOrder.map((b) => b.id));
    }
  };

  const handleAddBlock = async (blockType: BlockType) => {
    await addBlock({
      block_type: blockType,
      content: getDefaultContent(blockType),
    });
  };

  const handleUpdateBlock = (id: string) => (content: LessonBlock['content']) => {
    updateBlock(id, { content });
  };

  const handleDeleteBlock = async () => {
    if (deleteBlockId) {
      await deleteBlock(deleteBlockId);
      setDeleteBlockId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="w-full">
            <Plus className="h-4 w-4 mr-2" />
            Добавить блок
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="w-48">
          {(Object.keys(blockTypeConfig) as BlockType[]).map((type) => {
            const config = blockTypeConfig[type];
            const Icon = config.icon;
            return (
              <DropdownMenuItem key={type} onClick={() => handleAddBlock(type)}>
                <Icon className="h-4 w-4 mr-2" />
                {config.label}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {blocks.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed rounded-lg">
          <p className="text-muted-foreground">Нет блоков. Добавьте первый блок.</p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-3">
              {blocks.map((block) => (
                <SortableBlockItem
                  key={block.id}
                  block={block}
                  onUpdate={handleUpdateBlock(block.id)}
                  onDelete={() => setDeleteBlockId(block.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <AlertDialog open={!!deleteBlockId} onOpenChange={() => setDeleteBlockId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить блок?</AlertDialogTitle>
            <AlertDialogDescription>
              Это действие нельзя отменить. Блок будет удалён навсегда.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteBlock} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
