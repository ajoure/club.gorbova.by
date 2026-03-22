import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

const SCROLL_KEY_PREFIX = "scroll:";
const MAX_ENTRIES = 50;
const RESTORE_TIMEOUT = 5000;
const SCROLL_THROTTLE_MS = 150;

// ── Continuous scroll tracking ──────────────────────────────────────────
// We MUST save scroll position continuously because by the time
// React Router unmounts the old route and our useEffect runs,
// window.scrollY is already 0 (old content is gone).
let currentPathname = typeof window !== "undefined" ? window.location.pathname : "/";
let scrollThrottleTimer: ReturnType<typeof setTimeout> | null = null;

function onScroll() {
  if (scrollThrottleTimer) return;
  scrollThrottleTimer = setTimeout(() => {
    scrollThrottleTimer = null;
    const y = window.scrollY;
    if (y > 0) {
      try {
        sessionStorage.setItem(SCROLL_KEY_PREFIX + currentPathname, String(y));
      } catch {}
    }
  }, SCROLL_THROTTLE_MS);
}

// ── Tab-switch scroll guard (P1 backup) ─────────────────────────────────
// Save scrollY when tab goes hidden; restore when visible — protects against
// any component that might cause DOM collapse / re-render on tab return.
let savedScrollOnHide = 0;

if (typeof window !== "undefined") {
  window.addEventListener("scroll", onScroll, { passive: true });

  // Save on beforeunload (tab close, external navigation)
  window.addEventListener("beforeunload", () => {
    try {
      if (window.scrollY > 0) {
        sessionStorage.setItem(SCROLL_KEY_PREFIX + window.location.pathname, String(window.scrollY));
      }
    } catch {}
  });

  // Save on visibility change (tab switch) + restore guard
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      savedScrollOnHide = window.scrollY;
      try {
        if (window.scrollY > 0) {
          sessionStorage.setItem(SCROLL_KEY_PREFIX + window.location.pathname, String(window.scrollY));
        }
      } catch {}
    } else if (document.visibilityState === "visible" && savedScrollOnHide > 0) {
      // Restore scroll position after tab return — use rAF to wait for any re-renders
      const target = savedScrollOnHide;
      requestAnimationFrame(() => {
        if (Math.abs(window.scrollY - target) > 50) {
          window.scrollTo(0, target);
        }
        // Double-check after potential async re-renders
        requestAnimationFrame(() => {
          if (Math.abs(window.scrollY - target) > 50) {
            window.scrollTo(0, target);
          }
        });
      });
    }
  });
}

function cleanupOldEntries() {
  try {
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

  // Fallback timeout
  const timeout = setTimeout(() => {
    observer.disconnect();
    tryScroll();
  }, RESTORE_TIMEOUT);

  const cleanup = () => {
    observer.disconnect();
    clearTimeout(timeout);
  };

  (window as any).__scrollRestoreCleanup = cleanup;
}

export function ScrollToTop() {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const prevPathRef = useRef(pathname);

  // Disable browser's built-in scroll restoration
  useEffect(() => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);

  // Update the tracked pathname for the scroll listener
  useEffect(() => {
    if (prevPathRef.current !== pathname) {
      // Abort any pending restoration from previous navigation
      if ((window as any).__scrollRestoreCleanup) {
        (window as any).__scrollRestoreCleanup();
        (window as any).__scrollRestoreCleanup = null;
      }
      // Update currentPathname so the scroll listener saves to the right key
      currentPathname = pathname;
      prevPathRef.current = pathname;
      cleanupOldEntries();
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
