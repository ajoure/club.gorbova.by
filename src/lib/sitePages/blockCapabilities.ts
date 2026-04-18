/**
 * Block capability map — какие reusable styling controls РЕАЛЬНО подключены renderer'ами.
 *
 * Sprint v3 (текущее состояние, hardcoded зафиксирован для прозрачности):
 *   - features, stats — полностью подключены ко всем reusable controls (cardStyle, gridLayout,
 *     alignment, iconMode), а также через BlockWrapper получают mobilePadding overrides.
 *   - Остальные блоки — пока НЕ подключены к новым controls, поэтому advanced section
 *     в UI скрыта, чтобы не создавать ложного ощущения «настройка есть, эффекта нет».
 *
 * ВАЖНО про mobilePadding: технически BlockWrapper применяет mobilePaddingTop/Bottom
 * ко ВСЕМ блокам без исключения (общая обёртка). Но в UI editor-а мы временно показываем
 * этот контрол только там, где renderer уже использует другие reusable controls — это
 * UX-ограничение, не техническое. Когда подключим mobilePadding к UI остальных блоков,
 * добавим их в массив ниже без изменения renderer'а.
 *
 * При подключении нового renderer'а к reusable controls — добавить тип в массив ниже.
 */

export type BlockCapability =
  | "cardStyle"        // cardStyle / cardRadius / cardShadow / borderOpacity
  | "gridLayout"       // grid responsive (columnsDesktop/Tablet/Mobile + gap) — управляется в content.grid
  | "alignment"        // titleAlignment / itemAlignment
  | "iconMode"         // iconMode (features/stats only сейчас)
  | "mobilePadding";   // mobilePaddingTop / mobilePaddingBottom (BlockWrapper применяет всегда; UI gated)

const CAPABILITY_MAP: Record<string, BlockCapability[]> = {
  features: ["cardStyle", "gridLayout", "alignment", "iconMode", "mobilePadding"],
  stats: ["cardStyle", "gridLayout", "alignment", "iconMode", "mobilePadding"],
};

export function blockHasCapability(blockType: string, cap: BlockCapability): boolean {
  return (CAPABILITY_MAP[blockType] ?? []).includes(cap);
}

export function blockHasAnyAdvancedCapability(blockType: string): boolean {
  return (CAPABILITY_MAP[blockType] ?? []).length > 0;
}
