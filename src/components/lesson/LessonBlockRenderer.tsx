import { LessonBlock } from "@/hooks/useLessonBlocks";
import { HeadingBlock } from "@/components/admin/lesson-editor/blocks/HeadingBlock";
import { TextBlock } from "@/components/admin/lesson-editor/blocks/TextBlock";
import { VideoBlock } from "@/components/admin/lesson-editor/blocks/VideoBlock";
import { AudioBlock } from "@/components/admin/lesson-editor/blocks/AudioBlock";
import { ImageBlock } from "@/components/admin/lesson-editor/blocks/ImageBlock";
import { FileBlock } from "@/components/admin/lesson-editor/blocks/FileBlock";
import { ButtonBlock } from "@/components/admin/lesson-editor/blocks/ButtonBlock";
import { EmbedBlock } from "@/components/admin/lesson-editor/blocks/EmbedBlock";
import { DividerBlock } from "@/components/admin/lesson-editor/blocks/DividerBlock";
import { AccordionBlock } from "@/components/admin/lesson-editor/blocks/AccordionBlock";
import { TabsBlock } from "@/components/admin/lesson-editor/blocks/TabsBlock";
import { SpoilerBlock } from "@/components/admin/lesson-editor/blocks/SpoilerBlock";
import { CalloutBlock } from "@/components/admin/lesson-editor/blocks/CalloutBlock";
import { TimelineBlock } from "@/components/admin/lesson-editor/blocks/TimelineBlock";
import { StepsBlock } from "@/components/admin/lesson-editor/blocks/StepsBlock";
import { QuoteBlock } from "@/components/admin/lesson-editor/blocks/QuoteBlock";

interface LessonBlockRendererProps {
  blocks: LessonBlock[];
}

export function LessonBlockRenderer({ blocks }: LessonBlockRendererProps) {
  if (!blocks || blocks.length === 0) {
    return null;
  }

  const renderBlock = (block: LessonBlock) => {
    const noop = () => {};
    
    switch (block.block_type) {
      case 'heading':
        return <HeadingBlock content={block.content as any} onChange={noop} isEditing={false} />;
      case 'text':
        return <TextBlock content={block.content as any} onChange={noop} isEditing={false} />;
      case 'video':
        return <VideoBlock content={block.content as any} onChange={noop} isEditing={false} />;
      case 'audio':
        return <AudioBlock content={block.content as any} onChange={noop} isEditing={false} />;
      case 'image':
        return <ImageBlock content={block.content as any} onChange={noop} isEditing={false} />;
      case 'file':
        return <FileBlock content={block.content as any} onChange={noop} isEditing={false} />;
      case 'button':
        return <ButtonBlock content={block.content as any} onChange={noop} isEditing={false} />;
      case 'embed':
        return <EmbedBlock content={block.content as any} onChange={noop} isEditing={false} />;
      case 'divider':
        return <DividerBlock isEditing={false} />;
      case 'accordion':
        return <AccordionBlock content={block.content as any} onChange={noop} isEditing={false} />;
      case 'tabs':
        return <TabsBlock content={block.content as any} onChange={noop} isEditing={false} />;
      case 'spoiler':
        return <SpoilerBlock content={block.content as any} onChange={noop} isEditing={false} />;
      case 'callout':
        return <CalloutBlock content={block.content as any} onChange={noop} isEditing={false} />;
      case 'quote':
        return <QuoteBlock content={block.content as any} onChange={noop} isEditing={false} />;
      case 'timeline':
        return <TimelineBlock content={block.content as any} onChange={noop} isEditing={false} />;
      case 'steps':
        return <StepsBlock content={block.content as any} onChange={noop} isEditing={false} />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {blocks.map((block) => (
        <div key={block.id}>
          {renderBlock(block)}
        </div>
      ))}
    </div>
  );
}
