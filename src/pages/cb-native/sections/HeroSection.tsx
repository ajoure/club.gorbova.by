import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Shield, ChevronRight } from "lucide-react";
import { AnimatedSection } from "@/components/landing/AnimatedSection";

interface HeroSectionProps {
  title: string;
  subtitle: string;
  eyebrow?: string;
}

export function HeroSection({ title, subtitle, eyebrow }: HeroSectionProps) {
  return (
    <section
      className="relative pt-24 pb-20 overflow-hidden"
      style={{ background: "var(--gradient-background)" }}
    >
      <div className="absolute top-1/4 right-0 w-96 h-96 rounded-full bg-primary/10 blur-3xl -z-10" />
      <div className="absolute bottom-1/4 left-0 w-80 h-80 rounded-full bg-accent/10 blur-3xl -z-10" />

      <div className="container mx-auto px-4">
        <div className="max-w-4xl mx-auto text-center">
          {eyebrow && (
            <AnimatedSection animation="fade-up">
              <Badge variant="secondary" className="mb-6 bg-primary/10 text-primary border-0">
                <Shield size={14} className="mr-1" />
                {eyebrow}
              </Badge>
            </AnimatedSection>
          )}

          <AnimatedSection animation="fade-up" delay={100} instant>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground leading-tight mb-6">
              {title}
            </h1>
          </AnimatedSection>

          <AnimatedSection animation="fade-up" delay={200}>
            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
              {subtitle}
            </p>
          </AnimatedSection>

          <AnimatedSection animation="fade-up" delay={300}>
            <Button
              size="lg"
              className="text-lg px-8 py-6"
              onClick={() =>
                document.getElementById("tariffs")?.scrollIntoView({ behavior: "smooth" })
              }
            >
              Выбрать тариф
              <ChevronRight className="ml-2" />
            </Button>
          </AnimatedSection>
        </div>
      </div>
    </section>
  );
}
