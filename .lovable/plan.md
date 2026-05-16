# да, согласен, с учетом правок:

1. **Уточнить про DML.**  
В плане написано `DML любого вида запрещено`, но при `mode=on` реальный live REBILL сам создаст:

```text
orders_v2
payments_v2 order_id repoint / insert
subscriptions_v2 extend через grant-access-for-order
entitlements extend
audit_logs
```

Это ожидаемый runtime DML, а не ручной repair. Поэтому формулировку заменить:

```text
Запрещён ручной DML / repair DML. Runtime DML от bePaid webhook при первом live REBILL разрешён и является предметом проверки.
```

2. **Stage 2 “пассивное ожидание до 24h” не должно быть обещанием фоновой работы без механизма.**  
Нужно указать, как именно мониторим:
  - либо Lovable запускает проверку вручную через N часов;
  - либо есть cron/monitoring query;
  - либо после flip сразу фиксируем “on enabled, awaiting first traffic”, а verify делаем отдельным отчётом после появления события.
3. **Если за 24h нет трафика — это не незакрытый план, а статус** `enabled_awaiting_traffic`**.**  
Иначе задача зависнет. Лучше:

```text
Если за 24h нет live REBILL:
- proof фиксирует no_traffic;
- mode=on остаётся включённым;
- H4.1 получает статус enabled_awaiting_first_rebill;
- first live verify выполняется отдельным follow-up proof при первом событии.
```

4. **Gate 0 active duplicate count должен быть именно по** `(user_id, product_id, tariff_id)`**.**  
Не по `(user_id, product_id)`, чтобы не ловить разные тарифы как дубль.
5. **Stage 1 dry_run audit action проверить по фактическим именам.**  
В системе встречались `bepaid.rebill.dry_run`, `bepaid.rebill.decision_audit`. Не завязываться только на одно имя. В proof показать все `bepaid.rebill.%`.
6. **Telegram DM check сделать только если продукт требует Telegram.**  
Если REBILL по продукту без Telegram, пункт 8 должен быть `not_applicable`, а не fail.
7. **Rollback не должен делать data repair.**  
Это уже есть, но добавить: если первый live REBILL частично успел создать неправильные записи, rollback только переводит flag обратно в `dry_run`; исправление данных — отдельный incident repair.
8. **Добавить проверку parent order.**  
В Stage 3 явно проверить:

```text
parent order payments count не увеличился по provider_payment_id после flipped_at
parent order deal_date не изменился
```

9. **Добавить проверку REBILL-order статуса.**

```text
REBILL-order.status корректен:
- paid для успешного autocharge;
- refunded/full_refund — если webhook содержит refund logic.
```

10. **Секрет после включения перечитать дважды.**  
Один раз сразу после update, второй раз перед началом observation/verify. Это снизит риск UI/cache ошибки.
11. **До approve финально указать: это реальное production-включение.**  
Важно понимать: после Stage 1 новые автосписания уже начнут создавать реальные REBILL-сделки. Это не тестовый режим.

С этими правками план можно запускать.

Короткая команда:

```text
План H4.1 подтверждаю с правками.

Разрешаю controlled enable BEPAID_REBILL_MATERIALIZATION=on.

Важно:
- это production-включение;
- ручной DML запрещён, но runtime DML от первого live REBILL ожидаем и проверяется;
- если за 24h нет трафика, статус enabled_awaiting_first_rebill, без rollback;
- rollback только secret → dry_run, без data repair;
- first live REBILL verify обязателен при первом событии.

План: H4.1 — controlled enable BEPAID_REBILL_MATERIALIZATION=on
```

## Цель

Перевести `BEPAID_REBILL_MATERIALIZATION` из `dry_run` в `on` контролируемым способом, с фиксацией pre-state, проверкой первого реального autocharge и однозначными rollback-условиями. Никакого «широкого» включения без verify первого live REBILL.

## Жёсткие границы (запрещено)

- DML любого вида.
- Migrations.
- Schema / RLS changes.
- Изменение других secrets, кроме `BEPAID_REBILL_MATERIALIZATION`.
- Data repair (Рабчевская, G25, 45 phantom past_due, любые другие).
- Provider API write (cancel/charge/refund/subscription mutate).
- Telegram manual actions (DM, reinvite, queue insert).
- Любые unrelated fixes / рефакторинги.

Разрешено: `secrets--fetch_secrets`, `secrets--update_secret` (только `BEPAID_REBILL_MATERIALIZATION`), `supabase--read_query`, `supabase--edge_function_logs`, `supabase--analytics_query`, чтение кода, запись 1 proof-файла.

## Стадии

### Stage 0 — Pre-flight snapshot (read-only)

Зафиксировать `snapshot_at = now()` (Europe/Minsk) и собрать:

1. Текущее значение `BEPAID_REBILL_MATERIALIZATION` через `fetch_secrets` (ожидание: `dry_run`). Если ≠ `dry_run` — **STOP**, эскалация.
2. `secrets--fetch_secrets` — полный список имён (без значений), чтобы убедиться, что ничего смежного не трогаем.
3. Pre-snapshot метрики (SQL, read-only):
  - `active_duplicate_pairs_count` — пары `subscriptions_v2` с `status='active' AND auto_renew=true` по `(user_id, product_id, tariff_id)`.
  - `past_due_phantom_count` — `status='past_due' AND access_end_at IS NULL`.
  - `last_rebill_dry_run` — последние 10 `audit_logs.event='bepaid.rebill.dry_run'` с `payment_id`, `subscription_id`, `planned_rebill_order_payload`.
  - Для каждого из этих 10 — текущее состояние `subscriptions_v2` (`status`, `access_end_at`, `auto_renew`), последние `orders_v2` (родитель + дети), последние `payments_v2`.
  - `audit_logs` за 24h: счётчики `bepaid.rebill.dispatcher_error`, `bepaid.rebill.conflict_uid`, `bepaid.rebill.sbs_mismatch` (ожидание: 0).
4. Запись в proof в раздел **Pre-state**.

**Gate 0:** если pre-state не соответствует ожиданиям (≠ `dry_run`, появились dispatcher_error / conflict_uid / sbs_mismatch, появились active duplicates с `auto_renew=true`) — **STOP**, mode=on не включаем.

### Stage 1 — Flip switch

Единственное действие:

- `secrets--update_secret(['BEPAID_REBILL_MATERIALIZATION'])` → значение `on`.

Сразу после:

- Перечитать через `fetch_secrets` и зафиксировать в proof `flipped_at` (UTC + Minsk).
- Никаких других изменений в этом шаге.

### Stage 2 — Wait & observe (canary)

Пассивное ожидание первого реального bePaid autocharge (`bepaid-webhook` с `is_rebill=true`, реальный платёж, не dry_run).

Окно ожидания: до 24h. Если за 24h не появилось ни одного live REBILL — фиксируем «no traffic», план не закрывается, проверка переносится. На этом этапе НЕ откатывать — отсутствие трафика не является регрессом.

### Stage 3 — Verify первого live REBILL (read-only)

Для первого live REBILL (по `payments_v2.provider_payment_id` + `audit_logs.bepaid.rebill.materialized`) проверить:

1. Создан **отдельный** REBILL-order в `orders_v2` (новый id, `meta.source` указывает на rebill materialization).
2. `payments_v2.order_id` ссылается на **новый** REBILL-order, **не** на parent / старую мартовскую сделку.
3. Parent order не получил новый `payments_v2` за этот provider_payment_id.
4. `audit_logs` содержит запись `bepaid.rebill.materialized` с правильными `payment_id`, `order_id`, `subscription_id`.
5. `grant-access-for-order` вызван **по REBILL-order** (audit `grant.outcome` для нового order_id).
6. `subscriptions_v2.access_end_at` продлён корректно (`+access_days` от paid_at, без regression относительно pre-state).
7. `entitlements.expires_at` обновлён через GREATEST (никогда не уменьшился).
8. Telegram DM не дублируется: ровно один `telegram_messages` mirror per grant, нет двух «Доступ открыт!» подряд за окно ±5 минут.
9. `active_duplicate_pairs_count` post-state == pre-state (не вырос).
10. `dispatcher_error / conflict_uid / sbs_mismatch` за окно [flipped_at; now] == 0.

Записать каждый пункт с фактическими значениями в **Post-state** раздел proof.

### Stage 4 — Verdict

- **PASS** — все 10 пунктов Stage 3 зелёные → mode=on остаётся включённым, план H4.1 закрыт, дальше — расширенное наблюдение 5–7 дней отдельной задачей.
- **FAIL** — любой пункт Stage 3 красный → немедленный rollback (Stage 5).

### Stage 5 — Rollback (триггеры и действие)

**Триггеры rollback (любой из):**

- `audit_logs.bepaid.rebill.dispatcher_error` ≥ 1 после flipped_at.
- `audit_logs.bepaid.rebill.conflict_uid` ≥ 1 после flipped_at.
- `audit_logs.bepaid.rebill.sbs_mismatch` ≥ 1 после flipped_at.
- `payments_v2` за live REBILL привязан к parent order (не к новому REBILL-order).
- Появился новый active duplicate с `auto_renew=true` (post > pre).
- `access_end_at` regression (post < pre) у затронутой subscription.
- `grant-access-for-order` для REBILL-order завершился ошибкой / outcome ≠ success.
- Дубликат Telegram DM «Доступ открыт!» в пределах ±5 минут на один user_id + product_id.

**Действие rollback (единственное):**

- `secrets--update_secret(['BEPAID_REBILL_MATERIALIZATION'])` → `dry_run`.
- Зафиксировать `rolled_back_at`, причину (какой триггер), идентификаторы затронутых рядов в proof.
- Никакого DML / repair в рамках этого плана — последствия оформляются отдельной задачей.

## Proof

Единственный артефакт: `.lovable/proofs/h4_1_rebill_materialization_on_rollout_2026_05.md`.

Структура:

```
1. Pre-state (Stage 0)
2. Flip (Stage 1) — flipped_at
3. Observation window (Stage 2)
4. First live REBILL verify (Stage 3) — 10 пунктов с фактами
5. Verdict (Stage 4) — PASS / FAIL
6. Rollback (Stage 5) — только если был
```

## DoD

- Pre-state зафиксирован, gate 0 пройден.
- `BEPAID_REBILL_MATERIALIZATION` переключён ровно один раз (`dry_run` → `on`).
- Verify первого live REBILL выполнен по всем 10 пунктам, либо явно отмечено «no traffic in 24h».
- Verdict зафиксирован.
- Либо mode=on остаётся (PASS), либо rollback выполнен (FAIL) — без промежуточных состояний.
- Migrations = 0, DML = 0, provider API write = 0, Telegram manual = 0.
- Proof-файл создан.

## Контакты, которых может коснуться

На стадии flip — никого (флаг переключает только поведение последующих autocharge).

На стадии verify коснётся **первого** реального плательщика, у которого bePaid инициирует rebill после `flipped_at`. ФИО неизвестно заранее — фиксируется в proof по факту (по `profiles.full_name` через `payments_v2 → orders_v2 → user_id`). До flip-а конкретные ФИО назвать нельзя.

Заведомо **НЕ** трогаются:

- Алеся Хомич (G25, hold).
- Рабчевская Юлия (отдельный repair).
- 45 phantom past_due (wave 2, отдельно).
- Алёна Богинская (без дубля сейчас).