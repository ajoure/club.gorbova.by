import { rec, CB_PALETTE } from "../manifest";

/**
 * Section 2 — "ДЛЯ КОГО ЭТОТ КУРС:" (rec776467160).
 *
 * Fidelity notes (Slice 1, 2026-07-24):
 *  - Live uses `Sf-pro-display, Arial, sans-serif`, NOT Comfortaa.
 *  - Live composition: transparent 3-column grid, no card chrome —
 *    icon (colored, no filter) on top, dark uppercase title, dark body
 *    with a bold-lead phrase. Previous charcoal-card / white-text /
 *    magenta-lead design contradicted the canonical.
 *  - H2 is magenta `#e422c2` at 40px weight 600.
 *  - Text order (13 normalized lines) is unchanged and already at parity.
 */
const SF_FONT = "'Sf-pro-display', Arial, sans-serif";
const AUDIENCE_COUNT = 6;

export function AudienceSection() {
  const r = rec("rec776467160");
  const heading = r.text[0] ?? "ДЛЯ КОГО ЭТОТ КУРС:";
  const items = Array.from({ length: AUDIENCE_COUNT }, (_, n) => ({
    title: r.text[1 + n * 3] ?? "",
    lead: r.text[2 + n * 3] ?? "",
    tail: r.text[3 + n * 3] ?? "",
    icon: r.images[n],
  })).filter((it) => it.title);

  return (
    <section
      id="rec776467160"
      data-cb-native-section="audience"
      style={{
        background: CB_PALETTE.bg,
        fontFamily: SF_FONT,
        color: CB_PALETTE.text,
      }}
      className="py-16 md:py-24 lg:py-28"
    >
      <div className="mx-auto max-w-[1160px] px-5">
        <h2
          className="mb-12 text-left text-[32px] font-semibold uppercase leading-[1.1] md:mb-16 md:text-[40px]"
          style={{ color: CB_PALETTE.accent, fontFamily: SF_FONT, fontWeight: 600 }}
        >
          {heading}
        </h2>

        <div
          className="grid gap-x-10 gap-y-14 md:grid-cols-2 lg:grid-cols-3 md:gap-y-16"
          data-cb-native-audience-grid
        >
          {items.map((it, i) => (
            <article
              key={i}
              data-cb-native-audience-item
              className="flex flex-col gap-4"
              style={{ fontFamily: SF_FONT }}
            >
              {it.icon && (
                <img
                  src={it.icon}
                  alt=""
                  aria-hidden
                  loading="lazy"
                  className="h-10 w-10 object-contain"
                />
              )}
              <h3
                className="text-[20px] font-semibold uppercase leading-tight"
                style={{
                  color: CB_PALETTE.textStrong,
                  fontFamily: SF_FONT,
                  fontWeight: 600,
                  letterSpacing: "0.01em",
                }}
              >
                {it.title}
              </h3>
              <p
                className="m-0 text-[17px] leading-[1.5]"
                style={{ color: CB_PALETTE.text, fontFamily: SF_FONT }}
              >
                <strong style={{ fontWeight: 700, color: CB_PALETTE.textStrong }}>
                  {it.lead}
                </strong>
                {it.tail ? ` ${it.tail}` : ""}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
