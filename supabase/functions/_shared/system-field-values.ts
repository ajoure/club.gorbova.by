// ============================================================================
// system-field-values.ts — Sprint 3I-A-2 Hotfix F1
// ----------------------------------------------------------------------------
// Shared resolver для подмножества системных полей (system.*), которое можно
// безопасно вычислить из одной точки `now`, БЕЗ контекста order/customer/exec.
//
// Используется package orchestrator (`ai-generate-document-package`) в фазе
// preflight, чтобы `{{field:FLD-000209}}` / `{{field:FLD-000211}}` и прочие
// «чистые» системные FLD не блокировали item с
// `system_field_resolver_not_implemented`.
//
// Формат значений 1-в-1 совпадает с order-mode `_shared/standard-fields.ts`,
// потому что оба используют одни и те же примитивы из `_shared/ru-date.ts`.
//
// !!! НЕ добавлять сюда поля, требующие order/customer/executor контекста —
// для них существует buildStandardFieldValues() в standard-fields.ts.
// !!! НЕ добавлять новые FLD без manifest-proof.
// ============================================================================

import { dotDate, dotDateTime, ruLongDate, ruWordsDate } from './ru-date.ts';

/**
 * Резолвимое system-подмножество FLD на момент `now`.
 *
 * Возвращает только те system FLD, чьё значение детерминировано из текущего
 * времени и не зависит от контекста заказа/исполнителя/клиента.
 *
 * | FLD          | имя SOT          | пример                  |
 * |--------------|------------------|-------------------------|
 * | FLD-000133   | system.today     | 29.05.2026              |
 * | FLD-000134   | system.today_long| 29 мая 2026 г.          |
 * | FLD-000209   | system.today_ru  | 29 мая 2026 года        |
 * | FLD-000210   | system.now       | 29.05.2026 14:30        |
 * | FLD-000211   | system.year      | 2026                    |
 * | FLD-000212   | system.month     | 05                      |
 */
export function buildSystemFieldValues(now: Date = new Date()): Record<string, string> {
  return {
    'FLD-000133': dotDate(now),
    'FLD-000134': ruLongDate(now),
    'FLD-000209': ruWordsDate(now),
    'FLD-000210': dotDateTime(now),
    'FLD-000211': String(now.getFullYear()),
    'FLD-000212': String(now.getMonth() + 1).padStart(2, '0'),
  };
}

/** Whitelist FLD ids, поддерживаемых `buildSystemFieldValues`. */
export const SYSTEM_FIELD_VALUE_IDS = new Set<string>([
  'FLD-000133',
  'FLD-000134',
  'FLD-000209',
  'FLD-000210',
  'FLD-000211',
  'FLD-000212',
]);
