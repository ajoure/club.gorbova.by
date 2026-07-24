import { rec, CB_PALETTE } from "../manifest";

/**
 * Section 5 — "ЧТО ВАС ЖДЕТ?" (rec776467164).
 * Four native cards, cbold order:
 *   1) 7 НЕДЕЛЬ            — t2 / t1
 *   2) 20 МОДУЛЕЙ          — t3 / t4
 *   3) БОЛЬШАЯ БАЗА ЗНАНИЙ — t7 / t5 + t6
 *   4) ОБРАТНАЯ СВЯЗЬ      — t9 / t8
 * Icons: full-size assets from static.tildacdn.com (4 total, in cbold order).
 */
export function WhatAwaitsSection() {
  const r = rec("rec776467164");
  const heading = r.text[0] ?? "ЧТО ВАС ЖДЕТ?";

  const staticIcons = r.images.filter((u) => u.startsWith("https://static.tildacdn.com/"));
  const iconByFragment = (frag: string) =>
    staticIcons.find((u) => u.toLowerCase().includes(frag)) ?? "";

  const cards = [
    {
      title: r.text[2] ?? "7 НЕДЕЛЬ",
      body: r.text[1] ?? "",
      icon: iconByFragment("group-24"),
    },
    {
      title: r.text[3] ?? "20 МОДУЛЕЙ",
      body: r.text[4] ?? "",
      icon: iconByFragment("lightning"),
    },
    {
      title: r.text[7] ?? "БОЛЬШАЯ БАЗА ЗНАНИЙ",
      body: [r.text[5], r.text[6]].filter(Boolean).join(" "),
      icon: iconByFragment("3.svg"),
    },
    {
      title: r.text[9] ?? "ОБРАТНАЯ СВЯЗЬ",
      body: r.text[8] ?? "",
      icon: iconByFragment("group-824"),
    },
  ];

  return (
    <section
      id="rec776467164"
      data-cb-native-section="what-awaits"
      className="py-16 lg:py-24"
      style={{ background: CB_PALETTE.bg }}
    >
      <div className="mx-auto max-w-[1160px] px-5">
        <h2
          className="mb-10 text-center text-[32px] font-bold uppercase leading-[1.1] md:mb-14 md:text-[42px]"
          style={{ color: CB_PALETTE.accent }}
        >
          {heading}
        </h2>
        <div
          className="grid gap-5 md:grid-cols-2 lg:grid-cols-4"
          data-cb-native-whatawaits-grid
        >
          {cards.map((c, i) => (
            <article
              key={i}
              data-cb-native-whatawaits-card
              className="flex flex-col gap-4 rounded-[22px] p-7"
              style={{
                background: CB_PALETTE.bgSoft,
                border: `1px solid ${CB_PALETTE.border}`,
              }}
            >
              {c.icon && (
                <img
                  src={c.icon}
                  alt=""
                  aria-hidden
                  loading="lazy"
                  className="h-14 w-14 object-contain"
                />
              )}
              <h3
                className="text-[22px] font-bold uppercase leading-tight"
                style={{ color: CB_PALETTE.accent }}
              >
                {c.title}
              </h3>
              <p className="text-[14px] leading-[1.55]" style={{ color: CB_PALETTE.text }}>
                {c.body}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
