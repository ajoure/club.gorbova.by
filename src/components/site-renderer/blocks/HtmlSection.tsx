import { sanitizeHtml } from "@/services/sitePages/adapters/SanitizationAdapter";

interface HtmlSectionProps {
  content: Record<string, unknown>;
}

export function HtmlSection({ content }: HtmlSectionProps) {
  const code = (content.code as string) || "";
  if (!code) return null;

  const sanitized = sanitizeHtml(code);

  return (
    <section className="py-6 px-6">
      <div className="max-w-4xl mx-auto" dangerouslySetInnerHTML={{ __html: sanitized }} />
    </section>
  );
}
