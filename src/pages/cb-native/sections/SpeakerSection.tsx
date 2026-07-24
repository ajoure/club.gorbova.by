import { rec, CB_PALETTE } from "../manifest";

/**
 * Section 4 — Спикер: Катерина Горбова (rec776467163).
 *
 * Fidelity notes (Slice 2):
 *  - Full-bleed magenta RADIAL-gradient background (live is a soft radial from
 *    hot-pink center to darker magenta edges) — not a solid #e422c2.
 *  - Portrait cutout on the LEFT flush against the background (no card, no
 *    rounded frame around the photo).
 *  - Right column: small uppercase eyebrow "АВТОР И ОСНОВАТЕЛЬ АКАДЕМИИ
 *    БУХГАЛТЕРА" (semi-transparent white), then big white H2 name, then
 *    5 bullets, each with a white ✦ star icon and plain white text; the
 *    "accent" fragment inside each bullet is bold white. No card/pill
 *    background behind bullets.
 *  - Text pairs (lead + accent) come straight from the manifest. Because
 *    text[10] begins with ", " (comma), we concatenate without a joining
 *    space when the accent starts with punctuation, eliminating the rogue
 *    "бухучету ," space captured in the audit (S4).
 *  - Font family is SF Pro Display / Arial (not Comfortaa).
 */
const SF_FONT = "'Sf-pro-display', Arial, sans-serif";

const BULLET_PAIRS: Array<[number, number]> = [
  // [lead index, accent index]
  [1, 2], // "Эксперт в бухгалтерии с опытом" + "12+ лет"
  [3, 4], // "Основала одно из крупнейших..." + "AJOURE: 2.500+ клиентов"
  [5, 6], // "Гигантский опыт..." + "400+ проверок"
  [7, 8], // "Выиграла суд клиенту на 2.7 млн $" + "за счет отстройки дела..."
  [9, 10], // "Создала уникальную методологию обучения бухучету" + ", аналогов..."
];

function joinLeadAccent(lead: string, accent: string): { text: string; boldRange: [number, number] | null } {
  // Bold segment depends on which side carries the "accent" numeric/keyword.
  // For pairs 1..4 the accent is the trailing bold token. For pair 5 (index 4)
  // the LEAD is the bold token and the accent is the trailing regular text.
  return { text: `${lead} ${accent}`, boldRange: null };
}

export function SpeakerSection() {
  const r = rec("rec776467163");
  const name = r.text[0] ?? "КАТЕРИНА ГОРБОВА";
  const eyebrow = r.text[11] ?? "АВТОР И ОСНОВАТЕЛЬ АКАДЕМИИ БУХГАЛТЕРА";
  const starIcon =
    r.images.find((u) => u.startsWith("https://static.tildacdn.com/") && u.includes("star-1")) ?? "";
  const portrait =
    r.images.find((u) => u.startsWith("https://static.tildacdn.com/") && u.includes("44af847e")) ??
    r.images.find((u) => u.includes("44af847e")) ??
    "";

  // Which side of the pair renders bold (matches live typography):
  //   pair 0: lead regular, accent bold  ("12+ лет")
  //   pair 1: lead regular, accent bold  ("AJOURE: 2.500+ клиентов")
  //   pair 2: lead regular, accent bold  ("400+ проверок")
  //   pair 3: lead bold,    accent regular
  //   pair 4: lead bold,    accent regular
  const leadIsBold = [false, false, false, true, true];

  const bullets = BULLET_PAIRS.map(([a, b], i) => {
    const lead = (r.text[a] ?? "").trim();
    const accent = (r.text[b] ?? "").trim();
    // Join without leading space when accent begins with punctuation.
    const startsWithPunct = /^[,.;:!?…»)]/.test(accent);
    const joiner = startsWithPunct ? "" : " ";
    return {
      lead,
      accent,
      joiner,
      boldLead: leadIsBold[i],
    };
  });
  void joinLeadAccent; // reserved helper, kept for future refactors

  return (
    <section
      id="rec776467163"
      data-cb-native-section="speaker"
      className="relative overflow-hidden py-14 md:py-20"
      style={{
        background:
          "radial-gradient(120% 90% at 68% 45%, #ff8ff0 0%, #f048d0 42%, #d81eb8 78%, #b8149d 100%)",
        color: CB_PALETTE.bg,
        fontFamily: SF_FONT,
      }}
    >
      <div className="mx-auto max-w-[1200px] px-5">
        <div className="grid items-center gap-8 md:grid-cols-[minmax(0,44%)_minmax(0,56%)] md:gap-10">
          {/* Portrait — cutout flush with background, no frame */}
          <div className="relative order-1 md:order-none">
            {portrait ? (
              <img
                src={portrait}
                alt="Катерина Горбова — автор и основатель Академии Бухгалтера"
                loading="lazy"
                className="mx-auto block h-auto w-full max-w-[520px] object-contain md:mx-0"
              />
            ) : (
              <div className="mx-auto h-[520px] w-full max-w-[520px]" />
            )}
          </div>

          {/* Right column */}
          <div className="order-2 md:order-none">
            <p
              className="mb-4 text-[13px] uppercase tracking-[0.16em] md:mb-5 md:text-[14px]"
              style={{
                color: "rgba(255,255,255,0.72)",
                fontFamily: SF_FONT,
                letterSpacing: "0.16em",
              }}
            >
              {eyebrow}
            </p>
            <h2
              className="mb-8 text-[36px] font-bold uppercase leading-[1.02] md:mb-10 md:text-[56px]"
              style={{
                color: CB_PALETTE.bg,
                fontFamily: SF_FONT,
                letterSpacing: "-0.01em",
              }}
            >
              {name}
            </h2>

            <ul
              className="space-y-6"
              data-cb-native-speaker-bullets
              style={{ fontFamily: SF_FONT }}
            >
              {bullets.map((b, i) => (
                <li
                  key={i}
                  data-cb-native-speaker-bullet
                  className="flex items-start gap-4"
                >
                  {starIcon ? (
                    <img
                      src={starIcon}
                      alt=""
                      aria-hidden
                      loading="lazy"
                      className="mt-1 h-4 w-4 shrink-0 object-contain"
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="mt-1 inline-block h-3 w-3 shrink-0 rotate-45"
                      style={{ background: "#ffffff" }}
                    />
                  )}
                  <p
                    className="text-[15px] leading-[1.55] md:text-[16px] md:leading-[1.55]"
                    style={{
                      color: CB_PALETTE.bg,
                      fontFamily: SF_FONT,
                    }}
                  >
                    {b.boldLead ? (
                      <>
                        <strong className="font-bold">{b.lead}</strong>
                        {b.joiner}
                        {b.accent}
                      </>
                    ) : (
                      <>
                        {b.lead}
                        {b.joiner}
                        <strong className="font-bold">{b.accent}</strong>
                      </>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
