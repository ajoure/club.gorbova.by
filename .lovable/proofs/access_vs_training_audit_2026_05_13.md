# Audit: «доступы ↔ показ тренингов» (2026-05-13)

## Триггер
Жалоба: у Алены Богинской (lena_times@mail.ru, 78123ed5…) entitlement на «ЦБ-1 Модуль: Строительство» active, но в «Моей библиотеке» модуль не виден.

## Bucket A — empty_training_root (root без детей и без уроков)
| training_module_id | product_id | название |
|---|---|---|
| `b7bae7fd-3a39-4438-8ec6-ced99f79c327` | `f833c846-…` | ЦБ-1 Модуль: Строительство |
| `b1199440-2fb7-49df-8034-7251f22d29f0` | `99f1f156-…` | ЦБ-1 Модуль: ПВТ |

**Это и есть прямая причина «модуль не активный».** Контента в БД нет. Без UI-исправления (C2) фильтр Phase E в `useTrainingModules.tsx` молча скрывал такие root.

## Bucket B — product_without_active_rules (entitlement active, но все access_rules `is_active=false`)
- `d7effaf4-…` — ЦБ-1 Модуль: Маркетплейсы (2 правила, обе off)
- `99f1f156-…` — ЦБ-1 Модуль: ПВТ (2 правила, обе off)
- `f833c846-…` — ЦБ-1 Модуль: Строительство (2 правила, обе off)

**Действий не предпринято** (требование владельца — только discovery, без массовой активации).

## Bucket C — hpids_are_training_ids
Из 78 entitlements `module_scope_only` элементы `historical_module_product_ids` распределены так:
- **49** элементов корректно указывают `product_id`
- **44** элемента указывают `training_module_id` корня (битая семантика, см. backlog миграции `inv_hpids_normalize_2026_05_13`)
- 0 неизвестных

**Резолвер обновлён (C1):** в `resolveBonusScopeRules` добавлен fallback — если `hpids[i]` не найден как `products_v2.id`, проверяем `training_modules.id` (root). Совпадение → берём id напрямую как `allowed_module_id`. Опционально логируется `hpids_training_id_fallback_used` (debug-флаг).

## Bucket D — 23 reverted CB-1 root entitlements (INV-PHANTOM-PARENT-V1-REVERT)
Все 23 строки имеют `scope_resolution_mode='module_scope_only'` (в 3-х случаях `union_scope`). Часть пользователей имеет ещё и standalone-module entitlements параллельно.

**Изменения в данных НЕ внесены** — пользователь явно потребовал dry-run. Решение по каждой строке (full / module_scope с правильными hpids / удалить) откладывается до отдельного approve.

## Code-изменения, выполненные в этом проходе
1. **C1** — `src/hooks/useTrainingContentRules.ts` `resolveBonusScopeRules`: hpids fallback на `training_module_id`.
2. **C2-resolver** — `src/hooks/useTrainingModules.tsx` Phase E: больше НЕ скрывает root с `visibleRecursive===0`. Вместо этого помечает `is_empty=true`.
3. **C2-UI** — `src/components/training/LibraryTableView.tsx`: бейдж «Контент не опубликован» на flattened group с `is_empty`.
4. **C2-sidebar** — `src/hooks/useSidebarModules.ts`: подсчёт детей+уроков на root, поле `is_empty` в `SidebarModule`.

## Что НЕ тронуто
- `subscriptions_v2`, `provider_subscriptions`, `entitlements` (никаких UPDATE/DELETE).
- `access_rules` (без массовой активации).
- Telegram, `access_end_at`, write-paths grant-access.

## DoD-проверка
- [x] Алена должна увидеть карточку «ЦБ-1 Модуль: Строительство» с бейджем «Контент не опубликован» после жёсткого обновления страницы / релогина (cache invalidation).
- [x] Аналогично для всех empty-root модулей (ПВТ).
- [x] Resolver принимает оба формата `hpids` без потери видимости.
- [ ] Бэклог: миграция `inv_hpids_normalize_2026_05_13` (44 строки) — отдельный PATCH.
- [ ] Бэклог: контентное решение по Строительству/ПВТ — отдельный PATCH.
- [ ] Бэклог: ревизия 23 reverted CB-1 root entitlements — отдельный PATCH с per-row approve.
