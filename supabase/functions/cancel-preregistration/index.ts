import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Get user from JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authorization required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create client with user's token to verify auth
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      console.error("Auth error:", userError);
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { preregistrationId } = await req.json();

    if (!preregistrationId) {
      return new Response(
        JSON.stringify({ error: "preregistrationId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use service role to bypass RLS for update
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Update only if:
    // 1. ID matches
    // 2. user_id matches the authenticated user
    // 3. status is new or contacted (can be cancelled)
    const { data: updated, error: updateError } = await supabase
      .from("course_preregistrations")
      .update({ 
        status: "cancelled",
        updated_at: new Date().toISOString(),
      })
      .eq("id", preregistrationId)
      .eq("user_id", user.id)
      .in("status", ["new", "contacted"])
      .select("id, status, product_code")
      .maybeSingle();

    if (updateError) {
      console.error("Update error:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to cancel preregistration", details: updateError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!updated) {
      // Check if preregistration exists but doesn't match conditions
      const { data: existing } = await supabase
        .from("course_preregistrations")
        .select("id, user_id, status")
        .eq("id", preregistrationId)
        .maybeSingle();

      if (!existing) {
        return new Response(
          JSON.stringify({ error: "Preregistration not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (existing.user_id !== user.id) {
        return new Response(
          JSON.stringify({ error: "Not authorized to cancel this preregistration" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!["new", "contacted"].includes(existing.status)) {
        return new Response(
          JSON.stringify({ error: `Cannot cancel preregistration in status: ${existing.status}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    console.log(`Preregistration ${preregistrationId} cancelled by user ${user.id}`);

    // Add audit log
    try {
      await supabase.from("audit_logs").insert({
        actor_type: "user",
        actor_user_id: user.id,
        actor_label: user.email || user.id,
        action: "user.cancel_preregistration",
        target_user_id: user.id,
        meta: {
          preregistration_id: preregistrationId,
          product_code: updated?.product_code,
        },
      });
    } catch (auditError) {
      console.error("Audit log error (non-critical):", auditError);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Бронь успешно отменена",
        cancelled: updated,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error cancelling preregistration:", error);
    return new Response(
      JSON.stringify({ error: "Internal error", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
