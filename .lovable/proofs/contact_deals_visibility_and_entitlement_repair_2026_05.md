# Отчёт: Шуляк Диана — видимость сделки + ремонт entitlement (2026-05)

## Контекст
- Контакт: Шуляк Диана, `profile_id=0784a581-c4d6-409c-a1e6-631cd18dd3a1`, `user_id=80afcb07-3d07-40b8-aff7-c17e179e39f5`.
- Сделка `d5aca9de-218a-416a-9c9d-b35f9dbaf899` — рассрочка по продукту «ЗАКРОЙ ГОД» (`73c29914-…`), tariff `56c35e86-…`, `final_price=1035`, `paid_amount=345`, `status=partial`, `deal_date=2025-10-17`.
- Битый entitlement до ремонта: `d7081960-…` (`expires_at=NULL`, `meta.source=admin_edit`).

## PATCH 1 — UI-фильтр
`src/components/admin/ContactDetailSheet.tsx:438`
```diff
-.in("status", ['paid', 'canceled', 'refunded'] as const)
+.in("status", ['paid', 'partial', 'pending', 'canceled', 'refunded'] as const)
```
Enum `order_status` не содержит `cancelled` (двойное l), поэтому используется только `canceled`.

DoD: сделка `d5aca9de-…` (`status=partial`) теперь попадает в выборку контакта.

## PATCH 2 — backup + delete + canonical re-grant

Миграция `20260506-125113`:
- backup → `_backup_entitlement_delete_byn_2026_05_shulyak` (1 строка);
- audit `entitlement.deleted.broken_admin_edit_no_expires_at` (`actor_type=system`, `target_user_id=80afcb07-…`);
- `DELETE FROM entitlements WHERE id='d7081960-…' AND expires_at IS NULL`.

Canonical re-grant:
```
POST /grant-access-for-order { orderId: 'd5aca9de-…', source: 'admin_repair_2026_05_shulyak' }
→ 200 OK
  entitlement.action = created, id = 5f15f12c-…
  accessStartAt = 2025-10-17T04:26:44Z
  accessEndAt   = 2026-01-15T04:26:44Z (90 дней от даты сделки)
  subscription.action = created (auto_renew=false)
  primary_entitlement_verified = true
```

Snapshot после:
```
entitlements WHERE user=80afcb07 AND product=73c29914
→ id=5f15f12c-…, status=active, expires_at=2026-01-15, meta.tariff_id=56c35e86-…
```
Записей с `expires_at IS NULL` по этому `(user,product)` нет.

## PATCH 3 — запрет прямого writer в EditDealDialog

`src/components/admin/EditDealDialog.tsx`:
- удалён блок `from('entitlements').upsert(...)` и локальный audit `entitlement.saved_via_admin_edit`;
- ветка `newStatus === 'paid' && deal.user_id` теперь вызывает `supabase.functions.invoke('grant-access-for-order', { body: { order_id, source: 'admin_edit' } })`;
- ошибки оборачиваются `normalizeEdgeFunctionError`;
- UUID-guard на `product_id` сохранён.

Grep-доказательство:
```
$ rg -n "from\(['\"]entitlements['\"]\)\.(upsert|insert|update)" src/components/admin/EditDealDialog.tsx
(пусто)
```

## Scope guard
Не тронуты: bePaid sync, payments_v2, subscriptions_v2 архитектура, refund-логика, Telegram access, retroapply / rule_engine, рассрочки как фича.

## DoD сводный
- [x] PAY (`d5aca9de-…`) видна в карточке контакта (фильтр включает `partial`).
- [x] Битый entitlement `d7081960-…` удалён, backup в `_backup_entitlement_delete_byn_2026_05_shulyak`.
- [x] Новый entitlement `5f15f12c-…` создан через `grant-access-for-order` с `expires_at=2026-01-15` и `meta.tariff_id`.
- [x] В `EditDealDialog` нет прямого writer-а в `entitlements`.
- [x] Audit: `entitlement.deleted.broken_admin_edit_no_expires_at` + writer-side audit `grant-access-for-order`.
- [x] Никаких изменений в системе рассрочек.
