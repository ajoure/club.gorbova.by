import { rec, CB_PALETTE } from "../manifest";

/**
 * Section 2 — "ДЛЯ КОГО ЭТОТ КУРС" (rec776467160).
 * Exactly 6 audience items, sourced by fixed manifest indices:
 *   text[0]           — heading
 *   text[1 + 3n]      — title
 *   text[2 + 3n], [3 + 3n] — description (lead + tail)
 *   images[n]         — icon
 * Magenta title / black-charcoal card / white heading — cbold visual hierarchy.
 */
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
      style={{ background: CB_PALETTE.bg }}
      className="py-16 lg:py-24"
    >
      <div className="mx-auto max-w-[1160px] px-5">
        <h2
          className="mb-10 text-center text-[32px] font-bold uppercase leading-[1.1] md:mb-14 md:text-[42px]"
          style={{ color: CB_PALETTE.accent }}
        >
          {heading}
        </h2>
        <div
          className="grid gap-5 md:grid-cols-2 lg:grid-cols-3"
          data-cb-native-audience-grid
        >
          {items.map((it, i) => (
            <article
              key={i}
              data-cb-native-audience-item
              className="flex flex-col gap-4 rounded-[22px] p-7"
              style={{ background: "#343434", color: CB_PALETTE.bg }}
            >
              {it.icon && (
                <img
                  src={it.icon}
                  alt=""
                  aria-hidden
                  loading="lazy"
                  className="h-12 w-12 object-contain"
                  style={{ filter: "brightness(0) invert(1)" }}
                />
              )}
              <h3
                className="text-[18px] font-bold uppercase leading-tight tracking-wide"
                style={{ color: CB_PALETTE.bg }}
              >
                {it.title}
              </h3>
              <p className="text-[15px] leading-[1.5]" style={{ color: "#e6e6e6" }}>
                <span style={{ color: CB_PALETTE.accentSoft }}>{it.lead}</span>
                {it.tail ? ` ${it.tail}` : ""}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
