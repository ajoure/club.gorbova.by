export const REFERRAL_STORAGE_KEY = "gorbova_referral_code";

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
