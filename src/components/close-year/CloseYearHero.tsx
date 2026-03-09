import { AnimatedSection } from "@/components/landing/AnimatedSection";
import { Button } from "@/components/ui/button";
import { Sparkles, ArrowDown } from "lucide-react";

interface CloseYearHeroProps {
  onScrollToProgram: () => void;
}

export function CloseYearHero({ onScrollToProgram }: CloseYearHeroProps) {
  return (
    <section className="relative min-h-[90vh] flex items-center justify-center overflow-hidden">
      {/* Dark gradient background */}
      <div className="absolute inset-0 bg-gradient-to-b from-[hsl(220,20%,8%)] via-[hsl(220,15%,12%)] to-background" />
      
      {/* Gold particle effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full animate-pulse"
            style={{
              width: `${Math.random() * 4 + 2}px`,
              height: `${Math.random() * 4 + 2}px`,
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              background: `hsl(43, ${50 + Math.random() * 30}%, ${50 + Math.random() * 20}%)`,
              opacity: Math.random() * 0.6 + 0.2,
              animationDelay: `${Math.random() * 3}s`,
              animationDuration: `${2 + Math.random() * 3}s`,
            }}
          />
        ))}
      </div>

      {/* Radial glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-20"
        style={{ background: "radial-gradient(circle, hsl(43, 50%, 55%) 0%, transparent 70%)" }}
      />

      <div className="container mx-auto px-4 relative z-10 text-center">
        <AnimatedSection instant>
          {/* Gold badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full mb-8"
            style={{
              background: "linear-gradient(135deg, hsl(43, 50%, 55% / 0.15), hsl(43, 50%, 55% / 0.05))",
              border: "1px solid hsl(43, 50%, 55% / 0.3)",
            }}
          >
            <Sparkles className="w-4 h-4" style={{ color: "hsl(43, 50%, 55%)" }} />
            <span className="text-sm font-medium" style={{ color: "hsl(43, 50%, 70%)" }}>
              Декабрь 2025 — Февраль 2026
            </span>
          </div>

          <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold mb-6 tracking-tight"
            style={{
              background: "linear-gradient(135deg, hsl(43, 60%, 70%), hsl(43, 50%, 55%), hsl(43, 40%, 45%))",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            ЗАКРОЙ ГОД
          </h1>

          <p className="text-xl md:text-2xl text-muted-foreground max-w-3xl mx-auto mb-4 leading-relaxed">
            Наставничество для бухгалтеров
          </p>
          <p className="text-lg text-muted-foreground/70 max-w-2xl mx-auto mb-10">
            С Катериной Горбовой и нейросетями
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button
              size="lg"
              className="text-lg px-10 py-6 rounded-2xl shadow-lg"
              style={{
                background: "linear-gradient(135deg, hsl(43, 50%, 55%), hsl(43, 40%, 45%))",
                color: "hsl(220, 20%, 10%)",
                border: "none",
              }}
              onClick={onScrollToProgram}
            >
              ХОЧУ
            </Button>
          </div>
        </AnimatedSection>

        {/* Scroll indicator */}
        <AnimatedSection delay={600}>
          <button
            onClick={onScrollToProgram}
            className="mt-16 inline-flex flex-col items-center gap-2 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          >
            <span className="text-xs uppercase tracking-widest">Подробнее</span>
            <ArrowDown className="w-4 h-4 animate-bounce" />
          </button>
        </AnimatedSection>
      </div>
    </section>
  );
}
