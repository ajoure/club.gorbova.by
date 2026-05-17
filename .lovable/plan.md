да, согласен, с учетом правок:

1. **Stage 1 Variant A не доказывает mode=off за 10 минут.**  
Отсутствие webhook-трафика за 10 минут ≠ доказательство. Но у нас уже есть сильный факт:

после flipped_at был succeeded recurring payment 489f08eb

REBILL-order не создан

bepaid.rebill.* audit не появился

payment склеился со старым order

Этого достаточно, чтобы считать runtime effectively not-on и идти к re-flip.

2. **Stage 3 должен учитывать runtime DML.**  
В плане написано DML=0, но если после reflip придёт live REBILL, webhook должен сам создать:

orders_v2 REBILL

payments_v2.order_id update

subscriptions_v2 / entitlements через grant-access-for-order

audit_logs

Формулировка:

Ручной DML запрещён. Runtime DML от live REBILL разрешён и является предметом проверки.

3. **После reflip не ждать bepaid.rebill.dry_run как норму.**  
Если mode=on, ожидаемое событие:

bepaid.rebill.materialized

meta.mode='on'

dry_run после reflip — это warning, а не подтверждение нормальной работы.

4. **Stage 2 reflip можно делать после Stage 0 без отдельного долгого Stage 1.**  
Логика:

Stage 0 подтвердил: после прошлого flip был реальный payment, но REBILL не создался.

=> mode фактически не on.

=> reflip нужен.

5. **После reflip перечитать/зафиксировать не только список secret names, но и runtime evidence.**  
Так как значение secret скрыто, подтверждение только через поведение:

следующий recurring payment → REBILL materialized

6. **H5.1b-Jan Stage 3 execute не запускать до reflip.**  
Сначала восстановить корректный runtime mode. Потом можно отдельно approve январский батч.
7. **Добавить rollback trigger: новый склеенный payment после reflip.**  
Если после reflipped_at появляется recurring succeeded payment, который снова приклеился к old parent order и нет bepaid.rebill.materialized, это fail.

Команда для Lovable:

План H4.1-recheck подтверждаю с правками.

&nbsp;

Выполни Stage 0 read-only:

- зафиксируй snapshot;

- подтверди платеж 489f08eb после flipped_at;

- подтверди, что он склеился со старым order;

- подтверди отсутствие bepaid.rebill.* audit после flipped_at;

- подтверди, что это означает runtime effectively not-on.

&nbsp;

После Stage 0 запроси approve на reflip secret.

&nbsp;

Если approve получен:

- выполнить update_secret BEPAID_REBILL_MATERIALIZATION = on;

- других secrets не трогать;

- ручной DML не выполнять;

- зафиксировать reflipped_at.

&nbsp;

После reflip:

- ждать первый live recurring autocharge;

- нормальное подтверждение mode=on = audit `bepaid.rebill.materialized` с meta.mode='on' и новый REBILL-order;

- если за 24h нет трафика — статус enabled_awaiting_first_rebill, без rollback;

- если новый recurring payment снова склеился со старым order — rollback secret обратно в dry_run и incident proof.

&nbsp;

H5.1b-Jan execute не запускать до отдельного approve после mode recheck.

Так план можно запускать.

&nbsp;

# План: H4.1-recheck — Mode mismatch diagnose & re-flip 2026-05

## Контекст

H5.1b-Jan Stage 0–2 принят. Frozen Jan green = 8 строк (4 fail → H5.2). Stage 3 execute заблокирован до подтверждения runtime mode=on.

## Что уже видно (read-only, DML=0)

1. **Secret присутствует:** `BEPAID_REBILL_MATERIALIZATION` в `fetch_secrets` listing (значение скрыто).
2. **Audit после flipped_at (`2026-05-16T21:03:50Z`):** `bepaid.rebill.%` событий = **0**. Последние dry_run-аудиты — 2026-05-16 16:31:05 UTC, ДО flip.
3. **Runtime gluing подтверждён:** с момента flip прошёл 1 succeeded payment (`489f08eb-2541-4bd3-9ad2-18e9aa99e45a`, 2026-05-17 06:15:39 UTC) → склеен с `SUB-26-MMVMU7XAIA3D` (order создан 2026-03-18). REBILL-order не создан, audit `bepaid.rebill.*` не записан.
4. **Код-путь:** `bepaid-webhook/index.ts:2526` читает `Deno.env.get('BEPAID_REBILL_MATERIALIZATION')` → `resolveKillSwitchMode()`. Дефолт и любое неизвестное значение → `"off"` (safe-by-default). Если `rebillMode === 'off'` — dispatcher вообще не входит в `runRebillFlow` и audit `bepaid.rebill.*` НЕ пишется.
5. **Вывод по сигналам:** runtime эффективно работает в режиме `off` (а не `dry_run`, как мы предположили в H5.1b-Jan по старым audit-записям). Старые dry_run-записи относились к окну ДО flip.

## Гипотезы причины

- **H-A:** secret физически содержит значение != `on` (`dry_run`/`off`/пусто) — flip H4.1 не сохранился, был перезаписан, или был сделан с опечаткой.
- **H-B:** secret = `on`, но edge-runtime инстансы используют старое значение из кэша (cold-start vs warm). Маловероятно через ~14 часов после flip — инстансы должны были переподняться.
- **H-C:** проблема в чтении: `Deno.env.get` возвращает что-то с лишними whitespace/BOM, и `.trim().toLowerCase()` не справляется (теоретически).

## Стадии

### Stage 0 — Read-only снимок (DML=0)

- Зафиксировать `snapshot_at_utc`.
- Полный список `bepaid.rebill.%` за 14 дней с разбивкой по `meta.mode`.
- Список всех succeeded payments с `paid_at > flipped_at` и флагом `glued_to_old_order` (order.created_at < paid_at - 7d).
- Все non-rebill audit'ы `bepaid.%` для платежа `489f08eb` (chain `subscription.processed → sync_dates → entitlement_extended → access_chain_applied → payment.upsert_from_last_transaction`).

### Stage 1 — Probe текущего значения secret (DML=0)

Нельзя прочитать значение secret напрямую. Probe выполняется одноразовой diagnostic-функцией / curl edge function (read-only path):

- Вариант A (предпочтительный, без нового кода): дождаться/спровоцировать любой bepaid webhook на тестовой подписке и проверить, появится ли `bepaid.rebill.dry_run` или `bepaid.rebill.materialized` audit. Если за окно 10 минут ничего — runtime mode эффективно = `off`.
- Вариант B (если допустим временный probe): задеплоить временную edge-функцию `__probe-rebill-mode` (verify_jwt=true, super_admin only), которая возвращает `{ raw_env_length, mode_resolved }` — без значения. После probe — удалить.

В этом плане выбираем **Вариант A** (без новых функций).

### Stage 2 — Re-flip secret на `on` (single secret update)

Если Stage 1 подтверждает mode != `on`:

- Вызвать `secrets--update_secret(['BEPAID_REBILL_MATERIALIZATION'])`.
- Пользователь вводит ровно строку `on` (lowercase, без пробелов, без кавычек).
- Зафиксировать `reflipped_at_utc`.
- Подождать 60–120 секунд, чтобы edge-runtime инстансы подтянули новое значение.

### Stage 3 — Verify runtime mode = on (DML=0)

Гейт перед любым H5.1b execute. Все условия должны выполниться, иначе Stage 3 H5.1b НЕ approve:

1. Появление первого `audit_logs` с `action='bepaid.rebill.materialized'` ИЛИ `'bepaid.rebill.dry_run'` с `meta.mode='on'` после `reflipped_at_utc`.
2. Подтверждение, что для следующего succeeded payment (после reflip):
  - создаётся новый `orders_v2` с `order_number LIKE 'REBILL-%'`;
  - `payments_v2.order_id` указывает на новый REBILL-order, а не на старую сделку;
  - `bepaid.rebill.materialized` audit содержит `meta.mode='on'`.
3. Smoke regression: `subscriptions_v2.access_end_at` для затронутого пользователя не уменьшился (сравнение с baseline pre-reflip).

Если за окно 24h после reflip нет ни одного rebill-trigger трафика — статус `enabled_awaiting_first_rebill`, и Stage 3 H5.1b ждёт первого live verify (как в H4.1).

### Stage 4 — Rollback (только при регрессии)

Триггеры:

- `bepaid.rebill.dispatcher_error` > 0 за 1h после reflip.
- `bepaid.rebill.conflict_uid` > 0.
- `subscriptions_v2.access_end_at` regression на любом затронутом user.
- Любой 5xx от bepaid-webhook вырос относительно baseline.

Действие: `secrets--update_secret(['BEPAID_REBILL_MATERIALIZATION'])` → значение `dry_run`. Сохранить proof инцидента.

## Что НЕ делаем в этом плане

- НЕ запускаем H5.1b-Jan Stage 3 execute.
- НЕ трогаем 4 manual_review (H5.2) и refund orphans (H5.3).
- НЕ меняем код edge function. Только secret value.
- НЕ создаём probe-функцию (Вариант B). Если Вариант A не даст сигнала за 24h — отдельный мини-план на probe.

## Proof artefact

`.lovable/proofs/h4_1_mode_recheck_and_reflip_2026_05.md`

Секции:

1. Stage 0 снимок (rebill audit за 14d, glued payments since flip, chain для 489f08eb).
2. Stage 1 решение (Вариант A — пассивное наблюдение).
3. Stage 2 reflip timestamp + список secret (имена).
4. Stage 3 verify (audit события, первый REBILL-order, regression checks).
5. Verdict: `runtime_mode=on` confirmed → H5.1b-Jan Stage 3 unblocked / `awaiting_first_rebill` / rollback.

## DoD

- Runtime mode фактически = `on` (подтверждено audit `bepaid.rebill.%` с `meta.mode='on'` ИЛИ статусом `enabled_awaiting_first_rebill`).
- Никаких новых склеек после `reflipped_at_utc` на succeeded payments с recurring-признаками.
- Готов отдельный approve gate на H5.1b-Jan Stage 3 (8 INSERT + 8 UPDATE + 9 audit).
- Proof файл закоммичен.

## Approve gates

1. **Approve этого плана** → Stage 0 (read-only снимок).
2. **Approve Stage 1 verdict** (mode != on подтверждён) → Stage 2 (secrets--update_secret).
3. **Approve Stage 3 verify** → отдельный approve на H5.1b-Jan Stage 3 execute.