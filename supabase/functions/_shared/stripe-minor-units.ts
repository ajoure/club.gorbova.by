// Phase 4.1 — Canonical Stripe minor-units converter.
//
// Stripe API ALWAYS принимает суммы в minor units (наименьшая денежная единица).
// Все валюты, которые мы используем, — двузначные (100 minor = 1 major).
// Список zero-decimal валют Stripe (JPY, KRW, VND и т.д.) НЕ применяется в нашем флоу;
// в случае попытки использовать такую валюту мы выбрасываем ошибку, чтобы не получить
// тихий 100x-overcharge.
//
// SOT: ВСЕ места, где сумма уходит в Stripe (one-time checkout, subscription line_items
// без price_id), обязаны использовать `toStripeMinorUnits`.
//
// Контракт:
//   amountMajor: number — сумма в основной валюте (например, 5 EUR, 100 BYN, 24.99 USD).
//   currency:    string — ISO-код, любая регистровая форма.
// returns: integer minor units (Math.round для защиты от 24.99 → 2499 округления).
//
// throws: Error('unsupported_zero_decimal_currency:JPY') и т.д., если валюта попадает
//         в zero-decimal список Stripe.

const SUPPORTED_TWO_DECIMAL_CURRENCIES = new Set([
  'usd', 'eur', 'pln', 'byn', 'rub', 'gbp', 'chf', 'cad', 'aud',
  'czk', 'sek', 'nok', 'dkk', 'huf', 'bgn', 'ron', 'uah',
]);

// Stripe zero-decimal: amount передаётся как-есть, без *100.
// https://stripe.com/docs/currencies#zero-decimal
const STRIPE_ZERO_DECIMAL = new Set([
  'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg',
  'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf',
]);

export function toStripeMinorUnits(amountMajor: number, currency: string): number {
  if (!Number.isFinite(amountMajor) || amountMajor <= 0) {
    throw new Error(`invalid_amount_for_stripe:${amountMajor}`);
  }
  const cur = String(currency || '').trim().toLowerCase();
  if (!cur) throw new Error('missing_currency_for_stripe');
  if (STRIPE_ZERO_DECIMAL.has(cur)) {
    // Защита от тихого 100x overcharge. Если когда-нибудь понадобится JPY/KRW —
    // явный кейс через отдельный helper и осознанное решение.
    throw new Error(`unsupported_zero_decimal_currency:${cur.toUpperCase()}`);
  }
  if (!SUPPORTED_TWO_DECIMAL_CURRENCIES.has(cur)) {
    // Не блокируем, но явно логируем — двузначные валюты вне списка тоже работают как *100.
    console.warn(`[toStripeMinorUnits] currency not in known set, assuming 2-decimal: ${cur}`);
  }
  // Math.round (half-away-from-zero для положительных = half-up) защищает от
  // 24.99 → 2498.999... → 2498 floor-бага.
  return Math.round(amountMajor * 100);
}

// Self-proof (dev only): node-style assertions при импорте под отладкой не нужны;
// proof таблица в .lovable/proofs/stripe_phase_4_1_provider_routing_v1.md.
//   toStripeMinorUnits(5, 'EUR')  === 500
//   toStripeMinorUnits(5, 'eur')  === 500
//   toStripeMinorUnits(100, 'BYN')=== 10000
//   toStripeMinorUnits(24.99,'USD') === 2499
//   toStripeMinorUnits(0.10,'PLN') === 10
//   toStripeMinorUnits(1, 'JPY')  throws unsupported_zero_decimal_currency:JPY
