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
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuSeparator,
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
  Loader2,
  ChevronRight,
  List,
  Layers,
  Quote,
  AlertCircle,
  Eye,
  Clock,
  Footprints,
  CheckSquare,
  CircleDot,
  ToggleLeft,
  PenLine,
  AlignLeft,
  ListChecks,
  Table,
  Upload,
  Star,
  Box,
  Columns,
  GitBranch,
  LayoutGrid,
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
import { AccordionBlock } from "./blocks/AccordionBlock";
import { TabsBlock } from "./blocks/TabsBlock";
import { SpoilerBlock } from "./blocks/SpoilerBlock";
import { CalloutBlock } from "./blocks/CalloutBlock";
import { TimelineBlock } from "./blocks/TimelineBlock";
import { StepsBlock } from "./blocks/StepsBlock";
import { QuoteBlock } from "./blocks/QuoteBlock";
import { QuizSingleBlock } from "./blocks/QuizSingleBlock";
import { QuizMultipleBlock } from "./blocks/QuizMultipleBlock";
import { QuizTrueFalseBlock } from "./blocks/QuizTrueFalseBlock";
import { QuizFillBlankBlock } from "./blocks/QuizFillBlankBlock";
import { QuizMatchingBlock } from "./blocks/QuizMatchingBlock";
import { QuizSequenceBlock } from "./blocks/QuizSequenceBlock";
import { QuizHotspotBlock } from "./blocks/QuizHotspotBlock";
import { GalleryBlock } from "./blocks/GalleryBlock";

// Block configuration with categories
interface BlockConfig {
  icon: React.ElementType;
  label: string;
  color: string;
  category: 'text' | 'media' | 'interactive' | 'quiz' | 'input' | 'meta';
}

const blockTypeConfig: Record<BlockType, BlockConfig> = {
  // Text blocks
  heading: { icon: Heading, label: "Заголовок", color: "bg-blue-500/10 text-blue-600", category: 'text' },
  text: { icon: Type, label: "Текст", color: "bg-green-500/10 text-green-600", category: 'text' },
  accordion: { icon: List, label: "Аккордеон", color: "bg-violet-500/10 text-violet-600", category: 'text' },
  tabs: { icon: Layers, label: "Вкладки", color: "bg-teal-500/10 text-teal-600", category: 'text' },
  spoiler: { icon: Eye, label: "Спойлер", color: "bg-slate-500/10 text-slate-600", category: 'text' },
  callout: { icon: AlertCircle, label: "Callout", color: "bg-amber-500/10 text-amber-600", category: 'text' },
  quote: { icon: Quote, label: "Цитата", color: "bg-rose-500/10 text-rose-600", category: 'text' },
  
  // Media blocks
  video: { icon: Video, label: "Видео", color: "bg-purple-500/10 text-purple-600", category: 'media' },
  audio: { icon: Music, label: "Аудио", color: "bg-orange-500/10 text-orange-600", category: 'media' },
  image: { icon: Image, label: "Изображение", color: "bg-pink-500/10 text-pink-600", category: 'media' },
  gallery: { icon: LayoutGrid, label: "Галерея", color: "bg-fuchsia-500/10 text-fuchsia-600", category: 'media' },
  file: { icon: FileText, label: "Файл", color: "bg-amber-500/10 text-amber-600", category: 'media' },
  
  // Interactive blocks
  button: { icon: Link, label: "Кнопки", color: "bg-cyan-500/10 text-cyan-600", category: 'interactive' },
  embed: { icon: Code, label: "Embed", color: "bg-indigo-500/10 text-indigo-600", category: 'interactive' },
  divider: { icon: Minus, label: "Разделитель", color: "bg-gray-500/10 text-gray-600", category: 'interactive' },
  timeline: { icon: Clock, label: "Таймлайн", color: "bg-emerald-500/10 text-emerald-600", category: 'interactive' },
  steps: { icon: Footprints, label: "Шаги", color: "bg-sky-500/10 text-sky-600", category: 'interactive' },
  
  // Quiz blocks (Iteration 2 - placeholders)
  quiz_single: { icon: CircleDot, label: "Один ответ", color: "bg-blue-500/10 text-blue-600", category: 'quiz' },
  quiz_multiple: { icon: CheckSquare, label: "Несколько ответов", color: "bg-blue-500/10 text-blue-600", category: 'quiz' },
  quiz_true_false: { icon: ToggleLeft, label: "Да/Нет", color: "bg-blue-500/10 text-blue-600", category: 'quiz' },
  quiz_fill_blank: { icon: PenLine, label: "Заполнить пропуск", color: "bg-blue-500/10 text-blue-600", category: 'quiz' },
  quiz_matching: { icon: GitBranch, label: "Соответствие", color: "bg-blue-500/10 text-blue-600", category: 'quiz' },
  quiz_sequence: { icon: List, label: "Последовательность", color: "bg-blue-500/10 text-blue-600", category: 'quiz' },
  quiz_hotspot: { icon: Image, label: "Hotspot", color: "bg-blue-500/10 text-blue-600", category: 'quiz' },
  
  // Input blocks (Iteration 3 - placeholders)
  input_short: { icon: AlignLeft, label: "Короткий ответ", color: "bg-green-500/10 text-green-600", category: 'input' },
  input_long: { icon: AlignLeft, label: "Развёрнутый ответ", color: "bg-green-500/10 text-green-600", category: 'input' },
  checklist: { icon: ListChecks, label: "Чек-лист", color: "bg-green-500/10 text-green-600", category: 'input' },
  table_input: { icon: Table, label: "Таблица", color: "bg-green-500/10 text-green-600", category: 'input' },
  file_upload: { icon: Upload, label: "Загрузка файла", color: "bg-green-500/10 text-green-600", category: 'input' },
  rating: { icon: Star, label: "Оценка", color: "bg-green-500/10 text-green-600", category: 'input' },
  
  // Meta blocks (Iteration 4 - placeholders)
  container: { icon: Box, label: "Контейнер", color: "bg-gray-500/10 text-gray-600", category: 'meta' },
  columns: { icon: Columns, label: "Колонки", color: "bg-gray-500/10 text-gray-600", category: 'meta' },
  condition: { icon: GitBranch, label: "Условие", color: "bg-gray-500/10 text-gray-600", category: 'meta' },
};

const categoryConfig = {
  text: { icon: Type, label: "Текст", color: "text-green-600" },
  media: { icon: Image, label: "Медиа", color: "text-purple-600" },
  interactive: { icon: Layers, label: "Интерактив", color: "text-cyan-600" },
  quiz: { icon: CheckSquare, label: "Тесты", color: "text-blue-600" },
  input: { icon: PenLine, label: "Ввод", color: "text-emerald-600" },
  meta: { icon: Box, label: "Структура", color: "text-gray-600" },
};

// Blocks available (Iteration 1 + 2)
const availableBlocks: BlockType[] = [
  'heading', 'text', 'accordion', 'tabs', 'spoiler', 'callout', 'quote',
  'video', 'audio', 'image', 'gallery', 'file',
  'button', 'embed', 'divider', 'timeline', 'steps',
  'quiz_single', 'quiz_multiple', 'quiz_true_false', 'quiz_fill_blank',
  'quiz_matching', 'quiz_sequence', 'quiz_hotspot',
];

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
    case 'accordion':
      return { items: [], allowMultiple: false };
    case 'tabs':
      return { tabs: [] };
    case 'spoiler':
      return { buttonText: "Показать ответ", content: "" };
    case 'callout':
      return { type: 'info', content: "", title: "" };
    case 'quote':
      return { text: "", author: "", source: "" };
    case 'timeline':
      return { items: [] };
    case 'steps':
      return { steps: [], orientation: 'vertical' };
    case 'quiz_single':
      return { question: "", options: [], explanation: "", points: 1 };
    case 'quiz_multiple':
      return { question: "", options: [], explanation: "", points: 1 };
    case 'quiz_true_false':
      return { question: "", correctAnswer: true, explanation: "", points: 1 };
    case 'quiz_fill_blank':
      return { textBefore: "", blanks: [], explanation: "", points: 1 };
    case 'quiz_matching':
      return { question: "", pairs: [], explanation: "", points: 1 };
    case 'quiz_sequence':
      return { question: "", items: [], explanation: "", points: 1 };
    case 'quiz_hotspot':
      return { question: "", imageUrl: "", correctAreas: [], explanation: "", points: 1 };
    case 'gallery':
      return { items: [], layout: 'grid', columns: 3 };
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
  const Icon = config?.icon || Type;

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
      case 'accordion':
        return <AccordionBlock content={block.content as any} onChange={onUpdate} />;
      case 'tabs':
        return <TabsBlock content={block.content as any} onChange={onUpdate} />;
      case 'spoiler':
        return <SpoilerBlock content={block.content as any} onChange={onUpdate} />;
      case 'callout':
        return <CalloutBlock content={block.content as any} onChange={onUpdate} />;
      case 'quote':
        return <QuoteBlock content={block.content as any} onChange={onUpdate} />;
      case 'timeline':
        return <TimelineBlock content={block.content as any} onChange={onUpdate} />;
      case 'steps':
        return <StepsBlock content={block.content as any} onChange={onUpdate} />;
      case 'quiz_single':
        return <QuizSingleBlock content={block.content as any} onChange={onUpdate} />;
      case 'quiz_multiple':
        return <QuizMultipleBlock content={block.content as any} onChange={onUpdate} />;
      case 'quiz_true_false':
        return <QuizTrueFalseBlock content={block.content as any} onChange={onUpdate} />;
      case 'quiz_fill_blank':
        return <QuizFillBlankBlock content={block.content as any} onChange={onUpdate} />;
      case 'quiz_matching':
        return <QuizMatchingBlock content={block.content as any} onChange={onUpdate} />;
      case 'quiz_sequence':
        return <QuizSequenceBlock content={block.content as any} onChange={onUpdate} />;
      case 'quiz_hotspot':
        return <QuizHotspotBlock content={block.content as any} onChange={onUpdate} />;
      case 'gallery':
        return <GalleryBlock content={block.content as any} onChange={onUpdate} />;
      default:
        return (
          <div className="text-center py-8 text-muted-foreground">
            <Icon className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Блок "{config?.label}" будет доступен в следующих обновлениях</p>
          </div>
        );
    }
  };

  return (
    <Card ref={setNodeRef} style={style} className="p-0 overflow-hidden backdrop-blur-sm bg-card/80">
      <div className="flex items-start gap-2 p-3 border-b bg-muted/30">
        <button
          {...attributes}
          {...listeners}
          className="p-1 hover:bg-muted rounded cursor-grab active:cursor-grabbing mt-0.5"
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </button>
        <Badge variant="secondary" className={`${config?.color || ''} gap-1.5`}>
          <Icon className="h-3 w-3" />
          {config?.label || block.block_type}
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

  // Group blocks by category
  const blocksByCategory = availableBlocks.reduce((acc, type) => {
    const category = blockTypeConfig[type].category;
    if (!acc[category]) acc[category] = [];
    acc[category].push(type);
    return acc;
  }, {} as Record<string, BlockType[]>);

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
          <Button variant="outline" className="w-full bg-card/50 border-dashed hover:bg-card/80">
            <Plus className="h-4 w-4 mr-2" />
            Добавить блок
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="w-64" sideOffset={4}>
          {Object.entries(blocksByCategory).map(([category, types]) => {
            const catConfig = categoryConfig[category as keyof typeof categoryConfig];
            const CatIcon = catConfig.icon;
            
            return (
              <DropdownMenuSub key={category}>
                <DropdownMenuSubTrigger className="gap-2">
                  <CatIcon className={`h-4 w-4 ${catConfig.color}`} />
                  <span>{catConfig.label}</span>
                  <Badge variant="secondary" className="ml-auto text-xs">
                    {types.length}
                  </Badge>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent sideOffset={2} alignOffset={-5}>
                  {types.map((type) => {
                    const config = blockTypeConfig[type];
                    const BlockIcon = config.icon;
                    return (
                      <DropdownMenuItem 
                        key={type} 
                        onClick={() => handleAddBlock(type)}
                        className="gap-2 cursor-pointer"
                      >
                        <BlockIcon className={`h-4 w-4 ${config.color.split(' ')[1]}`} />
                        {config.label}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {blocks.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed rounded-xl bg-card/30 backdrop-blur-sm">
          <Layers className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-muted-foreground font-medium">Нет блоков</p>
          <p className="text-sm text-muted-foreground/70 mt-1">Нажмите кнопку выше, чтобы добавить первый блок</p>
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
        <AlertDialogContent className="backdrop-blur-xl bg-background/95">
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
