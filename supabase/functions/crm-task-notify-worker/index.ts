// crm-task-notify-worker
// Tick-worker: 1) планирует pending-уведомления (reminder/overdue) на основе due_at/remind_at;
// 2) доставляет pending-уведомления в Telegram через primary bot;
// 3) обновляет статус (sent/skipped/failed).
//
// Безопасность: вызывается только service_role (verify_jwt включён по умолчанию для
// функций без явного config); рассчитан на pg_cron / админ-вызовы.
//
// Контракт ответа: { ok, planned: {reminders, overdue}, delivered, skipped, failed }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BATCH_LIMIT = 50;

function escapeHtml(s: string): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      timeZone: "Europe/Minsk",
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function buildText(
  kind: "reminder" | "overdue" | "assigned",
  task: any,
  taskType: any,
): string {
  const head =
    kind === "overdue"
      ? "🔴 Просрочена задача"
      : kind === "assigned"
        ? "🆕 Вам назначена задача"
        : "⏰ Напоминание о задаче";
  const typeLabel = taskType?.label ?? "Задача";
  const lines = [
    `<b>${head}</b>`,
    "",
    `<b>${escapeHtml(typeLabel)}:</b> ${escapeHtml(task.title ?? "")}`,
  ];
  if (task.description) {
    lines.push("", escapeHtml(String(task.description).slice(0, 500)));
  }
  lines.push("");
  lines.push(`Дедлайн: <i>${fmtDate(task.due_at)}</i>`);
  if (task.public_id) lines.push(`ID: <code>${escapeHtml(task.public_id)}</code>`);
  return lines.join("\n");
}


async function sendTelegram(
  botToken: string,
  chatId: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      },
    );
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !(data as any)?.ok) {
      return {
        ok: false,
        error: `telegram_${r.status}_${(data as any)?.description ?? "unknown"}`,
      };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `telegram_exception_${(e as Error).message}` };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCorsPreflightRequest();

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  const result = {
    ok: true,
    planned: { reminders: 0, overdue: 0 },
    delivered: 0,
    skipped: 0,
    failed: 0,
    details: [] as Array<{ id: string; status: string; reason?: string }>,
  };

  try {
    // 1) Plan due notifications
    const { data: planned, error: planErr } = await supabase.rpc(
      "crm_tasks_schedule_due_notifications",
    );
    if (planErr) {
      console.error("[crm-task-notify-worker] plan error", planErr);
    } else if (planned) {
      result.planned.reminders = (planned as any).reminders ?? 0;
      result.planned.overdue = (planned as any).overdue ?? 0;
    }

    // 2) Fetch primary bot token
    const { data: bot, error: botErr } = await supabase
      .from("telegram_bots")
      .select("id, bot_token_encrypted")
      .eq("is_primary", true)
      .eq("status", "active")
      .maybeSingle();
    if (botErr || !bot?.bot_token_encrypted) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "primary_bot_not_configured",
          planned: result.planned,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const botToken = String(bot.bot_token_encrypted);

    // 3) Pull pending notifications due now
    const { data: pending, error: pendErr } = await supabase
      .from("crm_task_notifications")
      .select("id, task_id, notification_type, recipient_user_id, scheduled_at, metadata")
      .eq("status", "pending")
      .lte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(BATCH_LIMIT);
    if (pendErr) throw pendErr;

    for (const n of pending ?? []) {
      // Recipient profile + telegram_user_id
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, telegram_user_id, full_name")
        .eq("user_id", n.recipient_user_id)
        .maybeSingle();

      if (!profile?.telegram_user_id) {
        await supabase
          .from("crm_task_notifications")
          .update({
            status: "skipped",
            error: "no_telegram_user_id",
            updated_at: new Date().toISOString(),
          })
          .eq("id", n.id);
        result.skipped++;
        result.details.push({ id: n.id, status: "skipped", reason: "no_telegram_user_id" });
        continue;
      }

      // Task + type
      const { data: task } = await supabase
        .from("crm_tasks")
        .select("id, public_id, title, description, due_at, status, task_type_id")
        .eq("id", n.task_id)
        .maybeSingle();

      if (!task) {
        await supabase
          .from("crm_task_notifications")
          .update({ status: "failed", error: "task_not_found", updated_at: new Date().toISOString() })
          .eq("id", n.id);
        result.failed++;
        continue;
      }

      // Skip if task already closed
      if (task.status === "done" || task.status === "canceled") {
        await supabase
          .from("crm_task_notifications")
          .update({
            status: "skipped",
            error: `task_${task.status}`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", n.id);
        result.skipped++;
        continue;
      }

      const { data: ttype } = await supabase
        .from("crm_task_types")
        .select("label, key")
        .eq("id", task.task_type_id)
        .maybeSingle();

      const text = buildText(
        n.notification_type === "overdue" ? "overdue" : "reminder",
        task,
        ttype,
      );

      const chatId = String(profile.telegram_user_id).replace(/\.\d+$/, ""); // tolerate float repr
      const sendRes = await sendTelegram(botToken, chatId, text);

      if (sendRes.ok) {
        await supabase
          .from("crm_task_notifications")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", n.id);
        result.delivered++;
        result.details.push({ id: n.id, status: "sent" });
      } else {
        await supabase
          .from("crm_task_notifications")
          .update({
            status: "failed",
            error: sendRes.error ?? "unknown",
            updated_at: new Date().toISOString(),
          })
          .eq("id", n.id);
        result.failed++;
        result.details.push({ id: n.id, status: "failed", reason: sendRes.error });
      }
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[crm-task-notify-worker] fatal", e);
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message, partial: result }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
