import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Notification templates in Katerina Gorbova's style
const TEMPLATES = {
  // PATCH-8: Tomorrow charge notification (HAS_CARD)
  tomorrow_charge: `💫 Привет!

Завтра в 09:00 с твоей карты автоматически спишется 250 BYN за «Бухгалтерия как бизнес».

Убедись, что на карте достаточно средств 💳

Если что-то не так — напиши мне, разберёмся!

С теплом,
Катерина 🤍`,

  // PATCH-9: No card notification (NO_CARD)
  no_card: `⚠️ Важно: карта не привязана

Привет! Завтра начинается списание за «Бухгалтерия как бизнес», но у тебя не привязана карта.

Без карты автоматически оплатить не получится 😔

Привяжи карту за 1 минуту:
🔗 https://business-training.gorbova.by/settings/payment-methods

Если нужна помощь — напиши мне!

Катерина 🤍`,
};

interface NotifyRequest {
  type: "tomorrow_charge" | "no_card" | "dry_run";
  product_code?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body: NotifyRequest = await req.json();
    const notifyType = body.type;
    const productCode = body.product_code || "buh_business";
    const productId = "85046734-2282-4ded-b0d3-8c66c8f5bc2b";

    console.log(`buh-business-notify started: type=${notifyType}, product_code=${productCode}`);

    // Get bot token (use primary bot for notifications)
    const { data: linkBot } = await supabase
      .from("telegram_bots")
      .select("bot_token_encrypted, id")
      .eq("is_primary", true)
      .eq("status", "active")
      .limit(1)
      .single();

    if (!linkBot?.bot_token_encrypted) {
      throw new Error("No active primary bot found");
    }
    
    const botToken = linkBot.bot_token_encrypted;


    const results = {
      processed: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      errors: [] as string[],
      users: [] as { email: string; name: string; status: string }[],
    };

    if (notifyType === "tomorrow_charge") {
      // PATCH-8: Get preregistrations (without join, fetch profile separately)
      const { data: preregistrations, error } = await supabase
        .from("course_preregistrations")
        .select("id, email, name, user_id")
        .eq("product_code", productCode)
        .in("status", ["new", "confirmed", "contacted"])
        .not("user_id", "is", null);

      if (error) throw error;

      for (const prereg of preregistrations || []) {
        results.processed++;
        
        // Fetch profile separately
        const { data: profile } = await supabase
          .from("profiles")
          .select("telegram_user_id, full_name")
          .eq("user_id", prereg.user_id)
          .single();
          
        const telegramUserId = profile?.telegram_user_id;

        // Check if has active payment method
        const { data: pm } = await supabase
          .from("payment_methods")
          .select("id")
          .eq("user_id", prereg.user_id)
          .eq("status", "active")
          .limit(1)
          .maybeSingle();

        if (!pm) {
          results.skipped++;
          continue;
        }

        // Check if already paid
        const { data: paidOrder } = await supabase
          .from("orders_v2")
          .select("id")
          .eq("product_id", productId)
          .eq("status", "paid")
          .or(`user_id.eq.${prereg.user_id},customer_email.ilike.${prereg.email}`)
          .limit(1)
          .maybeSingle();

        if (paidOrder) {
          results.skipped++;
          continue;
        }

        if (!telegramUserId) {
          results.skipped++;
          results.users.push({ email: prereg.email, name: prereg.name, status: "no_telegram" });
          continue;
        }

        try {
          const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: telegramUserId,
              text: TEMPLATES.tomorrow_charge,
              parse_mode: "Markdown",
            }),
          });

          const result = await response.json();
          if (result.ok) {
            results.sent++;
            results.users.push({ email: prereg.email, name: prereg.name, status: "sent" });
            
            // Log notification with message_text
            await supabase.from("telegram_logs").insert({
              user_id: prereg.user_id,
              action: "PREREG_CHARGE_REMINDER",
              event_type: "preregistration_tomorrow_charge",
              status: "ok",
              message_text: TEMPLATES.tomorrow_charge,
              meta: { 
                preregistration_id: prereg.id, 
                message_id: result.result?.message_id,
                type: "tomorrow_charge",
              },
            });
            
            // Update prereg billing.notified
            const { data: preregData } = await supabase
              .from("course_preregistrations")
              .select("meta")
              .eq("id", prereg.id)
              .single();
            const currentMeta = preregData?.meta || {};
            const currentBilling = (currentMeta as any).billing || {};
            await supabase
              .from("course_preregistrations")
              .update({
                meta: {
                  ...currentMeta,
                  billing: {
                    ...currentBilling,
                    notified: {
                      ...(currentBilling.notified || {}),
                      tomorrow_charge_at: new Date().toISOString(),
                    },
                  },
                },
              })
              .eq("id", prereg.id);
          } else {
            results.failed++;
            results.errors.push(`${prereg.email}: ${result.description}`);
            results.users.push({ email: prereg.email, name: prereg.name, status: `failed: ${result.description}` });
          }
        } catch (e) {
          results.failed++;
          results.errors.push(`${prereg.email}: ${e}`);
        }
      }
    } else if (notifyType === "no_card") {
      // PATCH-9: Get preregistrations without cards (fetch profile separately)
      const { data: preregistrations, error } = await supabase
        .from("course_preregistrations")
        .select("id, email, name, user_id")
        .eq("product_code", productCode)
        .in("status", ["new", "confirmed", "contacted"])
        .not("user_id", "is", null);

      if (error) throw error;

      const processedUserIds = new Set<string>();

      for (const prereg of preregistrations || []) {
        // Skip duplicate users (same user_id)
        if (processedUserIds.has(prereg.user_id)) continue;

        results.processed++;
        
        // Fetch profile separately
        const { data: profile } = await supabase
          .from("profiles")
          .select("telegram_user_id, full_name")
          .eq("user_id", prereg.user_id)
          .single();
          
        const telegramUserId = profile?.telegram_user_id;

        // Check if has active payment method
        const { data: pm } = await supabase
          .from("payment_methods")
          .select("id")
          .eq("user_id", prereg.user_id)
          .eq("status", "active")
          .limit(1)
          .maybeSingle();

        if (pm) {
          results.skipped++; // Has card, skip
          continue;
        }

        // Check if already paid
        const { data: paidOrder } = await supabase
          .from("orders_v2")
          .select("id")
          .eq("product_id", productId)
          .eq("status", "paid")
          .or(`user_id.eq.${prereg.user_id},customer_email.ilike.${prereg.email}`)
          .limit(1)
          .maybeSingle();

        if (paidOrder) {
          results.skipped++;
          continue;
        }

        processedUserIds.add(prereg.user_id);

        if (!telegramUserId) {
          results.skipped++;
          results.users.push({ email: prereg.email, name: prereg.name, status: "no_telegram" });
          continue;
        }

        try {
          const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: telegramUserId,
              text: TEMPLATES.no_card,
              parse_mode: "Markdown",
            }),
          });

          const result = await response.json();
          if (result.ok) {
            results.sent++;
            results.users.push({ email: prereg.email, name: prereg.name, status: "sent" });
            
            // Log notification with message_text
            await supabase.from("telegram_logs").insert({
              user_id: prereg.user_id,
              action: "PREREG_NO_CARD_WARNING",
              event_type: "preregistration_no_card",
              status: "ok",
              message_text: TEMPLATES.no_card,
              meta: { 
                preregistration_id: prereg.id, 
                message_id: result.result?.message_id,
                type: "no_card",
              },
            });
            
            // Update prereg billing.notified
            const { data: preregData } = await supabase
              .from("course_preregistrations")
              .select("meta")
              .eq("id", prereg.id)
              .single();
            const currentMeta = preregData?.meta || {};
            const currentBilling = (currentMeta as any).billing || {};
            await supabase
              .from("course_preregistrations")
              .update({
                meta: {
                  ...currentMeta,
                  billing: {
                    ...currentBilling,
                    billing_status: "no_card",
                    has_active_card: false,
                    notified: {
                      ...(currentBilling.notified || {}),
                      no_card_at: new Date().toISOString(),
                    },
                  },
                },
              })
              .eq("id", prereg.id);
          } else {
            results.failed++;
            results.errors.push(`${prereg.email}: ${result.description}`);
            results.users.push({ email: prereg.email, name: prereg.name, status: `failed: ${result.description}` });
          }
        } catch (e) {
          results.failed++;
          results.errors.push(`${prereg.email}: ${e}`);
        }
      }
    } else if (notifyType === "dry_run") {
      // Just return counts without sending
      const { data: hasCard } = await supabase.rpc("exec_sql", {
        sql: `
          SELECT COUNT(*) as cnt FROM course_preregistrations cp
          JOIN profiles p ON p.user_id = cp.user_id
          WHERE cp.product_code = 'buh_business'
            AND cp.status IN ('new', 'confirmed', 'contacted')
            AND EXISTS (SELECT 1 FROM payment_methods pm WHERE pm.user_id = cp.user_id AND pm.status = 'active')
            AND NOT EXISTS (SELECT 1 FROM orders_v2 o WHERE o.product_id = '${productId}' AND o.status = 'paid' AND o.user_id = cp.user_id)
        `,
      });

      const { data: noCard } = await supabase.rpc("exec_sql", {
        sql: `
          SELECT COUNT(DISTINCT cp.user_id) as cnt FROM course_preregistrations cp
          JOIN profiles p ON p.user_id = cp.user_id
          WHERE cp.product_code = 'buh_business'
            AND cp.status IN ('new', 'confirmed', 'contacted')
            AND NOT EXISTS (SELECT 1 FROM payment_methods pm WHERE pm.user_id = cp.user_id AND pm.status = 'active')
            AND NOT EXISTS (SELECT 1 FROM orders_v2 o WHERE o.product_id = '${productId}' AND o.status = 'paid' AND o.user_id = cp.user_id)
        `,
      });

      return new Response(JSON.stringify({
        success: true,
        dry_run: true,
        has_card_count: hasCard,
        no_card_count: noCard,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Audit log
    await supabase.from("audit_logs").insert({
      action: `buh_business.notify_${notifyType}`,
      actor_type: "system",
      actor_user_id: null,
      actor_label: "buh-business-notify",
      meta: {
        type: notifyType,
        processed: results.processed,
        sent: results.sent,
        failed: results.failed,
        skipped: results.skipped,
      },
    });

    console.log(`buh-business-notify completed:`, results);

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("buh-business-notify error:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
