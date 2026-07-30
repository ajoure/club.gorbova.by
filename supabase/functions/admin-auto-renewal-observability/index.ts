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
  order_id: string | null;
  status: string;
  created_at: string;
  paid_at: string | null;
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
      return json({ error: "telegram_log_query_failed" }, 500);
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
      return json({ error: "email_log_query_failed" }, 500);
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
    const { data, error } = await admin
      .from("audit_logs")
      .select("meta, created_at")
      .eq("actor_label", "subscription-renewal-reminders")
      .eq("meta->>channel", "email")
      .in("meta->>event_type", [...LEGACY_REMINDER_EVENT_TYPES])
      .gte("created_at", createdAfter)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error("[admin-auto-renewal-observability] email outcome query failed", {
        code: error.code,
      });
      return json({ error: "email_outcome_query_failed" }, 500);
    }
    const page = (data ?? []) as LegacyEmailOutcomeRow[];
    legacyEmailOutcomeRows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  for (const row of legacyEmailOutcomeRows) {
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
      status: typeof meta.status === "string" ? meta.status : "pending",
      reason: typeof meta.reason === "string" ? meta.reason : null,
      error_message: typeof meta.error_message === "string" ? meta.error_message : null,
      created_at: row.created_at,
    });
  }

  const { data: subscriptionRows, error: subscriptionError } = await admin
    .from("subscriptions_v2")
    .select("id, order_id")
    .in("id", subscriptionIds);
  if (subscriptionError) {
    console.error("[admin-auto-renewal-observability] subscription query failed", {
      code: subscriptionError.code,
    });
    return json({ error: "subscription_query_failed" }, 500);
  }

  const subscriptionByOrder = new Map<string, string>();
  for (const row of subscriptionRows ?? []) {
    if (row.order_id) subscriptionByOrder.set(row.order_id, row.id);
  }
  const orderIds = [...subscriptionByOrder.keys()];
  const payments: PaymentAttemptRow[] = [];
  for (let offset = 0; offset < orderIds.length; offset += 200) {
    const chunk = orderIds.slice(offset, offset + 200);
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await admin
        .from("payments_v2")
        .select("order_id, status, created_at, paid_at, error_message")
        .in("order_id", chunk)
        .eq("is_deleted", false)
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
  }

  const attempts: Record<string, {
    total_attempts: number;
    successful_attempts: number;
    failed_attempts: number;
    last_attempt_at: string | null;
    last_attempt_success: boolean | null;
    last_attempt_error: string | null;
  }> = {};
  for (const payment of payments) {
    const subscriptionId = payment.order_id
      ? subscriptionByOrder.get(payment.order_id)
      : null;
    if (!subscriptionId) continue;
    const entry = attempts[subscriptionId] ?? {
      total_attempts: 0,
      successful_attempts: 0,
      failed_attempts: 0,
      last_attempt_at: null,
      last_attempt_success: null,
      last_attempt_error: null,
    };
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
    attempts[subscriptionId] = entry;
  }

  return json({
    logs,
    attempts,
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
