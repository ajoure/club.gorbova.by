import { Button } from "@/components/ui/button";
import { rec, CB_PALETTE } from "../manifest";

/**
 * Section 1 — Hero (rec776467157).
 *
 * Fidelity notes (Slice 1, 2026-07-24):
 *  - Font family is live-Tilda `Sf-pro-display, Arial, sans-serif` — not Comfortaa.
 *  - "KATERINA GORBOVA" eyebrow (cbold rec776467156) is a separate nav-rec on
 *    live and does NOT belong inside rec776467157, so it is not rendered here.
 *  - No standalone "?" character is rendered as content — the tooltip bubble
 *    exists on live only as a small badge next to "Рассрочка" (a live-only
 *    ornament); we intentionally omit it to avoid a stray "?" text token.
 *  - Info strip lives above the headline, with a light gray border and inline
 *    label/value groups. Only the first item ("Старт потока:" / current start
 *    date) is split onto two normalized text lines, matching the reference.
 *  - Headline "ЦЕННЫЙ БУХГАЛТЕР" is canonical (rec text[7]).
 */
const SF_FONT = "'Sf-pro-display', Arial, sans-serif";
const MUTED = "#858585";
const STRIP_BORDER = "#e0e0e0";

export function HeroSection({ onCta }: { onCta: () => void }) {
  const r = rec("rec776467157");
  const question = r.text[0] ?? "";
  const ctaLabel = r.text[1] ?? "Узнать подробнее";
  const benefitLead = r.text[2] ?? "";
  const benefitTail = r.text[3] ?? "";
  const installmentLabel = r.text[4] ?? "Рассрочка";
  const headline = r.text[7] ?? "ЦЕННЫЙ БУХГАЛТЕР";
  const newBadge = r.text[8] ?? "New";
  const installmentNote = [r.text[5], r.text[6]].filter(Boolean).join(" ");

  const heroImg =
    r.images.find((u) => u.includes("img5-removebg-previe")) ?? r.images[6];
  // The manifest begins with a video-format pictogram. The crown is the icon
  // of the first course-detail item, so using index 0 in the headline renders
  // the boxed "play" glyph on mobile instead of the brand crown.
  const crownImg = r.images[1];

  // Canonical order per manifest: [start, format, duration, conferences, npa]
  const infoItems = [
    { icon: r.images[1], label: r.text[9] ?? "Старт потока:", value: "октябрь 2026 года" },
    { icon: r.images[2], label: r.text[11] ?? "Формат:", value: r.text[12] ?? "онлайн" },
    { icon: r.images[3], label: r.text[13] ?? "Продолжительность:", value: r.text[14] ?? "7 недель" },
    { icon: r.images[4], label: r.text[15] ?? "Практические", value: r.text[16] ?? "конференции" },
    { icon: r.images[5], label: r.text[17] ?? "Библиотека НПА", value: r.text[18] ?? "в\u00A0правильной последовательности" },
  ];

  /**
   * Live text extraction on rec776467157 (12 normalized lines):
   *   0: only the first info item is split into two lines (label / value).
   *   1..4: the remaining items render as a single "Label Value" line.
   * We reproduce that DOM structure exactly here.
   */
  const renderInfoItem = (
    item: (typeof infoItems)[number],
    index: number,
    variant: "desktop" | "mobile",
  ) => {
    const iconSize = variant === "desktop" ? "h-6 w-6" : "h-6 w-6";
    const labelClass =
      variant === "desktop"
        ? "text-[12px] leading-tight"
        : "text-[15px] leading-tight";
    const valueClass =
      variant === "desktop"
        ? "text-[13px] font-bold leading-tight"
        : "text-[16px] font-bold leading-tight";

    if (index === 0) {
      // Two-line stack (matches live: label + value are separate block nodes)
      return (
        <div
          key={`${variant}-${item.label}`}
          className={`flex items-center gap-3 ${
            variant === "desktop"
              ? "min-h-12 border-r px-4 last:border-r-0"
              : ""
          }`}
          style={
            variant === "desktop"
              ? { borderRightColor: STRIP_BORDER }
              : undefined
          }
        >
          {item.icon && (
            <img
              src={item.icon}
              alt=""
              aria-hidden
              className={`${iconSize} shrink-0 object-contain`}
            />
          )}
          <div className="flex flex-col">
            <span className={labelClass} style={{ color: MUTED, fontFamily: SF_FONT }}>
              {item.label}
            </span>
            <span
              className={valueClass}
              style={{ color: CB_PALETTE.textStrong, fontFamily: SF_FONT }}
            >
              {item.value}
            </span>
          </div>
        </div>
      );
    }

    // Inline "Label Value" — single normalized text line
    return (
      <div
        key={`${variant}-${item.label}`}
        className={`flex items-center gap-3 ${
          variant === "desktop"
            ? "min-h-12 border-r px-4 last:border-r-0"
            : ""
        }`}
        style={
          variant === "desktop"
            ? { borderRightColor: STRIP_BORDER }
            : undefined
        }
      >
        {item.icon && (
          <img
            src={item.icon}
            alt=""
            aria-hidden
            className={`${iconSize} shrink-0 object-contain`}
          />
        )}
        <p className={`m-0 ${labelClass}`} style={{ color: MUTED, fontFamily: SF_FONT }}>
          <span>{item.label}</span>{" "}
          <strong
            className={valueClass.replace("leading-tight", "").trim()}
            style={{ color: CB_PALETTE.textStrong, fontFamily: SF_FONT }}
          >
            {item.value}
          </strong>
        </p>
      </div>
    );
  };

  return (
    <section
      id="rec776467157"
      data-cb-native-section="hero"
      className="relative overflow-hidden"
      style={{
        background: CB_PALETTE.bgSoft,
        borderBottom: `1px solid ${CB_PALETTE.border}`,
        fontFamily: SF_FONT,
        color: CB_PALETTE.text,
      }}
    >
      <div className="mx-auto flex max-w-[1160px] flex-col px-5 pb-12 pt-8 md:pb-20 md:pt-8">
        {/* Info strip (desktop): 5 columns, thin light-gray border */}
        <div
          className="hidden rounded-[14px] border px-4 py-3 md:grid md:grid-cols-5 md:items-center md:gap-0"
          style={{ borderColor: STRIP_BORDER, background: "#ffffff" }}
        >
          {infoItems.map((item, i) => renderInfoItem(item, i, "desktop"))}
        </div>

        <div className="relative grid items-start gap-6 md:grid-cols-[minmax(0,600px)_1fr] md:gap-10 md:pt-12">
          <div className="relative z-10 flex flex-col items-start text-left">
            <div className="relative mt-2 flex flex-wrap items-start gap-3 md:mt-3">
              <div className="relative">
                {crownImg && (
                  <img
                    src={crownImg}
                    alt=""
                    aria-hidden
                    className="absolute -left-1 -top-4 h-6 w-8 object-contain md:-top-6 md:h-7 md:w-10"
                  />
                )}
                <h1
                  className="max-w-[320px] text-[40px] font-bold uppercase leading-[1.02] md:max-w-none md:text-[64px] md:leading-[0.98]"
                  style={{ color: CB_PALETTE.accent, fontFamily: SF_FONT, letterSpacing: "-0.01em" }}
                >
                  {headline}
                </h1>
              </div>
              {/* Mobile NEW badge (desktop version lives in the portrait column) */}
              <span
                className="mt-1 inline-block shrink-0 rounded-[6px] px-2.5 py-1 text-[11px] font-bold uppercase md:hidden"
                style={{
                  background: "#343434",
                  color: CB_PALETTE.bg,
                  fontFamily: SF_FONT,
                  letterSpacing: "0.05em",
                }}
              >
                {newBadge}
              </span>
            </div>

            <p
              className="mt-6 max-w-[560px] text-[16px] leading-[1.5] md:mt-6 md:max-w-[520px] md:text-[16px] md:leading-[1.45]"
              style={{ color: CB_PALETTE.text, fontFamily: SF_FONT }}
            >
              {question}
            </p>

            {/* Info strip (mobile): stacked bordered rectangle */}
            <div
              className="mt-7 grid w-full gap-5 rounded-[18px] border p-5 md:hidden"
              style={{ borderColor: STRIP_BORDER, background: "#ffffff" }}
            >
              {infoItems.map((item, i) => renderInfoItem(item, i, "mobile"))}
            </div>

            {/* Dark benefit card */}
            <div
              className="mt-7 max-w-[560px] rounded-[10px] px-7 py-5 md:mt-8 md:max-w-[500px] md:px-8 md:py-6"
              style={{ background: "#343434", color: CB_PALETTE.bg, fontFamily: SF_FONT }}
            >
              <p className="m-0 text-[14px] leading-[1.55] md:text-[15px]">
                <strong className="font-bold" style={{ color: CB_PALETTE.accentSoft }}>
                  {benefitLead}
                </strong>{" "}
                {benefitTail}
              </p>
            </div>

            {/* CTA row */}
            <div className="mt-8 flex w-full items-center gap-8 md:mt-10 md:gap-14">
              <Button
                type="button"
                onClick={onCta}
                className="h-[58px] rounded-[28px] px-10 text-[15px] font-bold uppercase shadow-[0_8px_22px_rgba(228,34,194,0.35)]"
                style={{
                  background: CB_PALETTE.accent,
                  color: CB_PALETTE.bg,
                  fontFamily: SF_FONT,
                  letterSpacing: "0.04em",
                }}
              >
                {ctaLabel}
              </Button>
              <span
                className="text-[15px] font-normal"
                style={{ color: MUTED, fontFamily: SF_FONT }}
              >
                {installmentLabel}
              </span>
            </div>
            {installmentNote ? (
              <p
                className="mt-4 max-w-[500px] text-[12px] leading-[1.45]"
                style={{ color: MUTED, fontFamily: SF_FONT }}
              >
                {installmentNote}
              </p>
            ) : null}
          </div>

          {/* Portrait column (desktop) */}
          <div className="pointer-events-none relative hidden min-h-[520px] md:block">
            {heroImg && (
              <img
                src={heroImg}
                alt="Катерина Горбова"
                loading="eager"
                className="absolute right-0 top-0 h-auto w-[430px] max-w-none object-contain"
              />
            )}
            <span
              className="absolute left-6 top-6 rounded-[8px] px-4 py-1.5 text-[13px] font-bold uppercase"
              style={{
                background: "#343434",
                color: CB_PALETTE.bg,
                fontFamily: SF_FONT,
                letterSpacing: "0.05em",
              }}
            >
              {newBadge}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
