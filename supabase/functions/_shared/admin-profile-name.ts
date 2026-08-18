export interface AdminProfileNameSource {
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
}

function cleanNamePart(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Canonical client identity for administrator-facing notifications.
 *
 * Unlike buyer greetings, admin notifications must identify the person as
 * precisely as the profile allows. The contact center displays structured
 * names as "Фамилия Имя", so Telegram notifications use the same order.
 */
export function resolveAdminProfileName(
  profile: AdminProfileNameSource | null | undefined,
): string | null {
  if (!profile) return null;

  const firstName = cleanNamePart(profile.first_name);
  const lastName = cleanNamePart(profile.last_name);
  const fullName = cleanNamePart(profile.full_name);

  if (firstName && lastName) return `${lastName} ${firstName}`;
  if (fullName) return fullName;
  if (lastName) return lastName;
  if (firstName) return firstName;
  return null;
}
