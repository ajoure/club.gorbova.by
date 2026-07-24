import { rec, CB_PALETTE } from "../manifest";

/**
 * Section 6 — "ВАША ПОЛЬЗА В КАЖДОМ МОДУЛЕ ОБУЧЕНИЯ".
 *
 * Header rec776467165. Content is a strict cbold-order sequence of module recs
 * interleaved with three callouts, then the anchor CTA rec779963654
 * ("СМОТРЕТЬ всю программу") which scrolls to #tariffs.
 *
 * Layout is native responsive (grid + full-width callouts), no absolute Zero Blocks.
 * Magenta module badge / white card / dark charcoal callout — cbold hierarchy.
 */
type Item =
  | { kind: "module"; id: string }
  | { kind: "callout"; id: string; variant: "dark" | "magenta" | "grid" };

const ORDERED: Item[] = [
  { kind: "module", id: "rec779902274" },
  { kind: "module", id: "rec779946753" },
  { kind: "module", id: "rec780006224" },
  { kind: "module", id: "rec780073973" },
  { kind: "module", id: "rec780079482" },
  { kind: "module", id: "rec780081115" },
  { kind: "callout", id: "rec780085012", variant: "dark" },
  { kind: "module", id: "rec780092281" },
  { kind: "module", id: "rec780094387" },
  { kind: "module", id: "rec780097393" },
  { kind: "module", id: "rec780099682" },
  { kind: "module", id: "rec780102268" },
  { kind: "callout", id: "rec780107499", variant: "grid" },
  { kind: "module", id: "rec780331623" },
  { kind: "module", id: "rec780337757" },
  { kind: "module", id: "rec780343795" },
  { kind: "module", id: "rec780348530" },
  { kind: "module", id: "rec780743292" },
  { kind: "module", id: "rec780360510" },
  { kind: "module", id: "rec780366621" },
  { kind: "module", id: "rec780398470" },
  { kind: "module", id: "rec780353436" },
  { kind: "module", id: "rec782168706" },
  { kind: "module", id: "rec782170827" },
  { kind: "module", id: "rec782173747" },
  { kind: "callout", id: "rec780756731", variant: "magenta" },
  { kind: "module", id: "rec782174918" },
  { kind: "module", id: "rec783206282" },
  { kind: "module", id: "rec783206583" },
];

export const PROGRAM_MODULE_COUNT = ORDERED.filter((i) => i.kind === "module").length;
export const PROGRAM_CALLOUT_COUNT = ORDERED.filter((i) => i.kind === "callout").length;

function ModuleCard({ id }: { id: string }) {
  const r = rec(id);
  // Module recs have a "МОДУЛЬ #NN" token somewhere in the list; the first
  // non-badge, non-meta token is the title.
  const badge = r.text.find((t) => /МОДУЛЬ\s*#?\d+/i.test(t)) ?? "";
  const title = r.text[0] ?? "";
  // cbold module cards use a vector.svg icon from images[0].
  const icon = r.images.find((src) => /\.svg(\?|$)/i.test(src)) ?? r.images[0] ?? "";
  const results: string[] = [];
  const bonuses: string[] = [];
  let bucket: "none" | "results" | "bonuses" = "none";
  r.text.slice(1).forEach((t) => {
    if (/^Результаты модуля:?$/i.test(t)) {
      bucket = "results";
      return;
    }
    if (/^Усилители:?$/i.test(t)) {
      bucket = "bonuses";
      return;
    }
    if (t === badge) return;
    if (bucket === "results") results.push(t);
    else if (bucket === "bonuses") bonuses.push(t);
  });
  const intro = r.text
    .slice(1)
    .filter(
      (t) =>
        t !== badge &&
        !/^Результаты модуля:?$/i.test(t) &&
        !/^Усилители:?$/i.test(t) &&
        !results.includes(t) &&
        !bonuses.includes(t),
    )
    .slice(0, 2)
    .join(" ");
  const badgeLabel = badge || "Модуль курса";

  return (
    <article
      id={id}
      data-cb-native-program-module
      className="flex h-full flex-col gap-4 rounded-[22px] p-6"
      style={{ background: CB_PALETTE.bg, border: `1px solid ${CB_PALETTE.border}` }}
    >
      <div className="flex items-center gap-3">
        {icon ? (
          <img
            src={icon}
            alt={badgeLabel}
            data-cb-native-program-icon
            className="h-11 w-11 shrink-0 object-contain"
            loading="lazy"
          />
        ) : (
          <span
            data-cb-native-program-icon-fallback
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[11px] font-bold uppercase tracking-[0.1em]"
            style={{ background: CB_PALETTE.accent, color: CB_PALETTE.bg }}
            aria-label={badgeLabel}
          >
            {badge ? badge.replace(/[^\d]/g, "") || "M" : "M"}
          </span>
        )}
        {badge && (
          <span
            className={
              icon
                ? "sr-only"
                : "inline-flex self-start rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em]"
            }
            style={
              icon
                ? undefined
                : { background: CB_PALETTE.accent, color: CB_PALETTE.bg }
            }
          >
            {badge}
          </span>
        )}
      </div>
      <h3
        className="text-[18px] font-bold uppercase leading-tight"
        style={{ color: CB_PALETTE.textStrong }}
      >
        {title}
      </h3>
      {intro && (
        <p className="text-[14px] leading-[1.55]" style={{ color: CB_PALETTE.text }}>
          {intro}
        </p>
      )}
      {results.length > 0 && (
        <div>
          <p
            className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em]"
            style={{ color: CB_PALETTE.accent }}
          >
            Результаты модуля
          </p>
          <ul className="space-y-1.5 text-[13.5px] leading-[1.5]" style={{ color: CB_PALETTE.text }}>
            {results.map((x, i) => (
              <li key={i} className="pl-3 -indent-3">
                → {x}
              </li>
            ))}
          </ul>
        </div>
      )}
      {bonuses.length > 0 && (
        <div
          className="mt-auto rounded-[14px] px-4 py-3"
          style={{ background: CB_PALETTE.bgSoft }}
        >
          <p
            className="mb-1 text-[11px] font-bold uppercase tracking-[0.16em]"
            style={{ color: "#343434" }}
          >
            Усилители
          </p>
          <ul className="space-y-1 text-[13px] leading-[1.5]" style={{ color: CB_PALETTE.text }}>
            {bonuses.map((x, i) => (
              <li key={i}>• {x}</li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

function DarkCallout({ id }: { id: string }) {
  const r = rec(id);
  return (
    <div
      id={id}
      data-cb-native-program-callout
      className="col-span-full my-4 rounded-[22px] px-7 py-8 text-center md:px-12 md:py-10"
      style={{ background: "#343434", color: CB_PALETTE.bg }}
    >
      <p className="mx-auto max-w-3xl text-[16px] leading-[1.5] md:text-[18px]">
        <span
          className="mr-2 inline-block align-middle text-[38px] font-bold md:text-[52px]"
          style={{ color: CB_PALETTE.accent }}
        >
          {r.text[4] ?? ""}
        </span>
        {r.text[1]} <strong>{r.text[2]}</strong>
        {r.text[3]}
      </p>
      <p
        className="mt-4 text-[13px] font-bold uppercase tracking-[0.14em]"
        style={{ color: CB_PALETTE.accentSoft }}
      >
        {r.text[0]}
      </p>
    </div>
  );
}

function MagentaCallout({ id }: { id: string }) {
  const r = rec(id);
  return (
    <div
      id={id}
      data-cb-native-program-callout
      className="col-span-full my-4 rounded-[22px] px-7 py-8 md:px-12 md:py-10"
      style={{ background: CB_PALETTE.accent, color: CB_PALETTE.bg }}
    >
      <h3 className="text-[22px] font-bold uppercase leading-tight md:text-[28px]">
        {r.text[0] ?? ""}
      </h3>
      {r.text[1] && (
        <p className="mt-3 text-[15px] leading-[1.55]" style={{ color: "#fff2e6" }}>
          {r.text.slice(1, 4).join(" ")}
        </p>
      )}
    </div>
  );
}

function GridCallout({ id }: { id: string }) {
  const r = rec(id);
  const bulletStart = 6; // t6..t9 = 4 competency bullets
  const bullets = r.text.slice(bulletStart, bulletStart + 4).filter(Boolean);
  return (
    <div
      id={id}
      data-cb-native-program-callout
      className="col-span-full my-4 rounded-[22px] px-7 py-8 md:px-12 md:py-10"
      style={{ background: CB_PALETTE.bgSoft, border: `1px solid ${CB_PALETTE.border}` }}
    >
      <p
        className="text-[15px] leading-[1.55] md:text-[16px]"
        style={{ color: CB_PALETTE.text }}
      >
        {r.text[0]}
      </p>
      <ul className="mt-4 grid gap-2 md:grid-cols-2">
        {bullets.map((b, i) => (
          <li
            key={i}
            className="rounded-[14px] bg-white px-4 py-3 text-[14px]"
            style={{ color: CB_PALETTE.textStrong, border: `1px solid ${CB_PALETTE.border}` }}
          >
            → {b}
          </li>
        ))}
      </ul>
      <p
        className="mt-5 text-[14px] font-bold uppercase leading-snug"
        style={{ color: CB_PALETTE.accent }}
      >
        {r.text[4]}
        <span className="ml-2" style={{ color: CB_PALETTE.textStrong }}>
          {r.text[5]}
        </span>
      </p>
    </div>
  );
}

export function ProgramSection({ onCta }: { onCta: () => void }) {
  const header = rec("rec776467165");
  const headline = header.text.slice(0, 4).join(" ").trim() || "ВАША ПОЛЬЗА В КАЖДОМ МОДУЛЕ ОБУЧЕНИЯ";
  const cta = rec("rec779963654").text[0] ?? "СМОТРЕТЬ всю программу";

  return (
    <section
      id="rec776467165"
      data-cb-native-section="program"
      className="py-16 lg:py-24"
      style={{ background: CB_PALETTE.bg }}
    >
      <div className="mx-auto max-w-[1160px] px-5">
        <h2
          className="mb-10 text-center text-[32px] font-bold uppercase leading-[1.1] md:mb-14 md:text-[42px]"
          style={{ color: CB_PALETTE.accent }}
        >
          {headline}
        </h2>

        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {ORDERED.map((item) => {
            if (item.kind === "module") return <ModuleCard key={item.id} id={item.id} />;
            if (item.variant === "dark") return <DarkCallout key={item.id} id={item.id} />;
            if (item.variant === "magenta") return <MagentaCallout key={item.id} id={item.id} />;
            return <GridCallout key={item.id} id={item.id} />;
          })}
        </div>

        <div className="mt-12 text-center" id="rec779963654">
          <button
            type="button"
            onClick={onCta}
            data-cb-native-program-cta
            data-cb-native-anchor-target="#tariffs"
            className="inline-flex h-[62px] items-center justify-center rounded-[28px] px-10 text-[15px] font-bold uppercase tracking-wide shadow-[0_8px_22px_rgba(228,34,194,0.35)] transition hover:opacity-90"
            style={{ background: CB_PALETTE.accent, color: CB_PALETTE.bg }}
          >
            {cta}
          </button>
        </div>
      </div>
    </section>
  );
}
