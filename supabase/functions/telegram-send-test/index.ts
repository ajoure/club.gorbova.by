import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { resolveSystemTokens, extractUsedTokens } from "../_shared/systemTokens.ts";
import { resolveCustomFieldTokens, extractCustomFieldTokenIds } from "../_shared/customFieldTokens.ts";

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
    // Legacy unprefixed
    .replace(/\{\{full_name\}\}/g, fullName)
    .replace(/\{\{first_name\}\}/g, firstName)
    .replace(/\{\{last_name\}\}/g, lastName)
    .replace(/\{\{name\}\}/g, fullName)
    .replace(/\{\{email\}\}/g, profile.email || '')
    .replace(/\{\{phone\}\}/g, profile.phone || '')
    .replace(/\{\{telegram_username\}\}/g, profile.telegram_username || '')
    // Canonical prefixed (Sprint canonical picker)
    .replace(/\{\{contact\.full_name\}\}/g, fullName)
    .replace(/\{\{contact\.first_name\}\}/g, firstName)
    .replace(/\{\{contact\.last_name\}\}/g, lastName)
    .replace(/\{\{contact\.email\}\}/g, profile.email || '')
    .replace(/\{\{contact\.phone\}\}/g, profile.phone || '')
    .replace(/\{\{contact\.telegram_username\}\}/g, profile.telegram_username || '');
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Метод не поддерживается" }), {
      status: 405, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Требуется авторизация" }), {
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

    // Admin client for reading data (RLS bypass)
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // Get current user via getClaims (works with signing-keys / ES256 JWTs)
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims?.sub) {
      console.error("getClaims error:", claimsError);
      return new Response(JSON.stringify({ error: "Сессия недействительна" }), {
        status: 401, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    const userId = claimsData.claims.sub;

    const [{ data: canManage }, { data: isAdmin }, { data: isSuperAdmin }] = await Promise.all([
      supabaseAdmin.rpc("has_admin_section_access", {
        _user_id: userId,
        _section_code: "communication",
        _min_level: "manage",
      }),
      supabaseAdmin.rpc("has_role_v2", { _user_id: userId, _role_code: "admin" }),
      supabaseAdmin.rpc("has_role_v2", { _user_id: userId, _role_code: "super_admin" }),
    ]);
    if (!canManage && !isAdmin && !isSuperAdmin) {
      return new Response(JSON.stringify({ error: "Недостаточно прав для управления рассылками" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // JSON и multipart используют один контракт, чтобы тестировать те же медиа,
    // которые администратор видит в предпросмотре.
    let botId = "";
    let messageText = "";
    let buttonText = "";
    let buttonUrl = "";
    let product_context_id: string | null = null;
    let mediaType: string | null = null;
    let mediaFileName = "media";
    let mediaBuffer: ArrayBuffer | null = null;
    let mediaStoragePath: string | null = null;
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      botId = String(form.get("botId") || "");
      messageText = String(form.get("messageText") || "");
      buttonText = String(form.get("buttonText") || "");
      buttonUrl = String(form.get("buttonUrl") || "");
      product_context_id = String(form.get("product_context_id") || "") || null;
      mediaType = String(form.get("media_type") || "") || null;
      const media = form.get("media");
      if (media instanceof File) {
        mediaFileName = media.name;
        mediaBuffer = await media.arrayBuffer();
      }
    } else {
      const body = await req.json();
      botId = String(body.botId || "");
      messageText = String(body.messageText || "");
      buttonText = String(body.buttonText || "");
      buttonUrl = String(body.buttonUrl || "");
      product_context_id = body.product_context_id || null;
      mediaType = body.media_type || null;
      mediaFileName = body.media_file_name || "media";
      mediaStoragePath = body.media_storage_path || null;
    }

    if (!botId || (!messageText && !mediaBuffer && !mediaStoragePath)) {
      return new Response(JSON.stringify({ error: "Выберите бота и добавьте текст или медиафайл" }), {
        status: 400, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    // Normalize product_context_id
    const productContextId = (product_context_id && product_context_id !== 'all') ? product_context_id : null;

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

    const { data: bot } = await supabaseAdmin
      .from("telegram_bots")
      .select("bot_token_encrypted")
      .eq("id", botId)
      .eq("status", "active")
      .maybeSingle();
    const botToken = bot?.bot_token_encrypted || Deno.env.get("PRIMARY_TELEGRAM_BOT_TOKEN");
    if (!botToken) {
      return new Response(JSON.stringify({ error: "У выбранного бота не настроен токен" }), {
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    // Resolve chain: Contact → System → Custom Fields
    const now = new Date();
    const tokensInfo = extractUsedTokens(messageText);
    const cfFieldIds = extractCustomFieldTokenIds(messageText);

    let personalizedMessage = resolveContactTokens(messageText, profile);
    personalizedMessage = resolveSystemTokens(personalizedMessage, now);
    
    const cfResult = await resolveCustomFieldTokens(personalizedMessage, productContextId, supabaseAdmin);
    personalizedMessage = cfResult.text;

    // Build message with button
    const keyboard = buttonText && buttonUrl ? {
      inline_keyboard: [[{
        text: buttonText,
        url: buttonUrl
      }]]
    } : undefined;

    if (!mediaBuffer && mediaStoragePath) {
      const slash = mediaStoragePath.indexOf("/");
      const bucket = slash > 0 ? mediaStoragePath.slice(0, slash) : "telegram-media";
      const key = slash > 0 ? mediaStoragePath.slice(slash + 1) : mediaStoragePath;
      const { data: signed, error: signError } = await supabaseAdmin.storage.from(bucket).createSignedUrl(key, 600);
      if (signError || !signed?.signedUrl) throw new Error("Не удалось открыть сохранённый медиафайл");
      const downloaded = await fetch(signed.signedUrl);
      if (!downloaded.ok) throw new Error("Не удалось загрузить сохранённый медиафайл");
      mediaBuffer = await downloaded.arrayBuffer();
    }

    const testMessage = personalizedMessage ? `🧪 ТЕСТОВОЕ СООБЩЕНИЕ\n\n${personalizedMessage}` : "";
    let telegramResponse: Response;
    if (mediaBuffer && mediaType) {
      const config: Record<string, { method: string; field: string }> = {
        photo: { method: "sendPhoto", field: "photo" },
        animation: { method: "sendAnimation", field: "animation" },
        video: { method: "sendVideo", field: "video" },
        audio: { method: "sendAudio", field: "audio" },
        video_note: { method: "sendVideoNote", field: "video_note" },
        document: { method: "sendDocument", field: "document" },
      };
      const selected = config[mediaType] || config.document;
      const shouldSplit = Boolean(testMessage && (mediaType === "video_note" || testMessage.length > 1024));
      const mediaForm = new FormData();
      mediaForm.append("chat_id", String(telegramChatId));
      mediaForm.append(selected.field, new Blob([mediaBuffer]), mediaFileName);
      if (!shouldSplit && testMessage) {
        mediaForm.append("caption", testMessage);
        mediaForm.append("parse_mode", "Markdown");
      }
      if (!shouldSplit && keyboard) mediaForm.append("reply_markup", JSON.stringify(keyboard));
      telegramResponse = await fetch(`https://api.telegram.org/bot${botToken}/${selected.method}`, {
        method: "POST",
        body: mediaForm,
      });
      if (telegramResponse.ok && shouldSplit) {
        telegramResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: telegramChatId, text: testMessage, parse_mode: "Markdown", reply_markup: keyboard }),
        });
      }
    } else {
      telegramResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: telegramChatId, text: testMessage, parse_mode: "Markdown", reply_markup: keyboard }),
      });
    }

    if (!telegramResponse.ok) {
      const errText = await telegramResponse.text();
      console.error("Telegram API error:", errText);
      return new Response(JSON.stringify({ 
        error: "Telegram отклонил тестовое сообщение",
        details: errText
      }), { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    // Log token usage
    if (tokensInfo.contact.length > 0 || tokensInfo.system.length > 0 || cfFieldIds.length > 0) {
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
          tokens_used_cf_ids: cfFieldIds,
          cf_product_id: productContextId,
          cf_tokens_ignored: cfResult.cfTokensIgnored,
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
    const message = error instanceof Error ? error.message : "Внутренняя ошибка";
    return new Response(JSON.stringify({ error: message }), { 
      status: 500, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }
});
