да, согласен, с учетом правок:

1. **G19 уточнить:** dry-run audit допустим только если он уже предусмотрен кодом. Если dry-run не пишет audit — это не blocker, но нужно зафиксировать в proof: `dry_run_no_audit_by_design`.
2. **G24 SQL уточнить:** если `subscriptions_v2` не имеет поля `provider`, проверять bePaid через `provider_subscriptions.provider='bepaid'` и join на `subscription_v2_id`.
3. **Добавить G23.1:** после replay проверить не только `provider_events count = 1`, но и:
  - `audit_logs` не продублирован;
  - `subscriptions_v2.updated_at` не изменился повторно;
  - `entitlements` Δ=0.
4. **Добавить PCI proof:** подтвердить, что в G19–G24:
  - raw PAN не использовался;
  - новые helper edge functions не создавались;
  - все действия шли через admin UI / canonical action / Stripe webhook.

После этих уточнений план можно запускать.

&nbsp;

План: Phase 3.2 Runtime Proof G19–G24

Цель

Закрыть оставшиеся runtime-гейты G19–G24 через admin UI в Stripe test mode и зафиксировать proof. После PASS → Phase 3.2 = FULL PASS.

Правила исполнения

- Только русский язык в proof и отчёте.
- Порядок: Diagnose → Plan → Dry run → Execute → Verify.
- Только Stripe test mode. bePaid не трогаем.
- Никаких raw card данных нигде (PCI). Все карты — только `pm_card_*` test tokens.
- Доступ (`entitlements.expires_at`) НЕ отзывается ни в одном из сценариев.
- Telegram revoke НЕ выполняется.
- Никаких новых edge functions / helper-триггеров (запрет п.10.3 docs).
- Все действия идут через канонический путь: admin UI → `stripe-subscription-action` → Stripe API → `stripe-webhook` (replay через Stripe Dashboard «Send test webhook» или Stripe CLI).
- Add-only: ничего не удаляем, только дописываем proof.

Подготовка (fixture)

1. Выбрать в test mode существующую Stripe subscription уже привязанную к `subscriptions_v2` (provider=stripe, status=active, `meta.stripe.subscription_id=sub_*`).
  - Если такой нет — создать через канонический Stripe Hosted Checkout (`stripe-create-subscription-checkout`) с тест-картой `pm_card_visa` (Checkout сам соберёт карту на стороне Stripe, edge функции сырой PAN не видят).
2. Зафиксировать в proof: `subscription_v2_id`, `sub_*`, `cus_*`, `account_code`, `entitlements.expires_at` ДО прогона.

Сценарии runtime

G19 — dry_run cancel_at_period_end

- Из admin UI открыть `SubscriptionActionsSheet` для fixture.
- Нажать «Отменить в конце периода», но в proof проверить отдельным `supabase--curl_edge_functions` POST с `{dry_run:true, action:'cancel_at_period_end'}`.
- Ожидаем: HTTP 200, ответ содержит preview (что будет изменено), Stripe API НЕ вызван, `subscriptions_v2.meta.stripe.cancel_at_period_end` НЕ изменён, audit с пометкой dry-run.
- Snapshot ответа + `SELECT meta FROM subscriptions_v2 WHERE id=...` ДО/ПОСЛЕ (без изменений).

G20 — execute cancel_at_period_end

- Через admin UI подтвердить действие.
- Ожидаем:
  - Stripe `subscription.update(cancel_at_period_end=true)` вызван (idempotency key).
  - `subscriptions_v2.meta.stripe.cancel_at_period_end=true`, `cancel_requested_at` проставлен, `cancel_source='admin'`.
  - `provider_subscriptions.state` остался `active`/`past_due` (НЕ canceled).
  - `entitlements.expires_at` НЕ изменился.
  - Запись в audit_logs с actor_type='user', actor=admin JWT.
- Snapshot: Stripe response, БД до/после, audit row.

G21 — webhook customer.subscription.updated

- Stripe сам пришлёт `customer.subscription.updated` после G20. Дождаться или сделать replay через Stripe Dashboard.
- Ожидаем: `stripe-webhook` идемпотентно обновил `meta.stripe.cancel_at_period_end`, `current_period_end`, `default_payment_method`. status sync без revoke. `provider_events` содержит запись.
- Snapshot: webhook log + БД до/после.

G22 — execute cancel_now (на отдельной fixture)

- Подготовить вторую тест-подписку (не использовать ту же, что в G19–G21, чтобы не смешивать состояния).
- Через admin UI → «Отменить сейчас».
- Ожидаем:
  - Stripe `subscription.cancel()` вызван.
  - `subscriptions_v2.status='canceled'`, `cancel_reason='admin_stripe_cancel_now'`.
  - `provider_subscriptions.state='canceled'`.
  - `entitlements.expires_at` НЕ изменился (доступ живёт до даты).
  - Audit с actor_type='user'.
- Snapshot: Stripe response, БД до/после, audit.

G23 — webhook customer.subscription.deleted replay

- После G22 Stripe прилетит `customer.subscription.deleted`. Дополнительно — replay того же event через Stripe Dashboard для проверки идемпотентности.
- Ожидаем:
  - Первый раз — webhook применил `status=canceled` (уже canceled — no-op safe).
  - Replay — `provider_events_idem_unique` блокирует, HTTP 200, без двойных audit.
  - `entitlements.expires_at` НЕ тронут.
- Snapshot: оба webhook лога + `SELECT count(*) FROM provider_events WHERE event_id=...` = 1.

G24 — bePaid freeze (non-regression)

- Параллельно убедиться: ни одна bePaid-подписка не была затронута за время G19–G23.
- `SELECT count(*), max(updated_at) FROM subscriptions_v2 WHERE provider='bepaid' AND updated_at > <время начала G19>` → ожидаем 0 строк, изменённых руками Phase 3.2.
- `git log` / `rg` подтверждение: за период работы Phase 3.2 не было изменений в `bepaid-*` функциях (sanity, не в рамках runtime, а как часть proof).
- Snapshot: SQL результат + список изменённых файлов Phase 3.2 (все под `stripe-*` / `StripeSubscriptionActionsBlock`).

Proof

Дополнить `.lovable/proofs/stripe_phase_3_2_subscription_actions_v1.md` секциями G19–G24 со следующей структурой для каждого гейта:

- Что проверяли
- Команда / UI-действие
- Stripe API запрос (метод, endpoint, idempotency key) — без PII
- БД snapshot ДО
- БД snapshot ПОСЛЕ
- audit_logs row
- Вердикт PASS/FAIL

Обновить `.lovable/plan.md`: пометить Phase 3.2 как FULL PASS после всех PASS.

DoD

- G19, G20, G21, G22, G23, G24 = PASS.
- `entitlements.expires_at` не изменился ни в одной fixture.
- Никаких bePaid-побочек.
- Никаких новых edge functions / helper-триггеров не создано.
- Никаких raw card данных в логах/audit/payloads.
- Proof-файл обновлён, plan.md обновлён.

Что НЕ делаем

- Не запускаем pause/resume/schedules/installments.
- Не трогаем live mode.
- Не создаём одноразовые helper edge functions (`gXX-trigger`, `stripe-test-*` — запрещено п.10.3).
- Не вызываем `grant-access-for-order` напрямую.
- Не отзываем доступ и не кикаем из Telegram.
- Не меняем bePaid код/конфиг.