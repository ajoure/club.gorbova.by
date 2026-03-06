import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { resolveSystemTokens, extractUsedTokens } from "../_shared/systemTokens.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Resolve standard contact tokens in a message template.
 */
function resolveContactTokens(
  text: string,
  profile: { full_name?: string | null; email?: string | null; phone?: string | null; telegram_username?: string | null }
): string {
  if (!text.includes('{{')) return text;
  
  const fullName = profile.full_name || '';
  const parts = fullName.split(/\s+/);
  const firstName = parts[0] || '';
  const lastName = parts.slice(1).join(' ') || '';

  return text
    .replace(/\{\{full_name\}\}/g, fullName)
    .replace(/\{\{first_name\}\}/g, firstName)
    .replace(/\{\{last_name\}\}/g, lastName)
    .replace(/\{\{name\}\}/g, fullName)
    .replace(/\{\{email\}\}/g, profile.email || '')
    .replace(/\{\{phone\}\}/g, profile.phone || '')
    .replace(/\{\{telegram_username\}\}/g, profile.telegram_username || '');
}

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

    // Get user's Telegram ID and contact fields from profile
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("telegram_user_id, telegram_username, full_name, first_name, last_name, email, phone")
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

    // Resolve tokens: contact first, then system
    const now = new Date();
    const tokensInfo = extractUsedTokens(messageText);
    let personalizedMessage = resolveContactTokens(messageText, profile);
    personalizedMessage = resolveSystemTokens(personalizedMessage, now);

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
        text: `🧪 ТЕСТОВОЕ СООБЩЕНИЕ\n\n${personalizedMessage}`,
        parse_mode: "Markdown",
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

    // Log token usage
    if (tokensInfo.contact.length > 0 || tokensInfo.system.length > 0) {
      await supabaseAdmin.from('audit_logs').insert({
        actor_type: 'system',
        actor_user_id: userId,
        actor_label: 'telegram-send-test',
        action: 'broadcast.tokens_resolved',
        meta: {
          channel: 'telegram',
          type: 'test',
          sent: 1,
          failed: 0,
          tokens_used_contact: tokensInfo.contact,
          tokens_used_system: tokensInfo.system,
        },
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
