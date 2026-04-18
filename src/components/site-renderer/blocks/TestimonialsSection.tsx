import { SafeHtml } from "@/components/ui/SafeHtml";

interface TestimonialsSectionProps {
  content: Record<string, unknown>;
}

export function TestimonialsSection({ content }: TestimonialsSectionProps) {
  const items = (content.items as Array<{ name: string; text: string; avatar: string; role: string }>) || [];
  if (!items.length) return null;

  const columns = (content.columns as number) || 2;
  const gridCols: Record<number, string> = { 1: "grid-cols-1", 2: "md:grid-cols-2", 3: "md:grid-cols-3" };

  return (
    <section className="py-12 px-6">
      <div className={`max-w-5xl mx-auto grid gap-6 ${gridCols[columns] || "md:grid-cols-2"}`}>
        {items.map((item, i) => (
          <div key={i} className="border rounded-lg p-6 space-y-3 bg-card">
            <SafeHtml as="p" html={`"${item.text || ""}"`} className="text-sm text-muted-foreground italic" />
            <div className="flex items-center gap-3">
              {item.avatar && (
                <img src={item.avatar} alt={item.name} className="w-10 h-10 rounded-full object-cover" loading="lazy" />
              )}
              <div>
                {item.name && <SafeHtml as="p" html={item.name} className="text-sm font-medium text-foreground" />}
                {item.role && <SafeHtml as="p" html={item.role} className="text-xs text-muted-foreground" />}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
