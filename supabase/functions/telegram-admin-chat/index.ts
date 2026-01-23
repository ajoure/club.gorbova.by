import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface FileData {
  type: "photo" | "video" | "audio" | "video_note" | "document";
  name: string;
  base64: string;
}

interface ChatAction {
  action: "send_message" | "get_messages" | "fetch_profile_photo" | "get_user_info" | "edit_message" | "delete_message";
  user_id?: string;
  message?: string;
  file?: FileData;
  bot_id?: string;
  limit?: number;
  message_id?: number;
  db_message_id?: string;
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

function guessMimeType(fileName: string, kind: FileData["type"]) {
  const lower = fileName.toLowerCase();
  if (kind === "photo") {
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".webp")) return "image/webp";
    return "image/jpeg";
  }
  if (kind === "audio") {
    if (lower.endsWith(".mp3")) return "audio/mpeg";
    if (lower.endsWith(".m4a")) return "audio/mp4";
    if (lower.endsWith(".wav")) return "audio/wav";
    return "audio/mpeg";
  }
  if (kind === "video" || kind === "video_note") {
    if (lower.endsWith(".mp4")) return "video/mp4";
    if (lower.endsWith(".mov")) return "video/quicktime";
    if (lower.endsWith(".webm")) return "video/webm";
    return "video/mp4";
  }
  // document
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

async function telegramSendFile(
  botToken: string,
  chatId: number,
  file: FileData,
  caption?: string
) {
  // Convert base64 to bytes
  const binaryString = atob(file.base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  let contentType = guessMimeType(file.name, file.type);
  let fileName = file.name;
  let finalBytes = bytes;

  // For video_note, ensure we have mp4 format
  // Telegram requires mp4 for video notes to display correctly
  if (file.type === "video_note") {
    // If it's webm, we need to ensure proper content type
    // The file will still be sent - Telegram sometimes accepts webm too
    // But we force the mp4 extension to help with client rendering
    if (file.name.toLowerCase().endsWith(".webm")) {
      // Keep the bytes but change the name to mp4
      // This is a workaround - Telegram may still reject but worth trying
      fileName = file.name.replace(/\.webm$/i, ".mp4");
      contentType = "video/mp4";
    }
  }

  const blob = new Blob([finalBytes], { type: contentType });

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
    case "video_note":
      method = "sendVideoNote";
      fieldName = "video_note";
      // Video notes don't support captions
      formData.delete("caption");
      // Required: length parameter for circular video
      formData.append("length", "384");
      break;
    default:
      method = "sendDocument";
      fieldName = "document";
  }

  formData.append(fieldName, blob, fileName);

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
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify admin access
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use anon client to validate user token with getClaims
    const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(token);

    if (claimsError || !claimsData?.claims?.sub) {
      console.error("Auth error:", claimsError);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    const user = { id: claimsData.claims.sub as string };

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

        // If file was sent successfully, download from Telegram and upload to Storage
        let storageBucket: string | null = null;
        let storagePath: string | null = null;
        let fileId: string | null = null;
        
        if (sendResult.ok && file) {
          try {
            // Get file_id from response based on file type
            const result = sendResult.result;
            
            if (result.video_note) {
              fileId = result.video_note.file_id;
            } else if (result.video) {
              fileId = result.video.file_id;
            } else if (result.photo && result.photo.length > 0) {
              fileId = result.photo[result.photo.length - 1].file_id;
            } else if (result.audio) {
              fileId = result.audio.file_id;
            } else if (result.voice) {
              fileId = result.voice.file_id;
            } else if (result.document) {
              fileId = result.document.file_id;
            }
            
            if (fileId) {
              // Get file path from Telegram
              const fileInfoRes = await fetch(
                `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`
              );
              const fileInfo = await fileInfoRes.json();
              
              if (fileInfo.ok && fileInfo.result?.file_path) {
                // Download file using arrayBuffer (more reliable)
                const telegramFileUrl = `https://api.telegram.org/file/bot${botToken}/${fileInfo.result.file_path}`;
                const fileResponse = await fetch(telegramFileUrl);
                const arrayBuffer = await fileResponse.arrayBuffer();
                
                // Sanitize filename for Supabase Storage (no cyrillic, spaces, special chars)
                const sanitizeOutboundFileName = (name: string): string => {
                  if (!name) return 'file';
                  const lastDot = name.lastIndexOf('.');
                  const ext = lastDot > 0 ? name.slice(lastDot).toLowerCase() : '';
                  const baseName = lastDot > 0 ? name.slice(0, lastDot) : name;
                  
                  const cyrToLat: Record<string, string> = {
                    'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh','з':'z','и':'i',
                    'й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t',
                    'у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'',
                    'э':'e','ю':'yu','я':'ya'
                  };
                  
                  let safe = baseName.toLowerCase();
                  for (const [cyr, lat] of Object.entries(cyrToLat)) {
                    safe = safe.replace(new RegExp(cyr, 'g'), lat);
                  }
                  
                  safe = safe
                    .replace(/\s+/g, '_')
                    .replace(/[^a-z0-9_.-]/g, '')
                    .replace(/_+/g, '_')
                    .slice(0, 100);
                  
                  return (safe || 'file') + ext;
                };
                
                const safeOutboundName = sanitizeOutboundFileName(file.name);
                
                // Upload to Supabase Storage
                storageBucket = 'telegram-media';
                storagePath = `outbound/${user_id}/${Date.now()}_${safeOutboundName}`;
                const { data: uploadData, error: uploadError } = await supabase.storage
                  .from(storageBucket)
                  .upload(storagePath, arrayBuffer, { 
                    contentType: guessMimeType(file.name, file.type),
                    upsert: false 
                  });
                
                if (uploadData && !uploadError) {
                  console.log(`[OUTBOUND] Upload OK: bucket=${storageBucket} path=${storagePath} bytes=${arrayBuffer.byteLength}`);
                } else {
                  console.error(`[OUTBOUND] Upload FAILED: path=${storagePath}`, uploadError);
                  // Log to audit_logs
                  await supabase.from('audit_logs').insert({
                    actor_type: 'system',
                    actor_label: 'telegram-admin-chat',
                    action: 'telegram_media_upload_failed',
                    meta: { error: uploadError?.message, bucket: storageBucket, path: storagePath, file_name: file?.name }
                  });
                  storageBucket = null;
                  storagePath = null;
                }
              }
            }
          } catch (uploadErr) {
            console.error("Failed to upload file to storage:", uploadErr);
            storageBucket = null;
            storagePath = null;
          }
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
            file_id: fileId,
            storage_bucket: storageBucket,
            storage_path: storagePath,
            mime_type: file ? guessMimeType(file.name, file.type) : null,
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
        
        // STOP-guard: normalize limit to safe range [1, 200]
        const safeLimit = Math.max(1, Math.min(limit ?? 50, 200));

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
            telegram_bots(id, bot_name, bot_username),
            admin_profile:profiles!telegram_messages_sent_by_admin_fkey(full_name, avatar_url)
          `)
          .eq("user_id", user_id)
          .order("created_at", { ascending: false })  // DESC - get LATEST N messages
          .limit(safeLimit);
        
        // Helper to build raw/ui debug info
        const buildOrderDebug = (rawMessages: any[], uiMessages: any[]) => {
          const rawFirst = rawMessages[0]?.created_at || null;
          const rawLast = rawMessages[rawMessages.length - 1]?.created_at || null;
          const uiFirst = uiMessages[0]?.created_at || null;
          const uiLast = uiMessages[uiMessages.length - 1]?.created_at || null;
          
          return {
            safe_limit: safeLimit,
            raw_count: rawMessages.length,
            raw_first_created_at: rawFirst,
            raw_last_created_at: rawLast,
            raw_order_ok_desc: rawFirst && rawLast ? new Date(rawFirst).getTime() >= new Date(rawLast).getTime() : true,
            ui_count: uiMessages.length,
            ui_first_created_at: uiFirst,
            ui_last_created_at: uiLast,
            ui_order_ok_asc: uiFirst && uiLast ? new Date(uiFirst).getTime() <= new Date(uiLast).getTime() : true,
          };
        };

        const isPdfLike = (meta: any) => {
          const name = String(meta?.file_name || "").toLowerCase();
          const mime = String(meta?.mime_type || "").toLowerCase();
          return name.endsWith(".pdf") || mime === "application/pdf";
        };

        // Helper to detect non-PDF documents (DOCX, XLSX, CSV, etc.)
        const isDocLike = (meta: any) => {
          const ft = String(meta?.file_type || "").toLowerCase();
          const mime = String(meta?.mime_type || "").toLowerCase();
          return ft === "document" || 
                 (mime.includes("application/") && !mime.includes("application/pdf")) || 
                 mime.includes("text/");
        };

        // Helper to generate signed URL for a message
        const enrichMessageWithSignedUrl = async (msg: any) => {
          const meta = msg.meta || {};
          
          // If we have storage_path, create signed URL
          if (meta.storage_bucket && meta.storage_path) {
            try {
              // PDF: inline preview (download: false)
              // Other documents (DOCX/XLSX/CSV): forced download for mobile compatibility
              // Media (photo/video): no forced download
              const signedOptions = isPdfLike(meta) 
                ? { download: false }
                : isDocLike(meta) 
                  ? { download: meta.file_name || "file" }
                  : undefined;
              
              const { data: signedData, error: signedError } = await supabase.storage
                .from(meta.storage_bucket)
                .createSignedUrl(meta.storage_path, 3600, signedOptions as any); // 1 hour
              
              if (signedData && !signedError) {
                meta.file_url = signedData.signedUrl;
                
                // AUDIT LOG: signed URL issued (BLOCKER B)
                try {
                  await supabase.from('audit_logs').insert({
                    actor_type: 'system',
                    actor_user_id: null,
                    actor_label: 'telegram-signed-url',
                    action: 'telegram_media_signed_url_issued',
                    meta: {
                      message_id: msg.id ?? null,
                      storage_bucket: meta.storage_bucket ?? null,
                      storage_path: meta.storage_path ?? null,
                      ttl_seconds: 3600,
                      file_type: meta.file_type ?? null
                    }
                  });
                } catch (auditErr) {
                  console.error('[telegram-admin-chat] audit_logs signed url insert failed', auditErr);
                }
              }
            } catch (e) {
              console.error("Error creating signed URL:", e);
            }
          }
          
          console.log(`[ENRICH] msg=${msg.id} type=${meta.file_type} bucket=${meta.storage_bucket} path=${meta.storage_path} url_set=${!!meta.file_url}`);
          return { ...msg, meta };
        };

        if (messagesError) {
          // Fallback without admin profile join if FK doesn't exist
          const { data: fallbackMessages, error: fallbackError } = await supabase
            .from("telegram_messages")
            .select(`
              *,
              telegram_bots(id, bot_name, bot_username)
            `)
            .eq("user_id", user_id)
            .order("created_at", { ascending: false })  // DESC - get LATEST N messages
            .limit(safeLimit);
          
          if (fallbackError) {
            return new Response(JSON.stringify({ error: fallbackError.message }), {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          
          // Manually fetch admin profiles
          const adminIds = [...new Set((fallbackMessages || [])
            .filter((m: any) => m.sent_by_admin)
            .map((m: any) => m.sent_by_admin))];
          
          let adminProfiles: Record<string, { full_name: string | null; avatar_url: string | null }> = {};
          if (adminIds.length > 0) {
            const { data: profiles } = await supabase
              .from("profiles")
              .select("user_id, full_name, avatar_url")
              .in("user_id", adminIds);
            
            if (profiles) {
              profiles.forEach((p: any) => {
                adminProfiles[p.user_id] = { full_name: p.full_name, avatar_url: p.avatar_url };
              });
            }
          }
          
          const rawFallback = fallbackMessages || [];
          // Reverse to ASC for UI (oldest at top, newest at bottom), then enrich
          const messagesAsc = [...rawFallback].reverse();
          const enrichedMessages = await Promise.all(messagesAsc.map(async (m: any) => {
            const withAdmin = {
              ...m,
              admin_profile: m.sent_by_admin ? adminProfiles[m.sent_by_admin] || { full_name: null, avatar_url: null } : null,
            };
            return enrichMessageWithSignedUrl(withAdmin);
          }));
          
          // Debug for fallback branch
          const orderDebug = buildOrderDebug(rawFallback, enrichedMessages);
          const last5 = enrichedMessages.slice(-5).map((m: any) => {
            const meta = m?.meta || {};
            return {
              msg_id: m?.id ?? null,
              file_type: meta.file_type ?? null,
              has_bucket: !!meta.storage_bucket,
              has_path: !!meta.storage_path,
              url_set: !!meta.file_url,
            };
          });
          
          return new Response(JSON.stringify({ messages: enrichedMessages, debug: { ...orderDebug, last5 } }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const rawMessages = messages || [];
        // Reverse to ASC for UI (oldest at top, newest at bottom), then enrich
        const messagesAsc = [...rawMessages].reverse();
        const enrichedMessages = await Promise.all(messagesAsc.map(enrichMessageWithSignedUrl));

        // Debug: raw vs UI ordering proof + last5 url enrichment
        const orderDebug = buildOrderDebug(rawMessages, enrichedMessages);
        const last5 = enrichedMessages.slice(-5).map((m: any) => {
          const meta = m?.meta || {};
          return {
            msg_id: m?.id ?? null,
            file_type: meta.file_type ?? null,
            has_bucket: !!meta.storage_bucket,
            has_path: !!meta.storage_path,
            url_set: !!meta.file_url,
          };
        });

        return new Response(JSON.stringify({ messages: enrichedMessages, debug: { ...orderDebug, last5 } }), {
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

      case "edit_message": {
        const { user_id, message, message_id, db_message_id } = payload;

        if (!user_id || !message || !message_id) {
          return new Response(JSON.stringify({ error: "user_id, message, and message_id required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Get user's telegram_user_id from profile
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

        const editResult = await telegramRequest(botToken, "editMessageText", {
          chat_id: profile.telegram_user_id,
          message_id: message_id,
          text: message,
          parse_mode: "HTML",
        });

        if (editResult.ok && db_message_id) {
          // Update message in database
          await supabase
            .from("telegram_messages")
            .update({ 
              message_text: message,
              meta: { edited: true, edited_at: new Date().toISOString() }
            })
            .eq("id", db_message_id);
        }

        // Log the edit action
        await supabase.from("telegram_logs").insert({
          user_id,
          action: "ADMIN_EDIT_MESSAGE",
          target: "message",
          status: editResult.ok ? "ok" : "error",
          error_message: editResult.ok ? null : editResult.description,
          meta: {
            message_id,
            edited_by: user.id,
          },
        });

        return new Response(JSON.stringify({
          success: editResult.ok,
          error: editResult.ok ? null : editResult.description,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "delete_message": {
        const { user_id, message_id, db_message_id } = payload;

        if (!user_id || !message_id) {
          return new Response(JSON.stringify({ error: "user_id and message_id required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Get user's telegram_user_id from profile
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

        const deleteResult = await telegramRequest(botToken, "deleteMessage", {
          chat_id: profile.telegram_user_id,
          message_id: message_id,
        });

        if (deleteResult.ok && db_message_id) {
          // Mark message as deleted in database
          await supabase
            .from("telegram_messages")
            .update({ 
              status: "deleted",
              meta: { deleted: true, deleted_at: new Date().toISOString() }
            })
            .eq("id", db_message_id);
        }

        // Log the delete action
        await supabase.from("telegram_logs").insert({
          user_id,
          action: "ADMIN_DELETE_MESSAGE",
          target: "message",
          status: deleteResult.ok ? "ok" : "error",
          error_message: deleteResult.ok ? null : deleteResult.description,
          meta: {
            message_id,
            deleted_by: user.id,
          },
        });

        return new Response(JSON.stringify({
          success: deleteResult.ok,
          error: deleteResult.ok ? null : deleteResult.description,
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
