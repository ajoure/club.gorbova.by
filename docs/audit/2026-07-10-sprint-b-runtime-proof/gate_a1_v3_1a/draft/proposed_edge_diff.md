# Proposed edge diff: `public-rr-installment-initiate` (Gate A.1 v3.1a)

Файл: `supabase/functions/public-rr-installment-initiate/index.ts`.
Статус: DRAFT. Deploy запрещён до создания preview/test environment и полного прохождения SQL suite.

## 1. Compatibility fields в проверке already_* (пункт A5 плана)

Сейчас (v3.1) в reuse-ветке:

```ts
if (reuseResult.ok === true && reuseResult.state === "already_created") {
  return json(200, { payment_url: reuseResult.payment_url });
}
```

Изменение (v3.1a):

```ts
if (reuseResult.ok === true && reuseResult.state === "already_created") {
  if (reuseResult.same_payment_url !== true) {
    // conflict — не отдаём ни один URL, идём в failClosedReread
    return failClosedReread(orderId, "already_created_conflict");
  }
  if (!isSafePaymentUrl(reuseResult.payment_url)) {
    return failClosedReread(orderId, "already_created_unsafe_url");
  }
  return json(200, { payment_url: reuseResult.payment_url });
}
```

Аналогично для `already_persist_failed`:

```ts
if (persistResult.state === "already_persist_failed") {
  if (persistResult.same_payment_url !== true
      || persistResult.upstream_call_state !== "completed_unpersisted") {
    return failClosedReread(orderId, "already_persist_failed_incompatible");
  }
  // ...
}
```

И для `already_rejected`:

```ts
if (rejectResult.state === "already_rejected") {
  if (rejectResult.same_reason !== true) {
    return failClosedReread(orderId, "already_rejected_reason_conflict");
  }
  return json(409, { error: "already_rejected", code: rejectResult.provider_error_code });
}
```

И для `already_unknown`:

```ts
if (unknownResult.state === "already_unknown") {
  if (unknownResult.upstream_call_state !== "outcome_unknown") {
    return failClosedReread(orderId, "already_unknown_state_drift");
  }
  return json(202, { status: "rr_reconciliation_pending" });
}
```

## 2. Синхронизация приоритетов reuse-ветки с SQL (пункт A4)

`rr_get_or_create_pending_order` теперь возвращает единственного кандидата в правильном приоритете (SQL сам делает выбор). Edge больше не должен пытаться «перевыбирать» кандидата; достаточно смотреть возвращённые поля:

```ts
const reuse = await rpc("rr_get_or_create_pending_order", { ... });
switch (true) {
  case reuse.initiation_status === "created":
    return handleReuseCreated(reuse);
  case reuse.local_persist_failed === true:
    return handleReusePersistFailed(reuse);
  case reuse.upstream_outcome === "unknown":
    return json(202, { status: "rr_reconciliation_pending" });
  case reuse.meta_rr?.operator_resolution === "keep_blocked":
    return json(409, { error: "operator_blocked" });
  case reuse.upstream_call_state === "started":
    return json(409, { error: "rr_call_in_flight" });
  case reuse.state === "created_new":
    // ветка pre-call marker → rrCreateOrder
    break;
  default:
    return failClosedReread(reuse.order_id, "unexpected_reuse_state");
}
```

## 3. Fault-injection hook (пункт A6)

Preview-only import (dynamic, tree-shakable):

```ts
const faultMode = Deno.env.get("RR_TEST_FAULT_MODE");
const faultHook = faultMode
  ? await import("../_shared/rr/rr-test-fault-hook.ts").then(m => m.createHook(faultMode))
  : null;

// перед каждым критическим шагом:
if (faultHook?.shouldFail("mark_call_started_error")) {
  return json(500, { error: "local_state_unconfirmed", detail: "test-injected" });
}
```

Production build не выставляет `RR_TEST_FAULT_MODE` → import никогда не выполняется.
Grep по deployed bundle подтверждает отсутствие строки `rr-test-fault-hook` (доказательство — `fault_injection_absent_in_production.txt`).

## 4. Строгая валидация payment_url на клиенте

`isSafePaymentUrl` уже реализован в edge. Дополнительное условие v3.1a — если SQL-функция `rr_is_safe_payment_url` отклонила URL, edge должен получить `P0001 rr_payment_url_invalid` и отработать через `failClosedReread` (никогда не возвращать сырой URL).

## 5. Полная схема ответов edge

| Ситуация | HTTP | payload |
|---|---|---|
| happy path | 200 | `{ payment_url }` |
| already_created совместим | 200 | `{ payment_url }` |
| already_created конфликт URL | 500 | `{ error: "local_state_unconfirmed", detail: "already_created_conflict" }` |
| already_persist_failed совместим | 200 | `{ payment_url, recovered: true }` |
| already_persist_failed несовместим | 500 | `{ error: "local_state_unconfirmed", detail: "already_persist_failed_incompatible" }` |
| already_unknown корректно | 202 | `{ status: "rr_reconciliation_pending" }` |
| already_unknown drift | 500 | `{ error: "local_state_unconfirmed", detail: "already_unknown_state_drift" }` |
| already_rejected совместим | 409 | `{ error: "already_rejected", code }` |
| already_rejected reason drift | 500 | `{ error: "local_state_unconfirmed", detail: "already_rejected_reason_conflict" }` |
| pre-call marker failure | 503 | `{ error: "persist_failed_pre_call" }` |
| post-call marker failure ×2 | 500 | `{ error: "local_state_unconfirmed" }` |
| call_in_flight (parallel) | 409 | `{ error: "rr_call_in_flight" }` |
| unsafe recovered URL | 503 | `{ error: "recovery_pending" }` |

## 6. Что НЕ меняется на этом шаге

- Логика rrCreateOrder, rr-adapter, redaction, `RR_DOCUMENTED_REJECTION_CODES` (пустой allowlist) — без изменений.
- `_shared/rr/rr-http.ts`, `rr-adapter.ts` — без изменений.
- `rr-reconcile-order` — вне Gate A.1 v3.1a (Gate A.2).

## 7. Deploy plan

1. Preview environment secret `RR_TEST_FAULT_MODE` устанавливается только в preview.
2. Deploy в preview → 18 SQL tests + 16 edge integration tests.
3. Runtime proof собран → отдельный approval для production deploy.
4. Production deploy без `RR_TEST_FAULT_MODE` → grep bundle → `fault_injection_absent_in_production.txt` фиксирует отсутствие hook.
