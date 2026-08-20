/**
 * Native React landing for /cb. /cb-native-preview remains its hidden
 * acceptance route.
 *
 * Visual/content source of truth:
 *   .lovable/discovery/cb-native/cbold_manifest.json (73 recs, DOM-parsed)
 *   src/pages/cb-native/cbold_manifest.json (bundled copy for runtime)
 *
 * ARCHITECTURE:
 * - No iframe, no Tilda runtime, no dangerouslySetInnerHTML.
 * - No absolute-position Zero Blocks. Semantic sections with flex/grid.
 * - Tariff pricing + CTAs resolve dynamically through UniversalPricingSection
 *   (slot manifest) via usePublicProduct(). Same product id as /cb.
 * - Public /cb is indexable; the preview alias is unlinked and noindex.
 */
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { usePublicProduct } from "@/hooks/usePublicProduct";
import {
  UniversalPricingSection,
  UniversalPricingSkeleton,
} from "@/components/landing/UniversalPricingSection";
import { CB_FONT_STACK, CB_PALETTE } from "./cb-native/manifest";
import { HeroSection } from "./cb-native/sections/HeroSection";
import { AudienceSection } from "./cb-native/sections/AudienceSection";
import { CasesSection } from "./cb-native/sections/CasesSection";
import { SpeakerSection } from "./cb-native/sections/SpeakerSection";
import { WhatAwaitsSection } from "./cb-native/sections/WhatAwaitsSection";
import { ProgramSection } from "./cb-native/sections/ProgramSection";
import { ProcessSection } from "./cb-native/sections/ProcessSection";
import { AdvantagesSection } from "./cb-native/sections/AdvantagesSection";
import { PostTariffSection } from "./cb-native/sections/PostTariffSection";
import { FaqSection } from "./cb-native/sections/FaqSection";
import { CbNativeTariffCard } from "./cb-native/sections/CbNativeTariffCard";
import { sortCbTariffsForDisplay } from "./cb-native/tariffPublicContract";
import { BrandHeaderSection } from "./cb-native/sections/BrandHeaderSection";
import { UnifiedFooter } from "@/components/layout/UnifiedFooter";

// Same product bound to live /cb (site_pages slug='cb'). NO hardcoded prices.
// «Ценный бухгалтер | 1 ступень 2.0 | 21 поток» is the only product rendered
// by /cb. The previous value pointed at the already completed 20th flow.
const CB_PRODUCT_ID = "2b7bf6d4-ad8d-46ad-9399-7f96c307c596";

const scrollToTariffs = () => {
  const el = document.getElementById("tariffs");
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
};

export default function CbNativePreview() {
  const { pathname } = useLocation();
  const isPreview = pathname === "/cb-native-preview";

  useEffect(() => {
    document.title = isPreview ? "ЦБ 2.0 · native preview" : "Ценный бухгалтер";

    // Keep the hidden acceptance route out of search results. The public /cb
    // route remains indexable after publication.
    let meta = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    let injected = false;
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "robots";
      document.head.appendChild(meta);
      injected = true;
    }
    const prev = meta.content;
    meta.content = isPreview ? "noindex,nofollow" : "index,follow";

    return () => {
      if (injected) meta!.remove();
      else meta!.content = prev;
    };
  }, [isPreview]);

  const { data, isLoading, error } = usePublicProduct({ productId: CB_PRODUCT_ID });

  return (
    <div
      className="min-h-screen overflow-x-hidden"
      style={{
        background: CB_PALETTE.bg,
        color: CB_PALETTE.text,
        fontFamily: CB_FONT_STACK,
      }}
    >
      <BrandHeaderSection />

      {/* 1. Hero */}
      <HeroSection onCta={scrollToTariffs} />

      {/* 2. Аудитория */}
      <AudienceSection />

      {/* 3. Кейсы учеников */}
      <CasesSection />

      {/* 4. Спикер */}
      <SpeakerSection />

      {/* 5. Что вас ждёт */}
      <WhatAwaitsSection />

      {/* 6. Программа */}
      <ProgramSection onCta={scrollToTariffs} />

      {/* 7. Как проходит обучение */}
      <ProcessSection />

      {/* 8. Преимущества */}
      <AdvantagesSection onCta={scrollToTariffs} />

      {/* 9. Тарифы (dynamic slot manifest — preserves all payment dialogs & CTA bindings) */}
      <div id="rec1219722591" className="cb-native-pricing-slice">
        <style>{`
          .cb-native-pricing-slice > section { background: ${CB_PALETTE.bg}; padding-top: 96px; padding-bottom: 96px; }
          .cb-native-pricing-slice .container { max-width: 1164px; }
          .cb-native-pricing-slice .text-center { text-align: left; }
          .cb-native-pricing-slice h2 { color: ${CB_PALETTE.accent}; font-family: ${CB_FONT_STACK}; font-size: 40px; line-height: 1.15; font-weight: 700; text-transform: uppercase; }
          .cb-native-pricing-slice h2 + p { display: none; }
          .cb-native-pricing-slice .grid { max-width: 1164px !important; gap: 42px; }
          @media (max-width: 767px) {
            .cb-native-pricing-slice > section { padding-top: 72px; padding-bottom: 72px; }
            .cb-native-pricing-slice .container { padding-left: 14px; padding-right: 14px; }
            .cb-native-pricing-slice h2 { font-size: 32px; text-align: center; }
            .cb-native-pricing-slice .text-center { text-align: center; }
            .cb-native-pricing-slice .grid { gap: 22px; }
          }
        `}</style>
        {isLoading ? (
          <UniversalPricingSkeleton />
        ) : error || !data?.product || !data?.tariffs?.length ? (
          <section className="py-20" style={{ background: CB_PALETTE.bgSoft }}>
            <div className="mx-auto max-w-4xl px-5 text-center">
              <h2
                className="text-2xl sm:text-3xl font-semibold mb-3"
                style={{ color: CB_PALETTE.textStrong }}
              >
                ТАРИФЫ И СТОИМОСТЬ ОБУЧЕНИЯ
              </h2>
              <p style={{ color: CB_PALETTE.muted }}>
                Тарифы временно недоступны. Пожалуйста, попробуйте позже.
              </p>
            </div>
          </section>
        ) : (
          <UniversalPricingSection
            product={data.product}
            tariffs={sortCbTariffsForDisplay(data.tariffs)}
            sectionTitle="ТАРИФЫ И СТОИМОСТЬ ОБУЧЕНИЯ"
            sectionSubtitle=""
            composableCheckoutMode="always"
            cardRenderer={({ tariff, index, onSelectOffer }) => (
              <CbNativeTariffCard tariff={tariff} index={index} onSelectOffer={onSelectOffer} />
            )}
          />
        )}
      </div>

      {/* 10. Пост-тарифный блок */}
      <PostTariffSection />

      {/* 11. FAQ + canonical gorbova.by footer */}
      <FaqSection />
      <UnifiedFooter showAnchorNav={false} />
    </div>
  );
}
