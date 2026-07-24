import { rec, CB_PALETTE } from "../manifest";

/**
 * Section 7 — "КАК ПРОХОДИТ ОБУЧЕНИЕ, И ПОЧЕМУ У ВАС ПОЛУЧИТСЯ" (rec776467169).
 *
 * cbold has 4 steps, one per icon (i0..i3):
 *   1) Общаетесь с Катериной / на живых онлайн-конференциях…             (t2, t3)
 *   2) Смотрите / уроки в записи / на обучающей платформе или Chatium    (t4, t5, t6)
 *   3) Выполняете / интерактивные задания / , которые помогают усвоить   (t7, t8, t9)
 *   4) Получаете / полный перечень НПА / к каждому доводу…               (t10, t11, t12)
 *
 * Native responsive: 4-column desktop grid, single-column mobile stack.
 */
const STEPS: Array<{ lead: number; accent: number; tail: number }> = [
  { lead: 2, accent: 3, tail: -1 },
  { lead: 4, accent: 5, tail: 6 },
  { lead: 7, accent: 8, tail: 9 },
  { lead: 10, accent: 11, tail: 12 },
];

export const PROCESS_STEP_COUNT = STEPS.length;

export function ProcessSection() {
  const r = rec("rec776467169");
  const title = [r.text[0], r.text[1]].filter(Boolean).join(" ");
  const icons = r.images;

  return (
    <section
      id="rec776467169"
      data-cb-native-section="process"
      className="py-16 lg:py-24"
      style={{ background: CB_PALETTE.bgSoft }}
    >
      <div className="mx-auto max-w-[1160px] px-5">
        <h2
          className="mb-10 text-center text-[28px] font-bold uppercase leading-[1.15] md:mb-14 md:text-[38px]"
          style={{ color: CB_PALETTE.textStrong }}
        >
          {title}
        </h2>
        <div
          className="grid gap-5 md:grid-cols-2 lg:grid-cols-4"
          data-cb-native-process-grid
        >
          {STEPS.map((step, i) => {
            const lead = r.text[step.lead] ?? "";
            const accent = r.text[step.accent] ?? "";
            const tail = step.tail >= 0 ? r.text[step.tail] ?? "" : "";
            return (
              <article
                key={i}
                data-cb-native-process-step
                className="flex h-full flex-col gap-4 rounded-[22px] p-6"
                style={{
                  background: CB_PALETTE.bg,
                  border: `1px solid ${CB_PALETTE.border}`,
                }}
              >
                <div className="flex items-center justify-between">
                  {icons[i] ? (
                    <img
                      src={icons[i]}
                      alt=""
                      aria-hidden
                      loading="lazy"
                      className="h-12 w-12 object-contain"
                    />
                  ) : (
                    <span
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[13px] font-bold"
                      style={{ background: CB_PALETTE.accent, color: CB_PALETTE.bg }}
                    >
                      {i + 1}
                    </span>
                  )}
                  <span
                    className="text-[13px] font-bold uppercase tracking-[0.16em]"
                    style={{ color: CB_PALETTE.accent }}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                </div>
                <p className="text-[15px] leading-[1.5]" style={{ color: CB_PALETTE.text }}>
                  <strong className="font-bold" style={{ color: CB_PALETTE.textStrong }}>
                    {lead}
                  </strong>{" "}
                  <span style={{ color: CB_PALETTE.accent }}>{accent}</span>
                  {tail ? ` ${tail}` : ""}
                </p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
