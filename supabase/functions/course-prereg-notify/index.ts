import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractFirstName } from "../_shared/recipient-name.ts";

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

    // Find user profile by email to get telegram_user_id
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, telegram_user_id, telegram_username, full_name")
      .eq("email", data.email)
      .single();

    if (!profile?.telegram_user_id) {
      console.log("User has no linked Telegram, skipping notification. Email:", data.email);
      return new Response(
        JSON.stringify({ success: true, notification_sent: false, reason: "no_telegram_linked" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get the support bot (gorbovabybot)
    const { data: bots } = await supabaseAdmin
      .from("telegram_bots")
      .select("*")
      .eq("status", "active")
      .order("is_primary", { ascending: false })
      .limit(1);

    if (!bots || bots.length === 0) {
      console.log("No active bot found, skipping Telegram notification");
      return new Response(
        JSON.stringify({ success: true, notification_sent: false, reason: "no_bot" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const bot = bots[0];
    const botToken = bot.bot_token_encrypted; // Token stored in this field

    // Format confirmation message for the CLIENT (обращение строго на «Вы»)
    const productName = data.product_code === "cb20_predzapis" ? "«Ценный бухгалтер»" : data.product_code;
    // Безопасное обращение по имени: для MarkdownV2 экранируем
    const firstName = extractFirstName(profile);
    const greetingLine = firstName
      ? `${escapeMarkdown(firstName)}, Вы успешно записались на курс ${escapeMarkdown(productName)}\\.`
      : `Вы успешно записались на курс ${escapeMarkdown(productName)}\\.`;

    const message = `✅ *Спасибо за предзапись\\!*

${greetingLine}

${data.tariff_name ? `📦 *Тариф:* ${escapeMarkdown(data.tariff_name)}` : ""}

Мы свяжемся с Вами, когда откроется набор на курс\\.

Если у Вас есть вопросы — напишите нам\\!`;

    // Send confirmation to the CLIENT via Telegram
    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: profile.telegram_user_id,
          text: message,
          parse_mode: "MarkdownV2",
        }),
      }
    );

    const telegramResult = await telegramResponse.json();
    
    if (!telegramResult.ok) {
      console.error("Telegram API error:", telegramResult);
      
      // Log the error but don't fail the request
      await supabaseAdmin.from("telegram_logs").insert({
        bot_id: bot.id,
        event_type: "prereg_notification_failed",
        user_id: profile.id,
        payload: { error: telegramResult, preregistration_id: data.id },
      });
      
      return new Response(
        JSON.stringify({ success: true, notification_sent: false, reason: "telegram_error", error: telegramResult }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log success
    await supabaseAdmin.from("telegram_logs").insert({
      bot_id: bot.id,
      event_type: "course_prereg_confirmation",
      user_id: profile.id,
      payload: { preregistration_id: data.id, message_id: telegramResult.result?.message_id },
    });

    console.log("Confirmation sent to user:", profile.telegram_user_id);

    return new Response(
      JSON.stringify({ success: true, notification_sent: true, telegram_user_id: profile.telegram_user_id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("Error in course-prereg-notify:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function escapeMarkdown(text: string): string {
  // Escape special characters for MarkdownV2
  return text.replace(/[_*[\]()~`>#+=|{}.!\\-]/g, "\\$&");
}
