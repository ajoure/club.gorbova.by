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
  "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation";

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
  var parentViewport = { top: 0, height: 800 };
  var fixedSyncPending = false;

  function post() {
    var h = Math.max(
      document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0
    );
    try { parent.postMessage({ type: 'iframe-resize', height: h }, '*'); } catch (e) {}
  }

  function scheduleStagedSync() {
    post();
    scheduleFixedOverlaySync();
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
    observer = new ResizeObserver(function() {
      post();
      scheduleFixedOverlaySync();
    });
    observer.observe(document.body);
  }

  function isHidden(el) {
    if (!el || !el.getBoundingClientRect) return true;
    var cs = window.getComputedStyle(el);
    return cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0;
  }

  function isFullscreenFixedOverlay(el) {
    if (isHidden(el)) return false;
    var cs = window.getComputedStyle(el);
    if (cs.position !== 'fixed') return false;
    var rect = el.getBoundingClientRect();
    var docWidth = document.documentElement.clientWidth || window.innerWidth || 0;
    var docHeight = document.documentElement.clientHeight || window.innerHeight || 0;
    return rect.width >= docWidth * 0.9 && rect.height >= docHeight * 0.7 && Math.abs(rect.left) <= 2 && Math.abs(rect.top) <= 2;
  }

  function restoreFixedOverlay(el) {
    if (!el || el.getAttribute('data-lovable-fixed-overlay') !== '1') return;
    var props = ['position', 'top', 'right', 'bottom', 'left', 'height', 'min-height', 'width'];
    for (var i = 0; i < props.length; i++) el.style.removeProperty(props[i]);
    el.removeAttribute('data-lovable-fixed-overlay');
  }

  function syncFixedOverlays() {
    fixedSyncPending = false;
    var candidates = document.querySelectorAll('.fixed, [style*="position: fixed"], [style*="position:fixed"], [data-lovable-fixed-overlay="1"]');
    var docHeight = document.documentElement.scrollHeight || document.body.scrollHeight || parentViewport.height;
    var visibleHeight = Math.max(320, Math.min(parentViewport.height || 800, docHeight));
    var visibleTop = Math.max(0, Math.min(parentViewport.top || 0, Math.max(0, docHeight - visibleHeight)));
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (isFullscreenFixedOverlay(el) || el.getAttribute('data-lovable-fixed-overlay') === '1') {
        if (isHidden(el)) {
          restoreFixedOverlay(el);
          continue;
        }
        el.setAttribute('data-lovable-fixed-overlay', '1');
        el.style.setProperty('position', 'absolute', 'important');
        el.style.setProperty('top', visibleTop + 'px', 'important');
        el.style.setProperty('left', '0', 'important');
        el.style.setProperty('right', '0', 'important');
        el.style.setProperty('bottom', 'auto', 'important');
        el.style.setProperty('width', '100%', 'important');
        el.style.setProperty('height', visibleHeight + 'px', 'important');
        el.style.setProperty('min-height', visibleHeight + 'px', 'important');
      }
    }
  }

  function scheduleFixedOverlaySync() {
    if (fixedSyncPending) return;
    fixedSyncPending = true;
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(syncFixedOverlays);
    else setTimeout(syncFixedOverlays, 0);
  }

  window.addEventListener('message', function(ev) {
    var data = ev.data;
    if (!data || typeof data !== 'object' || data.type !== 'iframe-parent-viewport') return;
    if (typeof data.top === 'number' && Number.isFinite(data.top)) parentViewport.top = data.top;
    if (typeof data.height === 'number' && Number.isFinite(data.height)) parentViewport.height = data.height;
    scheduleFixedOverlaySync();
  });

  window.addEventListener('wheel', function(ev) {
    try {
      parent.postMessage({ type: 'iframe-wheel', deltaX: ev.deltaX || 0, deltaY: ev.deltaY || 0 }, '*');
    } catch (e) {}
  }, { passive: true });

  if (typeof MutationObserver !== 'undefined' && document.body) {
    var mutationObserver = new MutationObserver(function() {
      post();
      scheduleFixedOverlaySync();
    });
    mutationObserver.observe(document.body, { attributes: true, childList: true, subtree: true, attributeFilter: ['class', 'style', 'hidden'] });
    window.addEventListener('beforeunload', function() { mutationObserver.disconnect(); });
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

function findScrollContainer(element: HTMLElement | null): HTMLElement | null {
  let node = element?.parentElement ?? null;
  while (node) {
    const style = window.getComputedStyle(node);
    const canScrollY = /(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1;
    if (canScrollY) return node;
    node = node.parentElement;
  }
  const doc = document.scrollingElement as HTMLElement | null;
  return doc && doc.scrollHeight > doc.clientHeight + 1 ? doc : null;
}

export function HtmlIframePreview({
  html,
  emptyText = "Вставьте HTML-код",
  minHeight = 100,
}: HtmlIframePreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(minHeight);

  const postParentViewport = () => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    try {
      const rect = iframe.getBoundingClientRect();
      const scrollContainer = findScrollContainer(iframe);
      const containerRect = scrollContainer?.getBoundingClientRect();
      const viewportTop = containerRect?.top ?? resolveHeaderOffset();
      const viewportBottom = containerRect?.bottom ?? (window.innerHeight || document.documentElement.clientHeight || 800);
      const visibleTop = Math.max(0, viewportTop - rect.top);
      const visibleBottom = Math.min(rect.height, viewportBottom - rect.top);
      const visibleHeight = Math.max(320, visibleBottom - visibleTop);
      iframe.contentWindow.postMessage(
        {
          type: 'iframe-parent-viewport',
          top: visibleTop,
          height: visibleHeight,
        },
        '*',
      );
    } catch {}
  };

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
        postParentViewport();
        return;
      }

      if (data.type === 'iframe-anchor' || data.type === 'iframe-scroll-to-element') {
        const targetOffsetTop = typeof data.targetOffsetTop === 'number' && Number.isFinite(data.targetOffsetTop)
          ? data.targetOffsetTop
          : 0;
        try {
          const iframe = iframeRef.current;
          const rect = iframe.getBoundingClientRect();
          const scrollContainer = findScrollContainer(iframe);
          const containerRect = scrollContainer?.getBoundingClientRect();
          const containerScrollTop = scrollContainer?.scrollTop ?? (window.pageYOffset || document.documentElement.scrollTop || 0);
          const headerOffset = resolveHeaderOffset();
          const top = Math.max(
            0,
            rect.top - (containerRect?.top ?? 0) + containerScrollTop
              + targetOffsetTop
              - headerOffset
              - 12
          );
          if (scrollContainer) scrollContainer.scrollTo({ top, behavior: 'smooth' });
          else window.scrollTo({ top, behavior: 'smooth' });
        } catch {}
        return;
      }

      if (data.type === 'iframe-wheel') {
        const deltaY = typeof data.deltaY === 'number' && Number.isFinite(data.deltaY) ? data.deltaY : 0;
        const deltaX = typeof data.deltaX === 'number' && Number.isFinite(data.deltaX) ? data.deltaX : 0;
        const scrollContainer = findScrollContainer(iframeRef.current);
        if (scrollContainer && (deltaY || deltaX)) {
          scrollContainer.scrollBy({ top: deltaY, left: deltaX, behavior: 'auto' });
          postParentViewport();
        }
        return;
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [minHeight]);

  useEffect(() => {
    postParentViewport();
    const onViewportChange = () => postParentViewport();
    window.addEventListener('scroll', onViewportChange, { passive: true });
    window.addEventListener('resize', onViewportChange);
    return () => {
      window.removeEventListener('scroll', onViewportChange);
      window.removeEventListener('resize', onViewportChange);
    };
  }, [height, html]);

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
      onLoad={postParentViewport}
      style={{ width: "100%", height: `${height}px`, border: "none", overflow: "hidden" }}
      title="HTML Preview"
    />
  );
}
