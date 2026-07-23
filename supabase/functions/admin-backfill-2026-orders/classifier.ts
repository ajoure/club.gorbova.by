function isSaleTransaction(value: unknown): boolean {
  if (value == null) return true;
  const normalized = String(value).trim().toLowerCase();
  return [
    "payment",
    "subscription",
    "оплата",
    "платеж",
    "платёж",
    "рекуррентная транзакция",
  ].includes(normalized);
}

export function classifyPayment(payment: any): string | null {
  if (payment.status !== "succeeded") return "payment_not_succeeded";
  if (!(Number(payment.amount) > 0)) return "non_positive_amount";
  if (!payment.paid_at || Number.isNaN(Date.parse(payment.paid_at))) {
    return "paid_at_missing_or_invalid";
  }
  if (!["bepaid", "stripe"].includes(String(payment.provider || "").toLowerCase())) {
    return "unsupported_provider";
  }
  const meta = payment.meta || {};
  const source = String(meta.source || "").toLowerCase();
  const description = String(meta.description || "").toLowerCase();
  const transactionType =
    meta.transaction_type ?? payment.provider_response?.transaction_type ?? null;

  if (!isSaleTransaction(transactionType)) return "non_sale_transaction";
  if (
    meta.is_test === true ||
    meta.fixture === true ||
    source.includes("test") ||
    source.includes("synthetic")
  ) return "test_or_synthetic";
  if (
    source.includes("admin_manual") ||
    source.includes("manual_payment") ||
    description.includes("комисси") ||
    description.includes("возврат") ||
    description.includes("отмена")
  ) return "manual_or_non_sale_source";
  return null;
}
