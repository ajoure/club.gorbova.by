да, согласен, с учетом правок:

1. План в целом правильный, но INV-20 нельзя чинить blind UPDATE двух payments_v2, пока не доказано, что эти payment действительно являются rebill charge, а не initial payment исходного заказа.

&nbsp;

Перед re-attach обязательно проверить по каждому payment:

- provider_payment_id совпадает с orders_v2.provider_payment_id rebill-order;

- payment.paid_at соответствует [rebill-order.deal](http://rebill-order.deal)_date/paid_at;

- payment.meta.bepaid_subscription_id / parent_uid / recurring markers указывают на тот же provider_subscription;

- исходный order после переноса не останется без своего initial payment;

- нет refund-row, parent_payment_id или refund linkage, который сломается от re-attach.

&nbsp;

2. Если исходный order после переноса останется без payment, не ставить сразу meta.inv20_legacy_noise.

Сначала доказать:

- это действительно synthetic/import/legacy order;

- нет реального initial payment;

- нет active entitlement/subscription, завязанного на этот order как paid source.

Только после этого можно помечать как legacy_noise.

&nbsp;

3. Корневой fix webhook должен быть сделан не просто “если order_is_rebill”.

Нужны guards:

- [rebillOrder.id](http://rebillOrder.id) существует;

- payment найден по тому же provider_payment_id;

- payment.order_id != [rebillOrder.id](http://rebillOrder.id);

- текущий payment.order_id является parent/initial order той же subscription/user/product;

- нет уже другого payment на rebillOrder;

- transaction не refund;

- provider_payment_id уникален;

- запись audit до/после.

&nbsp;

4. INV-19B через admin-bepaid-backfill — сначала dry-run.

Execute только если:

- подписка active;

- auto_renew=true;

- billing_type=provider_managed;

- payment_method bePaid активен;

- нет existing provider_subscriptions;

- backfill не создаст дубль по provider_subscription_id / subscription_v2_id.

&nbsp;

5. INV-SITE-1 можно чинить миграцией, но idempotently:

- обновлять только страницу `969210bb`;

- только блок `type='form'`;

- только если `version` отсутствует;

- не менять content/id/type.

&nbsp;

6. Добавить regression proof:

после webhook-fix повторный rebill должен:

- создать/найти REBILL-order;

- привязать payments_v2 к REBILL-order;

- не оставлять INV-20;

- не трогать initial order payment;

- не вызывать grant-access-for-order повторно по старому order.

&nbsp;

7. Не делать всё как “миграции и потом посмотрим”.

Нужно выполнить:

- preflight таблицу по 3 инвариантам;

- execute;

- post-verify;

- только потом nightly-system-health.

Итоговая команда:

План принимаю с правками.

&nbsp;

Разрешаю PATCH-NIGHTLY-2026-05-25-FIX.

&nbsp;

Scope:

1. INV-SITE-1:

- idempotent update `site_pages.blocks`;

- добавить `version:1` только form-блоку страницы `969210bb`;

- content/type/id не менять.

&nbsp;

2. INV-19B:

- сначала `admin-bepaid-backfill` dry-run по одной подписке `a25168db`;

- execute только если dry-run показывает ровно 1 candidate и 0 дублей;

- audit `bepaid_backfill_provider_sub`.

&nbsp;

3. INV-20:

- preflight по двум парам payment↔rebill-order;

- re-attach только если доказано, что payment является rebill charge именно этого order;

- audit `inv20_repair_reattach_rebill_payment`;

- не помечать исходные orders как legacy_noise без отдельного доказательства.

&nbsp;

4. Root fix `bepaid-webhook`:

- добавить guard re-attach payment to rebill-order;

- только для non-refund rebill transaction;

- только если payment provider_payment_id = rebillOrder provider_payment_id;

- если rebillOrder уже имеет payment — skip/idempotent;

- audit `bepaid.webhook.payment_reattached_to_rebill_order`.

&nbsp;

Запрещено:

- менять subscriptions_v2 вручную;

- менять entitlements;

- менять grants/access;

- менять RLS/cron/schema;

- удалять provider_subscriptions;

- трогать INV-22 logic;

- менять ContactDetailSheet.

&nbsp;

Verify:

- INV-20 actionable = 0;

- INV-19B = 0;

- INV-SITE-1 = 0;

- `/nightly-payments-invariants` OK;

- `/nightly-system-health` 8/8 OK;

- proof со SQL before/after и audit ids.

&nbsp;

Proof:

.lovable/proofs/nightly_2026_05_25_[fix.md](http://fix.md)

Ключевое: **INV-20 чинить только после доказательства, что эти payments — именно rebill-платежи, иначе можно снова разорвать initial orders.**

&nbsp;

# План: ночная проверка 25.05.2026 — 3 ошибки, корневые причины и исправления

## Diagnose (что нашёл)

### 1. INV-20: 2 оплаченных заказа без `payments_v2` (`ecd989f1`, `c82ad679`)

Это **rebill-заказы** (`meta.source='bepaid_rebill'`, `provider='bepaid'`, `provider_payment_id` заполнен), но `payments_v2` для их `provider_payment_id` **существует** и привязан к ДРУГОМУ (исходному) заказу:

```
orders_v2 ecd989f1 (rebill, 19.05)  →  payments_v2 c5c7dcd0  →  order_id=ea774d6c (исходный чекаут от 19.04)
orders_v2 c82ad679 (rebill, 18.05)  →  payments_v2 e1238eac  →  order_id=c11a518d (исходный чекаут от 17.02)
```

`subscriptions_v2` (`de75db3a`, `161a0644`) и их `provider_subscriptions` (`sbs_812f...`, `sbs_85af...`) живы и `active`.

**Корневая причина:** `bepaid-webhook` при rebill-событии создаёт новую запись в `orders_v2` (правильно — это новый цикл), но `payments_v2` уже была вставлена ранее с `order_id` = исходного чекаут-заказа, и при rebill она **не переаттачивается** на новый rebill-order. Получается «дубль-orphan»: оплата висит на старом заказе, новый rebill-order остаётся без `payments_v2` → INV-20 ругается.

### 2. INV-19B: 1 авторекурринг без `provider_subscriptions`

Подписка `a25168db-a289-431a-8869-5fca9486ca62` (user `1409fd0e...`, product `11c9f1b8` = Клуб, tariff `7c748940`): `status=active`, `auto_renew=true`, `billing_type=provider_managed`, у пользователя есть активный `payment_methods.provider=bepaid` — но в `provider_subscriptions` нет ни одной строки с этим `subscription_v2_id`.

**Корневая причина:** подписка была создана (вероятно через ручное действие/импорт/повторное оформление 29.04) без вызова канонического write-path `grant-access-for-order → bepaid → pre-create provider_subscriptions`. Это ровно тот сценарий, для которого существует `admin-bepaid-backfill`.

### 3. INV-SITE-1: 1 невалидная опубликованная страница (`969210bb`, `form-proof`)

Страница опубликована, блок имеет `id` + `type='form'`, но **отсутствует поле `version**` (инвариант ожидает `id` + `type` + `version`).

**Корневая причина:** страница (proof-форма) была опубликована до того, как блок-схема стала требовать `version`. Это служебная тест-форма, не продакшен-лендинг.

---

## Plan (что делаем)

### Шаг 1. INV-SITE-1 — добавить `version: 1` к блоку form-proof

Через `supabase--migration` обновить `site_pages.blocks` для `id='969210bb-00fc-4fce-b248-624d344e881e'`, проставив `version: 1` единственному блоку. Не трогаем content/type/id.

### Шаг 2. INV-19B — backfill одной подписки

Вызвать существующую edge `admin-bepaid-backfill` (mode=execute) **точечно для user_id=`1409fd0e-23fb-44fb-a6af-11778a53a94f**` (либо subscription_id=`a25168db-...`), чтобы создалась запись `provider_subscriptions`. Никаких новых функций.

Если у функции нет точечного режима — сначала dry-run по всему списку (на момент проверки в БД только 1 кандидат), затем execute.

### Шаг 3. INV-20 — точечный re-attach двух payments_v2 на rebill-orders

Через `supabase--migration` (UPDATE требует миграции) переаттачить:

```
payments_v2 c5c7dcd0  →  order_id = ecd989f1
payments_v2 e1238eac  →  order_id = c82ad679
```

с записью аудита в `audit_logs` (`action='inv20_repair_reattach_rebill_payment'`, актор=system, meta = до/после).

Исходные orders (`ea774d6c`, `c11a518d`) — это первый платёж по подписке, у них тоже когда-то был свой `payments_v2` (по другому `provider_payment_id` исходного чекаута). После re-attach исходные orders могут остаться без `payments_v2` → проверить и при необходимости найти исходный платёж первого цикла (по `meta.checkout_token`/`tracking_id`/дате) и оставить его привязанным.

**Если исходный платёж первого цикла не находится** — это уже legacy-noise (синтетический импорт), помечаем `orders_v2.meta.inv20_legacy_noise=true`, чтобы RPC `inv20_paid_orders_actionable` его исключила (как уже делает для synthetic).

### Шаг 4. Корневой fix `bepaid-webhook` (rebill payment binding)

В `supabase/functions/bepaid-webhook/index.ts` найти ветку обработки rebill-транзакции. Сейчас она:

1. ищет существующую `payments_v2` по `provider_payment_id` → находит запись от первичного UPSERT с `order_id` = первичный заказ;
2. создаёт новый `orders_v2` под rebill;
3. не обновляет `payments_v2.order_id`.

**Изменение:** при обработке rebill после создания/нахождения нового rebill-order:

```ts
if (payment.order_id !== rebillOrder.id && order_is_rebill) {
  await supabase.from('payments_v2').update({ order_id: rebillOrder.id })
    .eq('id', payment.id);
  await writeAudit('bepaid.webhook.payment_reattached_to_rebill_order', ...);
}
```

Альтернатива (если архитектурно чище): rebill-обработчик создаёт **новую** `payments_v2` с `reference_payment_id` старой, привязанной к rebill-order. Но это меняет write-path → выберем минимально-инвазивный re-attach.

DoD-проверка: после фикса повторно запустить `nightly-payments-invariants` → INV-20 actionable = 0.

### Шаг 5. Verify (DoD)

1. `supabase--read_query`: `payments_v2` по двум rebill-orders → строки найдены.
2. `supabase--read_query`: подписка `a25168db` → в `provider_subscriptions` есть запись.
3. `supabase--read_query`: страница `969210bb` → блок имеет `version: 1`, инвариант пройдён.
4. `supabase--curl_edge_functions` POST `/nightly-payments-invariants` и `/nightly-system-health` → все 8 OK.
5. Скриншот `/admin/system-health` после прогона.

---

## Что НЕ трогаем

- `subscriptions_v2`, `provider_subscriptions`, `orders_v2` (кроме `meta.inv20_legacy_noise` при необходимости).
- Канонический write-path `grant-access-for-order`.
- RLS, cron, schema, INV-22 логика, ContactDetailSheet (наш предыдущий патч).
- Содержимое страницы `form-proof` — только добавление `version`.

## Технические детали (для тех, кто читает код)

- Файлы под изменение: `supabase/functions/bepaid-webhook/index.ts` (Шаг 4), миграции (Шаги 1 и 3).
- `inv20_paid_orders_actionable` RPC оставляем как есть — после re-attach actionable_count = 0 естественным образом.
- Audit: `audit_logs` table, `action ∈ {inv20_repair_reattach_rebill_payment, sitepage_block_version_backfill, bepaid_backfill_provider_sub}`.
- Proof: `.lovable/proofs/nightly_2026_05_25_fix.md` со SQL до/после, скриншотом `/admin/system-health` = 8/8 OK.