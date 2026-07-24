import { rec, CB_PALETTE } from "../manifest";

/**
 * Section 1 — Hero.
 * Sources: rec776467156 (eyebrow "KATERINA GORBOVA") + rec776467157
 * (headline + subhead + feature icons row).
 */
export function HeroSection({ onCta }: { onCta: () => void }) {
  const eyebrow = rec("rec776467156").text[0] ?? "KATERINA GORBOVA";
  const r2 = rec("rec776467157");
  // r2.text is a mixed list from parsed DOM; the first long fragment is the headline,
  // followed by feature captions. Split heuristically.
  const [headline, ...rest] = r2.text;
  const features = rest.filter((t) => t.length < 60);
  const heroImg = r2.images.find((u) => /___\d+\.png\.webp/i.test(u)) ?? r2.images[0];

  return (
    <section
      id="rec776467157"
      className="relative overflow-hidden"
      style={{ background: CB_PALETTE.bg, borderBottom: `1px solid ${CB_PALETTE.border}` }}
    >
      <div className="mx-auto max-w-6xl px-5 py-16 lg:py-24 grid gap-10 lg:grid-cols-[1.15fr_1fr] items-center">
        <div>
          <div
            className="text-xs tracking-[0.35em] mb-4"
            style={{ color: CB_PALETTE.accent }}
          >
            {eyebrow}
          </div>
          <h1
            className="text-2xl sm:text-3xl lg:text-[42px] leading-tight font-semibold mb-6"
            style={{ color: CB_PALETTE.textStrong, letterSpacing: "-0.01em" }}
          >
            {headline}
          </h1>
          <button
            type="button"
            onClick={onCta}
            className="inline-flex items-center rounded-full px-6 py-3 text-white text-sm font-semibold transition hover:opacity-90"
            style={{ background: CB_PALETTE.accent }}
          >
            Выбрать тариф
          </button>
        </div>
        {heroImg && (
          <div className="justify-self-center lg:justify-self-end">
            <img
              src={heroImg}
              alt="Катерина Горбова"
              loading="eager"
              className="w-full max-w-[420px] h-auto"
            />
          </div>
        )}
      </div>

      {features.length > 0 && (
        <div className="mx-auto max-w-6xl px-5 pb-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {features.slice(0, 8).map((f, i) => {
            const icon = r2.images[i + 1];
            return (
              <div
                key={i}
                className="flex items-start gap-3 p-4 rounded-2xl"
                style={{ background: CB_PALETTE.bgSoft }}
              >
                {icon && (
                  <img
                    src={icon}
                    alt=""
                    aria-hidden
                    className="w-10 h-10 shrink-0 object-contain"
                  />
                )}
                <p className="text-sm leading-snug" style={{ color: CB_PALETTE.text }}>
                  {f}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
