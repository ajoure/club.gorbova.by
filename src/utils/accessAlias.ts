const GORBOVA_ROOT_HOST = "gorbova.by";
const ACCESS_ALIAS_LABEL = "a";

// Infrastructure endpoints are intentionally never mirrored through the
// customer-facing access gateway.
const EXCLUDED_CANONICAL_HOSTS = new Set([
  "access.gorbova.by",
  "pdf.gorbova.by",
]);

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, "");
}

export function isProxyEligibleGorbovaHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  // `a.` is reserved for the gateway itself. Treating an alias as a canonical
  // host would allow malformed links such as a.a.club... to grow another
  // prefix on every rewrite.
  if (normalized.startsWith(`${ACCESS_ALIAS_LABEL}.`)) return false;
  const belongsToRoot =
    normalized === GORBOVA_ROOT_HOST || normalized.endsWith(`.${GORBOVA_ROOT_HOST}`);
  return belongsToRoot && !EXCLUDED_CANONICAL_HOSTS.has(normalized);
}

/** Return the production hostname used for routing/data lookups. */
export function getCanonicalHostname(hostname: string): string {
  const normalized = normalizeHostname(hostname);
  if (!normalized.startsWith(`${ACCESS_ALIAS_LABEL}.`)) return normalized;

  const candidate = normalized.slice(ACCESS_ALIAS_LABEL.length + 1);
  if (candidate.startsWith(`${ACCESS_ALIAS_LABEL}.`)) return normalized;
  return isProxyEligibleGorbovaHostname(candidate) ? candidate : normalized;
}

export function isAccessAliasHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return getCanonicalHostname(normalized) !== normalized;
}

export function getAccessAliasHostname(canonicalHostname: string): string {
  const canonical = getCanonicalHostname(canonicalHostname);
  return isProxyEligibleGorbovaHostname(canonical)
    ? `${ACCESS_ALIAS_LABEL}.${canonical}`
    : canonical;
}

/**
 * Keep a user inside the VPS access contour when an old/hardcoded absolute
 * gorbova.by link is opened. Relative and external URLs are left untouched.
 */
export function getAccessAwareUrl(
  rawUrl: string,
  currentHostname = typeof window === "undefined" ? "" : window.location.hostname,
): string {
  if (!rawUrl || !isAccessAliasHostname(currentHostname)) return rawUrl;

  const isAbsolute = /^[a-z][a-z\d+.-]*:\/\//i.test(rawUrl);
  const isProtocolRelative = rawUrl.startsWith("//");
  if (!isAbsolute && !isProtocolRelative) return rawUrl;

  try {
    const base = `https://${normalizeHostname(currentHostname)}`;
    const parsed = new URL(rawUrl, base);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return rawUrl;

    const canonicalTarget = getCanonicalHostname(parsed.hostname);
    if (!isProxyEligibleGorbovaHostname(canonicalTarget)) return rawUrl;

    parsed.hostname = getAccessAliasHostname(canonicalTarget);
    if (isProtocolRelative) return `//${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

/** Install the minimal browser guards required by the alternate access host. */
export function initAccessAliasEnvironment(): void {
  if (typeof window === "undefined" || !isAccessAliasHostname(window.location.hostname)) return;

  // Alternate hosts must never create duplicate search-engine results.
  const existingRobots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
  const robots = existingRobots ?? document.createElement("meta");
  robots.name = "robots";
  robots.content = "noindex,nofollow,noarchive";
  if (!existingRobots) document.head.appendChild(robots);

  // Covers normal anchors, including legacy hardcoded absolute links.
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      const accessAwareHref = getAccessAwareUrl(href);
      if (accessAwareHref !== href) anchor.href = accessAwareHref;
    },
    true,
  );

  // Covers button-driven links that intentionally use window.open().
  const originalOpen = window.open.bind(window);
  window.open = ((url?: string | URL, target?: string, features?: string) => {
    const accessAwareUrl =
      typeof url === "string" ? getAccessAwareUrl(url) : url;
    return originalOpen(accessAwareUrl, target, features);
  }) as typeof window.open;
}
