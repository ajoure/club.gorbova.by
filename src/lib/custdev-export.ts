import {
  CATEGORIES,
  CATEGORY_LABELS,
  type CustdevState,
  GROUPS,
  needScores,
  TYPE_LABELS,
} from "../../supabase/functions/_shared/custdev-contract";
export function exportCustdevText(state: CustdevState): string {
  const lines = [
    "Шаг 5. Кастдев → позиционирование → УТП",
    `Общее позиционирование: ${
      state.company.approvedText || state.company.userText
    }`,
    `Вариант ИИ: ${state.company.aiText}`,
  ];
  for (const s of state.segments) {
    lines.push(
      `\nСегмент: ${s.title}${s.archived ? " [архив]" : ""}`,
      s.description,
      `Решение принимает: ${s.decisionMaker}`,
      `Причина выбора: ${s.reason}`,
    );
    for (let group = 1; group <= 7; group++) {
      lines.push(`${group}. ${GROUPS[group - 1]}`);
      s.questions.filter((q) => q.group === group && !q.archived).sort((a, b) =>
        a.order - b.order
      ).forEach((q, n) =>
        lines.push(
          `${group}.${n + 1} ${q.text} [${
            q.types.map((t) => TYPE_LABELS[t]).join(", ")
          }] ${q.note}`,
        )
      );
    }
    for (const i of state.interviews.filter((i) => i.segmentId === s.id)) {
      lines.push(
        `\nИнтервью ${i.name}: ${TYPE_LABELS[i.type]}, ${i.date}, ${i.status}${
          i.archived ? " [архив]" : ""
        }`,
        `Категория портфеля: ${i.category ?? "—"}`,
      );
      for (const a of i.answers) {
        lines.push(
          `Вопрос (снимок): ${a.snapshot}`,
          `Ответ (${a.status}): ${a.text}`,
        );
        for (const f of a.followups) {
          lines.push(`Уточнение: ${f.question}`, `Ответ: ${f.answer}`);
        }
      }
    }
    const a = state.analyses[s.id];
    for (const n of a?.needs ?? []) {
      const scores = needScores(state, s.id, n);
      lines.push(
        `\n${CATEGORY_LABELS[n.category]}: ${n.label}${
          n.excluded ? " [исключено]" : ""
        }`,
        `Повторяемость ${scores.k}/${scores.n}; рассчитано ${
          scores.computedFrequency ?? "—"
        }; ручная поправка ${n.overrides.frequency ?? "—"}`,
        `Значимость ${scores.significance ?? "—"}; влияние на покупку ${
          scores.purchaseImpact ?? "—"
        }; соответствие продукту ${
          scores.productFit ?? "требует проверки"
        }; итог ${scores.total ?? "—"}`,
        scores.rationale,
        `Проверено вручную: ${n.approvedValue ? "да" : "нет"}`,
      );
      for (const q of a.quotes.filter((q) => n.quoteIds.includes(q.id))) {
        lines.push(
          `«${q.text}» — интервью ${
            state.interviews.find((i) => i.id === q.interviewId)?.name ??
              q.interviewId
          }; вопрос ${q.questionId}; ответ ${q.sourceId}${
            q.excluded ? " [исключена]" : ""
          }`,
        );
      }
    }
    const p = state.positioning[s.id];
    if (p) {
      lines.push(
        `Позиционирование: ${p.approvedText || p.userText}`,
        `Вариант ИИ: ${p.aiText}`,
      );
    }
    for (const u of state.usps.filter((u) => u.segmentId === s.id)) {
      lines.push(
        `\nУТП: ${u.title}`,
        `Проблема: ${u.problem}`,
        `Результат: ${u.result}`,
        `Механизм: ${u.mechanism}`,
        `Доказательство: ${u.evidence || "Гипотеза — требует доказательств"}`,
        `Автор: ${u.userText}`,
        `ИИ: ${u.aiText}`,
        `Утверждено: ${u.approvedText}`,
        `Статус: ${u.status}`,
      );
    }
  }
  return lines.join("\n");
}
