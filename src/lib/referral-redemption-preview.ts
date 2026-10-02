import { parseBynMinor } from "./referrals";

/** Display estimate only. The server still validates every price and balance. */
export function redemptionPrice(offer: { amount_minor: number; recurring: Record<string, unknown> } | undefined, row: { price: string; unit: string; count: number }): number | null {
  if (!offer) return null;
  if (row.price.trim()) {
    try { const value = parseBynMinor(row.price); return value > 0 ? value : null; } catch { return null; }
  }
  if (!Number.isInteger(row.count) || row.count < 1 || row.count > (row.unit === "months" ? 120 : 3660)) return null;
  const recurring = offer.recurring.is_recurring === true || offer.recurring.is_recurring === "true";
  if (recurring && (row.unit !== "months" || !["month", "months"].includes(String(offer.recurring.billing_period_mode)))) return null;
  return offer.amount_minor * (recurring ? row.count : 1);
}

export function redemptionStartError(row: { startMode: string; start: string }, now = Date.now()): string | null {
  if (row.startMode !== "date") return null;
  const time = new Date(row.start).getTime();
  if (!Number.isFinite(time)) return "Укажите дату начала или выберите «Сейчас».";
  if (time <= now) return "Указанная дата начала уже прошла. Выберите «Начать сейчас» или будущую дату.";
  return null;
}
