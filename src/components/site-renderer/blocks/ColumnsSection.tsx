import { sanitizeHtml } from "@/services/sitePages/adapters/SanitizationAdapter";

interface ColumnsSectionProps {
  content: Record<string, unknown>;
}

export function ColumnsSection({ content }: ColumnsSectionProps) {
  const items = (content.items as Array<{ html: string }>) || [];
  if (!items.length) return null;

  const columns = (content.columns as number) || 2;
  const gap = (content.gap as number) || 24;
  const gridCols: Record<number, string> = { 2: "md:grid-cols-2", 3: "md:grid-cols-3", 4: "md:grid-cols-4" };

  return (
    <section className="py-8 px-6">
      <div className={`max-w-5xl mx-auto grid gap-6 ${gridCols[columns] || "md:grid-cols-2"}`} style={{ gap: `${gap}px` }}>
        {items.map((item, i) => (
          <div key={i} className="prose prose-sm dark:prose-invert" dangerouslySetInnerHTML={{ __html: sanitizeHtml(item.html) }} />
        ))}
      </div>
    </section>
  );
}
