/**
 * FeaturesSection — extracted from SitePageRenderer for layout extension.
 * Backward-compat: blocks без `layout` рендерятся как раньше (centered grid).
 * Layouts:
 *   - "grid" (default) — текущая центрированная сетка с emoji-иконкой сверху
 *   - "card-list" — вертикальные карточки (icon слева, title/desc справа)
 *   - "numbered-list" — нумерованные шаги (кружок с номером слева)
 */
import { cn } from "@/lib/utils";
import type { BlockSettings, IconMode, GridLayout } from "@/services/sitePages/types";

interface FeatureItem {
  icon?: string;
  title?: string;
  description?: string;
}

interface FeaturesSectionProps {
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

function getCardClasses(settings?: BlockSettings): string {
  const style = settings?.cardStyle;
  if (!style || style === "plain") return "";
  const radius = RADIUS_MAP[settings?.cardRadius ?? "lg"];
  const shadow = SHADOW_MAP[settings?.cardShadow ?? "none"];
  if (style === "bordered") return cn("border border-border bg-card p-5", radius, shadow);
  if (style === "glass") return cn("border border-border/40 bg-card/60 backdrop-blur-sm p-5", radius, shadow);
  if (style === "filled") return cn("bg-muted p-5", radius, shadow);
  return "";
}

function renderIcon(item: FeatureItem, idx: number, mode: IconMode | undefined): React.ReactNode {
  if (mode === "none") return null;
  if (mode === "numbered") {
    return (
      <div className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-full bg-primary text-primary-foreground font-bold">
        {idx + 1}
      </div>
    );
  }
  if (!item.icon) return null;
  if (mode === "circle") {
    return (
      <div className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-full bg-primary/10 text-primary text-xl">
        {item.icon}
      </div>
    );
  }
  if (mode === "square") {
    return (
      <div className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-md bg-primary/10 text-primary text-xl">
        {item.icon}
      </div>
    );
  }
  // default text/emoji
  return <div className="text-3xl">{item.icon}</div>;
}

export function FeaturesSection({ content, settings }: FeaturesSectionProps) {
  const items = (content.items as FeatureItem[]) || [];
  const legacyColumns = (content.columns as number) || 3;
  const layout = (content.layout as string) || "grid";
  const grid = (content.grid as GridLayout) || undefined;
  const iconMode = (content.iconMode as IconMode) || undefined;

  // ─── Default grid (backward-compat) ───
  if (layout === "grid") {
    const colsDesktop = COLS_DESKTOP[grid?.columnsDesktop ?? legacyColumns] ?? "md:grid-cols-3";
    const colsTablet = grid?.columnsTablet ? COLS_TABLET[grid.columnsTablet] : "";
    const colsMobile = COLS_MOBILE[grid?.columnsMobile ?? 1] ?? "grid-cols-1";
    const gap = GAP_MAP[grid?.gap ?? "lg"] ?? "gap-8";
    const cardClasses = getCardClasses(settings);
    const itemAlign = settings?.itemAlignment ?? "center";
    const alignClass = itemAlign === "left" ? "text-left" : itemAlign === "right" ? "text-right" : "text-center";

    return (
      <section className="py-12 px-6">
        <div className={cn("max-w-5xl mx-auto grid", colsMobile, colsTablet, colsDesktop, gap)}>
          {items.map((item, i) => (
            <div key={i} className={cn("space-y-3", alignClass, cardClasses)}>
              {renderIcon(item, i, iconMode ?? undefined)}
              {item.title && <h3 className="text-lg font-semibold text-foreground">{item.title}</h3>}
              {item.description && <p className="text-sm text-muted-foreground">{item.description}</p>}
            </div>
          ))}
        </div>
      </section>
    );
  }

  // ─── Card list (vertical, icon-left layout) ───
  if (layout === "card-list") {
    const cardClasses = getCardClasses(settings) || "border border-border bg-card p-5 rounded-lg";
    const effectiveIconMode: IconMode = iconMode ?? "circle";
    return (
      <section className="py-12 px-6">
        <div className="max-w-3xl mx-auto space-y-4">
          {items.map((item, i) => (
            <div key={i} className={cn("flex items-start gap-4", cardClasses)}>
              {renderIcon(item, i, effectiveIconMode)}
              <div className="flex-1 min-w-0">
                {item.title && <h3 className="text-base font-semibold text-foreground">{item.title}</h3>}
                {item.description && <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>}
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  // ─── Numbered list (steps) ───
  if (layout === "numbered-list") {
    return (
      <section className="py-12 px-6">
        <div className="max-w-3xl mx-auto space-y-5">
          {items.map((item, i) => (
            <div key={i} className="flex items-start gap-4">
              {renderIcon(item, i, "numbered")}
              <div className="flex-1 min-w-0 pt-1.5">
                {item.title && <h3 className="text-base font-semibold text-foreground">{item.title}</h3>}
                {item.description && <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>}
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return null;
}
