interface ButtonSectionProps {
  content: Record<string, unknown>;
}

export function ButtonSection({ content }: ButtonSectionProps) {
  const text = (content.text as string) || "";
  const link = (content.link as string) || "#";
  if (!text) return null;

  const variant = (content.variant as string) || "primary";
  const size = (content.size as string) || "md";
  const alignment = (content.alignment as string) || "center";

  const alignClass = alignment === "left" ? "text-left" : alignment === "right" ? "text-right" : "text-center";
  const sizeClass = size === "sm" ? "px-4 py-2 text-xs" : size === "lg" ? "px-10 py-4 text-base" : "px-8 py-3 text-sm";

  const variantClass =
    variant === "secondary"
      ? "bg-secondary text-secondary-foreground hover:bg-secondary/80"
      : variant === "outline"
        ? "border border-primary text-primary hover:bg-primary/10"
        : "bg-primary text-primary-foreground hover:bg-primary/90";

  return (
    <section className="py-6 px-6">
      <div className={`max-w-4xl mx-auto ${alignClass}`}>
        <a
          href={link}
          className={`inline-flex items-center justify-center rounded-md font-medium transition-colors ${sizeClass} ${variantClass}`}
        >
          {text}
        </a>
      </div>
    </section>
  );
}
