import { rec, CB_PALETTE } from "../manifest";

/**
 * Section 3 — Кейсы моих учеников (rec776467161 header + rec776467162 gallery).
 *
 * Fidelity notes (Slice 2):
 *  - SF Pro Display / Arial typography (not Comfortaa).
 *  - Header row: magenta H2 on the left, magenta gradient pill "СВАЙПАЙ ВЛЕВО"
 *    on the right. On live this pill is visible on both desktop AND mobile
 *    (rec776467161 exposes both strings unconditionally).
 *  - Gallery reproduces the canonical case screenshots in one horizontal
 *    swipe rail, matching the original "СВАЙПАЙ ВЛЕВО" interaction.
 *  - Cards remain large enough to read: roughly four per desktop viewport and
 *    one full card plus a visible next-card cue on mobile.
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
      <div className="mx-auto max-w-[1400px] px-5">
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

      <div
        className="mx-auto max-w-[1440px] snap-x snap-mandatory overflow-x-auto overscroll-x-contain px-5 pb-5"
        style={{
          scrollbarWidth: "none",
          WebkitOverflowScrolling: "touch",
          touchAction: "pan-x pan-y",
        }}
        role="region"
        aria-label="Кейсы учеников. Прокрутите горизонтально"
        tabIndex={0}
        data-cb-native-cases-carousel
        data-cb-native-cases-swipe
      >
        <div className="flex gap-4 md:gap-5" style={{ width: "max-content" }}>
          {images.map((src, i) => (
            <div
              key={src}
              data-cb-native-case-item
              className="w-[82vw] max-w-[330px] shrink-0 snap-start overflow-hidden rounded-[16px] bg-white md:w-[300px] md:max-w-none lg:w-[340px]"
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
    </section>
  );
}
