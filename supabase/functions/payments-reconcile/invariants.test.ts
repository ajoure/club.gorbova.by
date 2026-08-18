import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(
  new URL("./index.ts", import.meta.url),
);
const autoProcessSource = await Deno.readTextFile(
  new URL("../bepaid-auto-process/index.ts", import.meta.url),
);
const queueCronSource = await Deno.readTextFile(
  new URL("../bepaid-queue-cron/index.ts", import.meta.url),
);
const fetchTransactionsSource = await Deno.readTextFile(
  new URL("../bepaid-fetch-transactions/index.ts", import.meta.url),
);
const statementSyncSource = await Deno.readTextFile(
  new URL("../sync-payments-with-statement/index.ts", import.meta.url),
);
const statementImportSource = await Deno.readTextFile(
  new URL("../admin-import-bepaid-statement-csv/index.ts", import.meta.url),
);
const statementQueueSource = await Deno.readTextFile(
  new URL("../_shared/bepaid-reconcile-queue.ts", import.meta.url),
);
const statementUiSource = await Deno.readTextFile(
  new URL(
    "../../../src/components/admin/payments/BepaidStatementTabContent.tsx",
    import.meta.url,
  ),
);
const processQueueItemSource = source.slice(
  source.indexOf("async function processQueueItem"),
  source.indexOf("// Process legacy orders"),
);

Deno.test("recurring bePaid tracking IDs use the shared parser", () => {
  assertStringIncludes(
    source,
    "parseBepaidTrackingId(item.tracking_id).orderId",
  );
  assert(!source.includes("item.tracking_id.split('_')"));
});

Deno.test("queue completion is blocked until payments_v2 is persisted", () => {
  const writer = processQueueItemSource.indexOf(
    '.from("payments_v2")\n      .insert(paymentRow)',
  );
  const verification = processQueueItemSource.indexOf(
    "`payments_v2 verification failed: ${",
  );
  const completion = processQueueItemSource.indexOf(
    '.update({\n      status: "completed"',
  );

  assert(writer >= 0, "canonical payments_v2 insert is required");
  assert(
    verification > writer,
    "persistence verification must follow the write",
  );
  assert(
    completion > verification,
    "queue may complete only after persistence verification",
  );
});

Deno.test("payment reconciliation avoids partial-index ON CONFLICT", () => {
  assert(!source.includes('onConflict: "provider,provider_payment_id"'));
  assert(
    !autoProcessSource.includes("onConflict: 'provider,provider_payment_id'"),
  );
  assertStringIncludes(source, 'paymentInsertError.code !== "23505"');
  assertStringIncludes(source, "persistedPayment.order_id !== order.id");
});

Deno.test("payment reconciliation treats access grant failures as retryable", () => {
  assertStringIncludes(source, "grant-access-for-order failed for order");
  assertStringIncludes(source, "grantResult?.success !== true");
  assertStringIncludes(source, "orders_v2 paid transition failed for order");
  assertStringIncludes(source, "payment_reconcile_queue completion failed:");
  const grant = processQueueItemSource.indexOf(
    "await fixOrderAndCreateSubscription(supabase, order",
  );
  const completion = processQueueItemSource.indexOf(
    '.update({\n      status: "completed"',
  );
  assert(grant >= 0, "canonical fulfillment must be awaited");
  assert(
    completion > grant,
    "queue completion must follow a verified access grant",
  );
});

Deno.test("bePaid transaction lookup sends exactly one Basic auth prefix", () => {
  assertStringIncludes(source, "Authorization: auth");
  assert(!source.includes("Authorization: `Basic ${auth}`"));
});

Deno.test("bePaid auto-process verifies payments_v2 before completing queue", () => {
  assertStringIncludes(autoProcessSource, "await ensureCanonicalPayment(");
  assertStringIncludes(autoProcessSource, "payments_v2 verification failed:");
  assertStringIncludes(autoProcessSource, '.is("order_id", null)');
  assertStringIncludes(
    autoProcessSource,
    "exists without order; continuing canonical reconciliation",
  );
  assert(
    !autoProcessSource.includes("await supabase.from('payments_v2').insert({"),
  );
});

Deno.test("bePaid auto-process requires canonical access before queue completion", () => {
  assertStringIncludes(
    autoProcessSource,
    "async function grantCanonicalAccess(",
  );
  assertStringIncludes(autoProcessSource, "data.success !== true");
  const grant = autoProcessSource.indexOf(
    "await grantCanonicalAccess(supabase, newOrder.id",
  );
  const completion = autoProcessSource.indexOf(
    "matched_order_id: newOrder.id",
    grant,
  );
  assert(grant >= 0, "new orders must invoke the canonical access writer");
  assert(
    completion > grant,
    "queue completion must follow successful access grant",
  );
});

Deno.test("recurring recovery resolves catalog from subscriptions_v2", () => {
  assertStringIncludes(
    autoProcessSource,
    "parseBepaidTrackingId(item.tracking_id)",
  );
  assertStringIncludes(autoProcessSource, ".from('subscriptions_v2')");
  assertStringIncludes(autoProcessSource, "resolved_from_subscriptions_v2");
  assertStringIncludes(
    autoProcessSource,
    "matchedBy = 'subscription_tracking_id'",
  );
});

Deno.test("bePaid recovery writer stays aligned with production schema", () => {
  const canonicalWriter = autoProcessSource.slice(
    autoProcessSource.indexOf("async function ensureCanonicalPayment"),
    autoProcessSource.indexOf("// Transliterate Latin name"),
  );
  assert(!canonicalWriter.includes("payment_method:"));
  assert(!autoProcessSource.includes(".eq('tracking_id', item.tracking_id)"));
  assertStringIncludes(
    autoProcessSource,
    ".eq('meta->>tracking_id', item.tracking_id)",
  );
});

Deno.test("queue cron forwards its internal credential and supports exact recovery", () => {
  assertStringIncludes(
    queueCronSource,
    'headers: { "x-internal-key": cronSecret }',
  );
  assertStringIncludes(queueCronSource, 'query = query.eq("id", queueItemId)');
  assertStringIncludes(queueCronSource, "queueItemId ? 1 : batchSize");
});

Deno.test("queue cron does not treat unresolved skips as success", () => {
  assert(!queueCronSource.includes("processResult?.results?.skipped > 0"));
  assertStringIncludes(
    queueCronSource,
    "processResult?.results?.orders_reconciled > 0",
  );
});

Deno.test("bePaid imports enqueue successful orphan payments for reconciliation", () => {
  assertStringIncludes(
    fetchTransactionsSource,
    "async function ensureReconcileQueueItem(",
  );
  assertStringIncludes(
    fetchTransactionsSource,
    "existing_payment_without_order",
  );
  assertStringIncludes(fetchTransactionsSource, "orphan_payments_requeued");
  assertStringIncludes(fetchTransactionsSource, 'status: "pending"');
  assertStringIncludes(fetchTransactionsSource, 'startsWith("SOFT_CANCELLED")');
  assertStringIncludes(
    fetchTransactionsSource,
    'startsWith("CANCELLED_BY_ADMIN")',
  );
  assertStringIncludes(
    fetchTransactionsSource,
    'existing?.status === "processing"',
  );
});

Deno.test("statement recovery only queues an existing unlinked payment", () => {
  assertStringIncludes(statementQueueSource, '.from("payments_v2")');
  assertStringIncludes(
    statementQueueSource,
    'if (!payment) return { action: "payment_missing" }',
  );
  assertStringIncludes(
    statementQueueSource,
    'if (payment.order_id) return { action: "payment_already_linked" }',
  );
  assertStringIncludes(statementQueueSource, 'startsWith("SOFT_CANCELLED")');
  assertStringIncludes(
    statementQueueSource,
    'startsWith("CANCELLED_BY_ADMIN")',
  );
  assertStringIncludes(
    statementQueueSource,
    'existing?.status === "processing"',
  );
});

Deno.test("CSV import and statement sync enqueue successful orphan payments", () => {
  assertStringIncludes(
    statementImportSource,
    "ensureExistingBepaidPaymentQueued(",
  );
  assertStringIncludes(statementImportSource, '"bepaid_csv_existing_payment"');
  assertStringIncludes(
    statementSyncSource,
    "ensureExistingBepaidPaymentQueued(",
  );
  assertStringIncludes(
    statementSyncSource,
    '"statement_sync_existing_payment"',
  );
  assertStringIncludes(statementSyncSource, '"statement_sync_new_payment"');
  assertStringIncludes(statementSyncSource, '"statement_sync_updated_payment"');
});

Deno.test("bePaid statement defaults to the full current year", () => {
  assertStringIncludes(statementUiSource, "startOfYear(nowMinsk)");
  assertStringIncludes(statementUiSource, "endOfYear(nowMinsk)");
  assert(!statementUiSource.includes("startOfMonth(nowMinsk)"));
});
