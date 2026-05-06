## Да, согласен, с учетом правок:

1. **Фильтр сделок**
  - В карточке контакта показывать не только `paid`, но и `partial`, `pending`, `cancelled`, `refunded`.
  - Сделка `PAY-26-MOTYSAZL` должна отображаться у Шуляк Дианы.
2. **Битый entitlement**
  - Удалить только конкретный некорректный entitlement с `expires_at IS NULL`.
  - Перед удалением сделать backup строки в proof/audit.
  - После удаления перевыдать доступ только через `grant-access-for-order`.
3. **Дата доступа**
  - Для этого кейса дата покупки = дата первого платежа.
  - Не строить сейчас полноценную систему рассрочек.
4. **EditDealDialog**
  - Полностью убрать прямую запись в `entitlements` через `insert/update/upsert`.
  - Все выдачи доступа после изменения сделки должны идти через canonical writer `grant-access-for-order`.
5. **Audit**
  - Должны быть audit-записи:
    - удаление битого entitlement;
    - canonical вызов/результат `grant-access-for-order`;
    - подтверждение, что новый entitlement создан с корректным `expires_at`.
6. **Scope guard**
  - Не трогать `payments_v2`, `subscriptions_v2`, refund logic, Telegram access, retroapply/rule_engine, bePaid sync.
  - Не добавлять систему рассрочек.
  - Только UI-фильтр, удаление конкретного битого доступа, canonical re-grant, замена writer-path в `EditDealDialog`.
7. **DoD**
  - `PAY-26-MOTYSAZL` видна в карточке контакта.
  - Некорректного entitlement с `expires_at IS NULL` больше нет.
  - Новый доступ создан через `grant-access-for-order`.
  - В `EditDealDialog` нет прямого `from('entitlements')`.
  - Audit/proof подтверждают все действия.
  - &nbsp;
  - Контекст

Кейс Шуляк Диана (`profile_id=0784a581-…`, `user_id=80afcb07-…`):

- Сделка `PAY-26-MOTYSAZL` (`d5aca9de-4541-4666-b39a-b16fcfadf671`) — рассрочка по продукту «ЗАКРОЙ ГОД» (`73c29914-…`), `final_price=1035`, `paid_amount=345`, `status=partial`. К ней корректно привязаны 3 платежа bePaid по 345 BYN.
- Текущий entitlement `d7081960-…` — `product_id=73c29914-…`, `expires_at=NULL`, `meta.source='admin_edit'` — «битый доступ».
- В UI карточки контакта сделка не показывается, потому что фильтр пропускает только `['paid','canceled','refunded']`.
- Прямой `entitlements.upsert` сделан в `EditDealDialog` (строки 387–402) — нарушение Core «Canonical Write Path».

Систему рассрочек сейчас не строим. Только три точечных PATCH.

## PATCH 1 — UI-фильтр сделок в карточке контакта

Файл: `src/components/admin/ContactDetailSheet.tsx`, запрос `contact-deals` (строки 414–444).

Заменить:

```ts
.in("status", ['paid', 'canceled', 'refunded'] as const)
```

на:

```ts
.in("status", ['paid', 'partial', 'pending', 'cancelled', 'canceled', 'refunded'] as const)
```

Замечания:

- Включаем `partial` (рассрочка / частичная оплата — реальные деньги, должны быть видны).
- Включаем `pending` (заявка ждёт оплаты — админу нужно видеть).
- Включаем оба написания `cancelled` и `canceled` — в схеме исторически встречаются оба, не теряем легаси.
- `failed` / `draft` / `expired` остаются скрыты — это не сделки.

DoD: сделка `PAY-26-MOTYSAZL` появляется в карточке Шуляк Дианы под группой «ЗАКРОЙ ГОД» с бейджем «Частично».

## PATCH 2 — удалить битый entitlement и выдать доступ канонически

Шаг 2.1. Удалить мусорную запись миграцией:

```sql
DELETE FROM entitlements
WHERE id = 'd7081960-0066-463d-8d39-515ff83a47ec'
  AND user_id = '80afcb07-3d07-40b8-aff7-c17e179e39f5'
  AND product_id = '73c29914-63a3-4f4f-ac42-9f5287e58696'
  AND expires_at IS NULL;
```

Перед DELETE — backup-вставка `old_meta` в `_backup_entitlement_delete_byn_2026_05_shulyak` для отката. Audit `entitlement.deleted.broken_admin_edit_no_expires_at` с `actor_type='system'`, target_user_id, причина.

Шаг 2.2. Перевыдать доступ через canonical writer одноразовым curl:

```
POST /functions/v1/grant-access-for-order
{ "order_id": "d5aca9de-4541-4666-b39a-b16fcfadf671", "source": "admin_repair_2026_05_shulyak" }
```

Дата покупки в заказе уже = дате первого платежа (`deal_date = 2025-10-17`), поэтому writer возьмёт корректное окно от тарифа. Никаких ручных дат и прямых апдейтов — только writer.

DoD:

- В `entitlements` для `user_id=80afcb07-…` и `product_id=73c29914-…` нет записей с `expires_at IS NULL`.
- Создан корректный entitlement через `grant-access-for-order`, `meta.tariff_id` присутствует, `expires_at` ненулевой.
- Audit `entitlement.tariff_id_persisted` и стандартный access-grant audit зафиксированы.

## PATCH 3 — запретить прямой writer в `EditDealDialog`

Файл: `src/components/admin/EditDealDialog.tsx`, ветка `if (newStatus === 'paid' && deal.user_id)` — строки 361–419.

Заменить блок `entitlements.upsert(...)` + локальный audit `entitlement.saved_via_admin_edit` на вызов canonical writer:

```ts
if (newStatus === 'paid' && deal.user_id) {
  // UUID-guard на product_id оставить как есть (361–384).

  const { error: grantError } = await supabase.functions.invoke(
    'grant-access-for-order',
    { body: { order_id: deal.id, source: 'admin_edit' } }
  );

  if (grantError) {
    console.error('grant-access-for-order failed:', grantError);
    toast.warning(
      normalizeEdgeFunctionError(grantError, 'Сделка сохранена, но автоматическая выдача доступа не сработала. Используйте «Выдать доступ» вручную.')
    );
  }
}
```

Что уходит:

- `from('entitlements').upsert(...)` — полностью.
- Локальный audit `entitlement.saved_via_admin_edit` — заменяется server-side audit-цепочкой writer-а (`entitlement.tariff_id_persisted` и др.).

Что остаётся:

- UUID-guard и audit `entitlement.upsert_blocked_no_product_id` — не про write-path.
- `deal.deal_date.updated`, `deal.deal_month.updated` — это аудит метаданных сделки, не доступа.
- Вся subscription-ветка (281–355) — она про `subscriptions_v2`, к entitlements не относится.

Smoke-проверка после деплоя:

- `grep -n "from('entitlements').upsert\|from(\"entitlements\").upsert" src/components/admin/EditDealDialog.tsx` → пусто.
- Перевод тестовой сделки в `paid` через `EditDealDialog` создаёт audit `entitlement.tariff_id_persisted` от writer-а.
- Telegram-grant и tariff merge срабатывают унифицированно (writer уже это делает).

## Scope guard (что НЕ трогаем)

- bePaid sync, `payments_v2`, `subscriptions_v2`, refund-логику, retroapply, rule_engine, partial-refund триггер.
- `CreateDealFromPaymentDialog` (он уже работает корректно через `grant-access-for-order`).
- Систему рассрочек как фичу — никаких installment-сущностей, графиков, объединения платежей.
- Никаких массовых backfill «битых» entitlements за пределами Шуляк Дианы (если потребуется — отдельным PATCH с dry-run).

## DoD сводный

- `PAY-26-MOTYSAZL` видна в карточке контакта Шуляк Дианы (группа «ЗАКРОЙ ГОД», бейдж «Частично»).
- Entitlement `d7081960-…` удалён; в `entitlements` нет записей по `(user=80afcb07-…, product=73c29914-…)` с `expires_at IS NULL`.
- Выполнен canonical вызов `grant-access-for-order` для `d5aca9de-…`, создан корректный entitlement с `meta.tariff_id` и ненулевым `expires_at`.
- В `src/components/admin/EditDealDialog.tsx` нет `from('entitlements').upsert/insert/update` — только вызов `grant-access-for-order`.
- В `audit_logs` есть строки: `entitlement.deleted.broken_admin_edit_no_expires_at` и canonical access-grant аудит для `d5aca9de-…`.
- Никаких изменений в архитектуре рассрочек, bePaid, subscriptions_v2.

## Артефакты

Создать `.lovable/proofs/contact_deals_visibility_and_entitlement_repair_2026_05.md` с: SQL-снимком до/после по сделке и entitlement, ссылкой на миграцию DELETE, выводом curl-вызова `grant-access-for-order`, выписками из `audit_logs`, grep-доказательством отсутствия прямого writer в `EditDealDialog`.