/**
 * StatsSection — generic statistics/metrics/achievements block.
 * Reusable-first: все визуальные параметры — через schema, никаких page-specific хаков.
 * Поддерживает:
 *   - optional title/subtitle (alignment через settings.titleAlignment)
 *   - 2/3/4 columns (с responsive overrides через content.grid)
 *   - optional icon (mode: none/circle/square/numbered)
 *   - card variants через settings.cardStyle
 *   - alignment items через settings.itemAlignment
 *   - number + suffix + label + description
 */
import { cn } from "@/lib/utils";
import { SafeHtml } from "@/components/ui/SafeHtml";
import type { BlockSettings, IconMode, GridLayout } from "@/services/sitePages/types";

interface StatsItem {
  number?: string;
  suffix?: string;
  label?: string;
  description?: string;
  icon?: string;
}

interface StatsSectionProps {
  content: Record<string, unknown>;
  settings?: BlockSettings;
}

const COLS_DESKTOP: Record<number, string> = {
  1: "md:grid-cols-1", 2: "md:grid-cols-2", 3: "md:grid-cols-3",
  4: "md:grid-cols-4", 5: "md:grid-cols-5", 6: "md:grid-cols-6",
};
const COLS_TABLET: Record<number, string> = {
  1: "sm:grid-cols-1", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-4",
};
const COLS_MOBILE: Record<number, string> = { 1: "grid-cols-1", 2: "grid-cols-2" };
const GAP_MAP: Record<string, string> = { sm: "gap-3", md: "gap-6", lg: "gap-8", xl: "gap-12" };

const RADIUS_MAP: Record<string, string> = {
  none: "rounded-none", sm: "rounded-sm", md: "rounded-md", lg: "rounded-lg", xl: "rounded-2xl",
};
const SHADOW_MAP: Record<string, string> = {
  none: "shadow-none", sm: "shadow-sm", md: "shadow-md", lg: "shadow-lg",
};

// Whitelist of border-opacity classes Tailwind safelist can guarantee.
// Any opacity value snaps DOWN to nearest 10% step.
const BORDER_OPACITY_MAP: Record<number, string> = {
  10: "border-border/10", 20: "border-border/20", 30: "border-border/30",
  40: "border-border/40", 50: "border-border/50", 60: "border-border/60",
  70: "border-border/70", 80: "border-border/80", 90: "border-border/90",
  100: "border-border",
};

function resolveBorderClass(opacity: number | undefined): string {
  if (opacity === undefined || opacity >= 100) return "border-border";
  if (opacity <= 0) return "border-transparent";
  const snapped = Math.max(10, Math.min(100, Math.round(opacity / 10) * 10));
  return BORDER_OPACITY_MAP[snapped] ?? "border-border";
}

function getCardClasses(settings?: BlockSettings): string {
  const style = settings?.cardStyle ?? "plain";
  const radius = RADIUS_MAP[settings?.cardRadius ?? "lg"];
  const shadow = SHADOW_MAP[settings?.cardShadow ?? "none"];
  const borderClass = resolveBorderClass(settings?.borderOpacity);

  if (style === "plain") return "";
  if (style === "bordered") {
    return cn("border bg-card p-6", borderClass, radius, shadow);
  }
  if (style === "glass") {
    return cn("border border-border/40 bg-card/60 backdrop-blur-sm p-6", radius, shadow);
  }
  if (style === "filled") {
    return cn("bg-muted p-6", radius, shadow);
  }
  return "";
}

function getAlignClass(align: "left" | "center" | "right" | undefined): string {
  if (align === "left") return "text-left items-start";
  if (align === "right") return "text-right items-end";
  return "text-center items-center";
}

function renderIcon(item: StatsItem, idx: number, mode: IconMode | undefined): React.ReactNode {
  if (mode === "none" || (!item.icon && mode !== "numbered")) return null;
  if (mode === "numbered") {
    return (
      <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 text-primary font-bold text-lg mb-3">
        {idx + 1}
      </div>
    );
  }
  if (mode === "circle") {
    return (
      <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 text-primary text-2xl mb-3">
        {item.icon}
      </div>
    );
  }
  if (mode === "square") {
    return (
      <div className="flex items-center justify-center w-12 h-12 rounded-md bg-primary/10 text-primary text-2xl mb-3">
        {item.icon}
      </div>
    );
  }
  // default: plain emoji/text
  return <div className="text-3xl mb-2">{item.icon}</div>;
}

export function StatsSection({ content, settings }: StatsSectionProps) {
  const items = (content.items as StatsItem[]) || [];
  const title = (content.title as string) || "";
  const subtitle = (content.subtitle as string) || "";
  const legacyColumns = (content.columns as number) || 4;
  const grid = (content.grid as GridLayout) || undefined;
  const iconMode = (content.iconMode as IconMode) || "none";

  const colsDesktop = COLS_DESKTOP[grid?.columnsDesktop ?? legacyColumns] ?? "md:grid-cols-4";
  const colsTablet = grid?.columnsTablet ? COLS_TABLET[grid.columnsTablet] : "";
  const colsMobile = COLS_MOBILE[grid?.columnsMobile ?? 2] ?? "grid-cols-2";
  const gap = GAP_MAP[grid?.gap ?? "lg"] ?? "gap-8";

  const titleAlign = settings?.titleAlignment ?? "center";
  const itemAlign = settings?.itemAlignment ?? "center";
  const cardClasses = getCardClasses(settings);

  if (items.length === 0 && !title && !subtitle) return null;

  return (
    <section className="py-12 px-6">
      <div className="max-w-5xl mx-auto">
        {(title || subtitle) && (
          <div className={cn("mb-8", getAlignClass(titleAlign))}>
            {title && <SafeHtml as="h2" html={title} className="text-3xl font-bold text-foreground mb-2" />}
            {subtitle && <SafeHtml as="p" html={subtitle} className="text-lg text-muted-foreground" />}
          </div>
        )}
        <div className={cn("grid", colsMobile, colsTablet, colsDesktop, gap)}>
          {items.map((item, i) => (
            <div key={i} className={cn("flex flex-col", getAlignClass(itemAlign), cardClasses)}>
              {renderIcon(item, i, iconMode)}
              <div className="text-3xl md:text-4xl font-bold text-foreground">
                {item.number}
                {item.suffix && <SafeHtml as="span" html={item.suffix} className="text-2xl ml-0.5 text-primary" />}
              </div>
              {item.label && (
                <SafeHtml as="div" html={item.label} className="mt-1 text-sm font-medium text-foreground" />
              )}
              {item.description && (
                <SafeHtml as="div" html={item.description} className="mt-1 text-xs text-muted-foreground" />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
