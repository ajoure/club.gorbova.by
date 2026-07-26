import { rec, CB_PALETTE } from "../manifest";

type IndustryCard = {
  title: string;
  bullets: string[];
  price?: string;
  included?: string;
};

const pairText = (items: string[]) =>
  items.reduce<string[]>((result, item, index) => {
    if (item === "➤") return result;
    if (index > 0 && items[index - 1] === "➤") result.push(item);
    return result;
  }, []);

function industryCard(text: string[], start: number, end: number): IndustryCard {
  const slice = text.slice(start, end);
  return {
    title: slice[0] ?? "",
    bullets: pairText(slice.slice(1)).filter((item) => !/^\d+\s*BYN$/i.test(item)),
    price: slice.find((item) => /^\d+\s*BYN$/i.test(item)),
  };
}

function IndustryModules({ onCta }: { onCta: () => void }) {
  const moduleRec = rec("rec1093089581");
  const text = moduleRec.text;
  const cards: IndustryCard[] = [
    {
      title: text[3] ?? "",
      bullets: [],
      included: text[5] ?? "",
    },
    {
      title: text[130] ?? "",
      bullets: [],
      included: text[129] ?? "",
    },
    industryCard(text, 7, 19),
    industryCard(text, 19, 31),
    industryCard(text, 31, 47),
    industryCard(text, 47, 59),
    industryCard(text, 59, 71),
    industryCard(text, 71, 83),
    industryCard(text, 83, 97),
    industryCard(text, 97, 109),
    industryCard(text, 113, 127),
  ];

  return (
    <section
      id={moduleRec.id}
      className="mt-20"
      aria-labelledby="cb-industry-title"
    >
      <p
        className="mx-auto max-w-4xl text-center text-[17px] leading-[1.55]"
        style={{ color: CB_PALETTE.muted }}
      >
        {text[0]}
      </p>
      <h3
        id="cb-industry-title"
        className="mt-3 text-center text-[30px] font-bold uppercase leading-[1.12] md:text-[42px]"
        style={{ color: CB_PALETTE.textStrong }}
      >
        <span style={{ color: CB_PALETTE.accent }}>{text[1]}</span>
        <br />
        {text[2]}
      </h3>

      <div className="mt-10 grid gap-5 md:grid-cols-2">
        {cards.map((card, index) => (
          <article
            key={`${card.title}-${index}`}
            className="flex min-w-0 flex-col rounded-[22px] border-2 px-6 py-6"
            style={{ borderColor: CB_PALETTE.accent, background: "#ffffff" }}
          >
            <h4
              className="text-[22px] font-bold leading-tight"
              style={{ color: CB_PALETTE.textStrong }}
            >
              {card.title}
            </h4>
            {card.included ? (
              <p className="mt-4 text-[15px]" style={{ color: CB_PALETTE.accent }}>
                ✓ {card.included}
              </p>
            ) : null}
            {card.bullets.length ? (
              <ul className="mt-4 space-y-2 text-[15px] leading-[1.45]" style={{ color: CB_PALETTE.muted }}>
                {card.bullets.map((bullet, bulletIndex) => (
                  <li key={bulletIndex} className="flex gap-2">
                    <span aria-hidden style={{ color: CB_PALETTE.accent }}>➤</span>
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {card.price ? (
              <button
                type="button"
                onClick={onCta}
                data-cb-native-module-price-cta
                aria-label={`${card.title}: ${card.price}. Выбрать тариф`}
                className="mt-auto h-[56px] w-full rounded-full px-5 text-[17px] font-bold uppercase"
                style={{ background: CB_PALETTE.accent, color: "#ffffff" }}
              >
                {card.price}
              </button>
            ) : null}
            {card.included ? (
              <button
                type="button"
                onClick={onCta}
                data-cb-native-module-included-cta
                className="mt-6 h-[56px] rounded-full px-5 text-[14px] font-bold uppercase"
                style={{ background: CB_PALETTE.accent, color: "#ffffff" }}
              >
                {text[index === 0 ? 6 : 127]}
              </button>
            ) : null}
          </article>
        ))}
      </div>

      <article
        className="mt-5 rounded-[22px] border-2 px-6 py-6"
        style={{ borderColor: CB_PALETTE.accent, background: "#ffffff" }}
      >
        <h4 className="text-[22px] font-bold" style={{ color: CB_PALETTE.textStrong }}>
          {text[112]}
        </h4>
        <div className="mt-4 flex flex-wrap gap-3 text-[15px]" style={{ color: CB_PALETTE.muted }}>
          {text.slice(109, 112).map((item) => (
            <span key={item} className="rounded-full border px-4 py-2" style={{ borderColor: CB_PALETTE.border }}>
              {item}
            </span>
          ))}
        </div>
      </article>
    </section>
  );
}

function PurchaseSteps() {
  const stepsRec = rec("rec1091232946");
  const steps = [
    { number: stepsRec.text[5], text: stepsRec.text[4] },
    { number: stepsRec.text[9], text: stepsRec.text[8] },
    { number: stepsRec.text[11], text: stepsRec.text[10] },
    { number: stepsRec.text[7], text: stepsRec.text[6] },
    { number: stepsRec.text[0], text: `${stepsRec.text[1]} ${stepsRec.text[2]}` },
  ];
  return (
    <section id={stepsRec.id} className="mt-20">
      <h3
        className="text-center text-[30px] font-bold uppercase md:text-[42px]"
        style={{ color: CB_PALETTE.accent }}
      >
        {stepsRec.text[3]}
      </h3>
      <div className="mt-10 grid gap-5 md:grid-cols-5">
        {steps.map((step) => (
          <article
            key={step.number}
            className="rounded-[20px] border px-5 py-6"
            style={{ borderColor: CB_PALETTE.border, background: CB_PALETTE.bgSoft }}
          >
            <p className="text-[34px] font-bold" style={{ color: CB_PALETTE.accent }}>
              {step.number}
            </p>
            <p className="mt-3 text-[14px] leading-[1.5]" style={{ color: CB_PALETTE.text }}>
              {step.text}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function LearningTechnology() {
  const technologyRec = rec("rec783408868");
  const steps = [
    technologyRec.text.slice(2, 4).join(" "),
    technologyRec.text.slice(4, 6).join(" "),
    technologyRec.text.slice(6, 8).join(" "),
    technologyRec.text.slice(8, 10).join(" "),
  ];
  return (
    <section id={technologyRec.id} className="mt-20">
      <h3
        className="text-center text-[30px] font-bold uppercase leading-[1.15] md:text-[42px]"
        style={{ color: CB_PALETTE.textStrong }}
      >
        {technologyRec.text[0]}
        <br />
        <span style={{ color: CB_PALETTE.accent }}>{technologyRec.text[1]}</span>
      </h3>
      <div className="mt-10 grid gap-5 md:grid-cols-4">
        {steps.map((step, index) => (
          <article
            key={step}
            className="rounded-[20px] px-5 py-6"
            style={{ background: index % 2 ? CB_PALETTE.accent : "#302c2c", color: "#ffffff" }}
          >
            <p className="text-[32px] font-bold opacity-60">{index + 1}</p>
            <p className="mt-3 text-[15px] font-semibold leading-[1.45]">{step}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function AdvantagesSection({ onCta }: { onCta: () => void }) {
  const main = rec("rec782178631");
  const advantages = [
    main.text.slice(1, 3).join(" "),
    main.text.slice(3, 5).join(""),
    main.text.slice(5, 7).join(" "),
    main.text.slice(7, 9).join(" "),
  ];

  return (
    <section
      id={main.id}
      data-cb-native-section="advantages"
      className="py-16 lg:py-24"
      style={{ background: CB_PALETTE.bg }}
    >
      <div className="mx-auto max-w-[1160px] px-5">
        <h2
          className="text-center text-[32px] font-bold uppercase leading-[1.12] md:text-[42px]"
          style={{ color: CB_PALETTE.textStrong }}
        >
          {main.text[0]}
        </h2>
        <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {advantages.map((advantage, index) => (
            <article
              key={advantage}
              className="rounded-[20px] border px-5 py-6 text-[15px] leading-[1.5]"
              style={{ borderColor: CB_PALETTE.border, background: CB_PALETTE.bgSoft }}
            >
              <span className="text-[30px] font-bold" style={{ color: CB_PALETTE.accent }}>
                {index + 1}
              </span>
              <p className="mt-3" style={{ color: CB_PALETTE.text }}>
                {advantage}
              </p>
            </article>
          ))}
        </div>
        <IndustryModules onCta={onCta} />
        <PurchaseSteps />
        <LearningTechnology />
      </div>
    </section>
  );
}
