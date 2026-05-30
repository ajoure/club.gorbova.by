# Month-Gate Multi-Rule OR Fix — 2026-05-30

## Контекст
Олга Дергелева (BUSINESS, Gorbova Club) видела lock на апрельском вебинаре 2026 и вебинарах 2025, хотя её подписка активна до 02.06.2026 и BUSINESS-правило покрывает контент.

## Root cause
В `src/hooks/useMonthGate.ts` и `src/hooks/useModuleMonthGate.ts` резолвер брал ПЕРВОЕ matching правило через `candidateRules.find(...)`. При наличии нескольких active правил с `match_purchase_month=true` на одном root-модуле (BUSINESS + ИДЕОЛОГИЯ) выбор зависел от порядка возврата из БД. Если первой возвращалась ИДЕОЛОГИЯ — RPC проверял её tariff_id, у Ольги покупки на ИДЕОЛОГИЯ нет → lock.

## Фикс (frontend-only)
Заменил `.find()` на `.filter()` + OR-агрегация:

1. Для каждого урока/модуля собираем ВСЕ matching rules, у которых scope включает урок/модуль.
2. Дедуп по `tariff_id`.
3. В RPC payload отправляем синтетический ключ `${lesson_id}::${tariff_id}` для каждого (lesson, tariff) tuple — чтобы различать ответы.
4. После RPC: lesson/module unlocked, если ХОТЯ БЫ ОДИН tuple вернул `has_purchase=true`.
5. Lock показываем только если ни один tariff не дал доступ.
6. `required_tariff_id` (только в module-gate) = первый matching tariff как fallback для CTA.

## Файлы
- edited `src/hooks/useMonthGate.ts`
- edited `src/hooks/useModuleMonthGate.ts`

## Инварианты
- БД не тронута: `subscriptions_v2`, `entitlements`, `access_rules` без изменений.
- RPC `has_month_purchase_bulk` не менялся — поле `lesson_id` остаётся opaque-ключом.
- Подписка Ольги до 02.06.2026 сохранена.
- Admin bypass и `useSidebarModules` неизменны.

## DoD
- BUSINESS-пользователи видят апрельский 2026 + 2025 вебинары без manual fix.
- Пользователи без BUSINESS/ИДЕОЛОГИЯ остаются заблокированы.
- RPC возвращает успех по BUSINESS-tuple → lock снят.
- Никаких heuristics/string-matching, только UUID-логика.
