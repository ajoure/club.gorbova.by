# да, согласен, с учетом правок:

```text
Phase 3.1.0 Pending Enum Mini-plan можно approve к Discovery/Dry-run, но не к миграции сразу.

Правки перед execute:

1. ALTER TYPE BEFORE 'active'
   Проверить поддержку в текущей версии PostgreSQL/Supabase.
   Если `ADD VALUE ... BEFORE` недоступен или рискованен — использовать:
   `ALTER TYPE ... ADD VALUE IF NOT EXISTS 'pending'`
   без позиционирования.
   Порядок enum не должен использоваться как бизнес-логика.

2. Memory update убрать из DoD текущего mini-plan.
   Memory обновлять только после отдельного approve итогового proof.
   В DoD оставить только рекомендацию:
   `memory update candidate`.

3. Unit-тесты
   Если часть тестов не запускается в окружении Lovable, это не FAIL при условии:
   - указана команда;
   - указан результат/причина недоступности;
   - заменено на статический grep + SQL proof.
   Не требовать невозможный test runner как блокер.

4. Admin UI smoke
   `/admin/payments/bepaid-subscriptions` — можно проверить визуально, но если browser automation недоступна, заменить на:
   - build green;
   - query данных подписок;
   - proof, что нет pending rows.
   Не блокировать миграцию UI-скрином, если UI не запускается.

5. Reader audit
   Добавить обязательный поиск по опасным паттернам:
   - `status != 'canceled'`
   - `status <> 'canceled'`
   - `status not in (...)`
   - `.neq('status', 'canceled')`
   - `.not('status'`
   - `status !== 'canceled'`
   - `status != "canceled"`
   - `status === 'active' || status`
   Это критично для выявления unknown-as-active.

6. Conflict guard
   Я бы уточнил: pending не должен выдавать доступ, но может блокировать вторую попытку checkout на короткое время.
   То есть:
   - pending НЕ active;
   - pending НЕ grantable;
   - pending MAY block duplicate pending checkout до TTL.
   Это нужно явно зафиксировать, иначе один пользователь сможет нащёлкать несколько pending checkout.

7. Pending cleanup worker
   Не обязательно делать до MVP, если duplicate guard блокирует pending и MVP proof не создаёт abandoned pending rows.
   Но если pending блокирует duplicate checkout — нужен ручной админ/cleanup путь.
   Зафиксировать:
   - MVP может стартовать без worker только при доказанном ручном cleanup/admin fallback;
   - worker — отдельный mini-plan до public rollout.

8. Proof C.2
   В counts до/после добавлять `pending=0` до миграции нельзя, если enum ещё не содержит pending.
   Формулировать:
   - до: counts по существующим enum values;
   - после: counts + pending=0.

9. bePaid proof
   `provider_subscriptions row count` может измениться органически.
   Правильнее:
   - никаких строк provider='bepaid' не изменено этим миграционным transaction;
   - bePaid code diff пустой;
   - органические изменения не считаются FAIL.

10. STOP
   Если найден reader `status != canceled`, не делать миграцию.
   Сначала отдельный patch нормализации reader.
```

Ключевой смысл: сам подход правильный. Но сначала **A-stage reader audit**. Миграция только при `ALL_READERS_SAFE=true`.

&nbsp;

План: Phase 3.1.0 — Subscription Pending State Schema Mini-plan

## Цель

Add-only расширить enum `public.subscription_status` значением `'pending'`, чтобы `stripe-create-subscription-checkout` мог безопасно pre-create `subscriptions_v2` ДО Stripe Checkout (Discovery §17, CR-3 — провайдер-link через subv2). bePaid контур не трогаем. Никаких backfill, никаких изменений существующих строк.

Это **schema-only mini-plan**. Он блокирует Phase 3.1 Infinite Subscription MVP до полного PASS.

---

## Стадия A — Discovery readers (dry-run, без кода)

Цель: убедиться, что ни один читатель `subscriptions_v2.status` не интерпретирует unknown enum value как `active`/grantable/конфликт-доступ.

### A.1 Перечень областей для аудита

1. **Frontend** — `src/**` (hooks, pages, components, `subscriptionStatusLabels.ts`, replacement helpers, admin panels вкл. `/admin/payments/bepaid-subscriptions`).
2. **Edge functions** — список по `rg "subscriptions_v2" supabase/functions`:
  - Access / grant chain: `grant-access-for-order/**`, `_shared/resolve-effective-access.ts`, `_shared/resolve-access-window.ts`, `_shared/entitlement-sync.ts`, `_shared/extra-access-classifier.ts`, `_shared/renewal-offer-resolver.ts`, `_shared/token-resolver.ts`, `provider_linked_subscription_resolver.ts`, `access-rules-nightly-reconcile`, `repair-module-entitlements` (если читает).
  - Subscription lifecycle: `subscription-actions`, `subscription-admin-actions`, `subscriptions-reconcile`, `subscription-charge`, `subscription-renewal-reminders`, `subscription-grace-reminders`, `installment-notifications`, `installment-charge-cron`, `monitor-rebill-no-extension`, `cancel-trial`, `direct-charge`, `payment-method-verify-recurring`.
  - Duplicate / conflict guard: `_shared/subscription-conflict.ts` (+ test), `_shared/create-payment-checkout.ts`, `bepaid-create-subscription-checkout`, `bepaid-admin-create-subscription-link`, `public-checkout`.
  - bePaid контур (read-only, проверить что не падает на новом enum): `bepaid-webhook/**`, `bepaid-*`, `admin-bepaid-*`, `bepaid-subscription-audit*`.
  - Telegram (читает status для kick/grant): `telegram-kick-violators`, `telegram-club-members`, `telegram-check-expired`, `telegram-grant-access`, `telegram-revoke-access`, `telegram-process-access-queue`, `telegram-send-reminders`, `telegram-ai-support`.
  - System health / INV-22: `system-health-full-check`, `system-health-inv22-plan`, `system-health-inv22-resolve`, `nightly-system-health`, `nightly-payments-invariants`, `monitor-rebill-no-extension`.
  - Прочее: `merge-clients`, `admin-batch-disable-auto-renew`, `admin-repair-zombie-provider-subs`, `admin-backfill-recurring-snapshot`, `live-event-notifications-cron`.
3. **RPC / DB functions / views** — `pg_proc` + `pg_views` поиск по `subscription_status`/`subscriptions_v2.status` (вкл. `has_active_subscription`, view `payment_links_enriched_v` и любые reconcile-RPC).
4. **Cron** — `cron.job` + `supabase/config.toml` (расписания reconcile/reminders/kick).
5. **Broadcasts / audience** — `broadcast_*`, `email-mass-broadcast` (фильтр аудитории по статусу подписки).
6. **Аналитика / отчёты** — admin-страницы и SQL view'хи.

### A.2 Классификация каждого reader'а (по результатам grep)

Для каждого читателя зафиксировать в proof одну из меток:

- `ignores_unknown` — switch/IN-list, unknown → no-op. OK.
- `treats_as_active` — `status != 'canceled'` или whitelist без default. **BLOCKER**, нужен patch до миграции.
- `treats_as_grantable` — открывает доступ/Telegram/reminders. **BLOCKER**.
- `treats_as_conflict` — попадает в duplicate guard. По спецификации `subscription-conflict.ts` conflict statuses = `('active','trial','past_due')` — pending не должен туда попасть. Проверить буквально.
- `ui_label_only` — отображает строку (см. `subscriptionStatusLabels.ts`, где `pending` уже есть как «В обработке»). OK.

### A.3 STOP-условия (миграция НЕ выполняется)

- Хотя бы один reader = `treats_as_active` / `treats_as_grantable`.
- Conflict guard воспринимает `pending` как active-конфликт (а не как pending-checkout slot, который очищается по TTL).
- Reconcile/INV-22 классифицирует `pending` как зомби и пытается отозвать доступ или закрыть строку без TTL-окна.
- Reminders/Telegram включают `pending` в рассылку/grant/kick.

Если есть BLOCKER — отдельный patch-план «нормализация unknown-status readers» до возврата к миграции.

### A.4 Артефакт стадии A

`/.lovable/proofs/stripe_phase_3_1_0_pending_readers_audit_v1.md` со списком файл:строка + меткой классификации + явным `ALL_READERS_SAFE: true|false`.

---

## Стадия B — Миграция (только при `ALL_READERS_SAFE=true`)

### B.1 SQL (единственный statement)

```sql
ALTER TYPE public.subscription_status ADD VALUE IF NOT EXISTS 'pending' BEFORE 'active';
```

Никаких UPDATE, никакого backfill, никаких изменений `subscriptions_v2`/`provider_subscriptions`/RLS/grants/триггеров/RPC.

Позиция `BEFORE 'active'` — чтобы порядковый номер `pending` был ниже `active` (полезно для ORDER BY status в админ-листах; функционально неважно).

### B.2 Что миграция НЕ делает (явный freeze)

- НЕ меняет `subscription-conflict.ts` conflict-list.
- НЕ добавляет cleanup-функцию для pending TTL (отдельный mini-plan B' после approve, см. ниже).
- НЕ трогает bePaid edge-функции и `provider_subscriptions`.
- НЕ обновляет `entitlement-sync` / `grant-access-for-order`.
- НЕ обновляет reminders / Telegram kick.
- НЕ создаёт placeholder-rows в `provider_subscriptions`.

### B.3 Pending cleanup policy (зафиксировать as documentation, без кода)

- Hard TTL = 24h: pending-row без перехода в active/canceled → должен быть закрыт как `expired` с `meta.lifecycle.timeout_reason='checkout_abandoned'`.
- Реализация — отдельный mini-plan **Phase 3.1.0-B (Pending Cleanup Worker)**, подаётся **после** PASS текущего mini-plan и **до** старта MVP runtime. В рамках текущего плана только записываем policy в proof.

---

## Стадия C — Proof (обязательные пункты)

`/.lovable/proofs/stripe_phase_3_1_0_pending_enum_proof_v1.md`:

1. `SELECT enum_range(NULL::public.subscription_status)` — содержит `pending`, позиция перед `active`.
2. `SELECT status, count(*) FROM subscriptions_v2 GROUP BY status` до и после миграции — идентичные числа для всех существующих значений; `pending = 0`.
3. Snapshot counts active/trial/past_due/canceled/expired/superseded/expired_reentry — идентичны до/после.
4. bePaid recurring untouched: hash/diff списка bePaid edge-функций и `provider_subscriptions` row count — не меняется.
5. Grep-аудит читателей (ссылка на artifact стадии A) приложен, `ALL_READERS_SAFE=true`.
6. Прогон существующих unit-тестов:
  - `supabase/functions/_shared/subscription-conflict_test.ts`
  - `supabase/functions/bepaid-webhook/*_test.ts`
  - `supabase/functions/grant-access-for-order/three_ds_writer_test.ts`
   — все PASS без модификаций тестов.
7. Smoke в `/admin/payments/bepaid-subscriptions`: список подписок рендерится, фильтры работают, ни одной `pending`-строки нет (поскольку никто их ещё не создаёт).

### DoD

- Все 7 пунктов proof PASS.
- 0 строк `subscriptions_v2` изменено.
- bePaid контур не задет (диагностика payments_v2 / orders_v2 нулевая дельта).
- Memory `subscriptions_v2-schema-contract` дополнена строкой: «enum `subscription_status` содержит `pending` — означает pre-created checkout slot, НЕ даёт доступ, НЕ участвует в conflict guard как active, TTL 24h обрабатывается отдельным worker'ом (Phase 3.1.0-B)».

---

## Последовательность Phase 3 после этого mini-plan

```
Discovery ✅
  → Pending State Strategy ✅ (утверждён)
    → Phase 3.1.0 Pending Enum Mini-plan  ← ЭТОТ ПЛАН
      → Phase 3.1.0-B Pending Cleanup Worker (отдельный approve)
        → Phase 3.1.1 Price Mapping Validation STOP-GATE
          → Phase 3.1 Infinite Subscription MVP execute
            → Runtime Proof (G1–G10)
              → Phase 3.2+ deferred
```

MVP остаётся заблокированным до закрытия Phase 3.1.0 + 3.1.0-B + 3.1.1.

## Файлы, которые будут созданы (только на стадии Execute)

- `supabase/migrations/<ts>_phase_3_1_0_subscription_status_pending.sql` — один `ALTER TYPE`.
- `.lovable/proofs/stripe_phase_3_1_0_pending_readers_audit_v1.md`
- `.lovable/proofs/stripe_phase_3_1_0_pending_enum_proof_v1.md`
- Обновление `.lovable/plan.md` (отметка Phase 3.1.0 статуса).
- Обновление memory `subscriptions_v2-schema-contract`.

## Файлы, которые НЕ будут изменены

- Любая edge-function (включая весь bePaid контур и `grant-access-for-order`).
- Любой frontend файл.
- `provider_subscriptions`, `entitlements`, `access_rules`, RLS, RPC.
- `supabase/config.toml`, cron расписания.