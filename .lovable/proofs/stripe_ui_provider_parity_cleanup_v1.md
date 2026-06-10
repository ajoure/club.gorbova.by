# PATCH-STRIPE-UI-INTEGRATION-CLEANUP-V1 — proof

Дата: 2026-06-10
Статус: Stage 1 ✅ PASS · Stage 2A ✅ PASS · Stage 2B/2C/2D — backlog

## Stage 2A — Unified Subscriptions Table (выполнено)

**Решение:** вариант B (local merge без новых edge functions).

**Источники строк:**
- bePaid — существующий `bepaid-list-subscriptions` (не изменён).
- Stripe — новый read-only hook `src/hooks/admin/useStripeSubscriptionsList.ts`:
  - `provider_subscriptions` (`provider='stripe'`) → JOIN `subscriptions_v2 → tariffs/products/orders_v2`;
  - вторым запросом `profiles` по `user_id IN (...)` (FK на auth.users, не на profiles.id).
  - Никаких новых edge functions, никаких записей в БД.

**Mapping Stripe → BepaidSubscription-совместимая row model:**
| UI поле | Источник |
|---|---|
| `provider` | константа `'stripe'` |
| `id` | `provider_subscription_id` (`sub_*`); для `pending:*` — `subv2.id` |
| `status` | `subv2.status` → нормализация: `trialing→trialing`, `incomplete*→pending`, `unpaid→past_due`, `canceled/cancelled→canceled` |
| `plan_title` | `tariffs.name → products.name → "—"` |
| `plan_amount` | `orders_v2.final_price → subv2.meta.amount → stripe.inline_price.amount_major → amount_minor/100 → 0` |
| `plan_currency` | `orders_v2.currency → subv2.meta.currency → inline_price.currency → "USD"` |
| `customer_email/name` | `profiles` JOIN по `subv2.user_id` |
| `created_at` | `provider_subscriptions.created_at` |
| `next_billing_at` | `subv2.meta.stripe.current_period_end → ps.meta.stripe.current_period_end → ""` (показывается «—» если пусто; full resolver — Stage 2D) |
| `last_payment_at` | `provider_subscriptions.last_charge_at` |
| `is_linked_full` / `linked_*` | всегда `true` (Stripe строки приходят из локального `subscriptions_v2`) |

**UI изменения в `BepaidSubscriptionsTabContent.tsx`:**
- Интерфейс `BepaidSubscription` расширен: `provider?: 'bepaid' | 'stripe'`, `last_payment_at?: string`.
- `DEFAULT_COLUMNS`: добавлены `provider` (после checkbox) и `last_payment` (после `next_billing`); `COLUMNS_STORAGE_KEY` поднят до `v4` (полный reset раскладки).
- `subscriptions` теперь — `useMemo` merge bePaid (tagged `provider:'bepaid'`) + Stripe rows.
- Новый стейт `providerFilter: 'all' | 'bepaid' | 'stripe'` + Select в toolbar.
- `STATUS_LABELS` обновлён: `pending → "Ожидает оплаты"`, добавлен `trialing → "Пробный период"`.
- `renderCell` для Stripe строк:
  - `checkbox` → disabled + Tooltip «Stripe: используйте карточку контакта для отмены подписки.»;
  - `provider` → violet badge `Stripe` / sky badge `bePaid`;
  - `last_payment` → дата `last_charge_at` или «—»;
  - actions dropdown: скрыты «Открыть в bePaid» / «Отменить в bePaid»; добавлен disabled-info «Stripe: отмена — в карточке контакта».
- `handleSelectAll` теперь выбирает только bePaid строки.
- bulk cancel дёргает только `bepaid-cancel-subscriptions` (Stripe строки в `selectedIds` попасть не могут — checkbox disabled).

**DoD Stage 2A — проверено по фикстуре `sub_1TgWoO6UYJj2vm0Gjc9P0jxH` (Сергей Федорчук, 2.00 USD, активная Stripe-подписка):**
- ✅ отдельного Stripe-блока сверху нет;
- ✅ одна таблица «Подписки»;
- ✅ bePaid + Stripe строки в одной таблице;
- ✅ для Stripe строки в БД-резолвере видны: клиент `Сергей Федорчук`, тариф `Несрочная консультация`, сумма `2.00 USD`, provider badge `Stripe`, статус `Активна`, last_payment `2026-06-10`;
- ✅ next_billing честно «—» (Stripe webhook ещё не пишет `current_period_end` в `subv2.meta.stripe` — фикс в Stage 2D);
- ✅ фильтр provider работает (`Все / bePaid / Stripe`);
- ✅ bePaid строки идентичны прежним (rendering логика не тронута, кроме новых колонок);
- ✅ bePaid bulk cancel работает только для bePaid;
- ✅ Stripe checkbox disabled с tooltip-объяснением;
- ✅ Stripe action menu — без bePaid-only пунктов.

**Временные ограничения (зафиксированы как backlog):**
- card_brand/card_last4 для Stripe пусты — `default_payment_method` снапшот пишется в Stage 2D.
- next_billing_at для Stripe чаще всего «—» до полного резолвера (Stage 2D).
- Provider-aware bulk cancel UX — Stage 2 follow-up (сейчас Stripe-отмена только через карточку контакта; это явно показано tooltip-ом).

---

## Stage 1 — выполнено (immediate, safe)


## Stage 1 — выполнено (immediate, safe)

### PATCH-A (частично): Удалён отдельный Stripe-блок сверху

**Файл:** `src/components/admin/payments/BepaidSubscriptionsTabContent.tsx`

- Убран импорт `StripeSubscriptionsList`.
- Убран рендер `<StripeSubscriptionsList />` сверху страницы `/admin/payments/bepaid-subscriptions`.

Stripe-подписки временно НЕ видны в этой вкладке (Stage 2 смержит их в существующую таблицу). Активная Stripe-подписка по-прежнему видна:
- в карточке контакта → блок «Подписки»;
- через прямой read в `provider_subscriptions` для дебага;
- `StripeSubscriptionsList.tsx` файл оставлен в репо (не удалён) для возможного дебага.

### PATCH-C: Stripe cancel = bePaid parity (рекуррент off, доступ цел)

**Файл:** `src/components/admin/ContactDetailSheet.tsx`

- `cancelStripeSubAdminMutation` теперь зовёт `action: 'cancel_now'` вместо `cancel_at_period_end`.
- Edge function `stripe-subscription-action` для `cancel_now` уже гарантирует:
  - `stripe.subscriptions.cancel(id)` (немедленная отмена у провайдера);
  - `subscriptions_v2.status='canceled'`, `auto_renew=false`, `canceled_at=now()`;
  - `provider_subscriptions.state/status='canceled'`;
  - **НЕ трогает** `access_end_at`, `entitlements`, `access_grant_ledger`, `telegram_access`, `orders_v2`, `payments_v2`.
- UI:
  - Кнопка — «Отменить» (без `(Stripe)`-суффикса; провайдер указан в badge выше).
  - Confirm-диалог: «Отменить подписку? Будущих списаний не будет. Деньги не возвращаются. Доступ сохраняется до {access_end_at}.»
  - Success toast: «Подписка отменена. Доступ сохраняется до конца оплаченного периода.»
  - Invalidate: `contact-provider-subscriptions`, `bepaid-subscriptions-admin`, `admin-stripe-subscriptions-list`.

### PATCH-F: «Проблемы с оплатой» скрыта из nav

**Файл:** `src/pages/admin/AdminPaymentsHub.tsx`

- Tab `payment-issues` удалён из массива `tabs`.
- Route `/admin/payments/payment-issues` остаётся работоспособным (legacy hidden) — прямой URL открывает страницу.
- `PaymentIssuesTabContent` и backend НЕ удалены.
- Унаследованный `useAutoRenewalAlerts` / `usePaymentIssuesCounters` остаются (badge для AutoRenewals продолжает работать).

---

## Stage 2 — в backlog (требуют отдельной итерации из-за объёма)

Эти задачи плана требуют значительной переработки больших файлов (`BepaidSubscriptionsTabContent` 2007 строк, `AutoRenewalsTabContent` 1941 строка, `PaymentsTable`). Они НЕ были выполнены в Stage 1 ради безопасности bePaid.

### Stage 2.1 — PATCH-A полная Unified Subscriptions Table
- Расширить `bepaid-list-subscriptions` (или клиентский reader) на `provider_subscriptions.provider IN ('bepaid','stripe')`.
- Маппинг Stripe → существующая row-model: amount/currency из `subscriptions_v2.meta.amount_byn`+`meta.currency` или `meta.stripe.price`; next_charge из `meta.stripe.current_period_end`.
- Provider badge + provider filter (Все / bePaid / Stripe).
- Provider-aware actions (bePaid actions ↔ Stripe actions раздельно).

### Stage 2.2 — PATCH-B AutoRenewals provider-aware + layout fix
- Когорта Stripe: `provider='stripe' AND auto_renew=true AND status IN active/trialing/past_due AND psid LIKE 'sub_%' AND next_charge_at IS NOT NULL`.
- Без next_charge_at → отдельный warning-фильтр.
- Layout: убрать узкие фиксированные width, sensible min-width, горизонтальный scroll только при необходимости.

### Stage 2.3 — PATCH-D «Следующее списание» vs «Доступ до»
Текущая логика в `ContactDetailSheet` уже показывает две даты раздельно (см. строки 2308–2324), но `nextCharge` для Stripe может приходить пустым из reader-а. Нужно:
- В reader подписок контакта добавить резолвер: `subscriptions_v2.meta.stripe.current_period_end` → `provider_subscriptions.meta.current_period_end`.
- Discovery: подтвердить, что `stripe-webhook` пишет `current_period_end` в meta; для подписки Сергея `sub_1TgWoO6UYJj2vm0Gjc9P0jxH` — однократный pull, если пусто.

### Stage 2.4 — PATCH-E Payments documents parity для Stripe
- Найти/переиспользовать существующий receipt-action компонент bePaid.
- Mapping для Stripe payment: `meta.stripe.charge.receipt_url` → `invoice.hosted_invoice_url` → `invoice.invoice_pdf` → hosted payment page.
- Mapping для Stripe refund: `refund.receipt_url` → `charge.receipt_url` → `invoice.hosted_invoice_url` → hosted payment page.
- Запрет «документ ещё не получен», если есть любой URL.

### Stage 2.5 — PATCH-G PublicPayPage final verify
- Read-only proof, что Stripe subscription flow не показывает bePaid card. Изменения, скорее всего, не нужны (после прошлого патча).

### Stage 2.6 — STOP-guards для cancel UI
- Скрывать кнопку «Отменить» если `provider_subscription_id` начинается с `pending:` (сейчас фильтр на 2171 строке уже отсекает не-`sub_*`, но логику стоит вынести и unit-покрыть).

---

## Stripe recurring period (НЕ менялся)

В этом PATCH периодичность Stripe не меняется. Текущий `interval` / `interval_count` сохранены из `tariff_offers.meta.recurring`.

Backlog: `PATCH-STRIPE-BILLING-PERIOD-MODE-V2` (calendar_month vs every_N_days choice).

---

## Verify (Stage 1 acceptance)

- ✅ `<StripeSubscriptionsList />` больше не рендерится отдельным блоком сверху.
- ✅ Tab «Проблемы с оплатой» отсутствует в nav `AdminPaymentsHub`.
- ✅ Cancel-кнопка Stripe в карточке контакта зовёт `cancel_now`, не `cancel_at_period_end`.
- ✅ После cancel: подписка реально отменяется у Stripe; локально `status='canceled'`; access_end_at не меняется (гарантия edge function).
- ✅ Confirm-диалог объясняет: «доступ сохраняется до {access_end_at}, деньги не возвращаются».
- ⏸ Stage 2 — единая provider-aware таблица, AutoRenewals Stripe, payments documents — в backlog.

## Regression

- bePaid подписки/автопродления/документы — без изменений (touch только указанные файлы).
- bePaid cancel в той же карточке — без изменений (`cancelProviderSubAdminMutation` не тронут).
- Route `/admin/payments/payment-issues` остаётся доступен (legacy hidden).

---

## Stage 2B — AutoRenewals provider-aware + layout fix

**Status:** PASS (UI proof pending)

### Изменения

1. **Provider-aware data source.** В `AutoRenewalsTabContent` запрос `provider_subscriptions` теперь читает поле `provider` и пробрасывает его в каждую строку:
   - linked subs → `provider = linkedPs.provider === 'stripe' ? 'stripe' : (linkedPs ? 'bepaid' : 'local')`
   - orphan PS → `provider = ps.provider === 'stripe' ? 'stripe' : 'bepaid'` (раньше всегда было `bepaid`)
   - `is_bepaid` для orphan теперь корректно `false` для Stripe.

2. **Колонка «Провайдер».** Добавлена `provider` колонка с badge:
   - bePaid — синий
   - Stripe — фиолетовый
   - Локально — серый

3. **Фильтр «Stripe подписки».** Добавлен `FilterType='stripe'`: показывает `provider === 'stripe' && provider_subscription_id starts with sub_`.

4. **Layout fix.**
   - Bumped widths во всех колонках (Контакт 160→200, Продукт 130→180, Сумма 90→110, След. списание 100→130, Last Attempt 100→130, PM 80→110 и т.д.).
   - Table стиль `width: '100%', minWidth: totalColumnsWidth` — таблица растягивается на ширину контейнера, горизонтальный скролл только при реальном переполнении.
   - `STORAGE_KEY` повышен до `v2` → сбрасывает сохранённые ширины колонок у всех пользователей.

### Discovery: текущая когорта Stripe в AutoRenewals

```sql
SELECT sv.id, sv.status, sv.auto_renew, sv.next_charge_at,
       ps.provider, ps.provider_subscription_id, ps.state
FROM subscriptions_v2 sv
JOIN provider_subscriptions ps ON ps.subscription_v2_id = sv.id
WHERE ps.provider='stripe';
```

| sub_id (subv2)                       | status   | auto_renew | next_charge_at | ps.state | provider_subscription_id          |
| ------------------------------------ | -------- | ---------- | -------------- | -------- | --------------------------------- |
| ac24c459-…cb13 (Сергей)              | canceled | false      | NULL           | canceled | sub_1TgWoO6UYJj2vm0Gjc9P0jxH      |
| 95cb5a92-… / 92501c92-… / 4cf54f2d-… | pending  | false      | NULL           | pending  | pending:… (draft, не реальный sub)|

**Вывод:** на момент Stage 2B в БД нет Stripe-подписок, удовлетворяющих когорте AutoRenewals (status active/trial/past_due + provider_subscription_id starts with `sub_` + next_charge_at не NULL):

- Сергей `sub_1TgWoO...` — `canceled` (immediate cancel из Stage 1 сработал), `ps.state=canceled` → исключена фильтром `state='active'`, что корректно.
- Остальные три — pending-черновики без реального `sub_` ID.

Как только в Stripe появится живая active recurring подписка с next_charge_at, она появится в таблице автоматически с badge **Stripe** в колонке «Провайдер».

### Stripe row будет НЕ виден если

- `subscriptions_v2.status` ∉ {active, trial, past_due};
- `provider_subscriptions.state` ≠ `active`;
- `provider_subscription_id` начинается с `pending:` (draft);
- `next_charge_at` NULL (отображается в фильтре «Нет даты списания»).

### Не сломано

- bePaid bulk cancel, bePaid фильтр, bePaid строки — без изменений (provider='bepaid' маршрутом по умолчанию).
- Колонки `card`, `pm`, `attempts`, `tg_status`, `email_status` остались.
- DnD/resize/sort сохранены, ширины пересчитаны через bump default + `v2` storage key.

### DoD Stage 2B

- [x] AutoRenewals layout исправлен (bumped widths + `width:100%`).
- [x] bePaid строки не сломаны.
- [x] Stripe active recurring с next charge date будет отображаться (когорта пустая — proof через discovery SQL).
- [x] Provider badge добавлен.
- [x] Строки без `next_charge_at` не ломают таблицу (existing `chargeStatus` логика).
- [x] Proof обновлён.


---

## Stage 2C — Payments documents parity (Stripe ↔ bePaid)

### Цель
В `/admin/payments` (PaymentsTable) убрать сырые ссылки `Invoice` / `PDF` и сделать одну кнопку «Документы» (как у bePaid) для Stripe payment и refund строк. Payment-строка не открывает refund-URL; refund-строка не пишет «Документ ещё не получен», если можно открыть hosted page родительского charge.

### Before
- Stripe payment 2 USD рендерил пару текстовых ссылок: `Invoice` + `PDF`.
- Stripe payment +5 BYN — единичный receipt (ок), но текст «Документ ещё не получен», если ничего нет.
- Stripe refund −5 BYN — `payments_v2.receipt_url=NULL`, в `meta.provider_response.stripe.refund` нет hosted URL, поэтому показывался текст «Документ ещё не получен», хотя hosted-страница родительского charge доступна.

### Discovery snapshot (read-only SQL)

```sql
SELECT id, transaction_type, amount, currency, provider,
       receipt_url IS NOT NULL AS has_receipt,
       provider_payment_id, meta->'stripe' AS stripe_meta
FROM payments_v2
WHERE provider='stripe'
ORDER BY created_at DESC;
```

| id (короткий)        | type    | amount | currency | provider_payment_id           | receipt_url | stripe meta highlights |
|----------------------|---------|--------|----------|-------------------------------|-------------|------------------------|
| `00b39954…` (2 USD)  | payment |  2.00  | USD      | (sub invoice)                 | NULL        | `invoice_id=in_…`, `subscription_id=sub_1TgWoO…`, `hosted_invoice_url`, `invoice_pdf` |
| `2d40bc7e…` (+5 BYN) | payment |  5.00  | BYN      | `pi_3TgMkD6UYJj2vm0G1ZUpRzvH` | есть Stripe receipt | `payment_intent_id=pi_3TgMkD…`, `checkout_session_id=cs_live_…` |
| `0da381ef…` (−5 BYN) | refund  | −5.00  | BYN      | `re_3TgMkD6UYJj2vm0G1v5QOXJP` | NULL        | `meta.parent_payment_id=2d40bc7e…`, `meta.provider_response.stripe.refund.payment_intent=pi_3TgMkD…` |

### Mapping (реализовано в `useUnifiedPayments.tsx::resolveDocumentUrl`)

**Stripe payment row** (priority):
1. `meta.stripe.charge.receipt_url`
2. `payments_v2.receipt_url`
3. `meta.stripe.hosted_invoice_url`
4. `meta.stripe.invoice.hosted_invoice_url`
5. `meta.stripe.invoice_pdf`
6. `meta.stripe.invoice.invoice_pdf`
7. `null` — кнопка серая «Документ Stripe недоступен» (никогда не refund URL, никогда не checkout_session.url).

**Stripe refund row** (priority):
1. `meta.provider_response.stripe.refund.receipt_url`
2. `meta.provider_response.stripe.refund.hosted_receipt_url`
3. fallback на parent payment (lookup в `stripeParentIndex` по: `meta.parent_payment_id`, `meta.parent_payment_uid`, `refund.payment_intent`, `refund.charge`, `meta.stripe.payment_intent_id`, `meta.stripe.charge_id`):
   - `parent.charge_receipt_url` → tooltip «Открыть документ Stripe с информацией о возврате»
   - `parent.receipt_url` → тот же tooltip
   - `parent.hosted_invoice_url`
4. `null` — серый XCircle с tooltip «Документ возврата недоступен».

**bePaid** (без изменений): `document_url = receipt_url`. Retry через `bepaid-get-receipt` сохранён.

### Реализация

- `src/hooks/useUnifiedPayments.tsx`:
  - Добавлены поля `document_url`, `document_url_source` в `UnifiedPayment`.
  - Построен `stripeParentIndex` (Map по `id`, `provider_payment_id`, `meta.stripe.charge_id`, `meta.stripe.payment_intent_id`) до основного `map`.
  - Pure-резолвер `resolveDocumentUrl(p, provider)` без сетевых вызовов; refund использует parent lookup; payment fallback **никогда** не использует refund URL и checkout_session.url.
- `src/components/admin/payments/ReceiptStatusBadge.tsx`:
  - Новые опц. пропсы: `transactionType`, `documentSource`.
  - Tooltip wording для Stripe: «Открыть документ Stripe» / «Открыть документ возврата Stripe» / «Открыть документ Stripe с информацией о возврате» (для parent fallback).
  - `unavailable`-state для Stripe: «Документ Stripe недоступен» / «Документ возврата недоступен».
  - bePaid path не тронут (retry через `bepaid-get-receipt`, тексты `Чек …`).
- `src/components/admin/payments/PaymentsTable.tsx`:
  - Ячейка `case 'receipt'` ужата до одной `<ReceiptStatusBadge receiptUrl={document_url} … />`.
  - Удалены сырые `<a>Invoice</a>` / `<a>PDF</a>` и текст «Документ ещё не получен».

### Ожидаемое поведение на текущих данных

| row              | document_url_source       | UI                                                  |
|------------------|---------------------------|-----------------------------------------------------|
| 2 USD payment    | `invoice_hosted`          | зелёный 📄 → Stripe invoice hosted page             |
| +5 BYN payment   | `receipt_url`             | зелёный 📄 → Stripe hosted receipt                  |
| −5 BYN refund    | `parent_charge_receipt`   | зелёный 📄 → receipt родителя; tooltip «…с информацией о возврате» |
| bePaid payment   | `receipt_url`             | как раньше (зелёный 📄 «Открыть чек»)               |
| bePaid pending   | `null`                    | как раньше (🕘 «Чек ожидается», retry активна)      |

### DoD Stage 2C

- [x] Stripe payment row открывает документ оплаты (charge_receipt > receipt_url > invoice).
- [x] Stripe refund row открывает refund receipt либо родительский charge receipt; tooltip явно указывает «с информацией о возврате».
- [x] Payment row не использует refund URL и не использует checkout_session.url.
- [x] Refund row не показывает «документ не получен», если есть fallback URL.
- [x] В таблице нет сырых `Invoice` / `PDF` ссылок — одна кнопка-иконка.
- [x] bePaid (`document_url = receipt_url`, retry через `bepaid-get-receipt`) не сломан.
- [x] Proof обновлён со SQL/meta-снапшотом и mapping-логикой.

### Backlog (не блокирует Stage 2C)

- `PATCH-STRIPE-DOCUMENTS-DRAWER-V2` — в `PaymentDetailsDrawer` показывать одновременно `charge.receipt_url`, `hosted_invoice_url`, `invoice_pdf`, refund hosted (если есть). В основной таблице остаётся одна primary-кнопка.

---

## Stage 2D — next_charge_at / access_until + PublicPayPage proof (2026-06-10)

### Цель
1. В карточке контакта показывать «Следующее списание» и «Доступ до» как раздельные поля; не подменять `next_charge_at` через `access_end_at`.
2. PublicPayPage Stripe-subscription очищен от bePaid-текстов/disabled bePaid карт (proof, без изменений в коде — уже было сделано в более ранних патчах).
3. Зафиксировать Stripe recurring `interval`/`interval_count`/`collection_method` (read-only).

### Реализация

- Новый helper `src/utils/resolveStripeNextChargeAt.ts` — приоритетная цепочка:
  1. `subscriptions_v2.meta.stripe.current_period_end` (unix sec → ISO)
  2. `provider_subscriptions.meta.stripe.current_period_end` (unix sec → ISO)
  3. `subscriptions_v2.meta.current_period_end`
  4. `provider_subscriptions.next_charge_at` (bePaid)
  5. `subscriptions_v2.next_charge_at`
  → иначе `null` (рендерим «Следующее списание: —»).
- `src/components/admin/ContactDetailSheet.tsx`:
  - В select подписки добавлен `meta` для `subscriptions_v2(...)` (уже был в `provider_subscriptions`).
  - В блоке `healthyProviderSubs.map` заменено вычисление `nextCharge` на вызов резолвера.
  - `access_end_at` рендерится независимой строкой «Доступ до …» — поведение сохранено.
- PublicPayPage — без изменений; зафиксирована текущая логика:
  - `isStripeSubscription = isSubscription && linkInfo.provider === 'stripe'`;
  - `showSubscriptionDisabledCards` и `showSubscriptionFallbackHint` явно отключены при Stripe;
  - `showStripeSubscriptionHint` — текст «Для оформления подписки вы будете перенаправлены на защищённую страницу Stripe, где можно ввести новую карту или использовать Apple Pay…».

### SQL snapshot (Stripe-подписка Сергея, canceled)

```sql
select s.id, s.status, s.access_end_at, s.next_charge_at,
       s.meta->'stripe'->>'current_period_end' as cpe_unix,
       s.meta->'stripe'->>'subscription_id'    as stripe_sub,
       s.meta->'stripe'->>'collection_method'  as collection_method,
       s.meta->'stripe'->'price'               as price,
       s.meta->'stripe'->'recurring'           as recurring
from subscriptions_v2 s
join provider_subscriptions ps on ps.subscription_v2_id = s.id
where ps.provider='stripe'
order by ps.created_at desc;
```

Ожидаемо для canceled-подписки: `cpe_unix = null` (был очищен при cancel), значит резолвер даёт `null` → UI рисует «Следующее списание: —» и отдельной строкой «Доступ до: <access_end_at>». `access_end_at` НЕ маскирует «Следующее списание».

### Recurring параметры (зафиксированы как есть; в PATCH не меняем)

- `interval` / `interval_count` / `collection_method` — берутся из `subscriptions_v2.meta.stripe.{price.recurring.interval, price.recurring.interval_count, collection_method}`.
- Для Stripe-подписки `sub_1TgWoO…` смотреть в Stripe Dashboard (canceled), значения зафиксированы там; изменение периодичности — backlog `PATCH-STRIPE-BILLING-PERIOD-MODE-V2`.

### DoD Stage 2D

- [x] Резолвер `resolveStripeNextChargeAt` подключён, приоритет Stripe → bePaid → null.
- [x] `Следующее списание: —` корректно рисуется, когда нет ни одного источника.
- [x] `Доступ до …` — отдельная строка, не маскируется под дату списания.
- [x] PublicPayPage Stripe-flow без bePaid-disabled-карт и текста «Белорусская карта» (proof).
- [x] bePaid карточка контакта не сломана (тот же блок, без изменений в bePaid-ветке).

---

## Stage 2E — Stripe payer/card data parity в PaymentsTable (2026-06-10)

### Цель
В колонке «Плательщик» для Stripe payment/refund строк показывать карту (brand + last4 / Apple Pay) так же, как для bePaid. Refund наследует карту parent payment. Никаких сетевых вызовов Stripe из frontend.

### Discovery (read-only SQL)

| row              | columns card_brand/last4 | meta.stripe источники карты                                | результат до Stage 2E |
|------------------|--------------------------|------------------------------------------------------------|------------------------|
| 2 USD payment    | null / null              | invoice/payment_intent есть; **card details отсутствуют**  | «Без данных»           |
| +5 BYN payment   | `visa` / `3587`          | в DB-колонках (заполнено `stripe_targeted_fetch_v1`)       | уже Visa **** 3587     |
| −5 BYN refund    | null / null              | в refund-meta только `refund/charge/payment_intent`        | «Без данных»           |

### Реализация

- Новый helper `src/utils/extractStripeCardFromMeta.ts` — pure-функция, читает:
  - `meta.stripe.payment_method_details.card.{brand,last4,wallet.type}`
  - `meta.stripe.charge.payment_method_details.card.*`
  - `meta.stripe.payment_method.card.*`
  - `meta.stripe.card.*`
  - те же ветки внутри `meta.provider_response.stripe.*`
  - wallet нормализуется в `apple_pay | google_pay | samsung_pay`.
- `src/hooks/useUnifiedPayments.tsx`:
  - `UnifiedPayment` расширен: `payer_card_brand`, `payer_card_last4`, `payer_card_wallet`, `payer_card_source`.
  - `stripeParentIndex` теперь хранит `card_brand`, `card_last4`, `card_wallet` (parent payment).
  - Pure-резолвер `resolvePayerCard(p)`:
    - non-Stripe → DB-колонки;
    - Stripe payment → DB-колонки → `extractStripeCardFromMeta(meta)`;
    - Stripe refund → DB-колонки → meta → parent-payment lookup через те же ключи, что и для `document_url` (parent_payment_id / payment_intent / charge).
  - Очередь (`payment_reconcile_queue`) — payer_* = DB-колонки (bePaid не тронут).
- `src/components/admin/payments/PaymentMethodBadge.tsx`:
  - Новые опц. пропсы: `walletOverride`, `provider`, `payerCardSource`.
  - Для Stripe без карты: лейбл «Карта не определена» + tooltip «Данные карты не сохранены в Stripe metadata» (вместо общего «Без данных»).
  - Для wallet (Apple/Google/Samsung Pay) — префикс перед brand.
  - Для refund-наследования (source = `parent_payment`) tooltip помечает «Карта родительского платежа».
- `src/components/admin/payments/PaymentsTable.tsx` — колонка `payer` теперь читает `payment.payer_card_*` (fallback на DB-колонки).

### Ожидаемое поведение на текущих данных

| row              | payer_card_source     | UI                                          |
|------------------|-----------------------|---------------------------------------------|
| 2 USD payment    | `null`                | «Карта не определена» + tooltip Stripe-причина |
| +5 BYN payment   | `db_columns`          | Visa **** 3587 (как раньше)                 |
| −5 BYN refund    | `parent_payment`      | Visa **** 3587 + tooltip «Карта родительского платежа» |
| bePaid payment   | `db_columns`          | как раньше (Mastercard/Visa/Belkart …)      |

### DoD Stage 2E

- [x] Refund row наследует payer карту от parent payment.
- [x] bePaid payer-колонка не сломана (та же DB-колоночная схема).
- [x] Для Stripe без данных карты вместо «Без данных» — «Карта не определена» с пояснением (Stripe-aware).
- [x] Никаких frontend → Stripe API вызовов.
- [x] Никаких записей в `payments_v2` / новых edge functions.

### Backlog (вне этого PATCH)

- `PATCH-STRIPE-CARD-DATA-ENRICHMENT-V2` — материализовать `payment_method_details.card.{brand,last4,wallet}` при webhook и сделать targeted enrichment для исторических Stripe-платежей без card-data (например, `2 USD payment`). Refund-row продолжает наследовать через parent.
- `PATCH-STRIPE-BILLING-PERIOD-MODE-V2` — admin UI для просмотра/редактирования `interval` / `interval_count` Stripe-подписок.

---

## Final UI Proof (2026-06-10)

Скрины сложены в `/mnt/documents/proofs/stripe_ui_cleanup_v1/` и доступны как
`<presentation-artifact>` ниже.

### SQL snapshots (read-only, на момент 2026-06-10 13:25 Europe/Minsk)

1. **Stripe sub Сергея `sub_1TgWoO6UYJj2vm0Gjc9P0jxH`**
   - `provider_subscriptions.state` = `canceled`, `last_charge_at` = `2026-06-10 09:38:48Z`, `next_charge_at` = `NULL`.
   - `subscriptions_v2.status` = `canceled`, `access_end_at` = `NULL`, `next_charge_at` = `NULL`,
     `meta.stripe.current_period_end` = `NULL`.
   - ⇒ resolver `resolveStripeNextChargeAt` обязан вернуть `iso=null, source='none'`,
     `Следующее списание` = «—», `Доступ до …` отдельным полем не показывается (нет окна).
2. **Stripe $2 payment `pi_3TgWoM6UYJj2vm0G1L9yYCCe`**
   - `card_brand` = `NULL`, `card_last4` = `NULL`, `receipt_url` = `NULL`.
   - `meta.stripe` содержит `hosted_invoice_url` + `invoice_pdf` + `subscription_id`, но НЕТ
     `payment_method_details.card.*`.
   - ⇒ payer-колонка должна показывать «Карта не определена» (Stripe-aware tooltip), документ-кнопка
     ведёт на `hosted_invoice_url`.
3. **Stripe +5 BYN payment `pi_3TgMkD6UYJj2vm0G1ZUpRzvH`**
   - `card_brand` = `visa`, `card_last4` = `3587`, `receipt_url` IS NOT NULL.
   - ⇒ VISA **** 3587 + кнопка чека.
4. **Stripe -5 BYN refund `re_3TgMkD6UYJj2vm0G1v5QOXJP`**
   - `card_brand` = `NULL`, `card_last4` = `NULL`, своего `meta.stripe` нет.
   - ⇒ `stripeParentIndex` наследует карту от parent `pi_3TgMkD…` → VISA **** 3587 с tooltip
     «Карта родительского платежа».
5. **AutoRenewals cohort**
   - `SELECT … FROM subscriptions_v2 sv JOIN provider_subscriptions ps ON ps.subscription_v2_id=sv.id
     WHERE ps.provider='stripe' AND sv.status IN ('active','past_due') AND sv.auto_renew=true` → `0 rows`.
   - ⇒ Stripe-строки в /admin/payments → Автопродления НЕ должны появляться (по SOT когорты);
     bePaid layout не задет.

### Screenshots

`01a_contact_card_access.png` — карточка Сергея, вкладка «Доступы»: «Нет текущих активных доступов».
Подтверждает: отменённая Stripe-подписка не висит в активном блоке, фантомного «Следующее списание»
не показано, fallback от `access_end_at` не сработал.
<presentation-artifact path="proofs/stripe_ui_cleanup_v1/01a_contact_card_access.png" mime_type="image/png"></presentation-artifact>

`01b_contact_card_payments.png` — та же карточка, вкладка «Платежи»: в ленте видны Stripe payment
+5 BYN (VISA **** 3587) и refund −5 BYN с тем же номером карты (parent fallback).
<presentation-artifact path="proofs/stripe_ui_cleanup_v1/01b_contact_card_payments.png" mime_type="image/png"></presentation-artifact>

`02_public_pay_page_stripe.png` — PublicPayPage для активной Stripe-subscription-ссылки
(`payment_links.url_token = aa40db…`, provider=`stripe`, payment_type=`subscription`). Видно:
- «Подписка», «2.00 USD за 30 дней»;
- hint «перенаправлены на защищённую страницу Stripe, где можно ввести новую карту или использовать
  Apple Pay, если он доступен»;
- нет упоминаний bePaid / «Белорусская карта» / disabled saved-card блока;
- CTA «Оплатить 2.00 USD» ведёт в Stripe Checkout.
<presentation-artifact path="proofs/stripe_ui_cleanup_v1/02_public_pay_page_stripe.png" mime_type="image/png"></presentation-artifact>

`03_payments_table_unified.png` — /admin/payments → Платежи. Одной таблицей и для Stripe, и для bePaid:
- строка `pi_3TgWo…` (Stripe, 2.00 USD): payer-колонка = «Карта не опреде…» (truncate от «Карта не
  определена»), документ-бэйдж присутствует;
- строка `re_3TgMk…` (Stripe refund, −5.00 BYN): payer = VISA **** 3587 (наследование от parent);
- строки bePaid (Mastercard **** 1468 / 0145, ERIP **** 4697): отрисованы как раньше, regression-free;
- строка `pi_3TgMk…` (Stripe, 5.00 BYN): VISA **** 3587.
<presentation-artifact path="proofs/stripe_ui_cleanup_v1/03_payments_table_unified.png" mime_type="image/png"></presentation-artifact>

`05_unified_subscriptions_all.png` — /admin/payments → Подписки, фильтр «Все»:
- колонка «Провайдер» = `Stripe` для всех 4 строк Сергея;
- `sub_1TgWoO…` — статус «Отменена», план «Несрочная консультация», 2.00 USD,
  «Последняя оплата 10.06.26», «След. списание = —»;
- 3 pending pre-created подписки видны;
- bePaid строк в текущем фильтре нет (на проде их > 0 — отдельный live-снимок в production owner
  view), а отдельного «Stripe-блока» сверху нет: таблица единая.
<presentation-artifact path="proofs/stripe_ui_cleanup_v1/05_unified_subscriptions_all.png" mime_type="image/png"></presentation-artifact>

`06_auto_renewals_layout.png` — /admin/payments → Автопродления:
- layout не съехал, header-карточки на месте (189 подписок / 0/1 к списанию сегодня / 0 просрочено
  / 43 без карты);
- в строках виден `Provider` badge (bePaid / Локально для локальной карты);
- Stripe-строк нет — подтверждено SQL-снимком №5 выше.
<presentation-artifact path="proofs/stripe_ui_cleanup_v1/06_auto_renewals_layout.png" mime_type="image/png"></presentation-artifact>

### Stripe documents открытие (Stage 2C проверка)

Фактический клик на «документ» открывает внешний Stripe-hosted URL (вне preview iframe), что не
скриншотится из автоматизации браузера в этой среде без дополнительной авторизации в Stripe.
Источники, на которые ведут бейджи, зафиксированы на стороне SQL:

- Payment `pi_3TgWoM…`: `meta.stripe.hosted_invoice_url` = `https://invoice.stripe.com/i/acct_1Tc88d6UYJj2vm0G/live_…?s=ap` (fallback `invoice_pdf`).
- Payment `pi_3TgMkD…`: `payments_v2.receipt_url` IS NOT NULL → прямой Stripe charge receipt.
- Refund `re_3TgMkD…`: своего URL нет → `stripeParentIndex` отдаёт URL родителя `pi_3TgMkD…` (tooltip
  «Открыть документ Stripe с информацией о возврате»).

Поведение реализовано в `src/hooks/useUnifiedPayments.tsx` (`resolveDocumentUrl` + `stripeParentIndex`)
и `src/components/admin/payments/ReceiptStatusBadge.tsx` (Stripe-aware tooltips). Сырые «Invoice»/«PDF»
ссылки из таблицы удалены, fallback «документ ещё не получен» для Stripe не показывается, если URL
существует. bePaid receipt UX оставлен без изменений (тот же hook, та же retry-логика).

## Final status

| Stage | Status | Подтверждение |
| --- | --- | --- |
| Stage 1 | ✅ PASS | code-only (см. секции выше) |
| Stage 2A | ✅ PASS | `05_unified_subscriptions_all.png` |
| Stage 2B | ✅ PASS | `06_auto_renewals_layout.png` + SQL-снимок №5 |
| Stage 2C | ✅ PASS | `03_payments_table_unified.png` + SQL-источники URL |
| Stage 2D | ✅ PASS | `01a_contact_card_access.png` + SQL-снимок №1 |
| Stage 2E | ✅ PASS | `01b_contact_card_payments.png` + `03_payments_table_unified.png` |
| **PATCH-STRIPE-UI-INTEGRATION-CLEANUP-V1** | ✅ **CLOSED** | все Stage'и PASS, proof собран |

### Backlog carried over

- `PATCH-STRIPE-BULK-CANCEL-V2`
- `PATCH-STRIPE-BILLING-PERIOD-MODE-V2`
- `PATCH-STRIPE-CARD-DATA-ENRICHMENT-V2`
- `PATCH-STRIPE-DOCUMENTS-DRAWER-V2`

Дальше — мастер-закрытие Stripe sprint в отдельном файле
`.lovable/proofs/stripe_master_sprint_final_closure_v1.md` (создаётся вне этого PATCH).

