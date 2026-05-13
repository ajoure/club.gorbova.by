---
name: Cabinet Visibility Entitlement Dependency
description: SOT видимости в «Моей библиотеке» = карточка контакта → «Доступы»; active entitlement → продукт ОБЯЗАН быть виден; resolver не скрывает parent root.
type: feature
---

SOT видимости обучающего контента в «Моей библиотеке» = карточка контакта → вкладка «Доступы».

Если для пользователя есть active запись в `public.entitlements` (`status='active'`, `expires_at IS NULL OR expires_at > now()`) на `product_id`, у которого есть training root — соответствующий тренинг ОБЯЗАН отображаться в библиотеке.

## Контракт resolver (`useSidebarModules` + `resolveTrainingContentFilter`)

1. `has_access` определяется по active `entitlements.product_id` (entitlement-only path для product-linked модулей).
2. Для root-модулей при `has_access=true` фильтр `training_content` НИКОГДА не скрывает root, даже при `rule_unresolved` / пустом allowlist. Пустой allowlist трактуется как «нет partial-ограничения», а не как default-deny на parent.
3. Для child-модулей allowlist применяется ТОЛЬКО если он непустой (явный `synthetic_bonus` / `db_tariff` partial scope). Пустой allowlist → child тоже виден (SOT = entitlement существует).
4. `historical_module_product_ids` ограничивают/расширяют список child-модулей, но НЕ являются kill-switch для root.
5. Standalone module-products отображаются как отдельные карточки и НЕ должны глушить родительский продукт.

## Запреты

- Никакая комбинация `meta.scope_resolution_mode`, `historical_module_product_ids`, `inv_phantom_parent_v1` не должна скрывать сам parent product.
- Любой sweep/детектор, который помечает active business-bonus parent entitlement как «phantom» только потому, что hpids указывают на другие продукты, считается ошибочным. См. revoked rule `phantom-parent-entitlement-guard`.

## Кеш и обновление UI

После любого revert/grant в `entitlements` нужно invalidate React Query keys: `["sidebar-modules"]`, `["active-training-content-rules"]`, `["entitlements"]`. Если invalidate не сделан — пользователю нужно перелогиниться или жёстко обновить страницу, иначе UI будет показывать stale state.

## История

- 2026-05-13 INV-PHANTOM-PARENT-V1 ошибочно перевёл 23 business-bonus parent entitlements в `superseded`. Все восстановлены batch-ем `INV-PHANTOM-PARENT-V1-REVERT-2026-05-13`. Resolver обновлён, чтобы active entitlement в «Доступах» всегда давал видимость root.
