import { useCallback } from "react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { GripVertical, Plus, Trash2, Type, Image, Layout, AlignLeft, MessageSquare, HelpCircle, Minus, Megaphone } from "lucide-react";
import type { SiteBlock, BlockType } from "@/services/sitePages/types";

// Block editors
import { HeroBlockEditor } from "./blocks/HeroBlockEditor";
import { TextBlockEditor } from "./blocks/TextBlockEditor";
import { HeadingBlockEditor } from "./blocks/HeadingBlockEditor";
import { ImageBlockEditor } from "./blocks/ImageBlockEditor";
import { FeaturesBlockEditor } from "./blocks/FeaturesBlockEditor";
import { CtaBlockEditor } from "./blocks/CtaBlockEditor";
import { FaqBlockEditor } from "./blocks/FaqBlockEditor";
import { DividerBlockEditor } from "./blocks/DividerBlockEditor";

const BLOCK_TYPES: { type: BlockType; label: string; icon: React.ReactNode }[] = [
  { type: "hero", label: "Hero секция", icon: <Layout className="h-4 w-4" /> },
  { type: "text", label: "Текст", icon: <AlignLeft className="h-4 w-4" /> },
  { type: "heading", label: "Заголовок", icon: <Type className="h-4 w-4" /> },
  { type: "image", label: "Изображение", icon: <Image className="h-4 w-4" /> },
  { type: "features", label: "Преимущества", icon: <MessageSquare className="h-4 w-4" /> },
  { type: "cta", label: "CTA", icon: <Megaphone className="h-4 w-4" /> },
  { type: "faq", label: "FAQ", icon: <HelpCircle className="h-4 w-4" /> },
  { type: "divider", label: "Разделитель", icon: <Minus className="h-4 w-4" /> },
];

function getDefaultContent(type: BlockType): Record<string, unknown> {
  switch (type) {
    case "hero": return { title: "", subtitle: "", buttonText: "", buttonLink: "", backgroundImage: "", alignment: "center" };
    case "text": return { html: "" };
    case "heading": return { text: "", level: 2 };
    case "image": return { url: "", alt: "", width: "100%", linkUrl: "" };
    case "features": return { items: [], columns: 3 };
    case "cta": return { title: "", subtitle: "", buttonText: "", buttonLink: "", backgroundColor: "" };
    case "faq": return { items: [] };
    case "divider": return { style: "line", height: 1 };
    default: return {};
  }
}

function BlockEditorComponent({ block, onChange }: { block: SiteBlock; onChange: (content: Record<string, unknown>) => void }) {
  switch (block.type) {
    case "hero": return <HeroBlockEditor content={block.content} onChange={onChange} />;
    case "text": return <TextBlockEditor content={block.content} onChange={onChange} />;
    case "heading": return <HeadingBlockEditor content={block.content} onChange={onChange} />;
    case "image": return <ImageBlockEditor content={block.content} onChange={onChange} />;
    case "features": return <FeaturesBlockEditor content={block.content} onChange={onChange} />;
    case "cta": return <CtaBlockEditor content={block.content} onChange={onChange} />;
    case "faq": return <FaqBlockEditor content={block.content} onChange={onChange} />;
    case "divider": return <DividerBlockEditor content={block.content} onChange={onChange} />;
    default: return <p className="text-sm text-muted-foreground">Неизвестный тип блока: {block.type}</p>;
  }
}

function SortableBlock({ block, onUpdate, onDelete }: {
  block: SiteBlock;
  onUpdate: (content: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const blockType = BLOCK_TYPES.find((b) => b.type === block.type);

  return (
    <div ref={setNodeRef} style={style}>
      <Card className="mb-3">
        <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
          <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-1 hover:bg-muted rounded">
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </button>
          <div className="flex items-center gap-1.5 text-sm font-medium flex-1">
            {blockType?.icon}
            <span>{blockType?.label || block.type}</span>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
        <CardContent className="p-4">
          <BlockEditorComponent block={block} onChange={onUpdate} />
        </CardContent>
      </Card>
    </div>
  );
}

interface SiteBlockEditorProps {
  blocks: SiteBlock[];
  onChange: (blocks: SiteBlock[]) => void;
}

export function SiteBlockEditor({ blocks, onChange }: SiteBlockEditorProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  );

  const addBlock = useCallback((type: BlockType) => {
    const newBlock: SiteBlock = {
      id: crypto.randomUUID(),
      type,
      version: 1,
      content: getDefaultContent(type),
      settings: {},
      metadata: {},
    };
    onChange([...blocks, newBlock]);
  }, [blocks, onChange]);

  const updateBlock = useCallback((id: string, content: Record<string, unknown>) => {
    onChange(blocks.map((b) => (b.id === id ? { ...b, content } : b)));
  }, [blocks, onChange]);

  const deleteBlock = useCallback((id: string) => {
    onChange(blocks.filter((b) => b.id !== id));
  }, [blocks, onChange]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = blocks.findIndex((b) => b.id === active.id);
    const newIndex = blocks.findIndex((b) => b.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const newBlocks = [...blocks];
    const [removed] = newBlocks.splice(oldIndex, 1);
    newBlocks.splice(newIndex, 0, removed);
    onChange(newBlocks);
  }, [blocks, onChange]);

  return (
    <div className="max-w-3xl mx-auto">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
          {blocks.map((block) => (
            <SortableBlock
              key={block.id}
              block={block}
              onUpdate={(content) => updateBlock(block.id, content)}
              onDelete={() => deleteBlock(block.id)}
            />
          ))}
        </SortableContext>
      </DndContext>

      {blocks.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <p>Добавьте первый блок, чтобы начать</p>
        </div>
      )}

      <div className="flex justify-center mt-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <Plus className="h-4 w-4 mr-2" />
              Добавить блок
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="w-48">
            {BLOCK_TYPES.map((bt) => (
              <DropdownMenuItem key={bt.type} onClick={() => addBlock(bt.type)}>
                <span className="mr-2">{bt.icon}</span>
                {bt.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
