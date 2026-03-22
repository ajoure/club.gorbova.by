import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

const SCROLL_KEY_PREFIX = "scroll:";
const MAX_ENTRIES = 50;

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

  let attempts = 0;
  const maxAttempts = 15;
  const interval = 150;

  const tryRestore = () => {
    attempts++;
    const canScroll = document.documentElement.scrollHeight >= target + window.innerHeight * 0.5;
    
    if (canScroll || attempts >= maxAttempts) {
      window.scrollTo(0, target);
      // Final verification after a short delay
      requestAnimationFrame(() => {
        if (Math.abs(window.scrollY - target) > 50 && attempts < maxAttempts) {
          window.scrollTo(0, target);
        }
      });
    } else {
      setTimeout(tryRestore, interval);
    }
  };

  // Start after first paint
  requestAnimationFrame(() => tryRestore());
}

// Also save on beforeunload (tab close, external navigation)
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    try {
      const pathname = window.location.pathname;
      if (window.scrollY > 0) {
        sessionStorage.setItem(SCROLL_KEY_PREFIX + pathname, String(window.scrollY));
      }
    } catch {}
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
