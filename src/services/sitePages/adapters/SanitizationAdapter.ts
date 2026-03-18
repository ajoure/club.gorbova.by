/**
 * SanitizationAdapter — shared DOMPurify configuration.
 * Single policy for all HTML content blocks (text, html, etc.).
 * Allows: <style>, style="", standard formatting tags.
 * Strips: <iframe>, <script>, <embed>, <object>, event handlers.
 */
import DOMPurify from "dompurify";

const SANITIZE_CONFIG: DOMPurify.Config = {
  ALLOWED_TAGS: [
    "p", "br", "strong", "b", "em", "i", "u", "s", "strike",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li",
    "a", "span", "div", "blockquote", "pre", "code",
    "table", "thead", "tbody", "tr", "th", "td",
    "img", "hr", "sup", "sub", "mark",
    "style",
  ],
  ALLOWED_ATTR: [
    "href", "target", "rel", "src", "alt", "width", "height",
    "class", "id", "style", "colspan", "rowspan", "loading",
  ],
  FORBID_TAGS: ["iframe", "script", "embed", "object", "form"],
  FORBID_ATTR: [
    "onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur",
    "onsubmit", "onchange", "oninput",
  ],
};

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, SANITIZE_CONFIG);
}
