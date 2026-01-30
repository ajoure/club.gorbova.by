/**
 * External Link Kill Switch - диагностика и блокировка внешних переходов на kinescope.io
 * 
 * Перехватывает:
 * 1. Клики по <a href="...kinescope...">
 * 2. Вызовы window.open(...kinescope...)
 * 
 * При срабатывании: preventDefault, toast, console.trace
 */

import { toast } from "sonner";

// Build marker для диагностики версии
export const BUILD_MARKER = "build: 2026-01-30T19:30 ios-sync-guard-v7";

// Log build marker at startup
console.info(`[App] ${BUILD_MARKER}`);

// Blocked domains list
const BLOCKED_DOMAINS = ["kinescope.io"];

function isBlockedUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url, window.location.origin);
    return BLOCKED_DOMAINS.some(domain => parsed.hostname.includes(domain));
  } catch {
    // If can't parse, check raw string
    return BLOCKED_DOMAINS.some(domain => url.includes(domain));
  }
}

/**
 * Initialize kill switch - call once at app startup
 */
export function initExternalLinkKillSwitch(): void {
  // 1. Intercept clicks on <a> tags
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const anchor = target.closest('a') as HTMLAnchorElement | null;
    
    if (anchor?.href && isBlockedUrl(anchor.href)) {
      event.preventDefault();
      event.stopPropagation();
      
      const route = window.location.pathname;
      const dataAction = anchor.dataset.action || 'unknown';
      
      console.warn('[KillSwitch] Blocked external link click:', {
        href: anchor.href,
        route,
        dataAction,
        element: anchor,
      });
      console.trace('[KillSwitch] Stack trace:');
      
      toast.error("Внешний переход запрещён", {
        description: `Источник: ${route} / action: ${dataAction}`
      });
    }
  }, true); // capture phase to catch before propagation

  // 2. Monkey-patch window.open
  const originalWindowOpen = window.open.bind(window);
  
  (window as any).open = function(url?: string | URL, target?: string, features?: string): Window | null {
    const urlStr = String(url || '');
    
    if (isBlockedUrl(urlStr)) {
      const route = window.location.pathname;
      
      console.warn('[KillSwitch] Blocked window.open:', {
        url: urlStr,
        target,
        route,
      });
      console.trace('[KillSwitch] Stack trace:');
      
      toast.error("Внешний переход запрещён (window.open)", {
        description: `URL: ${urlStr.slice(0, 50)}...`
      });
      
      return null;
    }
    
    return originalWindowOpen(url, target, features);
  };

  console.info('[KillSwitch] External link kill switch initialized for:', BLOCKED_DOMAINS.join(', '));
}
