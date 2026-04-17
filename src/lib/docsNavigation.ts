/**
 * Canonical helper для навигации в /docs.
 *
 * Единый источник правды:
 * - какие hash-якоря существуют,
 * - в какой вкладке (user/admin) лежит секция,
 * - какой AccordionItem должен быть раскрыт.
 *
 * Все help-key и entry-point-кнопки должны ходить через resolveDocsTarget()
 * и openDocsSection() — иначе deep-link снова сломается.
 */

export type DocsTab = "user" | "admin";

export interface DocsTarget {
  /** Hash без # (например, "site-builder") */
  hash: string;
  /** Вкладка, в которой лежит секция */
  tab: DocsTab;
  /**
   * Optional accordion value, который нужно раскрыть после переключения вкладки.
   * Формат: `${sectionId}-${index}` — соответствует value в AccordionItem.
   */
  accordionValue?: string;
}

/**
 * Реестр секций документации.
 * Ключ = hash. Значение = куда вести пользователя.
 *
 * При добавлении нового раздела/help-key обязательно зарегистрируй его здесь,
 * иначе deep-link не сработает.
 */
export const DOCS_REGISTRY: Record<string, DocsTarget> = {
  // ─── Конструктор сайтов ──────────────────────────────────────────
  "site-builder": { hash: "site-builder", tab: "admin" },
  "site-builder-quickstart": { hash: "site-builder", tab: "admin", accordionValue: "site-builder-0" },
  "site-builder-howto": { hash: "site-builder", tab: "admin", accordionValue: "site-builder-1" },
  "site-builder-page-settings": { hash: "site-builder", tab: "admin", accordionValue: "site-builder-2" },
  "site-builder-blocks-catalog": { hash: "site-builder", tab: "admin", accordionValue: "site-builder-3" },
  "site-builder-block-settings": { hash: "site-builder", tab: "admin", accordionValue: "site-builder-4" },
  "site-builder-actions": { hash: "site-builder", tab: "admin", accordionValue: "site-builder-5" },
  "site-builder-forms": { hash: "site-builder", tab: "admin", accordionValue: "site-builder-6" },
  "site-builder-questionnaires": { hash: "site-builder", tab: "admin", accordionValue: "site-builder-7" },
  "site-builder-pricing": { hash: "site-builder", tab: "admin", accordionValue: "site-builder-8" },
  "site-builder-embed": { hash: "site-builder", tab: "admin", accordionValue: "site-builder-9" },
  "site-builder-domains": { hash: "site-builder", tab: "admin", accordionValue: "site-builder-10" },
  "site-builder-publish": { hash: "site-builder", tab: "admin", accordionValue: "site-builder-11" },
  "site-builder-data-flow": { hash: "site-builder", tab: "admin", accordionValue: "site-builder-12" },
  "site-builder-troubleshooting": { hash: "site-builder", tab: "admin", accordionValue: "site-builder-13" },
  "site-builder-glossary": { hash: "site-builder", tab: "admin", accordionValue: "site-builder-14" },
};

/**
 * Резолвит hash или ссылку из help-key в DocsTarget.
 * Принимает: "site-builder", "#site-builder", "/docs#site-builder".
 * Возвращает null, если hash неизвестен.
 */
export function resolveDocsTarget(input: string | undefined | null): DocsTarget | null {
  if (!input) return null;
  const hash = String(input).split("#").pop()?.replace(/^\//, "") ?? "";
  if (!hash) return null;
  return DOCS_REGISTRY[hash] ?? null;
}

/** Полный URL для ссылки «Подробнее» в Help popover */
export function buildDocsUrl(target: DocsTarget | string): string {
  const hash = typeof target === "string" ? target : target.hash;
  return `/docs#${hash}`;
}

/**
 * Программная навигация в нужный раздел документации.
 * Открывает /docs в новой вкладке с правильным hash.
 */
export function openDocsSection(target: DocsTarget | string): void {
  const url = buildDocsUrl(target);
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
