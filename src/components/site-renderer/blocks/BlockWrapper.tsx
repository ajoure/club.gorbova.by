/**
 * BlockWrapper — applies universal block settings as styles/classes.
 * COMPATIBILITY INVARIANT: empty settings ({}) → zero padding, no bg, maxWidth "lg",
 * visibility flags false → identical visual output to unwrapped blocks.
 *
 * Site Builder Sprint v2:
 * - id={anchorId} для smooth scroll
 * - data-block-id={blockId} для runtime querySelector (show/toggle/open_form)
 * - hidden если runtime visibility = false
 */
import { blockSettingsSchema } from "@/services/sitePages/types";
import type { BlockSettings } from "@/services/sitePages/types";
import { cn } from "@/lib/utils";
import { useSiteVisibility } from "../SiteVisibilityContext";

interface BlockWrapperProps {
  settings: Record<string, unknown>;
  blockId?: string;
  children: React.ReactNode;
}

const MAX_WIDTH_MAP: Record<string, string> = {
  sm: "max-w-2xl",
  md: "max-w-3xl",
  lg: "max-w-4xl",
  xl: "max-w-6xl",
  full: "max-w-full",
};

export function BlockWrapper({ settings: rawSettings, blockId, children }: BlockWrapperProps) {
  const settings = blockSettingsSchema.parse(rawSettings) as BlockSettings;
  const visibility = useSiteVisibility();

  // Runtime visibility — учитываем initial + actions из контекста
  const runtimeVisible = blockId ? visibility.isVisible(blockId) : true;
  if (!runtimeVisible) {
    return null;
  }

  const outerStyle: React.CSSProperties = {};
  if (settings.paddingTop) outerStyle.paddingTop = `${settings.paddingTop}px`;
  if (settings.paddingBottom) outerStyle.paddingBottom = `${settings.paddingBottom}px`;
  if (settings.backgroundColor) outerStyle.backgroundColor = settings.backgroundColor;
  if (settings.textColor) outerStyle.color = settings.textColor;
  if (settings.backgroundImage) {
    outerStyle.backgroundImage = `url(${settings.backgroundImage})`;
    outerStyle.backgroundSize = "cover";
    outerStyle.backgroundPosition = "center";
  }

  const visibilityClass = cn(
    settings.hideOnMobile && "hidden md:block",
    settings.hideOnDesktop && "md:hidden",
  );

  const anchorId = settings.anchorId || undefined;

  // If all defaults AND нет anchor/blockId → render children directly без обёртки.
  const isDefault =
    !settings.paddingTop &&
    !settings.paddingBottom &&
    !settings.backgroundColor &&
    !settings.backgroundImage &&
    !settings.textColor &&
    !settings.fullWidth &&
    settings.maxWidth === "lg" &&
    !settings.hideOnMobile &&
    !settings.hideOnDesktop &&
    !anchorId &&
    !blockId;

  if (isDefault) {
    return <>{children}</>;
  }

  return (
    <div
      id={anchorId}
      data-block-id={blockId}
      style={outerStyle}
      className={cn(visibilityClass, "scroll-mt-16")}
    >
      {children}
    </div>
  );
}
