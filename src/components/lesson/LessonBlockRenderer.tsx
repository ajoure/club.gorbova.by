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

interface LessonBlockRendererProps {
  blocks: LessonBlock[];
}

export function LessonBlockRenderer({ blocks }: LessonBlockRendererProps) {
  if (!blocks || blocks.length === 0) {
    return null;
  }

  const renderBlock = (block: LessonBlock) => {
    const noop = () => {}; // Read-only mode
    
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
