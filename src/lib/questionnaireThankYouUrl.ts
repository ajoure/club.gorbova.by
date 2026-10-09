/** Keep the confirmed session in the same site and never follow an external redirect. */
export function questionnaireThankYouUrl(value: unknown, origin: string): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim(), origin);
    if (url.origin !== origin || !["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url.pathname + url.search + url.hash;
  } catch { return null; }
}
