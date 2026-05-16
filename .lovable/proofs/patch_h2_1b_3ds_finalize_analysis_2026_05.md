# PATCH H2.1b — 3DS finalize canonical writer analysis (read-only)

Дата: 2026-05-16
Режим: **read-only / code-discovery**.
Стейт: **0 production DML, 0 migrations, 0 правок в `bepaid-webhook/index.ts`, 0 правок в `grant-access-for-order/index.ts`**.
Флаг `BEPAID_REBILL_MATERIALIZATION` не изменён (`dry_run`). `mode=on` не включался.

> **Блокер mode=on:** даже после закрытия H2.1b analysis включать `BEPAID_REBILL_MATERIALIZATION=on` запрещено. mode=on допустим только после H2.1b execution **и** H2.1c (legacy one-time path) + H4 preconditions.

---

## 1. Идентификация ветки

Файл: `supabase/functions/bepaid-webhook/index.ts`.
Условные границы 3DS finalize блока: **строки ≈4500–4951** (внутри обработчика successful-транзакции `WEBHOOK-TRANSACTION`, после того как `payment_v2` уже создан/найден и привязан к `orders_v2`).

Триггеры входа в ветку:
- bePaid notification со `status='successful'` (включая 3DS callback'и);
- найден `paymentV2` с `order_id`;
- успешно загружены `orderV2`, `productV2` (productV2 ветка), `tariff`;
- условие входа: `productV2 && tariff` (4516);
- внутренний guard: `orderV2.status === 'paid'` (4520–4536) — иначе только audit `subscription_skipped_not_paid` и no-op для access (но GC/Telegram продолжают);
- non-trial subscription discovery дополнительно требует `!orderV2.is_trial && orderV2.status === 'paid'` (4541).

Эта ветка отвечает за «первичный bootstrap/extend подписки по только что оплаченному заказу», включая trial-paid и обычные one-shot/recurring покупки через checkout (в том числе после 3DS).

---

## 2. Order / Payment discovery

Источник `orderV2` и `paymentV2` — общий для всего `WEBHOOK-TRANSACTION` обработчика (выше по файлу). 3DS finalize ветка их **только потребляет**, не создаёт.

Читаются поля:
- `orderV2.id`, `order_number`, `status`, `is_trial`, `trial_end_at`, `created_at`, `user_id`, `product_id`, `tariff_id`, `meta`, `customer_email`, `customer_phone`;
- `paymentV2.id`, `amount`, `currency`, `order_id`, `bepaid_uid`;
- `productV2` (по `orderV2.product_id`), `tariff` (по `orderV2.tariff_id`), `offer` (для `meta.recurring.is_recurring` и `payment_method='internal_installment'`).

---

## 3. Payment method / card token

3DS finalize **сам токен не создаёт** и не записывает `bepaid_card_token` в payment_methods.
Tokenization обрабатывается раньше в `WEBHOOK-TRANSACTION` / `LINK-ORDER` ветках и в `bepaid-webhook` subscription branch (по `additional_data.contract`/`smart_routing_verifier`).

В 3DS finalize ветке могут читаться `userPaymentMethod` для последующей привязки к `subscriptions_v2.payment_method_id`, но запись токенов идёт по другим путям. Эту часть **можно оставить в webhook** как чистый provider-sync (см. §6) — она не пересекается с access grant.

---

## 4. Subscription bootstrap логика (специфичная для 3DS finalize)

Перечень шагов, фактически реализованных сегодня внутри 3DS finalize (со строками):

1. **existingSub discovery** (4541–4551): `subscriptions_v2 WHERE user_id, product_id, status IN ('active','trial','past_due'), canceled_at IS NULL ORDER BY access_end_at DESC`.
2. **Multi-candidate STOP-guard** (4554–4575): если >1 кандидата — audit `bepaid.webhook.subscription_multi_candidate_review`, выбирается future-кандидат или последний.
3. **past_due reattach** (4578–4607): если найден `past_due` без `order_id` — `update orders_v2.order_id = current`, `status='active'`, audit `subscription_order_attached`.
4. **Proration при смене тарифа** (4612–4659): `bonusDays = floor((oldPaidAmount/oldTariff.access_days × remainingDays) / newDailyRate)`.
5. **baseAccessDays** (4661–4666): для trial — `ceil((trial_end_at − created_at)/1d)`, иначе `tariff.access_days || 30`.
6. **extendFromDate** (4668): продлеваем от `existingSub.access_end_at` ТОЛЬКО при `isSameTariff && !is_trial`, иначе считаем от `now`.
7. **nextChargeAt** (4674–4682): trial+autoCharge → `accessEndAt − 1d`; recurring non-trial → `accessEndAt − 3d`; one-time → `null`.
8. **isRecurringSubscription классификатор** (4510–4515): `offer.meta.recurring.is_recurring || installment || (trial && autoChargeAfterTrial)`. Соответствует Product Type SOT.

---

## 5. Прямые access-writes, подлежащие удалению из webhook

Inventory (read-only), точные строки в `bepaid-webhook/index.ts`:

| line  | таблица           | поля                                            | действие |
|------:|-------------------|-------------------------------------------------|----------|
| 4761  | `subscriptions_v2`| `access_end_at`                                 | update (extend ветка) |
| 4790  | `subscriptions_v2`| `access_start_at`                               | insert (new sub) |
| 4791  | `subscriptions_v2`| `access_end_at`                                 | insert (new sub) |
| 4852  | `entitlements`    | select `id, expires_at` для GREATEST            | read (часть write-flow) |
| 4862–4876 | `entitlements`| update `expires_at = max(current, target)`      | update |
| 4880–4892 | `entitlements`| insert `expires_at, …`                          | insert |
| 4926  | `subscriptions_v2`| `access_end_at` (follow-up)                     | update |
| 4943  | `entitlements`    | `expires_at` в follow-up upsert                 | upsert |

Дополнительно: любые transitions `subscriptions_v2.status` между `active/trial/past_due`, влияющие на платформенный доступ, тоже относятся к access-writes и должны уйти в writer. Перевод чисто `canceled → active` без изменения дат — пограничный случай, разбирается в execution-плане.

---

## 6. Provider-sync поля, остающиеся за webhook

После переноса access-grant в canonical writer webhook сохраняет за собой **только** провайдерные/синхро-поля (как в WEBHOOK-SUBSCRIPTION renewal H2.1):

- `subscriptions_v2`: `billing_type`, `next_charge_at` (если writer возвращает значение, см. §8), `auto_renew`, `meta.bepaid_subscription_id`, `meta.bepaid_*`, `payment_method_id` (если writer не присвоил), `updated_at`.
- `orders_v2.meta`: `gc_sync_*`, `telegram_access_pending`, `pending_since`, `bepaid_*` ссылочные поля.
- `payment_methods`: tokenization fields (вне 3DS finalize ветки).

**Запрещено для webhook (только writer):**
- `subscriptions_v2.access_start_at`, `subscriptions_v2.access_end_at`;
- любые `subscriptions_v2.status` transitions, влияющие на доступ (включая `past_due → active` reattach, `trial → active`);
- любая запись в `entitlements`;
- любая запись в `telegram_access` / `telegram_access_queue` (через `telegram-grant-access` вызов на стороне writer, согласно [Canonical Telegram Grant Write-Path](mem://architecture/telegram/canonical-grant-write-path)).

---

## 7. Гипотезы покрытия в canonical writer (требуют code review подтверждения)

> Формулировка: гипотеза → факт по `supabase/functions/grant-access-for-order/index.ts` (2108 строк).

| # | Гипотеза | Подтверждение по коду | Статус |
|---|----------|-----------------------|--------|
| H1 | Writer умеет **создавать** subscriptions_v2 по paid order, если её ещё нет | Да — ветка CREATE на 1611–1640 (`insert subscriptions_v2 … access_start_at/access_end_at/next_charge_at`) после `existingProductSub === null`. | **Покрыто** |
| H2 | Writer умеет **extend** существующей подписки при `tariff_id` match | Да — ветка EXTEND 1376–1525, `dedupeExtendedByOrders`, update `access_end_at`. | **Покрыто** |
| H3 | Writer реализует proration при смене tariff_id внутри одного product_id | Нет — `grep proration|bonus_days` пусто. При mismatch tariff_id writer идёт по «Extend Tariff Match Required» (skip extend → новая подписка от now без бонусов). | **Gap** |
| H4 | Writer имеет multi-candidate STOP-guard с audit `subscription_multi_candidate_review` | Нет — `grep multi_candidate` пусто. Writer выбирает первую active/past_due по своему резолверу без явного STOP. | **Gap** |
| H5 | Writer выполняет past_due reattach (`past_due` без `order_id` → `active` + `order_id`) | Нет — `grep subscription_order_attached` пусто. | **Gap** |
| H6 | Writer считает access_days для trial из `trial_end_at − created_at` | Нет — `grep trial_end_at` пусто; writer берёт `tariff.access_days`. | **Gap** |
| H7 | Writer выбирает `extendFromDate = existingSub.access_end_at` только при isSameTariff && !is_trial | Частично — `extended_by_orders` идёт только по tariff_match (см. [Extend Tariff Match Required](mem://commercial-logic/access/extend-tariff-match-required)); trial-логика расхождения с 3DS finalize не сверена. | **Gap (партиал)** |
| H8 | Writer возвращает `nextChargeAt` (или эквивалент) в response | Уточнить — сейчас writer пишет `next_charge_at = accessEndAt` (insert 1620) и `accessEndAt` (extend), без `−3d`/`−1d` логики 3DS finalize. | **Gap (расхождение значений)** |

Итог: writer **покрывает базовый bootstrap/extend**, но имеет **5 содержательных gap'ов** (H3, H4, H5, H6, H7+H8), которые сегодня выполняются webhook'ом самостоятельно.

---

## 8. Спецификация изменений canonical writer (proposal-only)

> Это **предложение**, не утверждённый контракт. Конкретный API закрепляется в плане execution H2.1b.

### Источник вызова

```ts
grant-access-for-order({
  orderId,
  source: 'bepaid_webhook',
  context: '3ds_finalize',
})
```

### Outcomes (proposal)

`ok | bootstrap_created | extended | manual_review_multi_candidate | skip_tariff_mismatch | skip_not_paid | error`.

### Контракт writer ↔ webhook

- Writer **сам** решает create-vs-extend по `(user_id, product_id, tariff_id, status, canceled_at)`.
- Webhook **не передаёт** `accessEndAt`, `accessStartAt`, `accessDays`.
- Proration считается **внутри writer** port-1-в-1 формулами 3DS finalize, чтобы итоговые дни не разошлись с текущим продакшеном.
- Trial detection — по `orders_v2.is_trial` + `orders_v2.trial_end_at`.
- Multi-candidate guard — внутри writer; audit-имена сохраняются (`subscription_multi_candidate_review`, `subscription_order_attached`) для непрерывности телеметрии.
- past_due→active reattach при привязке нового `order_id` — внутри writer.

### `nextChargeAt` контракт (два допустимых варианта)

Возможный контракт:
- **A.** writer возвращает `nextChargeAt` в response, webhook записывает его в provider-sync update (`billing_type`, `next_charge_at`, `auto_renew`);
  ИЛИ
- **B.** webhook рассчитывает `next_charge_at` самостоятельно из уже записанного writer'ом `access_end_at`, **но не меняет access fields**.

Выбор — на этапе execution H2.1b.

### Status transitions

Любое изменение `subscriptions_v2.status`, влияющее на платформенный доступ (`past_due ↔ active`, `trial → active`), **только через writer**. Webhook ограничен provider-sync (см. §6).

---

## 9. План тестов (без выполнения)

Для будущего execution-патча H2.1b:

1. **Контракт вызова writer'а:** в 3DS finalize ветке writer вызывается ровно 1 раз с `source='bepaid_webhook'`, `context='3ds_finalize'`, корректным `orderId`.
2. **Skip outcomes:** при `skip_*` / `manual_review_multi_candidate` webhook делает 0 access-writes и пишет audit `bepaid.webhook.grant_skipped_no_fallback`.
3. **Tariff change proration:** при `tariff_id` ≠ existing writer считает и применяет бонусные дни (parity с формулой 3DS finalize).
4. **Multi-candidate:** при >1 active/past_due writer возвращает `manual_review_multi_candidate`, webhook не пишет.
5. **Trial bootstrap:** при `is_trial=true` writer создаёт subscriptions_v2 с `access_end_at = trial_end_at`, `status='trial'`, `next_charge_at` договорённого формата.
6. **past_due reattach:** при найденном `past_due` без `order_id` writer переводит в `active` и привязывает текущий `order_id` + audit `subscription_order_attached`.
7. **Static check:** 0 матчей по
   - `from\('subscriptions_v2'\).*\.(update|insert|upsert).*access_(start|end)_at`
   - `from\('entitlements'\).*\.(insert|update|upsert)`

   в диапазоне строк 3DS finalize ветки.
8. **No-loss контракт:** golden-fixture (например, Дарья Насимова) до/после рефакторинга — `expires_at`, `access_end_at`, `status`, `meta.extended_by_orders`, telegram_access совпадают с точностью до timestamp tolerance.

---

## 10. No-loss mapping (old → target)

| old 3DS finalize behavior (webhook) | target canonical writer behavior | provider-sync остаётся в webhook | removed direct access write |
|---|---|---|---|
| `subscriptions_v2.update.access_end_at` (extend, 4761) | writer EXTEND ветка (1508), `dedupeExtendedByOrders` | `billing_type`, `next_charge_at`, `auto_renew`, `meta.bepaid_*`, `updated_at` | да |
| `subscriptions_v2.insert.access_start_at/access_end_at` (new sub, 4790–4791) | writer CREATE ветка (1611) | `payment_method_id` (если не присвоен), `meta.bepaid_*` | да |
| `entitlements.update.expires_at` GREATEST (4862–4876) | writer entitlements upsert внутри access-grant pipeline | — | да |
| `entitlements.insert.expires_at` (4880–4892) | writer entitlements insert | — | да |
| `subscriptions_v2.update.access_end_at` follow-up (4926) | writer (часть extend/create) | `updated_at` only | да |
| `entitlements.upsert.expires_at` follow-up (4943) | writer entitlements upsert | — | да |
| status `past_due → active` reattach (4578–4607) | writer past_due reattach (новая логика, H2.1b execution) | `meta.bepaid_*` | да |
| multi-candidate STOP-guard (4554–4575) | writer multi-candidate guard (новая логика) | — | да (audit переезжает) |
| proration при смене tariff (4612–4659) | writer proration (новая логика) | — | да |
| trial baseAccessDays из `trial_end_at` (4661–4666) | writer trial bootstrap (новая логика) | — | да |
| `nextChargeAt = end−1d/−3d` (4674–4682) | writer возвращает значение **или** webhook рассчитывает после writer'а | `next_charge_at` (provider-sync) | нет — это не access поле |

---

## 11. Минимальная execution strategy (output discovery)

На основании §7:

- **A.** ~~Writer полностью покрывает 3DS finalize → заменить webhook writes на вызов writer.~~ Не подходит: gap'ы H3–H8.
- **B.** **Writer покрывает частично → сначала доработать writer (proration, multi-candidate guard, past_due reattach, trial bootstrap, nextCharge контракт), затем заменить 3DS finalize ветку webhook на вызов writer.** ← **Рекомендуется.**
- **C.** Writer не покрывает → отдельный writer-extension patch. Не требуется, т.к. база CREATE/EXTEND уже есть.

Рекомендация: **стратегия B**, в два суб-патча:
- **H2.1b-i:** writer extension (proration + multi-candidate + past_due reattach + trial bootstrap + nextCharge контракт + тесты). DML=0, migrations=0.
- **H2.1b-ii:** webhook 3DS finalize ветка → вызов writer + provider-sync only + static check + тесты. DML=0, migrations=0.

После обоих — H2.1c (legacy one-time/orphan recovery), затем H3 (data-repair дублей), затем H4 (preconditions + `BEPAID_REBILL_MATERIALIZATION=on`).

---

## 12. DoD

- [x] Proof-файл создан со всеми 12 разделами.
- [x] Точные строки 3DS finalize ветки зафиксированы.
- [x] Inventory direct access-writes (8 точек) зафиксирован.
- [x] Гипотезы о покрытии writer подтверждены/опровергнуты по коду (5 gap, 2 покрыто, 1 частично).
- [x] Спецификация изменений writer описана как proposal (не утверждённый контракт).
- [x] План тестов (8 пунктов) перечислен.
- [x] No-loss mapping таблица составлена.
- [x] Execution strategy: рекомендована стратегия B (writer extension → webhook replace), два суб-патча.
- [x] 0 правок в `supabase/functions/bepaid-webhook/index.ts`.
- [x] 0 правок в `supabase/functions/grant-access-for-order/index.ts`.
- [x] 0 production DML, 0 migrations.
- [x] `BEPAID_REBILL_MATERIALIZATION` не изменён (`dry_run`).
- [x] `mode=on` остаётся **запрещён** до закрытия H2.1b execution + H2.1c + H4 preconditions.

## 13. Статус цепочки (обновлено)

- H2 LINK-ORDER — **closed**.
- H2.1 WEBHOOK-SUBSCRIPTION renewal — **closed**.
- H2.1b 3DS finalize — **analysis_complete** (этот документ). Готов к отдельному execution-плану (рекомендуется суб-патчи i/ii).
- H2.1c legacy one-time/orphan recovery — **pending** (отдельный план позже).
- H2b atomic append через RPC — **backlog**.
- H3 data-repair дублей — **pending** (после H2.1b/c).
- H4 preconditions + `mode=on` — **pending** (после H2.1b/c).
- PATCH G (bonus/secondary access discovery) — **unchanged**, может идти параллельно как read-only.

Следующий шаг: ожидание approve этого discovery → отдельный план **PATCH H2.1b-i execution** (writer extension).
