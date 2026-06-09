# План P0 принят. GO на build.

Ответы по open questions:

## 1. origin для Stripe

Не вводить новое обязательное значение origin.

Если у live Stripe payment 2d40bc7e… сейчас:

text origin IS NULL 

то это допустимо.

Правильная логика для useUnifiedPayments:

- не фильтровать платежи хардкодом provider='bepaid';

- грузить provider IN ('bepaid','stripe');

- не отрезать Stripe из-за origin;

- если используется origin-фильтр, он должен допускать:

text origin IS NULL 

Не писать искусственно stripe_webhook / stripe без отдельной причины.

## 2. Backfill user_id/profile_id

Разрешаю не только один платёж Сергея, а безопасный точечный data-fix для всех Stripe payments, где связь однозначна через orders_v2.

Но строго по dry-run → execute.

### Dry-run

Сначала показать выборку:

sql SELECT   [p.id](http://p.id) AS payment_id,   p.provider,   p.order_id,   p.user_id AS payment_user_id,   p.profile_id AS payment_profile_id,   o.user_id AS order_user_id,   o.profile_id AS order_profile_id,   [o.contact](http://o.contact)_id AS order_contact_id,   p.created_at FROM payments_v2 p JOIN orders_v2 o ON [o.id](http://o.id) = p.order_id WHERE p.provider = 'stripe'   AND p.order_id IS NOT NULL   AND (p.user_id IS NULL OR p.profile_id IS NULL)   AND (o.user_id IS NOT NULL OR o.profile_id IS NOT NULL) ORDER BY p.created_at DESC; 

### Execute

Только если dry-run показывает однозначные строки:

sql UPDATE payments_v2 p SET   user_id = COALESCE(p.user_id, o.user_id),   profile_id = COALESCE(p.profile_id, o.profile_id) FROM orders_v2 o WHERE p.order_id = [o.id](http://o.id)   AND p.provider = 'stripe'   AND p.order_id IS NOT NULL   AND (p.user_id IS NULL OR p.profile_id IS NULL)   AND (o.user_id IS NOT NULL OR o.profile_id IS NOT NULL); 

Если есть contact_id в payments_v2 — аналогично заполнить только через orders_[v2.contact](http://v2.contact)_id, если поле существует.

Никаких массовых backfill без order_id.

## Scope подтверждён

Сейчас делаем только P0:

1. Stripe live payment visibility в /admin/payments.

2. Stripe payment visibility в карточке контакта.

3. payments_v2.user_id/profile_id для Stripe.

4. Stripe receipt не должен вызывать bepaid-get-receipt.

5. Failed bePaid 5b5cb22f остаётся отдельной failed-попыткой и не смешивается со Stripe success.

## Что делаем

### Step 1 — useUnifiedPayments

- убрать .eq("provider", "bepaid");

- разрешить provider IN ('bepaid','stripe');

- сохранить provider-filter all/bepaid/stripe;

- не отрезать Stripe по origin;

- если origin-фильтр нужен, допустить origin IS NULL.

### Step 2 — stripe-webhook

В обеих точках INSERT payments_v2:

- checkout.session.completed;

- payment_intent.succeeded;

копировать из связанного orders_v2:

- user_id;

- profile_id;

- contact_id, если поле есть в payments_v2.

Не трогать:

- webhook signature;

- livemode;

- idempotency;

- grant-access;

- Telegram;

- bePaid.

### Step 3 — safe data-fix

Сначала dry-run.  

Потом execute только для Stripe payments с однозначным order_id.

### Step 4 — ReceiptStatusBadge

Если provider='stripe':

- не вызывать bepaid-get-receipt;

- открывать receipt_url;

- если receipt_url отсутствует — показывать «Чек недоступен».

Если provider='bepaid':

- оставить текущий bePaid flow.

## Proof

Создать/обновить:

text .lovable/proofs/phase_L4_live_one_time_pass_[v1.md](http://v1.md) 

И добавить:

- SQL по provider_events;

- SQL по payments_v2;

- SQL по orders_v2;

- SQL по entitlements;

- dry-run backfill;

- execute result;

- UI screenshot /admin/payments, где виден Stripe 5 BYN;

- UI screenshot карточки контакта → платежи;

- proof, что bePaid failed UID 5b5cb22f… остался failed и не смешан со Stripe;

- proof, что Stripe receipt ведёт на [pay.stripe.com](http://pay.stripe.com), а не [merchant.bepaid.by](http://merchant.bepaid.by).

## Backlog

Создать/обновить:

text .lovable/backlog/live_stripe_post_payment_[followups.md](http://followups.md) 

Туда вынести:

- F2 webinar access rule mismatch;

- F3 Stripe subscription cancel/actions;

- F4 Stripe refund from admin;

- F5 saved cards stale/provider compatibility;

- F6 subscriptions tab rename/unified visibility;

- Deal/payment CRM binding, если после P0 подтвердится отдельный gap.

## DoD P0

P0 = PASS, если:

- live Stripe payment 2d40bc7e… виден в /admin/payments;

- provider badge = Stripe;

- status = succeeded/paid;

- amount = 5.00 BYN;

- receipt открывает Stripe receipt;

- платеж виден в карточке контакта Федорчука;

- payments_v2.user_id/profile_id заполнены;

- future Stripe payments получают user_id/profile_id сразу из webhook;

- failed bePaid 5b5cb22f остаётся отдельной failed-попыткой;

- bePaid flow не сломан;

- L-2/L-4 proof закрыт.

Начинай build.

&nbsp;

&nbsp;

План: P0 — Stripe live payment visibility (узкий scope)

Согласовано: F2/F3/F4/F5 — в backlog, не трогаем. Сейчас закрываем только базовый pipeline live Stripe payment → Payments list → Contact → Deal → Receipt.

## Diagnose (готово)

Сравнил две строки:

**A. Failed bePaid 5BYN на скрине** (UID `5b5cb22f…`, receipt `merchant.bepaid.by`) — это **отдельная** прежняя неуспешная попытка bePaid/saved-card, к Stripe-платежу 09.06 отношения не имеет.

**B. Successful live Stripe 5BYN** — РЕАЛЬНО СУЩЕСТВУЕТ в БД:

- `provider_events`: `checkout.session.completed` 2026-06-09 10:18:58, `livemode=true`, `signature_valid=true`, `processing_status=processed`, `account_code=stripe_poland`.
- `payments_v2.id=2d40bc7e-e69f-4633-88d5-102561e49a54`: `provider='stripe'`, `status='succeeded'`, `amount=5.00 BYN`, `provider_payment_id=pi_3TgMkD6UYJj2vm0G1ZUpRzvH`, `receipt_url=https://pay.stripe.com/receipts/...` (Stripe receipt ✅), `paid_at=2026-06-09 10:19:10`.
- `orders_v2.id=b464dc75-…`: `status=paid`, `user_id`/`profile_id` = `05cd3754-…` (Сергей), `customer_email=7500084@gmail.com`, `final_price=5.00 BYN`.
- `entitlements`: создан, активен до 09.07.26.

**Почему он невидим в `/admin/payments**` — найдена точная причина в коде:

- `src/hooks/useUnifiedPayments.tsx:209` хардкодом `.eq("provider", "bepaid")`.
- Дополнительный фильтр `origin IN ('bepaid','statement_sync',…)` (line 215/218) тоже отсекает Stripe.
- Итог: ни одна Stripe-запись из `payments_v2` не доходит до таблицы платежей — UI показывает только bePaid.

**Почему `payments_v2.user_id` / `profile_id` NULL** — `stripe-webhook/index.ts:251-267` (и аналог в `payment_intent.succeeded`) при INSERT не копирует `user_id`/`profile_id` из `orders_v2`. Связь видна только через `orders:order_id(...)` join, но даже после фикса видимости фильтры "Контакт=Есть" и счётчики по `user_id` будут давать неверную картину.

**Receipt mapping** — на самой строке Stripe-платежа `receipt_url` УЖЕ ведёт на `pay.stripe.com`. То что юзер видит "bePaid receipt" — это failed bePaid 5b5cb22f. После того как Stripe-строка появится в списке, чек на ней откроет Stripe URL. Дополнительно проверю `ReceiptStatusBadge`, чтобы он не звал `bepaid-get-receipt` для Stripe-платежей.

**Deal** — в задаче P0 не подтверждаем создание deal. Если по итогам discovery увидим, что deal не привязан к платежу — фиксируем отдельным PATCH в backlog, не смешиваем с visibility-фиксом.

## Scope (минимальный P0)

### Step 1 — Fix visibility: вернуть Stripe в `/admin/payments`

Файл: `src/hooks/useUnifiedPayments.tsx`.

- Снять хардкод `.eq("provider", "bepaid")` (строка 209).
- Разрешить `provider IN ('bepaid','stripe')`; фильтр `origin` оставить, но добавить `'stripe_webhook'` / `'stripe'` (по факту в payments_v2.origin), либо ослабить до `origin IS NULL OR origin IN (...)` — точное значение проверю по факту из `2d40bc7e`.
- Учесть существующий UI-фильтр «Провайдер» (`PaymentsFilters.tsx` уже умеет `bepaid|stripe|all`) — query должна уважать этот фильтр.

### Step 2 — Fix `payments_v2.user_id` / `profile_id` для Stripe

Файл: `supabase/functions/stripe-webhook/index.ts`.

- Перед INSERT в `payments_v2` (две точки: `checkout.session.completed` ~line 251, `payment_intent.succeeded` ~line 484) подтянуть `user_id`/`profile_id` из `orders_v2` по `order_id_meta` и положить в insert-payload.
- Без других правок (guards, livemode, secret resolution не трогаю).

### Step 3 — Точечный data-fix для уже созданного платежа

Только для `payments_v2.id=2d40bc7e-…`: UPDATE `user_id`, `profile_id` из его `orders_v2`. Никаких массовых backfill.

### Step 4 — Receipt badge: не звать bePaid для Stripe

Файл: `src/components/admin/payments/ReceiptStatusBadge.tsx`.

- В `handleFetchReceipt` сейчас всегда вызывается `bepaid-get-receipt`. Добавить guard: если `provider==='stripe'` — кнопка просто открывает `receipt_url`, без вызова bePaid; если `receipt_url` отсутствует — показать «Чек недоступен» без retry.
- Stripe receipt мы уже сохраняем в `payments_v2.receipt_url` через `_shared/stripe-receipt-materialize.ts`, отдельный fetch на сервере не нужен.

### Step 5 — Verify

- В `/admin/payments` за 09.06.26 видна строка: 5.00 BYN, provider badge = Stripe, status = успешно, контакт = Федорчук, чек = Stripe link.
- В карточке контакта → вкладка «Платежи» строка появилась (потому что `payments_v2.user_id`/`profile_id` теперь заполнены).
- Failed bePaid `5b5cb22f` остаётся failed и не смешивается со Stripe success.
- Proof: `.lovable/proofs/phase_L4_live_one_time_pass_v1.md` со SQL-снимком всех 6 таблиц (provider_events, orders_v2, payments_v2, entitlements, profiles, payment_links) до/после.

## Deferred backlog

Создаю `.lovable/backlog/live_stripe_post_payment_followups.md` со списком и переношу туда:

- **F2** — webinar access (entitlement есть, не открывается у не-админа).
- **F3** — Stripe sub cancel: `SubscriptionActionsSheet` читает `subscription.provider`, которой нет в `subscriptions_v2`; нужен derive из `meta.stripe.subscription_id`.
- **F4** — Stripe refund из админки.
- **F5** — saved cards: фильтр detached, провайдер-бейдж, не показывать bePaid token как Stripe-совместимый.
- **F6** — переименование «Подписки BePaid» → «Подписки» + provider badge.

Каждый — отдельным PATCH после закрытия P0.

## DoD (P0)

1. `useUnifiedPayments` грузит и bePaid, и Stripe.
2. Строка 5 BYN Stripe видна в `/admin/payments` с правильным провайдер-бейджем и Stripe-чеком.
3. Та же строка появляется во вкладке «Платежи» карточки Федорчука.
4. `stripe-webhook` для будущих Stripe-платежей сразу пишет `user_id`/`profile_id`.
5. Receipt-кнопка не зовёт `bepaid-get-receipt` для Stripe-строк.
6. Proof L-2 + L-4 = PASS зафиксирован.
7. bePaid и Stripe не перепутаны: failed bePaid 5b5cb22f остаётся failed.

## Открытые вопросы перед стартом

1. **Stripe в UI-фильтре «Источник» (`origin`)** — какое значение писать для будущих Stripe-платежей: `stripe_webhook`, `stripe`, или оставить NULL? Сейчас у `2d40bc7e` `origin` нужно посмотреть; если NULL — оставляем NULL и UI-фильтр трогать не надо (`origin.is.null` уже в `or`).
2. **Backfill других Stripe-платежей с NULL user_id** — кроме `2d40bc7e` в БД ещё несколько Stripe `payments_v2` (видел 6+ событий за последние дни). Делать ли точечный апдейт сразу всем, или только Сергею для проверки, а остальные — отдельным batch-фиксом?

Не начинаю писать код, жду подтверждения по этим двум вопросам и общего GO на P0.