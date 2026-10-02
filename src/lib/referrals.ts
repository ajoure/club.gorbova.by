export const REFERRAL_STORAGE_KEY = "gorbova_referral_code";
export const REFERRAL_PUBLIC_ORIGIN = "https://gorbova.by";

export interface CapturedReferral {
  code: string;
  capturedAt: string;
}

export function storeCapturedReferral(code: string) {
  const payload: CapturedReferral = { code, capturedAt: new Date().toISOString() };
  localStorage.setItem(REFERRAL_STORAGE_KEY, JSON.stringify(payload));
}

export function readCapturedReferral(): CapturedReferral | null {
  const raw = localStorage.getItem(REFERRAL_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CapturedReferral>;
    if (typeof parsed.code === "string" && typeof parsed.capturedAt === "string") {
      return { code: parsed.code, capturedAt: parsed.capturedAt };
    }
  } catch {
    // Legacy value created before timestamped capture: keep it unusable for automatic attribution.
  }
  return null;
}

export function formatBynMinor(amountMinor: number | string | null | undefined) {
  const value = Number(amountMinor ?? 0) / 100;
  return new Intl.NumberFormat("ru-BY", {
    style: "currency",
    currency: "BYN",
    minimumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

export function buildReferralLink(partnerCode: string) {
  return `${REFERRAL_PUBLIC_ORIGIN}/r/${encodeURIComponent(partnerCode.trim())}`;
}

export function referralStatusLabel(status: string) {
  const labels: Record<string, string> = {
    shadow: "Тестовый расчёт",
    pending: "Ожидает окончания срока возврата",
    available: "Доступно к выплате",
    partially_reversed: "Частично возвращено",
    reversed: "Возвращено",
    declined: "Не начислено",
    fraud_hold: "На проверке",
    active: "Активен",
    paused: "Приостановлен",
    blocked: "Заблокирован",
  };
  return labels[status] ?? status;
}

/** Parse BYN input without floating-point rounding or implicit NaN/null. */
export function parseBynMinor(value: string): number {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error("Укажите сумму BYN с не более чем двумя знаками после запятой");
  const [whole, fraction = ""] = normalized.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor) || minor > 1_000_000_000) throw new Error("Сумма выходит за допустимый предел");
  return minor;
}
