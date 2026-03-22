import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

const SCROLL_KEY_PREFIX = "scroll:";
const MAX_ENTRIES = 50;

function saveScrollPosition(pathname: string) {
  try {
    sessionStorage.setItem(SCROLL_KEY_PREFIX + pathname, String(window.scrollY));
    // Cleanup old entries if exceeding limit
    const keys = Object.keys(sessionStorage).filter(k => k.startsWith(SCROLL_KEY_PREFIX));
    if (keys.length > MAX_ENTRIES) {
      keys.slice(0, keys.length - MAX_ENTRIES).forEach(k => sessionStorage.removeItem(k));
    }
  } catch {}
}

function restoreScrollPosition(pathname: string, attempt = 0) {
  const saved = sessionStorage.getItem(SCROLL_KEY_PREFIX + pathname);
  if (!saved) return;
  const target = parseInt(saved, 10);
  if (!target) return;

  requestAnimationFrame(() => {
    window.scrollTo(0, target);
    // If DOM hasn't grown tall enough yet, retry
    if (attempt < 3 && document.documentElement.scrollHeight < target + window.innerHeight) {
      setTimeout(() => restoreScrollPosition(pathname, attempt + 1), 100);
    }
  });
}

export function ScrollToTop() {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const prevPathRef = useRef(pathname);

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
