// Re-export UnifiedFooter as ConsultationFooter for backward compatibility
import { UnifiedFooter } from "@/components/layout/UnifiedFooter";

export function ConsultationFooter() {
  return <UnifiedFooter showAnchorNav={false} />;
}
