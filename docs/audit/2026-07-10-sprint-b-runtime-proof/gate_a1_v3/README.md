# Gate A.1 v3 — сводный отчёт

**Область.** Только backend: миграция RPC, edge `public-rr-installment-initiate`,
`_shared/rr/rr-adapter.ts`. React не менялся. Production `orders_v2`/`provider_events`
не создавались. Sprint B остаётся **FAIL** до PASS Gate A.2. Sprint C **не открывать**.

## Что сделано

### 1. Миграция `202607102040_gate_a1_v3.sql`

Полностью заменены тела всех critical RPC (return type: `void → jsonb` где нужно).
Все функции: `SECURITY DEFINER`, `search_path = public, pg_temp`, `EXECUTE` только
`service_role`.

| RPC | Изменения |
|---|---|
| `rr_get_config_flag(_key)` | Новая helper. Читает `app_settings` → boolean. Инициализированы два флага: `rr.not_created_resolution_enabled=false`, `rr.allow_new_order_enabled=false`. |
| `rr_insert_idempotent_audit_event(_order_id,_type,_payload)` | Единая точка идемпотентной аудит-записи. Enum-allowlist типов: `recovery_blocked_no_url / create_order_recovered / local_state_unconfirmed / audit_write_failed`. `ON CONFLICT DO NOTHING`. |
| `rr_mark_call_started(_order_id,_correlation_id) → jsonb` | **NEW.** Pre-call durable marker. Пишет `meta.rr.upstream_call_state='started'` **до** обращения к банку. Terminal → typed no-op. |
| `rr_get_or_create_pending_order(…)` | Добавлена ветка reuse №0 (высший приоритет): `upstream_call_state='started'` без terminal. Concurrency-ветка теперь исключает call_started (иначе fresh pending мог бы обойти pre-call marker). |
| `rr_finalize_created_order(...) → jsonb` | **Тело полностью заменено.** Postcondition: `initiation_status='created'`, `local_persist_failed=false`, `upstream_outcome='created'`, `reconciliation_status='confirmed_created'`, `upstream_call_state='completed'`. Guards: одинаковый URL → idempotent; другой URL из `created` → `rr_finalize_url_conflict`; из `failed` → `rr_finalize_from_terminal_forbidden`. |
| `rr_mark_local_persist_failed(...) → jsonb` | Typed result. Из terminal → no-op. |
| `rr_mark_upstream_unknown(...) → jsonb` | Typed result. Из terminal → no-op. |
| `rr_finalize_order_rejected(...) → jsonb` | Жёсткие guards: только из `pending`, `upstream_outcome IS NULL`, `local_persist_failed != true`. Из `created` → conflict, из `unknown` → invalid_source, из `local_persist_failed` → invalid_source. Идемпотентный повтор с тем же `reason_code`. |
| `rr_finalize_order_not_created(...) → jsonb` | **Contract-gated:** проверяется `rr.not_created_resolution_enabled`. Обязательный `_evidence` контракт: `provider_error_code / http_status / attempts (>=3) / first_checked_at / last_checked_at / endpoint_mode ∈ ('test','prod')`. Пустой `{}` → invalid. Source-state: только `pending + upstream_outcome='unknown' + recon ∈ (pending, operator_required)`. |
| `rr_reconcile_confirm_created(...) → jsonb` | Жёсткие source-state guards. Тот же URL из `created` → idempotent; другой URL → `rr_reconcile_url_conflict`. Из не-ambiguous → `rr_reconcile_invalid_source_state`. |
| `rr_operator_resolve(...,_evidence jsonb) → jsonb` | **Сигнатура изменена: DROP старой + CREATE новой.** Старая перегрузка проверена отсутствующей (`old_overload_check.txt`). Guards по каждому `_resolution`: `confirm_created` только из ambiguous (обязателен `_payment_url`); `allow_new_order` gated по `rr.allow_new_order_enabled` + требует непустой `_evidence` и `_note`; `keep_blocked` только из ambiguous. Override forbidden: замена уже принятого решения → ошибка. Идемпотентный повтор того же решения — no-op. |

### 2. Edge `public-rr-installment-initiate` (полная переработка)

- **Pre-call marker.** Перед `rrCreateOrder` вызывается `rr_mark_call_started` (1 retry). Сбой → HTTP 503 `persist_failed_pre_call`, банк не тронут.
- **Reuse ветка A.1.** `upstream_call_state='started'` без terminal → HTTP 503 `rr_call_in_flight`.
- **Retry marker RPC.** Все критические marker/finalizer RPC вызываются через `callWithSingleRetry`. При окончательной ошибке — HTTP 500 `local_state_unconfirmed`, а не «безопасный» 502/504.
- **Redacted ALERT.** `alertLocalStateUnconfirmed` пишет только: order_id, correlation_id, stage, failure_kind, http_status, provider_request_id, error_short(≤200). Без URL/PII/raw response.
- **Аудит через RPC.** `recovery_blocked_no_url`, `create_order_recovered`, `local_state_unconfirmed` пишутся через `rr_insert_idempotent_audit_event` (enum allowlist, `ON CONFLICT DO NOTHING`).
- **Read/poll errors.** Ошибки `.error` на reuse-read и polling `.maybeSingle()` явно возвращают `rr_reuse_state_read_failed` / `rr_reuse_poll_read_failed` (HTTP 500), не маскируются под timeout.

### 3. `_shared/rr/rr-adapter.ts`

- `RR_DOCUMENTED_REJECTION_CODES = []` — **пустой allowlist**. `upstream_rejected` возвращается **только** при точном совпадении `(httpStatus, providerCode)` с элементом allowlist.
- Все 4xx (включая 400/401/403/404/409/422 с любым `error`) без allowlist-совпадения → `upstream_outcome_unknown`. Это осознанный safe-default до заполнения `rr_provider_contract.md`.
- `classifyPaymentUrl` — https-only, без credentials.
- `redactRRResponse` — `link` не сохраняется, только `link_present` + `link_len`.

## Runtime proof

Артефакты собраны в `runtime_proof/` (реальные psql запросы к applied migration):

- `proconfig.txt` — все 11 RR-функций: `SECURITY DEFINER`, `search_path=public, pg_temp`.
- `grants.txt` — доступ только у owner (`sandbox_exec` = service_role в проекте).
- `has_function_privilege.txt` — `anon=false`, `authenticated=false`, `service_role=true` для всех проверенных RPC.
- `no_production_writes.txt` — snapshot `orders_v2` (9 строк) и `provider_events rr` (27 строк) — это baseline до Gate A.1 v3, никаких новых записей v3-миграцией не создано.
- `finalize_source.txt` — `pg_proc.prosrc` для `rr_finalize_created_order` (доказательство, что тело заменено, а не только `ALTER … SET search_path`).
- `old_overload_check.txt` — старая 6-аргументная перегрузка `rr_operator_resolve` **отсутствует** (`found=0`).

## State-machine (add-only, `meta.rr`)

```
                    ┌─── rr_get_or_create_pending_order (advisory lock, identity)
                    ▼
              orders_v2 INSERT
                    │
                    ▼
     provider_events: create_order_requested (idempotent)
                    │
                    ▼
      rr_mark_call_started  ─── FAIL(2×) ─▶ HTTP 503 persist_failed_pre_call
        (upstream_call_state='started')       (rrCreateOrder НЕ вызван)
                    │
                    ▼
             rrCreateOrder
                    │
    ┌───────────────┼─────────────────┐
    ▼               ▼                 ▼
  created        rejected      outcome_unknown
    │               │                 │
    ▼               ▼                 ▼
 canonical    rr_finalize_    rr_mark_upstream_
 finalize     order_rejected  unknown (retry)
 (retry)      (retry)          │
    │            │             ▼ HTTP 504 rr_upstream_unknown
    │            ▼             (reconciler в Gate A.2)
    │        HTTP 502
    │        rr_create_order_rejected
    ▼
  HTTP 200 payment_url

  FAIL canonical (retry ×2) → rr_mark_local_persist_failed (retry ×2)
       если и marker упал   → HTTP 500 local_state_unconfirmed
       (pre-call marker всё равно durable → reuse вернёт этот заказ)
```

Fail-closed инвариант: **любой заказ с `upstream_call_state='started'` и без
terminal outcome** переиспользуется той же identity без временных окон.
Двойной сбой post-call marker НЕ приводит к новому `orders_v2.id`.

## Что вынесено в Gate A.2 (BLOCKED до отдельного разрешения)

- Working reconciler (edge `rr-reconcile-order`, private, cron/service-role, `verify_jwt=true`, negative auth tests).
- Заполнение `rr_provider_contract.md` подтверждёнными test-response РР:
  документированный список rejection codes (для allowlist в adapter), поведение
  `getOrderStatus` (наличие/поле `link`), идемпотентность `createOrder` того же
  external_id, definitive `not_found`, retry/backoff policy.
- Активация `rr.not_created_resolution_enabled` и `rr.allow_new_order_enabled`
  только после подтверждения контракта.
- Integration tests (13 сценариев) в отдельной preview/test Supabase environment —
  включая pre-call marker сценарии: fault injection `rr_mark_call_started`,
  двойной сбой post-call marker, terminal state снимает pre-call block.
- Operator UI получает `_actor` из проверенного JWT (не свободный текст).

## Итоговый статус

| Компонент | Статус |
|---|---|
| Backend contract (миграция + edge + adapter) | **PASS (implementation)** |
| Runtime proof миграции | **PASS** (см. `runtime_proof/`) |
| Integration tests в preview/test env | **Не выполнено** — требует изолированной среды |
| Working reconciler | **Не выполнено** — Gate A.2 |
| Gate A.1 acceptance | **PARTIAL** — implementation готова, tests и reconciler в A.2 |
| Gate A.2 | **BLOCKED до отдельного разрешения** |
| Gate B (UI + public E2E) | **BLOCKED** |
| Sprint B | **FAIL** |
| Sprint C | **не открывать** |
