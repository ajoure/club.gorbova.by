// Re-export UnifiedFooter as CourseFooter for backward compatibility
import { UnifiedFooter } from "@/components/layout/UnifiedFooter";

export function CourseFooter() {
  return <UnifiedFooter showAnchorNav={false} />;
}
