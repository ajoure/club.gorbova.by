// edge function: admin-bepaid-backfill

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type BackfillMode = "api_match" | "synthetic" | "both";
type ApiScanMode = "limited" | "deep";

type BackfillCandidate = {
  subscription_v2_id: string;
  user_id: string;
  product_id: string | null;
  status: string;
  auto_renew: boolean;
  provider_token: string;
  pm_brand: string | null;
  pm_last4: string | null;
  profile_id: string | null;
};

type BackfillResult = {
  dry_run: boolean;
  candidates_total: number;
  candidates_autorenew: number;
  api_subscriptions_scanned: number;
  api_matches_found: number;
  api_truncated: boolean;
  api_total_pages_seen: number;
  would_upsert_real_sbs: number;
  would_upsert_synthetic: number;
  upserted_real_sbs: number;
  upserted_synthetic: number;
  errors: string[];
  duration_ms: number;
};

const BEPAID_HOSTS = [
  "gateway.bepaid.by",
  "api.bepaid.by",
  "checkout.bepaid.by",
];

const LIST_PATHS = [
  "/subscriptions",
  "/api/v1/subscriptions",
];

function json(res: unknown, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function pickFirstTruthy<T>(...vals: Array<T | null | undefined>): T | null {
  for (const v of vals) if (v !== null && v !== undefined) return v;
  return null;
}

function normalizeProviderState(input: any): string {
  const s = String(input || "").toLowerCase();
  if (!s) return "active";
  if (s === "cancelled") return "canceled";
  return s;
}

function normalizeAmountCents(
  amount: number | null | undefined,
  currency: string | null | undefined,
): { cents: number | null; source: string; raw: number | null } {
  if (amount === null || amount === undefined) {
    return { cents: null, source: "missing", raw: null };
  }
  const n = Number(amount);
  if (!Number.isFinite(n)) {
    return { cents: null, source: "invalid", raw: null };
  }

  // Guard: already in minor units (typical: integer >= 1000)
  if (Number.isInteger(n) && n >= 1000) {
    return { cents: n, source: "assumed_minor_units", raw: n };
  }

  return { cents: Math.round(n * 100), source: "major_to_minor", raw: n };
}

function sanitizeApiSubscription(apiSub: any) {
  return {
    id: apiSub?.id ?? null,
    state: apiSub?.state ?? apiSub?.status ?? null,
    plan: apiSub?.plan
      ? {
          amount: apiSub.plan?.amount ?? null,
          currency: apiSub.plan?.currency ?? null,
        }
      : null,
    next_billing_at: apiSub?.next_billing_at ?? null,
    created_at: apiSub?.created_at ?? null,
    last_transaction_created_at: apiSub?.last_transaction?.created_at ?? null,
    // NO email, name, card data, address
  };
}

async function fetchBepaidSubscriptions(
  authHeader: string,
  maxPages: number,
  sleepMs: number,
): Promise<{ items: any[]; totalPages: number; truncated: boolean }> {
  const allItems: any[] = [];
  const seenIds = new Set<string>();
  let totalPages = 0;
  let truncated = false;

  for (const host of BEPAID_HOSTS) {
    for (const basePath of LIST_PATHS) {
      let page = 1;
      let hasMore = true;

      while (hasMore && page <= maxPages) {
        const url = `https://${host}${basePath}?page=${page}&per_page=50`;

        try {
          const response = await fetch(url, {
            method: "GET",
            headers: {
              Authorization: authHeader,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
          });

          if (!response.ok) {
            hasMore = false;
            continue;
          }

          const data = await response.json();
          const subs = data.subscriptions || data.data || [];

          if (Array.isArray(subs) && subs.length > 0) {
            totalPages++;
            for (const sub of subs) {
              const id = sub?.id ? String(sub.id) : null;
              if (id && !seenIds.has(id)) {
                seenIds.add(id);
                allItems.push(sub);
              }
            }

            if (subs.length < 50) {
              hasMore = false;
            } else {
              page++;
              if (sleepMs > 0) await new Promise((r) => setTimeout(r, sleepMs));
            }
          } else {
            hasMore = false;
          }
        } catch {
          hasMore = false;
        }
      }

      if (page > maxPages) truncated = true;

      if (allItems.length > 0) {
        return { items: allItems, totalPages, truncated };
      }
    }
  }

  return { items: allItems, totalPages, truncated };
}

// ---- BePaid creds helpers ----

type BepaidCredsResult =
  | { ok: true; shop_id: string; secret_key: string }
  | { ok: false; error: string };

async function getBepaidCredsStrict(supabaseSvc: any): Promise<BepaidCredsResult> {
  const { data: instance, error } = await supabaseSvc
    .from('integration_instances')
    .select('config')
    .eq('provider', 'bepaid')
    .in('status', ['active', 'connected'])
    .maybeSingle();

  const shopId = instance?.config?.shop_id;
  const secretKey = instance?.config?.secret_key;

  if (!error && shopId && secretKey) {
    return { ok: true, shop_id: String(shopId), secret_key: String(secretKey) };
  }

  return {
    ok: false,
    error: "Missing BePaid credentials in integration_instances",
  };
}

function createBepaidAuthHeader(creds: { shop_id: string; secret_key: string }) {
  const token = btoa(`${creds.shop_id}:${creds.secret_key}`);
  return `Basic ${token}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Auth client — verify JWT
    const authHeaderVal = req.headers.get("Authorization");
    if (!authHeaderVal) return json({ error: "Unauthorized" }, 401);

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeaderVal } },
    });

    const { data: userRes, error: authError } = await supabaseAuth.auth.getUser();
    const user = userRes?.user;
    if (authError || !user) return json({ error: "Invalid token" }, 401);

    // Service client — DB writes/reads with elevated access
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Admin/superadmin only
    const [{ data: isAdmin }, { data: isSuperAdmin }] = await Promise.all([
      supabase.rpc("has_role_v2", { _user_id: user.id, _role_code: "admin" }),
      supabase.rpc("has_role_v2", { _user_id: user.id, _role_code: "superadmin" }),
    ]);

    if (!isAdmin && !isSuperAdmin) {
      return json({ error: "Admin access required" }, 403);
    }

    // Params
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false; // default true
    const sinceDays = Math.min(Number(body.since_days) || 365, 730);
    const limit = Math.min(Number(body.limit) || 500, 1000);
    const mode: BackfillMode = (body.mode || "both") as BackfillMode;
    const includeNonAutorenew = body.include_non_autorenew === true;
    const maxPages = Math.min(Number(body.max_pages) || 6, 40);
    const apiScanMode: ApiScanMode = (body.api_scan_mode || "limited") as ApiScanMode;

    const effectiveMaxPages = apiScanMode === "deep" ? Math.min(maxPages, 40) : Math.min(maxPages, 6);
    const sleepMs = apiScanMode === "deep" ? 250 : 0;

    const errors: string[] = [];
    const MAX_ERRORS = 10;

    const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();

    // Step A: Candidates
    let finalCandidates: BackfillCandidate[] = [];

    const autoRenewFilter = includeNonAutorenew ? {} : { auto_renew: true };

    const { data: subs, error: subsErr } = await supabase
      .from("subscriptions_v2")
      .select("id, user_id, product_id, status, auto_renew, profile_id, created_at")
      .in("status", ["active", "trial", "past_due"])
      .match(autoRenewFilter)
      .gte("created_at", sinceDate)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (subsErr) {
      return json({ error: subsErr.message, duration_ms: Date.now() - startTime }, 500);
    }

    if (!subs || subs.length === 0) {
      return json({
        dry_run: dryRun,
        candidates_total: 0,
        candidates_autorenew: 0,
        api_subscriptions_scanned: 0,
        api_matches_found: 0,
        api_truncated: false,
        api_total_pages_seen: 0,
        would_upsert_real_sbs: 0,
        would_upsert_synthetic: 0,
        upserted_real_sbs: 0,
        upserted_synthetic: 0,
        errors: [],
        duration_ms: Date.now() - startTime,
      });
    }

    const userIds = [...new Set(subs.map((s: any) => s.user_id))];

    const { data: pms, error: pmErr } = await supabase
      .from("payment_methods")
      .select("id, user_id, provider_token, brand, last4, status")
      .eq("provider", "bepaid")
      .eq("status", "active")
      .in("user_id", userIds);

    if (pmErr) {
      return json({ error: pmErr.message, duration_ms: Date.now() - startTime }, 500);
    }

    const pmByUser = new Map<string, any>();
    for (const pm of pms || []) {
      if (!pm?.provider_token) continue;
      if (!pmByUser.has(pm.user_id)) pmByUser.set(pm.user_id, pm);
    }

    const { data: existingPS, error: exErr } = await supabase
      .from("provider_subscriptions")
      .select("subscription_v2_id")
      .eq("provider", "bepaid")
      .in("subscription_v2_id", subs.map((s: any) => s.id));

    if (exErr) {
      return json({ error: exErr.message, duration_ms: Date.now() - startTime }, 500);
    }

    const existingSubIds = new Set((existingPS || []).map((ps: any) => ps.subscription_v2_id));

    for (const s of subs) {
      if (existingSubIds.has(s.id)) continue;

      const pm = pmByUser.get(s.user_id);
      if (!pm?.provider_token) continue;

      finalCandidates.push({
        subscription_v2_id: s.id,
        user_id: s.user_id,
        product_id: s.product_id ?? null,
        status: s.status,
        auto_renew: !!s.auto_renew,
        provider_token: pm.provider_token,
        pm_brand: pm.brand ?? null,
        pm_last4: pm.last4 ?? null,
        profile_id: s.profile_id ?? null,
      });
    }

    const candidatesAutorenew = finalCandidates.filter((c) => c.auto_renew).length;

    console.log(
      `[backfill] candidates=${finalCandidates.length} (auto_renew=${candidatesAutorenew}), mode=${mode}, dry_run=${dryRun}, since=${sinceDays}d`,
    );

    // Step B: API matching
    let apiSubscriptions: any[] = [];
    let apiTruncated = false;
    let apiTotalPages = 0;
    let apiMatchesFound = 0;
    const matchedCandidateIds = new Set<string>();

    if (mode === "api_match" || mode === "both") {
      const creds = await getBepaidCredsStrict(supabase);

      if (!creds.ok) {
        errors.push(`BePaid credentials not configured: ${creds.error}`);
      } else {
        const authHeader = createBepaidAuthHeader(creds);
        const result = await fetchBepaidSubscriptions(authHeader, effectiveMaxPages, sleepMs);

        apiSubscriptions = result.items;
        apiTruncated = result.truncated;
        apiTotalPages = result.totalPages;

        const tokenToApiSub = new Map<string, any>();
        for (const apiSub of apiSubscriptions) {
          const cardToken = apiSub?.credit_card?.token;
          if (cardToken) tokenToApiSub.set(String(cardToken), apiSub);
        }

        for (const cand of finalCandidates) {
          const apiSub = tokenToApiSub.get(String(cand.provider_token));
          if (!apiSub) continue;

          matchedCandidateIds.add(cand.subscription_v2_id);
          apiMatchesFound++;

          const sbsId = String(apiSub.id);
          const normalizedState = normalizeProviderState(apiSub.state || apiSub.status);

          const planAmount = apiSub?.plan?.amount ?? null;
          const planCurrency = apiSub?.plan?.currency ?? "BYN";
          const amountCents = planAmount === null ? null : (planAmount > 1000 ? Number(planAmount) : Math.round(Number(planAmount) * 100));

          if (!dryRun) {
            if (errors.length >= MAX_ERRORS) {
              errors.push("STOP: max errors reached");
              break;
            }

            const { error: upsertErr } = await supabase
              .from("provider_subscriptions")
              .upsert(
                {
                  provider: "bepaid",
                  provider_subscription_id: sbsId,
                  subscription_v2_id: cand.subscription_v2_id,
                  user_id: cand.user_id,
                  profile_id: cand.profile_id,
                  state: normalizedState,
                  amount_cents: amountCents,
                  currency: planCurrency,
                  card_brand: apiSub?.credit_card?.brand || cand.pm_brand,
                  card_last4: apiSub?.credit_card?.last_4 || cand.pm_last4,
                  card_token: cand.provider_token,
                  next_charge_at: apiSub?.next_billing_at || null,
                  last_charge_at: apiSub?.last_transaction?.created_at || null,
                  raw_data: sanitizeApiSubscription(apiSub),
                  meta: {
                    synthetic: false,
                    lookup_mode: "api_card_token_match",
                    backfilled_at: new Date().toISOString(),
                    api_scan_mode: apiScanMode,
                    api_truncated: apiTruncated,
                    source_subscription_v2_id: cand.subscription_v2_id,
                    product_id: cand.product_id,
                  },
                },
                { onConflict: "provider,provider_subscription_id" },
              );

            if (upsertErr) {
              errors.push(`API match upsert failed for sbs=${sbsId}: ${upsertErr.message}`);
            }
          }
        }
      }
    }

    // Step C: Synthetic fallback
    let syntheticCount = 0;
    const unmatchedCandidates = finalCandidates.filter((c) => !matchedCandidateIds.has(c.subscription_v2_id));

    if ((mode === "synthetic" || mode === "both") && unmatchedCandidates.length > 0) {
      const userIdsForPayments = [...new Set(unmatchedCandidates.map((c) => c.user_id))];

      const { data: latestPayments, error: lpErr } = await supabase
        .from("payments_v2")
        .select("id, user_id, product_id, amount, currency, paid_at, created_at, is_recurring, status, provider")
        .eq("provider", "bepaid")
        .eq("status", "succeeded")
        .eq("is_recurring", true)
        .in("user_id", userIdsForPayments)
        .order("created_at", { ascending: false })
        .limit(1000);

      if (lpErr) {
        errors.push(`Latest payments query failed: ${lpErr.message}`);
      }

      const userProductToLatestPayment = new Map<string, any>();
      const userToLatestPayment = new Map<string, any>();

      for (const p of latestPayments || []) {
        if (!userToLatestPayment.has(p.user_id)) userToLatestPayment.set(p.user_id, p);

        const key = `${p.user_id}|${p.product_id ?? ""}`;
        if (!userProductToLatestPayment.has(key)) userProductToLatestPayment.set(key, p);
      }

      const BATCH_SIZE = 50;

      for (let i = 0; i < unmatchedCandidates.length; i += BATCH_SIZE) {
        if (errors.length >= MAX_ERRORS) {
          errors.push("STOP: max errors reached during synthetic");
          break;
        }

        const batch = unmatchedCandidates.slice(i, i + BATCH_SIZE);

        for (const cand of batch) {
          syntheticCount++;

          if (dryRun) continue;

          const key = `${cand.user_id}|${cand.product_id ?? ""}`;
          let latestPayment = userProductToLatestPayment.get(key);
          let lookupMode = "latest_payment_user_product";

          if (!latestPayment) {
            latestPayment = userToLatestPayment.get(cand.user_id);
            lookupMode = "latest_payment_user_fallback";
          }

          const currency = (latestPayment?.currency || "BYN") as string;
          const norm = normalizeAmountCents(
            latestPayment?.amount !== undefined && latestPayment?.amount !== null ? Number(latestPayment.amount) : null,
            currency,
          );

          const lastChargeAt = latestPayment?.paid_at || latestPayment?.created_at || null;

          let providerState = "active";
          if (cand.status === "past_due") providerState = "past_due";
          if (!cand.auto_renew) providerState = "canceled";

          const { error: upsertErr } = await supabase
            .from("provider_subscriptions")
            .upsert(
              {
                provider: "bepaid",
                provider_subscription_id: `internal:${cand.subscription_v2_id}`,
                subscription_v2_id: cand.subscription_v2_id,
                user_id: cand.user_id,
                profile_id: cand.profile_id,
                product_id: cand.product_id,
                state: providerState,
                amount_cents: norm.cents,
                currency,
                card_brand: cand.pm_brand,
                card_last4: cand.pm_last4,
                card_token: cand.provider_token,
                last_charge_at: lastChargeAt,
                meta: {
                  synthetic: true,
                  source: "token_direct_charge",
                  lookup_mode: lookupMode,
                  backfilled_at: new Date().toISOString(),
                  source_subscription_v2_id: cand.subscription_v2_id,
                  amount_source: norm.source,
                  amount_raw: norm.raw,
                  pm_lookup_mode: "pm_user_first_active",
                },
              },
              { onConflict: "provider,provider_subscription_id" },
            );

          if (upsertErr) {
            errors.push(`Synthetic upsert failed for sub=${cand.subscription_v2_id.slice(0, 8)}: ${upsertErr.message}`);
          }
        }
      }
    }

    const result: BackfillResult = {
      dry_run: dryRun,
      candidates_total: finalCandidates.length,
      candidates_autorenew: candidatesAutorenew,
      api_subscriptions_scanned: apiSubscriptions.length,
      api_matches_found: apiMatchesFound,
      api_truncated: apiTruncated,
      api_total_pages_seen: apiTotalPages,
      would_upsert_real_sbs: dryRun ? apiMatchesFound : 0,
      would_upsert_synthetic: dryRun ? syntheticCount : 0,
      upserted_real_sbs: dryRun ? 0 : apiMatchesFound,
      upserted_synthetic: dryRun ? 0 : syntheticCount,
      errors: errors.slice(0, 20),
      duration_ms: Date.now() - startTime,
    };

    try {
      await supabase.from("audit_logs").insert({
        actor_type: "admin",
        actor_user_id: user.id,
        action: dryRun ? "admin.bepaid_backfill_dry_run" : "admin.bepaid_backfill_execute",
        meta: {
          candidates_total: result.candidates_total,
          candidates_autorenew: result.candidates_autorenew,
          api_matches: result.api_matches_found,
          synthetic: dryRun ? result.would_upsert_synthetic : result.upserted_synthetic,
          errors_count: errors.length,
          mode,
          api_scan_mode: apiScanMode,
          api_truncated: apiTruncated,
          since_days: sinceDays,
          limit,
        },
      });
    } catch (_) {}

    return json(result);
  } catch (e: any) {
    console.error("[backfill] Fatal error:", e);
    return json({ error: e?.message || "Unknown error", duration_ms: Date.now() - startTime }, 500);
  }
});
