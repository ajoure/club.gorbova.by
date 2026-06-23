/**
 * HtmlIframePreview — shared infrastructure / adapter-like preview layer.
 *
 * Renders arbitrary admin-authored HTML inside a sandboxed iframe with auto-resize,
 * in-page anchor delegation to the parent window, and safe external-link opening.
 *
 * TRUST BOUNDARY:
 *   Admin-authored content only. Not for student/user-generated input without
 *   a separate sanitization policy.
 *
 * SECURITY BOUNDARY:
 *   sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
 *   - allow-scripts: required for internal resize/anchor postMessage bridge.
 *   - allow-same-origin: NOT granted. The iframe remains opaque-origin; the parent
 *     identifies messages by `e.source === iframe.contentWindow` (origin check is
 *     not reliable for srcdoc).
 *   - External links open via window.open(url, '_blank', 'noopener,noreferrer').
 *
 * ISOLATION INVARIANT:
 *   HTML block content does NOT integrate with platform services directly.
 */

import { useState, useRef, useEffect } from "react";
import { Code } from "lucide-react";

const SANDBOX_POLICY =
  "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation";

/** Maximum iframe height in px to prevent runaway content */
const MAX_IFRAME_HEIGHT = 15000;

/** Unique marker to prevent double injection of bridge script (versioned). */
const BRIDGE_MARKER = "data-lovable-resize-v2";

/**
 * Single injected bridge script: resize + anchor intercept + scrollIntoView intercept
 * + external link safe-open. Idempotent via BRIDGE_MARKER.
 */
const BRIDGE_SCRIPT = `<script ${BRIDGE_MARKER}>
(function() {
  if (document.documentElement.getAttribute('${BRIDGE_MARKER}') === '1') return;
  document.documentElement.setAttribute('${BRIDGE_MARKER}', '1');

  // Inject CSS so iframe document never grows its own scroll container.
  try {
    var st = document.createElement('style');
    st.setAttribute('${BRIDGE_MARKER}', '1');
    st.textContent = 'html,body{overflow:visible !important;height:auto !important;}';
    (document.head || document.documentElement).appendChild(st);
  } catch (e) {}

  var timers = [];
  var observer = null;

  function post() {
    var h = Math.max(
      document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0
    );
    try { parent.postMessage({ type: 'iframe-resize', height: h }, '*'); } catch (e) {}
  }

  function scheduleStagedSync() {
    post();
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(post);
    }
    timers.push(setTimeout(post, 50));
    timers.push(setTimeout(post, 300));
    timers.push(setTimeout(post, 1200));
  }

  // Fire as soon as the script runs (we are injected at end of <body>).
  scheduleStagedSync();
  window.addEventListener('load', scheduleStagedSync);
  window.addEventListener('resize', post);

  // Fonts/images can change layout after first paint.
  if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === 'function') {
    document.fonts.ready.then(post).catch(function(){});
  }
  try {
    var imgs = document.images || [];
    for (var i = 0; i < imgs.length; i++) {
      if (!imgs[i].complete) imgs[i].addEventListener('load', post, { once: true });
    }
  } catch (e) {}

  if (typeof ResizeObserver !== 'undefined' && document.body) {
    observer = new ResizeObserver(post);
    observer.observe(document.body);
  }

  window.addEventListener('beforeunload', function() {
    for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]);
    timers = [];
    if (observer) { observer.disconnect(); observer = null; }
  });

  // ---- Anchor / link intercept (capture phase, so author handlers still run if they want) ----
  function findAnchor(node) {
    while (node && node !== document) {
      if (node.tagName === 'A') return node;
      node = node.parentNode;
    }
    return null;
  }

  document.addEventListener('click', function(ev) {
    if (ev.defaultPrevented) return;
    // Respect modifier keys / non-primary buttons → let browser handle.
    if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;

    var a = findAnchor(ev.target);
    if (!a) return;

    var rawHref = a.getAttribute('href');
    if (rawHref === null) return;

    // Empty or bare "#" — neutralize (do not open new tab, do not jump to top).
    if (rawHref === '' || rawHref === '#') {
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }

    // In-page hash anchor.
    if (rawHref.charAt(0) === '#') {
      var id = rawHref.slice(1);
      var el = id ? document.getElementById(id) : null;
      var targetOffsetTop = el
        ? (el.getBoundingClientRect().top + (window.pageYOffset || document.documentElement.scrollTop || 0))
        : 0;
      ev.preventDefault();
      ev.stopPropagation();
      try {
        parent.postMessage({
          type: 'iframe-anchor',
          id: id,
          targetOffsetTop: targetOffsetTop,
          found: !!el
        }, '*');
      } catch (e) {}
      return;
    }

    // javascript: / mailto: / tel: — let browser/author handle.
    if (/^(javascript|mailto|tel|sms):/i.test(rawHref)) return;

    // External link — open safely in new tab.
    var url = a.href; // resolved absolute URL
    ev.preventDefault();
    ev.stopPropagation();
    try { window.open(url, '_blank', 'noopener,noreferrer'); } catch (e) {}
  }, true);

  // ---- Element.prototype.scrollIntoView intercept with fallback ----
  try {
    var nativeScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function(arg) {
      try {
        if (this && this.getBoundingClientRect && this.ownerDocument === document) {
          var top = this.getBoundingClientRect().top
            + (window.pageYOffset || document.documentElement.scrollTop || 0);
          parent.postMessage({
            type: 'iframe-scroll-to-element',
            targetOffsetTop: top,
            block: (arg && typeof arg === 'object' && arg.block) ? arg.block : 'start'
          }, '*');
          return;
        }
      } catch (e) {}
      return nativeScrollIntoView.apply(this, arguments);
    };
  } catch (e) {}
})();
<\/script>`;

/**
 * Wrap or augment admin HTML with the bridge script. Note: we deliberately do
 * NOT inject `<base target="_blank">` — link target handling is done inside the
 * bridge script per-link to preserve in-page anchors.
 */
export function buildSrcdoc(html: string): string {
  // Idempotent — already processed
  if (html.includes(BRIDGE_MARKER)) return html;

  // Full HTML document with closing body tag
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${BRIDGE_SCRIPT}\n</body>`);
  }

  // Fragment / malformed — wrap
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }</style>
</head>
<body>
${html}
${BRIDGE_SCRIPT}
</body>
</html>`;
}

interface HtmlIframePreviewProps {
  html: string;
  /** Placeholder text when html is empty */
  emptyText?: string;
  /** Minimum iframe height in px */
  minHeight?: number;
}

/** Resolve parent page header offset for accurate anchor scroll. */
function resolveHeaderOffset(): number {
  try {
    const tagged = document.querySelector('[data-site-header]') as HTMLElement | null;
    if (tagged) return tagged.getBoundingClientRect().height;
    const hdr = document.querySelector('header') as HTMLElement | null;
    if (hdr) return hdr.getBoundingClientRect().height;
  } catch {}
  return 80;
}

export function HtmlIframePreview({
  html,
  emptyText = "Вставьте HTML-код",
  minHeight = 100,
}: HtmlIframePreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(minHeight);

  useEffect(() => {
    if (!html.trim()) setHeight(minHeight);
  }, [html, minHeight]);

  useEffect(() => {
    setHeight((prev) => Math.max(minHeight, prev));
  }, [minHeight]);

  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      // Strict source check — origin is opaque for srcdoc, do not rely on it.
      if (!iframeRef.current) return;
      if (e.source !== iframeRef.current.contentWindow) return;

      const data: any = e.data;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'iframe-resize') {
        const raw = data.height;
        if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return;
        const clamped = Math.max(minHeight, Math.min(Math.ceil(raw), MAX_IFRAME_HEIGHT));
        setHeight((prev) => (prev === clamped ? prev : clamped));
        return;
      }

      if (data.type === 'iframe-anchor' || data.type === 'iframe-scroll-to-element') {
        const targetOffsetTop = typeof data.targetOffsetTop === 'number' && Number.isFinite(data.targetOffsetTop)
          ? data.targetOffsetTop
          : 0;
        try {
          const rect = iframeRef.current.getBoundingClientRect();
          const headerOffset = resolveHeaderOffset();
          const top = Math.max(
            0,
            rect.top + (window.pageYOffset || document.documentElement.scrollTop || 0)
              + targetOffsetTop
              - headerOffset
              - 12
          );
          window.scrollTo({ top, behavior: 'smooth' });
        } catch {}
        return;
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [minHeight]);

  if (!html.trim()) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Code className="h-8 w-8 mr-2 opacity-50" />
        <span>{emptyText}</span>
      </div>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      srcDoc={buildSrcdoc(html)}
      sandbox={SANDBOX_POLICY}
      scrolling="no"
      style={{ width: "100%", height: `${height}px`, border: "none", overflow: "hidden" }}
      title="HTML Preview"
    />
  );
}
