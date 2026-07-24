import { rec, CB_PALETTE } from "../manifest";

/**
 * Section 3 — Кейсы моих учеников (rec776467161 header + rec776467162 slider images).
 * Native horizontal scroll strip, no Tilda slider runtime.
 */
export function CasesSection() {
  const header = rec("rec776467161");
  const gallery = rec("rec776467162");
  const title = header.text[0] ?? "КЕЙСЫ МОИХ УЧЕНИКОВ";
  const hint = header.text[1] ?? "";
  // Slider images include multiple size variants; dedupe by original asset id.
  const seen = new Set<string>();
  const images = gallery.images.filter((u) => {
    const m = u.match(/tild[0-9a-f-]+/i);
    const key = m ? m[0] : u;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return (
    <section id="rec776467161" className="py-16 lg:py-20" style={{ background: CB_PALETTE.bg }}>
      <div className="mx-auto max-w-6xl px-5">
        <div className="flex items-baseline justify-between gap-4 mb-6 flex-wrap">
          <h2
            className="text-2xl sm:text-3xl lg:text-4xl font-semibold"
            style={{ color: CB_PALETTE.textStrong }}
          >
            {title}
          </h2>
          {hint && (
            <span className="text-xs" style={{ color: CB_PALETTE.muted }}>
              {hint}
            </span>
          )}
        </div>
      </div>
      <div className="mx-auto max-w-full overflow-x-auto scrollbar-none">
        <div className="flex gap-4 px-5 pb-4" style={{ width: "max-content" }}>
          {images.map((src, i) => (
            <div
              key={i}
              className="w-[260px] sm:w-[300px] shrink-0 rounded-2xl overflow-hidden"
              style={{ background: CB_PALETTE.bgSoft, border: `1px solid ${CB_PALETTE.border}` }}
            >
              <img
                src={src}
                alt={`Кейс ученика ${i + 1}`}
                loading="lazy"
                className="w-full h-[360px] object-cover"
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
