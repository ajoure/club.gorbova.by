/**
 * /cb-native-preview — hidden native React replacement candidate for /cb.
 *
 * ARCHITECTURE:
 * - No iframe, no Tilda runtime, no dangerouslySetInnerHTML.
 * - No absolute-position Zero Blocks. Semantic sections + responsive flex/grid.
 * - Tariff pricing + all CTAs resolve dynamically through the same slot
 *   manifest as production /cb, via `usePublicProduct({ productId })`.
 * - Product id is bound to the SAME product used by /cb page row
 *   (public.site_pages slug='cb' → product_id). No hardcoded prices/offers.
 * - This route is NOT linked from navigation and is marked noindex.
 */
import { useEffect } from "react";
import { usePublicProduct } from "@/hooks/usePublicProduct";
import {
  UniversalPricingSection,
  UniversalPricingSkeleton,
} from "@/components/landing/UniversalPricingSection";
import { HeroSection } from "./cb-native/sections/HeroSection";
import { FeatureGridSection } from "./cb-native/sections/FeatureGridSection";
import { ProgramSection } from "./cb-native/sections/ProgramSection";
import { SpeakerSection } from "./cb-native/sections/SpeakerSection";
import { FaqSection } from "./cb-native/sections/FaqSection";
import { GuaranteeSection } from "./cb-native/sections/GuaranteeSection";
import { NativeFooter } from "./cb-native/sections/NativeFooter";
import {
  HERO,
  BENEFITS,
  AUDIENCE,
  PROGRAM_MODULES,
  SPEAKER,
  FAQ,
  GUARANTEE,
  TARIFFS_INTRO,
  WHY_METRICS,
} from "./cb-native/content";

// Same product bound to the live /cb page (site_pages.slug='cb').
// Resolved dynamically via slot manifest — do NOT hardcode tariffs/offers.
const CB_PRODUCT_ID = "3e43fb28-8322-41bc-bfee-714731bdc630";

export default function CbNativePreview() {
  useEffect(() => {
    document.title = "ЦБ 2.0 · native preview";
    // noindex meta
    let meta = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "robots";
      document.head.appendChild(meta);
    }
    const prev = meta.content;
    meta.content = "noindex,nofollow";
    return () => {
      meta!.content = prev;
    };
  }, []);

  const { data, isLoading, error } = usePublicProduct({ productId: CB_PRODUCT_ID });

  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      <HeroSection
        eyebrow={HERO.eyebrow}
        title={HERO.title}
        subtitle={HERO.subtitle}
      />

      <FeatureGridSection
        title="Что вы получите на курсе"
        subtitle="Не абстрактная теория, а рабочая система, которую можно применить с понедельника."
        items={BENEFITS}
        columns={3}
      />

      <FeatureGridSection
        eyebrow="Для кого"
        title="Курс подойдёт вам, если"
        items={AUDIENCE}
        columns={2}
      />

      <ProgramSection
        title="Программа курса"
        subtitle="18 системных модулей и предобучение — от основ до автоматизации и работы с МНС."
        modules={PROGRAM_MODULES}
      />

      <SpeakerSection
        name={SPEAKER.name}
        role={SPEAKER.role}
        bio={SPEAKER.bio}
        achievements={SPEAKER.achievements}
      />

      <FeatureGridSection
        eyebrow="Почему это работает"
        title="Три вещи, которые отличают этот курс"
        items={WHY_METRICS}
        columns={3}
      />

      {/* Dynamic tariff section — slot-manifest-driven. */}
      {isLoading ? (
        <UniversalPricingSkeleton />
      ) : error || !data?.product || !data?.tariffs?.length ? (
        <section id="tariffs" className="py-20">
          <div className="container mx-auto px-4 text-center">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
              {TARIFFS_INTRO.title}
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Тарифы временно недоступны. Пожалуйста, попробуйте позже.
            </p>
          </div>
        </section>
      ) : (
        <UniversalPricingSection
          product={data.product}
          tariffs={data.tariffs}
          sectionTitle={TARIFFS_INTRO.title}
          sectionSubtitle={TARIFFS_INTRO.subtitle}
        />
      )}

      <GuaranteeSection title={GUARANTEE.title} body={GUARANTEE.body} />

      <FaqSection title="Частые вопросы" items={FAQ} />

      <NativeFooter />
    </div>
  );
}
