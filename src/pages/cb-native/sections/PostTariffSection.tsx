import { rec, CB_PALETTE } from "../manifest";

/**
 * Section 10 — Post-tariff narrative + urgency + bonuses.
 * Order preserved from manifest:
 *   rec776467185 (рассрочка до 12 мес),
 *   rec1100350436 (как обучаться бесплатно),
 *   rec782699143 (таймер бонусов),
 *   rec776467158 (never-again pricing notice),
 *   rec776467186 (что я изучала 15 лет),
 *   rec1099268301 (клуб «Буква закона»),
 *   rec776467187 (какие двери откроются).
 */
const RECS = [
  "rec776467185",
  "rec1100350436",
  "rec782699143",
  "rec776467158",
  "rec776467186",
  "rec1099268301",
  "rec776467187",
];

export function PostTariffSection() {
  const blocks = RECS.map((id) => rec(id));
  return (
    <section
      className="py-8"
      data-cb-native-section="post-tariff"
      style={{ background: CB_PALETTE.bg }}
    >
      <div className="mx-auto max-w-6xl px-5 space-y-8">
        {blocks.map((b) => {
          const [title = "", ...body] = b.text;
          const accent =
            b.id === "rec782699143" || b.id === "rec776467158";
          return (
            <div
              key={b.id}
              id={b.id}
              data-cb-native-post-tariff-block
              className="rounded-2xl p-6 lg:p-8"
              style={{
                background: accent ? CB_PALETTE.accent : CB_PALETTE.bgSoft,
                color: accent ? "#ffffff" : CB_PALETTE.text,
                border: accent ? "none" : `1px solid ${CB_PALETTE.border}`,
              }}
            >
              {title && (
                <h3
                  className="text-lg sm:text-xl lg:text-2xl font-semibold mb-4"
                  style={{ color: accent ? "#ffffff" : CB_PALETTE.textStrong }}
                >
                  {title}
                </h3>
              )}
              <div className="grid gap-4 md:grid-cols-[auto_1fr] items-start">
                {b.images[0] && (
                  <img
                    src={b.images[0]}
                    alt=""
                    aria-hidden
                    className="w-16 h-16 object-contain"
                  />
                )}
                <div className="space-y-2 text-sm sm:text-base leading-relaxed">
                  {body.map((t, i) => (
                    <p key={i}>{t}</p>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
