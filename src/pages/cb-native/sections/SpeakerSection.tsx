import { rec, CB_PALETTE } from "../manifest";

/**
 * Section 4 — Автор / Speaker (rec776467163).
 * Photo + name + achievements list.
 */
export function SpeakerSection() {
  const r = rec("rec776467163");
  const name = r.text.find((t) => /КАТЕРИНА/i.test(t)) ?? "КАТЕРИНА ГОРБОВА";
  const rest = r.text.filter((t) => t !== name);
  // Portrait: pick largest-looking asset; icons pool = the rest.
  const portrait =
    r.images.find((u) => /Grand|portrait|kater/i.test(u)) ??
    r.images.find((u) => /resize\/(6\d{2}|7\d{2}|8\d{2})/i.test(u)) ??
    r.images[0];
  const icons = r.images.filter((u) => u !== portrait);

  return (
    <section
      id="rec776467163"
      className="py-16 lg:py-24"
      style={{ background: CB_PALETTE.bgSoft }}
    >
      <div className="mx-auto max-w-6xl px-5 grid gap-10 lg:grid-cols-[1fr_1.3fr] items-start">
        {portrait && (
          <div className="justify-self-center">
            <img
              src={portrait}
              alt={name}
              loading="lazy"
              className="w-full max-w-[380px] h-auto rounded-2xl"
            />
          </div>
        )}
        <div>
          <h2
            className="text-2xl sm:text-3xl lg:text-4xl font-semibold mb-6"
            style={{ color: CB_PALETTE.textStrong }}
          >
            {name}
          </h2>
          <ul className="space-y-3">
            {rest.map((t, i) => (
              <li key={i} className="flex gap-3 text-sm sm:text-base leading-relaxed"
                  style={{ color: CB_PALETTE.text }}>
                {icons[i] ? (
                  <img src={icons[i]} alt="" aria-hidden className="w-6 h-6 mt-1 object-contain shrink-0" />
                ) : (
                  <span
                    className="mt-2 w-2 h-2 rounded-full shrink-0"
                    style={{ background: CB_PALETTE.accent }}
                  />
                )}
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
