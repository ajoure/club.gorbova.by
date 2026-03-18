/**
 * BlockWrapper — applies universal block settings as styles/classes.
 * COMPATIBILITY INVARIANT: empty settings ({}) → zero padding, no bg, maxWidth "lg",
 * visibility flags false → identical visual output to unwrapped blocks.
 */
import { blockSettingsSchema } from "@/services/sitePages/types";
import type { BlockSettings } from "@/services/sitePages/types";
import { cn } from "@/lib/utils";

interface BlockWrapperProps {
  settings: Record<string, unknown>;
  children: React.ReactNode;
}

const MAX_WIDTH_MAP: Record<string, string> = {
  sm: "max-w-2xl",
  md: "max-w-3xl",
  lg: "max-w-4xl",
  xl: "max-w-6xl",
  full: "max-w-full",
};

export function BlockWrapper({ settings: rawSettings, children }: BlockWrapperProps) {
  const settings = blockSettingsSchema.parse(rawSettings) as BlockSettings;

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

  // If all defaults — render children directly without wrapper overhead
  const isDefault =
    !settings.paddingTop &&
    !settings.paddingBottom &&
    !settings.backgroundColor &&
    !settings.backgroundImage &&
    !settings.textColor &&
    !settings.fullWidth &&
    settings.maxWidth === "lg" &&
    !settings.hideOnMobile &&
    !settings.hideOnDesktop;

  if (isDefault) {
    return <>{children}</>;
  }

  return (
    <div style={outerStyle} className={visibilityClass}>
      {children}
    </div>
  );
}
