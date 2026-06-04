# Sub-Discovery: Subscription Pending State Strategy (Phase 3.1 pre-MVP)

Статус: **Discovery, ожидает approve.** Никакой код/миграции не написаны.

## 0. Контекст

В утверждённом плане Phase 3.1 Infinite Subscription MVP канонический write-path требует:

```
pre-create subscriptions_v2(status=pending)
pre-create provider_subscriptions(state=pending, provider_subscription_id=???)
↓
Stripe Checkout (mode=subscription)
↓
customer.subscription.created → ps.provider_subscription_id = sub_*
↓
invoice.paid → активация
```

Feedback пользователя зафиксировал блокер: статус `pending` в `subscriptions_v2.status` отсутствует. Этот документ закрывает блокер без принятия решения о коде.

## 1. Verified Facts (read-only, БД на 2026-06-04)

### 1.1 Enum `subscription_status`
```
active, trial, past_due, canceled, expired, superseded, expired_reentry
```
`pending` отсутствует. Колонка `subscriptions_v2.status` — `subscription_status NOT NULL`.

### 1.2 `provider_subscriptions`
| Колонка | Тип | NOT NULL | Ограничения |
|---|---|---|---|
| `state` | `text` | yes | без enum/check — любое значение допустимо |
| `provider_subscription_id` | `text` | yes | `UNIQUE (provider, provider_subscription_id)` |

**Вывод:** в `provider_subscriptions` `state='pending'` и placeholder `provider_subscription_id='pending:<order_id>'` технически возможны без миграции (уникальность держится в рамках `(provider, provider_subscription_id)`).

### 1.3 `subscriptions_v2` дополнительно
- `billing_type CHECK ('mit' | 'provider_managed')` — `provider_managed` подходит для Stripe.
- Schema contract запрещает новые колонки — только `meta.*`.

## 2. Три варианта (как зафиксировано в feedback)

### Вариант A — добавить `pending` в enum (add-only миграция)
**Что меняем:** `ALTER TYPE subscription_status ADD VALUE 'pending' BEFORE 'active';`

| + | − |
|---|---|
| Семантически честный pre-create; никаких «магических» статусов | Расширение enum, который читают ~50+ мест: фронт-резолверы, broadcast-фильтры, reconcile, RPC `has_active_subscription`, аналитика, CRM, дашборды |
| Соответствует Discovery v1.1 §17 (вариант A) дословно | Любая ветка кода вида `status IN ('active','trial')` неявно отнесёт `pending` к «нет подписки», но это нужно явно протестировать — иначе риск «pending» начнёт считаться active в одном из мест |
| Минимальный код в самой подписочной логике (один новый кейс) | Нужен sweep всех читателей status; нужен дополнительный proof (см. §5) |
| Обратимо: enum значения можно перестать использовать, не удаляя | `DROP VALUE` в Postgres невозможен; «лишнее» значение остаётся навсегда |

### Вариант B — НЕ создавать `subscriptions_v2` до `invoice.paid`
**Что меняем:** pre-create только `orders_v2(pending)` + `provider_subscriptions(state=pending)`. `subscriptions_v2` создаётся в webhook'е `invoice.paid` как первичная запись.

| + | − |
|---|---|
| Без миграции, enum не трогаем | **Прямо противоречит Discovery §17:** «webhook никогда не создаёт subv2 как первичную запись» |
| Меньше кода в create-checkout | Возвращает архитектурный риск, ради которого выбран вариант A в Discovery |
| | CR-3 (потеря связки sub↔order) обостряется: на момент webhook'а нет якоря subv2 |
| | Несовместимо с `provider-linked-extend-priority` (он ищет subv2 через ps) |

**Вердикт:** отклонить. Возвращать риск, который Discovery закрыло, — регресс.

### Вариант C — использовать существующий статус + `meta.pending=true`
**Что меняем:** pre-create `subscriptions_v2(status=<существующий>, meta.lifecycle.pending=true)`.

Подварианты:
- C1 `status='past_due'` — семантически = «была активна, перестала платить». Для нового pre-create это **ложь**; broadcast «должникам» подхватит фантомные записи.
- C2 `status='trial'` — = «активный trial с доступом». UI/RPC покажут доступ ДО оплаты. **Опасно для бизнес-логики.**
- C3 `status='canceled'` + `meta.pending=true` — нет доступа, но семантика «отменена» неверна; reconcile может решить supersede.
- C4 `status='expired'` + `meta.pending=true` — нет доступа, нейтрально для большинства читателей, но `expired_reentry` логика и аналитика по retention начнут видеть фантомы.

| + | − |
|---|---|
| Без миграции | Каждый подвариант имеет неустранимый side-effect в каком-либо читателе |
| | Требует фильтра `AND NOT (meta->>'pending' = 'true')` во ВСЕХ местах чтения — гарантированно где-то забудем |
| | Перегружает существующие статусы лишней семантикой — нарушение SOT |

**Вердикт:** отклонить. Любой подвариант = долговой риск выше, чем разовое расширение enum.

## 3. Рекомендация

**Вариант A** — добавить `pending` в `subscription_status` отдельным mini-plan'ом.

Обоснование:
1. Discovery §17 прямо предписывает pre-create subv2 ДО Stripe.
2. Provider-linked extend priority уже опирается на наличие subv2 на момент webhook'а.
3. Вариант B возвращает архитектурный риск.
4. Вариант C размывает SOT существующих статусов.
5. Add-only enum value безопаснее, чем неявная семантика в meta.

## 4. Что должен включать отдельный schema mini-plan (Phase 3.1.0)

Это не часть текущего Discovery — это контур следующего плана, который пойдёт на approve **до** MVP:

1. **Миграция (add-only):**
   ```sql
   ALTER TYPE public.subscription_status ADD VALUE IF NOT EXISTS 'pending' BEFORE 'active';
   ```
   Без UPDATE существующих строк. Никакого rename/drop.

2. **Sweep всех читателей `subscriptions_v2.status`** (dry-run, read-only):
   - SQL поиск по edge-functions: `rg "subscriptions_v2.*status|status.*subscription"` в `supabase/functions/`.
   - Поиск по фронту: `rg "subscription.*status|status.*active|status.*trial"` в `src/`.
   - Поиск по БД: представления, materialized views, RPC, RLS-предикаты, упоминающие `status`.
   - Поиск по analytics: дашборды, broadcast audience, reconcile-предикаты.

3. **Классификация каждой точки чтения по таблице правил `pending`:**
   | Контекст чтения | Должен трактовать `pending` как |
   |---|---|
   | Доступ (resolver, RPC `has_active_subscription`, RLS) | НЕТ доступа (как `expired`/`canceled`) |
   | Аналитика выручки/MRR | НЕ считать активной подпиской |
   | Broadcast «активным подписчикам» | Исключить |
   | Broadcast «должникам» | Исключить (это не past_due) |
   | Reconcile | Игнорировать pending моложе TTL; pending старше TTL → перевести в `expired` + audit |
   | UI «Мои подписки» | Не показывать (или показывать как «Ожидает оплаты» в отдельной секции — задача UI mini-plan) |
   | Cross-provider conflict guard | Считать «занятым слотом» (блокирует параллельный pre-create) |

4. **TTL/cleanup policy для `pending`:**
   - Hard TTL: `created_at + 24h` → перевод в `expired` (status), `state='expired'` в ps, `meta.lifecycle.timeout_reason='checkout_abandoned'`. Доступ не выдаётся, audit пишется.
   - Sweep — отдельная cron-функция или ветка в `subscriptions-reconcile` (но в MVP reconcile НЕ трогаем — значит отдельная мини-функция `pending-subscriptions-ttl-sweep`, либо отложить TTL до Phase 3.2 и в MVP жить с ручной очисткой).
   - **Решение по TTL — часть mini-plan'а, не этого документа.**

5. **`provider_subscriptions` placeholder:**
   - `provider_subscription_id = 'pending:order:<order_id_uuid>'` — уникально per provider.
   - После `customer.subscription.created` → UPDATE на реальный `sub_xxx`.
   - Если по таймауту так и `pending:*` — sweep переводит в `state='expired'`, placeholder сохраняется для audit.

6. **Proof для mini-plan'а:**
   - Список всех найденных точек чтения и классификация.
   - Подтверждение, что ни одна точка чтения не отнесёт `pending` к «активной/доступной».
   - Подтверждение, что enum-расширение не ломает Supabase types regeneration (типы перегенерируются автоматически).
   - Smoke: insert тестовой строки с status='pending' в test DB → resolver возвращает «нет доступа».

## 5. Параллельные уточнения по feedback'у (не блокеры, но фиксируем здесь)

### 5.1 Имя события — канон `invoice.paid`
В Stripe API существуют ОБА: `invoice.paid` и `invoice.payment_succeeded`. Для Subscriptions они доставляются вместе и описывают одно и то же финансовое событие. Канон для всего Phase 3.1 — `invoice.paid` (как зафиксировано в Discovery §19). `invoice.payment_succeeded` НЕ подписываем в webhook endpoint, чтобы исключить двойную обработку.

### 5.2 `checkout.session.completed` для subscription
Может быть использован **только** для:
- сохранения `checkout_session_id` в `subscriptions_v2.meta.stripe.checkout_session_id`;
- ранней связки `customer_id` (`cus_*`) и `subscription_id` (`sub_*`) с pre-created записью, если они уже доступны в payload.

Активация (status `pending → active`, создание `orders_v2`, вызов `grant-access-for-order`) — **только из `invoice.paid`**. Это правило входит в MVP-план как явный запрет.

### 5.3 Test Clock pre-check
До runtime proof: отдельная мини-проверка через `stripe.test_helpers.test_clocks.create()` + `customer.create({ test_clock })` + `checkout.session.create(...)` — поддерживается ли Test Clock в pipeline'е Checkout Subscriptions на нашем test-аккаунте. Если нет — fallback: создать пилотный Price с интервалом 1 день для прогона renewal в реальном времени.

### 5.4 Duplicate guard расширение (G3 → G3a/b/c)
- G3a: bePaid active blocks Stripe create — already covered.
- G3b: Stripe active blocks bePaid create — требует расширения `subscription-conflict.ts` на provider-agnostic.
- G3c: Stripe active на одном Stripe-аккаунте блокирует Stripe create на другом — релевантно только при multi-account (Phase 5). В MVP — один аккаунт, проверка не нужна; зафиксировать как backlog.
- `canceled`/`superseded`/`expired`/`pending(expired by TTL)` — НЕ блокируют.

### 5.5 bePaid smoke (G10) — переформулировка
Вместо «реальный bePaid recurring renewal» использовать **read-only freeze proof**:
- snapshot count активных bePaid recurring до Stripe-релиза;
- snapshot тот же через 24h после Stripe-релиза;
- expectation: 0 изменений, кроме органических.
- Плюс: проверка свежего органического bePaid webhook'а в логах (read-only).

Принудительный bePaid renewal в рамках Stripe MVP — запрещён.

### 5.6 Frontend — отложен
PaymentDialog branch добавляется **только после** зелёного backend runtime proof. До этого тесты идут через `admin-test`-style direct call к `stripe-create-subscription-checkout`.

### 5.7 Memory update
Запись `stripe-subscription-canonical-write-path` в `mem://index.md` — **только после** approve итогового runtime proof, не в DoD MVP.

## 6. No-Schema-Change Decision

Зафиксировано явно: вариант «обойтись без миграции» (B и C) рассмотрен и отклонён. Schema mini-plan (Phase 3.1.0) обязателен **до** Phase 3.1 MVP execute.

## 7. Обновлённая последовательность Phase 3

| Шаг | Статус | Блокер |
|---|---|---|
| Discovery Phase 3 | ✅ Done | — |
| **Sub-Discovery: Pending State Strategy (этот документ)** | 🟡 Awaiting approve | — |
| Schema mini-plan **Phase 3.1.0** (add `pending` + sweep proof) | ⛔ Not started | требует approve §3 |
| Sub-Discovery: **Price Mapping Validation** | ⛔ Not started | требует approve §3 |
| Phase 3.1 MVP execute | ⛔ Blocked | требует обоих выше |
| Runtime Proof | ⛔ Blocked | требует MVP execute |
| Phase 3.2+ | ⛔ Deferred | требует Runtime Proof |

## 8. Запрошенный approve

Прошу approve по следующим пунктам:
1. **Выбор Варианта A** (add-only расширение enum значением `pending`).
2. **Согласие на отдельный Schema mini-plan Phase 3.1.0** перед Phase 3.1 MVP execute.
3. **Принятие уточнений §5** (канон `invoice.paid`, роль `checkout.session.completed`, Test Clock pre-check, G3 расширение, bePaid read-only freeze, frontend отложен, memory update отложен).
4. **Фиксация порядка §7.**

После approve — пишу два следующих документа параллельно: Schema mini-plan Phase 3.1.0 и Price Mapping Validation. Только после их approve начинается код MVP.
