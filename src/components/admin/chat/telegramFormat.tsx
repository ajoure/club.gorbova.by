import type { ReactNode } from "react";

export const TELEGRAM_HTML_TAG_PATTERN = /<\/?(b|strong|i|em|u|s|strike|del|code|pre|a|tg-spoiler|br)\b/i;

export function getTelegramPlainText(text: string | null | undefined): string {
  const value = text || "";
  if (!TELEGRAM_HTML_TAG_PATTERN.test(value) || typeof DOMParser === "undefined") return value;
  const doc = new DOMParser().parseFromString(`<div>${value}</div>`, "text/html");
  return doc.body.textContent || "";
}

export function renderTelegramFormattedText(text: string): ReactNode {
  if (!TELEGRAM_HTML_TAG_PATTERN.test(text) || typeof DOMParser === "undefined") return text;

  const doc = new DOMParser().parseFromString(`<div>${text}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return text;

  const safeHref = (href: string | null) => {
    if (!href) return null;
    try {
      const url = new URL(href);
      return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
    } catch {
      return null;
    }
  };

  const walk = (node: ChildNode, key: string): ReactNode => {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1) return null;

    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (tag === "br") return "\n";

    const children = Array.from(el.childNodes).map((child, index) => walk(child, `${key}-${index}`));

    if (tag === "b" || tag === "strong") return <strong key={key} className="font-semibold">{children}</strong>;
    if (tag === "i" || tag === "em") return <em key={key}>{children}</em>;
    if (tag === "u") return <span key={key} className="underline underline-offset-2">{children}</span>;
    if (tag === "s" || tag === "strike" || tag === "del") return <span key={key} className="line-through">{children}</span>;
    if (tag === "code" || tag === "pre") return <code key={key} className="rounded bg-background/20 px-1 py-0.5 font-mono text-[0.92em]">{children}</code>;
    if (tag === "tg-spoiler") return <span key={key} className="rounded bg-foreground/15 px-1">{children}</span>;
    if (tag === "a") {
      const href = safeHref(el.getAttribute("href"));
      return href ? (
        <a key={key} href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
          {children}
        </a>
      ) : <span key={key}>{children}</span>;
    }

    return <span key={key}>{children}</span>;
  };

  return Array.from(root.childNodes).map((node, index) => walk(node, `tg-html-${index}`));
}

/** Pure preview builder — safe to call in precompute (no DOM state, no closures). */
export function buildQuotePreview(m: {
  message_text?: string | null;
  meta?: any;
}): string {
  const meta: any = m.meta || {};
  const fileType = meta.file_type;
  if (fileType === "photo") return "📷 Фото";
  if (fileType === "video") return "🎬 Видео";
  if (fileType === "video_note") return "⭕ Видео-кружок";
  if (fileType === "voice") return "🎤 Голосовое";
  if (fileType === "audio") return "🎵 Аудио";
  if (fileType === "document") return `📎 ${meta.file_name || "Документ"}`;
  if (fileType === "sticker") return "🌟 Стикер";
  const text = getTelegramPlainText(m.message_text).trim();
  return text.length > 80 ? text.slice(0, 80) + "…" : text || "Сообщение";
}
