interface LogosSectionProps {
  content: Record<string, unknown>;
}

export function LogosSection({ content }: LogosSectionProps) {
  const items = (content.items as Array<{ url: string; alt: string; linkUrl: string }>) || [];
  if (!items.length) return null;

  const logoHeight = (content.logoHeight as number) || 48;
  const grayscale = (content.grayscale as boolean) || false;

  return (
    <section className="py-8 px-6">
      <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-center gap-8">
        {items.map((item, i) => {
          const img = (
            <img
              src={item.url}
              alt={item.alt || ""}
              style={{ height: `${logoHeight}px` }}
              className={`object-contain ${grayscale ? "grayscale hover:grayscale-0 transition-all" : ""}`}
              loading="lazy"
            />
          );
          return item.linkUrl ? (
            <a key={i} href={item.linkUrl} target="_blank" rel="noopener noreferrer">{img}</a>
          ) : (
            <div key={i}>{img}</div>
          );
        })}
      </div>
    </section>
  );
}
