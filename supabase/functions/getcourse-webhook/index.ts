import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Verify webhook using configured secret
async function verifyWebhookSecret(req: Request, instanceId: string | null, supabase: any): Promise<{ valid: boolean; reason?: string }> {
  if (!instanceId) {
    return { valid: false, reason: 'no_instance_id' };
  }
  
  // Get configured webhook secret from integration instance
  const { data: instance } = await supabase
    .from('integration_instances')
    .select('config')
    .eq('id', instanceId)
    .single();
  
  const webhookSecret = instance?.config?.webhook_secret || Deno.env.get('GETCOURSE_WEBHOOK_SECRET');
  
  if (!webhookSecret) {
    // If no secret configured, allow but log warning
    console.warn('No GetCourse webhook secret configured - verification skipped');
    return { valid: true, reason: 'no_secret_configured' };
  }
  
  // Check for secret in query params or headers
  const url = new URL(req.url);
  const querySecret = url.searchParams.get('secret');
  const headerSecret = req.headers.get('X-Webhook-Secret');
  
  if (querySecret === webhookSecret || headerSecret === webhookSecret) {
    return { valid: true };
  }
  
  return { valid: false, reason: 'invalid_secret' };
}

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

    // Verify webhook secret
    const verification = await verifyWebhookSecret(req, instanceId, supabase);
    if (!verification.valid) {
      console.error('GetCourse webhook verification failed:', verification.reason);
      return new Response(
        JSON.stringify({ error: 'Unauthorized', reason: verification.reason }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    if (verification.reason === 'no_secret_configured') {
      console.log('Webhook processed without secret verification');
    } else {
      console.log('GetCourse webhook verified successfully');
    }

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

      // Get instance config for auto-sync
      const { data: instance } = await supabase
        .from("integration_instances")
        .select("*")
        .eq("id", instanceId)
        .single();

      if (instance) {
        // Get sync settings
        const { data: syncSettings } = await supabase
          .from("integration_sync_settings")
          .select("*")
          .eq("instance_id", instanceId)
          .eq("is_enabled", true);

        // Trigger auto-sync based on action
        const action = body.action as string;
        let entityToSync: string | null = null;

        switch (action) {
          case "user_added":
          case "user_updated":
            entityToSync = "users";
            break;
          case "deal_created":
          case "deal_updated":
          case "deal_payed":
            entityToSync = "orders";
            break;
          case "payment_received":
            entityToSync = "payments";
            break;
        }

        // Check if this entity is configured for sync
        const shouldSync = syncSettings?.some(s => 
          s.entity_type === entityToSync && 
          (s.direction === "import" || s.direction === "bidirectional")
        );

        if (shouldSync && entityToSync) {
          console.log(`Auto-syncing ${entityToSync} due to webhook action: ${action}`);
          
          // Log sync start
          await supabase.from("integration_sync_logs").insert({
            instance_id: instanceId,
            entity_type: entityToSync,
            direction: "import",
            result: "success",
            payload_meta: {
              trigger: "webhook",
              action,
              object_id: body.user_id || body.deal_id || body.payment_id,
            },
          });

          // In a real implementation, you would process the webhook data here
          // For now, we log the event for manual review
        }
      }
    }

    // Process GetCourse events
    const action = body.action as string;

    switch (action) {
      case "user_added":
      case "user_updated": {
        console.log("User event:", {
          user_id: body.user_id,
          email: body.email,
          name: body.name,
        });
        break;
      }

      case "deal_created":
      case "deal_updated":
      case "deal_payed": {
        console.log("Deal event:", {
          deal_id: body.deal_id,
          status: body.status,
          cost: body.cost,
        });
        break;
      }

      case "payment_received": {
        console.log("Payment event:", {
          payment_id: body.payment_id,
          amount: body.amount,
          deal_id: body.deal_id,
        });
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
