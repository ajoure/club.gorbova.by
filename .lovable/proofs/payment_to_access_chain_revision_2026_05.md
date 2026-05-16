# PATCH F — Payment → Access end-to-end revision (read-only)

Дата: 2026-05-16
Режим: read-only. Никаких INSERT/UPDATE в entitlements/subscriptions_v2/telegram_*.
`BEPAID_REBILL_MATERIALIZATION=on` не включался.

## F.1 Inventory

### 1. Payment ingestion sources

| Источник | Edge / UI | Пишет `payments_v2` | Зовёт canonical grant |
|---|---|---|---|
| bePaid webhook (link-order, subscription) | `supabase/functions/bepaid-webhook/index.ts` | да | да (HTTP POST к `grant-access-for-order`, body `orderId`) |
| Admin bePaid sync / `bepaid-auto-process` | `supabase/functions/bepaid-auto-process/index.ts:820+` | да | да (`functions.invoke('grant-access-for-order', { body: { orderId } })`) |
| Manual admin payment + сделка из платежа | `src/components/admin/payments/CreateDealFromPaymentDialog.tsx` | да (для queue) | **исправлено в PATCH A**: `orderId` |
| Bulk create deals from payments | `src/components/admin/payments/BulkCreateDealsDialog.tsx` | да | **исправлено в PATCH A**: `orderId` |
| Admin grant (карточка контакта) | `src/components/admin/ContactDetailSheet.tsx` | да (нулевой платёж) | **исправлено в PATCH A**: `orderId` |
| Edit deal (смена тарифа/дат) | `src/components/admin/EditDealDialog.tsx` | — | **исправлено в PATCH A**: `orderId` |
| Public payment link (`/pay/:token`) | `bepaid-webhook` → callback | да | да (через bepaid-webhook) |
| Payment reconcile queue → manual | `useBepaidMappings.tsx:382` | связывание | да (уже `orderId`) |
| `erip-reconcile-pending` | `supabase/functions/erip-reconcile-pending/index.ts:252` | связывание | да (уже `orderId`) |
| `admin-manual-charge` | `supabase/functions/admin-manual-charge/index.ts:438` | да | да (уже `orderId`) |
| `admin-reconcile-processing-payments` | edge | связывание | да (уже `orderId`) |
| `test-payment-complete`, `test-payment-direct` | edge (test-only) | да | да |

**Вывод:** все production-flows после PATCH A передают canonical `orderId`. Edge function принимает оба ключа с audit `grant-access-for-order.legacy_body_alias`.

### 2. Order/deal creation flows (`meta.source` inventory)

| `meta.source` | Где создаётся | Дальше зовёт grant? |
|---|---|---|
| `admin_from_payment` | CreateDealFromPaymentDialog | да |
| `admin_bulk_from_payments` | BulkCreateDealsDialog | да |
| `admin_grant` | ContactDetailSheet | да |
| `admin_deal_only` | ContactDetailSheet (createDealOnly) | нет (явно) |
| `admin_edit` | EditDealDialog | да |
| `bepaid_webhook` / `link-order` / `subscription` | bepaid-webhook | да |
| `rebill_materialization` | bepaid-webhook / rebill_flow.ts | да (через `runRebillFlow`, в dry_run только audit) |
| `rule_engine` | синтетические order'ы | нет (исключаются из аналитики) |
| `admin_manual_charge` | admin-manual-charge | да |
| `auto_renewal` / `subscription_renewal` | subscription-charge | да |

Flows, которые создают order, но **не** зовут canonical grant (по дизайну):
- `admin_deal_only` (явный режим «только сделка»);
- `rule_engine` синтетические (используются как маркер скидки/бонуса);
- ghost-profile flows (нет `user_id`).

Flows, где UI ранее писал «доступ выдан» без подтверждения canonical grant: **исправлено в PATCH C** — `grant_success`/`grant_error_code` пишутся в audit, warning показывается через `normalizeEdgeFunctionError`.

### 3. Grant-access callers — body contract

После PATCH A все UI- и edge-точки используют `orderId` (canonical). Legacy `order_id` принимается с audit `grant-access-for-order.legacy_body_alias`. Audit за 30 дней показывает `0` ошибок «orderId is required» — UI ловил ошибку и не писал в audit (тихий дефект).

### 4. Direct Telegram writer usage (Group G)

| Точка | Статус |
|---|---|
| `src/components/admin/payments/CreateDealFromPaymentDialog.tsx` | **удалено в PATCH B** |
| `src/components/admin/payments/BulkCreateDealsDialog.tsx` | **удалено в PATCH B** |
| `src/components/admin/ContactDetailSheet.tsx` (admin_grant) | **удалено в PATCH B** |
| `src/components/admin/EditSubscriptionDialog.tsx:346` | оставлено (manual edit подписки — допустимо, идёт через subscription edit canonical) |
| `src/hooks/useTelegramIntegration.tsx:419` | оставлено (явный admin-only invite по запросу) |
| `supabase/functions/direct-charge/index.ts:650,1106` | оставлено (canonical edge path при ручном charge) |
| `supabase/functions/admin-regrant-wrongly-revoked/index.ts` | оставлено (repair tool) |
| `supabase/functions/bepaid-webhook/index.ts` (несколько мест) | оставлено (canonical recurring path) |
| `supabase/functions/telegram-webhook/index.ts` | оставлено (token-based join) |

**Вывод:** все UI-flows создания сделки/гранта теперь полагаются на canonical path `grant-access-for-order → access_rules → telegram-grant-access`. Прямые UI-вызовы Telegram удалены.

### 5. Subscriptions_v2 linkage

- Создание/продление `subscriptions_v2` — только через `grant-access-for-order` (canonical writer) и `bepaid-webhook` (recurring extend).
- `bepaid_subscription_id` резолвится в `bepaid-webhook` и pre-create при public link (см. mem://commercial-logic/payments/installment-public-link-finite-subscription).
- Связки `orders_v2 ↔ payments_v2 ↔ subscriptions_v2 ↔ provider_subscriptions ↔ entitlements` соблюдаются.
- INV-22 zombie (provider dead, local active) — отдельный repair, статус по mem://commercial-logic/subscriptions/inv22-desync-resolution.

### 6. Access window sync — выявленные расхождения

См. F.2 Group D.

### 7. Admin vs user cabinet UI

- Карточка контакта → «Доступы», карточка сделки, карточка платежа, личный кабинет используют `unified-access-truth-view` (mem://architecture/access-control/unified-access-truth-view). Resolver один.
- Найденные расхождения в датах сводятся к Group D (см. ниже) — это не разные resolver'ы, а реальные desync в БД.

## F.2 Candidate groups (read-only rowcounts)

| Группа | Условие | Count |
|---|---|---|
| **A** — paid orders без platform access (admin sources, 90 дней) | см. SQL ниже | **9** |
| **B** — Telegram access без platform access | требует TG schema review (отдельный sweep) | TBD (отдельный план, требует исправленной схемы) |
| **C** — platform access без Telegram (`requires_telegram=true`) | требует resolver на access_rules | TBD (отдельный план) |
| **D** — `subscriptions_v2.access_end_at` vs `entitlements.expires_at` mismatch >2 дней | active+entitlement | **51** — STOP-guard сработал (>20), только отчёт |
| **E** — provider/local subscription desync | INV-22 (отдельный sweep) | покрыт `inv22_provider_dead_local_active` |
| **F** — grant called but failed/ignored (audit «orderId is required», 30 дней) | meta::text match | **0** (UI ловил тихо до PATCH C) |
| **G** — direct Telegram writer usage в production-UI-flows создания сделки | inventory выше | **3 → 0** после PATCH B |

### Group A (rowcount=9, ≤20 — пригодно для PATCH E repair)

| order_id | order_number | source | created_at |
|---|---|---|---|
| 2da906f1-7957-4461-a7a1-8b977f30bf09 | GIFT-26-MOCVYPNO | admin_grant | 2026-04-24 |
| d0a995aa-887f-469b-8329-804fa9f40072 | PAY-26-MNRI13HN | admin_from_payment | 2026-04-09 |
| 6914c44e-f174-4da4-a831-c47da13ab36e | GIFT-26-MNM0A0PG | admin_grant | 2026-04-05 |
| df4f2c36-2184-48ae-bd40-cfb35b73c2e2 | GIFT-26-MNM09LJN | admin_grant | 2026-04-05 |
| 3a748fd9-e8dc-407a-9b67-866664cfa105 | GIFT-26-MNM099PF | admin_grant | 2026-04-05 |
| d3c5070c-c182-44b4-aac0-21634595f233 | GIFT-26-MNM08XKV | admin_grant | 2026-04-05 |
| b170b768-aaeb-4749-8071-20258b908dd8 | PAY-26-MN1G0JZJ | admin_from_payment | 2026-03-21 |
| 85a99b74-c545-4600-b7c8-382a37e9f118 | PAY-26-MM4P1ZYR | admin_from_payment | 2026-02-27 |
| bddd5a41-8338-4bbe-86a7-9a1db69ba5cd | PAY-26-MN1G057Z | admin_from_payment | 2026-02-19 |

→ PATCH E (repair через canonical `grant-access-for-order(orderId)`) — отдельный approve.

### Group D (rowcount=51, >20 — STOP-guard, только отчёт)

51 пар `(user_id, product_id)`, где `subscriptions_v2.access_end_at` отличается от `entitlements.expires_at` более чем на 2 дня. Repair-план «Subscription/entitlement date alignment» — отдельный PATCH (mem://architecture/fulfillment/entitlement-renewal-alignment).

## F.3 Матук Вероника — контрольная строка

| Поле | Значение |
|---|---|
| profile_id | `4e8834a5-0f6a-44d6-b05a-8d7ec3b4d6e9` |
| user_id | `341e6f46-79dd-4920-b500-da78e3574aab` |
| email | `nika.1900735@mail.ru` |
| order_id | `baeb6e7d-e661-4ee5-9a15-9d5991ce6b24` |
| order_number | `PAY-26-MP5R5Z6S` |
| product_id | `11c9f1b8-0355-4753-bd74-40b42aa53616` (Gorbova Club) |
| tariff_id | `7c748940-dcad-4c7c-a92e-76a2344622d3` (BUSINESS) |
| final_price | 250.00 BYN |
| meta.source | `admin_from_payment` |
| status | `paid` |
| created_at | 2026-05-11 19:15:45+00 |
| entitlement.id | `a2bb0780-038a-4d64-88e4-24ccba93b08c` |
| entitlement.expires_at | 2026-06-11 12:00:00+00 |
| entitlement.order_id | совпадает с order_id |
| subscription (active).id | `1f7e391e-c645-4773-bdd3-f6b803b3ed7e` |
| subscription.access_start_at | 2026-05-11 19:15:45+00 |
| subscription.access_end_at | 2026-06-11 12:00:00+00 |
| subscription.status | active |
| предыдущая подписка | `22576f44-…` status=expired, end=2026-05-11 12:19 (предыдущий цикл) |
| Telegram | grant выполнен (ранее напрямую из UI) |
| current admin UI | active до 2026-06-11 |
| current user cabinet | active до 2026-06-11 |
| **вывод** | restored в backend (canonical grant отработал позже). Code root cause `{ order_id }` vs `orderId` — **исправлен PATCH A**. Прямой Telegram writer в `admin_from_payment` — **удалён PATCH B**. Повторение этого сценария исключено. |

## F.4 STOP-guards выполнены

- read-only режим: только SELECT;
- direct DML в entitlements/subscriptions_v2/telegram_* — нет;
- `BEPAID_REBILL_MATERIALIZATION=on` — не трогался;
- schema/RLS — не менялись;
- Group D=51 >20 → только отчёт, без execute repair;
- Все repair-планы — отдельными PATCH.

## F.5 Repair-планы (отдельно, требуют approve)

1. **PATCH E** — Group A (9 кандидатов) canonical re-grant через `grant-access-for-order(orderId)`.
2. **Subscription/entitlement date alignment** — Group D (51), отдельный план.
3. **Telegram sync sweep B/C** — после Group B/C SQL (требует пересчёта).
4. **INV-22 zombie** — уже покрыт отдельной памятью.

## F.6 DoD — статус

- [x] Полный proof-файл создан.
- [x] Перечислены payment/order/grant/telegram flows.
- [x] Перечислены прямые Telegram writer'ы (Group G).
- [x] Матрица расхождений (Group D rowcount=51).
- [x] Candidate lists A/D/F/G.
- [ ] B/C — требуют отдельного TG-schema sweep (вынесено в repair-планы).
- [x] Матук Вероника — отдельная строка с выводом.
