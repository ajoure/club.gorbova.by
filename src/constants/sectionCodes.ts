/**
 * Маппинг sidebar key (kebab-case) → app_sections.code (snake_case).
 * Используется только в AppSidebar для резолва ключей навигации.
 * SectionGuard получает code напрямую через prop — маппинг ему не нужен.
 */
export const SIDEBAR_KEY_TO_SECTION_CODE: Record<string, string> = {
  "self-development": "self_development",
};

export function resolveSectionCode(key: string): string {
  return SIDEBAR_KEY_TO_SECTION_CODE[key] || key;
}
