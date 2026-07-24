import { rec, CB_PALETTE } from "../manifest";

/**
 * Section 4 — Спикер: Катерина Горбова (rec776467163).
 * Native two-column: portrait left, magenta info panel right.
 * Bullets sourced by fixed manifest indices (5 pairs, lead + accent tail).
 */
const BULLETS: Array<[number, number]> = [
  [1, 2],
  [3, 4],
  [5, 6],
  [7, 8],
  [9, 10],
];

export function SpeakerSection() {
  const r = rec("rec776467163");
  const name = r.text[0] ?? "КАТЕРИНА ГОРБОВА";
  const subtitle = r.text[11] ?? "АВТОР И ОСНОВАТЕЛЬ АКАДЕМИИ БУХГАЛТЕРА";
  const portrait =
    r.images.find((u) => u.includes("44af847e") && u.startsWith("https://static.tildacdn.com/")) ??
    r.images.find((u) => u.includes("44af847e")) ??
    "";

  const bullets = BULLETS.map(([a, b]) => ({
    lead: r.text[a] ?? "",
    accent: r.text[b] ?? "",
  })).filter((b) => b.lead || b.accent);

  return (
    <section
      id="rec776467163"
      data-cb-native-section="speaker"
      className="py-16 lg:py-24"
      style={{ background: CB_PALETTE.accent, color: CB_PALETTE.bg }}
    >
      <div className="mx-auto max-w-[1160px] px-5">
        <div className="grid items-center gap-10 md:grid-cols-[minmax(0,460px)_1fr] md:gap-14">
          <div className="relative order-1 md:order-none">
            {portrait ? (
              <img
                src={portrait}
                alt="Катерина Горбова — автор и основатель Академии Бухгалтера"
                loading="lazy"
                className="mx-auto block w-full max-w-[420px] rounded-[24px] object-cover"
              />
            ) : (
              <div className="mx-auto h-[520px] w-full max-w-[420px] rounded-[24px] bg-white/20" />
            )}
          </div>

          <div className="order-2 md:order-none">
            <p
              className="mb-3 text-[13px] font-bold uppercase tracking-[0.18em]"
              style={{ color: "#ffe6f7" }}
            >
              {subtitle}
            </p>
            <h2
              className="mb-8 text-[36px] font-bold uppercase leading-[1.05] md:text-[52px]"
              style={{ color: CB_PALETTE.bg }}
            >
              {name}
            </h2>
            <ul
              className="space-y-4"
              data-cb-native-speaker-bullets
            >
              {bullets.map((b, i) => (
                <li
                  key={i}
                  data-cb-native-speaker-bullet
                  className="rounded-[16px] px-5 py-4 text-[15px] leading-[1.5]"
                  style={{ background: "rgba(255,255,255,0.14)", color: CB_PALETTE.bg }}
                >
                  <span>{b.lead}</span>{" "}
                  <strong className="font-bold" style={{ color: "#fff2a8" }}>
                    {b.accent}
                  </strong>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
