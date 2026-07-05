// Trigger-invoked notifier for new client messages in support tickets.
// Called via pg_net from an AFTER INSERT trigger on public.ticket_messages
// when author_type='user' AND is_internal=false. Resolves ticket + sender,
// fans out browser push to all admins via `send-push-notification`.
//
// verify_jwt = false — the trigger authenticates with the project anon key,
// this function re-authorizes internally via SUPABASE_SERVICE_ROLE_KEY when
// calling send-push-notification (which requires service_role).
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function preview(text: string | null | undefined, hasAttachments: boolean): string {
  const t = (text ?? "").trim();
  if (t) return t.slice(0, 100);
  if (hasAttachments) return "[вложение]";
  return "Новое сообщение";
}

function resolveSenderName(p: {
  last_name?: string | null;
  first_name?: string | null;
  full_name?: string | null;
} | null, fallbackAuthorName: string | null): string {
  const last = p?.last_name?.trim() || "";
  const first = p?.first_name?.trim() || "";
  if (last && first) return `${last} ${first}`;
  if (last) return last;
  if (first) return first;
  const full = p?.full_name?.trim() || "";
  if (full) return full;
  const fb = (fallbackAuthorName || "").trim();
  return fb || "Клиент";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!supabaseUrl || !serviceKey) {
      return json({ error: "not_configured" }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const ticketId = body?.ticket_id as string | undefined;
    const messageId = body?.message_id as string | undefined;
    if (!ticketId || !messageId) return json({ error: "bad_request" }, 400);

    const supabase = createClient(supabaseUrl, serviceKey);

    // Load message + ticket in parallel
    const [{ data: msg, error: msgErr }, { data: ticket, error: ticketErr }] = await Promise.all([
      supabase
        .from("ticket_messages")
        .select("id, ticket_id, author_id, author_type, author_name, message, attachments, is_internal")
        .eq("id", messageId)
        .maybeSingle(),
      supabase
        .from("support_tickets")
        .select("id, ticket_number, subject, user_id")
        .eq("id", ticketId)
        .maybeSingle(),
    ]);

    if (msgErr || ticketErr) {
      console.error("[ticket-notify] load error", msgErr?.message, ticketErr?.message);
      return json({ ok: false, error: "load_failed" }, 500);
    }
    if (!msg || !ticket) return json({ ok: true, skipped: "not_found" });
    if (msg.is_internal) return json({ ok: true, skipped: "internal" });
    if (msg.author_type && msg.author_type !== "user") {
      return json({ ok: true, skipped: `author_type=${msg.author_type}` });
    }

    // Resolve sender profile (author_id -> profiles.user_id)
    let sender: { first_name: string | null; last_name: string | null; full_name: string | null } | null = null;
    const senderUserId = msg.author_id || ticket.user_id;
    if (senderUserId) {
      const { data: p } = await supabase
        .from("profiles")
        .select("first_name, last_name, full_name")
        .eq("user_id", senderUserId)
        .maybeSingle();
      sender = p ?? null;
    }

    // Admin recipients (same query as telegram-webhook)
    const { data: adminRoles } = await supabase
      .from("user_roles_v2")
      .select("user_id, roles!inner(code)")
      .in("roles.code", ["super_admin", "admin"]);

    const adminUserIds = Array.from(
      new Set(((adminRoles as any[]) || []).map((r) => r.user_id).filter(Boolean))
    );
    if (adminUserIds.length === 0) return json({ ok: true, sent: 0, reason: "no_admins" });

    const senderName = resolveSenderName(sender, msg.author_name);
    const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
    const bodyPreview = preview(msg.message, attachments.length > 0);
    const ticketNo = ticket.ticket_number ? `TKT-${ticket.ticket_number}` : "Обращение";

    const pushRes = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        user_ids: adminUserIds,
        title: `🎧 ${senderName}`,
        body: `${ticketNo}: ${bodyPreview}`,
        url: "/admin/communication",
        tag: `ticket-${ticket.id}`,
      }),
    }).catch((e) => {
      console.error("[ticket-notify] push fetch failed", e);
      return null;
    });

    const pushJson = pushRes ? await pushRes.json().catch(() => null) : null;
    console.log("[ticket-notify] push result", JSON.stringify({
      ticket_id: ticket.id,
      message_id: msg.id,
      admins: adminUserIds.length,
      result: pushJson,
    }));

    return json({ ok: true, admins: adminUserIds.length, push: pushJson });
  } catch (err) {
    console.error("[ticket-notify] error", err);
    return json({ error: (err as Error).message }, 500);
  }
});
