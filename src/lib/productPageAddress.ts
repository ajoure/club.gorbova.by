import { slugify } from "@/utils/slugify";

export const MAIN_SITE_ORIGIN = "https://gorbova.by";

const RESERVED_PAGE_SLUGS = new Set([
  "admin", "auth", "dashboard", "pay", "pricing", "product", "products",
  "settings", "support", "docs", "library", "knowledge", "live", "embed",
  "privacy", "consent", "unsubscribe", "purchases", "oauth", "tools",
]);

export type PageSlugValidation =
  | { ok: true; slug: string }
  | { ok: false; error: string };

export function normalizeProductPageSlug(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  let path = trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (url.hostname.toLowerCase() !== "gorbova.by") return "";
      path = url.pathname;
    } catch {
      return "";
    }
  }

  return path
    .replace(/^\/+|\/+$/g, "")
    .split(/[?#]/, 1)[0]
    .toLowerCase();
}

export function validateProductPageAddress(value: string): PageSlugValidation {
  const slug = normalizeProductPageSlug(value);
  if (!slug) {
    return { ok: false, error: "Укажите адрес страницы на gorbova.by" };
  }
  if (slug.includes("/")) {
    return { ok: false, error: "Адрес должен содержать один сегмент, например ir" };
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug)) {
    return { ok: false, error: "Используйте латинские буквы, цифры и дефисы" };
  }
  if (RESERVED_PAGE_SLUGS.has(slug)) {
    return { ok: false, error: "Этот адрес зарезервирован системой" };
  }
  return { ok: true, slug };
}

export function suggestProductPageSlug(productName: string): string {
  const suggested = slugify(productName);
  return RESERVED_PAGE_SLUGS.has(suggested) ? `${suggested}-page` : suggested;
}

export function getProductPageUrl(slug: string): string {
  return `${MAIN_SITE_ORIGIN}/${slug}`;
}
