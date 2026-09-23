export type ActDifferenceType =
  | "missing_in_first"
  | "missing_in_second"
  | "amount_mismatch"
  | "date_mismatch"
  | "details_mismatch"
  | "balance_mismatch"
  | "needs_review";

export interface ActDocumentSummary {
  file_name: string | null;
  organization_name: string | null;
  counterparty_name: string | null;
  organization_unp: string | null;
  counterparty_unp: string | null;
  period_from: string | null;
  period_to: string | null;
  opening_balance: string | null;
  closing_balance: string | null;
  currency: string | null;
}

export interface ActDifference {
  type: ActDifferenceType;
  first_date: string | null;
  second_date: string | null;
  first_document: string | null;
  second_document: string | null;
  first_description: string | null;
  second_description: string | null;
  first_amount: string | null;
  second_amount: string | null;
  currency: string | null;
  explanation: string;
}

export interface ActReconciliationExtraction {
  acts_recognized: boolean;
  documents: [ActDocumentSummary, ActDocumentSummary] | [];
  matched_operations_count: number;
  differences: ActDifference[];
  warnings: string[];
}

const DIFFERENCE_TYPES = new Set<ActDifferenceType>([
  "missing_in_first", "missing_in_second", "amount_mismatch", "date_mismatch",
  "details_mismatch", "balance_mismatch", "needs_review",
]);

function nullableText(value: unknown, max = 500): string | null {
  if (value == null) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

function normalizeUnp(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length === 9 ? digits : null;
}

function documentSummary(value: unknown): ActDocumentSummary {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    file_name: nullableText(item.file_name, 240),
    organization_name: nullableText(item.organization_name, 300),
    counterparty_name: nullableText(item.counterparty_name, 300),
    organization_unp: normalizeUnp(item.organization_unp),
    counterparty_unp: normalizeUnp(item.counterparty_unp),
    period_from: nullableText(item.period_from, 40),
    period_to: nullableText(item.period_to, 40),
    opening_balance: nullableText(item.opening_balance, 80),
    closing_balance: nullableText(item.closing_balance, 80),
    currency: nullableText(item.currency, 20),
  };
}

function parseJsonPayload(content: string): Record<string, unknown> {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = (fenced || content).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("ACT_RECONCILIATION_INVALID_JSON");
  const parsed = JSON.parse(candidate.slice(start, end + 1));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("ACT_RECONCILIATION_INVALID_JSON");
  return parsed as Record<string, unknown>;
}

export function parseActReconciliationExtraction(content: string): ActReconciliationExtraction {
  const parsed = parseJsonPayload(content);
  const recognized = parsed.acts_recognized === true;
  const rawDocuments = Array.isArray(parsed.documents) ? parsed.documents : [];
  const documents: ActReconciliationExtraction["documents"] = recognized && rawDocuments.length === 2
    ? [documentSummary(rawDocuments[0]), documentSummary(rawDocuments[1])] as [ActDocumentSummary, ActDocumentSummary]
    : [];
  const rawDifferences = Array.isArray(parsed.differences) ? parsed.differences : [];
  const differences = rawDifferences.slice(0, 300).flatMap((value): ActDifference[] => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    const type = nullableText(item.type, 40) as ActDifferenceType | null;
    const explanation = nullableText(item.explanation, 700);
    if (!type || !DIFFERENCE_TYPES.has(type) || !explanation) return [];
    return [{
      type,
      first_date: nullableText(item.first_date, 40),
      second_date: nullableText(item.second_date, 40),
      first_document: nullableText(item.first_document, 160),
      second_document: nullableText(item.second_document, 160),
      first_description: nullableText(item.first_description, 500),
      second_description: nullableText(item.second_description, 500),
      first_amount: nullableText(item.first_amount, 80),
      second_amount: nullableText(item.second_amount, 80),
      currency: nullableText(item.currency, 20),
      explanation,
    }];
  });
  const warnings = (Array.isArray(parsed.warnings) ? parsed.warnings : [])
    .map((value) => nullableText(value, 500))
    .filter((value): value is string => !!value)
    .slice(0, 20);
  const matched = Number(parsed.matched_operations_count);

  return {
    acts_recognized: recognized && documents.length === 2,
    documents,
    matched_operations_count: Number.isSafeInteger(matched) && matched >= 0 ? matched : 0,
    differences,
    warnings,
  };
}
