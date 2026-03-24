import { createClient } from "npm:@supabase/supabase-js@2";
import { getBepaidCredsStrict, createBepaidAuthHeader, isBepaidCredsError } from "../_shared/bepaid-credentials.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeState(raw: string | null | undefined): string {
  const s = String(raw || "").toLowerCase().trim();
  if (s === "cancelled") return "canceled";
  if (!s) return "unknown";
  return s;
}

interface BackfillParams {
  dry_run: boolean;
  limit: number;
  status: "active" | "all";
  sbs_ids?: string[];
}

interface BackfillResult {
  dry_run: boolean;
  mode: "by_ids" | "full_list";
  api_total: number;
  api_active: number;
  db_active_before: number;
  missing_ids: string[];
  inserted: number;
  updated: number;
  linked_to_sub_v2: number;
  errors: Array<{ sbs_id: string; reason: string }>;
  duration_ms: number;
}

interface BepaidSub {
  id: string;
  state?: string;
  status?: string;
  plan?: {
    amount?: number;
    currency?: string;
    title?: string;
    interval?: string;
  };
  created_at?: string;
  next_billing_at?: string;
  credit_card?: {
    last_4?: string;
    brand?: string;
    token?: string;
  };
  customer?: {
    email?: string;
  };
  cancellation_capability?: string;
  tracking_id?: string;
}

async function fetchSubscriptionById(
  id: string,
  authHeader: string
): Promise<{ data: BepaidSub | null; error?: string }> {
  const hosts = ["api.bepaid.by"];
  for (const host of hosts) {
    try {
      const resp = await fetch(`https://${host}/subscriptions/${id}`, {
        headers: { Authorization: authHeader, Accept: "application/json" },
      });
      if (!resp.ok) {
        const text = await resp.text();
        return { data: null, error: `HTTP ${resp.status}: ${text.slice(0, 100)}` };
      }
      const body = await resp.json();
      const sub = body?.subscription || body;
      if (sub?.id) return { data: sub };
      return { data: null, error: "Empty response" };
    } catch (e) {
      return { data: null, error: String(e).slice(0, 100) };
    }
  }
  return { data: null, error: "No hosts available" };
}

async function fetchAllSubscriptions(
  authHeader: string,
  maxPages: number
): Promise<{ items: BepaidSub[]; error?: string }> {
  const allItems: BepaidSub[] = [];
  const seenIds = new Set<string>();

  for (let page = 1; page <= maxPages; page++) {
    try {
      const resp = await fetch(
        `https://api.bepaid.by/subscriptions?page=${page}&per_page=50`,
        { headers: { Authorization: authHeader, Accept: "application/json" } }
      );
      if (!resp.ok) {
        const text = await resp.text();
        return { items: allItems, error: `HTTP ${resp.status} on page ${page}: ${text.slice(0, 80)}` };
      }
      const body = await resp.json();
      const subs: BepaidSub[] = body?.subscriptions || body?.data || [];
      if (!Array.isArray(subs) || subs.length === 0) break;

      for (const sub of subs) {
        if (sub?.id && !seenIds.has(sub.id)) {
          seenIds.add(sub.id);
          allItems.push(sub);
        }
      }
      if (subs.length < 50) break;
    } catch (e) {
      return { items: allItems, error: `Page ${page}: ${String(e).slice(0, 80)}` };
    }
  }
  return { items: allItems };
}

function buildProviderSubRecord(sub: BepaidSub) {
  const state = normalizeState(sub.state || sub.status);
  const snapshot = {
    id: sub.id,
    state: sub.state || sub.status,
    plan: sub.plan ? { amount: sub.plan.amount, currency: sub.plan.currency, title: sub.plan.title } : null,
    next_billing_at: sub.next_billing_at,
    created_at: sub.created_at,
    cancellation_capability: sub.cancellation_capability,
  };
  return {
    provider: "bepaid",
    provider_subscription_id: sub.id,
    state,
    next_charge_at: sub.next_billing_at || null,
    card_last4: sub.credit_card?.last_4 || null,
    card_brand: sub.credit_card?.brand || null,
    amount_cents: sub.plan?.amount || null,
    currency: sub.plan?.currency || null,
    meta: {
      snapshot,
      snapshot_at: new Date().toISOString(),
      cancellation_capability: sub.cancellation_capability,
      backfilled: true,
    },
  };
}

/**
 * PATCH-4: Resolve user_id for a bePaid subscription
 * Chain: tracking_id parse → subscription_v2_id → orders_v2
 */
async function resolveUserIdForSub(
  supabase: any,
  sub: BepaidSub
): Promise<string | null> {
  // 1. Try tracking_id parse: format "subv2:{sub_v2_id}:order:{order_id}"
  const trackingId = sub.tracking_id || (sub as any).tracking_id;
  if (trackingId && typeof trackingId === "string") {
    const orderMatch = trackingId.match(/order:([0-9a-f-]{36})/i);
    if (orderMatch) {
      const { data: order } = await supabase
        .from("orders_v2")
        .select("user_id")
        .eq("id", orderMatch[1])
        .maybeSingle();
      if (order?.user_id) return order.user_id;
    }
    const subV2Match = trackingId.match(/subv2:([0-9a-f-]{36})/i);
    if (subV2Match) {
      const { data: sv2 } = await supabase
        .from("subscriptions_v2")
        .select("user_id")
        .eq("id", subV2Match[1])
        .maybeSingle();
      if (sv2?.user_id) return sv2.user_id;
    }
  }

  // 2. No tracking_id — can't resolve without subscription_v2_id link (set after insert via linkage)
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const started = Date.now();

  try {
    // Auth
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await anonClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // RBAC: has_role_v2 with canonical super_admin
    const [{ data: isAdmin }, { data: isSuperAdmin }] = await Promise.all([
      serviceClient.rpc("has_role_v2", { _user_id: user.id, _role_code: "admin" }),
      serviceClient.rpc("has_role_v2", { _user_id: user.id, _role_code: "super_admin" }),
    ]);
    if (!isAdmin && !isSuperAdmin) {
      return json({ error: "Forbidden: admin or super_admin required" }, 403);
    }

    // Params
    const body = await req.json().catch(() => ({}));
    const params: BackfillParams = {
      dry_run: body.dry_run !== false,
      limit: Math.min(Number(body.limit) || 500, 500),
      status: body.status === "all" ? "all" : "active",
      sbs_ids: Array.isArray(body.sbs_ids) ? body.sbs_ids.filter((s: unknown) => typeof s === "string" && String(s).startsWith("sbs_")) : undefined,
    };

    // Get bePaid credentials
    const creds = await getBepaidCredsStrict(serviceClient);
    if (isBepaidCredsError(creds)) {
      return json({ error: creds.error }, 500);
    }
    const bepaidAuth = createBepaidAuthHeader(creds);

    // Get current DB state
    const { data: existingRows } = await serviceClient
      .from("provider_subscriptions")
      .select("provider_subscription_id, state, subscription_v2_id")
      .like("provider_subscription_id", "sbs_%");

    const existingMap = new Map<string, { state: string; subscription_v2_id: string | null }>();
    for (const r of existingRows || []) {
      existingMap.set(r.provider_subscription_id, { state: r.state, subscription_v2_id: r.subscription_v2_id });
    }

    const dbActiveBefore = (existingRows || []).filter(r => r.state === "active").length;

    const result: BackfillResult = {
      dry_run: params.dry_run,
      mode: params.sbs_ids?.length ? "by_ids" : "full_list",
      api_total: 0,
      api_active: 0,
      db_active_before: dbActiveBefore,
      missing_ids: [],
      inserted: 0,
      updated: 0,
      linked_to_sub_v2: 0,
      errors: [],
      duration_ms: 0,
    };

    let apiSubs: BepaidSub[] = [];

    if (params.sbs_ids?.length) {
      // Mode: fetch specific IDs
      for (const id of params.sbs_ids.slice(0, params.limit)) {
        const { data: sub, error } = await fetchSubscriptionById(id, bepaidAuth);
        if (sub) {
          apiSubs.push(sub);
        } else {
          result.errors.push({ sbs_id: id, reason: error || "Not found" });
        }
      }
    } else {
      // Mode: full list with pagination
      const maxPages = Math.ceil(params.limit / 50);
      const { items, error } = await fetchAllSubscriptions(bepaidAuth, maxPages);
      apiSubs = items;
      if (error) {
        result.errors.push({ sbs_id: "_pagination", reason: error });
      }
    }

    result.api_total = apiSubs.length;
    result.api_active = apiSubs.filter(s => normalizeState(s.state || s.status) === "active").length;

    // Filter by status if needed
    let candidates = apiSubs;
    if (params.status === "active") {
      candidates = apiSubs.filter(s => normalizeState(s.state || s.status) === "active");
    }

    // Find missing or stale
    const toInsert: BepaidSub[] = [];
    const toUpdate: BepaidSub[] = [];

    for (const sub of candidates) {
      const existing = existingMap.get(sub.id);
      if (!existing) {
        toInsert.push(sub);
        result.missing_ids.push(sub.id);
      } else {
        // Update if state changed OR if fetched by specific ID (force refresh raw_data/meta)
        const apiState = normalizeState(sub.state || sub.status);
        if (existing.state !== apiState || params.sbs_ids?.length) {
          toUpdate.push(sub);
        }
      }
    }

    // Trim missing_ids for response (max 50)
    if (result.missing_ids.length > 50) {
      result.missing_ids = result.missing_ids.slice(0, 50);
    }

    if (params.dry_run) {
      result.duration_ms = Date.now() - started;

      // SYSTEM ACTOR audit log
      await serviceClient.from("audit_logs").insert({
        action: "admin.bepaid.backfill_subscriptions",
        actor_type: "system",
        actor_label: "admin-bepaid-backfill-subscriptions",
        meta: {
          triggered_by_email: user.email,
          triggered_by_id: user.id,
          dry_run: true,
          mode: result.mode,
          api_total: result.api_total,
          api_active: result.api_active,
          db_active_before: result.db_active_before,
          missing_count: toInsert.length,
          update_count: toUpdate.length,
          missing_ids: result.missing_ids.slice(0, 20),
          errors: result.errors.slice(0, 10),
        },
      });

      return json(result);
    }

    // Execute: INSERT missing (with user_id resolution)
    for (const sub of toInsert) {
      try {
        const record = buildProviderSubRecord(sub);

        // PATCH-4: Resolve user_id from subscription_v2_id or tracking_id
        const resolvedUserId = await resolveUserIdForSub(serviceClient, sub);
        if (resolvedUserId) {
          (record as any).user_id = resolvedUserId;
        }

        const { error: insertErr } = await serviceClient
          .from("provider_subscriptions")
          .insert(record);
        if (insertErr) {
          result.errors.push({ sbs_id: sub.id, reason: `Insert: ${insertErr.message}` });
        } else {
          result.inserted++;
        }
      } catch (e) {
        result.errors.push({ sbs_id: sub.id, reason: String(e).slice(0, 100) });
      }
    }

    // Execute: UPDATE existing with changed state
    for (const sub of toUpdate) {
      try {
        const state = normalizeState(sub.state || sub.status);
        const snapshot = {
          id: sub.id,
          state: sub.state || sub.status,
          plan: sub.plan ? { amount: sub.plan.amount, currency: sub.plan.currency, title: sub.plan.title } : null,
          next_billing_at: sub.next_billing_at,
          created_at: sub.created_at,
          cancellation_capability: sub.cancellation_capability,
        };

        // PATCH-4: Resolve user_id if missing on existing record
        const existingRecord = existingMap.get(sub.id);
        const resolvedUserId = await resolveUserIdForSub(serviceClient, sub);

        const updatePayload: Record<string, unknown> = {
            state,
            next_charge_at: sub.next_billing_at || null,
            card_last4: sub.credit_card?.last_4 || null,
            card_brand: sub.credit_card?.brand || null,
            amount_cents: sub.plan?.amount || null,
            currency: sub.plan?.currency || null,
            raw_data: sub,
            meta: {
              provider_snapshot: snapshot,
              snapshot_at: new Date().toISOString(),
              cancellation_capability: sub.cancellation_capability,
              backfilled: true,
            },
        };

        // Only set user_id if we resolved one and existing is missing
        if (resolvedUserId) {
          // Check if existing record has user_id
          const { data: currentRow } = await serviceClient
            .from("provider_subscriptions")
            .select("user_id")
            .eq("provider_subscription_id", sub.id)
            .maybeSingle();
          if (!currentRow?.user_id) {
            updatePayload.user_id = resolvedUserId;
          }
        }

        const { error: updateErr } = await serviceClient
          .from("provider_subscriptions")
          .update(updatePayload)
          .eq("provider_subscription_id", sub.id);

        if (updateErr) {
          result.errors.push({ sbs_id: sub.id, reason: `Update: ${updateErr.message}` });
        } else {
          result.updated++;

          // If became active, try to update linked billing_type
          if (state === "active") {
            const existing = existingMap.get(sub.id);
            if (existing?.subscription_v2_id) {
              const { data: linkedSub } = await serviceClient
                .from("subscriptions_v2")
                .select("id, billing_type")
                .eq("id", existing.subscription_v2_id)
                .eq("billing_type", "mit")
                .maybeSingle();
              if (linkedSub) {
                await serviceClient
                  .from("subscriptions_v2")
                  .update({ billing_type: "provider_managed" })
                  .eq("id", linkedSub.id);
                result.linked_to_sub_v2++;
              }
            }
          }

          // INV-22: Propagate terminal provider states → auto_renew=false
          if (['expired', 'canceled', 'failed', 'redirecting'].includes(state)) {
            const existingTerminal = existingMap.get(sub.id);
            if (existingTerminal?.subscription_v2_id) {
              const { data: linkedSubTerminal } = await serviceClient
                .from("subscriptions_v2")
                .select("id, auto_renew")
                .eq("id", existingTerminal.subscription_v2_id)
                .eq("auto_renew", true) // STOP-guard: skip if already false
                .maybeSingle();
              if (linkedSubTerminal) {
                await serviceClient
                  .from("subscriptions_v2")
                  .update({ auto_renew: false, updated_at: new Date().toISOString() })
                  .eq("id", linkedSubTerminal.id);
                await serviceClient.from("audit_logs").insert({
                  actor_type: "system",
                  actor_user_id: null,
                  actor_label: "admin-bepaid-backfill-subscriptions",
                  action: "billing.inv22.autorenew_disabled_from_provider_state",
                  meta: {
                    subscription_v2_id: linkedSubTerminal.id,
                    provider_subscription_id: sub.id,
                    ps_state: state,
                    reason: "terminal_provider_state",
                  },
                });
                result.terminal_auto_renew_disabled = (result.terminal_auto_renew_disabled || 0) + 1;
              }
            }
          }
        }
      } catch (e) {
        result.errors.push({ sbs_id: sub.id, reason: String(e).slice(0, 100) });
      }
    }

    result.duration_ms = Date.now() - started;

    // SYSTEM ACTOR audit log
    await serviceClient.from("audit_logs").insert({
      action: "admin.bepaid.backfill_subscriptions",
      actor_type: "system",
      actor_label: "admin-bepaid-backfill-subscriptions",
      meta: {
        triggered_by_email: user.email,
        triggered_by_id: user.id,
        dry_run: false,
        mode: result.mode,
        api_total: result.api_total,
        api_active: result.api_active,
        db_active_before: result.db_active_before,
        inserted: result.inserted,
        updated: result.updated,
        linked_to_sub_v2: result.linked_to_sub_v2,
        missing_ids: result.missing_ids.slice(0, 20),
        errors: result.errors.slice(0, 20),
        duration_ms: result.duration_ms,
        terminal_auto_renew_disabled: result.terminal_auto_renew_disabled || 0,
      },
    });

    return json(result);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
