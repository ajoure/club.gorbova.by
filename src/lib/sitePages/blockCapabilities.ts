/**
 * Block capability map — какие reusable styling controls реально поддерживаются renderer'ами.
 *
 * Sprint v3 (текущее состояние):
 *   - features, stats — полностью подключены к новым reusable controls
 *   - остальные блоки — пока НЕ подключены, поэтому advanced controls для них в UI скрыты,
 *     чтобы не создавать ложного ощущения «настройка есть, эффекта нет».
 *
 * При подключении нового renderer'а — добавить тип в соответствующий массив.
 */

export type BlockCapability =
  | "cardStyle"        // cardStyle / cardRadius / cardShadow / borderOpacity
  | "gridLayout"       // mobile padding overrides currently shared with grid blocks
  | "alignment"        // titleAlignment / itemAlignment
  | "iconMode"         // iconMode (features/stats only сейчас)
  | "mobilePadding";   // mobilePaddingTop / mobilePaddingBottom (BlockWrapper)

const CAPABILITY_MAP: Record<string, BlockCapability[]> = {
  features: ["cardStyle", "gridLayout", "alignment", "iconMode", "mobilePadding"],
  stats: ["cardStyle", "gridLayout", "alignment", "iconMode", "mobilePadding"],
  // mobilePadding также применяется ко всем блокам через BlockWrapper, но в UI пока показываем
  // только там, где renderer уже использует другие reusable controls — иначе UX-шум.
};

export function blockHasCapability(blockType: string, cap: BlockCapability): boolean {
  return (CAPABILITY_MAP[blockType] ?? []).includes(cap);
}

export function blockHasAnyAdvancedCapability(blockType: string): boolean {
  return (CAPABILITY_MAP[blockType] ?? []).length > 0;
}
