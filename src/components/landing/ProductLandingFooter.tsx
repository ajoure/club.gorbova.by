// Re-export UnifiedFooter as ProductLandingFooter for backward compatibility
import { UnifiedFooter } from "@/components/layout/UnifiedFooter";

interface ProductLandingFooterProps {
  productName?: string;
  subtitle?: string;
  email?: string;
}

export function ProductLandingFooter(_props: ProductLandingFooterProps) {
  return <UnifiedFooter showAnchorNav={false} />;
}
