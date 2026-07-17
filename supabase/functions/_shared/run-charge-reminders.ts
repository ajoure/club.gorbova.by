// B4/B5/B6 — Runner for upcoming-charge reminders (subscription-managed + finite installment).
// Reads canonical charge-notification policy, computes TZ-aware calendar days,
// enforces atomic idempotency via notification_outbox.idempotency_key.
//
// Design notes:
//   * Branch is separate from the legacy "access-end" reminder (see index.ts loop).
//   * Idempotency: INSERT into notification_outbox first (status='sending'); if the
//     unique constraint fires (23505) → another cron already claimed this reminder
//     and we skip. Only after a successful claim we send.
//   * dry_run: no outbox writes, no sends, returns fully-rendered payload.

import { resolveChargeNotificationPolicy, type ChargeNotificationPolicy } from './charge-notification-policy.ts';
import {
  calendarDaysBefore,
  installmentReminderKey,
  subscriptionReminderKey,
  renderInstallmentTelegram,
  renderInstallmentEmail,
  renderSubscriptionChargeTelegram,
  renderSubscriptionChargeEmail,
  formatChargeDateTime,
  type ChargeChannel,
} from './charge-reminder-scheduling.ts';
import { toTzDateKey } from './timezone.ts';

export type ChargeReminderPreview = {
  provider_subscription_id: string;
  subscription_v2_id: string | null;
  user_id: string;
  kind: 'installment' | 'subscription';
  days_before: number;
  effective_charge_at: string;
  effective_charge_source: 'provider_next_charge_at' | 'installment_due_date';
  provider_drift_hours?: number;
  installment_payment_id?: string;
  payment_number?: number;
  total_payments?: number;
  amount: number;
  currency: string;
  timezone: string;
  policy_source: ChargeNotificationPolicy['source'];
  policy_enabled: boolean;
  reminder_days: number[];
  idempotency_keys: Record<ChargeChannel, string>;
  telegram_text?: string;
  email_subject?: string;
  email_html?: string;
  skipped?: string;
};

export type RunChargeRemindersResult = {
  scanned: number;
  eligible: number;
  claimed: { telegram: number; email: number };
  sent: { telegram: number; email: number };
  dry_run: boolean;
  previews: ChargeReminderPreview[];
};

// Atomic claim of an idempotency slot in notification_outbox.
// Returns true if this run owns the slot, false if a concurrent run already claimed it.
async function claimOutboxSlot(
  supabase: any,
  args: {
    userId: string;
    channel: ChargeChannel;
    messageType: string;
    idempotencyKey: string;
    meta: Record<string, unknown>;
  },
): Promise<boolean> {
  const { error } = await supabase.from('notification_outbox').insert({
    user_id: args.userId,
    channel: args.channel,
    message_type: args.messageType,
    idempotency_key: args.idempotencyKey,
    source: 'subscription-renewal-reminders',
    status: 'sending',
    meta: args.meta,
  });
  if (!error) return true;
  // 23505 unique_violation → someone else already claimed
  if ((error as any)?.code === '23505') return false;
  console.error('[charge-reminders] outbox claim error:', error);
  return false;
}

async function markOutboxSent(
  supabase: any,
  idempotencyKey: string,
  metaPatch: Record<string, unknown>,
): Promise<void> {
  await supabase
    .from('notification_outbox')
    .update({ status: 'sent', sent_at: new Date().toISOString(), meta: metaPatch })
    .eq('idempotency_key', idempotencyKey);
}

async function markOutboxFailed(
  supabase: any,
  idempotencyKey: string,
  reason: string,
): Promise<void> {
  await supabase
    .from('notification_outbox')
    .update({ status: 'failed', blocked_reason: reason })
    .eq('idempotency_key', idempotencyKey);
}

async function sendTelegram(botToken: string | null, chatId: string | number, text: string): Promise<boolean> {
  if (!botToken) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    });
    const j = await r.json();
    return j?.ok === true;
  } catch (e) {
    console.error('[charge-reminders] telegram send error:', e);
    return false;
  }
}

async function sendEmail(supabase: any, to: string, subject: string, html: string, context: Record<string, unknown>): Promise<boolean> {
  try {
    const { error } = await supabase.functions.invoke('send-email', {
      body: { to, subject, html, context },
    });
    if (error) {
      console.error('[charge-reminders] send-email error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[charge-reminders] send-email exception:', e);
    return false;
  }
}

export type RunChargeRemindersArgs = {
  supabase: any;
  botToken: string | null;
  nowIso?: string;
  dryRun?: boolean;
  /** Optional filter: only process this provider_subscription (for smoke tests). */
  onlyProviderSubscriptionId?: string;
};

export async function runChargeReminders(
  args: RunChargeRemindersArgs,
): Promise<RunChargeRemindersResult> {
  const { supabase, botToken } = args;
  const nowIso = args.nowIso ?? new Date().toISOString();
  const dryRun = args.dryRun === true;

  const previews: ChargeReminderPreview[] = [];
  let scanned = 0;
  let eligible = 0;
  const claimed = { telegram: 0, email: 0 };
  const sent = { telegram: 0, email: 0 };

  // 1. Load candidates: provider_subscriptions with next_charge_at, active/trialing.
  let psQuery = supabase
    .from('provider_subscriptions')
    .select(`
      id, user_id, subscription_v2_id, state, next_charge_at, amount_cents, currency,
      subscriptions_v2 (
        id, user_id, tariff_id, meta, payment_type,
        tariffs (
          id, name, product_id,
          products_v2 ( id, name )
        )
      )
    `)
    .in('state', ['active', 'trialing'])
    .not('next_charge_at', 'is', null);
  if (args.onlyProviderSubscriptionId) {
    psQuery = psQuery.eq('id', args.onlyProviderSubscriptionId);
  }
  const { data: rows, error } = await psQuery;
  if (error) {
    console.error('[charge-reminders] load error:', error);
    return { scanned: 0, eligible: 0, claimed, sent, dry_run: dryRun, previews };
  }

  for (const ps of rows ?? []) {
    scanned++;
    const subV2: any = ps.subscriptions_v2;
    if (!subV2) continue;

    const meta = subV2.meta ?? {};
    const policy = resolveChargeNotificationPolicy(meta);

    // Pre-charge reminders are gated by enabled + reminder_days membership.
    // (failure/retry-exhausted paths flow through bepaid-webhook, not here.)
    if (!policy.enabled) continue;
    if (!Array.isArray(policy.reminder_days) || policy.reminder_days.length === 0) continue;

    // Determine kind: installment vs subscription.
    let pending: any = null;
    let kind: 'installment' | 'subscription' = 'subscription';
    let effectiveChargeIso = ps.next_charge_at as string;
    let effectiveSource: ChargeReminderPreview['effective_charge_source'] = 'provider_next_charge_at';
    let providerDriftHours: number | undefined;

    const { data: pendingRow } = await supabase
      .from('installment_payments')
      .select('id, payment_number, total_payments, amount, currency, due_date')
      .eq('subscription_id', subV2.id)
      .eq('status', 'pending')
      .order('payment_number', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (pendingRow) {
      kind = 'installment';
      pending = pendingRow;
      // Prefer provider next_charge_at when available; fallback to due_date.
      if (!ps.next_charge_at) {
        effectiveChargeIso = pending.due_date;
        effectiveSource = 'installment_due_date';
        await supabase.from('audit_logs').insert({
          action: 'installment.provider_next_charge_missing',
          actor_type: 'system',
          actor_label: 'subscription-renewal-reminders',
          meta: {
            provider_subscription_id: ps.id,
            subscription_v2_id: subV2.id,
            installment_payment_id: pending.id,
            due_date: pending.due_date,
          },
        });
      } else {
        // Detect > 6h drift for observability.
        const drift = Math.abs(new Date(ps.next_charge_at).getTime() - new Date(pending.due_date).getTime());
        providerDriftHours = drift / 3600000;
        if (providerDriftHours > 6) {
          await supabase.from('audit_logs').insert({
            action: 'installment.schedule_provider_drift',
            actor_type: 'system',
            actor_label: 'subscription-renewal-reminders',
            meta: {
              provider_subscription_id: ps.id,
              installment_payment_id: pending.id,
              next_charge_at: ps.next_charge_at,
              due_date: pending.due_date,
              drift_hours: providerDriftHours,
            },
          });
        }
      }

      // If payment_number > total_payments (edge/data anomaly) — skip.
      if (pending.payment_number > pending.total_payments) {
        previews.push({
          provider_subscription_id: ps.id,
          subscription_v2_id: subV2.id,
          user_id: ps.user_id,
          kind,
          days_before: -1,
          effective_charge_at: effectiveChargeIso,
          effective_charge_source: effectiveSource,
          amount: Number(pending.amount) || 0,
          currency: pending.currency || 'BYN',
          timezone: policy.timezone,
          policy_source: policy.source,
          policy_enabled: policy.enabled,
          reminder_days: policy.reminder_days,
          idempotency_keys: {
            telegram: installmentReminderKey(pending.id, 0, 'telegram'),
            email: installmentReminderKey(pending.id, 0, 'email'),
          },
          skipped: 'installment_completed',
        });
        continue;
      }
    }

    if (!effectiveChargeIso) continue;

    const daysBefore = calendarDaysBefore(nowIso, effectiveChargeIso, policy.timezone);
    if (!policy.reminder_days.includes(daysBefore)) continue;

    eligible++;

    // Resolve product / tariff / amount for message rendering.
    const tariff: any = subV2.tariffs ?? {};
    const product: any = tariff.products_v2 ?? {};
    const productName = product?.name || 'Продукт';
    const tariffName = tariff?.name || 'Тариф';

    let amount = 0;
    let currency = 'BYN';
    if (kind === 'installment' && pending) {
      amount = Number(pending.amount) || 0;
      currency = pending.currency || 'BYN';
    } else {
      amount = Number(ps.amount_cents ?? 0) / 100;
      currency = (ps.currency as string) || 'BYN';
    }

    // Load recipient info (email + telegram chat).
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, email, telegram_user_id')
      .eq('user_id', ps.user_id)
      .maybeSingle();

    let email = profile?.email as string | null | undefined;
    if (!email) {
      const { data: authUser } = await supabase.auth.admin.getUserById(ps.user_id);
      email = authUser?.user?.email ?? null;
    }
    const telegramChatId = profile?.telegram_user_id ?? null;

    const effectiveDateKey = toTzDateKey(effectiveChargeIso, policy.timezone);

    const tgKey =
      kind === 'installment' && pending
        ? installmentReminderKey(pending.id, daysBefore, 'telegram')
        : subscriptionReminderKey(ps.id, effectiveDateKey, daysBefore, 'telegram');
    const emailKey =
      kind === 'installment' && pending
        ? installmentReminderKey(pending.id, daysBefore, 'email')
        : subscriptionReminderKey(ps.id, effectiveDateKey, daysBefore, 'email');

    const tgText =
      kind === 'installment' && pending
        ? renderInstallmentTelegram({
            productName,
            paymentNumber: pending.payment_number,
            totalPayments: pending.total_payments,
            amount,
            currency,
            effectiveChargeIso,
            timezone: policy.timezone,
            daysBefore,
          })
        : renderSubscriptionChargeTelegram({
            productName,
            tariffName,
            amount,
            currency,
            effectiveChargeIso,
            timezone: policy.timezone,
            daysBefore,
          });

    const emailBody =
      kind === 'installment' && pending
        ? renderInstallmentEmail({
            productName,
            paymentNumber: pending.payment_number,
            totalPayments: pending.total_payments,
            amount,
            currency,
            effectiveChargeIso,
            timezone: policy.timezone,
            daysBefore,
          })
        : renderSubscriptionChargeEmail({
            productName,
            tariffName,
            amount,
            currency,
            effectiveChargeIso,
            timezone: policy.timezone,
            daysBefore,
          });

    const preview: ChargeReminderPreview = {
      provider_subscription_id: ps.id,
      subscription_v2_id: subV2.id,
      user_id: ps.user_id,
      kind,
      days_before: daysBefore,
      effective_charge_at: effectiveChargeIso,
      effective_charge_source: effectiveSource,
      provider_drift_hours: providerDriftHours,
      installment_payment_id: pending?.id,
      payment_number: pending?.payment_number,
      total_payments: pending?.total_payments,
      amount,
      currency,
      timezone: policy.timezone,
      policy_source: policy.source,
      policy_enabled: policy.enabled,
      reminder_days: policy.reminder_days,
      idempotency_keys: { telegram: tgKey, email: emailKey },
      telegram_text: tgText,
      email_subject: emailBody.subject,
      email_html: emailBody.html,
    };

    if (dryRun) {
      previews.push(preview);
      continue;
    }

    const commonMeta = {
      provider_subscription_id: ps.id,
      subscription_v2_id: subV2.id,
      installment_payment_id: pending?.id ?? null,
      kind,
      days_before: daysBefore,
      effective_charge_at: effectiveChargeIso,
      effective_charge_source: effectiveSource,
      timezone: policy.timezone,
      policy_source: policy.source,
      amount,
      currency,
    };

    // -------- Telegram channel --------
    if (telegramChatId) {
      const ok = await claimOutboxSlot(supabase, {
        userId: ps.user_id,
        channel: 'telegram',
        messageType: kind === 'installment' ? 'installment_charge_reminder' : 'subscription_charge_reminder',
        idempotencyKey: tgKey,
        meta: commonMeta,
      });
      if (ok) {
        claimed.telegram++;
        const delivered = await sendTelegram(botToken, telegramChatId, tgText);
        if (delivered) {
          sent.telegram++;
          await markOutboxSent(supabase, tgKey, { ...commonMeta, telegram_text_len: tgText.length });
        } else {
          await markOutboxFailed(supabase, tgKey, 'telegram_send_failed');
        }
      }
    }

    // -------- Email channel --------
    if (email) {
      const ok = await claimOutboxSlot(supabase, {
        userId: ps.user_id,
        channel: 'email',
        messageType: kind === 'installment' ? 'installment_charge_reminder' : 'subscription_charge_reminder',
        idempotencyKey: emailKey,
        meta: commonMeta,
      });
      if (ok) {
        claimed.email++;
        const delivered = await sendEmail(supabase, email, emailBody.subject, emailBody.html, {
          user_id: ps.user_id,
          provider_subscription_id: ps.id,
          subscription_id: subV2.id,
          event_type: kind === 'installment' ? 'installment_charge_reminder' : 'subscription_charge_reminder',
          meta: commonMeta,
        });
        if (delivered) {
          sent.email++;
          await markOutboxSent(supabase, emailKey, { ...commonMeta, email_subject: emailBody.subject });
        } else {
          await markOutboxFailed(supabase, emailKey, 'email_send_failed');
        }
      }
    }

    previews.push(preview);
  }

  return { scanned, eligible, claimed, sent, dry_run: dryRun, previews };
}
