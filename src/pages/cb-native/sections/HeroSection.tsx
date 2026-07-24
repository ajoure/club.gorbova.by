import { Button } from "@/components/ui/button";
import { rec, CB_PALETTE } from "../manifest";

/**
 * Section 1 — Hero.
 * Sources: rec776467156 (eyebrow "KATERINA GORBOVA") + rec776467157
 * (headline + subhead + feature icons row).
 */
export function HeroSection({ onCta }: { onCta: () => void }) {
  const eyebrow = rec("rec776467156").text[0] ?? "KATERINA GORBOVA";
  const r2 = rec("rec776467157");
  const question = r2.text[0] ?? "";
  const ctaLabel = r2.text[1] ?? "Узнать подробнее";
  const benefitLead = r2.text[2] ?? "";
  const benefitTail = r2.text[3] ?? "";
  const installmentLabel = r2.text[4] ?? "Рассрочка";
  const headline = r2.text[7] ?? "ЦЕННЫЙ БУХГАЛТЕР";
  const heroImg = r2.images.find((u) => u.includes("img5-removebg-previe")) ?? r2.images[6];
  const crownImg = r2.images[0];
  const infoItems = [
    { icon: r2.images[1], label: r2.text[9] ?? "Старт потока:", value: r2.text[10] ?? "21 июня 2025г." },
    { icon: r2.images[2], label: r2.text[11] ?? "Формат:", value: r2.text[12] ?? "онлайн" },
    { icon: r2.images[3], label: r2.text[13] ?? "Продолжительность:", value: r2.text[14] ?? "7 недель" },
    { icon: r2.images[4], label: r2.text[15] ?? "Практические", value: r2.text[16] ?? "конференции" },
    { icon: r2.images[5], label: r2.text[17] ?? "Библиотека НПА", value: r2.text[18] ?? "в правильной последовательности" },
  ];

  return (
    <section
      id="rec776467157"
      className="relative overflow-hidden"
      style={{ background: CB_PALETTE.bgSoft, borderBottom: `1px solid ${CB_PALETTE.border}` }}
    >
      <div className="mx-auto flex max-w-[1160px] flex-col px-5 pb-12 pt-6 md:pb-24 md:pt-6">
        <div className="mb-5 text-center text-[13px] font-normal uppercase tracking-[0.16em] md:text-left" style={{ color: "#858585" }}>
          {eyebrow}
        </div>

        <div className="hidden rounded-[14px] border px-5 py-4 md:grid md:grid-cols-5 md:items-center md:gap-0" style={{ borderColor: CB_PALETTE.accent }}>
          {infoItems.map((item, index) => (
            <div key={item.label} className="flex min-h-12 items-center gap-3 border-r px-4 last:border-r-0" style={{ borderRightColor: CB_PALETTE.accentSoft }}>
              {item.icon && <img src={item.icon} alt="" aria-hidden className="h-6 w-6 shrink-0 object-contain" />}
              <p className="text-[12px] leading-tight" style={{ color: index === 4 ? CB_PALETTE.text : "#858585" }}>
                <span>{item.label}</span>{" "}
                <strong className="font-bold" style={{ color: CB_PALETTE.textStrong }}>{item.value}</strong>
              </p>
            </div>
          ))}
        </div>

        <div className="relative grid items-start gap-2 md:grid-cols-[minmax(0,590px)_1fr] md:gap-10 md:pt-10">
          <div className="relative z-10 flex flex-col items-center text-center md:items-start md:text-left">
            <div className="sr-only">
              {eyebrow}
            </div>
            <div className="relative mt-2 inline-block md:mt-3">
              {crownImg && <img src={crownImg} alt="" aria-hidden className="absolute -left-2 -top-4 h-6 w-8 object-contain md:-top-6 md:h-7 md:w-10" />}
              <h1 className="max-w-[355px] text-[48px] font-bold uppercase leading-[1.08] md:max-w-none md:text-[57px] md:leading-[0.98]" style={{ color: CB_PALETTE.accent }}>
                {headline}
              </h1>
            </div>

            <p className="mt-7 max-w-[560px] text-[16px] leading-[1.55] md:mt-7 md:max-w-[520px] md:text-[15px] md:leading-[1.45]" style={{ color: CB_PALETTE.text }}>
              {question}
            </p>

            <div className="mt-7 grid w-full gap-5 rounded-[22px] border px-9 py-7 text-left md:hidden" style={{ borderColor: CB_PALETTE.accent }}>
              {infoItems.map((item, index) => (
                <div key={item.label} className="flex items-center gap-5">
                  {item.icon && <img src={item.icon} alt="" aria-hidden className="h-6 w-6 shrink-0 object-contain" />}
                  <p className="text-[16px] leading-snug" style={{ color: index === 4 ? CB_PALETTE.text : "#858585" }}>
                    <span>{item.label}</span>{" "}
                    <strong className="font-bold" style={{ color: CB_PALETTE.textStrong }}>{item.value}</strong>
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-8 hidden max-w-[500px] rounded-[10px] px-9 py-6 md:block" style={{ background: "#343434", color: CB_PALETTE.bg }}>
              <p className="text-[14px] font-normal leading-snug">
                <strong className="font-bold" style={{ color: CB_PALETTE.accentSoft }}>{benefitLead}</strong>{" "}
                {benefitTail}
              </p>
            </div>

            <div className="mt-9 flex w-full flex-col-reverse items-center gap-5 md:flex-row md:gap-16">
              <Button
                type="button"
                onClick={onCta}
                className="h-[62px] w-full rounded-[28px] px-10 text-[16px] font-bold uppercase shadow-[0_8px_22px_rgba(228,34,194,0.35)] md:w-[305px]"
                style={{ background: CB_PALETTE.accent, color: CB_PALETTE.bg }}
              >
                {ctaLabel}
              </Button>
              <div className="flex items-center gap-4 text-center md:text-left" style={{ color: "#8a8a8a" }}>
                <span className="hidden h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold md:inline-flex" style={{ background: CB_PALETTE.accent, color: CB_PALETTE.bg }}>?</span>
                <span className="text-[20px] font-normal md:text-[13px]">{installmentLabel}</span>
              </div>
            </div>
          </div>

          <div className="pointer-events-none relative hidden min-h-[470px] md:block">
            {heroImg && (
              <img
                src={heroImg}
                alt="Катерина Горбова в белом жакете"
                loading="eager"
                className="absolute right-0 top-2 h-auto w-[430px] max-w-none object-contain"
              />
            )}
            <span className="absolute left-10 top-10 rounded-[8px] px-5 py-2 text-[14px] font-bold uppercase shadow-[0_0_18px_rgba(228,34,194,0.45)]" style={{ background: "#343434", color: CB_PALETTE.bg }}>
              {r2.text[8] ?? "New"}
            </span>
          </div>

          <div className="mt-6 md:hidden">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[18px] font-bold shadow-[0_0_18px_rgba(228,34,194,0.35)]" style={{ background: CB_PALETTE.accent, color: CB_PALETTE.bg }}>?</span>
          </div>
        </div>
      </div>
    </section>
  );
}
