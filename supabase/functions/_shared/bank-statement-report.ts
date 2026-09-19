export type BankStatementReportOutcome = "match" | "mismatch" | "needs_review" | "not_found" | "unavailable";

export type BankStatementReportRow = {
  date?: string | null;
  time?: string | null;
  amount?: string | number | null;
  currency?: string | null;
  purpose?: string | null;
  recipient_unp?: string | null;
  recipient_name?: string | null;
  recipient_account?: string | null;
  source_ref?: string | null;
  official_name?: string | null;
  outcome: BankStatementReportOutcome;
};

function cleanCell(value: unknown, fallback = "—"): string {
  const rendered = value === null || value === undefined ? "" : String(value).trim();
  return rendered ? rendered.replace(/\|/g, "\\|").replace(/\n+/g, " ") : fallback;
}

/**
 * The report deliberately presents a discrepancy as a reconciliation signal,
 * never as an assertion about the payer or recipient.
 */
export function renderBankStatementReport(rows: BankStatementReportRow[]): string {
  const mismatches = rows.filter((row) => row.outcome === "mismatch");
  const review = rows.filter((row) => row.outcome === "needs_review" || row.outcome === "not_found");
  const unavailable = rows.filter((row) => row.outcome === "unavailable");
  const lines = [
    "### Анализ выписки",
    `Проверено платежей: **${rows.length}**. Несовпадений: **${mismatches.length}**. Нужна ручная проверка: **${review.length}**. МНС временно недоступен: **${unavailable.length}**.`,
    "",
  ];

  if (!rows.length) {
    lines.push("Исходящие платежи в распознанной выписке не найдены. Если они должны быть в файле, проверьте период и экспорт выписки.");
  } else if (!mismatches.length) {
    lines.push("Несовпадений между названием получателя в выписке и официальным названием по УНП не найдено.");
  } else {
    lines.push("#### Несовпадения", "", "| Дата и время | Сумма | Название в выписке | УНП | Официальное название МНС | Назначение / реквизиты / строка |", "|---|---:|---|---|---|---|");
    for (const row of mismatches) {
      lines.push(`| ${cleanCell([row.date, row.time].filter(Boolean).join(" "))} | ${cleanCell([row.amount, row.currency].filter(Boolean).join(" "))} | ${cleanCell(row.recipient_name)} | ${cleanCell(row.recipient_unp)} | ${cleanCell(row.official_name)} | ${cleanCell([row.purpose, row.recipient_account, row.source_ref].filter(Boolean).join("; "))} |`);
    }
  }

  if (review.length) {
    lines.push("", "#### Требует ручной проверки", "", "| Дата и время | Сумма | УНП | Реквизиты / причина |", "|---|---:|---|---|");
    for (const row of review) {
      const reason = row.outcome === "not_found"
        ? "МНС не вернул плательщика по указанному УНП"
        : `В выписке нет или неполно распознано название получателя; МНС: ${cleanCell(row.official_name)}`;
      lines.push(`| ${cleanCell([row.date, row.time].filter(Boolean).join(" "))} | ${cleanCell([row.amount, row.currency].filter(Boolean).join(" "))} | ${cleanCell(row.recipient_unp)} | ${cleanCell([row.purpose, row.recipient_account, row.source_ref, reason].filter(Boolean).join("; "))} |`);
    }
  }

  lines.push("", "Это контроль совпадения реквизитов, а не вывод о нарушении. Перед решением проверьте первичный платёжный документ.");
  return lines.join("\n");
}
