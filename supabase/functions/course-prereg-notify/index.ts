import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PreregistrationData {
  id: string;
  name: string;
  email: string;
  phone?: string;
  product_code: string;
  tariff_name?: string;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const data: PreregistrationData = await req.json();
    console.log("New preregistration:", data);

    // Get default notification bot
    const { data: bots } = await supabaseAdmin
      .from("telegram_bots")
      .select("*")
      .eq("is_notification_bot", true)
      .eq("status", "active")
      .limit(1);

    if (!bots || bots.length === 0) {
      console.log("No notification bot configured, skipping Telegram notification");
      return new Response(
        JSON.stringify({ success: true, notification_sent: false, reason: "no_bot" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const bot = bots[0];
    const adminChatId = bot.admin_chat_id;

    if (!adminChatId) {
      console.log("No admin chat ID configured for bot");
      return new Response(
        JSON.stringify({ success: true, notification_sent: false, reason: "no_admin_chat" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Format message
    const message = `📝 *Новая предзапись на курс*

👤 *Имя:* ${escapeMarkdown(data.name)}
📧 *Email:* ${escapeMarkdown(data.email)}
${data.phone ? `📞 *Телефон:* ${escapeMarkdown(data.phone)}` : ""}
${data.tariff_name ? `📦 *Тариф:* ${escapeMarkdown(data.tariff_name)}` : ""}
🎓 *Продукт:* ${escapeMarkdown(data.product_code)}

🕐 *Время:* ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Minsk" })}`;

    // Send via Telegram API
    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${bot.token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: adminChatId,
          text: message,
          parse_mode: "Markdown",
        }),
      }
    );

    const telegramResult = await telegramResponse.json();
    
    if (!telegramResult.ok) {
      console.error("Telegram API error:", telegramResult);
      
      // Log the error but don't fail the request
      await supabaseAdmin.from("telegram_logs").insert({
        bot_id: bot.id,
        event_type: "notification_failed",
        user_id: null,
        payload: { error: telegramResult, preregistration_id: data.id },
      });
      
      return new Response(
        JSON.stringify({ success: true, notification_sent: false, reason: "telegram_error" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log success
    await supabaseAdmin.from("telegram_logs").insert({
      bot_id: bot.id,
      event_type: "course_prereg_notification",
      user_id: null,
      payload: { preregistration_id: data.id, message_id: telegramResult.result?.message_id },
    });

    return new Response(
      JSON.stringify({ success: true, notification_sent: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in course-prereg-notify:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&");
}
