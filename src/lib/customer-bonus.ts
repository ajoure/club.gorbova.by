import { supabase } from "@/integrations/supabase/client";

export type BonusEntry = {
  id: string; amount_minor: number; entry_type: string; status: string; created_at: string;
  reason?: string | null; actor_user_id?: string | null; source_payment_id?: string | null;
  request_id?: string | null;
};
export type BonusRequest = {
  requestId: string; profileId: string; amountMinor: number; reason: string; paymentId: string | null;
};
export type BonusWallet = {
  available_minor: number; currency: "BYN"; entries: BonusEntry[];
  payments?: Array<{ id: string; amount_minor: number; product_name: string; paid_at: string | null; already_credited: boolean }>;
  request?: { entry_id: string; profile_id: string; amount_minor: number; reason: string; source_payment_id: string | null; status: string } | null;
};

// Parse decimal text directly, avoiding rounding an imprecise float amount.
export function parseBonusMinor(value: string): number | null {
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const minor = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

export const bonusEntryLabel = (type: string) => ({
  admin_adjustment: "Начислено администратором", subscription_earn: "Бонус за оплату",
  purchase_reserve: "Использовано при покупке", refund_reversal: "Корректировка после возврата",
}[type] ?? "Бонусная операция");

export async function readAdminBonusWallet(profileId: string, requestId?: string): Promise<BonusWallet> {
  const { data, error } = await supabase.rpc("admin_get_customer_bonus_wallet", {
    p_profile_id: profileId, p_request_id: requestId ?? null,
  });
  if (error) throw error;
  return data as unknown as BonusWallet;
}

export function matchesBonusRequest(wallet: BonusWallet, request: BonusRequest, entryId?: string): boolean {
  const entry = wallet.request;
  return !!entry && (!entryId || entry.entry_id === entryId) && entry.profile_id === request.profileId
    && Number(entry.amount_minor) === request.amountMinor && entry.reason === request.reason
    && entry.source_payment_id === request.paymentId && entry.status === "posted";
}

export function bonusErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? "");
  if (message.includes("bonus_payment_already_credited")) return "По этому платежу бонус уже начислен. Обновите историю.";
  if (message.includes("bonus_admin_required")) return "Начислять бонусы может только администратор.";
  if (/bonus_payment_(not_eligible|contact_conflict|refund_found)/.test(message)) return "Платёж не подходит: проверьте контакт, валюту, сумму и возвраты.";
  if (message.includes("bonus_request_conflict")) return "Эта операция уже записана с другими данными. Проверьте историю.";
  if (message.includes("bonus_contact_not_found")) return "Контакт недоступен или находится в архиве.";
  return "Не удалось подтвердить начисление. Проверьте результат перед дальнейшими действиями.";
}
