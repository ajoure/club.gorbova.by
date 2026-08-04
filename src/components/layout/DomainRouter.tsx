import { useEffect, useState } from "react";
import { usePublicProduct, getCurrentDomain } from "@/hooks/usePublicProduct";
import { ProductLanding } from "@/components/landing/ProductLanding";
import { ProductLandingHeader } from "@/components/landing/ProductLandingHeader";
import { ProductLandingFooter } from "@/components/landing/ProductLandingFooter";
import Landing from "@/pages/Landing";
import CourseAccountant from "@/pages/CourseAccountant";
import Consultation from "@/pages/Consultation";
import { SiteRenderService } from "@/services/sitePages/SiteRenderService";
import { PublicPageFetchError } from "@/components/site-renderer/PublicPageFetchError";
import type { SitePage } from "@/services/sitePages/types";
import { Loader2 } from "lucide-react";
import SitePageBySlug from "@/pages/SitePageBySlug";
import { getCanonicalHostname } from "@/utils/accessAlias";

export function DomainHomePage() {
  const hostname = getCanonicalHostname(window.location.hostname);
  const domain = getCurrentDomain();
  
  // For localhost or main domain, show the club landing
  const isMainDomain = hostname === "localhost" || 
                       hostname === "127.0.0.1" ||
                       hostname === "club.gorbova.by" ||
                       hostname === "gorbova.by" ||
                       hostname.includes(".lovable.app") ||
                       hostname.includes(".lovableproject.com");
  
  // Check for course domain
  const isCourseDomain = hostname === "cb.gorbova.by";
  
  // Check for consultation domain
  const isConsultationDomain = hostname === "consultation.gorbova.by" || hostname === "cons.gorbova.by";

  // ─── Site Builder Resolution (compatibility layer) ───
  // Prepended before legacy checks for non-main, non-hardcoded domains.
  // Existing production logic is NOT modified.
  const [siteBuilderPage, setSiteBuilderPage] = useState<SitePage | null>(null);
  const [siteBuilderChecked, setSiteBuilderChecked] = useState(false);
  const [siteBuilderError, setSiteBuilderError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const shouldCheckSiteBuilder = !isMainDomain && !isCourseDomain && !isConsultationDomain;

  useEffect(() => {
    if (!shouldCheckSiteBuilder) {
      setSiteBuilderChecked(true);
      return;
    }

    setSiteBuilderChecked(false);
    setSiteBuilderError(null);
    const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
    SiteRenderService.resolveByDomainAndPathSafe(hostname, pathname)
      .then((r) => {
        if (r.status === "ok") {
          setSiteBuilderPage(r.page);
        } else if (r.status === "error") {
          setSiteBuilderError(r.error);
        } else {
          setSiteBuilderPage(null);
        }
        setSiteBuilderChecked(true);
      })
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.error("[DomainHomePage] unexpected resolver throw", e);
        setSiteBuilderError(e?.message || String(e));
        setSiteBuilderChecked(true);
      });
  }, [hostname, shouldCheckSiteBuilder, retryNonce]);


  // Hooks below must stay before any conditional returns. On custom domains the
  // first render exits while Site Builder is still checking; calling this hook
  // only after that check completes causes React's "rendered more hooks" crash.
  const shouldResolveLegacyProductDomain =
    shouldCheckSiteBuilder && siteBuilderChecked && !siteBuilderError && !siteBuilderPage;
  const { data: productData, isLoading, error } = usePublicProduct(
    shouldResolveLegacyProductDomain ? domain : null,
  );

  // Course domain → show course landing (legacy, unchanged)
  if (isCourseDomain) {
    return <CourseAccountant />;
  }
  
  // Consultation domain → show consultation landing (legacy, unchanged)
  if (isConsultationDomain) {
    return <Consultation />;
  }
  
  // Main domain: show landing (legacy, unchanged)
  if (isMainDomain) {
    return <Landing />;
  }

  // Wait for site builder check
  if (!siteBuilderChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Site builder fetch error (network/CORS/5xx) — show recoverable state, not a 404
  if (siteBuilderError) {
    return (
      <PublicPageFetchError
        onRetry={() => setRetryNonce((n) => n + 1)}
        details={siteBuilderError}
      />
    );
  }

  // Site builder page found → render it with pricing data
  if (siteBuilderPage) {
    // Reuse the full public page controller so custom-domain pages get the
    // same slot manifest, lead CTA bridge, and payment/lead dialogs as slug
    // routes. The previous renderer-only path displayed HTML but could not
    // handle lead buttons because it never mounted that controller.
    return <SitePageBySlug resolvedPage={siteBuilderPage} />;
  }
  // ─── Legacy: Product domain resolution ───
  // Fetch product data for the current domain (only after Site Builder misses)

  // Loading state for product domains
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Product not found → fallback to main landing
  if (error || !productData) {
    return <Landing />;
  }

  // Dynamic product landing
  const { product } = productData;
  const config = product.landing_config || {};

  // Build navigation items based on content
  const navItems = [
    { label: "Тарифы", sectionId: "tariffs" },
  ];

  return (
    <ProductLanding
      data={productData}
      header={
        <ProductLandingHeader
          productName={product.name}
          subtitle={config.hero_subtitle || product.public_subtitle || undefined}
          navItems={navItems}
        />
      }
      footer={
        <ProductLandingFooter
          productName={product.name}
          subtitle={product.public_subtitle || undefined}
        />
      }
    />
  );
}
