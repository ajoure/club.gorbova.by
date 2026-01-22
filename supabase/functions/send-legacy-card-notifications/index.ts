import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Check for service key bypass (for internal calls)
    const body = await req.json().catch(() => ({}));
    const isServiceCall = body.service_key === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.substring(0, 20);

    // Auth check (skip for service calls)
    if (!isServiceCall) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        return new Response(JSON.stringify({ error: "Invalid token" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Permission check
      const { data: hasPermission } = await supabase.rpc("has_permission", {
        _user_id: user.id,
        _permission_code: "entitlements manage",
      });

      if (!hasPermission) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Get users who already received notification
    const { data: alreadyNotified } = await supabase
      .from("telegram_logs")
      .select("user_id")
      .eq("action", "legacy_card_notification");

    const notifiedUserIds = new Set((alreadyNotified || []).map(n => n.user_id));

    // Get users with legacy cards
    const { data: legacyCardUsers } = await supabase
      .from("payment_methods")
      .select("user_id")
      .eq("supports_recurring", false)
      .eq("status", "revoked");

    const legacyCardUserIds = new Set((legacyCardUsers || []).map(u => u.user_id));

    // Filter to users with legacy cards who haven't been notified
    const { data: allProfiles } = await supabase
      .from("profiles")
      .select("id, user_id, full_name, email, telegram_user_id")
      .not("telegram_user_id", "is", null);

    const usersNeedingNotification = (allProfiles || []).filter(p => 
      p.user_id && 
      legacyCardUserIds.has(p.user_id) && 
      !notifiedUserIds.has(p.user_id)
    );

    console.log(`Found ${usersNeedingNotification.length} users needing notification`);

    const results: { user_id: string; name: string; email: string; status: string; error?: string }[] = [];
    let successCount = 0;
    let failCount = 0;

    // Send notifications
    for (const profile of usersNeedingNotification) {
      try {
        const { data: notifyResult, error: notifyError } = await supabase.functions.invoke(
          "telegram-send-notification",
          {
            body: {
              user_id: profile.user_id,
              message_type: "legacy_card_notification",
            },
          }
        );

        if (notifyError) {
          console.error(`Error for ${profile.email}:`, notifyError);
          results.push({
            user_id: profile.user_id,
            name: profile.full_name || "Unknown",
            email: profile.email || "Unknown",
            status: "error",
            error: notifyError.message,
          });
          failCount++;
        } else if (notifyResult?.success) {
          results.push({
            user_id: profile.user_id,
            name: profile.full_name || "Unknown",
            email: profile.email || "Unknown",
            status: "sent",
          });
          successCount++;
        } else {
          results.push({
            user_id: profile.user_id,
            name: profile.full_name || "Unknown",
            email: profile.email || "Unknown",
            status: notifyResult?.status || "unknown",
            error: notifyResult?.error,
          });
          if (notifyResult?.status === "blocked" || notifyResult?.status === "skipped") {
            // These are expected states, not failures
          } else {
            failCount++;
          }
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (err) {
        console.error(`Exception for ${profile.email}:`, err);
        results.push({
          user_id: profile.user_id,
          name: profile.full_name || "Unknown",
          email: profile.email || "Unknown",
          status: "error",
          error: String(err),
        });
        failCount++;
      }
    }

    // Log the operation (only for authenticated calls)
    if (!isServiceCall) {
      const authHeader = req.headers.get("Authorization");
      const token = authHeader?.replace("Bearer ", "");
      if (token) {
        const { data: { user } } = await supabase.auth.getUser(token);
        if (user) {
          await supabase.from("audit_logs").insert({
            action: "LEGACY_CARD_MASS_NOTIFICATION",
            actor_type: "admin",
            actor_user_id: user.id,
            meta: {
              total: usersNeedingNotification.length,
              success: successCount,
              failed: failCount,
            },
          });
        }
      }
    } else {
      await supabase.from("audit_logs").insert({
        action: "LEGACY_CARD_MASS_NOTIFICATION",
        actor_type: "system",
        actor_label: "send-legacy-card-notifications",
        meta: {
          total: usersNeedingNotification.length,
          success: successCount,
          failed: failCount,
        },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        total: usersNeedingNotification.length,
        sent: successCount,
        failed: failCount,
        results,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    console.error("Function error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
