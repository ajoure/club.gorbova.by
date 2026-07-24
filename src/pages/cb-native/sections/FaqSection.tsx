import { rec, CB_PALETTE } from "../manifest";

/**
 * Section 11a — Q&A (rec776467188 header + rec776467189 items).
 * Native <details>/<summary> — no third-party accordion runtime.
 */
export function FaqSection() {
  const header = rec("rec776467188").text[0] ?? "АКТУАЛЬНЫЕ ВОПРОСЫ";
  const src = rec("rec776467189").text;
  // Manifest tokens alternate: question (short) then answer paragraphs until next '?'
  const items: { q: string; a: string }[] = [];
  let curQ: string | null = null;
  let curA: string[] = [];
  const flush = () => {
    if (curQ) items.push({ q: curQ, a: curA.join(" ") });
    curQ = null;
    curA = [];
  };
  for (const t of src) {
    if (t.endsWith("?") && t.length < 160) {
      flush();
      curQ = t;
    } else if (curQ) {
      curA.push(t);
    }
  }
  flush();

  return (
    <section id="rec776467188" className="py-16 lg:py-24" style={{ background: CB_PALETTE.bg }}>
      <div className="mx-auto max-w-4xl px-5">
        <h2
          className="text-2xl sm:text-3xl lg:text-4xl font-semibold text-center mb-10"
          style={{ color: CB_PALETTE.textStrong }}
        >
          {header}
        </h2>
        <div className="space-y-3">
          {items.map((it, i) => (
            <details
              key={i}
              className="group rounded-2xl overflow-hidden"
              style={{
                background: CB_PALETTE.bgSoft,
                border: `1px solid ${CB_PALETTE.border}`,
              }}
            >
              <summary
                className="cursor-pointer list-none p-5 flex justify-between items-start gap-4"
                style={{ color: CB_PALETTE.textStrong }}
              >
                <span className="font-medium text-sm sm:text-base">{it.q}</span>
                <span
                  className="text-xl leading-none transition-transform group-open:rotate-45"
                  style={{ color: CB_PALETTE.accent }}
                >
                  +
                </span>
              </summary>
              <div
                className="px-5 pb-5 text-sm leading-relaxed"
                style={{ color: CB_PALETTE.text }}
              >
                {it.a}
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
