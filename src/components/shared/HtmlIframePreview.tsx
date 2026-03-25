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
 *   - NO allow-same-origin → iframe cannot access parent DOM, cookies, localStorage
 *   - Scripts allowed only for internal resize postMessage
 *   - Links open in new tab via <base target="_blank">
 *
 * ISOLATION INVARIANT:
 *   HTML block content does NOT integrate with platform services directly.
 *   No cross-domain actions. For integrations, use specialized block types.
 */

import { useState, useRef, useEffect } from "react";
import { Code } from "lucide-react";

const SANDBOX_POLICY =
  "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation";

/** Wrap user HTML in a full document with auto-resize script */
export function buildSrcdoc(html: string): string {
  const resizeScript = `
<script>
  function postHeight() {
    window.parent.postMessage({ type: 'iframe-resize', height: document.body.scrollHeight + 20 }, '*');
  }
  window.addEventListener('load', postHeight);
  window.addEventListener('resize', postHeight);
  new ResizeObserver(postHeight).observe(document.body);
  setTimeout(postHeight, 300);
</script>`;

  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${resizeScript}</body>`);
  }

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
${resizeScript}
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
  const [height, setHeight] = useState(200);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "iframe-resize" && typeof e.data.height === "number") {
        setHeight(Math.max(minHeight, e.data.height));
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
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
      style={{ width: "100%", height: `${height}px`, border: "none", overflow: "hidden" }}
      title="HTML Preview"
    />
  );
}
