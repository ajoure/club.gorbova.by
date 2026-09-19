export type ExtractedBankStatementPayment = {
  date?: string | null;
  time?: string | null;
  amount?: string | number | null;
  currency?: string | null;
  purpose?: string | null;
  recipient_unp?: string | null;
  recipient_name?: string | null;
  recipient_account?: string | null;
  source_ref?: string | null;
};

export type BankStatementExtraction = {
  statement_recognized: boolean;
  payments: ExtractedBankStatementPayment[];
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeUnp(value: unknown): string | null {
  const digits = text(value).replace(/\D/g, "");
  return /^\d{9}$/.test(digits) ? digits : null;
}

/** Parses only the strict JSON contract returned by the extraction model. */
export function parseBankStatementExtraction(raw: string): BankStatementExtraction {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || raw;
  const parsed = JSON.parse(fenced.trim()) as { statement_recognized?: unknown; payments?: unknown };
  const sourcePayments = Array.isArray(parsed.payments) ? parsed.payments : [];

  return {
    statement_recognized: parsed.statement_recognized === true,
    payments: sourcePayments
      .filter((value): value is Record<string, unknown> => !!value && typeof value === "object")
      .map((row) => ({
        date: text(row.date) || null,
        time: text(row.time) || null,
        amount: typeof row.amount === "number" ? row.amount : text(row.amount) || null,
        currency: text(row.currency) || null,
        purpose: text(row.purpose) || null,
        recipient_unp: normalizeUnp(row.recipient_unp),
        recipient_name: text(row.recipient_name) || null,
        recipient_account: text(row.recipient_account) || null,
        source_ref: text(row.source_ref) || null,
      }))
      .filter((row) => row.recipient_unp || row.recipient_name || row.purpose),
  };
}
