import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { subscriptionId, reason } = await req.json();

    if (!subscriptionId) {
      return new Response(
        JSON.stringify({ error: "subscriptionId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[cancel-trial] Processing cancel for subscription: ${subscriptionId}`);

    // Get subscription
    const { data: subscription, error: subError } = await supabase
      .from("subscriptions_v2")
      .select("*, products_v2(id, name, telegram_club_id)")
      .eq("id", subscriptionId)
      .single();

    if (subError || !subscription) {
      console.error("[cancel-trial] Subscription not found:", subError);
      return new Response(
        JSON.stringify({ error: "Subscription not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if it's a trial subscription
    if (!subscription.is_trial || subscription.status !== "trial") {
      return new Response(
        JSON.stringify({ error: "This subscription is not in trial status" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if already canceled
    if (subscription.trial_canceled_at) {
      return new Response(
        JSON.stringify({ error: "Trial already canceled" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Cancel the trial - prevent future auto-charge
    const { error: updateError } = await supabase
      .from("subscriptions_v2")
      .update({
        trial_canceled_at: new Date().toISOString(),
        trial_canceled_by: reason || "user_request",
        // Keep access until trial end if configured
        status: subscription.keep_access_until_trial_end ? "trial" : "canceled",
        canceled_at: subscription.keep_access_until_trial_end ? null : new Date().toISOString(),
        cancel_reason: reason || "Trial canceled by user",
      })
      .eq("id", subscriptionId);

    if (updateError) {
      console.error("[cancel-trial] Error updating subscription:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to cancel trial" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log the cancellation
    await supabase.from("audit_logs").insert({
      action: "trial_canceled",
      actor_user_id: subscription.user_id,
      target_user_id: subscription.user_id,
      meta: {
        subscription_id: subscriptionId,
        product_id: subscription.product_id,
        reason: reason || "user_request",
        trial_end_at: subscription.trial_end_at,
        keep_access_until_trial_end: subscription.keep_access_until_trial_end,
      },
    });

    console.log(`[cancel-trial] Successfully canceled trial for subscription: ${subscriptionId}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: subscription.keep_access_until_trial_end
          ? `Trial отменен. Доступ сохранится до ${new Date(subscription.trial_end_at).toLocaleDateString("ru-RU")}`
          : "Trial отменен и доступ прекращен",
        access_until: subscription.keep_access_until_trial_end ? subscription.trial_end_at : null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[cancel-trial] Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
