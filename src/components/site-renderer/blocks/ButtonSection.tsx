import { useSiteVisibility } from "../SiteVisibilityContext";
import { sanitizeHtml } from "@/lib/sanitization";

interface ButtonSectionProps {
  content: Record<string, unknown>;
  blockId?: string;
}

type ActionType = "link" | "scroll_to_anchor" | "show_block" | "toggle_block" | "open_form";

export function ButtonSection({ content, blockId }: ButtonSectionProps) {
  const text = (content.text as string) || "";
  if (!text) return null;

  const variant = (content.variant as string) || "primary";
  const size = (content.size as string) || "md";
  const alignment = (content.alignment as string) || "center";

  const action = (content.action as { type?: ActionType; target?: string } | undefined) || { type: "link", target: "" };
  const actionType: ActionType = action.type || "link";
  const target = (action.target || "").trim();

  const visibility = useSiteVisibility();

  const alignClass = alignment === "left" ? "text-left" : alignment === "right" ? "text-right" : "text-center";
  const sizeClass = size === "sm" ? "px-4 py-2 text-xs" : size === "lg" ? "px-10 py-4 text-base" : "px-8 py-3 text-sm";
  const variantClass =
    variant === "secondary"
      ? "bg-secondary text-secondary-foreground hover:bg-secondary/80"
      : variant === "outline"
        ? "border border-primary text-primary hover:bg-primary/10"
        : "bg-primary text-primary-foreground hover:bg-primary/90";

  const baseClass = `inline-flex items-center justify-center rounded-md font-medium transition-colors ${sizeClass} ${variantClass}`;

  // ─── Backward-compat: classic link ───
  if (actionType === "link") {
    const link = (content.link as string) || "#";
    return (
      <section className="py-6 px-6">
        <div className={`max-w-4xl mx-auto ${alignClass}`}>
          <a href={link} className={baseClass} dangerouslySetInnerHTML={{ __html: sanitizeHtml(text) }} />
        </div>
      </section>
    );
  }

  // ─── Runtime actions ───
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!target) return;
    // Защита от self-target в runtime (на случай пропуска валидации)
    if (blockId && target === blockId) return;

    if (actionType === "scroll_to_anchor") {
      const el = document.getElementById(target);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (actionType === "show_block") {
      visibility.show(target);
      // После показа — попробовать прокрутить к нему, если есть DOM-узел
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>(`[data-block-id="${target}"]`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      return;
    }
    if (actionType === "toggle_block") {
      visibility.toggle(target);
      return;
    }
    if (actionType === "open_form") {
      // Сначала гарантируем, что форма видна, затем скроллим
      visibility.show(target);
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>(`[data-block-id="${target}"]`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          const input = el.querySelector<HTMLElement>("input, textarea, select, button");
          if (input) setTimeout(() => input.focus(), 350);
        }
      });
      return;
    }
  };

  return (
    <section className="py-6 px-6">
      <div className={`max-w-4xl mx-auto ${alignClass}`}>
        <button type="button" onClick={handleClick} className={baseClass} dangerouslySetInnerHTML={{ __html: sanitizeHtml(text) }} />
      </div>
    </section>
  );
}
