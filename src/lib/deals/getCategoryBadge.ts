/**
 * getCategoryBadge — маппинг products_v2.category в UI badge.
 *
 * Это чисто display-утилита. Бейдж не влияет на бизнес-логику.
 * Все решения принимаются только по product_id, tariff_id, offer_id.
 */

export interface CategoryBadgeResult {
  label: string;
  className: string;
}

const CATEGORY_BADGE_MAP: Record<string, CategoryBadgeResult> = {
  course: {
    label: "Курс",
    className: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700",
  },
  module: {
    label: "Модуль",
    className: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700",
  },
  subscription: {
    label: "Подписка",
    className: "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700",
  },
  service: {
    label: "Услуга",
    className: "bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700",
  },
  digital_product: {
    label: "Вебинар",
    className: "bg-teal-100 text-teal-800 border-teal-300 dark:bg-teal-900/30 dark:text-teal-300 dark:border-teal-700",
  },
};

/**
 * Возвращает badge-данные для категории продукта, или null если категория неизвестна.
 */
export function getCategoryBadge(category: string | null | undefined): CategoryBadgeResult | null {
  if (!category) return null;
  return CATEGORY_BADGE_MAP[category] ?? null;
}
