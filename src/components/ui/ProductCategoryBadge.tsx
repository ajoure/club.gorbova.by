import { Badge } from "@/components/ui/badge";
import { getCategoryBadge } from "@/lib/deals/getCategoryBadge";

interface ProductCategoryBadgeProps {
  category: string | null | undefined;
  className?: string;
}

/**
 * Рендерит badge категории продукта. Чисто display-компонент.
 */
export function ProductCategoryBadge({ category, className }: ProductCategoryBadgeProps) {
  const badge = getCategoryBadge(category);
  if (!badge) return null;

  return (
    <Badge variant="outline" className={`text-[10px] leading-3 px-1.5 py-0 ${badge.className} ${className ?? ""}`}>
      {badge.label}
    </Badge>
  );
}
