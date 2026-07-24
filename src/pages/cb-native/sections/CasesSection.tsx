import { rec, CB_PALETTE } from "../manifest";

/**
 * Section 3 — Кейсы моих учеников (rec776467161 header + rec776467162 gallery).
 * Uses full-size static.tildacdn.com case images only (excludes thb thumbnails
 * and optim/webp duplicates). Native responsive: desktop grid, mobile horizontal swipe.
 */
export function CasesSection() {
  const header = rec("rec776467161");
  const gallery = rec("rec776467162");
  const title = header.text[0] ?? "КЕЙСЫ МОИХ УЧЕНИКОВ";
  const swipeHint = header.text[1] ?? "Свайпай влево";

  // Case screenshots live at static.tildacdn.com. Exclude thumbnails (thb.*, /resizeb/),
  // optim webp duplicates, and the composite header image group-122.
  const seen = new Set<string>();
  const images = gallery.images.filter((u) => {
    if (!u.startsWith("https://static.tildacdn.com/")) return false;
    if (u.includes("/resizeb/")) return false;
    if (u.includes("group-122")) return false;
    const file = u.split("/").pop() ?? u;
    if (seen.has(file)) return false;
    seen.add(file);
    return true;
  });

  return (
    <section
      id="rec776467161"
      data-cb-native-section="cases"
      className="py-16 lg:py-24"
      style={{ background: CB_PALETTE.bgSoft }}
    >
      <div className="mx-auto max-w-[1160px] px-5">
        <div className="mb-8 flex flex-col items-start gap-2 md:mb-10 md:flex-row md:items-baseline md:justify-between md:gap-6">
          <h2
            className="text-[32px] font-bold uppercase leading-[1.1] md:text-[42px]"
            style={{ color: CB_PALETTE.accent }}
          >
            {title}
          </h2>
          <span
            className="text-[13px] uppercase tracking-[0.14em] md:hidden"
            style={{ color: CB_PALETTE.muted }}
          >
            {swipeHint} →
          </span>
        </div>
      </div>

      {/* Mobile: horizontal swipe strip */}
      <div
        className="md:hidden -mx-0 overflow-x-auto"
        style={{ scrollbarWidth: "none" }}
        data-cb-native-cases-swipe
      >
        <div className="flex gap-4 px-5 pb-4" style={{ width: "max-content" }}>
          {images.map((src, i) => (
            <div
              key={src}
              data-cb-native-case-item
              className="w-[260px] shrink-0 overflow-hidden rounded-[18px] bg-white"
              style={{ border: `1px solid ${CB_PALETTE.border}` }}
            >
              <img
                src={src}
                alt={`Кейс ученика ${i + 1}`}
                loading="lazy"
                className="block h-[360px] w-full object-cover"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Desktop/tablet: native grid */}
      <div className="mx-auto hidden max-w-[1160px] px-5 md:block">
        <div
          className="grid grid-cols-2 gap-5 lg:grid-cols-4"
          data-cb-native-cases-grid
        >
          {images.map((src, i) => (
            <div
              key={src}
              data-cb-native-case-item
              className="overflow-hidden rounded-[18px] bg-white"
              style={{ border: `1px solid ${CB_PALETTE.border}` }}
            >
              <img
                src={src}
                alt={`Кейс ученика ${i + 1}`}
                loading="lazy"
                className="block h-[320px] w-full object-cover"
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
