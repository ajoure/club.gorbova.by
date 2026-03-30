Да, согласен, с учетом правок:

&nbsp;

1. В Step 1 не привязывайся к gafo:webhook:%. Для ручного запуска допустимы и admin/manual ветки. Проверка должна идти по source_event_key LIKE 'gafo:%' и по created_at >= proof_started_at.
2. Для runtime smoke критерий успеха — не только granted/extended. Допустимые исходы:  

  - grant-access-for-order: granted / extended / skipped / failed
  - subscription-charge: extended / failed / skipped
  - subscriptions-reconcile: revoked / expired / skipped  
  Главное — чтобы ledger-row записалась и прошла DDL/runtime-contract. Иначе ты можешь получить ложный FAIL на идемпотентном повторном вызове.
3. &nbsp;
4. Добавь proof_started_at в начало smoke-прогона и фиксируй before/after:  

  - SELECT now() как старт proof
  - counts по каждому path до вызова
  - counts после вызова  
  Не проверяй просто “последнюю строку”, иначе можно случайно поймать старую запись.
5. &nbsp;
6. В Step 1 для grant-access-for-order отдельно зафиксируй риск идемпотентности: если order уже обрабатывался, ожидаемый результат может быть skipped/already_active. Это не FAIL, если row валидна и reason_code/status/result корректны.
7. В Step 2 и Step 3 раздели статусы:  

  - PASS — path отработал и создал хотя бы одну новую валидную ledger row
  - BLOCKED_NO_ELIGIBLE_INPUT — нет подходящей подписки/кандидата для ветки
  - FAIL — row создана, но нарушает DDL/runtime-contract  
  Иначе отсутствие подходящих данных будет смешано с реальной ошибкой.
8. &nbsp;
9. В Step 4 для merge-proof проверяй не только наличие post_check, а что после update сохранились поля окна доступа:  

  - access_start
  - access_end
  - window_days
  - source_window_rule
  - previous_end  
  И отдельно: jsonb_object_keys(result->'post_check') = ровно {entitlement, telegram, subscription, ledger_row, target_resolution}.
10. &nbsp;
11. В proof-файлы добавь фактический invocation log:  

  - payload вызова
  - HTTP/result edge function
  - source_event_key найденной строки
  - ledger id
  - verdict PASS / BLOCKED_NO_ELIGIBLE_INPUT / FAIL  
  Без этого proof будет неполным и трудно воспроизводимым.
12. &nbsp;
13. Если цель — именно закрыть gate, лучше прогонять не “любые текущие данные”, а контролируемые кандидаты в preview/test окружении. Для prod-данных smoke допустим только если вызов гарантированно не меняет бизнес-состояние сверх уже разрешенного контракта.

&nbsp;

&nbsp;

После этих правок план можно считать готовым к выполнению.

# План: PATCH v22.4 — Runtime Smoke Execution

## Цель

Выполнить runtime smoke для 3 уже обёрнутых paths, получить реальные ledger rows, обновить proof-файлы из PENDING_RUNTIME_EVENT в PASS/FAIL.

## Текущий статус

- Ledger rows от v22.3 paths: **0** (все три PENDING)
- Тестовые данные доступны:
  - Order `73638223-...` (paid, product `73c29914-...`, tariff `56c35e86-...`, profile `2ef54ad1-...`)
  - Subscription `e53c5c45-...` (active, next_charge `2026-03-08`, profile `ebc0fecc-...`)
- DB old-value guard: всё чисто

## Шаги

### Шаг 1. Invoke grant-access-for-order

Вызвать edge function с тестовым order:

```
POST /grant-access-for-order
Body: { "orderId": "73638223-6503-46fb-883c-474495d31762" }
```

Затем запросить ledger row:

```sql
SELECT * FROM access_grant_ledger 
WHERE source_event_key LIKE 'gafo:webhook:%' 
ORDER BY created_at DESC LIMIT 1
```

Machine-check: action_type=grant/extend, status=granted/extended, reason_code=paid_order, target_type=product, source_subject_type=order, post_check с 5 canonical keys, access_start/access_end NOT NULL.

### Шаг 2. Invoke subscription-charge (renew)

Вызвать edge function:

```
POST /subscription-charge
Body: { "action": "process_renewals" }
```

Затем запросить ledger row с `source_event_key LIKE 'sub-renew:%'`.
Machine-check: action_type=extend, status=extended, reason_code=subscription_renew, target_type=subscription_tier.

**Риск:** единственная подходящая подписка `e53c5c45-...` с next_charge_at 2026-03-08 может не иметь валидного payment token. Если renew не произойдёт (payment fail), ledger row может быть `failed` — зафиксировать как допустимый runtime результат и проверить по failed-contract.

### Шаг 3. Invoke subscriptions-reconcile

Вызвать edge function:

```
POST /subscriptions-reconcile
Body: {}
```

Запросить ledger rows с `source_event_key LIKE 'cron-reconcile:%'`.
Machine-check по block-by-block mapping из плана v22.3.

**Риск:** может не найтись подписок с expired cancel_at / trial / access. Тогда block 4 (telegram sync) — единственный реальный кандидат. Зафиксировать, какие блоки сработали.

### Шаг 4. Проверка merge в updateLedgerPostCheck

Для каждого созданного row с post_check проверить:

```sql
SELECT id, 
  result->>'access_start' AS access_start,
  result->>'access_end' AS access_end,
  result->>'window_days' AS window_days,
  result->'post_check' IS NOT NULL AS has_post_check,
  jsonb_object_keys(result->'post_check') AS pc_keys
FROM access_grant_ledger
WHERE source_event_key LIKE 'gafo:%' OR source_event_key LIKE 'sub-renew:%' OR source_event_key LIKE 'cron-reconcile:%'
ORDER BY created_at DESC LIMIT 10
```

Убедиться: access window fields сохранены после merge.

### Шаг 5. Обновить proof-файлы

1. `p0_ledger_runtime_smoke_proof.txt` — заполнить фактическими runtime данными, поменять статус на PASS или FAIL
2. `p0_ledger_contract_validation_proof.txt` — добавить фактические runtime строки в секцию Runtime Validation Gate
3. Если какой-то path не сработал (нет подходящих данных) — оставить PENDING с пояснением

## Файлы


| Действие | Файл                                                      |
| -------- | --------------------------------------------------------- |
| Обновить | `.lovable/proofs/p0_ledger_runtime_smoke_proof.txt`       |
| Обновить | `.lovable/proofs/p0_ledger_contract_validation_proof.txt` |


## STOP-guard

Если хотя бы одна runtime row нарушает DDL contract → зафиксировать FAIL, не продолжать rollout.