// B4/B5/B6 — Shared helpers for upcoming-charge reminders (subscription + installment).
// Timezone-aware calendar-day diff, canonical templates, canonical idempotency keys.

import { toTzDateKey, dayWindowUtc } from './timezone.ts';

export type ChargeChannel = 'telegram' | 'email';

/**
 * Calendar-day difference between two ISO timestamps *evaluated in the given timezone*.
 * Uses midnight-anchored UTC of each local date to avoid DST drift.
 * Returns integer days (target - now). Positive = target is in the future.
 */
export function calendarDaysBefore(nowIso: string, targetIso: string, tz: string): number {
  const nowKey = toTzDateKey(nowIso, tz);
  const targetKey = toTzDateKey(targetIso, tz);
  const nowMs = new Date(dayWindowUtc(tz, nowKey).start).getTime();
  const targetMs = new Date(dayWindowUtc(tz, targetKey).start).getTime();
  return Math.round((targetMs - nowMs) / 86400000);
}

/**
 * Format an ISO instant as "DD.MM.YYYY HH:mm" in a given timezone (ru-RU).
 */
export function formatChargeDateTime(iso: string, tz: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: tz,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')}`;
}

// ------- Idempotency keys (unique across notification_outbox.idempotency_key) -------

export function installmentReminderKey(
  installmentPaymentId: string,
  daysBefore: number,
  channel: ChargeChannel,
): string {
  return `installment_charge_reminder:${installmentPaymentId}:${daysBefore}:${channel}`;
}

export function subscriptionReminderKey(
  providerSubscriptionId: string,
  effectiveChargeDateKey: string,
  daysBefore: number,
  channel: ChargeChannel,
): string {
  return `subscription_charge_reminder:${providerSubscriptionId}:${effectiveChargeDateKey}:${daysBefore}:${channel}`;
}

export function installmentFailureKey(installmentPaymentId: string, channel: ChargeChannel): string {
  return `installment_charge_failed:${installmentPaymentId}:${channel}`;
}

export function installmentRetryExhaustedKey(
  installmentPaymentId: string,
  channel: ChargeChannel,
): string {
  return `installment_charge_retry_exhausted:${installmentPaymentId}:${channel}`;
}

// ---------- Templates (installment-specific, per B5) ----------

export type InstallmentTemplateInput = {
  productName: string;
  paymentNumber: number;
  totalPayments: number;
  amount: number;
  currency: string;
  effectiveChargeIso: string;
  timezone: string;
  daysBefore: number;
};

function formatAmount(a: number, currency: string): string {
  return `${a.toFixed(2)} ${currency}`;
}

function daysWord(n: number): string {
  if (n === 1) return 'день';
  if (n >= 2 && n <= 4) return 'дня';
  return 'дней';
}

export function renderInstallmentTelegram(input: InstallmentTemplateInput): string {
  const when = formatChargeDateTime(input.effectiveChargeIso, input.timezone);
  const dLabel =
    input.daysBefore === 0
      ? 'сегодня'
      : `через ${input.daysBefore} ${daysWord(input.daysBefore)}`;
  return [
    `🔔 *Напоминание об автоплатеже*`,
    ``,
    `📦 *Продукт:* ${input.productName}`,
    `💳 *Платёж:* №${input.paymentNumber} из ${input.totalPayments}`,
    `💰 *Сумма:* ${formatAmount(input.amount, input.currency)}`,
    `📆 *Дата списания:* ${when} (${dLabel})`,
    ``,
    `Если данные карты изменились — обновите способ оплаты в личном кабинете.`,
  ].join('\n');
}

export function renderInstallmentEmail(input: InstallmentTemplateInput): {
  subject: string;
  html: string;
} {
  const when = formatChargeDateTime(input.effectiveChargeIso, input.timezone);
  const subject = `Напоминание об автоплатеже — платёж №${input.paymentNumber} из ${input.totalPayments}`;
  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <h1 style="color:#1f2937;font-size:22px;margin-bottom:16px">Напоминание об автоплатеже</h1>
  <p>Здравствуйте!</p>
  <p>Напоминаем о предстоящем автоматическом списании по вашей рассрочке.</p>
  <div style="background:#f3f4f6;border-radius:8px;padding:16px;margin:16px 0">
    <p style="margin:0 0 8px 0"><strong>📦 Продукт:</strong> ${input.productName}</p>
    <p style="margin:0 0 8px 0"><strong>💳 Платёж:</strong> №${input.paymentNumber} из ${input.totalPayments}</p>
    <p style="margin:0 0 8px 0"><strong>💰 Сумма:</strong> ${formatAmount(input.amount, input.currency)}</p>
    <p style="margin:0"><strong>📆 Дата списания:</strong> ${when}</p>
  </div>
  <p style="color:#6b7280">Если данные карты изменились — обновите способ оплаты в личном кабинете.</p>
</div>`.trim();
  return { subject, html };
}

// ---------- Subscription (recurring, non-installment) templates ----------

export type SubscriptionTemplateInput = {
  productName: string;
  tariffName: string;
  amount: number;
  currency: string;
  effectiveChargeIso: string;
  timezone: string;
  daysBefore: number;
};

export function renderSubscriptionChargeTelegram(input: SubscriptionTemplateInput): string {
  const when = formatChargeDateTime(input.effectiveChargeIso, input.timezone);
  const dLabel =
    input.daysBefore === 0
      ? 'сегодня'
      : `через ${input.daysBefore} ${daysWord(input.daysBefore)}`;
  return [
    `🔔 *Напоминание об автоплатеже*`,
    ``,
    `📦 *Продукт:* ${input.productName}`,
    `🎯 *Тариф:* ${input.tariffName}`,
    `💰 *Сумма:* ${formatAmount(input.amount, input.currency)}`,
    `📆 *Дата списания:* ${when} (${dLabel})`,
    ``,
    `Управлять подпиской можно в личном кабинете.`,
  ].join('\n');
}

export function renderSubscriptionChargeEmail(input: SubscriptionTemplateInput): {
  subject: string;
  html: string;
} {
  const when = formatChargeDateTime(input.effectiveChargeIso, input.timezone);
  const subject = `Напоминание об автоплатеже — ${input.productName}`;
  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <h1 style="color:#1f2937;font-size:22px;margin-bottom:16px">Напоминание об автоплатеже</h1>
  <p>Здравствуйте!</p>
  <p>Напоминаем о предстоящем автоматическом списании.</p>
  <div style="background:#f3f4f6;border-radius:8px;padding:16px;margin:16px 0">
    <p style="margin:0 0 8px 0"><strong>📦 Продукт:</strong> ${input.productName}</p>
    <p style="margin:0 0 8px 0"><strong>🎯 Тариф:</strong> ${input.tariffName}</p>
    <p style="margin:0 0 8px 0"><strong>💰 Сумма:</strong> ${formatAmount(input.amount, input.currency)}</p>
    <p style="margin:0"><strong>📆 Дата списания:</strong> ${when}</p>
  </div>
  <p style="color:#6b7280">Управлять подпиской можно в личном кабинете.</p>
</div>`.trim();
  return { subject, html };
}
