да, согласен, с учетом правок:

1. **Разделить H3.x-a на два уровня результата.**

H3.x-a без миграции:

- закрывает B-2 и B-3;

- B-1 закрывает только best-effort re-check.

&nbsp;

H3.x-a-migration/RPC:

- закрывает B-1 полноценно через атомарный lock/constraint.

Если advisory lock/RPC недоступен без миграции — не писать, что race полностью закрыт.

2. **Уточнить поведение extend_same_tariff.**

Сейчас формулировка “reuse existing active sub и редиректить на bePaid manage/новый checkout” не до конца ясна. Нужно явно определить outcome:

extend_same_tariff + active provider-managed subscription:

- НЕ создавать новую subscriptions_v2;

- НЕ создавать второй provider subscription;

- вернуть frontend понятный результат:

  already_has_active_subscription / use_existing_subscription / manage_existing_subscription;

- если нужен новый платеж за продление — он должен идти через существующую provider subscription или отдельный approved one-time/rebill flow, но не через создание новой subscription-chain.

3. **Для same product + different tariff не просто “409 conflict”.**

Нужно различить:

- пользователь явно выбрал replacement_of_subscription_v2_id → допустимый replacement/tariff change flow;

- replacement не указан → conflict/manual_review, без создания дубля.

Иначе можно сломать легитимную смену тарифа.

4. **Добавить read-only verification до code-edit.**

Перед правками собрать:

- все места создания subscriptions_v2 в public-link/admin subscription flows;

- какие source/meta пишутся;

- какие поля связывают order/payment/provider_subscription;

- где именно появились 3 новые duplicate-пары;

- какие из них public_link_subscription, какие admin_subscription.

Это нужно положить в proof до diff-summary.

5. **subscription.extended_existing_public_link не добавлять как audit-action, если в этом патче нет emitter.**

Сейчас написано “зарезервирован”. Лучше:

В этом patch используются только реально эмитируемые audit-actions.

Зарезервированные action names не считать DoD.

Иначе DoD “все 5 action используются в тестах” не выполнится честно.

6. **B-3 audit gap должен быть точнее.**

Для admin_subscription нужно не просто добавить audit, а зафиксировать contract:

каждое решение admin_subscription recurring:

- would_materialize;

- materialized;

- skipped;

- conflict;

- manual_review;

- dry_run_only

должно иметь audit с provider_payment_id, sbs, order_id, subscription_v2_id, decision.

7. **Production DML = 0 уточнить как “ручной data repair = 0”.**

Кодовые audit emitters после deploy будут писать audit_logs при реальных событиях. Поэтому формулировать:

manual production data repair DML = 0;

никаких ручных INSERT/UPDATE в subscriptions_v2/entitlements/provider_subscriptions;

runtime audit_logs допустимы как часть работы кода.

8. **Deploy — только отдельным approve.**

В DoD разделить:

Code+tests ready:

- tests green;

- deno check;

- proof;

- no migrations.

&nbsp;

Fully closed:

- deploy approved;

- deploy success;

- post-deploy verify.

9. **Добавить anti-regression по existing active subscription.**

Тест:

active subscription exists same user/product/tariff/provider

→ public-link checkout НЕ создает subscriptions_v2 row

→ НЕ создает second provider subscription

→ возвращает controlled result / conflict / reuse

10. **Добавить hard rule по 3 найденным дублям.**

В тестах можно использовать fixture, но в production:

3 реальные duplicate-пары не трогать;

никаких cancel/merge;

никаких access_end_at правок;

это только H3.x-b.

11. **Если появится необходимость unique constraint — STOP.**

Не пытаться “быстро” добавить constraint в этом плане. Отдельно:

План: H3.x-a-migration — atomic duplicate prevention

С этими правками план можно выполнять как **code+tests+proof без data repair и без включения mode=on**.

&nbsp;

План: H3.x-a — duplicate subscriptions root-fix (public-link / admin subscription writers)

## Цель

Закрыть три причины новых active-дублей `subscriptions_v2`, выявленных в H4 preconditions:

- B-1 — race в `create-payment-checkout` / `public-link-subscription` (две вставки `subscriptions_v2` за 2 минуты при одном order/checkout).
- B-2 — отсутствие «extend existing active» ветки в writer'е public-link-subscription (при same user/product/tariff + уже есть provider-managed active sub писатель создаёт **новую** sub вместо reuse/extend).
- B-3 — audit coverage gap для `admin_subscription` (~50% recurring-платежей в `dry_run` без audit-следа).

Этот патч — **только root-fix причин**. Repair 3 пар дублей выносится в отдельный план H3.x-b после approve.

## Diagnose — что уже известно из discovery

1. **SOT-guard уже есть, но product-level:** `_shared/subscription-conflict.ts::checkSubscriptionConflict()` блокирует new sub при наличии provider-managed active/trial/past_due **на том же продукте** (tariff-agnostic). Вызывается из:
  - `_shared/create-payment-checkout.ts` (line ~482) — public-link-subscription branch.
  - `bepaid-create-subscription-checkout/index.ts` (line ~315).
2. **F3 pending dedup существует**, но он ловит только pending-orders в окне 3 дня (line 504-518 create-payment-checkout). Не защищает от: (a) parallel insert до коммита первой; (b) случая когда первый order уже paid, но клиент перезапускает checkout.
3. **Pre-create `subscriptions_v2` (line 716-730)** идёт `.insert(...)` без unique-key/upsert по `(user_id, product_id, status='past_due', order_id)` — две параллельные транзакции спокойно создают 2 строки.
4. **Reuse-ветка возвращает существующий pending order** (line 544-563) — корректно, но НЕ покрывает кейс «уже есть provider-managed active sub того же tariff и пользователь оплачивает ту же ссылку повторно».
5. **B-2 root cause:** `checkSubscriptionConflict` возвращает `status='conflict'` для same-product, и writer отвечает фронту `existing_subscription_conflict` — это правильно для replacement-flow, но **не для legitimate extend** (когда тариф **совпадает** и пользователь явно хочет продлить). Сейчас обоих случаев не различаем: всё это «конфликт» → пользователь вынужденно создаёт second checkout, попадая в B-1.
6. **B-3:** `admin_subscription` recurring (через `bepaid-webhook` provider-managed branch + `BEPAID_REBILL_MATERIALIZATION=dry_run`) логируется audit-action'ом, но только когда соблюдены условия dry-run матчинга; часть admin-flow (notify-only прямые charges из `direct-charge` / `subscription-charge`) не пишет в audit в случае «would_materialize». Покрытие ~50% по выборке из H4 proof §B-3.

## Scope (что трогаем)

Read/edit:

- `supabase/functions/_shared/subscription-conflict.ts` — добавить второй helper: `classifySameProductState()` → различает `extend_same_tariff` / `replace_other_tariff` / `no_existing` (без изменения существующего `checkSubscriptionConflict`, чтобы не сломать current callers).
- `supabase/functions/_shared/create-payment-checkout.ts` — subscription branch:
  - До F3 pending-dedup вызвать `classifySameProductState`;
  - Если `extend_same_tariff` + есть alive checkout_url → reuse (как сейчас pending);
  - Если `extend_same_tariff` без alive checkout → возвращать `subscription.reused_existing_public_link` (без insert новой past_due) и редиректить на bePaid `manage`/новый checkout строго с `replacement_of_subscription_v2_id=<existing.id>`;
  - Перед `subscriptions_v2.insert(...)` обернуть всё в advisory lock на ключ `hashtext(user_id||product_id||'sub-precreate')` (через `pg_advisory_xact_lock` в RPC-обёртке, если PG-функция отсутствует — STOP и переключиться на отдельный migration-план).
- `supabase/functions/bepaid-create-subscription-checkout/index.ts` — то же отличение extend/replace.
- `supabase/functions/bepaid-admin-create-subscription-link/index.ts` — пройти по тому же helper'у.
- `supabase/functions/bepaid-webhook/index.ts` (provider-managed branch) — обязательный audit на каждое `would_materialize` / `materialized` / `skipped` решение для `admin_subscription` ветки (B-3 closure).

Read-only refs:

- `subscriptions_v2` schema contract (нет unique constraint на `(user_id, product_id, status)`).
- `provider_subscriptions` SOT for provider linkage.
- `audit_logs` schema (action/actor_label/meta).

## Что меняется в логике

```text
public-link subscription writer
─────────────────────────────────────────────
Before:                          After:
1. validateReplacement (if id)   1. validateReplacement (if id) — без изменений
2. checkSubscriptionConflict     2. classifySameProductState:
   → conflict ⇒ error               ├─ extend_same_tariff
3. F3 pending dedup → reuse|new  │  ├─ alive pending order → reuse (как сейчас)
4. INSERT orders_v2              │  └─ нет alive → reuse существующего
5. INSERT subscriptions_v2 (race)│       (audit: reused_existing_public_link)
   ─────────────────────────────│       НЕ создаём новой past_due sub
                                 │  ├─ replace_other_tariff → текущий conflict-flow
                                 │  └─ no_existing → продолжаем как раньше
                                 3. F3 pending dedup → reuse|new
                                 4. advisory_xact_lock(user||product||'sub-precreate')
                                 5. внутри лока: re-check #2 (idempotency)
                                 6. INSERT orders_v2 + subscriptions_v2
                                    (audit: race_insert_avoided если re-check сработал)
```

## Tests (Deno, `*_test.ts`)

В `_shared/subscription-conflict_test.ts`:

- `classifySameProductState` returns `extend_same_tariff` для same user+product+tariff active+provider-managed.
- Returns `replace_other_tariff` для same product, другого tariff_id.
- Returns `no_existing` для zombie без provider linkage.

В `bepaid-create-subscription-checkout_test.ts` (новый):

- Same tariff + alive provider sub → reuse, без `subscriptions_v2.insert`.
- Same product, другой tariff → текущий 409 conflict.
- Parallel calls (mock) с одинаковым user/product → только одна `INSERT` проходит (re-check внутри advisory lock).
- Idempotent retry на тот же order_id → reuse.

В `bepaid-webhook_test.ts` (доп. кейсы):

- `admin_subscription` recurring `would_materialize` → audit-row создан с action `admin_subscription.audit_coverage_fixed`.
- Regression: existing 54/54 проходят без изменений.

В `_shared/create-payment-checkout_test.ts` (или новый):

- Legitimate replacement_of_subscription_v2_id flow не ломается.

## Audit actions (новые)


| action                                       | когда                                                                                                                             |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `subscription.reused_existing_public_link`   | extend_same_tariff + reuse без new insert                                                                                         |
| `subscription.extended_existing_public_link` | bePaid extend-callback на reused sub (зарезервирован для H3.x-b webhook ветки, в этом патче только декларация и emitter в writer) |
| `subscription.duplicate_create_blocked`      | re-check внутри advisory lock сработал                                                                                            |
| `subscription.race_insert_avoided`           | две parallel-вставки, вторая ушла в reuse                                                                                         |
| `admin_subscription.audit_coverage_fixed`    | каждое решение bepaid-webhook по admin_subscription                                                                               |


## Запреты

- ❌ Никакого DML по 3 найденным duplicate-парам (Rabchewskaya и пара 2026-05-13/14/16). Это H3.x-b.
- ❌ `BEPAID_REBILL_MATERIALIZATION` остаётся `dry_run`.
- ❌ `mode=on` не включаем.
- ❌ Production DML = 0 (только code + tests + audit-emitters).
- ❌ Migrations = 0. Если advisory_xact_lock потребует RPC (PG-функцию-обёртку, недоступную из supabase-js напрямую) — **STOP** и отдельный план H3.x-a-migration с одной migration: `CREATE FUNCTION public.try_subscription_precreate_lock(uuid, uuid) RETURNS boolean`. До approve этого подплана writer оставляем без лока (B-1 закрывается только частично через re-check inside transaction, B-2/B-3 закроем полностью).

## Stop conditions

- Если по ходу обнаружим, что race возможен только через RPC-обёртку — стопаем и выносим в H3.x-a-migration.
- Если `bepaid-webhook` правки выходят за рамки audit-emitter (нужны изменения write-path materialization) — STOP, это уже H4.

## DoD

- Proof `.lovable/proofs/h3x_duplicate_subscriptions_root_fix_2026_05.md` со списком:
  - снимок diff'ов (filenames + сводка);
  - результаты тестов (фактические counts pass/fail для затронутых функций);
  - `deno check` чистый;
  - secret `BEPAID_REBILL_MATERIALIZATION=dry_run` подтверждён;
  - подтверждение DML=0, migrations=0;
  - явный список того, что НЕ сделано (data repair, mode=on, миграции).
- `.lovable/plan.md` обновлён: `H3.x-a = closed (или closed+deployed после approve deploy)`, `H3.x-b = pending dry-run plan`.
- Все 5 новых audit-action'ов используются хотя бы в тестах.

## Что дальше (анонс — не часть этого плана)

После закрытия H3.x-a → отдельный план:

**H3.x-b — duplicate subscriptions repair dry-run**

- Dry-run по 3 найденным duplicate-парам;
- Выбор canonical (max access_end_at, иначе latest paid order, иначе latest provider_subscription state=active);
- Подготовка merge/cancel-плана без снижения access_end_at и без поломки entitlements;
- Execute — только после отдельного approve.