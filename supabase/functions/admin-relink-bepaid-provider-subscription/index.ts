import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "unauthorized" }, 401);
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (authError || !user) return json({ error: "invalid_token" }, 401);

    const [{ data: isAdmin }, { data: isSuperAdmin }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: user.id, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: user.id, _role: "superadmin" }),
    ]);
    if (isAdmin !== true && isSuperAdmin !== true) {
      return json({ error: "admin_required" }, 403);
    }

    const body = await req.json();
    const dryRun = body.dry_run !== false;
    const required = [
      body.provider_row_id,
      body.expected_provider_subscription_id,
      body.from_subscription_v2_id,
      body.to_subscription_v2_id,
    ];
    if (required.some((value) => typeof value !== "string" || !value.trim())) {
      return json({ error: "all_expected_fields_required" }, 400);
    }
    if (
      !UUID_RE.test(body.provider_row_id) ||
      !UUID_RE.test(body.from_subscription_v2_id) ||
      !UUID_RE.test(body.to_subscription_v2_id)
    ) {
      return json({ error: "invalid_uuid" }, 400);
    }

    const { data: providerRow, error: providerError } = await supabase
      .from("provider_subscriptions")
      .select(
        "id,user_id,provider_subscription_id,subscription_v2_id,state,meta",
      )
      .eq("id", body.provider_row_id)
      .maybeSingle();
    if (providerError) {
      throw new Error(`provider_lookup_failed:${providerError.message}`);
    }
    if (!providerRow) return json({ error: "provider_row_not_found" }, 404);
    if (
      providerRow.provider_subscription_id !==
        body.expected_provider_subscription_id ||
      providerRow.state !== "active"
    ) {
      return json({ error: "provider_cas_precondition_failed" }, 409);
    }
    if (
      providerRow.subscription_v2_id !== body.from_subscription_v2_id &&
      providerRow.subscription_v2_id !== body.to_subscription_v2_id
    ) {
      return json({ error: "provider_link_precondition_failed" }, 409);
    }

    const { data: subscriptions, error: subscriptionsError } = await supabase
      .from("subscriptions_v2")
      .select("id,user_id,product_id,tariff_id,status,access_end_at")
      .in("id", [body.from_subscription_v2_id, body.to_subscription_v2_id]);
    if (subscriptionsError) {
      throw new Error(
        `subscription_lookup_failed:${subscriptionsError.message}`,
      );
    }
    if (subscriptions?.length !== 2) {
      return json({ error: "subscription_pair_not_found" }, 404);
    }
    const fromSub = subscriptions.find((row) =>
      row.id === body.from_subscription_v2_id
    )!;
    const toSub = subscriptions.find((row) =>
      row.id === body.to_subscription_v2_id
    )!;
    if (
      fromSub.user_id !== toSub.user_id ||
      fromSub.product_id !== toSub.product_id ||
      fromSub.tariff_id !== toSub.tariff_id ||
      providerRow.user_id !== toSub.user_id
    ) {
      return json({ error: "subscription_tuple_mismatch" }, 409);
    }
    if (fromSub.status === "active" || toSub.status !== "active") {
      return json({ error: "subscription_status_precondition_failed" }, 409);
    }
    if (toSub.access_end_at && Date.parse(toSub.access_end_at) <= Date.now()) {
      return json({ error: "target_access_not_current" }, 409);
    }

    const { data: activeCandidates, error: candidatesError } = await supabase
      .from("subscriptions_v2")
      .select("id")
      .eq("user_id", toSub.user_id)
      .eq("product_id", toSub.product_id)
      .eq("tariff_id", toSub.tariff_id)
      .eq("status", "active");
    if (candidatesError) {
      throw new Error(`candidate_lookup_failed:${candidatesError.message}`);
    }
    if (activeCandidates?.length !== 1 || activeCandidates[0].id !== toSub.id) {
      return json({ error: "active_candidate_not_unique" }, 409);
    }

    const { data: liveProviderRows, error: liveRowsError } = await supabase
      .from("provider_subscriptions")
      .select("id,subscription_v2_id")
      .eq("user_id", toSub.user_id)
      .eq("provider", "bepaid")
      .eq("state", "active");
    if (liveRowsError) {
      throw new Error(`live_provider_lookup_failed:${liveRowsError.message}`);
    }
    const linkedIds = [
      ...new Set(
        (liveProviderRows || []).map((row) => row.subscription_v2_id).filter(
          Boolean,
        ),
      ),
    ];
    const { data: linkedSubs, error: linkedSubsError } = linkedIds.length
      ? await supabase.from("subscriptions_v2").select(
        "id,product_id,tariff_id",
      ).in("id", linkedIds)
      : { data: [], error: null };
    if (linkedSubsError) {
      throw new Error(
        `live_provider_tuple_lookup_failed:${linkedSubsError.message}`,
      );
    }
    const tupleIds = new Set(
      (linkedSubs || [])
        .filter((row) =>
          row.product_id === toSub.product_id &&
          row.tariff_id === toSub.tariff_id
        )
        .map((row) => row.id),
    );
    const tupleLiveRows = (liveProviderRows || []).filter((row) =>
      row.id === providerRow.id ||
      (row.subscription_v2_id && tupleIds.has(row.subscription_v2_id))
    );
    if (tupleLiveRows.length !== 1 || tupleLiveRows[0].id !== providerRow.id) {
      return json({ error: "live_provider_stream_not_unique" }, 409);
    }

    if (providerRow.subscription_v2_id === toSub.id) {
      return json({
        success: true,
        dry_run: dryRun,
        decision: "already_relinked",
        provider_row_id: providerRow.id,
        from_subscription_v2_id: fromSub.id,
        to_subscription_v2_id: toSub.id,
        tuple_verified: true,
        active_candidate_count: 1,
        live_provider_stream_count: 1,
        protected_access_unchanged: true,
      });
    }

    if (dryRun) {
      return json({
        success: true,
        dry_run: true,
        decision: "would_relink",
        provider_row_id: providerRow.id,
        from_subscription_v2_id: fromSub.id,
        to_subscription_v2_id: toSub.id,
        tuple_verified: true,
        active_candidate_count: 1,
        live_provider_stream_count: 1,
        protected_access_unchanged: true,
      });
    }

    const relinkedAt = new Date().toISOString();
    const { data: updated, error: updateError } = await supabase
      .from("provider_subscriptions")
      .update({
        subscription_v2_id: toSub.id,
        meta: {
          ...(providerRow.meta || {}),
          stale_link_repair: {
            repaired_at: relinkedAt,
            from_subscription_v2_id: fromSub.id,
            to_subscription_v2_id: toSub.id,
            repaired_by_user_id: user.id,
          },
        },
      })
      .eq("id", providerRow.id)
      .eq("subscription_v2_id", fromSub.id)
      .eq("state", "active")
      .select("id,subscription_v2_id")
      .maybeSingle();
    if (updateError) {
      throw new Error(`provider_relink_failed:${updateError.message}`);
    }
    if (!updated || updated.subscription_v2_id !== toSub.id) {
      return json({ error: "provider_relink_cas_failed" }, 409);
    }

    await supabase.from("audit_logs").insert({
      action: "bepaid.provider_subscription.stale_link_repaired",
      actor_type: "admin",
      actor_id: user.id,
      actor_label: "admin-relink-bepaid-provider-subscription",
      target_user_id: toSub.user_id,
      meta: {
        provider_row_id: providerRow.id,
        provider_subscription_id: providerRow.provider_subscription_id,
        from_subscription_v2_id: fromSub.id,
        to_subscription_v2_id: toSub.id,
        tuple_verified: true,
      },
    });

    return json({
      success: true,
      dry_run: false,
      decision: "relinked",
      provider_row_id: providerRow.id,
      from_subscription_v2_id: fromSub.id,
      to_subscription_v2_id: toSub.id,
      protected_access_unchanged: true,
    });
  } catch (error) {
    console.error("[admin-relink-bepaid-provider-subscription]", error);
    return json({
      error: error instanceof Error ? error.message : "unknown_error",
    }, 500);
  }
});
