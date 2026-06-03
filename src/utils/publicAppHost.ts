/**
 * Canonical public host for customer-facing app redirects
 * (success/cancel URLs у платёжных подключений, email-ссылки на /dashboard, и т.п.).
 *
 * SOT для /pay/:token — `CANONICAL_PUBLIC_HOST` из buildPublicPaymentUrl.ts (club.gorbova.by).
 * Этот файл — для НЕ-payment-link redirects (admin sandbox, dashboard, pricing).
 *
 * Никогда не должен указывать на lovable preview / Supabase function URL.
 * При появлении env-конфига `VITE_PUBLIC_APP_HOST` он имеет приоритет над хардкодом.
 */

import { isForbiddenPublicHost } from "@/utils/buildPublicPaymentUrl";

const DEFAULT_PUBLIC_APP_HOST = "https://gorbova.by";

function readEnvHost(): string | null {
  try {
    // @ts-ignore — vite env
    const v = import.meta?.env?.VITE_PUBLIC_APP_HOST as string | undefined;
    if (!v) return null;
    const trimmed = v.trim().replace(/\/+$/, "");
    if (!/^https:\/\//.test(trimmed)) return null;
    const host = trimmed.replace(/^https:\/\//, "").split("/")[0];
    if (isForbiddenPublicHost(host)) return null;
    return trimmed;
  } catch {
    return null;
  }
}

/** Canonical app host for customer/admin redirects (без trailing slash). */
export const PUBLIC_APP_HOST: string = readEnvHost() ?? DEFAULT_PUBLIC_APP_HOST;

/** True если URL содержит запрещённый домен (lovable preview, supabase functions, localhost). */
export function isForbiddenRedirectUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const u = url.trim().toLowerCase();
  if (!u) return false;
  if (!/^https:\/\//.test(u)) return true;
  try {
    const parsed = new URL(u);
    if (isForbiddenPublicHost(parsed.hostname)) return true;
    if (parsed.hostname.endsWith(".supabase.co") && parsed.pathname.startsWith("/functions/v1/")) {
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

/** Текущая страница открыта на preview/lovable домене. */
export function isCurrentHostPreview(): boolean {
  if (typeof window === "undefined") return false;
  return isForbiddenPublicHost(window.location.hostname);
}
