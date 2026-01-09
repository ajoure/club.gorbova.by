import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface FileData {
  type: "photo" | "video" | "audio" | "document";
  name: string;
  base64: string;
}

interface ChatAction {
  action: "send_message" | "get_messages" | "fetch_profile_photo" | "get_user_info";
  user_id?: string;
  message?: string;
  file?: FileData;
  bot_id?: string;
  limit?: number;
}

async function fetchAndSaveTelegramPhoto(
  supabase: any,
  botToken: string,
  telegramUserId: number,
  userId: string
): Promise<string | null> {
  try {
    // Get user profile photos from Telegram
    const photosResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/getUserProfilePhotos?user_id=${telegramUserId}&limit=1`
    );
    const photosData = await photosResponse.json();

    if (!photosData.ok || !photosData.result?.photos?.[0]?.[0]) {
      console.log("No profile photo found for user", telegramUserId);
      return null;
    }

    // Get the smallest photo (good enough for avatar)
    const photo = photosData.result.photos[0][0];
    const fileId = photo.file_id;

    // Get file path
    const fileResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`
    );
    const fileData = await fileResponse.json();

    if (!fileData.ok || !fileData.result?.file_path) {
      console.log("Failed to get file path");
      return null;
    }

    // Download the photo
    const photoUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;
    const photoResponse = await fetch(photoUrl);
    const photoBlob = await photoResponse.arrayBuffer();

    // Upload to storage
    const fileName = `avatars/${userId}_telegram_${Date.now()}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(fileName, photoBlob, {
        contentType: "image/jpeg",
        upsert: true,
      });

    if (uploadError) {
      console.error("Failed to upload photo:", uploadError);
      return null;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from("avatars")
      .getPublicUrl(fileName);

    const avatarUrl = urlData?.publicUrl;

    if (avatarUrl) {
      // Update profile with avatar
      await supabase
        .from("profiles")
        .update({ avatar_url: avatarUrl })
        .eq("user_id", userId);
    }

    return avatarUrl;
  } catch (error) {
    console.error("Error fetching Telegram photo:", error);
    return null;
  }
}

async function telegramRequest(botToken: string, method: string, body: object) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json();
}

async function telegramSendFile(
  botToken: string,
  chatId: number,
  file: FileData,
  caption?: string
) {
  // Convert base64 to blob
  const binaryString = atob(file.base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const blob = new Blob([bytes]);

  const formData = new FormData();
  formData.append("chat_id", chatId.toString());
  if (caption) formData.append("caption", caption);

  // Determine the method and field name based on file type
  let method: string;
  let fieldName: string;
  
  switch (file.type) {
    case "photo":
      method = "sendPhoto";
      fieldName = "photo";
      break;
    case "video":
      method = "sendVideo";
      fieldName = "video";
      break;
    case "audio":
      method = "sendAudio";
      fieldName = "audio";
      break;
    default:
      method = "sendDocument";
      fieldName = "document";
  }

  formData.append(fieldName, blob, file.name);

  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    body: formData,
  });
  
  return response.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify admin access
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check admin role
    const { data: hasAdmin } = await supabase.rpc("has_role", {
      _user_id: user.id,
      _role: "admin",
    });

    if (!hasAdmin) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload: ChatAction = await req.json();
    const { action } = payload;

    switch (action) {
      case "send_message": {
        const { user_id, message, file, bot_id } = payload;

        if (!user_id || (!message && !file)) {
          return new Response(JSON.stringify({ error: "user_id and (message or file) required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Get user's telegram_user_id from profile
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("telegram_user_id, telegram_link_bot_id")
          .eq("user_id", user_id)
          .single();

        if (profileError || !profile?.telegram_user_id) {
          return new Response(JSON.stringify({ 
            error: "User has no linked Telegram account",
            success: false,
          }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Get bot token
        let botToken: string | null = null;
        let usedBotId: string | null = null;

        if (bot_id) {
          const { data: bot } = await supabase
            .from("telegram_bots")
            .select("id, bot_token_encrypted")
            .eq("id", bot_id)
            .single();
          if (bot?.bot_token_encrypted) {
            botToken = bot.bot_token_encrypted;
            usedBotId = bot.id;
          }
        }

        if (!botToken && profile.telegram_link_bot_id) {
          const { data: bot } = await supabase
            .from("telegram_bots")
            .select("id, bot_token_encrypted")
            .eq("id", profile.telegram_link_bot_id)
            .single();
          if (bot?.bot_token_encrypted) {
            botToken = bot.bot_token_encrypted;
            usedBotId = bot.id;
          }
        }

        // Fallback to any active bot if user's linked bot not found
        if (!botToken) {
          const { data: anyBot } = await supabase
            .from("telegram_bots")
            .select("id, bot_token_encrypted")
            .eq("status", "active")
            .limit(1)
            .single();
          if (anyBot?.bot_token_encrypted) {
            botToken = anyBot.bot_token_encrypted;
            usedBotId = anyBot.id;
          }
        }

        if (!botToken) {
          return new Response(JSON.stringify({ 
            error: "No bot available for sending messages",
            success: false,
          }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        let sendResult: any;
        
        if (file) {
          // Send file
          sendResult = await telegramSendFile(
            botToken, 
            profile.telegram_user_id, 
            file, 
            message || undefined
          );
        } else {
          // Send text message
          sendResult = await telegramRequest(botToken, "sendMessage", {
            chat_id: profile.telegram_user_id,
            text: message,
            parse_mode: "HTML",
          });
        }

        // Log the message
        const messageLogData = {
          user_id,
          telegram_user_id: profile.telegram_user_id,
          bot_id: usedBotId,
          direction: "outgoing",
          message_text: message || null,
          message_id: sendResult.ok ? sendResult.result.message_id : null,
          sent_by_admin: user.id,
          status: sendResult.ok ? "sent" : "failed",
          error_message: sendResult.ok ? null : sendResult.description,
          meta: { 
            telegram_response: sendResult,
            file_type: file?.type || null,
            file_name: file?.name || null,
          },
        };

        await supabase.from("telegram_messages").insert(messageLogData);

        // Also log to telegram_logs for consistency
        await supabase.from("telegram_logs").insert({
          user_id,
          action: file ? "ADMIN_CHAT_FILE" : "ADMIN_CHAT_MESSAGE",
          target: "user",
          status: sendResult.ok ? "ok" : "error",
          error_message: sendResult.ok ? null : sendResult.description,
          meta: {
            message_preview: message?.substring(0, 100),
            file_type: file?.type,
            file_name: file?.name,
            sent_by_admin: user.id,
          },
        });

        return new Response(JSON.stringify({
          success: sendResult.ok,
          message_id: sendResult.result?.message_id,
          error: sendResult.ok ? null : sendResult.description,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "get_messages": {
        const { user_id, limit = 50 } = payload;

        if (!user_id) {
          return new Response(JSON.stringify({ error: "user_id required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: messages, error: messagesError } = await supabase
          .from("telegram_messages")
          .select(`
            *,
            telegram_bots(id, bot_name, bot_username)
          `)
          .eq("user_id", user_id)
          .order("created_at", { ascending: true })
          .limit(limit);

        if (messagesError) {
          return new Response(JSON.stringify({ error: messagesError.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ messages: messages || [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "fetch_profile_photo": {
        const { user_id } = payload;

        if (!user_id) {
          return new Response(JSON.stringify({ error: "user_id required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Get user's telegram info
        const { data: profile } = await supabase
          .from("profiles")
          .select("telegram_user_id, telegram_link_bot_id, avatar_url")
          .eq("user_id", user_id)
          .single();

        if (!profile?.telegram_user_id) {
          return new Response(JSON.stringify({ 
            error: "User has no linked Telegram account",
            success: false,
          }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Get bot token
        let botToken: string | null = null;

        if (profile.telegram_link_bot_id) {
          const { data: bot } = await supabase
            .from("telegram_bots")
            .select("bot_token_encrypted")
            .eq("id", profile.telegram_link_bot_id)
            .single();
          if (bot?.bot_token_encrypted) {
            botToken = bot.bot_token_encrypted;
          }
        }

        if (!botToken) {
          const { data: anyBot } = await supabase
            .from("telegram_bots")
            .select("bot_token_encrypted")
            .eq("status", "active")
            .limit(1)
            .single();
          if (anyBot?.bot_token_encrypted) {
            botToken = anyBot.bot_token_encrypted;
          }
        }

        if (!botToken) {
          return new Response(JSON.stringify({ 
            error: "No bot available",
            success: false,
          }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const avatarUrl = await fetchAndSaveTelegramPhoto(
          supabase,
          botToken,
          profile.telegram_user_id,
          user_id
        );

        return new Response(JSON.stringify({
          success: !!avatarUrl,
          avatar_url: avatarUrl,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "get_user_info": {
        const { user_id } = payload;

        if (!user_id) {
          return new Response(JSON.stringify({ error: "user_id required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Get user's telegram info
        const { data: profile } = await supabase
          .from("profiles")
          .select("telegram_user_id, telegram_link_bot_id")
          .eq("user_id", user_id)
          .single();

        if (!profile?.telegram_user_id) {
          return new Response(JSON.stringify({ 
            error: "User has no linked Telegram account",
            success: false,
          }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Get bot token
        let botToken: string | null = null;

        if (profile.telegram_link_bot_id) {
          const { data: bot } = await supabase
            .from("telegram_bots")
            .select("bot_token_encrypted")
            .eq("id", profile.telegram_link_bot_id)
            .single();
          if (bot?.bot_token_encrypted) {
            botToken = bot.bot_token_encrypted;
          }
        }

        if (!botToken) {
          const { data: anyBot } = await supabase
            .from("telegram_bots")
            .select("bot_token_encrypted")
            .eq("status", "active")
            .limit(1)
            .single();
          if (anyBot?.bot_token_encrypted) {
            botToken = anyBot.bot_token_encrypted;
          }
        }

        if (!botToken) {
          return new Response(JSON.stringify({ 
            error: "No bot available",
            success: false,
          }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Get chat info from Telegram (includes bio for private chats)
        const chatInfoResponse = await fetch(
          `https://api.telegram.org/bot${botToken}/getChat?chat_id=${profile.telegram_user_id}`
        );
        const chatInfo = await chatInfoResponse.json();

        if (!chatInfo.ok) {
          return new Response(JSON.stringify({ 
            error: chatInfo.description || "Failed to get user info",
            success: false,
          }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const result = chatInfo.result;
        
        return new Response(JSON.stringify({
          success: true,
          user_info: {
            id: result.id,
            first_name: result.first_name,
            last_name: result.last_name,
            username: result.username,
            bio: result.bio, // Available in getChat for private chats
            has_private_forwards: result.has_private_forwards,
            // Note: Telegram Bot API doesn't provide registration date or name change history
            // That information is only available through Telegram's MTProto API
          },
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      default:
        return new Response(JSON.stringify({ error: "Unknown action" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
