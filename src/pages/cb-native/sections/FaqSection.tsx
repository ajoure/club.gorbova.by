import { rec, CB_PALETTE } from "../manifest";
import type { PublicTariff } from "@/hooks/usePublicProduct";
import { tariffAccessCopy, tariffBonusParagraphs } from "../tariffAccessCopy";

/**
 * Section 11a — Q&A (rec776467188 header + rec776467189 items).
 * Native <details>/<summary> — no third-party accordion runtime.
 * Text tokens alternate: a question (ends with ?, short) followed by one or
 * more answer paragraphs, in exact cbold order.
 */
export function FaqSection({ tariffs = [] }: { tariffs?: PublicTariff[] }) {
  const header = rec("rec776467188").text[0] ?? "АКТУАЛЬНЫЕ ВОПРОСЫ";
  const src = rec("rec776467189").text;

  const items: { q: string; a: string[] }[] = [];
  let cur: { q: string; a: string[] } | null = null;
  for (const t of src) {
    if (t.endsWith("?") && t.length < 160) {
      if (cur) items.push(cur);
      cur = { q: t, a: [] };
    } else if (cur) {
      cur.a.push(t);
    }
  }
  if (cur) items.push(cur);

  const accessQuestion = items.find((item) => item.q === "На какое время выдается доступ к курсу?");
  if (accessQuestion) {
    const durations = tariffs.filter(t => t.is_public !== false).flatMap(t => {
      const access = tariffAccessCopy(t);
      return access ? [`«${t.name}»: ${access.bold.toLowerCase()} ${access.text}.`] : [];
    });
    accessQuestion.a = [
      ...(durations.length ? durations : ["Срок доступа указан в карточке выбранного тарифа."]),
      "Для ранее оплаченных покупок сохраняются условия, действовавшие при покупке.",
    ];
  }
  const paceQuestion = items.find(item => item.q === "Могу ли я двигаться в своем темпе?");
  if (paceQuestion) paceQuestion.a = ["Да, материалы можно изучать в своём темпе в течение срока доступа по выбранному тарифу."];
  const chatQuestion = items.find(item => item.q === "Как долго доступны чаты и обратная связь?");
  if (chatQuestion) chatQuestion.a = [
    "Обратная связь по курсу доступна на время обучения. Дополнительные доступы зависят от выбранного тарифа и условий покупки:",
    ...tariffBonusParagraphs(tariffs),
    "Состав и сроки указаны в карточках тарифов. Льготные предложения могут отличаться по бонусам.",
  ];

  return (
    <section
      id="rec776467188"
      data-cb-native-section="faq"
      className="py-16 lg:py-24"
      style={{ background: CB_PALETTE.bg }}
    >
      <div className="mx-auto max-w-4xl px-5">
        <h2
          className="mb-10 text-center text-[28px] font-bold uppercase leading-[1.15] md:text-[38px]"
          style={{ color: CB_PALETTE.accent }}
        >
          {header}
        </h2>
        <div className="space-y-3" data-cb-native-faq-list>
          {items.map((it, i) => (
            <details
              key={i}
              data-cb-native-faq-item
              className="group overflow-hidden rounded-2xl"
              style={{
                background: CB_PALETTE.bgSoft,
                border: `1px solid ${CB_PALETTE.border}`,
              }}
            >
              <summary
                className="flex cursor-pointer list-none items-start justify-between gap-4 p-5"
                style={{ color: CB_PALETTE.textStrong }}
              >
                <span
                  className="text-sm font-semibold sm:text-base"
                  data-cb-native-faq-question
                >
                  {it.q}
                </span>
                <span
                  aria-hidden
                  className="text-xl leading-none transition-transform group-open:rotate-45"
                  style={{ color: CB_PALETTE.accent }}
                >
                  +
                </span>
              </summary>
              <div
                className="space-y-2 px-5 pb-5 text-sm leading-relaxed"
                style={{ color: CB_PALETTE.text }}
                data-cb-native-faq-answer
              >
                {it.a.map((p, j) => (
                  <p key={j}>{p}</p>
                ))}
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
