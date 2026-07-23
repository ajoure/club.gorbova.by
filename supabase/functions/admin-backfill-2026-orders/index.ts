import { createClient } from "npm:@supabase/supabase-js@2";
import { buildPurchaseSnapshot } from "../_shared/build-purchase-snapshot.ts";
import { classifyPayment } from "./classifier.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type RecoveryAction =
  | "create_order_and_fulfill"
  | "resume_fulfillment"
  | "already_complete"
  | "manual_review"
  | "error";

interface RecoveryRequest {
  dry_run?: boolean;
  payment_ids?: string[];
}

interface Mapping {
  product_id: string;
  tariff_id: string;
  offer_id: string | null;
  source: string;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

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

async function resolveMapping(supabase: any, payment: any): Promise<
  { mapping: Mapping | null; reason: string | null }
> {
  const meta = payment.meta || {};
  const response = payment.provider_response || {};
  const directProduct = nonEmpty(meta.product_id) || nonEmpty(response.product_id);
  const directTariff = nonEmpty(meta.tariff_id) || nonEmpty(response.tariff_id);
  const directOffer = nonEmpty(meta.offer_id) || nonEmpty(response.offer_id);

  if (directProduct && directTariff) {
    return {
      mapping: {
        product_id: directProduct,
        tariff_id: directTariff,
        offer_id: directOffer,
        source: "payment_metadata",
      },
      reason: null,
    };
  }

  if (
    String(payment.provider || "").toLowerCase() === "bepaid" &&
    payment.provider_payment_id
  ) {
    const { data: queueRows, error } = await supabase
      .from("payment_reconcile_queue")
      .select(
        "id,transaction_type,matched_product_id,matched_tariff_id,raw_payload,tracking_id",
      )
      .eq("bepaid_uid", payment.provider_payment_id)
      .limit(2);
    if (error) return { mapping: null, reason: `queue_lookup_failed:${error.message}` };
    if ((queueRows || []).length !== 1) {
      return {
        mapping: null,
        reason: (queueRows || []).length > 1
          ? "ambiguous_queue_rows"
          : "missing_provider_evidence",
      };
    }
    const queue = queueRows[0];
    if (!isSaleTransaction(queue.transaction_type)) {
      return { mapping: null, reason: "queue_transaction_is_not_sale" };
    }
    const productId = nonEmpty(queue.matched_product_id);
    const tariffId = nonEmpty(queue.matched_tariff_id);
    const offerId =
      nonEmpty(queue.raw_payload?.offer_id) ||
      nonEmpty(queue.raw_payload?.meta?.offer_id);
    if (!productId || !tariffId) {
      return { mapping: null, reason: "queue_mapping_incomplete" };
    }

    if (offerId) {
      return {
        mapping: {
          product_id: productId,
          tariff_id: tariffId,
          offer_id: offerId,
          source: "payment_reconcile_queue",
        },
        reason: null,
      };
    }

    const { data: mappings, error: mappingError } = await supabase
      .from("bepaid_product_mappings")
      .select("offer_id")
      .eq("product_id", productId)
      .eq("tariff_id", tariffId)
      .eq("auto_create_order", true);
    if (mappingError) {
      return { mapping: null, reason: `mapping_lookup_failed:${mappingError.message}` };
    }
    const offers = [...new Set((mappings || []).map((row: any) => row.offer_id).filter(Boolean))];
    if (offers.length !== 1) {
      return {
        mapping: null,
        reason: offers.length > 1 ? "ambiguous_offer_mapping" : "offer_mapping_missing",
      };
    }
    return {
      mapping: {
        product_id: productId,
        tariff_id: tariffId,
        offer_id: offers[0] as string,
        source: "payment_reconcile_queue+bepaid_product_mappings",
      },
      reason: null,
    };
  }

  return { mapping: null, reason: "missing_exact_product_mapping" };
}

async function invokeFulfillment(
  supabase: any,
  orderId: string,
): Promise<{ ok: boolean; grant: unknown; getcourse: unknown; error?: string }> {
  const { data: grant, error: grantError } = await supabase.functions.invoke(
    "grant-access-for-order",
    {
      body: {
        orderId,
        grantTelegram: true,
        grantGetcourse: false,
        source: "admin-backfill-2026-orders",
        context: "historical_payment_recovery",
      },
    },
  );
  if (grantError) {
    return { ok: false, grant: null, getcourse: null, error: grantError.message };
  }
  if ((grant as any)?.success === false || (grant as any)?.error) {
    return {
      ok: false,
      grant,
      getcourse: null,
      error: (grant as any)?.error || "grant_access_failed",
    };
  }

  const { data: getcourse, error: gcError } = await supabase.functions.invoke(
    "getcourse-grant-access",
    { body: { order_id: orderId } },
  );
  return {
    ok: true,
    grant,
    getcourse: gcError ? { ok: false, error: gcError.message } : getcourse,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const startedAt = Date.now();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser();
    if (authError || !authData.user) return json({ error: "Invalid token" }, 401);

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const [adminResult, superAdminResult] = await Promise.all([
      supabase.rpc("has_role_v2", {
        _user_id: authData.user.id,
        _role_code: "admin",
      }),
      supabase.rpc("has_role_v2", {
        _user_id: authData.user.id,
        _role_code: "super_admin",
      }),
    ]);
    if (!adminResult.data && !superAdminResult.data) {
      return json({ error: "Admin access required" }, 403);
    }

    const body: RecoveryRequest = await req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false;
    const paymentIds = [...new Set(body.payment_ids || [])];
    if (
      paymentIds.length === 0 ||
      paymentIds.length > 50 ||
      paymentIds.some((id) => typeof id !== "string" || !id)
    ) {
      return json({
        error: "payment_ids must contain 1..50 exact payments_v2 IDs",
        code: "EXACT_PAYMENT_IDS_REQUIRED",
      }, 400);
    }

    const { data: payments, error: paymentsError } = await supabase
      .from("payments_v2")
      .select(
        "id,order_id,profile_id,user_id,amount,currency,status,provider,provider_payment_id,paid_at,meta,provider_response",
      )
      .in("id", paymentIds);
    if (paymentsError) throw new Error(paymentsError.message);

    const found = new Set((payments || []).map((payment: any) => payment.id));
    const results: any[] = paymentIds
      .filter((id) => !found.has(id))
      .map((id) => ({
        payment_id: id,
        action: "manual_review" as RecoveryAction,
        reason: "payment_not_found",
      }));

    for (const payment of payments || []) {
      const row: any = {
        payment_id: payment.id,
        provider: payment.provider,
        provider_payment_id: payment.provider_payment_id,
        action: "manual_review" as RecoveryAction,
      };
      try {
        const classificationReason = classifyPayment(payment);
        if (classificationReason) {
          row.reason = classificationReason;
          results.push(row);
          continue;
        }

        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("id,user_id,email")
          .eq("id", payment.profile_id)
          .maybeSingle();
        if (profileError || !profile?.user_id) {
          row.reason = "profile_or_user_missing";
          results.push(row);
          continue;
        }

        let orderId = payment.order_id as string | null;
        if (!orderId) {
          const { data: recoveredOrder } = await supabase
            .from("orders_v2")
            .select("id")
            .eq("meta->>historical_recovery_payment_id", payment.id)
            .maybeSingle();
          orderId = recoveredOrder?.id || null;
        }

        if (!orderId) {
          const mappingResult = await resolveMapping(supabase, payment);
          if (!mappingResult.mapping) {
            row.reason = mappingResult.reason;
            results.push(row);
            continue;
          }
          row.mapping = mappingResult.mapping;
          row.action = "create_order_and_fulfill";
          if (dryRun) {
            results.push(row);
            continue;
          }

          const { data: orderNumber, error: numberError } = await supabase.rpc(
            "generate_order_number",
          );
          if (numberError) throw new Error(`order_number:${numberError.message}`);
          const mapping = mappingResult.mapping;
          const { data: order, error: orderError } = await supabase
            .from("orders_v2")
            .insert({
              order_number: orderNumber,
              user_id: profile.user_id,
              profile_id: profile.id,
              product_id: mapping.product_id,
              tariff_id: mapping.tariff_id,
              offer_id: mapping.offer_id,
              status: "paid",
              base_price: payment.amount,
              final_price: payment.amount,
              paid_amount: payment.amount,
              currency: payment.currency || "BYN",
              customer_email: profile.email,
              provider: payment.provider,
              provider_payment_id: payment.provider_payment_id,
              reconcile_source: "historical_payment_recovery",
              created_at: payment.paid_at,
              purchase_snapshot: buildPurchaseSnapshot({
                product_id: mapping.product_id,
                tariff_id: mapping.tariff_id,
                offer_id: mapping.offer_id,
                price: payment.amount,
                currency: payment.currency || "BYN",
                reconcile_source: "historical_payment_recovery",
                extra: {
                  provider: payment.provider,
                  provider_payment_id: payment.provider_payment_id,
                  original_paid_at: payment.paid_at,
                },
              }),
              meta: {
                source: "admin-backfill-2026-orders",
                historical_recovery_payment_id: payment.id,
                mapping_source: mapping.source,
                recovered_at: new Date().toISOString(),
              },
            })
            .select("id,order_number")
            .single();
          if (orderError) throw new Error(`order_create:${orderError.message}`);
          orderId = order.id;
          row.order_id = orderId;
          row.order_number = order.order_number;

          const { data: linked, error: linkError } = await supabase
            .from("payments_v2")
            .update({
              order_id: orderId,
              user_id: profile.user_id,
              meta: {
                ...(payment.meta || {}),
                historical_recovery_order_id: orderId,
                historical_recovery_at: new Date().toISOString(),
              },
            })
            .eq("id", payment.id)
            .is("order_id", null)
            .select("id,order_id")
            .maybeSingle();
          if (linkError || linked?.order_id !== orderId) {
            throw new Error(`payment_link:${linkError?.message || "concurrent_update"}`);
          }
        } else {
          row.action = "resume_fulfillment";
          row.order_id = orderId;
          if (dryRun) {
            results.push(row);
            continue;
          }
        }

        if (!orderId) throw new Error("order_id_missing_after_materialization");
        const fulfillment = await invokeFulfillment(supabase, orderId);
        row.fulfillment = fulfillment;
        if (!fulfillment.ok) {
          row.action = "error";
          row.reason = `fulfillment_failed:${fulfillment.error}`;
        } else {
          row.action = "already_complete";
        }
        results.push(row);
      } catch (error) {
        row.action = "error";
        row.reason = error instanceof Error ? error.message : String(error);
        results.push(row);
      }
    }

    const stats = results.reduce((acc: Record<string, number>, row: any) => {
      acc[row.action] = (acc[row.action] || 0) + 1;
      return acc;
    }, {});
    await supabase.from("audit_logs").insert({
      actor_type: "user",
      actor_user_id: authData.user.id,
      actor_label: "admin-backfill-2026-orders",
      action: dryRun
        ? "payment.historical_recovery_dry_run"
        : "payment.historical_recovery_executed",
      meta: {
        dry_run: dryRun,
        payment_ids: paymentIds,
        stats,
        duration_ms: Date.now() - startedAt,
      },
    });

    return json({
      success: !results.some((row) => row.action === "error"),
      dry_run: dryRun,
      stats,
      results,
      duration_ms: Date.now() - startedAt,
    });
  } catch (error) {
    console.error("[admin-backfill-2026-orders]", error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startedAt,
    }, 500);
  }
});
