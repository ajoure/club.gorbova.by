// Sends one operational Telegram notification when a contact-center question
// is assigned. The database assignment remains canonical; notification failure
// never rolls back or duplicates the assignment.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function telegramRequest(token: string, method: string, body: Record<string, unknown>) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return await response.json();
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(url, serviceKey);
    const auth = request.headers.get("Authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "");
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { data: canManage } = await supabase.rpc("has_admin_section_access", {
      _user_id: authData.user.id, _section_code: "communication", _min_level: "manage",
    } as any);
    if (!canManage) {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { assignment_id } = await request.json();
    if (!assignment_id) {
      return new Response(JSON.stringify({ error: "assignment_id_required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { data: assignment, error: assignmentError } = await supabase
      .from("contact_center_message_assignments")
      .select("id, source_message_id, assignee_user_id, assigned_at, resolved_at")
      .eq("id", assignment_id)
      .maybeSingle();
    if (assignmentError || !assignment || assignment.resolved_at) {
      return new Response(JSON.stringify({ error: "assignment_not_found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const idempotencyKey = `contact-center-assignment:${assignment.id}:${assignment.assignee_user_id}:${assignment.assigned_at}`;
    const { error: outboxError } = await supabase.from("notification_outbox").insert({
      user_id: assignment.assignee_user_id,
      message_type: "contact_center_assignment",
      idempotency_key: idempotencyKey,
      source: "contact_center",
      status: "queued",
      meta: { assignment_id: assignment.id, assigned_by: authData.user.id },
    });
    if (outboxError?.code === "23505") {
      const { data: existingOutbox } = await supabase
        .from("notification_outbox")
        .select("status")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existingOutbox?.status === "sent") {
        return new Response(JSON.stringify({ success: true, skipped: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (existingOutbox?.status === "queued") {
        return new Response(JSON.stringify({ success: false, reason: "notification_in_progress" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      await supabase
        .from("notification_outbox")
        .update({ status: "queued", blocked_reason: null })
        .eq("idempotency_key", idempotencyKey);
    } else if (outboxError) {
      throw outboxError;
    }

    const [{ data: recipient }, { data: message }, { data: bot }] = await Promise.all([
      supabase.from("profiles").select("telegram_user_id, full_name").eq("user_id", assignment.assignee_user_id).maybeSingle(),
      supabase.from("telegram_messages").select("message_text, user_id").eq("id", assignment.source_message_id).maybeSingle(),
      supabase.from("telegram_bots").select("bot_token_encrypted").eq("status", "active").order("is_primary", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (!recipient?.telegram_user_id || !bot?.bot_token_encrypted) {
      await supabase.from("notification_outbox").update({ status: "failed", blocked_reason: "recipient_or_bot_unavailable" }).eq("idempotency_key", idempotencyKey);
      return new Response(JSON.stringify({ success: false, reason: "recipient_or_bot_unavailable" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!message?.user_id) {
      await supabase.from("notification_outbox").update({ status: "failed", blocked_reason: "source_dialog_unavailable" }).eq("idempotency_key", idempotencyKey);
      return new Response(JSON.stringify({ success: false, reason: "source_dialog_unavailable" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { data: contact } = await supabase
      .from("profiles")
      .select("full_name, email, phone, telegram_username")
      .or(`user_id.eq.${message.user_id},id.eq.${message.user_id}`)
      .limit(1)
      .maybeSingle();
    const preview = String(message.message_text || "Вложение или сообщение без текста")
      .replace(/\s+/g, " ")
      .slice(0, 400);
    const contactName = String(contact?.full_name || "").replace(/\s+/g, " ").trim() || "Без имени";
    const telegramUsername = String(contact?.telegram_username || "")
      .trim()
      .replace(/^@+/, "");
    const safeTelegramUsername = /^[A-Za-z0-9_]{5,32}$/.test(telegramUsername)
      ? telegramUsername
      : "";
    const contactLines = [
      `👤 ${contactName}`,
      safeTelegramUsername ? `✈️ @${safeTelegramUsername}` : null,
      contact?.email ? `✉️ ${String(contact.email).trim()}` : null,
      contact?.phone ? `📞 ${String(contact.phone).trim()}` : null,
    ].filter(Boolean);
    const siteUrl = (Deno.env.get("CONTACT_CENTER_SITE_URL") || "https://club.gorbova.by").replace(/\/+$/, "");
    const dialogUrl = `${siteUrl}/admin/communication?tab=inbox&chat=${encodeURIComponent(message.user_id)}`;
    const inlineKeyboard = [[{ text: "Посмотреть вопрос", url: dialogUrl }]];
    if (safeTelegramUsername) {
      inlineKeyboard.push([{ text: "Открыть в Telegram", url: `https://t.me/${safeTelegramUsername}` }]);
    }
    const sent = await telegramRequest(bot.bot_token_encrypted, "sendMessage", {
      chat_id: recipient.telegram_user_id,
      text: `Вам назначен вопрос в контакт-центре\n\n${contactLines.join("\n")}\n\nВопрос:\n${preview}`,
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: inlineKeyboard,
      },
    });
    await supabase.from("notification_outbox").update({
      status: sent?.ok ? "sent" : "failed",
      sent_at: sent?.ok ? new Date().toISOString() : null,
      blocked_reason: sent?.ok ? null : String(sent?.description || "telegram_send_failed"),
    }).eq("idempotency_key", idempotencyKey);
    return new Response(JSON.stringify({ success: !!sent?.ok }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("[contact-center-assignment-notify]", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "internal_error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
