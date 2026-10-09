const keys = ["src", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
export function questionnaireAttribution(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const source = input as Record<string, unknown>;
  return Object.fromEntries(keys.flatMap(key => {
    const value = source[key];
    if (typeof value !== "string") return [];
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 200 || /[\u0000-\u001f\u007f]/.test(trimmed)) return [];
    return [[key, trimmed]];
  }));
}
