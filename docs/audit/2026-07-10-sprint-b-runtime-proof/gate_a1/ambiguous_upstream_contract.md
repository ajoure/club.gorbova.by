# Ambiguous upstream contract

## Классификация ответов РР

Add-only поле в HTTP-слое: `failureKind ∈ { "timeout", "network", "invalid_json", "http", "invalid_response", null }`. Определяется по типу транспортного/протокольного сбоя (`AbortController`, `fetch` throw, `JSON.parse` throw, HTTP status), **не** по тексту exception.

| Результат | `outcomeClass` | `failureKind` |
|---|---|---|
| 2xx + валидный `link` (https, без credentials) + без `error` | `upstream_created` | `null` |
| 2xx без `link` / невалидный `link` / пустой `link` | `upstream_outcome_unknown` | `invalid_response` |
| JSON syntactically invalid | `upstream_outcome_unknown` | `invalid_json` |
| Timeout (`AbortController`) | `upstream_outcome_unknown` | `timeout` |
| Network error / status 0 | `upstream_outcome_unknown` | `network` |
| HTTP 5xx | `upstream_outcome_unknown` | `http` |
| HTTP 408 / 425 / 429 | `upstream_outcome_unknown` | `http` |
| Документированный validation rejection (4xx с `error` телом, кроме 408/425/429) | `upstream_rejected` | `http` |
| Недокументированный 4xx | `upstream_outcome_unknown` (консервативно) | `http` |

`provider_request_id` записывается **только** если РР реально вернул `json.id: string` в 2xx-ответе. Никакого fallback `json.id ?? externalId`.

Валидация `payment_url`:
- тип `string`, непустой;
- `protocol === "https:"`;
- без `username`/`password` в URL;
- (host allowlist оставлен для Gate A.2 после подтверждения списка хостов РР).

## Обработка на стороне edge

### `upstream_created`
Атомарный `rr_finalize_created_order`. Ответ 200 `{ payment_url, order_id, reused:false }`.

### `upstream_rejected` (документированный отказ РР)
Атомарный `rr_finalize_order_rejected(order_id, reason_code, http_status, response_snippet)`. Событие `create_order_rejected` (idempotency). Ответ **HTTP 502 `rr_create_order_rejected`**. Заказ становится terminal `failed`, `upstream_outcome='rejected'`. **Разрешается** новый заказ (новый `external_id`).

### `upstream_outcome_unknown`
Атомарный `rr_mark_upstream_unknown(order_id, provider_request_id?, failure_kind, http_status, correlation_id)`:
- `meta.rr.upstream_outcome = 'unknown'`, `reconciliation_status = 'pending'`, `reconciliation_attempts = 0`;
- сохраняем `provider_request_id` если он реально получен;
- событие `create_order_outcome_unknown` (идемпотентно).

Ответ **HTTP 504 `rr_upstream_unknown`** c `{ order_id }`. Любой повторный submit того же identity получит тот же `order_id` через reuse RPC → **HTTP 503 `rr_reconciliation_pending`**, никаких новых `orders_v2.id`, никаких `rrCreateOrder`.

## Reconciliation (вынесено в Gate A.2)

Reconciler — непубличная edge-функция `rr-reconcile-order`, использует существующий `rrGetOrderStatus` из `_shared/rr/rr-adapter.ts` (не создавать `rrClient.ts`).

Маппинг результата:

| Ответ РР | Действие | RPC | Разрешён новый заказ? |
|---|---|---|---|
| заявка существует, `payment_url` восстановим | canonical finalize + audit event атомарно | `rr_reconcile_confirm_created` | нет |
| заявка **достоверно** отсутствует (документированный код + подтверждённая retry/grace policy) | terminal not_created | `rr_finalize_order_not_created` | **да** |
| одиночный `not_found` без подтверждения контракта РР | `reconciliation_status='operator_required'`, alert оператору | обновление meta | нет |
| заявка существует, URL не восстановим | `reconciliation_status='operator_required'`, alert | обновление meta | нет |

**Одиночный `not found` не является definitive rejection.** До подтверждения RR-контракта (см. `rr_provider_contract.md`) любой `not_found` → `operator_required`, terminal `not_created` не выставляется автоматически.

Terminal-guard: reconciler не трогает заказы, у которых `initiation_status ∈ ('created','failed')`. Backoff/attempts policy — в Gate A.2.

## Что запрещено

- Повторный `rrCreateOrder` с тем же `external_id` — до подтверждения идемпотентности createOrder у РР (см. `rr_provider_contract.md`).
- Создание нового `orders_v2.id` пока identity имеет active durable-block (recovery / unknown / operator_required / resolved+keep_blocked/confirm_created).
- Смешивание событий `create_order_rejected` и `create_order_confirmed_not_created` — это **разные факты**.
- Использование `local_persist_failed` для rejection или ambiguous.
