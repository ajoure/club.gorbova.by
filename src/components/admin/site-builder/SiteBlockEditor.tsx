import { useCallback } from "react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import {
  GripVertical, Plus, Trash2, Type, Image, Layout, AlignLeft, MessageSquare, HelpCircle, Minus, Megaphone,
  Video, MousePointerClick, Columns, Timer, Code, GalleryHorizontal, Quote, CreditCard, Share2, Grip, Space, FileText,
  Settings2, ChevronsUpDown, LayoutList, Info, Music, Globe,
} from "lucide-react";
import type { SiteBlock, BlockType } from "@/services/sitePages/types";
import { blockSettingsSchema, type BlockSettings } from "@/services/sitePages/types";

// Block editors
import { HeroBlockEditor } from "./blocks/HeroBlockEditor";
import { TextBlockEditor } from "./blocks/TextBlockEditor";
import { HeadingBlockEditor } from "./blocks/HeadingBlockEditor";
import { ImageBlockEditor } from "./blocks/ImageBlockEditor";
import { FeaturesBlockEditor } from "./blocks/FeaturesBlockEditor";
import { CtaBlockEditor } from "./blocks/CtaBlockEditor";
import { FaqBlockEditor } from "./blocks/FaqBlockEditor";
import { DividerBlockEditor } from "./blocks/DividerBlockEditor";
import { VideoBlockEditor } from "./blocks/VideoBlockEditor";
import { ButtonBlockEditor } from "./blocks/ButtonBlockEditor";
import { ColumnsBlockEditor } from "./blocks/ColumnsBlockEditor";
import { TimerBlockEditor } from "./blocks/TimerBlockEditor";
import { HtmlBlockEditor } from "./blocks/HtmlBlockEditor";
import { GalleryBlockEditor } from "./blocks/GalleryBlockEditor";
import { TestimonialsBlockEditor } from "./blocks/TestimonialsBlockEditor";
import { PricingBlockEditor } from "./blocks/PricingBlockEditor";
import { SocialBlockEditor } from "./blocks/SocialBlockEditor";
import { LogosBlockEditor } from "./blocks/LogosBlockEditor";
import { SpacerBlockEditor } from "./blocks/SpacerBlockEditor";
import { FormBlockEditor } from "./blocks/FormBlockEditor";
import { SiteAudioBlockEditor } from "./blocks/SiteAudioBlockEditor";
import { SiteEmbedBlockEditor } from "./blocks/SiteEmbedBlockEditor";
import { AccordionBlock } from "@/components/admin/lesson-editor/blocks/AccordionBlock";
import { TabsBlock } from "@/components/admin/lesson-editor/blocks/TabsBlock";
import { CalloutBlock } from "@/components/admin/lesson-editor/blocks/CalloutBlock";
import { QuoteBlock } from "@/components/admin/lesson-editor/blocks/QuoteBlock";
import { BlockSettingsEditor } from "./blocks/BlockSettingsEditor";
import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useSitePageAnchors, type AnchorsRegistry } from "@/hooks/useSitePageAnchors";

const BLOCK_TYPES: { type: BlockType; label: string; icon: React.ReactNode }[] = [
  { type: "hero", label: "Hero секция", icon: <Layout className="h-4 w-4" /> },
  { type: "text", label: "Текст", icon: <AlignLeft className="h-4 w-4" /> },
  { type: "heading", label: "Заголовок", icon: <Type className="h-4 w-4" /> },
  { type: "image", label: "Изображение", icon: <Image className="h-4 w-4" /> },
  { type: "features", label: "Преимущества", icon: <MessageSquare className="h-4 w-4" /> },
  { type: "cta", label: "CTA", icon: <Megaphone className="h-4 w-4" /> },
  { type: "faq", label: "FAQ", icon: <HelpCircle className="h-4 w-4" /> },
  { type: "divider", label: "Разделитель", icon: <Minus className="h-4 w-4" /> },
  { type: "video", label: "Видео", icon: <Video className="h-4 w-4" /> },
  { type: "button", label: "Кнопка", icon: <MousePointerClick className="h-4 w-4" /> },
  { type: "columns", label: "Колонки", icon: <Columns className="h-4 w-4" /> },
  { type: "timer", label: "Таймер", icon: <Timer className="h-4 w-4" /> },
  { type: "html", label: "HTML", icon: <Code className="h-4 w-4" /> },
  { type: "gallery", label: "Галерея", icon: <GalleryHorizontal className="h-4 w-4" /> },
  { type: "testimonials", label: "Отзывы", icon: <Quote className="h-4 w-4" /> },
  { type: "pricing", label: "Тарифы", icon: <CreditCard className="h-4 w-4" /> },
  { type: "social", label: "Соцсети", icon: <Share2 className="h-4 w-4" /> },
  { type: "logos", label: "Логотипы", icon: <Grip className="h-4 w-4" /> },
  { type: "spacer", label: "Отступ", icon: <Space className="h-4 w-4" /> },
  { type: "form", label: "Форма", icon: <FileText className="h-4 w-4" /> },
  { type: "accordion", label: "Аккордеон", icon: <ChevronsUpDown className="h-4 w-4" /> },
  { type: "tabs", label: "Вкладки", icon: <LayoutList className="h-4 w-4" /> },
  { type: "callout", label: "Выноска", icon: <Info className="h-4 w-4" /> },
  { type: "quote", label: "Цитата", icon: <Quote className="h-4 w-4" /> },
  { type: "audio", label: "Аудио", icon: <Music className="h-4 w-4" /> },
  { type: "embed", label: "Встраивание", icon: <Globe className="h-4 w-4" /> },
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
    case "video": return { url: "", autoplay: false, aspectRatio: "16:9" };
    case "button": return { text: "", link: "", variant: "primary", size: "md", alignment: "center" };
    case "columns": return { items: [{ html: "" }, { html: "" }], columns: 2, gap: 24 };
    case "timer": return { targetDate: "", title: "", expiredMessage: "Время вышло" };
    case "html": return { code: "" };
    case "gallery": return { items: [], columns: 3, gap: 16 };
    case "testimonials": return { items: [], columns: 2 };
    case "pricing": return { product_id: "", title: "", subtitle: "" };
    case "social": return { items: [], alignment: "center" };
    case "logos": return { items: [], logoHeight: 48, grayscale: false };
    case "spacer": return { height: 40 };
    case "form": return { title: "", subtitle: "", buttonText: "Отправить", redirectUrl: "", fields: [], auth_mode: false, telegram_link: false, product_binding_enabled: false, product_id: "", tariff_id: "", deal_creation_enabled: false, pipeline_id: "", pipeline_stage_id: "" };
    case "accordion": return { items: [], allowMultiple: false };
    case "tabs": return { tabs: [] };
    case "callout": return { type: "info", content: "", title: "" };
    case "quote": return { text: "", author: "", source: "" };
    case "audio": return { url: "", title: "" };
    case "embed": return { url: "", height: 400 };
    default: return {};
  }
}

function BlockEditorComponent({ block, onChange, registry }: { block: SiteBlock; onChange: (content: Record<string, unknown>) => void; registry: AnchorsRegistry }) {
  switch (block.type) {
    case "hero": return <HeroBlockEditor content={block.content} onChange={onChange} />;
    case "text": return <TextBlockEditor content={block.content} onChange={onChange} />;
    case "heading": return <HeadingBlockEditor content={block.content} onChange={onChange} />;
    case "image": return <ImageBlockEditor content={block.content} onChange={onChange} />;
    case "features": return <FeaturesBlockEditor content={block.content} onChange={onChange} />;
    case "cta": return <CtaBlockEditor content={block.content} onChange={onChange} />;
    case "faq": return <FaqBlockEditor content={block.content} onChange={onChange} />;
    case "divider": return <DividerBlockEditor content={block.content} onChange={onChange} />;
    case "video": return <VideoBlockEditor content={block.content} onChange={onChange} />;
    case "button": return <ButtonBlockEditor content={block.content} onChange={onChange} registry={registry} currentBlockId={block.id} />;
    case "columns": return <ColumnsBlockEditor content={block.content} onChange={onChange} />;
    case "timer": return <TimerBlockEditor content={block.content} onChange={onChange} />;
    case "html": return <HtmlBlockEditor content={block.content} onChange={onChange} />;
    case "gallery": return <GalleryBlockEditor content={block.content} onChange={onChange} />;
    case "testimonials": return <TestimonialsBlockEditor content={block.content} onChange={onChange} />;
    case "pricing": return <PricingBlockEditor content={block.content} onChange={onChange} />;
    case "social": return <SocialBlockEditor content={block.content} onChange={onChange} />;
    case "logos": return <LogosBlockEditor content={block.content} onChange={onChange} />;
    case "spacer": return <SpacerBlockEditor content={block.content} onChange={onChange} />;
    case "form": return <FormBlockEditor content={block.content} onChange={onChange} />;
    case "accordion": return <AccordionBlock content={block.content as any} onChange={(c) => onChange(c as any)} isEditing />;
    case "tabs": return <TabsBlock content={block.content as any} onChange={(c) => onChange(c as any)} isEditing />;
    case "callout": return <CalloutBlock content={block.content as any} onChange={(c) => onChange(c as any)} isEditing />;
    case "quote": return <QuoteBlock content={block.content as any} onChange={(c) => onChange(c as any)} isEditing />;
    case "audio": return <SiteAudioBlockEditor content={block.content} onChange={onChange} />;
    case "embed": return <SiteEmbedBlockEditor content={block.content} onChange={onChange} />;
    default: return <p className="text-sm text-muted-foreground">Неизвестный тип блока: {block.type}</p>;
  }
}

function SortableBlock({ block, registry, onUpdate, onUpdateSettings, onDelete }: {
  block: SiteBlock;
  registry: AnchorsRegistry;
  onUpdate: (content: Record<string, unknown>) => void;
  onUpdateSettings: (settings: BlockSettings) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const [showSettings, setShowSettings] = useState(false);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const blockType = BLOCK_TYPES.find((b) => b.type === block.type);
  const parsedSettings = blockSettingsSchema.parse(block.settings) as BlockSettings;
  const otherAnchorIds = registry.anchors.filter((a) => a.blockId !== block.id).map((a) => a.anchorId);

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
            {parsedSettings.anchorId && (
              <span className="ml-1 text-[10px] font-mono text-muted-foreground">#{parsedSettings.anchorId}</span>
            )}
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowSettings(!showSettings)}>
            <Settings2 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
        <CardContent className="p-4">
          <BlockEditorComponent block={block} onChange={onUpdate} registry={registry} />
          {showSettings && (
            <BlockSettingsEditor settings={parsedSettings} onChange={onUpdateSettings} otherAnchorIds={otherAnchorIds} />
          )}
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

  const updateBlockSettings = useCallback((id: string, settings: BlockSettings) => {
    onChange(blocks.map((b) => (b.id === id ? { ...b, settings } : b)));
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
              registry={registry}
              onUpdate={(content) => updateBlock(block.id, content)}
              onUpdateSettings={(settings) => updateBlockSettings(block.id, settings)}
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
          <DropdownMenuContent align="center" className="w-48 max-h-80 overflow-y-auto">
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
