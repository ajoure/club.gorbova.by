/**
 * HtmlIframePreview — shared infrastructure / adapter-like preview layer.
 *
 * Renders arbitrary admin-authored HTML inside a sandboxed iframe with auto-resize.
 * This is a SHARED INFRASTRUCTURE component — no domain logic belongs here.
 *
 * TRUST BOUNDARY:
 *   This component is designed for admin-authored content only.
 *   It MUST NOT be used for student/user-generated surfaces without
 *   a separate sanitization policy on top.
 *
 * SECURITY BOUNDARY:
 *   sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
 *   - allow-scripts: INTENTIONAL — required for internal resize postMessage mechanism.
 *     Safe because allow-same-origin is excluded, so the iframe cannot access
 *     parent DOM, cookies, localStorage, or any platform services.
 *   - NO allow-same-origin → full cross-origin isolation maintained
 *   - Links open in new tab via <base target="_blank">
 *
 * ISOLATION INVARIANT:
 *   HTML block content does NOT integrate with platform services directly.
 *   No cross-domain actions. For integrations, use specialized block types.
 */

import { useState, useRef, useEffect } from "react";
import { Code } from "lucide-react";

/**
 * allow-scripts is required for the internal resize postMessage mechanism.
 * allow-same-origin is deliberately excluded — the iframe remains fully
 * cross-origin isolated and cannot touch parent DOM/cookies/storage.
 */
const SANDBOX_POLICY =
  "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation";

/** Maximum iframe height in px to prevent runaway content */
const MAX_IFRAME_HEIGHT = 15000;

/** Unique marker to prevent double injection of resize script */
const RESIZE_MARKER = "data-lovable-resize-v1";

/** Auto-resize script injected into every iframe srcdoc */
const RESIZE_SCRIPT = `<script ${RESIZE_MARKER}>
(function() {
  var timers = [];
  var observer = null;

  function post() {
    var h = Math.max(
      document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0
    );
    parent.postMessage({ type: 'iframe-resize', height: h }, '*');
  }

  function scheduleStagedSync() {
    post();
    timers.push(setTimeout(post, 50));
    timers.push(setTimeout(post, 300));
  }

  window.addEventListener('load', scheduleStagedSync);
  window.addEventListener('resize', post);

  if (typeof ResizeObserver !== 'undefined' && document.body) {
    observer = new ResizeObserver(post);
    observer.observe(document.body);
  }

  window.addEventListener('beforeunload', function() {
    for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]);
    timers = [];
    if (observer) { observer.disconnect(); observer = null; }
  });

  scheduleStagedSync();
})();
<\/script>`;

/**
 * Wrap or augment admin HTML with auto-resize script.
 *
 * Three branches:
 * 1. Already processed (contains marker) → return as-is
 * 2. Full document with </body> → inject script before </body>, add <base> if missing
 * 3. Fragment / malformed → wrap in full document template
 */
export function buildSrcdoc(html: string): string {
  // Branch 1: idempotency — already processed
  if (html.includes(RESIZE_MARKER)) {
    return html;
  }

  // Branch 2: full HTML document with closing body tag
  if (/<\/body>/i.test(html)) {
    let result = html.replace(/<\/body>/i, `${RESIZE_SCRIPT}\n</body>`);

    // Inject <base target="_blank"> only if no <base> tag exists at all
    if (!/<base[\s>]/i.test(result)) {
      result = result.replace(/<\/head>/i, `  <base target="_blank">\n</head>`);
    }

    return result;
  }

  // Branch 3: fragment or malformed — wrap in full document
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <base target="_blank">
  <style>body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }</style>
</head>
<body>
${html}
${RESIZE_SCRIPT}
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

export function HtmlIframePreview({
  html,
  emptyText = "Вставьте HTML-код",
  minHeight = 100,
}: HtmlIframePreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(minHeight);

  // Lifecycle boundary: reset height when html is cleared.
  // This is NOT just a visual reset — it prevents stale height artifacts
  // from a previous iframe leaking into the next content cycle.
  useEffect(() => {
    if (!html.trim()) {
      setHeight(minHeight);
    }
  }, [html, minHeight]);

  // Floor adjustment: if minHeight changes on a mounted block,
  // ensure current height respects the new floor immediately.
  useEffect(() => {
    setHeight((prev) => Math.max(minHeight, prev));
  }, [minHeight]);

  // Message listener for iframe resize events
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      // Lifecycle guard: ignore messages if ref is null (unmounted or empty state)
      if (!iframeRef.current) return;

      // Multi-iframe isolation: only accept messages from our iframe
      if (e.source !== iframeRef.current.contentWindow) return;

      // Payload validation
      if (e.data?.type !== 'iframe-resize') return;
      const rawHeight = e.data.height;
      if (typeof rawHeight !== 'number' || !Number.isFinite(rawHeight) || rawHeight < 0) return;

      // Clamp: ceil to avoid fractional pixels, enforce floor and ceiling
      const clamped = Math.max(minHeight, Math.min(Math.ceil(rawHeight), MAX_IFRAME_HEIGHT));

      // Prevent redundant re-renders
      setHeight((prev) => (prev === clamped ? prev : clamped));
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
      style={{ width: "100%", height: `${height}px`, border: "none", overflow: "auto" }}
      title="HTML Preview"
    />
  );
}
