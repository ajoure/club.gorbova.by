/**
 * Normalize a company phone at the CRM boundary.
 * Belarusian local numbers are stored in E.164 form so the call and SMS
 * integrations receive the same value regardless of import formatting.
 */
export function normalizeCompanyPhone(value: string | null | undefined, country = "BY"): string | null {
  if (!value) return null;

  const compact = value
    .trim()
    .replace(/^=+/, "")
    .replace(/[^\d+]/g, "");
  if (!compact) return null;

  if (/^\+375\d{9}$/.test(compact)) return compact;
  if (/^375\d{9}$/.test(compact)) return `+${compact}`;

  const digits = compact.replace(/\D/g, "");
  if (country.toUpperCase() === "BY") {
    // Belarusian trunk notation is commonly written as 80 + the nine-digit
    // subscriber number (for example, 80291234567). Drop the trunk prefix
    // before adding the country code; accepting a bare 8 would shift digits.
    if (/^80\d{9}$/.test(digits)) return `+375${digits.slice(2)}`;
    if (/^\d{9}$/.test(digits)) return `+375${digits}`;
  }

  return compact;
}
