import type { ActDifference, ActDocumentSummary, ActReconciliationExtraction } from "./act-reconciliation-extraction.ts";

const LABELS: Record<ActDifference["type"], string> = {
  missing_in_first: "Нет в первом акте",
  missing_in_second: "Нет во втором акте",
  amount_mismatch: "Не совпадает сумма",
  date_mismatch: "Не совпадает дата",
  details_mismatch: "Не совпадают реквизиты операции",
  balance_mismatch: "Не совпадает сальдо",
  needs_review: "Нужна ручная проверка",
};

function safe(value: string | null | undefined): string {
  return (value || "—").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function documentLine(doc: ActDocumentSummary, index: number): string {
  const parties = [doc.organization_name, doc.counterparty_name].filter(Boolean).join(" ↔ ") || "стороны не распознаны";
  const period = doc.period_from || doc.period_to
    ? `${doc.period_from || "?"} — ${doc.period_to || "?"}`
    : "период не распознан";
  return `${index}. **${safe(doc.file_name)}** — ${safe(parties)}, ${period}, конечное сальдо: ${safe(doc.closing_balance)} ${safe(doc.currency)}`;
}

function compactOperation(date: string | null, document: string | null, description: string | null, amount: string | null, currency: string | null): string {
  return [date, document, description, amount ? `${amount} ${currency || ""}`.trim() : null]
    .filter(Boolean)
    .map((value) => safe(value))
    .join("; ") || "—";
}

function buildLetter(result: ActReconciliationExtraction): string {
  const [first, second] = result.documents;
  const periodFrom = first?.period_from || second?.period_from || "[дата начала]";
  const periodTo = first?.period_to || second?.period_to || "[дата окончания]";
  const counterparty = first?.counterparty_name || second?.organization_name || "[наименование контрагента]";
  const lines = result.differences.slice(0, 12).map((difference, index) =>
    `${index + 1}. ${LABELS[difference.type]}: ${difference.explanation}`
  );
  const differenceText = lines.length
    ? lines.join("\n")
    : "По результатам автоматической сверки расхождения не выявлены.";
  return `Здравствуйте!\n\nПросим проверить акт сверки взаимных расчётов с ${counterparty} за период ${periodFrom} — ${periodTo}.\n\nПо нашей сверке:\n${differenceText}\n\nПросим подтвердить данные либо направить пояснения и исправленный акт. При необходимости готовы предоставить подтверждающие документы.\n\nС уважением,\n[организация / ФИО / контакты]`;
}

export function renderActReconciliationReport(result: ActReconciliationExtraction): string {
  const rows = result.differences.map((difference) => {
    const first = compactOperation(
      difference.first_date, difference.first_document, difference.first_description,
      difference.first_amount, difference.currency,
    );
    const second = compactOperation(
      difference.second_date, difference.second_document, difference.second_description,
      difference.second_amount, difference.currency,
    );
    return `| ${LABELS[difference.type]} | ${first} | ${second} | ${safe(difference.explanation)} |`;
  });

  const warningBlock = result.warnings.length
    ? `\n\n### Что проверить вручную\n${result.warnings.map((warning) => `- ${warning}`).join("\n")}`
    : "";
  const differencesBlock = rows.length
    ? `### Найденные расхождения\n\n| Тип | Первый акт | Второй акт | Что не совпало |\n|---|---|---|---|\n${rows.join("\n")}`
    : "### Результат\n\nЯвных расхождений между распознанными операциями не найдено. Перед подписанием проверьте конечное сальдо и полноту периода вручную.";

  return `## Сверка актов\n\n### Загруженные документы\n${result.documents.map(documentLine).join("\n")}\n\nСовпавших операций: **${result.matched_operations_count}**  \nРасхождений: **${result.differences.length}**\n\n${differencesBlock}${warningBlock}\n\n### Проект письма контрагенту\n\n\`\`\`text\n${buildLetter(result)}\n\`\`\`\n\n> Это предварительная автоматическая сверка. Она помогает найти различия, но не заменяет проверку первичных документов и подтверждение сальдо сторонами.`;
}
