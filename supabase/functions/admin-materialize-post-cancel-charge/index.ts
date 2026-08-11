import { createClient } from "npm:@supabase/supabase-js@2";
import { classifyPostCancelCharge } from "./post_cancel_charge.ts";
import {
  buildRebillOrderNumber,
  buildRebillOrderPayload,
} from "./rebill_builders.ts";
import { buildRebillDepsAdapter } from "./rebill_deps_adapter.ts";
import { runRebillFlow } from "./rebill_flow.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRACKING_RE = /^subv2:([0-9a-f-]{36}):order:([0-9a-f-]{36})(?::.*)?$/i;

interface RequestBody {
  queue_id?: string;
  provider_row_id?: string;
  provider_subscription_id?: string;
  expected_uid?: string;
  cancellation_evidence_subscription_id?: string;
  expected_amount?: number;
  expected_currency?: string;
  expected_paid_at?: string;
  dry_run?: boolean;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sameInstant(left: string | null, right: string): boolean {
  const leftMs = left ? Date.parse(left) : Number.NaN;
  const rightMs = Date.parse(right);
  return Number.isFinite(leftMs) && Number.isFinite(rightMs) &&
    Math.abs(leftMs - rightMs) < 1000;
}

function stableRows(rows: Array<Record<string, unknown>> | null) {
  return [...(rows || [])].sort((a, b) =>
    String(a.id).localeCompare(String(b.id))
  );
}

async function readProtectedAccessState(supabase: any, userId: string) {
  const [subscriptions, entitlements, telegram] = await Promise.all([
    supabase
      .from("subscriptions_v2")
      .select(
        "id,status,auto_renew,access_start_at,access_end_at,next_charge_at",
      )
      .eq("user_id", userId),
    supabase
      .from("entitlements")
      .select("id,product_id,status,expires_at")
      .eq("user_id", userId),
    supabase
      .from("telegram_access_grants")
      .select("id,club_id,status,start_at,end_at")
      .eq("user_id", userId),
  ]);
  const errors = [subscriptions.error, entitlements.error, telegram.error]
    .filter(Boolean);
  if (errors.length > 0) {
    throw new Error(
      `protected_access_snapshot_failed:${
        errors.map((e: any) => e.message).join(";")
      }`,
    );
  }
  return JSON.stringify({
    subscriptions: stableRows(subscriptions.data),
    entitlements: stableRows(entitlements.data),
    telegram: stableRows(telegram.data),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "unauthorized" }, 401);

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      token,
    );
    if (authError || !user) return json({ error: "unauthorized" }, 401);

    const [{ data: isAdmin }, { data: isSuperAdmin }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: user.id, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: user.id, _role: "superadmin" }),
    ]);
    if (isAdmin !== true && isSuperAdmin !== true) {
      return json({ error: "forbidden" }, 403);
    }

    const body = await req.json().catch(() => ({})) as RequestBody;
    const dryRun = body.dry_run !== false;
    const requiredStrings = [
      body.queue_id,
      body.provider_row_id,
      body.provider_subscription_id,
      body.expected_uid,
      body.cancellation_evidence_subscription_id,
      body.expected_currency,
      body.expected_paid_at,
    ];
    if (
      requiredStrings.some((value) => !value) ||
      !Number.isFinite(Number(body.expected_amount)) ||
      Number(body.expected_amount) <= 0
    ) {
      return json({ error: "all_expected_fields_required" }, 400);
    }
    if (
      !UUID_RE.test(body.queue_id!) || !UUID_RE.test(body.provider_row_id!) ||
      !UUID_RE.test(body.expected_uid!) ||
      !UUID_RE.test(body.cancellation_evidence_subscription_id!)
    ) {
      return json({ error: "invalid_uuid" }, 400);
    }
    if (!Number.isFinite(Date.parse(body.expected_paid_at!))) {
      return json({ error: "invalid_expected_paid_at" }, 400);
    }

    const expectedAmount = Number(body.expected_amount);
    const expectedCurrency = String(body.expected_currency).toUpperCase();

    const { data: queue, error: queueError } = await supabase
      .from("payment_reconcile_queue")
      .select(
        "id,bepaid_uid,amount,currency,paid_at,tracking_id,status,status_normalized,processed_order_id,matched_order_id,matched_profile_id,matched_product_id,matched_tariff_id,last_error",
      )
      .eq("id", body.queue_id!)
      .maybeSingle();
    if (queueError) {
      throw new Error(`queue_lookup_failed:${queueError.message}`);
    }
    if (!queue) return json({ error: "queue_not_found" }, 404);

    const queueMismatch =
      String(queue.bepaid_uid || "") !== body.expected_uid ||
      Math.abs(Number(queue.amount) - expectedAmount) >= 0.001 ||
      String(queue.currency || "").toUpperCase() !== expectedCurrency ||
      !sameInstant(queue.paid_at, body.expected_paid_at!);
    if (queueMismatch) {
      return json({
        error: "queue_expected_values_mismatch",
        queue_id: queue.id,
      }, 409);
    }
    if (String(queue.status_normalized || "").toLowerCase() !== "successful") {
      return json({ error: "queue_transaction_not_successful" }, 409);
    }

    const trackingMatch = String(queue.tracking_id || "").match(TRACKING_RE);
    if (!trackingMatch) return json({ error: "unsupported_tracking_id" }, 409);
    const [, subscriptionV2Id, parentOrderId] = trackingMatch;

    const { data: providerRow, error: providerRowError } = await supabase
      .from("provider_subscriptions")
      .select(
        "id,provider_subscription_id,state,subscription_v2_id,order_id,user_id,profile_id",
      )
      .eq("id", body.provider_row_id!)
      .eq("provider", "bepaid")
      .eq("provider_subscription_id", body.provider_subscription_id!)
      .maybeSingle();
    if (providerRowError) {
      throw new Error(`provider_row_lookup_failed:${providerRowError.message}`);
    }
    if (!providerRow) return json({ error: "provider_row_not_found" }, 404);
    if (
      !["canceled", "cancelled", "terminated"].includes(
        String(providerRow.state).toLowerCase(),
      )
    ) {
      return json({
        error: "provider_row_not_terminal",
        state: providerRow.state,
      }, 409);
    }
    if (String(providerRow.subscription_v2_id || "") !== subscriptionV2Id) {
      return json({ error: "provider_subscription_link_mismatch" }, 409);
    }

    const { data: localSub, error: localSubError } = await supabase
      .from("subscriptions_v2")
      .select(
        "id,user_id,profile_id,product_id,tariff_id,order_id,status,auto_renew,canceled_at,auto_renew_disabled_at,access_end_at,meta",
      )
      .eq("id", subscriptionV2Id)
      .maybeSingle();
    if (localSubError) {
      throw new Error(`subscription_lookup_failed:${localSubError.message}`);
    }
    if (!localSub) return json({ error: "subscription_not_found" }, 404);
    if (!localSub.user_id || !localSub.product_id || !localSub.tariff_id) {
      return json({ error: "canonical_subscription_scope_incomplete" }, 409);
    }
    if (
      String(localSub.order_id || "") !== parentOrderId ||
      (providerRow.order_id &&
        String(providerRow.order_id) !== parentOrderId) ||
      (providerRow.user_id &&
        String(providerRow.user_id) !== String(localSub.user_id))
    ) {
      return json({ error: "canonical_linkage_mismatch" }, 409);
    }

    const { data: cancellationEvidence, error: cancellationEvidenceError } =
      await supabase
        .from("subscriptions_v2")
        .select(
          "id,user_id,profile_id,product_id,tariff_id,status,auto_renew,canceled_at,auto_renew_disabled_at",
        )
        .eq("id", body.cancellation_evidence_subscription_id!)
        .maybeSingle();
    if (cancellationEvidenceError) {
      throw new Error(
        `cancellation_evidence_lookup_failed:${cancellationEvidenceError.message}`,
      );
    }
    if (!cancellationEvidence) {
      return json({ error: "cancellation_evidence_not_found" }, 404);
    }
    if (
      String(cancellationEvidence.user_id || "") !== String(localSub.user_id) ||
      String(cancellationEvidence.product_id || "") !==
        String(localSub.product_id) ||
      String(cancellationEvidence.tariff_id || "") !== String(localSub.tariff_id)
    ) {
      return json({ error: "cancellation_evidence_scope_mismatch" }, 409);
    }

    const postCancel = classifyPostCancelCharge({
      subscriptionStatus: cancellationEvidence.status,
      autoRenew: cancellationEvidence.auto_renew,
      canceledAt: cancellationEvidence.canceled_at,
      autoRenewDisabledAt: cancellationEvidence.auto_renew_disabled_at,
      transactionStatus: "successful",
      transactionPaidAt: queue.paid_at,
    });
    if (postCancel.outcome !== "post_cancel_charge") {
      return json({
        error: "post_cancel_charge_not_proven",
        reason: postCancel.reason,
      }, 409);
    }

    const { data: parentOrder, error: parentOrderError } = await supabase
      .from("orders_v2")
      .select(
        "id,user_id,profile_id,product_id,tariff_id,currency,pipeline_id,pipeline_stage_id,bepaid_subscription_id,customer_email,customer_phone,payer_type,meta",
      )
      .eq("id", parentOrderId)
      .maybeSingle();
    if (parentOrderError) {
      throw new Error(`parent_order_lookup_failed:${parentOrderError.message}`);
    }
    if (!parentOrder) return json({ error: "parent_order_not_found" }, 404);
    if (
      String(parentOrder.user_id || "") !== String(localSub.user_id) ||
      String(parentOrder.product_id || "") !== String(localSub.product_id) ||
      String(parentOrder.tariff_id || "") !== String(localSub.tariff_id)
    ) {
      return json({ error: "parent_order_scope_mismatch" }, 409);
    }

    const { data: existingPayment, error: existingPaymentError } =
      await supabase
        .from("payments_v2")
        .select("id,order_id,amount,currency,status,meta")
        .eq("provider", "bepaid")
        .eq("provider_payment_id", body.expected_uid!)
        .maybeSingle();
    if (existingPaymentError) {
      throw new Error(`payment_lookup_failed:${existingPaymentError.message}`);
    }

    if (existingPayment) {
      const { data: existingOrder } = await supabase
        .from("orders_v2")
        .select("id,order_number,meta")
        .eq("id", existingPayment.order_id)
        .maybeSingle();
      const existingMeta = (existingOrder?.meta || {}) as Record<
        string,
        unknown
      >;
      const canonical = existingOrder &&
        existingOrder.order_number ===
          buildRebillOrderNumber(body.expected_uid!) &&
        existingMeta.do_not_grant_access === true &&
        existingMeta.refund_candidate === true;
      if (!canonical) return json({ error: "payment_uid_conflict" }, 409);
      if (!dryRun) {
        const protectedBefore = await readProtectedAccessState(
          supabase,
          String(localSub.user_id),
        );
        const deps = buildRebillDepsAdapter(supabase);
        await deps.mergeOrderMeta({
          orderId: existingOrder.id,
          patch: {
            recovery_origin: "admin-materialize-post-cancel-charge",
            access_suppressed: true,
            source_queue_id: queue.id,
            cancellation_evidence_subscription_id: cancellationEvidence.id,
            recovered_by_user_id: user.id,
          },
        });

        const existingPaymentMeta = (existingPayment.meta || {}) as Record<
          string,
          unknown
        >;
        const { data: paymentReadback, error: paymentUpdateError } =
          await supabase
            .from("payments_v2")
            .update({
              meta: {
                ...existingPaymentMeta,
                manual_review: true,
                refund_candidate: true,
                refund_candidate_reason:
                  "provider_charge_after_confirmed_cancel",
                access_suppressed: true,
                source_queue_id: queue.id,
              },
            })
            .eq("id", existingPayment.id)
            .select("id,order_id,meta")
            .maybeSingle();
        if (paymentUpdateError || !paymentReadback) {
          throw new Error(
            `existing_payment_finalize_failed:${
              paymentUpdateError?.message || "missing"
            }`,
          );
        }

        const { data: queueReadback, error: queueFinalizeError } =
          await supabase
            .from("payment_reconcile_queue")
            .update({
              status: "completed",
              processed_order_id: existingOrder.id,
              matched_order_id: parentOrder.id,
              matched_profile_id: localSub.profile_id || parentOrder.profile_id,
              matched_product_id: localSub.product_id,
              matched_tariff_id: localSub.tariff_id,
              processed_at: new Date().toISOString(),
              last_error: null,
            })
            .eq("id", queue.id)
            .select("id,status,processed_order_id")
            .maybeSingle();
        if (
          queueFinalizeError || !queueReadback ||
          queueReadback.status !== "completed" ||
          String(queueReadback.processed_order_id) !== String(existingOrder.id)
        ) {
          throw new Error(
            `existing_queue_finalize_failed:${
              queueFinalizeError?.message || "readback_mismatch"
            }`,
          );
        }

        const protectedAfter = await readProtectedAccessState(
          supabase,
          String(localSub.user_id),
        );
        if (protectedBefore !== protectedAfter) {
          throw new Error("protected_access_state_changed");
        }
        await supabase.from("audit_logs").insert({
          action: "bepaid.post_cancel_charge.admin_materialized_idempotent",
          actor_type: "user",
          actor_user_id: user.id,
          actor_label: "admin-materialize-post-cancel-charge",
          target_user_id: localSub.user_id,
          meta: {
            queue_id: queue.id,
            transaction_uid: body.expected_uid,
            cancellation_evidence_subscription_id: cancellationEvidence.id,
            order_id: existingOrder.id,
            payment_id: paymentReadback.id,
            access_actions: 0,
            protected_access_unchanged: true,
            refund_candidate: true,
          },
        });
      }
      return json({
        success: true,
        dry_run: dryRun,
        decision: "already_materialized",
        order_id: existingOrder.id,
        payment_id: existingPayment.id,
        access_actions: 0,
        cancellation_evidence_subscription_id: cancellationEvidence.id,
      });
    }

    const flowInput = {
      parentOrder: {
        id: String(parentOrder.id),
        user_id: parentOrder.user_id ?? null,
        profile_id: parentOrder.profile_id ?? null,
        product_id: parentOrder.product_id ?? null,
        tariff_id: parentOrder.tariff_id ?? null,
        currency: parentOrder.currency ?? expectedCurrency,
        pipeline_id: parentOrder.pipeline_id ?? null,
        pipeline_stage_id: parentOrder.pipeline_stage_id ?? null,
        bepaid_subscription_id: body.provider_subscription_id!,
        customer_email: parentOrder.customer_email ?? null,
        customer_phone: parentOrder.customer_phone ?? null,
        payer_type: parentOrder.payer_type ?? null,
        meta: (parentOrder.meta || {}) as Record<string, unknown>,
      },
      payment: {
        uid: body.expected_uid!,
        amount: expectedAmount,
        paid_at: queue.paid_at!,
        currency: expectedCurrency,
      },
      subscriptionId: body.provider_subscription_id!,
      accessPolicy: "suppress_post_cancel_charge" as const,
    };

    if (dryRun) {
      const plannedOrder = buildRebillOrderPayload({
        ...flowInput,
        materializationRun: "admin_post_cancel_recovery_v1",
      });
      return json({
        success: true,
        dry_run: true,
        decision: "would_materialize",
        queue_id: queue.id,
        would_create_orders: 1,
        would_create_payments: 1,
        access_actions: 0,
        planned_order_number: plannedOrder.order_number,
        planned_flags: {
          do_not_grant_access: true,
          manual_review: true,
          refund_candidate: true,
        },
        cancellation_evidence_subscription_id: cancellationEvidence.id,
      });
    }

    const protectedBefore = await readProtectedAccessState(
      supabase,
      String(localSub.user_id),
    );
    const deps = buildRebillDepsAdapter(supabase);
    const flow = await runRebillFlow(deps, { mode: "on", ...flowInput });
    if (
      flow.decision !== "materialized_no_grant_post_cancel" ||
      !flow.rebill_order_id
    ) {
      throw new Error(`materialization_unconfirmed:${flow.decision}`);
    }

    await deps.mergeOrderMeta({
      orderId: flow.rebill_order_id,
      patch: {
        recovery_origin: "admin-materialize-post-cancel-charge",
        access_suppressed: true,
        source_queue_id: queue.id,
        cancellation_evidence_subscription_id: cancellationEvidence.id,
        recovered_by_user_id: user.id,
      },
    });

    const { data: paymentForMeta, error: paymentForMetaError } = await supabase
      .from("payments_v2")
      .select("id,order_id,amount,currency,status,meta")
      .eq("provider", "bepaid")
      .eq("provider_payment_id", body.expected_uid!)
      .maybeSingle();
    if (paymentForMetaError || !paymentForMeta) {
      throw new Error(
        `payment_readback_failed:${paymentForMetaError?.message || "missing"}`,
      );
    }
    const paymentMeta = (paymentForMeta.meta || {}) as Record<string, unknown>;
    const { data: updatedPayment, error: paymentMetaError } = await supabase
      .from("payments_v2")
      .update({
        meta: {
          ...paymentMeta,
          manual_review: true,
          refund_candidate: true,
          refund_candidate_reason: "provider_charge_after_confirmed_cancel",
          access_suppressed: true,
          source_queue_id: queue.id,
        },
      })
      .eq("id", paymentForMeta.id)
      .select("id,order_id,amount,currency,status,meta")
      .maybeSingle();
    if (paymentMetaError || !updatedPayment) {
      throw new Error(
        `payment_meta_write_failed:${paymentMetaError?.message || "missing"}`,
      );
    }

    const { data: updatedQueue, error: queueUpdateError } = await supabase
      .from("payment_reconcile_queue")
      .update({
        status: "completed",
        processed_order_id: flow.rebill_order_id,
        matched_order_id: parentOrder.id,
        matched_profile_id: localSub.profile_id || parentOrder.profile_id,
        matched_product_id: localSub.product_id,
        matched_tariff_id: localSub.tariff_id,
        processed_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", queue.id)
      .select("id,status,processed_order_id")
      .maybeSingle();
    if (
      queueUpdateError || !updatedQueue || updatedQueue.status !== "completed"
    ) {
      throw new Error(
        `queue_readback_failed:${queueUpdateError?.message || "missing"}`,
      );
    }

    const [{ data: orderReadback }, protectedAfter] = await Promise.all([
      supabase
        .from("orders_v2")
        .select("id,order_number,meta")
        .eq("id", flow.rebill_order_id)
        .maybeSingle(),
      readProtectedAccessState(supabase, String(localSub.user_id)),
    ]);
    const orderMeta = (orderReadback?.meta || {}) as Record<string, unknown>;
    const paymentMetaReadback = (updatedPayment.meta || {}) as Record<
      string,
      unknown
    >;
    if (
      !orderReadback ||
      String(updatedPayment.order_id) !== String(flow.rebill_order_id) ||
      Number(updatedPayment.amount) !== expectedAmount ||
      orderMeta.do_not_grant_access !== true ||
      orderMeta.refund_candidate !== true ||
      paymentMetaReadback.refund_candidate !== true ||
      paymentMetaReadback.access_suppressed !== true
    ) {
      throw new Error("materialization_readback_failed");
    }
    if (protectedBefore !== protectedAfter) {
      throw new Error("protected_access_state_changed");
    }

    await supabase.from("audit_logs").insert({
      action: "bepaid.post_cancel_charge.admin_materialized",
      actor_type: "user",
      actor_user_id: user.id,
      actor_label: "admin-materialize-post-cancel-charge",
      target_user_id: localSub.user_id,
      meta: {
        queue_id: queue.id,
        provider_row_id: providerRow.id,
        provider_subscription_id: providerRow.provider_subscription_id,
        transaction_uid: body.expected_uid,
        cancellation_evidence_subscription_id: cancellationEvidence.id,
        order_id: flow.rebill_order_id,
        payment_id: updatedPayment.id,
        amount: expectedAmount,
        currency: expectedCurrency,
        access_actions: 0,
        protected_access_unchanged: true,
        manual_review: true,
        refund_candidate: true,
      },
    });

    return json({
      success: true,
      dry_run: false,
      decision: "materialized_no_grant_post_cancel",
      queue_id: queue.id,
      order_id: flow.rebill_order_id,
      payment_id: updatedPayment.id,
      access_actions: 0,
      protected_access_unchanged: true,
      refund_candidate: true,
      cancellation_evidence_subscription_id: cancellationEvidence.id,
    });
  } catch (error) {
    console.error("[admin-materialize-post-cancel-charge]", error);
    return json({ error: String((error as Error)?.message || error) }, 500);
  }
});
