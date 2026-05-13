# CB-1 Bonus Restoration — Promote to full_access (2026-05-13)

## Контекст
После revert `INV-PHANTOM-PARENT-V1-2026-05-13` 19 entitlements на продукт
`7101ed3c-7839-4a74-ad95-aa0660369b22` (ЦБ-1 ступень 2.0) остались с
`scope_resolution_mode='module_scope_only'` и `historical_module_product_ids`,
которые ссылаются на STANDALONE-модули (Маркетплейсы / Строительство /
Производство / ПВТ / Розница / ИП / Грузоперевозки / Общепит).

Эти standalone-модули имеют **собственные** training-tree (отдельный root,
`parent_module_id=null`, свой `product_id`), и **не являются дочерними** от
CB-1 root `c9f7e9b8-e613-459a-91e3-38bbcfe424d8`.

Из-за этого synthetic-bonus rule `module_scope_only` давал `allowed_module_ids=[]`
для CB-1 → все child-модули CB-1 скрывались → root помечался `is_empty=true`
("Контент не опубликован"), хотя у CB-1 есть 30 активных дочерних модулей.

Бизнес-смысл бонуса: пользователь, купивший standalone-модуль(и), получает
полный доступ к CB-1. Поэтому корректный режим — `full_access`.

## Изменения
- 19 entitlements: `meta.scope_resolution_mode` `module_scope_only → full_access`
- В `meta` добавлены: `scope_resolution_mode_previous`, `scope_promoted_at`,
  `scope_promoted_reason`, `scope_promoted_batch='CB1-BONUS-FULL-ACCESS-2026-05-13'`
- 19 записей в `audit_logs`, action=`entitlement.scope_promoted_full_access.cb1_bonus_restore`

## Verify
- `entitlements ... batch=INV-PHANTOM-PARENT-V1-2026-05-13` →
  19 `full_access` + 4 `union_scope` (4 уже были full в резолвере).
- Алёна Богинская (`78123ed5-3a00-4982-87cf-72de6c0cdb8c`):
  CB-1 entitlement `c56c29d6` → `status=active, scope=full_access`.

## Resolver-trace для full_access
- `useActiveTrainingContentRules` → `resolveBonusScopeRules` →
  mode `full_access` → synthetic rule `access_mode='full'` для root `c9f7e9b8`.
- `resolveTrainingContentFilter` P3 → `mode='full'` → все 30 child-модулей
  CB-1 видимы, root не помечается `is_empty`.

## Не затронуто
- Не трогались: subscriptions_v2, provider_subscriptions, access_end_at,
  Telegram, новые grants, standalone-module entitlements.
- 4 `union_scope` оставлены как есть (уже разрешаются как full).
