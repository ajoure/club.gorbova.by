const STORAGE_KEY = 'last_protected_route';

// Страницы, которые не нужно запоминать
const EXCLUDED_PATHS = ['/', '/auth', '/help', '/docs'];

// Тяжёлые маршруты, которые не сохраняем на iOS Safari (вызывают краш lovable.dev)
const HEAVY_PATHS_PREFIXES = ['/admin'];
const HEAVY_PATHS_CONTAINS = [
  '/kb-import',
  '/broadcast',
  '/communication',
  '/import',
  '/excel',
];

/**
 * Detect iOS Safari (iPhone, iPad, iPod)
 */
function isIOSSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIOS = /iP(hone|ad|od)/.test(ua);
  const isSafari = /Safari/.test(ua) && !/Chrome|CriOS|FxiOS/.test(ua);
  return isIOS && isSafari;
}

/**
 * Check if route is "heavy" (should not be auto-restored on iOS)
 */
function isHeavyRoute(pathname: string): boolean {
  // Check prefixes
  if (HEAVY_PATHS_PREFIXES.some(prefix => pathname.startsWith(prefix))) {
    return true;
  }
  // Check contains
  if (HEAVY_PATHS_CONTAINS.some(part => pathname.includes(part))) {
    return true;
  }
  return false;
}

export function saveLastRoute(pathname: string, search: string) {
  if (EXCLUDED_PATHS.some(p => pathname === p || pathname.startsWith('/auth'))) {
    return;
  }
  
  // iOS Safari guard: don't save heavy routes to prevent lovable.dev editor crashes
  if (isIOSSafari() && isHeavyRoute(pathname)) {
    console.info('[lastRoute] Skipping heavy route on iOS Safari:', pathname);
    return;
  }
  
  const fullPath = pathname + search;
  try {
    localStorage.setItem(STORAGE_KEY, fullPath);
  } catch (e) {
    // localStorage may be unavailable in some contexts
    console.warn('Failed to save last route:', e);
  }
}

export function getLastRoute(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function clearLastRoute() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore
  }
}

/**
 * Check if a stored route should be ignored on iOS Safari
 * (used as second line of defense in Auth.tsx)
 */
export function shouldIgnoreLastRouteOnIOS(route: string | null): boolean {
  if (!route) return false;
  if (!isIOSSafari()) return false;
  return isHeavyRoute(route);
}

/**
 * Force overwrite lastRoute to a safe fallback (used after ignoring heavy route)
 */
export function overwriteLastRoute(safePath: string) {
  try {
    localStorage.setItem(STORAGE_KEY, safePath);
  } catch {
    // Ignore
  }
}
