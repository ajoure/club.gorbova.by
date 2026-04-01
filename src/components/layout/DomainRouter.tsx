import { useEffect, useState } from "react";
import { usePublicProduct, getCurrentDomain } from "@/hooks/usePublicProduct";
import { useSitePricingData } from "@/hooks/useSitePricingData";
import { ProductLanding } from "@/components/landing/ProductLanding";
import { ProductLandingHeader } from "@/components/landing/ProductLandingHeader";
import { ProductLandingFooter } from "@/components/landing/ProductLandingFooter";
import Landing from "@/pages/Landing";
import CourseAccountant from "@/pages/CourseAccountant";
import Consultation from "@/pages/Consultation";
import { SitePageRenderer } from "@/components/site-renderer/SitePageRenderer";
import { SiteRenderService } from "@/services/sitePages/SiteRenderService";
import type { SitePage } from "@/services/sitePages/types";
import { Loader2 } from "lucide-react";

export function DomainHomePage() {
  const hostname = window.location.hostname;
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

  const shouldCheckSiteBuilder = !isMainDomain && !isCourseDomain && !isConsultationDomain;

  useEffect(() => {
    if (!shouldCheckSiteBuilder) {
      setSiteBuilderChecked(true);
      return;
    }
    
    const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
    SiteRenderService.resolveByDomainAndPath(hostname, pathname)
      .then((page) => {
        setSiteBuilderPage(page);
        setSiteBuilderChecked(true);
      })
      .catch(() => {
        setSiteBuilderChecked(true);
      });
  }, [hostname, shouldCheckSiteBuilder]);

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

  // Site builder page found → render it
  if (siteBuilderPage) {
    return (
      <div className="site-public-layout">
        <SitePageRenderer
          blocks={(siteBuilderPage.blocks as unknown as import("@/services/sitePages/types").SiteBlock[]) || []}
          themeSettings={siteBuilderPage.theme_settings || {}}
          pageId={siteBuilderPage.id}
        />
      </div>
    );
  }

  // ─── Legacy: Product domain resolution ───
  // Fetch product data for the current domain (only for product subdomains)
  const { data: productData, isLoading, error } = usePublicProduct(domain);

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
