const ROOT_HOST = 'gorbova.by';
const ALIAS_PREFIX = 'a.';
const EXCLUDED_HOSTS = new Set(['access.gorbova.by', 'pdf.gorbova.by']);

function canonicalHostname(hostname: string): string | null {
  const normalized = hostname.toLowerCase().replace(/\.$/, '');
  const candidate = normalized.startsWith(ALIAS_PREFIX)
    ? normalized.slice(ALIAS_PREFIX.length)
    : normalized;
  if (candidate.startsWith(ALIAS_PREFIX)) return null;
  const belongsToRoot = candidate === ROOT_HOST || candidate.endsWith(`.${ROOT_HOST}`);
  if (!belongsToRoot || EXCLUDED_HOSTS.has(candidate)) return null;
  return candidate;
}

/** Accept only the alternate HTTPS contour, never previews or arbitrary Origin values. */
export function getAccessAliasOrigin(origin: string | null | undefined): string | null {
  if (!origin) return null;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return null;
    const normalized = parsed.hostname.toLowerCase().replace(/\.$/, '');
    if (!normalized.startsWith(ALIAS_PREFIX)) return null;
    const canonical = canonicalHostname(normalized);
    if (!canonical || normalized !== `${ALIAS_PREFIX}${canonical}`) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function resolvePublicReturnOrigin(
  requestOrigin: string | null | undefined,
  fallback = 'https://gorbova.by',
): string {
  return getAccessAliasOrigin(requestOrigin) ?? fallback;
}

/** Add exact `a.` mirrors to an existing production allow-list. */
export function expandWithAccessAliasOrigins(origins: Iterable<string>): Set<string> {
  const expanded = new Set<string>();
  for (const origin of origins) {
    expanded.add(origin);
    try {
      const parsed = new URL(origin);
      const canonical = canonicalHostname(parsed.hostname);
      if (parsed.protocol === 'https:' && canonical && !parsed.hostname.startsWith(ALIAS_PREFIX)) {
        expanded.add(`https://${ALIAS_PREFIX}${canonical}`);
      }
    } catch {
      // Invalid configured origins remain ignored by browser CORS checks.
    }
  }
  return expanded;
}
