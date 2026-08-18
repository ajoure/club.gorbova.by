interface QueueStatementRow {
  uid?: string | null;
  tracking_id?: string | null;
  amount?: number | string | null;
  currency?: string | null;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  card_holder?: string | null;
  card_masked?: string | null;
  description?: string | null;
  status?: string | null;
  transaction_type?: string | null;
  paid_at?: string | null;
  created_at_bepaid?: string | null;
  raw_data?: unknown;
}

export interface QueueEnsureResult {
  action:
    | "inserted"
    | "reactivated"
    | "already_matched"
    | "payment_already_linked"
    | "payment_missing"
    | "not_successful"
    | "not_payment"
    | "soft_cancelled"
    | "already_processing";
  id?: string;
}

function normalizeStatus(rawStatus: string | null | undefined): string {
  const status = String(rawStatus || "").trim().toLowerCase();
  if (!status || status.includes("неуспеш") || status.includes("failed") || status.includes("declin")) {
    return "failed";
  }
  if (["successful", "успешный", "succeeded", "success"].includes(status)) {
    return "succeeded";
  }
  return status;
}

function normalizeTransactionType(rawType: string | null | undefined): string {
  return String(rawType || "payment").trim().toLowerCase().replace(/ё/g, "е");
}

function extractLast4(cardMasked: string | null | undefined): string | null {
  const match = String(cardMasked || "").match(/(\d{4})$/);
  return match?.[1] || null;
}

function extractCardBrand(cardMasked: string | null | undefined): string | null {
  const card = String(cardMasked || "").toLowerCase();
  if (card.includes("visa")) return "visa";
  if (card.includes("master")) return "mastercard";
  if (card.includes("belkart")) return "belkart";
  if (card.includes("мир") || card.includes("mir")) return "mir";
  return null;
}

/**
 * Enqueue a successful bePaid payment only after payments_v2 contains the same
 * provider UID and still has no order. Statement rows by themselves never
 * create deals. This makes CSV import/sync recovery idempotent and prevents a
 * historical statement import from materialising unrelated old rows.
 */
export async function ensureExistingBepaidPaymentQueued(
  supabase: any,
  row: QueueStatementRow,
  source: string,
): Promise<QueueEnsureResult> {
  const uid = String(row.uid || "").trim();
  if (!uid) throw new Error("bePaid UID is required for reconciliation queue");

  if (normalizeStatus(row.status) !== "succeeded") {
    return { action: "not_successful" };
  }

  const transactionType = normalizeTransactionType(row.transaction_type);
  if (
    transactionType.includes("возврат") ||
    transactionType.includes("отмен") ||
    transactionType.includes("refund") ||
    transactionType.includes("void") ||
    transactionType.includes("chargeback")
  ) {
    return { action: "not_payment" };
  }

  const { data: payment, error: paymentError } = await supabase
    .from("payments_v2")
    .select("id,order_id,status,profile_id,user_id")
    .eq("provider", "bepaid")
    .eq("provider_payment_id", uid)
    .maybeSingle();

  if (paymentError) {
    throw new Error(`payment lookup failed for ${uid}: ${paymentError.message}`);
  }
  if (!payment) return { action: "payment_missing" };
  if (payment.order_id) return { action: "payment_already_linked" };

  const { data: existing, error: queueError } = await supabase
    .from("payment_reconcile_queue")
    .select("id,status,matched_order_id,last_error")
    .eq("provider", "bepaid")
    .eq("bepaid_uid", uid)
    .maybeSingle();

  if (queueError) {
    throw new Error(`queue lookup failed for ${uid}: ${queueError.message}`);
  }
  if (existing?.matched_order_id) {
    return { action: "already_matched", id: existing.id };
  }

  const isSoftCancelled =
    ["cancelled", "canceled"].includes(String(existing?.status || "").toLowerCase()) ||
    String(existing?.last_error || "").startsWith("SOFT_CANCELLED") ||
    String(existing?.last_error || "").startsWith("CANCELLED_BY_ADMIN");
  if (isSoftCancelled) {
    return { action: "soft_cancelled", id: existing.id };
  }
  if (existing?.status === "processing") {
    return { action: "already_processing", id: existing.id };
  }

  const amount = row.amount == null ? null : Math.abs(Number(row.amount));
  const payload = {
    tracking_id: row.tracking_id || null,
    amount: Number.isFinite(amount) ? amount : null,
    currency: row.currency || "BYN",
    customer_email: row.email || null,
    customer_name: row.first_name || null,
    customer_surname: row.last_name || null,
    customer_phone: row.phone || null,
    card_holder: row.card_holder || null,
    card_last4: extractLast4(row.card_masked),
    card_brand: extractCardBrand(row.card_masked),
    product_name: row.description || null,
    description: row.description || null,
    raw_payload: row.raw_data || row,
    source,
    status: "pending",
    status_normalized: "succeeded",
    transaction_type: "payment",
    paid_at: row.paid_at || row.created_at_bepaid || null,
    created_at_bepaid: row.created_at_bepaid || null,
    attempts: 0,
    last_error: null,
    next_retry_at: null,
    processed_at: null,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { error: updateError } = await supabase
      .from("payment_reconcile_queue")
      .update(payload)
      .eq("id", existing.id)
      .is("matched_order_id", null);
    if (updateError) {
      throw new Error(`queue reactivation failed for ${uid}: ${updateError.message}`);
    }
    return { action: "reactivated", id: existing.id };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("payment_reconcile_queue")
    .insert({ provider: "bepaid", bepaid_uid: uid, ...payload })
    .select("id")
    .single();
  if (insertError || !inserted) {
    throw new Error(`queue insert failed for ${uid}: ${insertError?.message || "row missing"}`);
  }
  return { action: "inserted", id: inserted.id };
}
