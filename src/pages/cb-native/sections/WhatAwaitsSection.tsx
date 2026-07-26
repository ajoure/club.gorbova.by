import { rec, CB_PALETTE } from "../manifest";

/**
 * Section 5 — "ЧТО ВАС ЖДЕТ?" (rec776467164).
 *
 * Fidelity notes (Slice 2):
 *  - H2 "ЧТО ВАС ЖДЕТ?" — dark gray #343434 (NOT magenta), SF Pro Display bold,
 *    left-aligned on the container.
 *  - Layout is a SINGLE outlined rectangle (magenta 1px border, 24px radius)
 *    containing a 2×2 grid divided by magenta cross-lines — not four separate
 *    cards with borders. Icons are centered above each title.
 *  - H3 titles: dark gray #343434, SF Pro Display bold, 20px.
 *  - Body copy: dark gray, 14–15px, SF Pro Display regular, centered.
 *  - Text[5] and text[6] render as TWO separate lines inside the "БОЛЬШАЯ БАЗА
 *    ЗНАНИЙ" card (matching Tilda's two-<div> paragraph split) — audit S5.
 *  - Font family is SF Pro Display / Arial (not Comfortaa).
 */
const SF_FONT = "'Sf-pro-display', Arial, sans-serif";
const CARD_TEXT = "#343434";

interface Card {
  title: string;
  body: string[];
  icon: string;
}

export function WhatAwaitsSection() {
  const r = rec("rec776467164");
  const heading = r.text[0] ?? "ЧТО ВАС ЖДЕТ?";

  const staticIcons = r.images.filter((u) => u.startsWith("https://static.tildacdn.com/"));
  const iconByFragment = (frag: string) =>
    staticIcons.find((u) => u.toLowerCase().includes(frag.toLowerCase())) ?? "";

  const cards: Card[] = [
    {
      title: r.text[2] ?? "7 НЕДЕЛЬ",
      body: [r.text[1] ?? ""],
      icon: iconByFragment("group-24"),
    },
    {
      title: r.text[3] ?? "20 МОДУЛЕЙ",
      body: [r.text[4] ?? ""],
      icon: iconByFragment("lightning"),
    },
    {
      title: r.text[7] ?? "БОЛЬШАЯ БАЗА ЗНАНИЙ",
      body: [r.text[5] ?? "", r.text[6] ?? ""].filter(Boolean),
      icon: iconByFragment("3.svg"),
    },
    {
      title: r.text[9] ?? "ОБРАТНАЯ СВЯЗЬ",
      body: [r.text[8] ?? ""],
      icon: iconByFragment("group-824"),
    },
  ];

  return (
    <section
      id="rec776467164"
      data-cb-native-section="what-awaits"
      className="py-16 lg:py-24"
      style={{ background: CB_PALETTE.bg, fontFamily: SF_FONT }}
    >
      <div className="mx-auto max-w-[1160px] px-5">
        <h2
          className="mb-8 text-left text-[32px] font-bold uppercase leading-[1.05] md:mb-12 md:text-[42px]"
          style={{
            color: CARD_TEXT,
            fontFamily: SF_FONT,
            letterSpacing: "-0.01em",
          }}
        >
          {heading}
        </h2>

        {/* Single outlined container with 2×2 grid + magenta cross-dividers */}
        <div
          data-cb-native-whatawaits-grid
          className="relative grid grid-cols-1 md:grid-cols-2"
          style={{
            border: `1px solid ${CB_PALETTE.accent}`,
            borderRadius: 24,
            overflow: "hidden",
          }}
        >
          {cards.map((c, i) => {
            const isRightCol = i % 2 === 1;
            const isBottomRow = i >= 2;
            return (
              <article
                key={i}
                data-cb-native-whatawaits-card
                className="flex flex-col items-center gap-4 px-6 py-10 text-center md:px-10 md:py-14"
                style={{
                  borderLeft:
                    isRightCol ? `1px solid ${CB_PALETTE.accent}` : undefined,
                  borderTop:
                    isBottomRow ? `1px solid ${CB_PALETTE.accent}` : undefined,
                  background: CB_PALETTE.bg,
                }}
              >
                {c.icon && (
                  <img
                    src={c.icon}
                    alt=""
                    aria-hidden
                    loading="lazy"
                    className="h-11 w-11 object-contain md:h-12 md:w-12"
                  />
                )}
                <h3
                  className="text-[20px] font-bold uppercase leading-tight md:text-[22px]"
                  style={{
                    color: CARD_TEXT,
                    fontFamily: SF_FONT,
                    letterSpacing: "0",
                  }}
                >
                  {c.title}
                </h3>
                <div
                  className="max-w-[380px] text-[14px] leading-[1.55] md:text-[15px]"
                  style={{ color: CARD_TEXT, fontFamily: SF_FONT }}
                >
                  {c.body.map((line, li) => (
                    <div key={li}>{line}</div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
