import { rec, CB_PALETTE } from "../manifest";

/**
 * Section 6 — Программа: header (rec776467165/rec1099306976) + module cards.
 * Manifest order preserved. Every module rec renders as a card in a responsive grid.
 * "СМОТРЕТЬ всю программу" CTA (rec779963654) at the end scrolls to tariffs.
 */
const MODULE_RECS = [
  "rec779902274",
  "rec779946753",
  "rec780006224",
  "rec780073973",
  "rec780079482",
  "rec780081115",
  "rec780092281",
  "rec780094387",
  "rec780097393",
  "rec780099682",
  "rec780102268",
  "rec780331623",
  "rec780337757",
  "rec780343795",
  "rec780348530",
  "rec780743292",
  "rec780360510",
  "rec780366621",
  "rec780398470",
  "rec780353436",
  "rec782168706",
  "rec782170827",
  "rec782173747",
  "rec782174918",
  "rec783206282",
  "rec783206583",
];

// Mid-section testimonial callouts kept in manifest order.
const CALLOUT_RECS = ["rec780085012", "rec780107499", "rec780756731"];

export function ProgramSection({ onCta }: { onCta: () => void }) {
  const header = rec("rec776467165");
  const cta = rec("rec779963654").text[0] ?? "СМОТРЕТЬ всю программу";
  const headline = header.text.slice(0, 4).join(" ").trim();
  const modules = MODULE_RECS.map((id) => rec(id));
  const callouts = CALLOUT_RECS.map((id) => rec(id));

  return (
    <section id="rec776467165" className="py-16 lg:py-24" style={{ background: CB_PALETTE.bg }}>
      <div className="mx-auto max-w-6xl px-5">
        <h2
          className="text-2xl sm:text-3xl lg:text-4xl font-semibold text-center mb-10"
          style={{ color: CB_PALETTE.textStrong }}
        >
          {headline}
        </h2>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((m, idx) => {
            const [title = "", ...body] = m.text;
            const icon = m.images[0];
            return (
              <article
                key={m.id}
                id={m.id}
                className="rounded-2xl p-5 flex flex-col gap-3"
                style={{
                  background: CB_PALETTE.bgSoft,
                  border: `1px solid ${CB_PALETTE.border}`,
                }}
              >
                <div className="flex items-center gap-3">
                  {icon ? (
                    <img src={icon} alt="" aria-hidden className="w-10 h-10 object-contain" />
                  ) : (
                    <span
                      className="inline-flex items-center justify-center w-8 h-8 rounded-full text-white text-xs font-bold"
                      style={{ background: CB_PALETTE.accent }}
                    >
                      {idx + 1}
                    </span>
                  )}
                  <h3
                    className="font-semibold text-base sm:text-lg leading-snug"
                    style={{ color: CB_PALETTE.textStrong }}
                  >
                    {title}
                  </h3>
                </div>
                <p className="text-sm leading-relaxed" style={{ color: CB_PALETTE.text }}>
                  {body.join(" ")}
                </p>
              </article>
            );
          })}
        </div>

        {callouts.map((c) => (
          <div
            key={c.id}
            id={c.id}
            className="mt-10 rounded-2xl p-6 lg:p-8 text-center"
            style={{
              background: CB_PALETTE.accent,
              color: "#ffffff",
            }}
          >
            <p className="text-base sm:text-lg leading-relaxed">{c.text.join(" ")}</p>
          </div>
        ))}

        <div className="mt-10 text-center" id="rec779963654">
          <button
            type="button"
            onClick={onCta}
            className="inline-flex items-center rounded-full px-8 py-3 text-white text-sm font-semibold hover:opacity-90 transition"
            style={{ background: CB_PALETTE.accent }}
          >
            {cta}
          </button>
        </div>
      </div>
    </section>
  );
}
