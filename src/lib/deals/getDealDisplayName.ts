/**
 * getDealDisplayName — единый helper для отображаемого названия сделки.
 *
 * Приоритет:
 *   1. FK join: deal.products_v2?.name (текущее имя продукта из БД)
 *   2. Альтернативное поле product?.name (если передано отдельно)
 *   3. purchase_snapshot.display_purchase_name (исторический снимок)
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

export function getDealDisplayName({
  productsV2,
  productName,
  purchaseSnapshot,
  fallback = "—",
}: DealDisplayNameInput): string {
  // 1. FK join — текущее имя из products_v2
  if (productsV2?.name?.trim()) {
    return productsV2.name;
  }

  // 2. Альтернативное product name (из отдельного поля/маппинга)
  if (productName?.trim()) {
    return productName;
  }

  // 3. Snapshot fallback
  const snapshotName = safeExtractSnapshotName(purchaseSnapshot);
  if (snapshotName) {
    return snapshotName;
  }

  // 4. Final fallback
  return fallback;
}
