export const REFERRAL_STORAGE_KEY = "gorbova_referral_code";

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
  if (typeof window === "undefined") return `/r/${encodeURIComponent(partnerCode)}`;
  return `${window.location.origin}/r/${encodeURIComponent(partnerCode)}`;
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
