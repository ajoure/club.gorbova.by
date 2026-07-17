// B7 corrective — Shared delivery for lifecycle charge events
// (failure / retry-exhausted / final completion) invoked by bepaid-webhook.
//
// Canonical semantics:
//   * `enabled` DOES NOT gate failure / retry-exhausted / completion events —
//     only the independent flags `notify_on_failure` /
//     `notify_on_retry_exhausted` do. `enabled` gates pre-charge reminders.
//   * Idempotency via notification_outbox.idempotency_key using
//     claim_notification_outbox_slot RPC (same primitive as the cron reminder
//     runner). Duplicate webhook deliveries collapse to a single send per
//     (event, subject, channel) tuple.
//   * Recipients: telegram_user_id + email from profiles (auth fallback for
//     email). Missing channel = silent skip with an audit trail.
//
// Idempotency-key shape (must match RETURN spec):
//   installment_charge_failed:{installmentPaymentId||subscriptionV2Id}:{transactionUid||providerEventId}:{channel}
//   installment_charge_retry_exhausted:{installmentPaymentId||subscriptionV2Id}:{channel}
//   installment_completed:{subscriptionV2Id}:{channel}
//   subscription_charge_failed:{subscriptionV2Id}:{transactionUid||providerEventId}:{channel}

import { resolveChargeNotificationPolicy } from "./charge-notification-policy.ts";
import { logAutomatedTelegramMessage } from "./log-automated-telegram.ts";
import { escapeTelegramMarkdown, escapeHtml } from "./charge-reminder-scheduling.ts";
import { resolveLinkBot } from "./link-bot-resolver.ts";

export type LifecycleEvent =
  | "installment_charge_failed"
  | "installment_charge_retry_exhausted"
  | "installment_completed"
  | "subscription_charge_failed";

export type ChargeChannel = "telegram" | "email";

export type SendLifecycleArgs = {
  supabase: any;
  event: LifecycleEvent;
  userId: string;
  subscriptionV2Id: string;
  providerSubscriptionId?: string | null;
  installmentPaymentId?: string | null;
  transactionUid?: string | null;
  providerEventId?: string | null;
  productName?: string | null;
  tariffName?: string | null;
  amount?: number | null;
  currency?: string | null;
  errorMessage?: string | null;
  meta?: Record<string, unknown>;
};

export type LifecycleDeliveryResult = {
  event: LifecycleEvent;
  gated: boolean;
  gate_reason?: string;
  claimed: { telegram: number; email: number };
  sent: { telegram: number; email: number };
  telegram_error?: string | null;
  email_error?: string | null;
};

function isGated(event: LifecycleEvent, policy: ReturnType<typeof resolveChargeNotificationPolicy>): { gated: boolean; reason?: string } {
  switch (event) {
    case "installment_charge_failed":
    case "subscription_charge_failed":
      return policy.notify_on_failure ? { gated: false } : { gated: true, reason: "notify_on_failure_disabled" };
    case "installment_charge_retry_exhausted":
      return policy.notify_on_retry_exhausted ? { gated: false } : { gated: true, reason: "notify_on_retry_exhausted_disabled" };
    case "installment_completed":
      return { gated: false }; // completion is always informational
    default:
      return { gated: true, reason: "unknown_event" };
  }
}

function buildIdempotencyKey(args: SendLifecycleArgs, channel: ChargeChannel): string {
  const subject = args.installmentPaymentId || args.subscriptionV2Id;
  const evidence = args.transactionUid || args.providerEventId || "no-evidence";
  switch (args.event) {
    case "installment_charge_failed":
      return `installment_charge_failed:${subject}:${evidence}:${channel}`;
    case "installment_charge_retry_exhausted":
      return `installment_charge_retry_exhausted:${subject}:${channel}`;
    case "installment_completed":
      return `installment_completed:${args.subscriptionV2Id}:${channel}`;
    case "subscription_charge_failed":
      return `subscription_charge_failed:${args.subscriptionV2Id}:${evidence}:${channel}`;
  }
}

// B7 corrective — installment amount format: WHOLE BYN (no decimals).
// Non-installment (regular subscription) keeps 2-decimal precision.
function fmtAmountWholeByn(a: number | null | undefined, c: string | null | undefined): string {
  const num = Number(a);
  if (!Number.isFinite(num) || num <= 0) return "";
  const whole = Math.ceil(num);
  return `${whole} ${c || "BYN"}`;
}
function fmtAmountDecimal(a: number | null | undefined, c: string | null | undefined): string {
  const num = Number(a);
  if (!Number.isFinite(num) || num <= 0) return "";
  return `${num.toFixed(2)} ${c || "BYN"}`;
}
function fmtAmountForEvent(event: LifecycleEvent, a: number | null | undefined, c: string | null | undefined): string {
  if (event === "subscription_charge_failed") return fmtAmountDecimal(a, c);
  return fmtAmountWholeByn(a, c); // installment_* → whole BYN
}

function renderTelegram(args: SendLifecycleArgs): string {
  const product = escapeTelegramMarkdown(args.productName || "Продукт");
  const amt = escapeTelegramMarkdown(fmtAmountForEvent(args.event, args.amount, args.currency));
  const err = escapeTelegramMarkdown((args.errorMessage || "Платёж не прошёл").slice(0, 200));
  switch (args.event) {
    case "installment_charge_failed":
    case "subscription_charge_failed":
      return `❌ *Не удалось списать платёж*\n\n📦 ${product}${amt ? `\n💳 Сумма: ${amt}` : ""}\n⚠️ Причина: ${err}\n\nМы повторим попытку автоматически. При необходимости обновите платёжную карту в личном кабинете.`;
    case "installment_charge_retry_exhausted":
      return `⛔️ *Попытки списания исчерпаны*\n\n📦 ${product}${amt ? `\n💳 Сумма: ${amt}` : ""}\n\nРассрочка приостановлена. Пожалуйста, свяжитесь с поддержкой или обновите платёжный метод.`;
    case "installment_completed":
      return `✅ *Рассрочка полностью погашена*\n\n📦 ${product}\n\nСпасибо! Все платежи по рассрочке успешно завершены.`;
  }
}

function renderEmail(args: SendLifecycleArgs): { subject: string; html: string } {
  const productPlain = args.productName || "Продукт";
  const product = escapeHtml(productPlain);
  const amt = escapeHtml(fmtAmountForEvent(args.event, args.amount, args.currency));
  const err = escapeHtml((args.errorMessage || "Платёж не прошёл").slice(0, 500));
  switch (args.event) {
    case "installment_charge_failed":
    case "subscription_charge_failed":
      return {
        subject: `Не удалось списать платёж — ${productPlain}`,
        html: `<p>К сожалению, автоматическое списание не прошло.</p><p><b>Продукт:</b> ${product}${amt ? `<br/><b>Сумма:</b> ${amt}` : ""}<br/><b>Причина:</b> ${err}</p><p>Мы повторим попытку автоматически. При необходимости обновите платёжную карту в личном кабинете.</p>`,
      };
    case "installment_charge_retry_exhausted":
      return {
        subject: `Попытки списания исчерпаны — ${productPlain}`,
        html: `<p>Попытки автоматического списания по рассрочке исчерпаны.</p><p><b>Продукт:</b> ${product}${amt ? `<br/><b>Сумма:</b> ${amt}` : ""}</p><p>Пожалуйста, свяжитесь с поддержкой или обновите платёжный метод, чтобы продолжить.</p>`,
      };
    case "installment_completed":
      return {
        subject: `Рассрочка погашена — ${productPlain}`,
        html: `<p>Все платежи по рассрочке успешно завершены.</p><p><b>Продукт:</b> ${product}</p><p>Спасибо, что были с нами!</p>`,
      };
  }
}

async function claimSlot(
  supabase: any,
  userId: string,
  channel: ChargeChannel,
  messageType: string,
  idempotencyKey: string,
  meta: Record<string, unknown>,
): Promise<{ claimed: boolean; reason: string }> {
  const { data, error } = await supabase.rpc("claim_notification_outbox_slot", {
    p_user_id: userId,
    p_channel: channel,
    p_message_type: messageType,
    p_idempotency_key: idempotencyKey,
    p_source: "bepaid-webhook-lifecycle",
    p_meta: meta,
  });
  if (error) {
    console.error("[lifecycle-notify] claim error:", error);
    return { claimed: false, reason: "claim_error" };
  }
  const row = Array.isArray(data) ? data[0] : data;
  return { claimed: row?.claimed === true, reason: String(row?.reason ?? "unknown") };
}

async function markSent(supabase: any, key: string, patch: Record<string, unknown>): Promise<void> {
  await supabase
    .from("notification_outbox")
    .update({ status: "sent", sent_at: new Date().toISOString(), blocked_reason: null, last_attempt_at: new Date().toISOString(), meta: patch })
    .eq("idempotency_key", key);
}

async function markFailed(supabase: any, key: string, reason: string): Promise<void> {
  await supabase
    .from("notification_outbox")
    .update({ status: "failed", blocked_reason: reason.slice(0, 500), last_attempt_at: new Date().toISOString() })
    .eq("idempotency_key", key);
}

export async function sendChargeLifecycleNotification(
  args: SendLifecycleArgs,
): Promise<LifecycleDeliveryResult> {
  const { supabase } = args;
  const result: LifecycleDeliveryResult = {
    event: args.event,
    gated: false,
    claimed: { telegram: 0, email: 0 },
    sent: { telegram: 0, email: 0 },
  };

  try {
    // Load canonical policy from subscription meta.
    const { data: subV2 } = await supabase
      .from("subscriptions_v2")
      .select("meta")
      .eq("id", args.subscriptionV2Id)
      .maybeSingle();
    const policy = resolveChargeNotificationPolicy(subV2?.meta ?? {});
    const gate = isGated(args.event, policy);
    if (gate.gated) {
      result.gated = true;
      result.gate_reason = gate.reason;
      return result;
    }

    // Resolve recipients.
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, email, telegram_user_id, full_name")
      .eq("user_id", args.userId)
      .maybeSingle();
    let email = (profile?.email as string | null) ?? null;
    if (!email) {
      try {
        const { data: authUser } = await supabase.auth.admin.getUserById(args.userId);
        email = authUser?.user?.email ?? null;
      } catch { /* best-effort */ }
    }
    const telegramChatId = profile?.telegram_user_id ?? null;

    // Bot token (link bot, matches existing webhook pattern).
    let botToken: string | null = null;
    let botId: string | null = null;
    try {
      const { data: bot } = await supabase
        .from("telegram_bots")
        .select("id, token, bot_token_encrypted")
        .eq("is_link_bot", true)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      botToken = (bot as any)?.token ?? null;
      botId = (bot as any)?.id ?? null;
    } catch { /* best-effort */ }

    const commonMeta: Record<string, unknown> = {
      event: args.event,
      user_id: args.userId,
      subscription_v2_id: args.subscriptionV2Id,
      provider_subscription_id: args.providerSubscriptionId ?? null,
      installment_payment_id: args.installmentPaymentId ?? null,
      transaction_uid: args.transactionUid ?? null,
      provider_event_id: args.providerEventId ?? null,
      amount: args.amount ?? null,
      currency: args.currency ?? null,
      product_name: args.productName ?? null,
      policy_source: policy.source,
      ...args.meta,
    };

    const messageType = args.event; // reuse event name as message_type

    // Telegram
    if (telegramChatId && botToken) {
      const key = buildIdempotencyKey(args, "telegram");
      const claim = await claimSlot(supabase, args.userId, "telegram", messageType, key, commonMeta);
      if (claim.claimed) {
        result.claimed.telegram = 1;
        const text = renderTelegram(args);
        try {
          const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: telegramChatId, text, parse_mode: "Markdown" }),
          });
          const j = await r.json();
          if (j?.ok === true) {
            result.sent.telegram = 1;
            const tgMsgId = typeof j?.result?.message_id === "number" ? j.result.message_id : null;
            await markSent(supabase, key, { ...commonMeta, telegram_message_id: tgMsgId });
            if (tgMsgId && botId) {
              try {
                await logAutomatedTelegramMessage({
                  supabase,
                  user_id: args.userId,
                  telegram_user_id: telegramChatId,
                  bot_id: botId,
                  text,
                  telegram_message_id: tgMsgId,
                  source: "bepaid-webhook-lifecycle",
                  extra_meta: { ...commonMeta, idempotency_key: key },
                });
              } catch { /* best-effort mirror */ }
            }
          } else {
            const err = j?.description ?? `HTTP ${r.status}`;
            result.telegram_error = String(err);
            await markFailed(supabase, key, String(err));
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          result.telegram_error = msg;
          await markFailed(supabase, key, msg);
        }
      }
    }

    // Email
    if (email) {
      const key = buildIdempotencyKey(args, "email");
      const claim = await claimSlot(supabase, args.userId, "email", messageType, key, commonMeta);
      if (claim.claimed) {
        result.claimed.email = 1;
        const rendered = renderEmail(args);
        try {
          const { error: sendErr } = await supabase.functions.invoke("send-email", {
            body: {
              to: email,
              subject: rendered.subject,
              html: rendered.html,
              context: { user_id: args.userId, event_type: args.event, meta: commonMeta },
            },
          });
          if (sendErr) {
            const msg = (sendErr as any)?.message ?? "email_send_failed";
            result.email_error = String(msg);
            await markFailed(supabase, key, String(msg));
          } else {
            result.sent.email = 1;
            await markSent(supabase, key, { ...commonMeta, email_subject: rendered.subject });
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          result.email_error = msg;
          await markFailed(supabase, key, msg);
        }
      }
    }
  } catch (e) {
    console.error("[lifecycle-notify] top-level exception:", e);
  }

  return result;
}
