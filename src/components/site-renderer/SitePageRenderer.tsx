import { useEffect } from "react";
import { sanitizeHtml } from "@/lib/sanitization";
import type { SiteBlock } from "@/services/sitePages/types";
import type { PublicProduct, PublicTariff } from "@/hooks/usePublicProduct";

// Block renderers
import { SiteVisibilityProvider } from "./SiteVisibilityContext";
import { BlockWrapper } from "./blocks/BlockWrapper";
import { VideoSection } from "./blocks/VideoSection";
import { ButtonSection } from "./blocks/ButtonSection";
import { ColumnsSection } from "./blocks/ColumnsSection";
import { TimerSection } from "./blocks/TimerSection";
import { HtmlSection } from "./blocks/HtmlSection";
import { GallerySection } from "./blocks/GallerySection";
import { TestimonialsSection } from "./blocks/TestimonialsSection";
import { PricingSection } from "./blocks/PricingSection";
import { SocialSection } from "./blocks/SocialSection";
import { LogosSection } from "./blocks/LogosSection";
import { SpacerSection } from "./blocks/SpacerSection";
import { FormSection } from "./blocks/FormSection";
import { AudioSection } from "./blocks/AudioSection";
import { EmbedSection } from "./blocks/EmbedSection";
import { AccordionBlock } from "@/components/admin/lesson-editor/blocks/AccordionBlock";
import { TabsBlock } from "@/components/admin/lesson-editor/blocks/TabsBlock";
import { CalloutBlock } from "@/components/admin/lesson-editor/blocks/CalloutBlock";
import { QuoteBlock } from "@/components/admin/lesson-editor/blocks/QuoteBlock";

// ─── Original Block Renderers (kept inline) ───

function HeroSection({ content }: { content: Record<string, unknown> }) {
  const alignment = (content.alignment as string) || "center";
  const textAlign = alignment === "left" ? "text-left" : alignment === "right" ? "text-right" : "text-center";

  return (
    <section
      className="relative py-20 px-6"
      style={{
        backgroundImage: content.backgroundImage ? `url(${content.backgroundImage})` : undefined,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      {content.backgroundImage && <div className="absolute inset-0 bg-black/40" />}
      <div className={`relative max-w-4xl mx-auto ${textAlign}`}>
        {content.title && (
          <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-4">
            {content.title as string}
          </h1>
        )}
        {content.subtitle && (
          <p className="text-lg md:text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            {content.subtitle as string}
          </p>
        )}
        {content.buttonText && (
          <a
            href={(content.buttonLink as string) || "#"}
            className="inline-flex items-center justify-center rounded-md bg-primary px-8 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {content.buttonText as string}
          </a>
        )}
      </div>
    </section>
  );
}

function TextSection({ content }: { content: Record<string, unknown> }) {
  const html = sanitizeHtml((content.html as string) || "");
  return (
    <section className="py-8 px-6">
      <div className="max-w-3xl mx-auto prose prose-sm dark:prose-invert" dangerouslySetInnerHTML={{ __html: html }} />
    </section>
  );
}

function HeadingSection({ content }: { content: Record<string, unknown> }) {
  const level = (content.level as number) || 2;
  const text = (content.text as string) || "";
  const Tag = `h${level}` as keyof JSX.IntrinsicElements;
  const sizes: Record<number, string> = { 1: "text-4xl", 2: "text-3xl", 3: "text-2xl", 4: "text-xl" };

  return (
    <section className="py-6 px-6">
      <div className="max-w-4xl mx-auto">
        <Tag className={`${sizes[level] || "text-2xl"} font-bold text-foreground`}>{text}</Tag>
      </div>
    </section>
  );
}

function ImageSection({ content }: { content: Record<string, unknown> }) {
  const url = (content.url as string) || "";
  if (!url) return null;

  const img = (
    <img
      src={url}
      alt={(content.alt as string) || ""}
      style={{ width: (content.width as string) || "100%" }}
      className="mx-auto rounded-lg"
      loading="lazy"
    />
  );

  return (
    <section className="py-6 px-6">
      <div className="max-w-4xl mx-auto">
        {content.linkUrl ? <a href={content.linkUrl as string}>{img}</a> : img}
      </div>
    </section>
  );
}

function FeaturesSection({ content }: { content: Record<string, unknown> }) {
  const items = (content.items as Array<{ icon: string; title: string; description: string }>) || [];
  const columns = (content.columns as number) || 3;
  const gridCols: Record<number, string> = { 2: "md:grid-cols-2", 3: "md:grid-cols-3", 4: "md:grid-cols-4" };

  return (
    <section className="py-12 px-6">
      <div className={`max-w-5xl mx-auto grid gap-8 ${gridCols[columns] || "md:grid-cols-3"}`}>
        {items.map((item, i) => (
          <div key={i} className="text-center space-y-3">
            {item.icon && <div className="text-3xl">{item.icon}</div>}
            {item.title && <h3 className="text-lg font-semibold text-foreground">{item.title}</h3>}
            {item.description && <p className="text-sm text-muted-foreground">{item.description}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}

function CtaSection({ content }: { content: Record<string, unknown> }) {
  return (
    <section className="py-16 px-6 bg-primary/5">
      <div className="max-w-3xl mx-auto text-center">
        {content.title && <h2 className="text-3xl font-bold text-foreground mb-4">{content.title as string}</h2>}
        {content.subtitle && <p className="text-lg text-muted-foreground mb-8">{content.subtitle as string}</p>}
        {content.buttonText && (
          <a
            href={(content.buttonLink as string) || "#"}
            className="inline-flex items-center justify-center rounded-md bg-primary px-8 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {content.buttonText as string}
          </a>
        )}
      </div>
    </section>
  );
}

function FaqSection({ content }: { content: Record<string, unknown> }) {
  const items = (content.items as Array<{ question: string; answer: string }>) || [];

  return (
    <section className="py-12 px-6">
      <div className="max-w-3xl mx-auto space-y-4">
        {items.map((item, i) => (
          <details key={i} className="border rounded-lg p-4 group">
            <summary className="font-medium cursor-pointer text-foreground">{item.question}</summary>
            <p className="mt-3 text-sm text-muted-foreground">{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function DividerSection({ content }: { content: Record<string, unknown> }) {
  const style = (content.style as string) || "line";
  const height = (content.height as number) || 1;

  if (style === "spacer") {
    return <div style={{ height: `${height}px` }} />;
  }

  return (
    <div className="px-6">
      <hr className="max-w-4xl mx-auto border-border" style={{ borderWidth: `${height}px` }} />
    </div>
  );
}

// ─── Main Renderer ───

export interface PricingDataMap {
  [productId: string]: {
    product: PublicProduct;
    tariffs: PublicTariff[];
  };
}

interface SitePageRendererProps {
  blocks: SiteBlock[];
  themeSettings?: Record<string, unknown>;
  pricingData?: PricingDataMap;
  pageId?: string;
  isPreview?: boolean;
}

export function SitePageRenderer({ blocks, themeSettings, pricingData, pageId, isPreview }: SitePageRendererProps) {
  const style: React.CSSProperties = {};
  if (themeSettings?.font_family) {
    style.fontFamily = themeSettings.font_family as string;
  }

  const renderBlock = (block: SiteBlock) => {
    switch (block.type) {
      case "hero": return <HeroSection content={block.content} />;
      case "text": return <TextSection content={block.content} />;
      case "heading": return <HeadingSection content={block.content} />;
      case "image": return <ImageSection content={block.content} />;
      case "features": return <FeaturesSection content={block.content} />;
      case "cta": return <CtaSection content={block.content} />;
      case "faq": return <FaqSection content={block.content} />;
      case "divider": return <DividerSection content={block.content} />;
      case "video": return <VideoSection content={block.content} />;
      case "button": return <ButtonSection content={block.content} blockId={block.id} />;
      case "columns": return <ColumnsSection content={block.content} />;
      case "timer": return <TimerSection content={block.content} />;
      case "html": return <HtmlSection content={block.content} />;
      case "gallery": return <GallerySection content={block.content} />;
      case "testimonials": return <TestimonialsSection content={block.content} />;
      case "pricing": {
        const productId = (block.content.product_id as string) || "";
        const data = pricingData?.[productId];
        return <PricingSection content={block.content} product={data?.product} tariffs={data?.tariffs} />;
      }
      case "social": return <SocialSection content={block.content} />;
      case "logos": return <LogosSection content={block.content} />;
      case "spacer": return <SpacerSection content={block.content} />;
      case "form": return <FormSection content={block.content} pageId={pageId} isPreview={isPreview} />;
      case "accordion": return <section className="py-6 px-6"><div className="max-w-3xl mx-auto"><AccordionBlock content={block.content as any} onChange={() => {}} isEditing={false} /></div></section>;
      case "tabs": return <section className="py-6 px-6"><div className="max-w-3xl mx-auto"><TabsBlock content={block.content as any} onChange={() => {}} isEditing={false} /></div></section>;
      case "callout": return <section className="py-6 px-6"><div className="max-w-3xl mx-auto"><CalloutBlock content={block.content as any} onChange={() => {}} isEditing={false} /></div></section>;
      case "quote": return <section className="py-6 px-6"><div className="max-w-3xl mx-auto"><QuoteBlock content={block.content as any} onChange={() => {}} isEditing={false} /></div></section>;
      case "audio": return <AudioSection content={block.content} />;
      case "embed": return <EmbedSection content={block.content} />;
      default: return null;
    }
  };

  // Smooth scroll к #anchor при загрузке/смене hash (canonical scroll runtime).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const scrollToHash = () => {
      const hash = window.location.hash.slice(1);
      if (!hash) return;
      const el = document.getElementById(hash);
      if (el) requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
    };
    const t = setTimeout(scrollToHash, 100);
    window.addEventListener("hashchange", scrollToHash);
    return () => {
      clearTimeout(t);
      window.removeEventListener("hashchange", scrollToHash);
    };
  }, [blocks]);

  return (
    <SiteVisibilityProvider blocks={blocks}>
      <div style={style}>
        {blocks.map((block) => (
          <BlockWrapper key={block.id} blockId={block.id} settings={block.settings}>
            {renderBlock(block)}
          </BlockWrapper>
        ))}
      </div>
    </SiteVisibilityProvider>
  );
}
