import DOMPurify from "dompurify";
import type { SiteBlock } from "@/services/sitePages/types";

// ─── Block Renderers ───

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
  const html = DOMPurify.sanitize((content.html as string) || "");
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

interface SitePageRendererProps {
  blocks: SiteBlock[];
  themeSettings?: Record<string, unknown>;
}

export function SitePageRenderer({ blocks, themeSettings }: SitePageRendererProps) {
  const style: React.CSSProperties = {};
  if (themeSettings?.font_family) {
    style.fontFamily = themeSettings.font_family as string;
  }

  return (
    <div style={style}>
      {blocks.map((block) => {
        switch (block.type) {
          case "hero": return <HeroSection key={block.id} content={block.content} />;
          case "text": return <TextSection key={block.id} content={block.content} />;
          case "heading": return <HeadingSection key={block.id} content={block.content} />;
          case "image": return <ImageSection key={block.id} content={block.content} />;
          case "features": return <FeaturesSection key={block.id} content={block.content} />;
          case "cta": return <CtaSection key={block.id} content={block.content} />;
          case "faq": return <FaqSection key={block.id} content={block.content} />;
          case "divider": return <DividerSection key={block.id} content={block.content} />;
          default: return null;
        }
      })}
    </div>
  );
}
