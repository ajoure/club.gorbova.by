## да, согласен, с учетом правок:

## **1. По open questions — решения**

```md
1. Stripe test mode:
Использовать существующий sandbox/test-mode account_code `stripe_poland`.
Block 2/3 не помечать manual_test_pending, если test-mode Stripe уже работает и Phase 8 проходил через test card.

2. bePaid:
Не делать реальный bePaid платёж, если для него нет безопасного sandbox/test профиля.
Для Block 1 достаточно regression smoke без оплаты:
- ссылка создаётся;
- checkout открывается;
- bePaid provider/profile корректный;
- существующий bePaid receipt/payment не сломан в UI;
- существующие bePaid webhook/payment данные читаются.
Если есть безопасный bePaid test profile — можно прогнать полный тест.

3. Screenshots:
Выполнять автоматически через preview/dev login `123456`.
Не перекладывать скриншоты на пользователя.
```

---

## **2. Важная правка: Phase 10 не должен требовать новых реальных bePaid оплат**

В плане сейчас Block 1 звучит как создание и оплата bePaid one-time. Это может быть лишним риском.

Заменить на:

```md
Block 1 — bePaid regression

Цель: доказать, что bePaid flow не сломан.

Если есть безопасный bePaid sandbox/test card:
- создать bePaid one-time link;
- пройти checkout;
- проверить webhook/payment/receipt/access.

Если безопасного bePaid sandbox нет:
- создать bePaid link;
- проверить, что checkout открывается;
- проверить existing successful bePaid payment:
  - payments_v2.provider='bepaid';
  - receipt_url есть;
  - UI показывает чек;
  - access/grant по старым данным не сломан;
- статус блока: PASS (smoke + existing data regression), без manual_test_pending.
```

---

## **3. Block 6 replay — не делать destructive replay**

В плане есть:

повторный webhook с тем же event_id → skipped_duplicate

Уточнить:

```md
Replay делать только если он уже доказан безопасным и выполняется в test-mode.

Если replay требует вмешательства в webhook delivery или может затронуть lifecycle:
- не выполнять;
- использовать уже существующие duplicate/skipped records или code-path proof;
- проверить SQL на отсутствие дублей provider_events/orders/payments/subscriptions.
```

Не нужно снова рисковать ради доказательства, которое уже проверялось.

---

## **4. Block 7 Telegram — не требовать реальный Telegram DM как blocker**

Добавить:

```md
Telegram проверять через audit/queue/status, без требования фактического получения DM пользователем.

PASS, если:
- grant вызван один раз;
- telegram queue/access rows без дублей;
- revoke не появился;
- audit показывает успешный путь.
```

---

## **5. Proof PASS/SKIPPED формулировка**

Сейчас написано:

PASS только если все 8 блоков PASS или explicit SKIPPED…

Лучше так:

```md
Phase 10 PASS допускается при:
- PASS по всем критическим блокам;
- SKIPPED только для внешне-зависимых действий, где есть безопасное обоснование и existing-data regression proof.

SKIPPED не допускается для:
- Stripe one-time;
- Stripe subscription;
- provider_events duplicates;
- admin reporting visibility;
если sandbox/test-mode уже доступен.
```

То есть Stripe блоки сейчас должны быть **PASS**, а не skipped.

---

## **6. Добавить no-data-mutation контроль**

В proof добавить обязательный diff/check:

```md
git diff --name-only

Ожидаемые файлы:
- .lovable/proofs/phase_10_final_regression_v1.md
- .lovable/backlog/phase_9c_provider_choice_and_stripe_subscriptions_visibility.md
- .lovable/plan.md

Любой diff в src/, supabase/functions/, supabase/migrations/ = FAIL/STOP.
```

---

## **7. Итоговый ответ Lovable**

```md
План принят с правками.

Решения по open questions:

1. Stripe test mode:
   - использовать существующий `stripe_poland` / test-mode;
   - Blocks 2/3 должны быть runtime PASS, не manual_test_pending.

2. bePaid:
   - если есть безопасный bePaid sandbox/test profile — можно выполнить полный test checkout;
   - если нет — не делать рискованный платёж, а закрыть Block 1 через link-open smoke + existing successful bePaid payment regression + UI receipt proof.

3. Screenshots:
   - делать автоматически через preview/dev login `123456`;
   - не перекладывать на пользователя.

Правки к плану:

1. Block 1 bePaid не должен требовать реального bePaid платежа без sandbox.
2. Block 6 replay делать только если безопасно; иначе existing duplicate/code-path proof.
3. Telegram проверять через audit/queue/status, не через фактический DM.
4. Stripe Blocks 2/3 не SKIPPED, если test-mode работает.
5. Expected diff только:
   - `.lovable/proofs/phase_10_final_regression_v1.md`;
   - `.lovable/backlog/phase_9c_provider_choice_and_stripe_subscriptions_visibility.md`;
   - `.lovable/plan.md`.
6. Любой diff в `src/`, `supabase/functions/`, `supabase/migrations/` = STOP.

Можно начинать Phase 10 Final Regression.
```

## **8. Что останется после Phase 10**

Если Phase 10 будет PASS, Stripe Master Sprint можно закрывать как завершённый, а остатки вынести в backlog:

- Phase 9-C: `provider_choice_source` в RPC/UI;
- full Stripe subscriptions visibility;
- audit drill-down;
- repair/retry/reconcile actions — только отдельным спринтом;
- live Stripe readiness — отдельный gate перед production.
- &nbsp;
- План: Phase 10 — Final Regression (Stripe Master Sprint)

Цель — выполнить финальный регрессионный прогон по всем 8 блокам checklist'а и зафиксировать результат в едином proof. Никаких runtime-изменений, миграций, новых функций, repair/retry/backfill. Только verify + read-only SQL + UI screenshots + audit checks.

---

### Scope freeze (заявлен в начале proof)

- ❌ `supabase/functions/` — не трогать
- ❌ `supabase/migrations/` — не трогать
- ❌ webhook/grant/Telegram/reconcile lifecycle — не трогать
- ❌ repair / retry / regrant / backfill execute — не запускать
- ❌ новые UI-компоненты/фичи
- ✅ только тестовые оплаты, read-only SQL, screenshots, чтение audit/provider_events
- ✅ обновление backlog и единственный новый файл — proof

### Артефакты

1. `**.lovable/proofs/phase_10_final_regression_v1.md**` — единый proof по 8 блокам.
2. `**.lovable/backlog/phase_9c_provider_choice_and_stripe_subscriptions_visibility.md**` — фиксация Phase 9-C deferred (provider_choice_source в RPC/UI, full Stripe subscriptions module).
3. Обновление `.lovable/plan.md` (Phase 9-B = PASS, Phase 9-C = BACKLOG, Phase 10 = IN PROGRESS → PASS).

Никаких других файлов не создаётся и не редактируется.

### Структура proof (по блокам)

Каждый блок содержит: список ID (link/order/payment/subscription), SQL before/after (read-only `supabase--read_query`), audit rows, provider_events rows, screenshot UI (через preview), verdict PASS/FAIL/SKIPPED + причина.

**Block 1 — bePaid regression**

- Создание bePaid one-time payment link через UI.
- Test checkout (test card) или skip с пометкой `manual_test_pending` если требуется реальный платёж.
- Проверка: `orders_v2` + `payments_v2.receipt_url` + audit `bepaid.webhook.*` + Telegram grant audit.

**Block 2 — Stripe one-time**

- Создание Stripe explicit `one_time` link.
- Checkout `mode=payment`, PaymentIntent проходит (Stripe test mode / sandbox).
- Verify: `payments_v2.meta.stripe.receipt_url`, audit `stripe.receipt_materialization.applied`, access grant.
- UI screenshot: Payments table показывает `Stripe` badge + Stripe receipt link.

**Block 3 — Stripe subscription**

- Создание Stripe explicit `subscription` link.
- Checkout `mode=subscription`, `invoice.paid` приходит.
- Verify: `subscriptions_v2` + `payments_v2.meta.stripe.{hosted_invoice_url, invoice_pdf, invoice_id, subscription_id}` + audit `stripe.receipt_materialization.applied`.
- UI screenshot: Payments table показывает Invoice / PDF links.

**Block 4 — Admin override matrix**

- recurring offer + explicit `one_time` → остаётся one_time (verify через `payment_links.meta.payment_type_admin_override`).
- recurring offer + explicit `subscription` → остаётся subscription.
- auto + recurring → subscription.
- Verify: `tariff_offers.meta.acquiring` не изменён (SELECT before/after).

**Block 5 — Customer choice**

- customer_choice multi → UI показывает выбор провайдеров.
- single-provider auto-select → автоматический выбор без UI.
- empty allowed providers → понятная ошибка (нормализованная через `normalizeEdgeFunctionError`).

**Block 6 — Provider events idempotency**

- SQL: `SELECT count(*), event_id FROM provider_events GROUP BY event_id HAVING count(*) > 1` (ожидается 0).
- Verify: failed / manual_review / skipped_duplicate видны в `StripeEventsTab`.
- Replay-сценарий: повторный webhook с тем же `event_id` → `skipped_duplicate`, нет новых orders.

**Block 7 — Access / CRM / Telegram**

- SQL чек: `orders_v2` ↔ `contacts` / `profiles`; `payments_v2.order_id`; `subscriptions_v2.order_id`.
- Access grant ровно один раз: `entitlements` rows count по тестовому order_id.
- Telegram: `telegram_access_queue` нет дублей; audit `telegram-grant-access` PASS.

**Block 8 — Admin reporting (Phase 9-B UI)**

- Screenshot: `/admin/payments` — bePaid badge, Stripe badge, Stripe Invoice/PDF links, bePaid receipt link.
- Screenshot: `/admin/payments/links` → LinkDetailsDrawer показывает provider/provider_mode/account_code/profile_code/business_stream.
- Screenshot: StripeEventsTab — health summary + filters работают.

### Deferred (зафиксировать в backlog)

В `.lovable/backlog/phase_9c_provider_choice_and_stripe_subscriptions_visibility.md`:

- расширить `get_admin_payment_links_v1` / view для `provider_choice_source`;
- показать auto / explicit / customer_choice в UI;
- показать explicit one_time recurring как admin override badge;
- решить модель Stripe subscriptions visibility (unified tab vs separate vs payment/order-only).

### DoD Phase 10

Proof = PASS только если все 8 блоков отмечены PASS (или explicit SKIPPED с обоснованием «требует live Stripe / production webhook» — допустимо для blocks 2/3 если нет sandbox-ключа в env). bePaid не сломан, Stripe работает, нет дублей в provider_events, admin reporting корректен. Никаких изменений вне proof + backlog + `.lovable/plan.md`.

### Open questions перед стартом

1. **Stripe test mode**: использовать существующий sandbox account_code (если настроен в `provider_profiles`), или Block 2/3 пометить `manual_test_pending` для ручного прогона пользователем?
2. **bePaid test card**: использовать тестовый профиль bePaid из env, или Block 1 тоже `manual_test_pending`?
3. **Screenshots**: brower-tool для preview URL `/admin/payments` (требуется dev-login `123456`) — выполнить автоматически или приложить инструкцию для ручной проверки?

---

## Phase 10 — Final Regression: PASS (2026-06-09)

- Proof: `.lovable/proofs/phase_10_final_regression_v1.md`
- Backlog: `.lovable/backlog/phase_9c_provider_choice_and_stripe_subscriptions_visibility.md`
- Diff: только proof + backlog + plan (см. proof §Diff confirmation)
- Verdict: bePaid не сломан, Stripe one-time + subscription работают, provider_events 0 дублей, admin reporting корректен, Telegram/access без дублей.

Stripe Master Sprint завершён. Остаток — Phase 9-C backlog.
