import { rec, CB_PALETTE } from "../manifest";

/**
 * Section 5 — "ЧТО ВАС ЖДЕТ?" (rec776467164).
 * Metric tiles pulled from short uppercase tokens; body text under each.
 */
export function WhatAwaitsSection() {
  const r = rec("rec776467164");
  const title = r.text[0] ?? "ЧТО ВАС ЖДЕТ?";
  const rest = r.text.slice(1);
  // Pair metric (short UPPER) with next descriptive line.
  const tiles: { metric: string; body: string; icon?: string }[] = [];
  const iconPool = r.images.slice();
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (t.length < 30 && /\d/.test(t) && t === t.toUpperCase()) {
      const body = rest[i - 1] ?? rest[i + 1] ?? "";
      tiles.push({ metric: t, body, icon: iconPool.shift() });
    }
  }

  return (
    <section id="rec776467164" className="py-16 lg:py-20" style={{ background: CB_PALETTE.bg }}>
      <div className="mx-auto max-w-6xl px-5">
        <h2
          className="text-2xl sm:text-3xl lg:text-4xl font-semibold text-center mb-10"
          style={{ color: CB_PALETTE.textStrong }}
        >
          {title}
        </h2>
        {tiles.length > 0 ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {tiles.map((t, i) => (
              <div
                key={i}
                className="rounded-2xl p-6 text-center"
                style={{
                  background: CB_PALETTE.bgSoft,
                  border: `1px solid ${CB_PALETTE.border}`,
                }}
              >
                {t.icon && (
                  <img src={t.icon} alt="" aria-hidden className="mx-auto mb-3 w-10 h-10 object-contain" />
                )}
                <div
                  className="text-2xl lg:text-3xl font-bold mb-2"
                  style={{ color: CB_PALETTE.accent }}
                >
                  {t.metric}
                </div>
                <p className="text-sm" style={{ color: CB_PALETTE.text }}>
                  {t.body}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-center" style={{ color: CB_PALETTE.text }}>
            {rest.join(" · ")}
          </p>
        )}
      </div>
    </section>
  );
}
