import { resolveSystemTokens } from "@/lib/system-token-resolver";

export type ContactCenterPlaceholderContext = {
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  telegramUsername?: string | null;
  now?: Date;
};

/**
 * A Contact Center dialog has one selected recipient. Resolve only variables
 * that are unambiguous for this dialog before anything leaves the browser.
 */
export function renderContactCenterMessagePlaceholders(
  template: string,
  {
    fullName,
    firstName,
    lastName,
    email,
    phone,
    telegramUsername,
    now = new Date(),
  }: ContactCenterPlaceholderContext,
): string {
  const nameParts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  const resolvedFirstName = firstName?.trim() || nameParts[0] || "";
  const resolvedLastName = lastName?.trim() || nameParts.slice(1).join(" ");
  const resolvedFullName = fullName?.trim() || [resolvedLastName, resolvedFirstName].filter(Boolean).join(" ");
  const resolvedTelegramUsername = telegramUsername?.replace(/^@/, "") ?? "";
  const values: Record<string, string> = {
    full_name: resolvedFullName,
    first_name: resolvedFirstName,
    last_name: resolvedLastName,
    name: resolvedFullName,
    email: email?.trim() ?? "",
    phone: phone?.trim() ?? "",
    telegram_username: resolvedTelegramUsername,
    "contact.full_name": resolvedFullName,
    "contact.first_name": resolvedFirstName,
    "contact.last_name": resolvedLastName,
    "contact.email": email?.trim() ?? "",
    "contact.phone": phone?.trim() ?? "",
    "contact.telegram_username": resolvedTelegramUsername,
  };

  const withContactValues = template.replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, (token, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : token,
  );
  return resolveSystemTokens(withContactValues, now);
}
