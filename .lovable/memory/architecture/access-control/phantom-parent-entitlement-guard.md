---
name: Phantom Parent Entitlement Guard (REVOKED)
description: REVOKED 2026-05-13 — правило признано ошибочным. CREATE-guard и sweep отменены, business-bonus parent entitlements являются легитимными.
type: constraint
---

# REVOKED 2026-05-13

## Что было

INV-PHANTOM-PARENT-V1: CREATE-guard в `_shared/product-access-grants.ts` блокировал INSERT entitlement, если `scope_resolution_mode='module_scope_only'` и `historical_module_product_ids` не содержали target `product_id`. Sweep `INV-PHANTOM-PARENT-V1-2026-05-13` пометил 23 active entitlements как «phantom» и перевёл их в `superseded`.

## Почему отменено

Эти 23 строки были выданы через BUSINESS как бонусное восстановление доступа к ранее купленным продуктам/модулям. По SOT (карточка контакта → «Доступы») они должны были оставаться `active` и давать видимость root тренинга. Превод в `superseded` ломал видимость root в «Моей библиотеке» (см. кейс `lena_times@mail.ru` / Алена Богинская).

## Текущая политика

- CREATE-guard снят (см. `product-access-grants.ts` 2026-05-13). На месте guard оставлен только аудит-маркер `meta.hpids_outside_target_subtree=true` для диагностики.
- Все 23 superseded строки восстановлены batch-ем `INV-PHANTOM-PARENT-V1-REVERT-2026-05-13` с пометкой `meta.reverted_inv_phantom_parent_v1=true`, `revert_reason='business_bonus_parent_misclassified_as_phantom_2026_05_13'`.
- SOT видимости: см. `mem://architecture/access-control/cabinet-visibility-entitlement-dependency`.

## Запрет на возрождение

Не возвращать sweep/CREATE-block по hpids vs target subtree без отдельного архитектурного PATCH. Любой permanent detector (см. backlog `inv_phantom_parent_permanent_detector`) должен учитывать business-bonus parent как легитимный сценарий.

**Why:** ошибочно скрывал root тренинги при наличии active entitlement; ломал SOT-контракт «Доступы → видимость библиотеки».
