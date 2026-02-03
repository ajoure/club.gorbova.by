import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { 
      status: 405, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { 
        status: 401, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Get current user
    const { data: userData, error: authError } = await supabase.auth.getUser();
    if (authError || !userData?.user?.id) {
      return new Response(JSON.stringify({ error: "Invalid token" }), { 
        status: 401, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    const userId = userData.user.id;

    // Get request body
    const body = await req.json();
    const { botId, messageText, buttonText, buttonUrl } = body;

    if (!botId || !messageText) {
      return new Response(JSON.stringify({ error: "botId and messageText required" }), { 
        status: 400, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    // Get user's Telegram link from profile
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("telegram_link")
      .eq("id", userId)
      .single();

    if (profileError || !profile?.telegram_link) {
      return new Response(JSON.stringify({ 
        error: "Telegram не привязан к вашему профилю",
        details: "Привяжите Telegram в настройках профиля для получения тестовых сообщений"
      }), { 
        status: 400, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    // Find user's chat_id via telegram_members table
    const { data: memberData, error: memberError } = await supabase
      .from("telegram_members")
      .select("telegram_id")
      .eq("username", profile.telegram_link.replace("@", "").toLowerCase())
      .limit(1)
      .maybeSingle();

    // Also try by user_id if profile linked
    let telegramChatId = memberData?.telegram_id;
    
    if (!telegramChatId) {
      // Try via telegram_profile_links
      const { data: linkData } = await supabase
        .from("telegram_profile_links")
        .select("telegram_user_id")
        .eq("profile_id", userId)
        .limit(1)
        .maybeSingle();
      
      telegramChatId = linkData?.telegram_user_id;
    }

    if (!telegramChatId) {
      return new Response(JSON.stringify({ 
        error: "Не удалось найти ваш Telegram ID",
        details: "Напишите боту /start чтобы привязать аккаунт"
      }), { 
        status: 400, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    // Get bot token
    const { data: bot, error: botError } = await supabase
      .from("telegram_bots")
      .select("bot_token")
      .eq("id", botId)
      .single();

    if (botError || !bot?.bot_token) {
      return new Response(JSON.stringify({ error: "Bot not found" }), { 
        status: 404, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    // Build message with button
    const keyboard = buttonText && buttonUrl ? {
      inline_keyboard: [[{
        text: buttonText,
        url: buttonUrl
      }]]
    } : undefined;

    // Send test message
    const telegramUrl = `https://api.telegram.org/bot${bot.bot_token}/sendMessage`;
    const telegramResponse = await fetch(telegramUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: telegramChatId,
        text: `🧪 ТЕСТОВОЕ СООБЩЕНИЕ\n\n${messageText}`,
        parse_mode: "HTML",
        reply_markup: keyboard,
      }),
    });

    if (!telegramResponse.ok) {
      const errText = await telegramResponse.text();
      console.error("Telegram API error:", errText);
      return new Response(JSON.stringify({ 
        error: "Telegram API error",
        details: errText
      }), { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    return new Response(JSON.stringify({ 
      success: true,
      message: "Тестовое сообщение отправлено"
    }), { 
      status: 200, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });

  } catch (error: unknown) {
    console.error("Error in telegram-send-test:", error);
    const message = error instanceof Error ? error.message : "Internal error";
    return new Response(JSON.stringify({ error: message }), { 
      status: 500, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }
});
