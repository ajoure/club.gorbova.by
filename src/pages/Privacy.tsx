import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { GlassCard } from "@/components/ui/GlassCard";
import { privacySections } from "./privacySections";
import type { PrivacySubItem } from "./privacySections";

function RenderSubItems({ items }: { items: PrivacySubItem[] }) {
  return (
    <ul className="list-none ml-6 mt-2 space-y-1">
      {items.map((sub) => (
        <li key={sub.id}>
          <strong>{sub.id}.</strong>{" "}
          {sub.text.includes("\n")
            ? sub.text.split("\n").map((line, i) => (
                <span key={i}>
                  {i > 0 && <br />}
                  {line}
                </span>
              ))
            : sub.text}
          {sub.subItems && sub.subItems.length > 0 && (
            <RenderSubItems items={sub.subItems} />
          )}
        </li>
      ))}
    </ul>
  );
}

export default function Privacy() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-muted/30 to-background">
      <LandingHeader />

      <main className="container mx-auto px-4 py-24">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl font-bold text-center mb-4">
            ПОЛОЖЕНИЕ
          </h1>
          <p className="text-muted-foreground text-center mb-2">
            о политике в отношении обработки персональных данных
          </p>
          <p className="text-muted-foreground text-center mb-12 text-sm">
            г. Минск &nbsp;&middot;&nbsp; 10 апреля 2026 года
          </p>

          {/* Оглавление */}
          <GlassCard className="p-6 mb-12">
            <h2 className="font-semibold mb-4">Содержание</h2>
            <nav className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              {privacySections.map((s) => (
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
            {privacySections.map((section) => (
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
                      <div key={item.id}>
                        <p>
                          <strong>{item.id}.</strong>{" "}
                          {item.text.includes("\n")
                            ? item.text.split("\n").map((line, i) => (
                                <span key={i}>
                                  {i > 0 && <br />}
                                  {line}
                                </span>
                              ))
                            : item.text}
                        </p>
                        {item.subItems && item.subItems.length > 0 && (
                          <RenderSubItems items={item.subItems} />
                        )}
                      </div>
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
