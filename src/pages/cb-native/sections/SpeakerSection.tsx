import { AnimatedSection } from "@/components/landing/AnimatedSection";
import { CheckCircle2 } from "lucide-react";

interface SpeakerSectionProps {
  id?: string;
  name: string;
  role: string;
  bio: string[];
  achievements: string[];
  imageUrl?: string;
}

export function SpeakerSection({
  id,
  name,
  role,
  bio,
  achievements,
  imageUrl,
}: SpeakerSectionProps) {
  return (
    <section id={id} className="py-16 md:py-24 bg-background">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 max-w-6xl mx-auto items-center">
          <AnimatedSection animation="fade-right">
            <div className="relative">
              <div className="aspect-[4/5] rounded-2xl overflow-hidden bg-muted">
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt={name}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                    Фото автора
                  </div>
                )}
              </div>
              <div className="absolute -bottom-4 -right-4 w-32 h-32 rounded-full bg-primary/15 blur-2xl -z-10" />
            </div>
          </AnimatedSection>

          <AnimatedSection animation="fade-left">
            <p className="text-sm uppercase tracking-wider text-primary font-medium mb-3">
              Автор курса
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-2">{name}</h2>
            <p className="text-lg text-muted-foreground mb-6">{role}</p>

            <div className="space-y-3 mb-6">
              {bio.map((paragraph, i) => (
                <p key={i} className="text-base text-foreground/90 leading-relaxed">
                  {paragraph}
                </p>
              ))}
            </div>

            {achievements.length > 0 && (
              <ul className="space-y-2">
                {achievements.map((a, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <span className="text-foreground/90">{a}</span>
                  </li>
                ))}
              </ul>
            )}
          </AnimatedSection>
        </div>
      </div>
    </section>
  );
}
