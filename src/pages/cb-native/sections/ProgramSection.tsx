import { rec, CB_PALETTE } from "../manifest";

/**
 * Reference-faithful programme.
 *
 * The canonical /cb20predzapis page presents every module as one wide,
 * asymmetric composition: title/question on the left, results and boosters
 * on the right. It is intentionally not a generic card grid. On phones the
 * same panels stack in reading order without any absolute-positioned Tilda
 * blocks.
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

export const PROGRAM_MODULE_COUNT = ORDERED.filter((item) => item.kind === "module").length;
export const PROGRAM_CALLOUT_COUNT = ORDERED.filter((item) => item.kind === "callout").length;

type ModuleContent = {
  badge: string;
  title: string;
  question: string;
  results: string[];
  boosters: string[];
  pretrainingLead?: string[];
};

const clean = (values: Array<string | undefined>) =>
  values
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim())
    .join(" ")
    .replace(/\s+([,.:;!?])/g, "$1");

function parseModule(id: string): ModuleContent {
  const r = rec(id);

  if (id === "rec779902274") {
    return {
      badge: r.text[14] ?? "ПРЕДОБУЧЕНИЕ",
      title: r.text[0] ?? "КАК ПОДГОТОВИТЬСЯ К ОБУЧЕНИЮ?",
      question: "",
      pretrainingLead: [
        clean([r.text[1], r.text[2]]),
        clean([r.text[10], r.text[11]]),
        clean([r.text[12], r.text[13]]),
      ],
      boosters: [
        clean([r.text[3], r.text[4]]),
        clean([r.text[5], r.text[6]]),
        clean([r.text[7], r.text[8]]),
      ],
      results: r.text.slice(16).filter(Boolean),
    };
  }

  const badgeIndex = r.text.findIndex((value) => /МОДУЛЬ\s*#?\d+/i.test(value));
  const resultsIndex = r.text.findIndex((value) => /^Результаты модуля:?$/i.test(value));
  const boostersIndex = r.text.findIndex((value) => /^Усилители:?$/i.test(value));
  const badge = badgeIndex >= 0 ? r.text[badgeIndex] : "МОДУЛЬ КУРСА";

  const special: Record<string, { title: number; question: number[] }> = {
    rec782168706: { title: 4, question: [5, 6] },
    rec782170827: { title: 4, question: [5, 6] },
    rec782173747: { title: 2, question: [3, 4] },
  };
  const specialMeta = special[id];
  const titleIndex = specialMeta?.title ?? 0;
  const questionIndexes =
    specialMeta?.question ??
    r.text
      .map((_, index) => index)
      .filter(
        (index) =>
          index !== titleIndex &&
          index < (resultsIndex >= 0 ? resultsIndex : r.text.length) &&
          index !== badgeIndex,
      );

  const stopAfterResults = [boostersIndex, badgeIndex]
    .filter((index) => index > resultsIndex)
    .sort((a, b) => a - b)[0] ?? r.text.length;
  let results =
    resultsIndex >= 0 ? r.text.slice(resultsIndex + 1, stopAfterResults).filter(Boolean) : [];

  let boosters =
    boostersIndex >= 0
      ? r.text
          .slice(boostersIndex + 1, badgeIndex > boostersIndex ? badgeIndex : r.text.length)
          .filter(Boolean)
      : [];

  // Module 01 has the two headings adjacent in the source DOM; the four
  // following statements are results, not boosters.
  if (id === "rec779946753") {
    results = r.text.slice(6, 10).filter(Boolean);
    boosters = [];
  }

  return {
    badge,
    title: r.text[titleIndex] ?? "",
    question: clean(questionIndexes.map((index) => r.text[index])),
    results,
    boosters,
  };
}

function DotList({
  items,
  strongFirst = false,
}: {
  items: string[];
  strongFirst?: boolean;
}) {
  return (
    <ul className="space-y-2.5">
      {items.map((item, index) => (
        <li key={`${item}-${index}`} className="flex gap-3 text-[14px] leading-[1.4] md:text-[15px]">
          <span
            aria-hidden
            className="mt-[7px] h-2 w-2 shrink-0 rounded-full shadow-[0_0_8px_rgba(228,34,194,0.8)]"
            style={{ background: CB_PALETTE.accent }}
          />
          <span>
            {strongFirst && index === 0 ? <strong>{item}</strong> : item}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ReferenceModule({ id }: { id: string }) {
  const content = parseModule(id);
  const pretraining = id === "rec779902274";
  const moduleNumber = content.badge.match(/\d+/)?.[0];

  if (pretraining) {
    return (
      <article
        id={id}
        data-cb-native-program-module
        className="relative grid gap-5 pb-16 md:grid-cols-2 md:gap-x-0 md:gap-y-4 md:pb-24"
      >
        <div
          className="rounded-[20px] px-5 pb-5 pt-6 md:col-span-2 md:grid md:grid-cols-2 md:gap-10 md:px-6 md:py-6"
          style={{ background: "#efa2f5" }}
        >
          <div>
            <p
              className="text-[42px] font-light uppercase leading-none md:text-[54px]"
              style={{ color: "#f8ccfb" }}
            >
              {content.badge}
            </p>
            <h3
              className="-mx-5 mt-5 rounded-[0_18px_18px_0] px-5 py-4 text-[21px] font-normal uppercase leading-tight md:-ml-6 md:mr-0 md:text-[28px]"
              style={{ background: CB_PALETTE.accent, color: CB_PALETTE.bg }}
            >
              {content.title}
            </h3>
          </div>
          <div className="mt-6 md:mt-0 md:px-3">
            <p
              className="mb-3 text-[15px] font-normal uppercase md:text-[18px]"
              style={{ color: "#bf37ae" }}
            >
              Результаты модуля:
            </p>
            <DotList items={content.results} />
          </div>
        </div>

        <div className="relative px-5 py-4 md:min-h-[155px] md:px-10">
          <span
            aria-hidden
            className="absolute bottom-5 left-0 top-4 w-px"
            style={{ background: CB_PALETTE.accent }}
          />
          <ul className="space-y-3 text-[15px] leading-[1.35] md:text-[17px]">
            {(content.pretrainingLead ?? []).map((item, index) => (
              <li key={item} className="relative pl-2">
                <span
                  aria-hidden
                  className="absolute -left-10 top-[0.7em] h-px w-8"
                  style={{ background: CB_PALETTE.accent }}
                />
                {index === 0 ? (
                  <>
                    <strong>Как усилить эффект</strong> от курса?
                  </>
                ) : index === 1 ? (
                  <>
                    <strong>Законы эффективного обучения:</strong> как учиться правильно?
                  </>
                ) : (
                  <>
                    <strong>Гид по курсу:</strong> как устроен «Ценный бухгалтер»?
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div
          className="rounded-[20px] border px-6 py-5 md:min-h-[155px] md:px-10"
          style={{ borderColor: CB_PALETTE.accent }}
        >
          <p className="mb-3 text-[18px] font-normal uppercase">Бонусы:</p>
          <DotList items={content.boosters} strongFirst />
        </div>
      </article>
    );
  }

  return (
    <article
      id={id}
      data-cb-native-program-module
      className="relative grid gap-5 pb-16 md:grid-cols-2 md:gap-x-5 md:gap-y-4 md:pb-20"
    >
      <div className="relative flex min-h-[188px] flex-col justify-end pt-14 md:min-h-[205px]">
        <p
          className="absolute left-5 top-0 text-[48px] font-light uppercase leading-none md:left-0 md:text-[58px]"
          style={{ color: "#f8e5f7" }}
        >
          МОДУЛЬ #{moduleNumber ?? ""}
        </p>
        <h3
          className="relative rounded-[0_18px_18px_0] px-5 py-5 text-[21px] font-normal uppercase leading-tight md:pr-7 md:text-[27px]"
          style={{ background: CB_PALETTE.accent, color: CB_PALETTE.bg }}
        >
          {content.title}
        </h3>
      </div>

      <div
        className="rounded-[20px] px-6 py-5 md:min-h-[205px] md:px-9 md:py-6"
        style={{ background: "#efa2f5" }}
      >
        <p
          className="mb-3 text-[15px] font-normal uppercase md:text-[18px]"
          style={{ color: "#bf37ae" }}
        >
          Результаты модуля:
        </p>
        <DotList items={content.results} />
      </div>

      <div className="relative min-h-[110px] px-5 py-4 md:px-10">
        <span
          aria-hidden
          className="absolute bottom-5 left-0 top-4 w-px"
          style={{ background: CB_PALETTE.accent }}
        />
        <p className="relative text-[15px] leading-[1.45] md:text-[17px]">
          <span
            aria-hidden
            className="absolute -left-10 top-[0.7em] h-px w-8"
            style={{ background: CB_PALETTE.accent }}
          />
          {content.question}
        </p>
      </div>

      {content.boosters.length > 0 ? (
        <div
          className="rounded-[20px] border px-6 py-5 md:min-h-[110px] md:px-9"
          style={{ borderColor: CB_PALETTE.accent }}
        >
          <p className="mb-3 text-[17px] font-normal uppercase">Усилители:</p>
          <DotList items={content.boosters} />
        </div>
      ) : (
        <div aria-hidden className="hidden md:block" />
      )}
    </article>
  );
}

function DarkCallout({ id }: { id: string }) {
  const r = rec(id);
  return (
    <aside
      id={id}
      data-cb-native-program-callout
      className="mb-20 rounded-[24px] px-7 py-10 text-center md:px-14 md:py-14"
      style={{ background: "#343434", color: CB_PALETTE.bg }}
    >
      <p className="mx-auto max-w-4xl text-[17px] leading-[1.5] md:text-[20px]">
        <span
          className="mr-3 inline-block align-middle text-[48px] font-bold md:text-[68px]"
          style={{ color: CB_PALETTE.accent }}
        >
          {r.text[4] ?? ""}
        </span>
        {r.text[1]} <strong>{r.text[2]}</strong> {r.text[3]}
      </p>
      <p
        className="mt-5 text-[13px] font-bold uppercase tracking-[0.14em]"
        style={{ color: CB_PALETTE.accentSoft }}
      >
        {r.text[0]}
      </p>
    </aside>
  );
}

function MagentaCallout({ id }: { id: string }) {
  const r = rec(id);
  return (
    <aside
      id={id}
      data-cb-native-program-callout
      className="mb-20 rounded-[24px] px-7 py-10 md:px-14 md:py-14"
      style={{ background: CB_PALETTE.accent, color: CB_PALETTE.bg }}
    >
      <h3 className="text-[24px] font-bold uppercase leading-tight md:text-[34px]">
        {r.text[0] ?? ""}
      </h3>
      {r.text[1] ? (
        <p className="mt-4 text-[15px] leading-[1.55] md:text-[17px]">
          {r.text.slice(1).join(" ")}
        </p>
      ) : null}
    </aside>
  );
}

function GridCallout({ id }: { id: string }) {
  const r = rec(id);
  const bullets = r.text.slice(6, 10).filter(Boolean);
  return (
    <aside
      id={id}
      data-cb-native-program-callout
      className="mb-20 rounded-[24px] border px-7 py-9 md:px-12 md:py-12"
      style={{ background: CB_PALETTE.bgSoft, borderColor: CB_PALETTE.border }}
    >
      <p className="text-[16px] leading-[1.55] md:text-[18px]">{r.text.slice(0, 4).join(" ")}</p>
      <ul className="mt-5 grid gap-3 md:grid-cols-2">
        {bullets.map((bullet) => (
          <li
            key={bullet}
            className="rounded-[14px] border bg-white px-4 py-3 text-[14px]"
            style={{ borderColor: CB_PALETTE.border }}
          >
            → {bullet}
          </li>
        ))}
      </ul>
      <p className="mt-6 text-[15px] font-bold uppercase" style={{ color: CB_PALETTE.accent }}>
        {r.text[4]} <span style={{ color: CB_PALETTE.textStrong }}>{r.text[5]}</span>
      </p>
    </aside>
  );
}

export function ProgramSection({ onCta }: { onCta: () => void }) {
  const cta = rec("rec779963654").text[0] ?? "СМОТРЕТЬ всю программу";

  return (
    <section
      id="rec776467165"
      data-cb-native-section="program"
      className="py-16 lg:py-24"
      style={{ background: CB_PALETTE.bg }}
    >
      <div className="mx-auto max-w-[1200px] px-5">
        <h2
          className="mb-14 text-left text-[31px] font-bold uppercase leading-[1.08] md:mb-20 md:text-[42px]"
          style={{ color: CB_PALETTE.textStrong }}
        >
          ВАША ПОЛЬЗА <span style={{ color: CB_PALETTE.accent }}>В КАЖДОМ</span>
          <br />
          МОДУЛЕ ОБУЧЕНИЯ
        </h2>

        <div data-cb-native-program-list>
          {ORDERED.map((item) => {
            if (item.kind === "module") return <ReferenceModule key={item.id} id={item.id} />;
            if (item.variant === "dark") return <DarkCallout key={item.id} id={item.id} />;
            if (item.variant === "magenta") return <MagentaCallout key={item.id} id={item.id} />;
            return <GridCallout key={item.id} id={item.id} />;
          })}
        </div>

        <div className="mt-3 text-center" id="rec779963654">
          <button
            type="button"
            onClick={onCta}
            data-cb-native-program-cta
            data-cb-native-anchor-target="#tariffs"
            className="inline-flex h-[62px] items-center justify-center rounded-[30px] px-10 text-[15px] font-bold uppercase tracking-wide shadow-[0_8px_22px_rgba(228,34,194,0.35)] transition hover:opacity-90"
            style={{ background: CB_PALETTE.accent, color: CB_PALETTE.bg }}
          >
            {cta}
          </button>
        </div>
      </div>
    </section>
  );
}
