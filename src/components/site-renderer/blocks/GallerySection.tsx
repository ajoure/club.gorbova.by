interface GallerySectionProps {
  content: Record<string, unknown>;
}

export function GallerySection({ content }: GallerySectionProps) {
  const items = (content.items as Array<{ url: string; alt: string; caption: string }>) || [];
  if (!items.length) return null;

  const columns = (content.columns as number) || 3;
  const gap = (content.gap as number) || 16;
  const gridCols: Record<number, string> = { 2: "grid-cols-2", 3: "grid-cols-2 md:grid-cols-3", 4: "grid-cols-2 md:grid-cols-4" };

  return (
    <section className="py-8 px-6">
      <div className={`max-w-5xl mx-auto grid ${gridCols[columns] || "grid-cols-3"}`} style={{ gap: `${gap}px` }}>
        {items.map((item, i) => (
          <figure key={i} className="space-y-2">
            {item.url && (
              <img src={item.url} alt={item.alt || ""} className="w-full rounded-lg object-cover" loading="lazy" />
            )}
            {item.caption && <figcaption className="text-xs text-muted-foreground text-center">{item.caption}</figcaption>}
          </figure>
        ))}
      </div>
    </section>
  );
}
