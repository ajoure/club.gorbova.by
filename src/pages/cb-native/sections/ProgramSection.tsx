import { AnimatedSection } from "@/components/landing/AnimatedSection";
import { CheckCircle2 } from "lucide-react";

export interface ProgramModule {
  number: string;
  title: string;
  points: string[];
}

interface ProgramSectionProps {
  id?: string;
  title: string;
  subtitle?: string;
  modules: ProgramModule[];
}

export function ProgramSection({ id, title, subtitle, modules }: ProgramSectionProps) {
  return (
    <section id={id} className="py-16 md:py-24 bg-muted/30">
      <div className="container mx-auto px-4">
        <AnimatedSection animation="fade-up">
          <div className="text-center mb-12 max-w-3xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">{title}</h2>
            {subtitle && <p className="text-lg text-muted-foreground">{subtitle}</p>}
          </div>
        </AnimatedSection>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-5xl mx-auto">
          {modules.map((mod, index) => (
            <AnimatedSection key={index} animation="fade-up" delay={index * 40}>
              <article className="h-full p-5 rounded-xl bg-card border border-border/60 hover:border-primary/40 transition-colors">
                <div className="flex items-start gap-3 mb-3">
                  <span className="shrink-0 w-10 h-10 rounded-lg bg-primary/10 text-primary font-semibold flex items-center justify-center">
                    {mod.number}
                  </span>
                  <h3 className="text-lg font-semibold text-foreground pt-1.5">{mod.title}</h3>
                </div>
                {mod.points.length > 0 && (
                  <ul className="space-y-1.5 pl-1">
                    {mod.points.map((p, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            </AnimatedSection>
          ))}
        </div>
      </div>
    </section>
  );
}
