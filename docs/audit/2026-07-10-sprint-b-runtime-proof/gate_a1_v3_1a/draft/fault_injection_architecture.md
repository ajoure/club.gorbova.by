# Fault-injection architecture (preview-only)

## Цель

Дать возможность интеграционным тестам детерминированно воспроизводить редкие runtime-сбои (network, DB, provider) — **только** в preview environment — без единой строки test-only кода в production bundle.

## Ключевой принцип

**Никакой публичный вход (body/header/query) не активирует fault mode.**
Активация — исключительно server-side secret, доступный только в preview project.

## Компоненты

### 1. Preview secret

- Название: `RR_TEST_FAULT_MODE`.
- Место: только preview Supabase project → Edge Function Secrets.
- Значения: имя сценария из allowlist (`mark_call_started_error`, `mark_unknown_first_error`, `mark_unknown_double_error`, `mark_persist_failed_first_error`, `mark_persist_failed_double_error`, `finalize_created_error`, `unexpected_typed_state`, `reuse_read_error`, `poll_read_error`).
- Пустое/отсутствующее значение = production-режим (hook не активен).

### 2. Dynamic import hook

Файл: `supabase/functions/_shared/rr/rr-test-fault-hook.ts`.
Экспортирует `createHook(mode: string)` с методом `shouldFail(step: string): boolean` и счётчиком попыток per-request.

Импортируется динамически:

```ts
const faultMode = Deno.env.get("RR_TEST_FAULT_MODE");
const faultHook = faultMode
  ? await import("../_shared/rr/rr-test-fault-hook.ts")
      .then(m => m.createHook(faultMode))
  : null;
```

Deno tree-shakes dynamic import при отсутствии активации → в production bundle строка `rr-test-fault-hook` не появляется.

### 3. Точки инъекции

Перед каждым критическим шагом edge вызывает:

```ts
if (faultHook?.shouldFail("<step>")) { ... short-circuit response ... }
```

Шаги (совпадают с allowlist):
- `reuse_read_error` — перед первым `SELECT` reuse;
- `mark_call_started_error` — перед `rr_mark_call_started`;
- `mark_unknown_first_error` / `_double_error` — вокруг `rr_mark_upstream_unknown`;
- `mark_persist_failed_first_error` / `_double_error` — вокруг `rr_mark_local_persist_failed`;
- `finalize_created_error` — вокруг `rr_finalize_created_order`;
- `unexpected_typed_state` — эмуляция дрейфа payload;
- `poll_read_error` — перед polling reuse.

Значение allowlist проверяется на входе `createHook`; неизвестный mode → throw в preview (fail fast).

## Доказательство отсутствия в production

1. **Bundle grep.** После production deploy запустить:
   `grep -R "rr-test-fault-hook" <deployed_bundle>` → пусто.
2. **Secret audit.** `fetch_secrets` в production project не содержит `RR_TEST_FAULT_MODE`.
3. **CI check.** GitHub Actions workflow отклоняет production deploy, если в bundle содержится строка `rr-test-fault-hook` или переменная `RR_TEST_FAULT_MODE` перечислена в production config.

Артефакты runtime proof:
- `fault_injection_enable_disable.txt` — журнал preview enable/disable;
- `fault_injection_absent_in_production.txt` — вывод grep;
- `deploy_proof.txt` — deploy revision + timestamp.

## После завершения suite

- `RR_TEST_FAULT_MODE` удаляется из preview environment.
- Ledger mock RR экспортируется.
- Preview redeploy без секрета — проверяется, что hook больше не активируется.

## Что нельзя делать

- Не активировать fault mode в production ни при каких условиях.
- Не читать fault mode из request body/header/query.
- Не логировать значение секрета.
- Не оставлять preview с активным `RR_TEST_FAULT_MODE` дольше, чем длится текущий тест.
