/**
 * Канонический resolver для отображения источника Instagram-диалога.
 *
 * Жёсткое правило: synthetic ID вида `mc:*`, `subscriber_id`, `thread_key`,
 * `instagram_page_id` — НИКОГДА не показываются пользователю.
 *
 * Использовать ТОЛЬКО эти функции. Локальные ad-hoc проверки `startsWith('mc:')`
 * по компонентам запрещены.
 */

const SYNTHETIC_ID_PATTERNS = [
  /^mc:/i,
  /^subscriber[_-]?id$/i,
  /^thread[_-]?key$/i,
];

function isSyntheticId(value: string | null | undefined): boolean {
  if (!value) return true;
  const v = value.trim();
  if (!v) return true;
  return SYNTHETIC_ID_PATTERNS.some((p) => p.test(v));
}

export interface InstagramAccountLike {
  display_name?: string | null;
  account_name?: string | null;
  provider_kind?: string | null;
  instagram_page_id?: string | null;
}

/**
 * Возвращает человекочитаемое имя страницы/аккаунта для отображения.
 * Никогда не вернёт synthetic mc:* / subscriber_id.
 */
export function resolveInstagramAccountDisplayName(
  account: InstagramAccountLike | null | undefined,
): string | null {
  if (!account) return null;
  // Приоритет 1: канонический display_name из конфига интеграции
  if (account.display_name && !isSyntheticId(account.display_name)) {
    return account.display_name;
  }
  // Приоритет 2: legacy account_name (только если это не synthetic)
  if (account.account_name && !isSyntheticId(account.account_name)) {
    return account.account_name;
  }
  // Synthetic ID не возвращаем
  return null;
}

/**
 * Возвращает source label для шапки/списка диалогов.
 * Формат: "Instagram Direct · <Имя страницы>" либо просто "Instagram Direct".
 */
export function resolveInstagramSourceLabel(
  account: InstagramAccountLike | null | undefined,
): string {
  const name = resolveInstagramAccountDisplayName(account);
  return name ? `Instagram Direct · ${name}` : "Instagram Direct";
}
