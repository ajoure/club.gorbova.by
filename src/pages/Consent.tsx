import { GlassCard } from "@/components/ui/GlassCard";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { Shield } from "lucide-react";
import { consentSections } from "./consentSections";

export default function Consent() {
  return (
    <div className="min-h-screen bg-background">
      <LandingHeader />

      <main className="container mx-auto px-4 py-12 max-w-4xl">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
            <Shield className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-3xl md:text-4xl font-bold mb-3">
            Согласие на обработку персональных данных
          </h1>
          <p className="text-muted-foreground">
            на сайте в сети Интернет
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            Редакция от 10 апреля 2026 года
          </p>
        </div>

        {/* Table of Contents */}
        <GlassCard className="p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4">Содержание</h2>
          <nav className="space-y-2">
            {consentSections.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="block text-sm text-primary hover:underline hover:text-primary/80 transition-colors"
              >
                {section.number}. {section.title}
              </a>
            ))}
          </nav>
        </GlassCard>

        {/* Sections */}
        <div className="space-y-6">
          {consentSections.map((section) => (
            <GlassCard key={section.id} id={section.id} className="p-6 scroll-mt-24">
              <h2 className="text-xl font-semibold mb-4">
                {section.number}. {section.title}
              </h2>

              {section.intro && (
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                  {section.intro}
                </p>
              )}

              <ul className="list-none space-y-3">
                {section.items.map((item) => (
                  <li key={item.id}>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      <span className="font-medium text-foreground">{item.id}.</span>{" "}
                      {item.text}
                    </p>

                    {item.subItems && item.subItems.length > 0 && (
                      <ul className="list-none ml-6 mt-2 space-y-1">
                        {item.subItems.map((sub) => (
                          <li key={sub.id}>
                            <p className="text-sm text-muted-foreground leading-relaxed">
                              <span className="font-medium text-foreground">{sub.id}.</span>{" "}
                              {sub.text}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </GlassCard>
          ))}
        </div>
      </main>

      <LandingFooter />
    </div>
  );
}
