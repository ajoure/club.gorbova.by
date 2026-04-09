/**
 * getDealDisplayName — единый helper для отображаемого названия сделки.
 *
 * Приоритет (module_only_standalone + single-module):
 *   1. moduleProduct.name (актуальное имя модуля из products_v2)
 *   2. purchase_snapshot.display_purchase_name (исторический снимок)
 *   3. FK join: deal.products_v2?.name (родительский курс)
 *   4. Альтернативное поле product?.name
 *   5. fallback: "—"
 *
 * Приоритет (обычная сделка):
 *   1. FK join: deal.products_v2?.name
 *   2. Альтернативное поле product?.name
 *   3. purchase_snapshot.display_purchase_name
 *   4. fallback: "—"
 *
 * Безопасно обрабатывает purchase_snapshot любого типа.
 */

export interface DealDisplayNameInput {
  /** deal.products_v2 FK join result */
  productsV2?: { name?: string | null } | null;
  /** Отдельно переданное имя продукта (например из productsMap) */
  productName?: string | null;
  /** deal.purchase_snapshot — может быть чем угодно */
  purchaseSnapshot?: unknown;
  /** Resolved module product from resolveModuleDisplayMeta */
  moduleProduct?: { name?: string | null; publicId?: string | null } | null;
  /** fallback текст, по умолчанию "—" */
  fallback?: string;
}

function safeExtractSnapshotName(snapshot: unknown): string | null {
  if (snapshot == null) return null;

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
 */
export function getShortDisplayName(name: string, category: string | null | undefined): string {
  if (!name?.trim()) return name;

  if (category === "module") {
    const parts = name.split("|").map(p => p.trim()).filter(Boolean);
    const lastPart = parts[parts.length - 1];
    if (parts.length > 1 && lastPart) {
      return `Модуль: ${lastPart}`;
    }
    return `Модуль: ${name.trim()}`;
  }

  return name.replace(/[\s|]+$/, "").trim();
}

export function getDealDisplayName({
  productsV2,
  productName,
  purchaseSnapshot,
  moduleProduct,
  fallback = "—",
}: DealDisplayNameInput): string {
  const histType = safeExtractHistoricalPurchaseType(purchaseSnapshot);
  const snapshotName = safeExtractSnapshotName(purchaseSnapshot);

  // For module_only_standalone deals: prioritize resolved module product name
  if (histType === "module_only_standalone") {
    // 1. Resolved module product name (current canonical name from products_v2)
    if (moduleProduct?.name?.trim()) {
      return moduleProduct.name;
    }

    // 2. Snapshot display name (historical, may be stale but better than parent)
    if (snapshotName) {
      return snapshotName;
    }

    // 3. FK join name (this is typically the parent course — last resort)
    if (productsV2?.name?.trim()) {
      return productsV2.name;
    }

    // 4. Alternative product name
    if (productName?.trim()) {
      return productName;
    }

    return fallback;
  }

  // Standard priority for regular deals:
  // 1. FK join — текущее имя из products_v2
  if (productsV2?.name?.trim()) {
    return productsV2.name;
  }

  // 2. Альтернативное product name
  if (productName?.trim()) {
    return productName;
  }

  // 3. Snapshot fallback
  if (snapshotName) {
    return snapshotName;
  }

  // 4. Final fallback
  return fallback;
}
