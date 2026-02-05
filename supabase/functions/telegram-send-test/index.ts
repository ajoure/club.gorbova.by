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
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // User client for auth
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Admin client for reading bot tokens (RLS protected)
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

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

    // Get user's Telegram ID from profile
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("telegram_user_id, telegram_username")
      .eq("user_id", userId)
      .single();

    if (profileError || !profile?.telegram_user_id) {
      return new Response(JSON.stringify({ 
        error: "Telegram не привязан к вашему профилю",
        details: "Привяжите Telegram в настройках профиля для получения тестовых сообщений"
      }), { 
        status: 400, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    const telegramChatId = profile.telegram_user_id;

    // Get bot token from environment (security policy: tokens stored in secrets, not DB)
    const botToken = Deno.env.get("PRIMARY_TELEGRAM_BOT_TOKEN");
    
    if (!botToken) {
      console.error("PRIMARY_TELEGRAM_BOT_TOKEN not configured");
      return new Response(JSON.stringify({ error: "Bot token not configured" }), { 
        status: 500, 
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
    const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
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
