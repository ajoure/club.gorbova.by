export function normalizeTelegramSearchInput(value: string | null | undefined): string {
  return (value || "").trim();
}

export function normalizeTelegramUsernameSearch(value: string | null | undefined): string {
  return normalizeTelegramSearchInput(value)
    .replace(/^(https?:\/\/)?(t\.me\/|telegram\.me\/)+/i, "")
    .replace(/^@+/, "")
    .trim()
    .toLowerCase();
}

export function normalizeTelegramNumericSearch(value: string | null | undefined): string {
  return (value || "").replace(/\s+/g, "").trim();
}
