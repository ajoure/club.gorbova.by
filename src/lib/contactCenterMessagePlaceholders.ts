import { format } from "date-fns";

export type ContactCenterPlaceholderContext = {
  fullName?: string | null;
  telegramUsername?: string | null;
  now?: Date;
};

/**
 * A Contact Center dialog has one selected recipient. Resolve only variables
 * that are unambiguous for this dialog before anything leaves the browser.
 */
export function renderContactCenterMessagePlaceholders(
  template: string,
  { fullName, telegramUsername, now = new Date() }: ContactCenterPlaceholderContext,
): string {
  const nameParts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const values: Record<string, string> = {
    full_name: fullName?.trim() ?? "",
    first_name: nameParts[0] ?? "",
    last_name: nameParts.slice(1).join(" "),
    telegram_username: telegramUsername?.replace(/^@/, "") ?? "",
    today: format(now, "dd.MM.yyyy"),
    tomorrow: format(tomorrow, "dd.MM.yyyy"),
  };

  return template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (token, key) =>
    Object.hasOwn(values, key) ? values[key] : token,
  );
}
