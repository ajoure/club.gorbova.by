/**
 * Unified admin Telegram notification message builder.
 * Single source of truth for all payment notification formatting.
 * 
 * Rules:
 * - Empty fields are NOT rendered (line is hidden completely)
 * - All values are HTML-escaped
 * - parse_mode = HTML always
 * - Client name wrapped in <code> for copy-friendly display
 * - Product fallback: "не указан"; tariff: hidden if empty
 * - Phone removed from all notifications (PII)
 * - admin_label only for manual/admin-triggered operations
 * - Helper does NOT build URLs — accepts ready contact_url
 * - Domain is NOT hardcoded
 * - order_number removed from notifications
 * - IDs removed from payment notifications for visual clarity
 */

// =====================================================================
// Types
// =====================================================================

export type OperationType =
  | 'payment'
  | 'trial'
  | 'bepaid_subscription_payment'
  | 'subscription_renewal'
  | 'link_payment'
  | 'auto_payment'
  | 'reconciled_payment'
  | 'manual_charge';

export interface AdminNotifyMessageParams {
  operation_type: OperationType;

  client_name?: string | null;
  contact_url?: string | null;

  email?: string | null;
  telegram_username?: string | null;

  product_name?: string | null;
  tariff_name?: string | null;

  amount?: number | string | null;
  currency?: string | null;

  next_charge_at?: string | null;

  source_label?: string | null;
  admin_label?: string | null;
}

export interface BuildContactUrlParams {
  appBaseUrl: string;
  profileId?: string | null;
  email?: string | null;
  mode: 'search' | 'direct';
}

// =====================================================================
// Operation type → icon + title mapping (single source of truth)
// =====================================================================

const OPERATION_TITLES: Record<OperationType, string> = {
  payment: '💰 Оплата',
  trial: '🔔 Пробный период',
  bepaid_subscription_payment: '💰 Оплата через подписку bePaid',
  subscription_renewal: '🔁 Продление подписки',
  link_payment: '💳 Оплата по ссылке',
  auto_payment: '💰 Оплата (авто)',
  reconciled_payment: '🔄 Платёж восстановлен',
  manual_charge: '💳 Ручное списание',
};

// =====================================================================
// Utility functions
// =====================================================================

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Mask email: first 2 chars of local part + *** + full domain.
 * For short local parts (<2 chars): 1 char + ***.
 * Null/empty → 'не указан'.
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return 'не указан';
  const atIndex = email.indexOf('@');
  if (atIndex < 0) return '***';
  const local = email.substring(0, atIndex);
  const domain = email.substring(atIndex + 1);
  if (!domain) return '***';
  const keepChars = local.length < 2 ? Math.max(1, local.length) : 2;
  const prefix = local.substring(0, keepChars);
  return `${prefix}***@${domain}`;
}

/**
 * Format money: "29.00 BYN"
 */
export function formatMoney(amount: number | string | null | undefined, currency: string | null | undefined): string {
  if (amount == null) return '';
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return '';
  return `${num.toFixed(2)} ${currency || 'BYN'}`;
}

/**
 * Format date: DD.MM.YYYY HH:mm
 */
export function formatDate(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return '';
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Build client line: copy-friendly <code> display, no HTML links.
 */
export function buildClientLine(name: string | null | undefined, _contactUrl?: string | null | undefined): string {
  const safeName = escapeHtml(name || 'Не указано');
  return `<code>${safeName}</code>`;
}

/**
 * Build contact URL for admin panel (future-ready, not used in payment notifications).
 */
export function buildContactUrl(params: BuildContactUrlParams): string | null {
  const { appBaseUrl, profileId, email, mode } = params;

  if (!appBaseUrl) return null;

  const baseUrl = appBaseUrl.replace(/\/+$/, '');

  if (mode === 'direct') {
    if (!profileId) return null;
    return `${baseUrl}/admin/contacts/${encodeURIComponent(profileId)}`;
  }

  if (!email) return null;
  return `${baseUrl}/admin/contacts?search=${encodeURIComponent(email)}`;
}


// =====================================================================
// Main builder
// =====================================================================

export function buildAdminNotifyMessage(params: AdminNotifyMessageParams): string {
  const {
    operation_type,
    client_name,
    contact_url,
    email,
    telegram_username,
    product_name,
    tariff_name,
    amount,
    currency,
    next_charge_at,
    source_label,
    admin_label,
  } = params;

  const title = OPERATION_TITLES[operation_type] || '💰 Оплата';
  const lines: string[] = [];

  // Header
  lines.push(`${title}`);
  lines.push('');

  // Client block
  lines.push(`👤 <b>Клиент:</b> ${buildClientLine(client_name, contact_url)}`);

  const maskedEmail = maskEmail(email);
  lines.push(`📧 Email: ${escapeHtml(maskedEmail)}`);

  if (telegram_username) {
    lines.push(`💬 Telegram: @${escapeHtml(telegram_username)}`);
  }

  lines.push('');

  // Product block
  const productDisplay = product_name ? escapeHtml(product_name) : 'не указан';
  lines.push(`📦 <b>Продукт:</b> ${productDisplay}`);

  if (tariff_name) {
    lines.push(`📋 Тариф: ${escapeHtml(tariff_name)}`);
  }

  const moneyStr = formatMoney(amount, currency);
  if (moneyStr) {
    lines.push(`💵 Сумма: ${escapeHtml(moneyStr)}`);
  }

  if (next_charge_at) {
    const formattedDate = formatDate(next_charge_at);
    if (formattedDate) {
      lines.push(`🔄 Следующее списание: ${escapeHtml(formattedDate)}`);
    }
  }

  // ID block: priority bepaid_subscription_id > bepaid_payment_id, never both
  if (bepaid_subscription_id) {
    const compactId = formatCompactId(bepaid_subscription_id, 'SBS');
    lines.push(`📎 ID подписки: <code>${escapeHtml(compactId)}</code>`);
  } else if (bepaid_payment_id) {
    const compactId = formatCompactId(bepaid_payment_id, 'PAY');
    lines.push(`📎 ID платежа: <code>${escapeHtml(compactId)}</code>`);
  }

  if (source_label) {
    lines.push(`📎 Источник: ${escapeHtml(source_label)}`);
  }

  if (admin_label) {
    lines.push(`👨‍💼 Админ: ${escapeHtml(admin_label)}`);
  }

  return lines.join('\n');
}
