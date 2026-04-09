/**
 * Маппинг sidebar key → app_sections.code
 * Единственный источник истины для резолвинга section_code.
 * Используется в AppSidebar и SectionGuard.
 */
const SIDEBAR_KEY_TO_SECTION_CODE: Record<string, string> = {
  "self-development": "self_development",
};

/**
 * Резолвит section_code из произвольного ключа (sidebar key, route param и т.д.)
 * Если маппинг не найден — возвращает ключ as-is.
 */
export function resolveSectionCode(key: string): string {
  return SIDEBAR_KEY_TO_SECTION_CODE[key] || key;
}
