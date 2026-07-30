import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type RequestBody = {
  subscription_ids?: unknown;
  dry_run?: unknown;
};

type ProviderSubscriptionRow = {
  subscription_v2_id: string;
  provider_subscription_id: string;
  state: string;
  last_charge_at: string | null;
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

  const [permission, adminRole, superRole] = await Promise.all([
    admin.rpc("has_permission", {
      _user_id: actor.id,
      _permission: "subscriptions.edit",
    }),
    admin.rpc("has_role_v2", { _user_id: actor.id, _role_code: "admin" }),
    admin.rpc("has_role_v2", { _user_id: actor.id, _role_code: "super_admin" }),
  ]);
  if (![permission.data, adminRole.data, superRole.data].some(Boolean)) {
    return json({ error: "forbidden" }, 403);
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const ids = Array.isArray(body.subscription_ids)
    ? [...new Set(body.subscription_ids.filter((value): value is string =>
      typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value)
    ))]
    : [];
  if (ids.length === 0 || ids.length > 100) {
    return json({ error: "subscription_ids_required_max_100" }, 400);
  }

  const { data: subscriptions, error: subscriptionError } = await admin
    .from("subscriptions_v2")
    .select("id, order_id, auto_renew, canceled_at, status, meta")
    .in("id", ids);
  if (subscriptionError) return json({ error: "subscription_query_failed" }, 500);

  const { data: providerRows, error: providerError } = await admin
    .from("provider_subscriptions")
    .select("subscription_v2_id, provider_subscription_id, state, last_charge_at")
    .in("subscription_v2_id", ids);
  if (providerError) return json({ error: "provider_query_failed" }, 500);

  const { data: installmentRows, error: installmentError } = await admin
    .from("installment_payments")
    .select("subscription_id, status, paid_at, payment_id")
    .in("subscription_id", ids);
  if (installmentError) return json({ error: "installment_query_failed" }, 500);

  const orderIds = (subscriptions ?? []).map((row) => row.order_id).filter(Boolean);
  const { data: successfulPayments, error: paymentError } = orderIds.length
    ? await admin
      .from("payments_v2")
      .select("order_id")
      .in("order_id", orderIds)
      .eq("status", "succeeded")
      .eq("is_deleted", false)
    : { data: [], error: null };
  if (paymentError) return json({ error: "payment_query_failed" }, 500);

  const successfulOrders = new Set((successfulPayments ?? []).map((row) => row.order_id));
  const providerBySubscription = new Map<string, ProviderSubscriptionRow[]>();
  for (const row of (providerRows ?? []) as ProviderSubscriptionRow[]) {
    const current = providerBySubscription.get(row.subscription_v2_id) ?? [];
    current.push(row);
    providerBySubscription.set(row.subscription_v2_id, current);
  }
  const paidInstallments = new Set(
    (installmentRows ?? [])
      .filter((row) =>
        ["succeeded", "paid"].includes(String(row.status).toLowerCase())
        || !!row.paid_at
        || !!row.payment_id
      )
      .map((row) => row.subscription_id),
  );

  const eligible: string[] = [];
  const blocked: Array<{ id: string; reason: string }> = [];
  for (const row of subscriptions ?? []) {
    const providers = providerBySubscription.get(row.id) ?? [];
    const hasCharge = paidInstallments.has(row.id)
      || (!!row.order_id && successfulOrders.has(row.order_id))
      || providers.some((provider) => !!provider.last_charge_at);
    if (row.canceled_at) {
      blocked.push({ id: row.id, reason: "already_canceled" });
    } else if (hasCharge) {
      blocked.push({ id: row.id, reason: "has_successful_payment" });
    } else {
      eligible.push(row.id);
    }
  }

  if (body.dry_run !== false) {
    return json({
      dry_run: true,
      requested: ids.length,
      eligible,
      blocked,
    });
  }

  const canceled: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];
  for (const subscriptionId of eligible) {
    const activeProviderIds = (providerBySubscription.get(subscriptionId) ?? [])
      .filter((row) => !["canceled", "cancelled", "terminated"].includes(row.state))
      .map((row) => row.provider_subscription_id);
    if (activeProviderIds.length > 0) {
      const response = await fetch(`${url}/functions/v1/bepaid-cancel-subscriptions`, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider_subscription_ids: activeProviderIds,
          source: "admin_cancel_unpaid_installment_draft",
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || (Array.isArray(result.failed) && result.failed.length > 0)) {
        failed.push({ id: subscriptionId, reason: "provider_cancel_failed" });
        continue;
      }
    }

    const canceledAt = new Date().toISOString();
    const current = (subscriptions ?? []).find((row) => row.id === subscriptionId);
    const { error } = await admin
      .from("subscriptions_v2")
      .update({
        auto_renew: false,
        canceled_at: canceledAt,
        cancel_at: canceledAt,
        meta: {
          ...((current?.meta as Record<string, unknown> | null) ?? {}),
          unpaid_draft_canceled_at: canceledAt,
          unpaid_draft_canceled_by: actor.id,
        },
      })
      .eq("id", subscriptionId)
      .is("canceled_at", null);
    if (error) {
      failed.push({ id: subscriptionId, reason: "local_cancel_failed" });
    } else {
      canceled.push(subscriptionId);
    }
  }

  await admin.from("audit_logs").insert({
    action: "subscription.unpaid_drafts_cancel",
    actor_type: "admin",
    actor_user_id: actor.id,
    meta: {
      requested_count: ids.length,
      eligible_count: eligible.length,
      canceled_count: canceled.length,
      blocked_count: blocked.length,
      failed_count: failed.length,
    },
  });

  return json({
    success: failed.length === 0,
    canceled,
    blocked,
    failed,
  }, failed.length > 0 ? 409 : 200);
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
