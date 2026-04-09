# Да, согласен, с учетом правок:

&nbsp;

1. В PATCH 1 добавь не только product_id: formData.product_id, но и жёсткий guard перед upsert:
  &nbsp;
  - если formData.product_id пустой, null или не UUID — не делать upsert entitlement вообще;
  - показать ошибку сохранения;
  - записать warn/error в audit/log.
  &nbsp;
  Иначе вы просто перестанете терять product_id в одном кейсе, но сохраните возможность снова создать битую запись.
2. В PATCH 1 зафиксируй, что product_id берётся только из канонического выбранного продукта сделки, а не из product_code и не из старых slug/code. В DoD это нужно явно прописать как ID-first proof.
3. В PATCH 2 audit trail нужен не только для уже выполненного repair c40382bc, но и для самого будущего save-path через EditDealDialog:
  &nbsp;
  - entitlement.created_via_admin_edit
  - entitlement.updated_via_admin_edit
  - в meta обязательно: product_id, product_code, order_id, deal_id, tariff_id, source='admin_edit'.
  &nbsp;
  Иначе потом снова нельзя будет доказать, чем именно испортили запись.
4. В PATCH 3 по Демко Людмиле добавь browser-proof не только active list, но и completed list:
  &nbsp;
  - родительский курс не должен быть в completed;
  - не должно появиться дубля той же сущности одновременно в active и completed.
  &nbsp;
5. В PATCH 4 на втором клиенте зафиксируй два разных сценария:
  &nbsp;
  - создание entitlement через EditDealDialog;
  - повторное редактирование уже существующего entitlement.
  &nbsp;
  Одного только “сохранить ещё раз” мало. Нужен proof на create и update отдельно.
6. В DoD добавь SQL-proof:
  &nbsp;
  - после save через EditDealDialog у entitlement:
    &nbsp;
    - product_id IS NOT NULL
    - product_id = ожидаемый UUID
    - status = active
    - запись проходит тот же predicate active list.
    &nbsp;
  &nbsp;
  Иначе browser-proof может быть случайным из-за кэша/старых данных.
7. Follow-up про onConflict: user_id,product_code оставить обязательно как отдельный PATCH и пометить как не закрытый после этого фикса. Это важно, потому что текущий патч лечит симптом, но не устраняет архитектурный риск.

&nbsp;

&nbsp;

Исправленный смысл DoD:

&nbsp;

- product_id не просто “передаётся в upsert”, а гарантированно сохраняется, не обнуляется, участвует в predicate active list и подтверждён SQL-proof на create/update.

&nbsp;

&nbsp;

После этих правок план можно исполнять.

План: PATCH — EditDealDialog must preserve product_id in entitlement upsert

## Проблема

В `EditDealDialog.tsx` строка 331-339: entitlement upsert **не включает `product_id**`. Это приводит к `product_id = NULL` у entitlements, созданных/обновлённых через ручное редактирование сделки. Такие записи исчезают из active list из-за фильтра `productsWithRules.has(product_id)`.

## PATCH 1 — Добавить product_id в upsert

Файл: `src/components/admin/EditDealDialog.tsx`, строка 331-339.

```typescript
await supabase.from('entitlements').upsert({
  user_id: deal.user_id,
  profile_id: deal.profile_id,
  order_id: deal.id,
  product_code: productCode,
  product_id: formData.product_id,  // ← FIX: was missing
  status: 'active',
  expires_at: formData.access_end_at?.toISOString() || subscription?.access_end_at,
  meta: { source: 'admin_edit', tariff_id: formData.tariff_id }
}, { onConflict: 'user_id,product_code' });
```

## PATCH 2 — Audit trail для repair c40382bc

Записать в `audit_logs` факт восстановления `product_id` у entitlement `c40382bc`:

- `action: entitlement.product_id_restored`
- `entity_type: entitlement`, `entity_id: c40382bc`
- `meta: { previous_product_id: null, restored_product_id: '7101ed3c-...', reason: 'EditDealDialog bug fix' }`

## PATCH 3 — Browser-proof по Демко Людмиле

Открыть карточку, вкладка «Доступы». Подтвердить одновременно видны:

- Gorbova Club / BUSINESS
- Ценный бухгалтер | 1 ступень 2.0
- Модуль: Розничная торговля
- Модуль: Производство
- Деньги BY 1 тариф

Дополнительно: «Показать завершённые» **НЕ** содержит родительский курс.

## PATCH 4 — Контрольный proof на втором клиенте

Найти другого клиента с entitlement. Убедиться, что при сохранении через EditDealDialog `product_id` корректно сохраняется и не обнуляется при повторном редактировании.

## Follow-up риск (не в этом патче)

`onConflict: 'user_id,product_code'` — legacy-ключ, противоречит ID-first принципу. Зафиксировать как отдельный follow-up PATCH: пересмотр entitlement upsert key.

## Изменяемые файлы


| Файл                                      | Действие                                                 |
| ----------------------------------------- | -------------------------------------------------------- |
| `src/components/admin/EditDealDialog.tsx` | Добавить `product_id: formData.product_id` (строка ~335) |
| `audit_logs` (данные)                     | INSERT audit record для repair c40382bc                  |


## DoD

1. В EditDealDialog entitlement upsert всегда содержит `product_id`
2. При создании entitlement через EditDealDialog — `product_id` сохраняется в БД
3. При повторном редактировании existing entitlement — `product_id` не теряется
4. Browser-proof: у Демко Людмилы видны все 5 карточек в active
5. Repair `c40382bc` имеет audit trail
6. Контрольный второй клиент проходит proof без `product_id = NULL`