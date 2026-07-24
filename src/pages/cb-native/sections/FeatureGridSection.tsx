import { AnimatedSection } from "@/components/landing/AnimatedSection";
import { LucideIcon } from "lucide-react";

export interface FeatureItem {
  icon: LucideIcon;
  title: string;
  description: string;
}

interface FeatureGridSectionProps {
  id?: string;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  items: FeatureItem[];
  columns?: 2 | 3 | 4;
}

export function FeatureGridSection({
  id,
  eyebrow,
  title,
  subtitle,
  items,
  columns = 3,
}: FeatureGridSectionProps) {
  const colClass =
    columns === 2
      ? "md:grid-cols-2"
      : columns === 4
        ? "md:grid-cols-2 lg:grid-cols-4"
        : "md:grid-cols-2 lg:grid-cols-3";

  return (
    <section id={id} className="py-16 md:py-20 bg-background">
      <div className="container mx-auto px-4">
        <AnimatedSection animation="fade-up">
          <div className="text-center mb-12 max-w-3xl mx-auto">
            {eyebrow && (
              <p className="text-sm uppercase tracking-wider text-primary font-medium mb-3">
                {eyebrow}
              </p>
            )}
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">{title}</h2>
            {subtitle && <p className="text-lg text-muted-foreground">{subtitle}</p>}
          </div>
        </AnimatedSection>

        <div className={`grid grid-cols-1 ${colClass} gap-6 max-w-6xl mx-auto`}>
          {items.map((item, index) => (
            <AnimatedSection key={index} animation="fade-up" delay={index * 80}>
              <article className="h-full p-6 rounded-2xl border border-border/60 bg-card/60 backdrop-blur-sm hover:border-primary/40 transition-colors">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                  <item.icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">{item.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {item.description}
                </p>
              </article>
            </AnimatedSection>
          ))}
        </div>
      </div>
    </section>
  );
}
