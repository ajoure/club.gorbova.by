import { DB, must, read } from "./db.ts";
// Uses the canonical exact-message assignment and notification_outbox. No JWT bypass
// is added to contact-center-assignment-notify or any public message sender.
export async function notifyAssignments(db: DB) {
  const events = await read(
    db.from("sales_events").select("id,details").in("event", [
      "handoff",
      "opt_out",
    ]).order("created_at", { ascending: false }).limit(30),
  );
  let sent = 0;
  for (const event of events) {
    const id = event.details?.assignment_id;
    if (!id) continue;
    const assignment = await must(
      db.from("contact_center_message_assignments").select(
        "id,source_message_id,assignee_user_id,resolved_at",
      ).eq("id", id).maybeSingle(),
    );
    if (!assignment || assignment.resolved_at) continue;
    const key = "sales_assignment:" + id;
    const existing = await must(
      db.from("notification_outbox").select("id").eq("idempotency_key", key)
        .maybeSingle(),
    );
    if (existing) continue;
    const [recipient, message, bot] = await Promise.all([
      read(
        db.from("profiles").select("telegram_user_id").eq(
          "user_id",
          assignment.assignee_user_id,
        ).single(),
      ),
      read(
        db.from("telegram_messages").select("user_id,message_text").eq(
          "id",
          assignment.source_message_id,
        ).single(),
      ),
      read(
        db.from("telegram_bots").select("bot_token_encrypted").eq(
          "status",
          "active",
        ).order("is_primary", { ascending: false }).limit(1).single(),
      ),
    ]);
    if (!recipient.telegram_user_id || !bot.bot_token_encrypted) continue;
    const { error } = await db.from("notification_outbox").insert({
      user_id: assignment.assignee_user_id,
      message_type: "contact_center_assignment",
      idempotency_key: key,
      source: "sales_runtime",
      status: "sending",
      meta: { assignment_id: id, event_id: event.id },
    });
    if (error?.code === "23505") continue;
    if (error) throw Error("assignment_outbox_failed");
    let delivered = false;
    try {
      const site =
        (Deno.env.get("CONTACT_CENTER_SITE_URL") || "https://gorbova.by")
          .replace(/\/+$/, "");
      const response = await fetch(
        `https://api.telegram.org/bot${bot.bot_token_encrypted}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(12000),
          body: JSON.stringify({
            chat_id: recipient.telegram_user_id,
            text:
              (event.details?.reason === "technical_problem"
                ? "Техническая проблема при покупке ЦБ21. Автопродажи приостановлены.\n\nПоследнее сообщение клиента:\n"
                : "Вам назначен вопрос по ЦБ21. Автопродажи приостановлены.\n\n") +
              String(message.message_text || "[Вложение — откройте переписку]").slice(0, 3500),
            reply_markup: {
              inline_keyboard: [[{
                text: "Открыть переписку",
                url: site + "/admin/communication?tab=inbox&chat=" +
                  encodeURIComponent(message.user_id),
              }]],
            },
          }),
        },
      );
      const result = await response.json();
      delivered = result.ok === true && !!result.result?.message_id;
    } catch {
      /* No blind retry after uncertain delivery. Assignment stays visible in inbox. */
    }
    await must(
      db.from("notification_outbox").update({
        status: delivered ? "sent" : "unknown",
        sent_at: delivered ? new Date().toISOString() : null,
        blocked_reason: delivered ? null : "assignment_delivery_unknown",
      }).eq("idempotency_key", key),
    );
    sent++;
    if (sent >= 2) {
      break;
    }
  }
  return sent;
}
