export function resolveInstallmentTelegramRecipientUserId(
  contactUserId?: string | null,
  dealUserId?: string | null,
): string | null {
  const currentContactUserId = contactUserId?.trim();
  if (currentContactUserId) return currentContactUserId;

  const originalDealUserId = dealUserId?.trim();
  return originalDealUserId || null;
}
