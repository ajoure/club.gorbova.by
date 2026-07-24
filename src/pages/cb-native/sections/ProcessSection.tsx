import { rec, CB_PALETTE } from "../manifest";

/**
 * Section 7 — "КАК ПРОХОДИТ ОБУЧЕНИЕ" (rec776467169).
 * Steps rendered from token list; each step gets an image icon if available.
 */
export function ProcessSection() {
  const r = rec("rec776467169");
  const [t1 = "", t2 = "", ...steps] = r.text;
  const title = [t1, t2].filter(Boolean).join(" ");

  return (
    <section
      id="rec776467169"
      className="py-16 lg:py-20"
      style={{ background: CB_PALETTE.bgSoft }}
    >
      <div className="mx-auto max-w-6xl px-5">
        <h2
          className="text-2xl sm:text-3xl lg:text-4xl font-semibold text-center mb-10"
          style={{ color: CB_PALETTE.textStrong }}
        >
          {title}
        </h2>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <div
              key={i}
              className="rounded-2xl p-5"
              style={{
                background: CB_PALETTE.bg,
                border: `1px solid ${CB_PALETTE.border}`,
              }}
            >
              {r.images[i] ? (
                <img src={r.images[i]} alt="" aria-hidden className="w-10 h-10 mb-3 object-contain" />
              ) : (
                <div
                  className="w-8 h-8 mb-3 rounded-full flex items-center justify-center text-white text-xs font-bold"
                  style={{ background: CB_PALETTE.accent }}
                >
                  {i + 1}
                </div>
              )}
              <p className="text-sm leading-relaxed" style={{ color: CB_PALETTE.text }}>
                {s}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
