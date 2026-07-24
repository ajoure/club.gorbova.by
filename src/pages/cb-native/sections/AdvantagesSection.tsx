import { rec, CB_PALETTE } from "../manifest";

/**
 * Section 8 — "ГЛАВНЫЕ ПРЕИМУЩЕСТВА КУРСА" and follow-up narrative recs.
 * Combines rec782178631 (advantages), rec1093089581 (deep-dive text),
 * rec1091232946 (how to buy modules), rec783408868 (technology steps).
 */
const RECS = [
  "rec782178631",
  "rec1093089581",
  "rec1091232946",
  "rec783408868",
];

export function AdvantagesSection() {
  const groups = RECS.map((id) => rec(id));
  const main = groups[0];
  const title = main.text[0] ?? "ГЛАВНЫЕ ПРЕИМУЩЕСТВА КУРСА";
  const perks = main.text.slice(1);

  return (
    <section
      id="rec782178631"
      data-cb-native-section="advantages"
      className="py-16 lg:py-24"
      style={{ background: CB_PALETTE.bg }}
    >
      <div className="mx-auto max-w-6xl px-5">
        <h2
          className="text-2xl sm:text-3xl lg:text-4xl font-semibold text-center mb-10"
          style={{ color: CB_PALETTE.textStrong }}
        >
          {title}
        </h2>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {perks.map((p, i) => (
            <div
              key={i}
              className="rounded-2xl p-5"
              style={{
                background: CB_PALETTE.bgSoft,
                border: `1px solid ${CB_PALETTE.border}`,
              }}
            >
              {main.images[i] && (
                <img
                  src={main.images[i]}
                  alt=""
                  aria-hidden
                  className="w-10 h-10 mb-3 object-contain"
                />
              )}
              <p className="text-sm leading-relaxed" style={{ color: CB_PALETTE.text }}>
                {p}
              </p>
            </div>
          ))}
        </div>

        {groups.slice(1).map((g) => (
          <div
            key={g.id}
            id={g.id}
            className="mt-10 rounded-2xl p-6 lg:p-8"
            style={{
              background: CB_PALETTE.bgSoft,
              border: `1px solid ${CB_PALETTE.border}`,
            }}
          >
            {g.text[0] && (
              <h3
                className="text-lg sm:text-xl font-semibold mb-4"
                style={{ color: CB_PALETTE.textStrong }}
              >
                {g.text[0]}
              </h3>
            )}
            <div className="space-y-2">
              {g.text.slice(1, 40).map((t, i) => (
                <p
                  key={i}
                  className="text-sm leading-relaxed"
                  style={{ color: CB_PALETTE.text }}
                >
                  {t}
                </p>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
