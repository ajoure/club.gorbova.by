// Diagnostic logs for iOS debugging (runs BEFORE React)
console.info('[Main] Starting React app');
console.info('[Main] pathname:', window.location.pathname);
console.info('[Main] search:', window.location.search);
console.info('[Main] userAgent:', navigator.userAgent);
console.info('[Main] inIframe:', (() => { try { return window.self !== window.top; } catch { return true; } })());

// Set global build marker for diagnostics
(window as any).__BUILD_MARKER__ = "ios-ultra-early-guard-v8";
console.info('[Main] build marker:', (window as any).__BUILD_MARKER__);

// Build fingerprint — compare preview vs published to detect stale deploys
declare const __BUILD_FINGERPRINT__: string;
(window as any).__BUILD_FINGERPRINT__ = typeof __BUILD_FINGERPRINT__ !== 'undefined' ? __BUILD_FINGERPRINT__ : 'unknown';
console.info('[Build] fingerprint:', (window as any).__BUILD_FINGERPRINT__);
console.info('[Build] origin:', window.location.origin, '| env:', window.location.hostname.includes('preview') ? 'PREVIEW' : 'PUBLISHED');

import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// iOS standalone (PWA / Add to Home Screen) detector — sets `is-ios-standalone`
// class on <html>. Used by index.css to apply notch/safe-area fixes ONLY in
// standalone mode, without affecting regular Safari browser mode.
try {
  const isStandalone =
    (typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(display-mode: standalone)").matches) ||
    // iOS Safari legacy flag
    (typeof navigator !== "undefined" && (navigator as any).standalone === true);
  if (isStandalone) {
    document.documentElement.classList.add("is-ios-standalone");
  }
} catch (e) {
  console.warn("[standalone-detect] failed", e);
}

// Force Vite cache invalidation
createRoot(document.getElementById("root")!).render(<App />);
