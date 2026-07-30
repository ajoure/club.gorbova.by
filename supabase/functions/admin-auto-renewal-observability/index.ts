import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_MESSAGE_TYPES = new Set([
  "subscription_charge_reminder",
  "installment_charge_reminder",
]);
const ALLOWED_CHANNELS = new Set(["telegram", "email"]);
const LEGACY_REMINDER_EVENT_TYPES = [
  "subscription_reminder_7d",
  "subscription_reminder_3d",
  "subscription_reminder_1d",
] as const;
const MAX_SUBSCRIPTIONS = 2_000;
const PAGE_SIZE = 1_000;

type RequestBody = {
  subscription_ids?: unknown;
  days?: unknown;
};

type OutboxRow = {
  channel: string;
  message_type: string;
  status: string;
  blocked_reason: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
  sent_at: string | null;
};

type PaymentAttemptRow = {
  id: string;
  order_id: string | null;
  status: string;
  created_at: string;
  paid_at: string | null;
  error_message: string | null;
  meta: Record<string, unknown> | null;
  provider_response: Record<string, unknown> | null;
};

type ProviderSubscriptionRow = {
  subscription_v2_id: string | null;
  provider_subscription_id: string | null;
  order_id: string | null;
};

type InstallmentPaymentRow = {
  subscription_id: string;
  payment_id: string | null;
  charge_attempts: number | null;
  status: string;
  paid_at: string | null;
  last_attempt_at: string | null;
  error_message: string | null;
};

type LegacyTelegramRow = {
  event_type: string | null;
  status: string;
  error_message: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
};

type LegacyEmailRow = {
  status: string;
  error_message: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
};

type LegacyEmailOutcomeRow = {
  meta: Record<string, unknown> | null;
  created_at: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(url, service);
  const { data: authData, error: authError } = await userClient.auth.getUser();
  const actor = authData?.user;
  if (authError || !actor) return json({ error: "unauthorized" }, 401);

  const roleChecks = await Promise.all(
    ["admin", "super_admin", "manager", "menedzher"].map((role) =>
      admin.rpc("has_role_v2", { _user_id: actor.id, _role_code: role })
    ),
  );
  if (!roleChecks.some((result) => result.data === true)) {
    return json({ error: "forbidden" }, 403);
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }

  const subscriptionIds = Array.isArray(body.subscription_ids)
    ? [...new Set(body.subscription_ids.filter((value): value is string =>
      typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value)
    ))]
    : [];
  if (subscriptionIds.length === 0) return json({ logs: [], attempts: {} });
  if (subscriptionIds.length > MAX_SUBSCRIPTIONS) {
    return json({ error: "too_many_subscription_ids" }, 400);
  }

  const requestedIds = new Set(subscriptionIds);
  const requestedDays = Number(body.days);
  const days = Number.isFinite(requestedDays)
    ? Math.max(1, Math.min(90, Math.floor(requestedDays)))
    : 45;
  const createdAfter = new Date(Date.now() - days * 86_400_000).toISOString();
  const sourceErrors: string[] = [];

  const rows: OutboxRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("notification_outbox")
      .select("channel, message_type, status, blocked_reason, meta, created_at, sent_at")
      .in("channel", [...ALLOWED_CHANNELS])
      .in("message_type", [...ALLOWED_MESSAGE_TYPES])
      .gte("created_at", createdAfter)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error("[admin-auto-renewal-observability] outbox query failed", {
        code: error.code,
      });
      return json({ error: "outbox_query_failed" }, 500);
    }
    const page = (data ?? []) as OutboxRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  const logs: Array<Record<string, unknown>> = rows.flatMap((row) => {
    const meta = row.meta ?? {};
    const subscriptionId = typeof meta.subscription_v2_id === "string"
      ? meta.subscription_v2_id
      : "";
    if (!requestedIds.has(subscriptionId)) return [];

    const daysBefore = Number(meta.days_before);
    return [{
      channel: row.channel,
      subscription_id: subscriptionId,
      event_type: Number.isFinite(daysBefore)
        ? `subscription_reminder_${daysBefore}d`
        : "",
      days_before: Number.isFinite(daysBefore) ? daysBefore : null,
      effective_charge_at: typeof meta.effective_charge_at === "string"
        ? meta.effective_charge_at
        : null,
      status: row.status,
      reason: row.blocked_reason ??
        (typeof meta.reason === "string" ? meta.reason : null),
      error_message: typeof meta.error_message === "string"
        ? meta.error_message
        : null,
      created_at: row.sent_at ?? row.created_at,
    }];
  });

  // The legacy renewal worker is still the production delivery path for part
  // of the installed base. It records the real Telegram/email outcomes in
  // telegram_logs, email_logs and audit_logs. Merge those outcomes with the
  // new outbox so the admin indicators reflect actual delivery instead of
  // showing grey dots for successfully delivered reminders.
  const legacyTelegramRows: LegacyTelegramRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("telegram_logs")
      .select("event_type, status, error_message, meta, created_at")
      .in("event_type", [...LEGACY_REMINDER_EVENT_TYPES])
      .gte("created_at", createdAfter)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error("[admin-auto-renewal-observability] telegram log query failed", {
        code: error.code,
      });
      sourceErrors.push("telegram_logs");
      break;
    }
    const page = (data ?? []) as LegacyTelegramRow[];
    legacyTelegramRows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  for (const row of legacyTelegramRows) {
    const meta = row.meta ?? {};
    const subscriptionId = typeof meta.subscription_id === "string"
      ? meta.subscription_id
      : "";
    if (!requestedIds.has(subscriptionId) || !row.event_type) continue;
    const daysBefore = Number(meta.days_left ?? row.event_type.match(/_(\d+)d$/)?.[1]);
    logs.push({
      channel: "telegram",
      subscription_id: subscriptionId,
      event_type: row.event_type,
      days_before: Number.isFinite(daysBefore) ? daysBefore : null,
      effective_charge_at: null,
      status: row.status,
      reason: typeof meta.reason === "string" ? meta.reason : null,
      error_message: row.error_message,
      created_at: row.created_at,
    });
  }

  const legacyEmailRows: LegacyEmailRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("email_logs")
      .select("status, error_message, meta, created_at")
      .in("meta->>event_type", [...LEGACY_REMINDER_EVENT_TYPES])
      .gte("created_at", createdAfter)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error("[admin-auto-renewal-observability] email log query failed", {
        code: error.code,
      });
      sourceErrors.push("email_logs");
      break;
    }
    const page = (data ?? []) as LegacyEmailRow[];
    legacyEmailRows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  for (const row of legacyEmailRows) {
    const meta = row.meta ?? {};
    const subscriptionId = typeof meta.subscription_id === "string"
      ? meta.subscription_id
      : "";
    const eventType = typeof meta.event_type === "string" ? meta.event_type : "";
    if (!requestedIds.has(subscriptionId) || !eventType) continue;
    const daysBefore = Number(meta.days_left ?? eventType.match(/_(\d+)d$/)?.[1]);
    logs.push({
      channel: "email",
      subscription_id: subscriptionId,
      event_type: eventType,
      days_before: Number.isFinite(daysBefore) ? daysBefore : null,
      effective_charge_at: null,
      status: row.status,
      reason: typeof meta.reason === "string" ? meta.reason : null,
      error_message: row.error_message,
      created_at: row.created_at,
    });
  }

  const legacyEmailOutcomeRows: LegacyEmailOutcomeRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    // audit_logs has no index on meta json paths; filtering channel/event_type
    // in SQL forces a full filtered scan and hits statement_timeout (57014).
    // Keep only the indexed created_at bound plus actor_label and narrow the
    // rest in memory.
    const { data, error } = await admin
      .from("audit_logs")
      .select("meta, created_at")
      .eq("actor_label", "subscription-renewal-reminders")
      .gte("created_at", createdAfter)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error("[admin-auto-renewal-observability] email outcome query failed", {
        code: error.code,
      });
      sourceErrors.push("audit_logs");
      break;
    }
    const page = (data ?? []) as LegacyEmailOutcomeRow[];
    legacyEmailOutcomeRows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  for (const row of legacyEmailOutcomeRows) {
    const meta = row.meta ?? {};
    if (meta.channel !== "email") continue;
    const subscriptionId = typeof meta.subscription_id === "string"
      ? meta.subscription_id
      : "";
    const eventType = typeof meta.event_type === "string" ? meta.event_type : "";
    if (!LEGACY_REMINDER_EVENT_TYPES.includes(eventType as never)) continue;
    if (!requestedIds.has(subscriptionId) || !eventType) continue;
    const daysBefore = Number(meta.days_left ?? eventType.match(/_(\d+)d$/)?.[1]);
    logs.push({
      channel: "email",
      subscription_id: subscriptionId,
      event_type: eventType,
      days_before: Number.isFinite(daysBefore) ? daysBefore : null,
      effective_charge_at: null,
      status: typeof meta.status === "string" ? meta.status : "pending",
      reason: typeof meta.reason === "string" ? meta.reason : null,
      error_message: typeof meta.error_message === "string" ? meta.error_message : null,
      created_at: row.created_at,
    });
  }

  const { data: subscriptionRows, error: subscriptionError } = await admin
    .from("subscriptions_v2")
    .select("id, order_id, charge_attempts")
    .in("id", subscriptionIds);
  if (subscriptionError) {
    console.error("[admin-auto-renewal-observability] subscription query failed", {
      code: subscriptionError.code,
    });
    return json({ error: "subscription_query_failed" }, 500);
  }

  const subscriptionByOrder = new Map<string, string>();
  const currentAttemptsBySubscription = new Map<string, number>();
  for (const row of subscriptionRows ?? []) {
    if (row.order_id) subscriptionByOrder.set(row.order_id, row.id);
    currentAttemptsBySubscription.set(row.id, Number(row.charge_attempts || 0));
  }

  const { data: providerRowsData, error: providerRowsError } = await admin
    .from("provider_subscriptions")
    .select("subscription_v2_id, provider_subscription_id, order_id")
    .in("subscription_v2_id", subscriptionIds);
  if (providerRowsError) {
    console.error("[admin-auto-renewal-observability] provider subscriptions query failed", {
      code: providerRowsError.code,
    });
    sourceErrors.push("provider_subscriptions");
  }
  const providerRows = (providerRowsData ?? []) as ProviderSubscriptionRow[];
  const subscriptionByProviderId = new Map<string, string>();
  for (const row of providerRows) {
    if (!row.subscription_v2_id || !requestedIds.has(row.subscription_v2_id)) continue;
    if (row.provider_subscription_id) {
      subscriptionByProviderId.set(row.provider_subscription_id, row.subscription_v2_id);
    }
    if (row.order_id) subscriptionByOrder.set(row.order_id, row.subscription_v2_id);
  }

  const installmentRows: InstallmentPaymentRow[] = [];
  for (let offset = 0; offset < subscriptionIds.length; offset += 200) {
    const chunk = subscriptionIds.slice(offset, offset + 200);
    const { data, error } = await admin
      .from("installment_payments")
      .select("subscription_id, payment_id, charge_attempts, status, paid_at, last_attempt_at, error_message")
      .in("subscription_id", chunk);
    if (error) {
      console.error("[admin-auto-renewal-observability] installment payments query failed", {
        code: error.code,
      });
      sourceErrors.push("installment_payments");
      break;
    }
    installmentRows.push(...((data ?? []) as InstallmentPaymentRow[]));
  }
  const subscriptionByPaymentId = new Map<string, string>();
  for (const row of installmentRows) {
    if (row.payment_id) subscriptionByPaymentId.set(row.payment_id, row.subscription_id);
  }

  const payments: PaymentAttemptRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("payments_v2")
      .select("id, order_id, status, created_at, paid_at, error_message, meta, provider_response")
      .eq("is_deleted", false)
      .gte("created_at", createdAfter)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error("[admin-auto-renewal-observability] attempts query failed", {
        code: error.code,
      });
      return json({ error: "attempts_query_failed" }, 500);
    }
    const page = (data ?? []) as PaymentAttemptRow[];
    payments.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  const attempts: Record<string, {
    total_attempts: number;
    successful_attempts: number;
    failed_attempts: number;
    last_attempt_at: string | null;
    last_attempt_success: boolean | null;
    last_attempt_error: string | null;
    current_attempts: number;
  }> = {};
  const countedPaymentIds = new Set<string>();
  const ensureAttempt = (subscriptionId: string) => {
    const entry = attempts[subscriptionId] ?? {
      total_attempts: 0,
      successful_attempts: 0,
      failed_attempts: 0,
      last_attempt_at: null,
      last_attempt_success: null,
      last_attempt_error: null,
      current_attempts: currentAttemptsBySubscription.get(subscriptionId) || 0,
    };
    attempts[subscriptionId] = entry;
    return entry;
  };

  for (const row of installmentRows) {
    if (!requestedIds.has(row.subscription_id)) continue;
    const entry = ensureAttempt(row.subscription_id);
    const status = String(row.status ?? "").toLowerCase();
    const succeeded = ["succeeded", "paid"].includes(status);
    const failedAttempts = Math.max(0, Number(row.charge_attempts || 0));
    entry.successful_attempts += succeeded ? 1 : 0;
    entry.failed_attempts += failedAttempts;
    entry.total_attempts += (succeeded ? 1 : 0) + failedAttempts;
    entry.current_attempts = Math.max(entry.current_attempts, failedAttempts);
    const attemptAt = row.paid_at ?? row.last_attempt_at;
    if (attemptAt && (!entry.last_attempt_at || Date.parse(attemptAt) > Date.parse(entry.last_attempt_at))) {
      entry.last_attempt_at = attemptAt;
      entry.last_attempt_success = succeeded ? true : failedAttempts > 0 ? false : null;
      entry.last_attempt_error = failedAttempts > 0 ? row.error_message : null;
    }
    if (row.payment_id) countedPaymentIds.add(row.payment_id);
  }

  for (const payment of payments) {
    if (countedPaymentIds.has(payment.id)) continue;
    const meta = payment.meta ?? {};
    const providerResponse = payment.provider_response ?? {};
    const directSubscriptionId = [
      meta.subscription_v2_id,
      meta.subscription_id,
      providerResponse.subscription_v2_id,
    ].find((value) => typeof value === "string" && requestedIds.has(value as string));
    const providerSubscriptionId = [
      meta.bepaid_subscription_id,
      meta.provider_subscription_id,
      providerResponse.subscription_id,
      providerResponse.provider_subscription_id,
    ].find((value) => typeof value === "string");
    const subscriptionId = (directSubscriptionId as string | undefined)
      ?? subscriptionByPaymentId.get(payment.id)
      ?? (payment.order_id ? subscriptionByOrder.get(payment.order_id) : undefined)
      ?? (providerSubscriptionId
        ? subscriptionByProviderId.get(providerSubscriptionId as string)
        : undefined);
    if (!subscriptionId) continue;
    const entry = ensureAttempt(subscriptionId);
    const status = String(payment.status ?? "").toLowerCase();
    const succeeded = status === "succeeded";
    const failed = ["failed", "error", "declined", "canceled", "cancelled"].includes(status);
    if (succeeded || failed) entry.total_attempts += 1;
    if (succeeded) entry.successful_attempts += 1;
    if (failed) entry.failed_attempts += 1;
    const attemptAt = payment.paid_at ?? payment.created_at;
    if (!entry.last_attempt_at || Date.parse(attemptAt) > Date.parse(entry.last_attempt_at)) {
      entry.last_attempt_at = attemptAt;
      entry.last_attempt_success = succeeded ? true : failed ? false : null;
      entry.last_attempt_error = failed ? payment.error_message : null;
    }
  }

  for (const subscriptionId of subscriptionIds) ensureAttempt(subscriptionId);

  return json({
    logs,
    attempts,
    source_errors: sourceErrors,
    requested: subscriptionIds.length,
    window_days: days,
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
