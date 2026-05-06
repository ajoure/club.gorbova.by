import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { GlassCard } from "@/components/ui/GlassCard";
import { LegalItem } from "@/components/legal/LegalSection";
import { instructionSections } from "./instructionSections";

export default function Instruction() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-muted/30 to-background">
      <LandingHeader />

      <main className="container mx-auto px-4 py-24">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl font-bold text-center mb-4">
            ИНСТРУКЦИЯ
          </h1>
          <p className="text-muted-foreground text-center mb-2">
            для клиентов по использованию документов при единоличном оформлении
            расходов по услугам и цифровым продуктам ЗАО «АЖУР инкам»
          </p>
          <p className="text-muted-foreground text-center mb-12 text-sm">
            г. Минск &nbsp;&middot;&nbsp; 10 апреля 2026 года
          </p>

          {/* Оглавление */}
          <GlassCard className="p-6 mb-12">
            <h2 className="font-semibold mb-4">Содержание</h2>
            <nav className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              {instructionSections.map((s) => (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  className="text-primary hover:underline"
                >
                  {s.number}. {s.title}
                </a>
              ))}
            </nav>
          </GlassCard>

          <div className="prose prose-sm max-w-none text-foreground/80">
            {instructionSections.map((section) => (
              <section
                key={section.id}
                id={section.id}
                className="mb-8 scroll-mt-24"
              >
                <GlassCard className="p-8">
                  <h2 className="text-xl font-semibold mb-4">
                    {section.number}. {section.title}
                  </h2>
                  <div className="space-y-3">
                    {section.items.map((item) => (
                      <LegalItem key={item.id} item={item} />
                    ))}
                  </div>
                </GlassCard>
              </section>
            ))}
          </div>
        </div>
      </main>

      <LandingFooter />
    </div>
  );
}
