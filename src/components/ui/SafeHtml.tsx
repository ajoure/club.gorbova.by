import { sanitizeHtml } from "@/lib/sanitization";

type AllowedTag = "span" | "div" | "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "footer" | "blockquote" | "section";

interface SafeHtmlProps {
  html: string;
  as?: AllowedTag;
  className?: string;
}

export function SafeHtml({ html, as: Tag = "span", className }: SafeHtmlProps) {
  return <Tag className={className} dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />;
}
