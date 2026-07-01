// ============================================================================
// voice-note-forward-to-support
// ----------------------------------------------------------------------------
// Пересылает голосовое сообщение из ленты контакта в Telegram админам-support
// (super_admin + admin с deals.edit) через основного бота.
// Использует тот же RBAC-паттерн, что и telegram-notify-admins.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return jsonResponse({ error: "unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return jsonResponse({ error: "unauthorized" }, 401);

    const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: isEmployee } = await service.rpc("has_role_v2", { _user_id: user.id, _role: "employee" });
    const { data: isAdmin } = await service.rpc("has_role_v2", { _user_id: user.id, _role: "admin" });
    const { data: isSuper } = await service.rpc("has_role_v2", { _user_id: user.id, _role: "super_admin" });
    if (!(isEmployee || isAdmin || isSuper)) return jsonResponse({ error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const fileId = body?.file_id as string | undefined;
    if (!fileId) return jsonResponse({ error: "missing_file_id" }, 400);

    const { data: file, error: fErr } = await service
      .from("contact_files")
      .select("id, contact_id, name, storage_path, mime_type, meta")
      .eq("id", fileId)
      .maybeSingle();
    if (fErr || !file) return jsonResponse({ error: "file_not_found" }, 404);

    // Загружаем содержимое голосового
    const { data: blob, error: dlErr } = await service.storage.from("contact-files").download(file.storage_path);
    if (dlErr || !blob) return jsonResponse({ error: "download_failed" }, 500);

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const isVoiceOgg = (file.mime_type || "").includes("ogg");
    // Telegram sendVoice требует .ogg (opus). Webm/mp3 отправляем как sendAudio.
    const useVoice = isVoiceOgg;
    const method = useVoice ? "sendVoice" : "sendAudio";
    const fieldName = useVoice ? "voice" : "audio";
    const fileName = file.name || (useVoice ? "voice.ogg" : "voice.webm");

    // Контекст контакта
    const { data: contact } = await service
      .from("profiles")
      .select("id, full_name, email, phone")
      .eq("id", file.contact_id)
      .maybeSingle();

    const transcript = (file.meta as any)?.transcript as string | undefined;
    const summary = (file.meta as any)?.summary as string | undefined;

    const captionLines = [
      "🎙 <b>Голосовое из ленты контакта</b>",
      contact?.full_name ? `👤 ${contact.full_name}` : null,
      contact?.email ? `✉️ ${contact.email}` : null,
      contact?.phone ? `📞 ${contact.phone}` : null,
      summary ? `\n<b>Сводка:</b>\n${summary}` : null,
      transcript && !summary ? `\n<b>Расшифровка:</b>\n${transcript.slice(0, 800)}` : null,
    ].filter(Boolean);
    const caption = captionLines.join("\n").slice(0, 1024);

    // Определяем получателей: super_admin + admin с deals.edit
    const { data: superRoles } = await service.from("roles").select("id").eq("code", "super_admin");
    const superRoleIds = (superRoles || []).map((r: any) => r.id);
    let superUserIds: string[] = [];
    if (superRoleIds.length > 0) {
      const { data: su } = await service.from("user_roles_v2").select("user_id").in("role_id", superRoleIds);
      superUserIds = (su || []).map((r: any) => r.user_id);
    }
    const { data: dealsAdmins } = await service.rpc("find_users_with_permission", { permission_code: "deals.edit" });
    const dealsIds = (dealsAdmins || []).map((r: any) => r.user_id);
    const targetUserIds = [...new Set([...superUserIds, ...dealsIds])];

    if (targetUserIds.length === 0) return jsonResponse({ ok: true, sent: 0, reason: "no_admins" });

    const { data: profiles } = await service
      .from("profiles")
      .select("telegram_user_id, telegram_link_bot_id, full_name")
      .in("user_id", targetUserIds)
      .not("telegram_user_id", "is", null);

    if (!profiles || profiles.length === 0) return jsonResponse({ ok: true, sent: 0, reason: "no_telegram_linked" });

    const { data: bots } = await service
      .from("telegram_bots")
      .select("id, bot_token_encrypted, is_primary")
      .eq("status", "active");
    if (!bots || bots.length === 0) return jsonResponse({ error: "no_active_bots" }, 500);

    const botsById = new Map<string, string>();
    for (const b of bots as any[]) if (b?.id && b?.bot_token_encrypted) botsById.set(b.id, b.bot_token_encrypted);
    const primary = (bots as any[]).sort((a, b) => (b?.is_primary ? 1 : 0) - (a?.is_primary ? 1 : 0))[0];
    const fallbackToken = primary?.bot_token_encrypted || Array.from(botsById.values())[0];

    let sent = 0;
    const errors: string[] = [];
    for (const p of profiles as any[]) {
      const token = (p?.telegram_link_bot_id && botsById.get(p.telegram_link_bot_id)) || fallbackToken;
      if (!token) continue;

      const form = new FormData();
      form.append("chat_id", String(p.telegram_user_id));
      form.append("caption", caption);
      form.append("parse_mode", "HTML");
      form.append(fieldName, new Blob([bytes], { type: file.mime_type || "audio/ogg" }), fileName);

      try {
        const resp = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", body: form });
        const json = await resp.json().catch(() => ({}));
        if (resp.ok && json?.ok) sent++;
        else errors.push(`${p.full_name}: ${json?.description || resp.status}`);
      } catch (e) {
        errors.push(`${p.full_name}: ${(e as Error).message}`);
      }
    }

    await service.from("telegram_logs").insert({
      action: "VOICE_NOTE_FORWARDED",
      status: sent > 0 ? "success" : "warning",
      meta: { file_id: fileId, contact_id: file.contact_id, sent, total: profiles.length, errors: errors.length ? errors : undefined },
    });

    return jsonResponse({ ok: true, sent, total: profiles.length, errors: errors.length ? errors : undefined });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[voice-note-forward-to-support] error:", msg);
    return jsonResponse({ error: msg }, 500);
  }
});
