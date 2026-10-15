import type { CSSProperties } from "react";

/** Page-local theme; never changes the platform or another page's controls. */
export function sitePageTheme(settings: Record<string, unknown> = {}) {
  const branded = settings.preset === "gorbova";
  const style: CSSProperties & Record<`--${string}`, string> = {};
  if (typeof settings.font_family === "string" && settings.font_family.trim()) style.fontFamily = settings.font_family;
  if (branded) style.fontFamily ||= "Arial, sans-serif";
  const color = !branded ? null : typeof settings.primary_color === "string" && /^#[0-9a-f]{6}$/i.test(settings.primary_color)
    ? settings.primary_color : "#343434";
  if (color) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
    const h = !d ? 0 : 60 * (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4);
    const s = !d ? 0 : d / (1 - Math.abs(2 * l - 1));
    style["--primary"] = `${h.toFixed(2)} ${(s * 100).toFixed(2)}% ${(l * 100).toFixed(2)}%`;
    const [lr, lg, lb] = [r, g, b].map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
    const luminance = .2126 * lr + .7152 * lg + .0722 * lb;
    style["--primary-foreground"] = luminance > .179 ? "0 0% 0%" : "0 0% 100%";
  }
  return { className: branded ? "site-page site-page--gorbova" : "site-page", style };
}
