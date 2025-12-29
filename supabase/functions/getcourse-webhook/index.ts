import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const url = new URL(req.url);
    const instanceId = url.searchParams.get("instance_id");

    // Parse request body
    let body: Record<string, unknown> = {};
    try {
      const text = await req.text();
      if (text) {
        // GetCourse sends form-encoded data
        if (req.headers.get("content-type")?.includes("application/x-www-form-urlencoded")) {
          const params = new URLSearchParams(text);
          body = Object.fromEntries(params.entries());
        } else {
          body = JSON.parse(text);
        }
      }
    } catch (e) {
      console.log("Body parse error:", e);
    }

    console.log("GetCourse webhook received:", {
      instanceId,
      body: JSON.stringify(body).slice(0, 500),
    });

    // Log the webhook event
    if (instanceId) {
      await supabase.from("integration_logs").insert({
        instance_id: instanceId,
        event_type: "webhook",
        result: "success",
        payload_meta: {
          action: body.action || "unknown",
          user_id: body.user_id,
          deal_id: body.deal_id,
          received_at: new Date().toISOString(),
        },
      });
    }

    // Process GetCourse events
    const action = body.action as string;

    switch (action) {
      case "user_added":
      case "user_updated": {
        console.log("User event:", body);
        // Handle user creation/update
        break;
      }

      case "deal_created":
      case "deal_updated":
      case "deal_payed": {
        console.log("Deal event:", body);
        // Handle deal/order events
        break;
      }

      case "payment_received": {
        console.log("Payment event:", body);
        // Handle payment notifications
        break;
      }

      default:
        console.log("Unknown action:", action);
    }

    return new Response(
      JSON.stringify({ success: true }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);
    console.error("GetCourse webhook error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
