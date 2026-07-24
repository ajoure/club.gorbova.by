import { rec, CB_PALETTE } from "../manifest";

/**
 * Section 3 — Кейсы моих учеников (rec776467161 header + rec776467162 gallery).
 *
 * Fidelity notes (Slice 2):
 *  - SF Pro Display / Arial typography (not Comfortaa).
 *  - Header row: magenta H2 on the left, magenta gradient pill "СВАЙПАЙ ВЛЕВО"
 *    on the right. On live this pill is visible on both desktop AND mobile
 *    (rec776467161 exposes both strings unconditionally).
 *  - Gallery reproduces the 16 canonical case screenshots. Live Tilda uses a
 *    Zero-Block collage of variable-height tiles; we use CSS multi-column
 *    masonry that preserves each image's natural aspect ratio, matching the
 *    "variable tile" perception without hardcoded per-image coordinates.
 *  - Mobile: horizontal-swipe strip of the same 16 images.
 */
const SF_FONT = "'Sf-pro-display', Arial, sans-serif";

export function CasesSection() {
  const header = rec("rec776467161");
  const gallery = rec("rec776467162");
  const title = header.text[0] ?? "КЕЙСЫ МОИХ УЧЕНИКОВ";
  const swipeHint = header.text[1] ?? "Свайпай влево";

  // Case screenshots at static.tildacdn.com. Exclude thumbnails / resizeb / composite header.
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
      className="py-16 lg:py-20"
      style={{ background: CB_PALETTE.bg, fontFamily: SF_FONT }}
    >
      <div className="mx-auto max-w-[1160px] px-5">
        <div className="mb-8 flex flex-col items-center gap-5 md:mb-10 md:flex-row md:items-center md:justify-between md:gap-8">
          <h2
            className="text-center text-[32px] font-bold uppercase leading-[1.05] md:text-left md:text-[48px]"
            style={{
              color: CB_PALETTE.accent,
              fontFamily: SF_FONT,
              letterSpacing: "-0.01em",
            }}
          >
            {title}
          </h2>
          <span
            data-cb-native-cases-hint
            className="inline-flex items-center justify-center rounded-full px-8 py-4 text-[13px] font-bold uppercase tracking-[0.14em] text-white shadow-[0_10px_30px_-8px_rgba(228,34,194,0.55)] md:px-10 md:py-4"
            style={{
              background: "linear-gradient(90deg, #f9aeff 0%, #e422c2 100%)",
              fontFamily: SF_FONT,
              letterSpacing: "0.14em",
            }}
          >
            {swipeHint}
          </span>
        </div>
      </div>

      {/* Mobile: horizontal swipe strip */}
      <div
        className="md:hidden overflow-x-auto"
        style={{ scrollbarWidth: "none" }}
        data-cb-native-cases-swipe
      >
        <div className="flex gap-4 px-5 pb-4" style={{ width: "max-content" }}>
          {images.map((src, i) => (
            <div
              key={src}
              data-cb-native-case-item
              className="w-[260px] shrink-0 overflow-hidden rounded-[16px] bg-white"
              style={{ border: `1px solid ${CB_PALETTE.border}` }}
            >
              <img
                src={src}
                alt={`Кейс ученика ${i + 1}`}
                loading="lazy"
                className="block h-auto w-full object-contain"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Desktop/tablet: masonry that preserves each image's natural aspect ratio,
          matching live's variable-tile Zero Block collage. */}
      <div className="mx-auto hidden max-w-[1160px] px-5 md:block">
        <div
          data-cb-native-cases-grid
          className="[column-fill:_balance]"
          style={{
            columnCount: 4,
            columnGap: "20px",
          }}
        >
          {images.map((src, i) => (
            <div
              key={src}
              data-cb-native-case-item
              className="mb-5 overflow-hidden rounded-[16px] bg-white"
              style={{
                border: `1px solid ${CB_PALETTE.border}`,
                breakInside: "avoid",
                WebkitColumnBreakInside: "avoid",
              }}
            >
              <img
                src={src}
                alt={`Кейс ученика ${i + 1}`}
                loading="lazy"
                className="block h-auto w-full object-contain"
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
