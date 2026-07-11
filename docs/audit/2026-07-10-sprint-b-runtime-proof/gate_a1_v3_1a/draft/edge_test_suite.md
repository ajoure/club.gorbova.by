# Deployed edge integration test suite Gate A.1 v3.1a (16 сценариев)

Статус: DRAFT. Запускать ТОЛЬКО в preview environment с mock RR endpoint и активным `RR_TEST_FAULT_MODE`.

## Общий контур

- Deploy `public-rr-installment-initiate` в preview с секретами:
  - `RR_BASE_URL` = mock RR URL (см. `mock_rr_ledger_contract.md`);
  - `RR_TEST_FAULT_MODE` = имя сценария (`mark_call_started_error`, ...).
- Все запросы к edge — с одинаковой identity (email/phone), если не указано иное.
- Ledger mock RR фиксирует: `{external_id, correlation_id, timestamp, endpoint, call_number, response_scenario}`.

## Сценарии

| # | Название | Fault mode | Ожидание |
|---|---|---|---|
| 1 | Happy path | нет | 200 payment_url, 1 createOrder |
| 2 | Parallel submit ×5 | нет | 5 requests → 1 createOrder, 4 из них получают `rr_call_in_flight` или reused |
| 3 | Canonical finalize повтор | нет | Второй запрос той же identity → 200 с тем же URL, 0 доп. createOrder |
| 4 | URL conflict | mock отдаёт другой URL при повторе | 500 local_state_unconfirmed |
| 5 | Post-call marker падает ×2 (unknown) | `mark_unknown_double_error` | 500 local_state_unconfirmed; state остаётся `started`; повтор через 31 мин — тот же order_id; 0 доп. createOrder |
| 6a | Первая marker attempt падает, retry успешен (unknown) | `mark_unknown_first_error` | eventually `outcome_unknown`; 1 createOrder |
| 6b | Первая persist-failed marker падает, retry успешен | `mark_persist_failed_first_error` | eventually `completed_unpersisted`; 1 createOrder |
| 7 | Recovery возвращает URL, не попадает в rr_call_in_flight | нет (после сценария 6b) | 200 с recovered URL |
| 8 | Ambiguous возвращает rr_reconciliation_pending | предварительно 5 | 202 `rr_reconciliation_pending` |
| 9 | Pre-call marker failure | `mark_call_started_error` | 503 persist_failed_pre_call; **rrCreateOrder=0** |
| 10 | Terminal typed-state из rr_mark_call_started | заказ уже created | rrCreateOrder=0; 200 с существующим URL |
| 11 | Unexpected typed state | `unexpected_typed_state` | failClosedReread; внешний вызов запрещён |
| 12 | Unsafe recovered URL | mock отдаёт `http://` при getStatus | 503 recovery_pending; внешний вызов запрещён |
| 13 | Reuse DB read failure | `reuse_read_error` | 500 local_state_unconfirmed; 0 createOrder |
| 14 | Polling DB read failure | `poll_read_error` | 500 local_state_unconfirmed |
| 15 | Safe-default 400/401/403/404/409/422 | mock отдаёт указанные коды | все → `upstream_outcome='unknown'` (пустой allowlist RR_DOCUMENTED_REJECTION_CODES) |
| 16 | Multi-candidate identity priority (edge) | preseed БД | edge получает `created`-кандидата, не `started` |

## Формат отчёта

`edge_integration_tests.md` в `runtime_proof/` — по каждому тесту:
- request (redacted);
- HTTP status + body;
- mock ledger snapshot за интервал;
- orders_v2 diff (до/после, только тестовый order_id);
- provider_events за интервал;
- вердикт PASS/FAIL;
- timestamp UTC;
- deploy revision + commit SHA.

## Что доказывает suite

- Для каждого сценария зафиксировано **точное число createOrder calls**.
- Сценарии 2, 5, 9, 10 доказывают отсутствие второго внешнего заказа при concurrency/failure.
- Сценарии 5, 6a, 6b доказывают fail-closed поведение post-call marker.
- Сценарий 12 доказывает, что unsafe URL никогда не отдаётся клиенту.

## Условие PASS

Gate A.1 v3.1a RUNTIME PASS только если все 16 сценариев PASS + `mock_rr_ledger.json` подтверждает ожидаемое число внешних вызовов.
