import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowRight, Shield, BookOpen, Users } from "lucide-react";
import { AnimatedSection } from "./AnimatedSection";

export function LandingHero() {
  const navigate = useNavigate();

  const handleTryFree = () => {
    console.log("[Analytics] click_cta_try_free");
    navigate("/auth?mode=signup");
  };

  const handleChoosePlan = () => {
    const pricingSection = document.getElementById("pricing");
    pricingSection?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <section className="relative min-h-screen flex items-center pt-20 overflow-hidden">
      {/* Background gradient */}
      <div
        className="absolute inset-0 -z-10"
        style={{
          background: "var(--gradient-background)",
        }}
      />
      
      {/* Decorative circles */}
      <div className="absolute top-1/4 right-0 w-96 h-96 rounded-full bg-primary/10 blur-3xl -z-10" />
      <div className="absolute bottom-1/4 left-0 w-80 h-80 rounded-full bg-accent/10 blur-3xl -z-10" />

      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto text-center">
          <AnimatedSection animation="fade-up">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
              <Shield size={16} />
              Защита от проверок и ошибок
            </div>
          </AnimatedSection>

          <AnimatedSection animation="fade-up" instant>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground leading-tight mb-6">
              Бухгалтер, которого{" "}
              <span className="text-primary">ценит директор</span>
            </h1>
          </AnimatedSection>

          <AnimatedSection animation="fade-up" delay={200}>
            <p className="text-xl sm:text-2xl text-muted-foreground mb-4">
              Уверенность в знаниях и рост дохода за 3 месяца
            </p>
          </AnimatedSection>

          <AnimatedSection animation="fade-up" delay={300}>
            <p className="text-lg text-muted-foreground mb-10 max-w-2xl mx-auto">
              Перестаньте бояться проверок и ошибок. Научитесь читать и понимать законодательство, 
              защищать себя и директора, спорить с органами и аргументированно отстаивать свои решения
            </p>
          </AnimatedSection>

          <AnimatedSection animation="fade-up" delay={400}>
            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
              <Button size="lg" variant="outline" onClick={handleChoosePlan} className="text-lg px-8 py-6">
                Выбрать тариф
              </Button>
            </div>
          </AnimatedSection>

          {/* Feature cards */}
          <div className="grid sm:grid-cols-3 gap-6">
            <AnimatedSection animation="fade-up" delay={500}>
              <div
                className="p-6 rounded-2xl border border-border/50"
                style={{
                  background: "linear-gradient(135deg, hsl(var(--card) / 0.9), hsl(var(--card) / 0.7))",
                  backdropFilter: "blur(20px)",
                }}
              >
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 mx-auto">
                  <BookOpen className="text-primary" size={24} />
                </div>
                <h3 className="font-semibold text-foreground mb-2">600+ видео-разборов</h3>
                <p className="text-sm text-muted-foreground">
                  База знаний с решениями реальных ситуаций
                </p>
              </div>
            </AnimatedSection>

            <AnimatedSection animation="fade-up" delay={600}>
              <div
                className="p-6 rounded-2xl border border-border/50"
                style={{
                  background: "linear-gradient(135deg, hsl(var(--card) / 0.9), hsl(var(--card) / 0.7))",
                  backdropFilter: "blur(20px)",
                }}
              >
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 mx-auto">
                  <Users className="text-primary" size={24} />
                </div>
                <h3 className="font-semibold text-foreground mb-2">Сообщество экспертов</h3>
                <p className="text-sm text-muted-foreground">
                  Поддержка коллег и ответы на любые вопросы
                </p>
              </div>
            </AnimatedSection>

            <AnimatedSection animation="fade-up" delay={700}>
              <div
                className="p-6 rounded-2xl border border-border/50"
                style={{
                  background: "linear-gradient(135deg, hsl(var(--card) / 0.9), hsl(var(--card) / 0.7))",
                  backdropFilter: "blur(20px)",
                }}
              >
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 mx-auto">
                  <Shield className="text-primary" size={24} />
                </div>
                <h3 className="font-semibold text-foreground mb-2">Готовые алгоритмы</h3>
                <p className="text-sm text-muted-foreground">
                  Пошаговые инструкции для любых ситуаций
                </p>
              </div>
            </AnimatedSection>
          </div>
        </div>
      </div>
    </section>
  );
}
