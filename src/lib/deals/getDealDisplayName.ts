/**
 * getDealDisplayName — единый helper для отображаемого названия сделки.
 *
 * Приоритет (обычная сделка):
 *   1. FK join: deal.products_v2?.name (текущее имя продукта из БД)
 *   2. Альтернативное поле product?.name (если передано отдельно)
 *   3. purchase_snapshot.display_purchase_name (исторический снимок)
 *   4. fallback: "—"
 *
 * Приоритет (модульная покупка, historical_purchase_type = module_only_standalone):
 *   1. purchase_snapshot.display_purchase_name (модульное имя из snapshot)
 *   2. FK join: deal.products_v2?.name
 *   3. Альтернативное поле product?.name
 *   4. fallback: "—"
 *
 * Безопасно обрабатывает purchase_snapshot любого типа
 * (null, undefined, string, object, битый JSON).
 */

export interface DealDisplayNameInput {
  /** deal.products_v2 FK join result */
  productsV2?: { name?: string | null } | null;
  /** Отдельно переданное имя продукта (например из productsMap) */
  productName?: string | null;
  /** deal.purchase_snapshot — может быть чем угодно */
  purchaseSnapshot?: unknown;
  /** fallback текст, по умолчанию "—" */
  fallback?: string;
}

function safeExtractSnapshotName(snapshot: unknown): string | null {
  if (snapshot == null) return null;

  // Если это строка — попробуем распарсить как JSON-объект
  if (typeof snapshot === "string") {
    try {
      const parsed = JSON.parse(snapshot);
      if (parsed && typeof parsed === "object" && typeof parsed.display_purchase_name === "string") {
        return parsed.display_purchase_name || null;
      }
    } catch {
      // Битый JSON или просто строка — игнорируем
    }
    return null;
  }

  // Если объект — достаём display_purchase_name
  if (typeof snapshot === "object") {
    const obj = snapshot as Record<string, unknown>;
    const name = obj?.display_purchase_name;
    if (typeof name === "string" && name.trim()) {
      return name;
    }
  }

  return null;
}

function safeExtractHistoricalPurchaseType(snapshot: unknown): string | null {
  if (snapshot == null || typeof snapshot !== "object") return null;
  const obj = snapshot as Record<string, unknown>;
  const val = obj?.historical_purchase_type;
  return typeof val === "string" ? val : null;
}

/**
 * getShortDisplayName — чисто UI-функция для сокращённого отображения.
 *
 * Для модулей: убирает префикс родителя (всё до последнего `|`), добавляет "Модуль: ".
 * Для остальных: trim trailing `|` и пробелы.
 *
 * Canonical DB name НЕ меняется. Это только display metadata.
 * Никогда не использовать для бизнес-логики, связки, fulfillment.
 */
export function getShortDisplayName(name: string, category: string | null | undefined): string {
  if (!name?.trim()) return name;

  if (category === "module") {
    // Берём часть после последнего `|` как короткое имя модуля
    const parts = name.split("|").map(p => p.trim()).filter(Boolean);
    const lastPart = parts[parts.length - 1];
    if (parts.length > 1 && lastPart) {
      return `Модуль: ${lastPart}`;
    }
    // Если нет разделителя — возвращаем как есть с префиксом
    return `Модуль: ${name.trim()}`;
  }

  // Для остальных: trim trailing | и пробелы
  return name.replace(/[\s|]+$/, "").trim();
}

export function getDealDisplayName({
  productsV2,
  productName,
  purchaseSnapshot,
  fallback = "—",
}: DealDisplayNameInput): string {
  // Detect if this is a module_only_standalone deal from snapshot
  const histType = safeExtractHistoricalPurchaseType(purchaseSnapshot);
  const snapshotName = safeExtractSnapshotName(purchaseSnapshot);

  // For module_only_standalone deals: snapshot display name takes priority
  // because product_id points to the parent course, not the actual module purchased
  if (histType === "module_only_standalone" && snapshotName) {
    return snapshotName;
  }

  // Standard priority for regular deals:
  // 1. FK join — текущее имя из products_v2
  if (productsV2?.name?.trim()) {
    return productsV2.name;
  }

  // 2. Альтернативное product name (из отдельного поля/маппинга)
  if (productName?.trim()) {
    return productName;
  }

  // 3. Snapshot fallback (for non-module deals or module deals without snapshot name)
  if (snapshotName) {
    return snapshotName;
  }

  // 4. Final fallback
  return fallback;
}
