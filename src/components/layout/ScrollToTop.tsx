import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

const SCROLL_KEY_PREFIX = "scroll:";
const MAX_ENTRIES = 50;
const RESTORE_TIMEOUT = 5000;

function saveScrollPosition(pathname: string) {
  try {
    const y = window.scrollY;
    if (y > 0) {
      sessionStorage.setItem(SCROLL_KEY_PREFIX + pathname, String(y));
    }
    // Cleanup old entries if exceeding limit
    const keys = Object.keys(sessionStorage).filter(k => k.startsWith(SCROLL_KEY_PREFIX));
    if (keys.length > MAX_ENTRIES) {
      keys.slice(0, keys.length - MAX_ENTRIES).forEach(k => sessionStorage.removeItem(k));
    }
  } catch {}
}

function restoreScrollPosition(pathname: string) {
  const saved = sessionStorage.getItem(SCROLL_KEY_PREFIX + pathname);
  if (!saved) return;
  const target = parseInt(saved, 10);
  if (!target || target <= 0) return;

  // Try immediately first
  const tryScroll = () => {
    window.scrollTo(0, target);
  };

  const canScroll = () => 
    document.documentElement.scrollHeight >= target + window.innerHeight * 0.5;

  // If DOM is already tall enough, scroll immediately
  if (canScroll()) {
    requestAnimationFrame(tryScroll);
    return;
  }

  // Otherwise use MutationObserver to wait for content
  const observer = new MutationObserver(() => {
    if (canScroll()) {
      observer.disconnect();
      tryScroll();
      // Verify after paint
      requestAnimationFrame(() => {
        if (Math.abs(window.scrollY - target) > 50) {
          tryScroll();
        }
      });
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: false,
    characterData: false,
  });

  // Fallback timeout - force scroll even if height never reaches target
  const timeout = setTimeout(() => {
    observer.disconnect();
    tryScroll();
  }, RESTORE_TIMEOUT);

  // Cleanup on next navigation (stored for potential abort)
  const cleanup = () => {
    observer.disconnect();
    clearTimeout(timeout);
  };

  // Store cleanup on window for potential early abort
  (window as any).__scrollRestoreCleanup = cleanup;
}

// Save on beforeunload (tab close, external navigation)
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    try {
      const pathname = window.location.pathname;
      if (window.scrollY > 0) {
        sessionStorage.setItem(SCROLL_KEY_PREFIX + pathname, String(window.scrollY));
      }
    } catch {}
  });

  // Save on visibility change (tab switch)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      try {
        const pathname = window.location.pathname;
        if (window.scrollY > 0) {
          sessionStorage.setItem(SCROLL_KEY_PREFIX + pathname, String(window.scrollY));
        }
      } catch {}
    }
  });
}

export function ScrollToTop() {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const prevPathRef = useRef(pathname);

  // Disable browser's built-in scroll restoration to prevent conflicts
  useEffect(() => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);

  // Save scroll position of the previous page before navigating away
  useEffect(() => {
    if (prevPathRef.current !== pathname) {
      // Abort any pending restoration from previous navigation
      if ((window as any).__scrollRestoreCleanup) {
        (window as any).__scrollRestoreCleanup();
        (window as any).__scrollRestoreCleanup = null;
      }
      saveScrollPosition(prevPathRef.current);
      prevPathRef.current = pathname;
    }
  }, [pathname]);

  useEffect(() => {
    if (navigationType === "POP") {
      restoreScrollPosition(pathname);
    } else {
      window.scrollTo(0, 0);
    }
  }, [pathname, navigationType]);

  return null;
}
