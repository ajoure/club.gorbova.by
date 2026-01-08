import { usePublicProduct, getCurrentDomain } from "@/hooks/usePublicProduct";
import { ProductLanding } from "@/components/landing/ProductLanding";
import { ProductLandingHeader } from "@/components/landing/ProductLandingHeader";
import { ProductLandingFooter } from "@/components/landing/ProductLandingFooter";
import Landing from "@/pages/Landing";
import { Loader2 } from "lucide-react";

export function DomainHomePage() {
  const hostname = window.location.hostname;
  const domain = getCurrentDomain();
  
  // For localhost or main domain, show the club landing
  const isMainDomain = hostname === "localhost" || 
                       hostname === "127.0.0.1" ||
                       hostname === "club.gorbova.by" ||
                       hostname === "gorbova.by" ||
                       hostname.includes(".lovable.app");
  
  // Fetch product data for the current domain
  const { data: productData, isLoading, error } = usePublicProduct(
    isMainDomain ? null : domain
  );

  // Main domain or development → show club landing
  if (isMainDomain) {
    return <Landing />;
  }

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
