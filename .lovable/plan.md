да, согласен, с учетом правок:

1. **Добавить обязательный PATCH F — полная end-to-end ревизия цепочки оплаты и доступа.**  
Сейчас план чинит конкретные дефекты `orderId/order_id` и прямой Telegram writer, но не закрывает главный риск: система может иметь другие разрывы в цепочке `payment → order → grant → subscription/entitlement → Telegram → UI`.
2. **PATCH F должен быть read-only и идти до массового repair.**  
Никаких execute-действий по кандидатам, пока не будет полной карты цепочки.
3. **В PATCH F проверить всю цепочку:**

```text
payment received
→ payment recorded
→ order/deal created
→ grant-access-for-order
→ subscription / entitlement
→ access window
→ Telegram access
→ admin UI / user cabinet display
```

4. **Добавить в план раздел PATCH F:**

```text
### PATCH F — полная ревизия end-to-end цепочки оплаты, доступа, Telegram и подписок

Цель: проверить всю цепочку от получения денег до отображения доступа в админке, кабинете пользователя и Telegram.

Read-only проверить:

1. Payment ingestion:
- bePaid webhook;
- admin bePaid sync;
- manual/admin payment flow;
- payment_reconcile_queue;
- public payment link;
- bulk create from payments.

Для каждого источника определить:
- где создаётся payments_v2;
- где определяется user_id/profile_id;
- где определяется product_id/tariff_id;
- где создаётся orders_v2;
- где вызывается grant-access-for-order;
- есть ли flow, где payment/order создаются без canonical grant.

2. Order/deal creation:
- все места создания orders_v2;
- все meta.source:
  - admin_from_payment;
  - admin_bulk_from_payments;
  - admin_grant;
  - bepaid_webhook;
  - rebill_materialization;
  - другие;
- какие flows создают order, но не подтверждают grant;
- какие flows игнорируют ошибку grant.

3. Platform access:
Проверить canonical path:

orders_v2 / paid order
→ grant-access-for-order(orderId)
→ subscriptions_v2 / entitlements
→ access_grant_ledger / audit_logs

Проверить все вызовы grant-access-for-order:
- из UI;
- из edge functions;
- из cron/sync;
- body contract orderId/order_id;
- где результат grant игнорируется.

4. Telegram access:
Проверить, что Telegram выдаётся только через:

grant-access-for-order
→ access_rules/product fulfillment
→ telegram-grant-access

Найти все прямые вызовы telegram-grant-access:
- из UI;
- из edge functions;
- из admin flows;
- из repair flows.

Telegram access не считать source of truth. Source of truth:
subscriptions_v2 / entitlements / manual access.

5. Subscriptions:
Проверить:
- когда создаётся subscriptions_v2;
- когда продлевается access_end_at;
- как определяется bepaid_subscription_id;
- как связаны orders_v2, payments_v2, subscriptions_v2, provider_subscriptions, entitlements;
- есть ли provider active + local expired;
- есть ли local active + provider canceled;
- есть ли subscription без entitlement;
- есть ли entitlement без subscription/access window.

6. Access time synchronization:
Проверить совпадение:
- subscriptions_v2.access_start_at/access_end_at;
- entitlements.valid_from/expires_at;
- provider_subscriptions.next_charge_at;
- orders_v2.deal_date;
- payments_v2.paid_at;
- admin UI access date;
- user cabinet access date;
- Telegram expiration/status, если хранится.

7. Admin UI vs user cabinet:
Проверить одинаковость отображения в:
- карточке контакта → Доступы;
- карточке сделки;
- карточке платежа;
- личном кабинете;
- /products;
- training-tree;
- Telegram status blocks.

Proof-файл:
.lovable/proofs/payment_to_access_chain_revision_2026_05.md
```

5. **Добавить группы кандидатов для read-only отчета:**

```text
Group A — paid orders without platform access
Group B — Telegram access without platform access
Group C — platform access without Telegram access
Group D — subscription / entitlement date mismatch
Group E — provider/local subscription desync
Group F — grant called but failed/ignored
Group G — direct Telegram writer usage
```

6. **Добавить отдельную строку по Матук Веронике в PATCH F proof:**

```text
Матук Вероника:
- payment;
- order;
- subscription;
- entitlement;
- Telegram status;
- access dates;
- current admin UI status;
- current user cabinet status;
- conclusion: restored / not restored / needs repair / code-only issue.
```

7. **PATCH E repair не выполнять в рамках первого захода.**  
В текущем плане пункт 7 допускает repair после dry-run. Лучше разделить:
  - текущий заход: code-patch A/B/C + read-only D/F;
  - repair E: только отдельным approve после таблицы кандидатов.
8. **Добавить запрет на прямой Telegram repair.**  
Любой Telegram sync repair допустим только если уже есть primary active entitlement/subscription. Нельзя выдавать Telegram как замену платформенному доступу.
9. **Добавить проверку admin UI vs user cabinet по одинаковому access resolver.**  
Если админка и кабинет используют разные источники, это отдельный UI display resolver patch.
10. **Добавить в конец плана:**

```text
Важно: этот PATCH не должен ограничиваться кейсом Матук Вероники. Кейс Матук — контрольный пример. Основная задача — проверить и зафиксировать всю цепочку от получения денег до отображения доступа в админке, личном кабинете и Telegram.
```

После этих дополнений план можно запускать. Для текущего захода: **code A/B/C + read-only D/F**, без массового repair.

&nbsp;

План:

## 1. Проблема

По Матук Веронике (контрольный пример) и похожим сценариям админский UI создаёт сделку из платежа, но canonical writer `grant-access-for-order` срабатывает не всегда: платформенный доступ не подтверждается, а Telegram-доступ при этом приходит отдельно. Нужно не точечный фикс, а полная ревизия end-to-end цепочки оплаты → сделка → доступ → Telegram → отображение.

## 2. Диагностика (уже выполненная read-only)

- Контакт: `profile_id=4e8834a5-0f6a-44d6-b05a-8d7ec3b4d6e9`, `user_id=341e6f46-79dd-4920-b500-da78e3574aab`, `email=nika.1900735@mail.ru`.
- Проблемная сделка: `order_id=baeb6e7d-e661-4ee5-9a15-9d5991ce6b24`, `order_number=PAY-26-MP5R5Z6S`, `meta.source=admin_from_payment`, продукт Gorbova Club, тариф BUSINESS, 250 BYN.
- В момент создания сделки audit `admin.create_deal_with_access_from_payment` записал `subscription_id=null` — UI не дождался подтверждения canonical grant.
- Позже `grant-access-for-order` всё же отработал: `entitlements.id=a2bb0780-…`, `subscriptions_v2.id=1f7e391e-…`, `access_end_at=2026-06-11`.
- Системный код-дефект: UI зовёт `grant-access-for-order` с body `{ order_id }`, edge function ждёт `orderId` → `orderId is required`, при этом UI продолжает Telegram side-effect.
- Параллельный Telegram writer в UI нарушает canonical path и объясняет «Telegram есть, доступа нет».

## 3. Предлагаемое решение

### PATCH A — контракт `grant-access-for-order`

1. UI: `{ order_id }` → `{ orderId }` во всех точках (`CreateDealFromPaymentDialog`, `BulkCreateDealsDialog`, `ContactDetailSheet` и пр.).
2. Edge function: принимать оба ключа, нормализовать в `orderId`, писать audit `grant-access-for-order.legacy_body_alias` для legacy-вызовов.

### PATCH B — убрать параллельный Telegram writer из UI

В UI-flows создания сделки/ручного гранта удалить прямые `supabase.functions.invoke("telegram-grant-access", …)`. Telegram-доступ выдаёт только canonical path:

```text
order paid / admin grant / deal from payment
  → grant-access-for-order
  → telegram-grant-access (через access_rules)
```

### PATCH C — корректная обработка результата в UI

- Не показывать «доступ выдан», если canonical grant не вернул успех.
- Использовать `normalizeEdgeFunctionError`, не показывать raw error.
- В audit `admin.create_deal_with_access_from_payment` сохранять `grant_success`, `grant_error_code`, `subscription_id`, `entitlement_id`.

### PATCH D — dry-run кандидатов локального дефекта

Read-only список paid-сделок, где writer-flow ожидал доступ, но его нет:

- `meta.source ∈ ('admin_from_payment','admin_bulk_from_payments','admin_grant')`;
- не ghost, есть `product_id` и `tariff_id`;
- нет активного entitlement по `(user_id, product_id)` и/или нет/не extended `subscriptions_v2`.

### PATCH E — repair только через canonical writer

Для approved кандидатов: вызов `grant-access-for-order(orderId)` без прямых INSERT/UPDATE. Proof-файл с before/after.

---

## PATCH F — полная ревизия end-to-end цепочки оплаты и доступа (обязательный, read-only)

### F.0 Цель

Проверить, что вся цепочка работает как единая система без параллельных writer’ов:

```text
payment received
  → payment recorded (payments_v2)
  → order/deal created (orders_v2)
  → grant-access-for-order(orderId)
  → entitlement / subscriptions_v2 created or extended
  → access window synchronized
  → Telegram access via canonical path
  → admin UI и user cabinet показывают одинаковый access state
```

Кейс Матук Вероники — только контрольный пример. Основная задача — зафиксировать всю цепочку от получения денег до отображения доступа.

### F.1 Read-only inventory

1. **Payment ingestion sources:** `bepaid-webhook`, admin bePaid sync, manual/admin flow, `payment_reconcile_queue`, public payment link, bulk create from payments. Для каждого: где пишется `payments_v2`, где определяются `user_id/profile_id/product_id/tariff_id`, где создаётся/находится `orders_v2`, где зовётся `grant-access-for-order`, есть ли flows без canonical grant.
2. **Order creation flows:** все места insert в `orders_v2`, инвентарь `meta.source` (`admin_from_payment`, `admin_bulk_from_payments`, `admin_grant`, `bepaid_webhook`, `rebill_materialization`, прочие), какие создают order без grant, какие зовут grant без проверки результата, какие пишут «доступ выдан» до подтверждения.
3. **Grant-access callers:** body contract (`orderId` vs legacy `order_id`); UI / edge functions / cron; где результат игнорируется; где UI продолжает side-effect при ошибке.
4. **Telegram access:** прямые UI и edge вызовы `telegram-grant-access` вне canonical; flows, где Telegram выдан без primary entitlement/subscription. Telegram **не** SOT.
5. **Subscriptions_v2 linkage:** когда создаётся/продлевается, как резолвится `bepaid_subscription_id`, как связаны `orders_v2 ↔ payments_v2 ↔ subscriptions_v2 ↔ provider_subscriptions ↔ entitlements`.
6. **Access window sync:** `subscriptions_v2.access_start_at/access_end_at`, `entitlements.expires_at`, `provider_subscriptions.next_charge_at`, `orders_v2.deal_date`, `payments_v2.paid_at`, окна в admin UI и user cabinet, Telegram expiration.
7. **Admin vs user cabinet UI:** один canonical resolver (или одинаковый результат) в карточке контакта (вкладка «Доступы»), карточке сделки, карточке платежа, личном кабинете, `/products`, training-tree, Telegram-блоках.

### F.2 Candidate groups (read-only SQL)

- **A** — paid orders без platform access (есть `user_id/product_id/tariff_id`, нет активных entitlement/subscription).
- **B** — Telegram access без platform access.
- **C** — platform access без Telegram при `requires_telegram=true` на продукте.
- **D** — date mismatch `subscriptions_v2.access_end_at` ≠ `entitlements.expires_at` для одного `(user_id, product_id)`.
- **E** — provider/local desync: `provider_subscriptions.state='active'` vs local expired/canceled/superseded и наоборот.
- **F** — grant called but failed/ignored: audit показывает попытку, но `subscription_id/entitlement_id` отсутствуют или UI продолжил side-effect.
- **G** — direct Telegram writer usage: места в коде и audit, где Telegram выдан вне canonical.

### F.3 Proof-файл

`.lovable/proofs/payment_to_access_chain_revision_2026_05.md` со всеми разделами F.1–F.2 и отдельной строкой по Матук Веронике: payment / order / subscription / entitlement / Telegram / access dates / current status / вывод (восстановлено, требует repair, требует code-fix).

### F.4 STOP-guards для PATCH F

- Никакого execute на этом этапе. Только read-only.
- Никаких прямых INSERT/UPDATE в `entitlements`, `subscriptions_v2`, `telegram_*`.
- `BEPAID_REBILL_MATERIALIZATION=on` не включать.
- Не менять schema/RLS.
- Если в любой группе A–G кандидатов больше 20 — только отчёт, без repair-плана execute.
- Все repair — отдельными patch: dry-run → approve → execute.

### F.5 Repair-планы после ревизии (отдельно, не в этом PATCH)

- Canonical grant repair — только через `grant-access-for-order(orderId)`.
- Telegram sync repair — только при активных primary entitlement/subscription.
- Subscription/entitlement date alignment — через canonical writer или approved repair.
- Provider/local subscription desync — по аналогии с zombie provider subscriptions.
- UI display resolver patch — если admin/user UI показывают разное.

### F.6 DoD PATCH F

- Полный proof-файл создан.
- Перечислены все payment/order/grant/telegram flows.
- Перечислены все прямые Telegram writer’ы.
- Матрица расхождений по access windows.
- Candidate lists по группам A–G.
- По Матук Веронике отдельная строка с финальным выводом.

---

## 4. Изменяемые компоненты

Файлы (PATCH A–C):

- `supabase/functions/grant-access-for-order/index.ts` (только compatibility + audit)
- `src/components/admin/payments/CreateDealFromPaymentDialog.tsx`
- `src/components/admin/payments/BulkCreateDealsDialog.tsx`
- `src/components/admin/ContactDetailSheet.tsx`

Proof:

- `.lovable/proofs/matuk_access_deal_creation_revision_2026_05.md` (PATCH A–E)
- `.lovable/proofs/payment_to_access_chain_revision_2026_05.md` (PATCH F)

Read-only таблицы для F: `profiles`, `orders_v2`, `payments_v2`, `subscriptions_v2`, `entitlements`, `payment_reconcile_queue`, `audit_logs`, `telegram_club_members`, `telegram_messages`, `telegram_access_queue`, `provider_subscriptions`, `access_rules`, `access_grant_ledger`, `products_v2`, `tariffs`.

## 5. Что не будет изменено

- `BEPAID_REBILL_MATERIALIZATION=on` не включать.
- `bepaid-webhook` не рефакторить (только если targeted tests покажут регрессию).
- Никаких новых таблиц/RPC/edge functions.
- Никаких прямых INSERT/UPDATE в `entitlements` / `subscriptions_v2` / `telegram_*`.
- Не менять access_rules, продукты, тарифы, schema, RLS.

## 6. Dry-run

1. SQL-снимок Матук Вероники по всем уровням цепочки.
2. SQL по PATCH D кандидатам.
3. SQL по PATCH F группам A–G с rowcount.
4. STOP-guard: > 20 в группе → только отчёт.

## 7. Execute (после approve этого плана)

1. PATCH A–C — код-патч + tests `grant-access-for-order` + deploy.
2. PATCH F — read-only ревизия + proof-файл.
3. PATCH D — dry-run кандидатов.
4. PATCH E — canonical repair только после approve по rowcount.
5. Repair-планы из F.5 — отдельными PATCH с dry-run → approve → execute.

## 8. STOP-guards (общие)

- Заказ без `user_id/product_id/tariff_id` → stop.
- Foreign-user collision на entitlement → stop.
- `grant-access-for-order` вернул `sbs_mismatch` / `manual_review` / `primary_entitlement_*_failed` → stop.
- Edge function tests не проходят → stop.
- Любая необходимость менять schema/RLS → отдельный план/миграция.

## 9. DoD общий

- UI везде использует `orderId` (или совместимый нормализованный контракт).
- `grant-access-for-order` принимает legacy `order_id` с audit.
- В flows создания сделки/ручного гранта нет прямого `telegram-grant-access`.
- UI не пишет «доступ выдан» без подтверждения canonical grant.
- По Матук Веронике в proof: payment / deal / entitlement / subscription / Telegram / access window — всё через canonical writer; Telegram не используется как доказательство платформенного доступа.
- PATCH F DoD выполнен (см. F.6).
- Данных вне canonical writer не меняли.
- `BEPAID_REBILL_MATERIALIZATION=on` не включался.

## 10. Риски и зависимости

- Удаление прямого Telegram writer из UI безопасно: `grant-access-for-order` уже содержит canonical Telegram path через `access_rules`.
- Исторические сделки с разными `meta.source` — массовый repair только после dry-run.
- Текущий кейс Матук уже восстановлен в backend, но root cause в коде остаётся → повторится без PATCH A–C.

## 11. Требуется дополнительная информация

Не требуется для approve. Repair-объёмы (PATCH E и F.5) запросят отдельный approve по rowcount после dry-run.

---

**Важно:** этот план не ограничивается кейсом Матук Вероники. Кейс Матук — контрольный пример. Основная задача PATCH F — проверить и зафиксировать всю цепочку от получения денег до отображения доступа в админке, личном кабинете и Telegram.