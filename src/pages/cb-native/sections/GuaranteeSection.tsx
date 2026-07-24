import { AnimatedSection } from "@/components/landing/AnimatedSection";
import { ShieldCheck } from "lucide-react";

interface GuaranteeSectionProps {
  title: string;
  body: string;
}

export function GuaranteeSection({ title, body }: GuaranteeSectionProps) {
  return (
    <section className="py-16 md:py-20 bg-background">
      <div className="container mx-auto px-4">
        <AnimatedSection animation="scale">
          <div className="max-w-3xl mx-auto p-8 md:p-10 rounded-3xl border border-primary/30 bg-primary/5 text-center">
            <div className="w-14 h-14 rounded-2xl bg-primary/15 flex items-center justify-center mx-auto mb-4">
              <ShieldCheck className="w-7 h-7 text-primary" />
            </div>
            <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-3">{title}</h2>
            <p className="text-base md:text-lg text-muted-foreground leading-relaxed">{body}</p>
          </div>
        </AnimatedSection>
      </div>
    </section>
  );
}
