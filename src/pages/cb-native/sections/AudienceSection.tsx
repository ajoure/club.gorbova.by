import { rec, CB_PALETTE } from "../manifest";

/**
 * Section 2 — "ДЛЯ КОГО ЭТОТ КУРС" (rec776467160, t503).
 * Manifest text is a flat token list from the parsed DOM. Group into audience cards
 * by heading tokens (uppercased short lines) then their descriptions.
 */
export function AudienceSection() {
  const r = rec("rec776467160");
  const heading = r.text[0] ?? "ДЛЯ КОГО ЭТОТ КУРС:";
  const items: { title: string; body: string[]; icon?: string }[] = [];
  let cur: { title: string; body: string[]; icon?: string } | null = null;
  const iconPool = r.images.slice();
  r.text.slice(1).forEach((t) => {
    const isHead = t.length < 45 && (t === t.toUpperCase() || /^[А-ЯЁ]/.test(t) && !/[.:,!?]$/.test(t));
    if (isHead && (!cur || cur.body.length > 0)) {
      if (cur) items.push(cur);
      cur = { title: t, body: [], icon: iconPool.shift() };
    } else if (cur) {
      cur.body.push(t);
    }
  });
  if (cur) items.push(cur);

  return (
    <section
      id="rec776467160"
      style={{ background: CB_PALETTE.bgSoft }}
      className="py-16 lg:py-20"
    >
      <div className="mx-auto max-w-6xl px-5">
        <h2
          className="text-2xl sm:text-3xl lg:text-4xl font-semibold text-center mb-10"
          style={{ color: CB_PALETTE.textStrong }}
        >
          {heading}
        </h2>
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {items.map((it, i) => (
            <div
              key={i}
              className="rounded-2xl p-6 flex flex-col gap-3"
              style={{ background: CB_PALETTE.bg, border: `1px solid ${CB_PALETTE.border}` }}
            >
              {it.icon && (
                <img src={it.icon} alt="" aria-hidden className="w-12 h-12 object-contain" />
              )}
              <div
                className="text-sm font-semibold tracking-wide"
                style={{ color: CB_PALETTE.accent }}
              >
                {it.title}
              </div>
              <p className="text-sm leading-relaxed" style={{ color: CB_PALETTE.text }}>
                {it.body.join(" ")}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
