const UNRESOLVED_TEMPLATE_TOKEN = /\{\{\s*[^{}]+\s*\}\}/g;

/**
 * Removes unresolved provider template tokens such as {{last_name}} without
 * inventing missing name parts.
 */
export function sanitizeExternalDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const cleaned = value
    .replace(UNRESOLVED_TEMPLATE_TOKEN, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || null;
}
