/**
 * Keeps the company list and linked-contact cards name-only.
 * Legacy imports sometimes stored a phone or email in external_full_name;
 * those values belong in contact details, never in the display-name slot.
 */
export function isLikelyContactName(value: string | null | undefined): value is string {
  const name = value?.trim();
  if (!name || /@/.test(name) || /^(?:tel|mailto):/i.test(name)) return false;
  const compact = name.replace(/[\s().+\-]/g, "");
  return !(compact.length >= 7 && /^\d+$/.test(compact));
}

export function getContactDisplayName(...candidates: Array<string | null | undefined>): string {
  return candidates.find((candidate): candidate is string => isLikelyContactName(candidate))?.trim() || "Контакт без имени";
}
