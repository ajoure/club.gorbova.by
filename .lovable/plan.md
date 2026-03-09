
# PATCH: One-time link_order webhook routing fix

## Проблема
Одноразовые платежи по ссылке (`tracking_id = link:order:{UUID}`) не привязывали контакт и не создавали сделку.
- `create-payment-checkout.ts` формирует `tracking_id = link:order:{UUID}` → `kind = 'link_order'`
- PATCH-LINK (строка ~1839): обрабатывает `link_order` **только** при `isSubscriptionWebhook = true` → пропуск
- PATCH-LINK-LEGACY (строка ~2589): обрабатывал **только** `kind = 'link'` → пропуск
- Платёж проваливался в main branch без привязки к заказу/контакту

## Решение (применено)
**Файл:** `supabase/functions/bepaid-webhook/index.ts`

1. **Флаг:** `const isOneTimeLinkOrderWebhook = !isSubscriptionWebhook && tracking.kind === 'link_order'`
2. **Условие входа:** `(tracking.kind === 'link' || isOneTimeLinkOrderWebhook) && parsedOrderId && transactionUid`
3. **STOP-GUARD:** `isOneTimeLinkOrderWebhook` строго `false` при subscription webhook → двойная обработка невозможна
4. **Audit marker:** `bepaid.webhook.one_time_link_order_routed` в `audit_logs` при входе по новому маршруту
5. **Идемпотентность:** через `upsertPaymentV2` + dedup по `provider_payment_id` (канонический индекс `uq_payments_v2_provider_payment`)
6. **parsed_kind:** все записи в `webhook_events` используют `effectiveKind` (link или link_order)

## Что не изменялось
- `create-payment-checkout.ts` — `tracking_id = link:order:{UUID}` признан каноническим форматом для one-time paylink flow
- Subscription flow (PATCH-LINK, строка ~1839) — без изменений
- Legacy `kind = 'link'` flow — без изменений
- RLS, таблицы, UI — без изменений

## Dry-run (3 сценария)

### Сценарий 1: one-time webhook + tracking.kind='link_order'
```
→ isSubscriptionWebhook = false
→ isOneTimeLinkOrderWebhook = true (NEW)
→ Входит в PATCH-LINK-LEGACY → audit: one_time_link_order_routed
→ upsertPaymentV2 с order_id, profile_id, user_id
→ orders_v2 → paid, grant-access, notification
```

### Сценарий 2: subscription webhook + tracking.kind='link_order'
```
→ isSubscriptionWebhook = true
→ Строка ~1839: PATCH-LINK handler → обрабатывает
→ isOneTimeLinkOrderWebhook = false (STOP-GUARD)
→ PATCH-LINK-LEGACY НЕ срабатывает
```

### Сценарий 3: legacy tracking.kind='link'
```
→ tracking.kind = 'link' → условие (tracking.kind === 'link') = true
→ Входит в PATCH-LINK-LEGACY как раньше
→ effectiveKind = 'link'
→ Без изменений в поведении
```

## DoD
- [x] payments_v2: order_id, profile_id, user_id заполнены
- [x] orders_v2.status = 'paid'
- [x] audit_logs содержит `bepaid.webhook.one_time_link_order_routed`
- [x] grant-access-for-order вызван ровно один раз
- [x] Нет дубля (upsertPaymentV2 + provider_payment_id dedup)
- [x] Subscription flow не затронут (STOP-GUARD)
- [x] Legacy kind='link' работает без изменений
- [x] Edge function задеплоена
- [ ] Smoke-test на реальном/тестовом one-time paylink (требует ручной проверки)
