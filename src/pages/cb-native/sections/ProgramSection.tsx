import { useRef, useState } from "react";
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
export const PROGRAM_COLLAPSED_ITEM_COUNT = 2;

type ModuleContent = {
  badge: string;
  title: string;
  questions: string[];
  results: string[];
  boosters: string[];
  pretrainingLead?: string[];
};

const STANDARD_BOOSTERS = [
  "Интерактивное задание-игра",
  "Подробное объяснение решения домашнего задания",
  "Практическая онлайн-конференция с Катериной",
  "Майндкарта по теме урока",
] as const;

type ReferenceCopy = {
  questions: string[];
  results: string[];
  boosters?: string[];
};

/**
 * The Tilda export stores text atoms in visual rather than reading order.
 * Keep the canonical copy normalized here so badges inserted between result
 * bullets can never truncate the programme again.
 */
const REFERENCE_COPY: Record<string, ReferenceCopy> = {
  rec779946753: {
    questions: ["Кто такой бухгалтер, и насколько вам это подходит?"],
    results: [
      "Поймете, почему работа бухгалтера – это не про 1С",
      "Определитесь, чего вы хотите от этой профессии",
      "Поймете, в чем ее глобальный и рутинный смысл",
      "Обозначите свою точку Б и цели на курс",
    ],
    boosters: ["Выполните коучинговое упражнение и определите компетенции"],
  },
  rec780006224: {
    questions: ["Как отличить запасы от основных средств и учесть их приобретение?"],
    results: [
      "Научитесь правильно отличать ОС от запасов",
      "Поймете, для чего придумано 12 субсчетов для счета 10 «Материалы», и научитесь выбирать верный",
      "Научитесь приобретать, создавать, вводить в эксплуатацию, ремонтировать, переоценивать и отчуждать ОС",
    ],
  },
  rec780073973: {
    questions: ["Как правильно учитывать и классифицировать все расходы компании?"],
    results: [
      "Научитесь правильно использовать затратные счета в организации с любым видом деятельности",
      "Поймете, насколько это важно для компании",
    ],
  },
  rec780079482: {
    questions: ["Как правильно идентифицировать НМА и учесть их приобретение и создание?"],
    results: [
      "Научитесь правильно отличать расходы от НМА",
      "Научитесь приобретать, создавать, вводить в эксплуатацию, дорабатывать, переоценивать и отчуждать НМА",
      "Отдельное внимание уделите товарным знакам",
    ],
  },
  rec780081115: {
    questions: ["Как правильно и в полном объеме учитывать все деньги компании?"],
    results: [
      "Научитесь правильно учитывать любое движение безналичных и наличных средств.",
      "Узнаете про учет электронных денег",
      "Поймете, как отличать операционную кассу от кассы организации",
      "Научитесь работать с валютой",
    ],
  },
  rec780092281: {
    questions: ["Как классифицировать и учитывать движение заемных средств компании?"],
    results: [
      "Научитесь с легкостью учитывать полученные и выданные займы, все формы кредитования",
      "Поймёте, как избежать неприятных налоговых последствий, которые поджидают вас на этом участке",
      "Узнаете роль бухгалтера в положительном решении о кредитовании",
      "Разберетесь в учете лизинговых операций в рублях и валюте",
    ],
  },
  rec780094387: {
    questions: [
      "Расчеты со всеми видами контрагентов",
      "Дебиторская и кредиторская задолженность",
      "Расчеты с бюджетом по налогам, сборам и пошлинам",
    ],
    results: [
      "Научитесь проводить расчеты с заказчиками и подрядчиками",
      "Поймете, когда нужно использовать 76 счет",
      "Научитесь учитывать расчеты с бюджетом",
      "Разберетесь с расчетами в валюте и в валютном регулировании",
    ],
  },
  rec780097393: {
    questions: ["Как учесть все операции по поставкам из ЕАЭС и дальнего зарубежья?"],
    results: [
      "Получите схему работы для каждого из видов импорта",
      "Узнаете обязательные действия со стороны покупателя и необходимый пакет документов",
      "Изучите импорт за наличный и безналичный расчёт и за счет третьих лиц",
      "Углубитесь в нюансы участка, о которых вы узнаете только на обучении",
    ],
  },
  rec780099682: {
    questions: [
      "Как отличить монетарные активы (обязательства) от немонетарных и правильно их учесть",
    ],
    results: [
      "Получите простейший алгоритм из двух действий, который поможет вам принимать верные решения на этом участке",
      "Узнаете, что будет, если не делать переоценку на выходных или первичный учётный документ по каждый переоценке",
    ],
  },
  rec780102268: {
    questions: ["Как правильно учитывать Налог на добавленную стоимость (НДС)?"],
    results: [
      "Разберетесь в понятиях «входящий» и «исходящий» НДС",
      "Узнаете критерии применения вычетов",
      "Научитесь правильно учитывать НДС, чтобы бухгалтерский и налоговый учет совпадал",
    ],
  },
  rec780331623: {
    questions: ["Как правильно учитывать и классифицировать расчеты с персоналом?"],
    results: [
      "Узнаете учет:",
      "начисления доходов",
      "удержания налогов, взносов, сумм недостач, излишних выплат, алиментов, штрафов по административным делам",
      "выдачи подарков, спецодежды, орудий труда",
      "повышенной комфортности: обед в офис, кофе, чай конфеты и печенье, питьевая вода, развлечения",
      "взносов в ФСЗН, Белгосстрах",
    ],
  },
  rec780337757: {
    questions: ["Как учесть выдачу и возмещение понесенных расходов в пользу компании?"],
    results: [
      "Научитесь выдавать суммы в подотчет и возмещать понесенные расходы",
      "Узнаете о ситуациях, когда вы обязаны отразить покупку даже при отсутствующих документах",
      "Рассчитаете дополнительные налоги, о которых все забывают на этом участке",
    ],
  },
  rec780343795: {
    questions: [
      "Как учесть реализацию ТМЦ (работ, услуг) в Беларуси и за ее пределами (экспорт)",
    ],
    results: [
      "Научитесь отражать реализацию ТМЦ (работ, услуг) в Беларуси и за ее пределами (экспорт)",
      "Изучите нюансы работы с нерезидентами",
      "Узнаете про бонусы, скидки и премии",
      "Углубитесь в нюансы исчисления НДС в зависимости от условий сделки",
    ],
  },
  rec780348530: {
    questions: ["Как правильно определять финансовый результат компании?"],
    results: [
      "Научитесь подводить финансовые итоги компании",
      "Навсегда разберетесь со счетами 90, 91, 99",
      "Разберетесь в том, как правильно делать и понимать проводки по закрытию месяца",
    ],
  },
  rec780743292: {
    questions: [
      "Реформация баланса",
      "Уставный фонд и регистрация компании",
      "Расчеты с учредителями",
    ],
    results: [
      "Научитесь делать реформацию баланса",
      "Изучите понятие «Фонды», разберетесь, как их создавать и для чего",
      "Разберетесь с учетом и правовым регулированием расчетов с учредителями",
      "Научитесь распределять прибыль и покрывать убытки согласно законодательству",
    ],
  },
  rec780360510: {
    questions: [
      "Обзорная лекция по всем счетам и участкам бухгалтерского учёта",
      "Бухгалтерская отчётность как итог работы бухгалтера",
    ],
    results: [
      "Изучите все счета и участки бухгалтерского учёта",
      "Сформируете бухгалтерскую отчётность с нуля и вручную, потому что вы молодцы!",
    ],
  },
  rec780366621: {
    questions: ["Как составить правильную и безопасную УП?"],
    results: [
      "Изучите наполнение, внесение изменений и дополнений в УП",
      "Поймете её смысл, суть, основные ошибки и негативные последствия неправильной учётной политики",
    ],
  },
  rec780398470: {
    questions: ["Как оформить верный ПУД?"],
    results: [
      "Научитесь оформлять ПУД по любой хозяйственной операции",
      "Изучите нюансы единоличного составления",
      "Разберетесь с формами, копиями, хранением и внесением исправлений",
    ],
  },
  rec780353436: {
    questions: ["Основы, принципы, нюансы"],
    results: [
      "Получите схему принятия решений на участке",
      "Составите налоговые регистры",
      "Узнаете почему каждый бухгалтер (даже на участке с первичкой!) должен знать налоговые учёт, если вы хотите проходить проверки без штрафов и доплат?",
    ],
  },
  rec782168706: {
    questions: ["Как правильно ставить задачи, чтобы они выполнялись эффективно и точно в срок?"],
    results: [
      "Поймете причины, почему у вас не получалось начать делегировать эффективно",
      "Получите технологию с подробным описанием что делегировать, как именно и кому",
      "Автоматизируете выставление задач и контроль их выполнения",
    ],
    boosters: [],
  },
  rec782170827: {
    questions: [
      "Как не ошибиться с выбором, вырастить сильного бухгалтера и построить долгосрочное сотрудничество?",
    ],
    results: [
      "Разработаете собственную воронку найма",
      "Внедрите технологию адаптации персонала",
      "Научитесь удерживать сотрудников",
    ],
    boosters: [],
  },
  rec782173747: {
    questions: ["Как ничего не упустить и закрывать месяц всегда до 13 числа?"],
    results: [
      "Внедрите авторскую технологию Катерины Горбовой, чтобы всегда получать документы от коллег и клиентов вовремя и не ночевать на работе в отчётный период",
    ],
    boosters: [],
  },
  rec782174918: {
    questions: ["Авторская технология построения системной бухгалтерии, которая работает вместо вас"],
    results: ["Авторская технология построения системной бухгалтерии, которая работает вместо вас"],
    boosters: [],
  },
  rec783206282: {
    questions: [
      "Четкий алгоритм не только оказания услуг, но и эффективной продажи с высокой конверсией",
    ],
    results: [
      "Четкий алгоритм не только оказания услуг, но и эффективной продажи с высокой конверсией",
    ],
    boosters: [],
  },
  rec783206583: {
    questions: ["Алгоритм четких действий, чтобы восстанавливать 1 год учета за 1 месяц."],
    results: ["Алгоритм четких действий, чтобы восстанавливать 1 год учета за 1 месяц."],
    boosters: [],
  },
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
      questions: [],
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

  const reference = REFERENCE_COPY[id];
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
    questions: reference?.questions ?? [clean(questionIndexes.map((index) => r.text[index]))],
    results: reference?.results ?? results,
    boosters:
      reference?.boosters ??
      (reference && !["rec779946753", "rec782168706", "rec782170827", "rec782173747"].includes(id)
        ? [...STANDARD_BOOSTERS]
        : boosters),
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
        data-cb-native-program-results={id}
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
        <ul className="space-y-3 text-[15px] leading-[1.45] md:text-[17px]">
          {content.questions.map((question) => (
            <li key={question} className="relative">
              <span
                aria-hidden
                className="absolute -left-10 top-[0.7em] h-px w-8"
                style={{ background: CB_PALETTE.accent }}
              />
              {question}
            </li>
          ))}
        </ul>
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

export function ProgramSection({ onCta: _onCta }: { onCta: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const cta = rec("rec779963654").text[0] ?? "СМОТРЕТЬ всю программу";
  const visibleItems = expanded ? ORDERED : ORDERED.slice(0, PROGRAM_COLLAPSED_ITEM_COUNT);

  const toggleProgramme = () => {
    if (expanded) {
      sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setExpanded((current) => !current);
  };

  return (
    <section
      ref={sectionRef}
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

        <div id="cb-native-programme-list" data-cb-native-program-list>
          {visibleItems.map((item) => {
            if (item.kind === "module") return <ReferenceModule key={item.id} id={item.id} />;
            if (item.variant === "dark") return <DarkCallout key={item.id} id={item.id} />;
            if (item.variant === "magenta") return <MagentaCallout key={item.id} id={item.id} />;
            return <GridCallout key={item.id} id={item.id} />;
          })}
        </div>

        <div className="mt-3 text-center" id="rec779963654">
          <button
            type="button"
            onClick={toggleProgramme}
            aria-expanded={expanded}
            aria-controls="cb-native-programme-list"
            data-cb-native-program-cta
            className="inline-flex h-[62px] items-center justify-center rounded-[30px] px-10 text-[15px] font-bold uppercase tracking-wide shadow-[0_8px_22px_rgba(228,34,194,0.35)] transition hover:opacity-90"
            style={{ background: CB_PALETTE.accent, color: CB_PALETTE.bg }}
          >
            {expanded ? "Свернуть" : cta}
          </button>
        </div>
      </div>
    </section>
  );
}
