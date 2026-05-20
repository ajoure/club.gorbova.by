&nbsp;

Да, согласен, **но только с существенной заменой бизнес-правила**.

В текущем плане всё ещё неправильно написано, что блокировать может active/trial + access_end_at + paid order. Это нужно убрать.

**Главная правка**

Блокировать создание новой оплаты должен **только активный bePaid auto-renew / provider subscription по этому же продукту**.

Не блокируют:

active entitlement

действующее окно access_end_at / expires_at

старый paid order

past_due

pending

redirecting

expired

canceled

pending order

paid_amount=0

неоплаченная checkout-сессия

Пользователь может иметь ещё 2 дня доступа и всё равно купить новый тариф сегодня. Это нормально.

**Ответ Lovable**

Да, согласен, с учетом правок:

&nbsp;

1. Полностью заменить раздел 2 “Бизнес-правило”.

&nbsp;

Правильный SoT:

&nbsp;

Checkout conflict / replacement flow нужен только для защиты от двух активных bePaid-автосписаний по одному продукту.

&nbsp;

Блокирующее условие только одно:

&nbsp;

- найден provider_subscriptions.state = 'active';

- provider subscription относится к тому же user/profile;

- product_id совпадает;

- это bePaid recurring / auto-renew subscription.

&nbsp;

Всё.

&nbsp;

Не использовать как blocker:

&nbsp;

- subscriptions_v2.status='active' сам по себе;

- subscriptions_v2.status='trial' сам по себе;

- active entitlement;

- access_end_at > now();

- expires_at > now();

- paid order;

- paid_at + access_days;

- orders_v2.status='paid';

- past_due;

- pending;

- redirecting;

- expired;

- canceled;

- pending order;

- paid_amount=0;

- неоплаченная checkout-сессия.

&nbsp;

2. Логика по тарифу:

&nbsp;

Если active bePaid subscription найдена по тому же продукту:

&nbsp;

- same tariff → показать сценарий “оставить текущую подписку / заменить подписку”;

- other tariff same product → показать сценарий “отменить действующее автосписание и создать новое”.

&nbsp;

Это не ошибка “нельзя оплатить”. Это replacement flow.

&nbsp;

3. Для Ирины Белько:

&nbsp;

Факты:

- subscriptions_v2.status=past_due;

- provider state redirecting/expired;

- paid order нет;

- successful payment нет;

- active bePaid provider subscription нет.

&nbsp;

Вывод:

- checkout должен быть allowed;

- already_has_active_subscription возвращать нельзя;

- conflict modal показывать нельзя.

&nbsp;

4. Изменить `_shared/subscription-conflict.ts`:

&nbsp;

- убрать `past_due` из conflict statuses;

- убрать access window / entitlement / paid order из blocking predicate;

- provider blocking states = только `active`;

- pending / redirecting / expired / canceled = ignore для checkout conflict;

- subscription_v2 active/trial без active provider subscription = не blocker.

&nbsp;

5. `create-payment-checkout.ts`

&nbsp;

Если нет active provider subscription по этому продукту:

- decision = no_existing;

- создаётся новая оплата / checkout.

&nbsp;

Не использовать старую pending/redirecting попытку как причину блокировки.

&nbsp;

6. F3-dedup / pending checkout

&nbsp;

Pending checkout можно переиспользовать только если это свежий валидный checkout с TTL.

&nbsp;

Если TTL/валидность не доказаны:

- старую pending/redirecting попытку игнорировать;

- создавать новый checkout.

&nbsp;

7. `public-checkout/index.ts`

&nbsp;

Не добавлять отдельные guards.

После исправления shared guard мусорные попытки не должны возвращать conflict.

&nbsp;

8. `PublicPayPage.tsx` и `PaymentDialog.tsx`

&nbsp;

Conflict modal показывать только при active bePaid provider subscription.

&nbsp;

Текст должен быть не “у вас есть доступ”, а:

&nbsp;

“У вас уже есть активное автосписание по этому продукту. Вы можете оставить текущую подписку или отменить её и создать новую.”

&nbsp;

Raw `already_has_active_subscription` пользователю не показывать.

&nbsp;

9. `ContactDetailSheet.tsx`

&nbsp;

Не добавлять блок “проблемные подписки”.

Не показывать past_due/pending/redirecting/expired unpaid attempts как подписки.

&nbsp;

Показывать только:

- активные оплаченные подписки;

- активные доступы;

- paid сделки.

&nbsp;

10. Dry-run заменить:

&nbsp;

Проверить не paid order / access window, а active provider conflicts:

&nbsp;

- сколько пользователей сейчас блокируются из-за provider_subscriptions.state='active';

- сколько past_due/redirecting/pending сейчас ошибочно блокируются;

- сколько таких мусорных кейсов после патча станет checkout_allowed;

- отдельно Ирина Белько: current_behavior=blocked, new_behavior=checkout_allowed.

&nbsp;

11. Regression tests:

&nbsp;

Добавить:

&nbsp;

- past_due + redirecting + pending order + paid_amount=0 → checkout allowed;

- past_due + expired provider → checkout allowed;

- pending provider subscription → checkout allowed;

- redirecting provider subscription → checkout allowed;

- active entitlement + no active provider subscription → checkout allowed;

- access_end_at > now + no active provider subscription → checkout allowed;

- paid order + active access window + no active provider subscription → checkout allowed;

- provider_subscriptions.state='active' same product same tariff → replacement/conflict flow;

- provider_subscriptions.state='active' same product other tariff → replacement/conflict flow;

- Ирина Белько-like case → checkout allowed.

&nbsp;

12. Убрать из плана пункт “дополнительно требовать paid order”.

&nbsp;

Paid order не нужен для conflict. Он относится к доступу, а не к защите от двойного bePaid-автосписания.

&nbsp;

13. DoD:

&nbsp;

- Ирина Белько может создать новую оплату по публичной ссылке;

- past_due/redirecting/pending/expired попытки не блокируют checkout;

- активный доступ без active bePaid provider subscription не блокирует checkout;

- старый paid order не блокирует checkout;

- active bePaid provider subscription по тому же продукту по-прежнему запускает replacement flow;

- ContactDetailSheet не показывает неоплаченный мусор как подписки;

- raw already_has_active_subscription не виден пользователю;

- нет data repair, нет удаления мусора из БД.

**Коротко**

Правильная формула:

Доступ ≠ bePaid-подписка.

Блокировать новую оплату может только:

активное bePaid-автосписание по тому же продукту

Всё остальное — доступы, старые оплаты, окна доступа, past_due, redirecting, pending — **не должно мешать человеку снова оплатить**.

План:

## 1. Проблема

Ирина Белько не может оплатить публичную ссылку на `Gorbova Club — BUSINESS`. Backend возвращает `already_has_active_subscription`, потому что считает её prior `past_due + redirecting` попытку конфликтом. Реальной оплаченной активной подписки у неё нет. Технический мусор (неоплаченные/незавершённые/expired попытки) не должен блокировать новую оплату и не должен показываться в карточке контакта.

## 2. Бизнес-правило (SoT этого патча)

Conflict (блокировка новой оплаты + conflict-modal) разрешён ТОЛЬКО при реально действующей оплаченной подписке/доступе:

Blocking условие — все три должны быть истинны:

- `subscriptions_v2.status IN ('active','trial')`
- доступ ещё действует: `access_end_at IS NULL OR access_end_at > now()`
- провайдерская связь жива: `provider_subscriptions.state = 'active'` ИЛИ есть paid order по этой подписке (`orders_v2.status='paid'` и `paid_amount > 0`)

НЕ блокирует:

- `status = past_due` без успешной оплаты
- `provider_subscriptions.state IN ('redirecting','pending')` без paid order
- `provider_subscriptions.state IN ('expired','canceled')`
- `orders_v2.status='pending'`, `paid_amount = 0`
- любые незавершённые checkout-сессии

Мусор остаётся в БД как история, но игнорируется бизнес-логикой и не показывается в UI карточки.

## 3. Диагностика (факты)

Ирина Белько:

- profile_id `689ed788-0ec5-4241-9fb4-1f5ba79abb4e`
- user_id `0012a7a4-1420-486c-b95e-e6ba5907ef93`

По `Gorbova Club — BUSINESS`:

- 2 строки `subscriptions_v2.status=past_due`
- provider rows: `redirecting` (sbs_cf0d4dfc4e6a5c2d) и `expired` (sbs_7a3f947b2a3927b5)
- связанные `orders_v2.status=pending`, `paid_amount=0`
- успешной оплаты нет

`audit_logs` подтверждают повторяющийся блок `subscription.reused_existing_public_link` decision `extend_same_tariff` для этой `past_due/pending` пары. Backend (`_shared/create-payment-checkout.ts` → `classifySameProductState`) считает `past_due + provider state in (active,pending)` блокирующим конфликтом. Это и есть корень проблемы.

UI `public-checkout` пробрасывает только `existing_subscription_conflict`, но не `already_has_active_subscription`. После исправления корня это уже не нужно — мусор просто не должен возвращать конфликт.

## 4. Что меняется в коде

### 4.1 `supabase/functions/_shared/subscription-conflict.ts`

Изменить `classifySameProductState` и `checkSubscriptionConflict`:

- `CONFLICTING_STATUSES` → `['active','trial']`. Убрать `past_due`.
- Provider-managed проверка: учитывать ТОЛЬКО `provider_subscriptions.state='active'`. Состояния `pending`, `redirecting`, `expired`, `canceled` не считаются провайдерской связью для целей конфликта.
- Дополнительно требовать наличие хотя бы одного `orders_v2.status='paid'` AND `paid_amount > 0` для пары `user_id + product_id` (или для конкретной `subscription_v2_id` через `meta`/`subscription_v2_id` linkage, по тому что доступно в схеме). Если paid order не найден — это unpaid attempt, не блокирующий.
- Добавить non-blocking метки в логирование: `ignored_unpaid_provider_attempt`, `ignored_expired_provider_attempt`, `ignored_pending_checkout_without_payment`.

`validateReplacementSubscription` не меняется.

### 4.2 `supabase/functions/_shared/create-payment-checkout.ts`

- Логика остаётся: при `decision='no_existing'` создаётся новый order/subscription. Так как guard станет уже, теперь Ирина-подобные кейсы пойдут именно сюда.
- F3-dedup (по `orders_v2` pending + 3д) сохраняется. Это другая защита, не блокирующая новую оплату — она может вернуть тот же pending checkout, что приемлемо.

### 4.3 `supabase/functions/public-checkout/index.ts`

- Не делать дополнительных guard. После сужения shared-guard конфликт уже не будет возвращаться для unpaid attempts.
- Существующий проброс `existing_subscription_conflict` остаётся для случая реальной active+paid подписки.

### 4.4 `supabase/functions/bepaid-create-subscription-checkout/index.ts`

- Зависит от того же shared-guard. Никаких локальных изменений логики.

### 4.5 `src/pages/PublicPayPage.tsx` и `src/components/payment/PaymentDialog.tsx`

- Conflict-modal оставить как есть, он будет показываться только для реальных active+paid.
- НЕ добавлять обработку `already_has_active_subscription`. Этот код больше не должен прилетать для мусорных кейсов. Если он всё же прилетит (реально active+paid same tariff) — оставить текущее поведение `normalizeEdgeFunctionError`/общий error path; конфликт-модал для этого окраса не нужен по новой бизнес-логике (active+paid same tariff = просто валидная активная подписка, новая оплата не нужна, пользователю достаточно нейтрального сообщения «уже есть активная подписка»). Поправить `normalizeEdgeFunctionError` чтобы для `already_has_active_subscription` отдавал понятное русское сообщение.

### 4.6 `src/components/admin/ContactDetailSheet.tsx`

- НЕ добавлять блок «Проблемные подписки».
- Подтвердить, что текущие фильтры уже скрывают мусор:
  - `activeSubscriptions` через `isCurrentValidAccess` пропускает только `active|trial` с валидным `access_end_at` и активным правилом. Мусор `past_due` сюда не попадает — корректно.
  - Блок «Подписки» (provider-managed) использует `healthyProviderSubs` (sv2.status==='active' && access_end_at>now). Мусор не показывается — корректно.
- Дополнительно: убрать показ `pending`-бейджа из `getSubscriptionStatusBadge`-веток, которые могут отрисоваться в финишных списках. Проверить, что `finishedSubscriptions` не показывает unpaid pending checkout-сессии как «подписки». Если показывает — отфильтровать из `finishedSubscriptions` записи, у которых `status='past_due'` И нет ни одного paid order, ИЛИ `status='pending'` без paid order.

Никаких новых блоков, таблиц, RPC, cron.

## 5. Что не будет изменено

- Нет новых таблиц, RPC, edge functions, cron.
- Нет data repair (никаких UPDATE/DELETE мусорных past_due/redirecting/pending записей).
- `subscriptions_v2`, `orders_v2`, `provider_subscriptions` schema не меняется.
- Replacement flow `cancelOldSubscriptionForReplacement` не меняется.
- Webhook `bepaid-webhook` не меняется.

## 6. Dry-run

Перед Execute:

1. Глобально:

```sql
-- сколько past_due без paid
select count(*) from subscriptions_v2 s
where s.status='past_due'
  and not exists (
    select 1 from orders_v2 o
    where o.user_id=s.user_id and o.product_id=s.product_id
      and o.status='paid' and o.paid_amount>0
  );

-- сколько pending/redirecting provider attempts без paid
select ps.state, count(*) from provider_subscriptions ps
left join subscriptions_v2 s on s.id=ps.subscription_v2_id
where ps.state in ('pending','redirecting')
  and not exists (
    select 1 from orders_v2 o
    where o.user_id=ps.user_id and o.product_id=s.product_id
      and o.status='paid' and o.paid_amount>0
  )
group by ps.state;

-- сколько пользователей реально заблокированы текущим guard
select count(distinct s.user_id) from subscriptions_v2 s
join provider_subscriptions ps on ps.subscription_v2_id=s.id
where s.status in ('active','trial','past_due')
  and ps.state in ('active','pending');
```

2. По Ирине: подтвердить, что после нового guard `classifySameProductState` вернёт `no_existing` для пары (user `0012a7a4…`, product `11c9f1b8…`, tariff `7c748940…`).
3. Таблица dry-run для отчёта (user/email, product/tariff, sub_id, sub status, provider state, order status, paid_amount, paid exists, current behavior, new behavior). Минимально включить Ирину Белько и 5 случайных других «мусорных» кейсов.

STOP, если dry-run покажет:

- глобально >50% всех ранее блокирующих кейсов имели paid order (значит сужение guard вредит реальным защитам — пересмотреть критерий paid).
- enum/имена состояний `provider_subscriptions.state` отличаются от ожидаемых.
- В схеме нет надёжной linkage paid order ↔ subscription_v2 (тогда уточнить запрос: использовать `subscription_v2_id` в `orders_v2.meta` или `bepaid_subscription_id`).

## 7. Execute

1. Обновить `_shared/subscription-conflict.ts`: сузить `CONFLICTING_STATUSES`, ужесточить provider check, добавить paid-order проверку, добавить non-blocking логирование.
2. Обновить `_shared/subscription-conflict_test.ts`: добавить регрессии (см. §8).
3. Обновить `normalizeEdgeFunctionError.ts`: добавить fallback для `already_has_active_subscription` → «У вас уже есть активная подписка на этот продукт.»
4. Прогнать существующие deno-тесты shared-guard.
5. Запросить у пользователя публикацию.

Никаких изменений UI карточки контакта не требуется кроме (опционально) фильтра `finishedSubscriptions` от unpaid pending — только если dry-run по UI покажет, что такие строки сейчас рисуются.

## 8. Regression tests (deno test)

В `supabase/functions/_shared/subscription-conflict_test.ts` добавить:

1. `past_due + provider redirecting + pending order + paid_amount=0 + no paid` → `no_existing`.
2. `past_due + provider expired + no paid` → `no_existing`.
3. `provider pending without paid` → `no_existing`.
4. `active + provider active + paid order` → `extend_same_tariff` (или `replace_other_tariff` при другом tariff).
5. `active + paid + no provider row` → behavior существующего «zombie ignore» сохраняется.

## 9. STOP-guards

- Если paid-order linkage в схеме неоднозначна — STOP, уточнить критерий paid (по `subscription_v2_id` в meta, по `bepaid_subscription_id`, или через `provider_subscriptions.meta.order_id`).
- Если dry-run покажет, что после сужения теряется защита active+paid same tariff кейсов — STOP, скорректировать предикат.
- Если в БД enum-значения отличаются — STOP.

## 10. DoD

- Ирина Белько открывает публичную ссылку и создаёт новую оплату без `already_has_active_subscription`.
- Неоплаченные `past_due/redirecting/pending/expired` попытки не блокируют checkout.
- Карточка контакта не показывает мусор как подписки (подтверждено фильтрами).
- Реальная active+paid подписка по-прежнему защищена (тесты §8.4, §8.5).
- Raw `already_has_active_subscription` не показывается пользователю; если backend всё же его вернёт — `normalizeEdgeFunctionError` выдаст русское сообщение.
- Нет новых таблиц/RPC/cron, нет data repair.
- Proof-файл: `.lovable/proofs/public_checkout_unpaid_subscription_attempts_do_not_block_2026_05.md`

## 11. Риски

- Расширение «paid order» предиката неточным join'ом может пропустить реальные оплаченные подписки. Минимизируется тестами §8.4–§8.5 + dry-run.
- Если admin/`bepaid-create-subscription-checkout` использует тот же guard, поведение для админских создаваний тоже станет мягче — это согласуется с бизнес-правилом, явный риск отсутствует.

## 12. Требуется доп. информация

Не требуется. Все факты собраны, схема известна, мусор у Ирины подтверждён.