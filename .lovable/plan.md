да, согласен, с учетом правок:

Все пункты плана сохраняются по принципу add-only/no-loss. Approve B.1 разрешён после следующих уточнений.

**1. Расширить точный scope на два существующих contract-файла**

Текущий scope из четырёх файлов недостаточен, потому что меняются:

- сигнатура ResolverDeps.buildStripeClient;
- набор machine codes;
- формат результата factory.

Mapping:

старый scope

→ новый scope add-only

Дополнительно разрешить изменения только в:

supabase/functions/_shared/payments/documents/types.ts

supabase/functions/_shared/payments/documents/stripe-documents.ts

Причина:

- types.ts должен содержать новый discriminated result и безопасные коды;
- stripe-documents.ts должен принимать новую factory-сигнатуру и корректно обрабатывать причины отказа.

Итоговый максимальный scope B.1:

admin-payment-documents-resolve/index.ts

admin-payment-documents-resolve/index.test.ts

_shared/payments/documents/stripe-client-factory.ts

_shared/payments/documents/stripe-documents.ts

_shared/payments/documents/types.ts

.lovable/proofs/stripe_documents_drawer_v2_[resolver.md](http://resolver.md)

Другие файлы не менять.

&nbsp;

**2. Не предполагать схему**

**acquiring_connections**

**и сигнатуру vault**

Перед реализацией выполнить read-only code/schema discovery:

фактические колонки acquiring_connections

фактическая сигнатура readAcquiringSecret

существующие account/mode helpers

существующий Stripe HTTP helper

текущая Stripe API version

Не хардкодить заранее:

test_mode

status

readAcquiringSecret('stripe', account_code, 'secret_key')

если фактический контракт проекта отличается.

Использовать существующий canonical helper 1:1. В proof указать реальную цепочку и реальные поля.

Если в проекте уже существует безопасный Stripe HTTP client с exact retrieve, переиспользовать его. Не создавать второй конкурентный Stripe transport.

Новый makeHttpStripeClient создавать только при доказанном отсутствии пригодного канонического helper.

&nbsp;

**3. Factory должна возвращать структурированный результат, а не**

**client | null**

Сигнатура:

type StripeClientResolution =

  | {

      ok: true;

      client: StripeRetrieve;

      accountCode: string;

      mode: "test" | "live";

      connectionId: string;

    }

  | {

      ok: false;

      code: StripeClientResolutionError;

      retryable: boolean;

    };

Использовать:

buildStripeClient(args: {

  accountCode: string | null;

  livemode: boolean | null;

  testMode: boolean | null;

}): Promise<StripeClientResolution>

null запрещён, поскольку он не позволяет различить:

account не найден

mode не найден

mode конфликтует

connection неоднозначен

vault недоступен

&nbsp;

**4. Account code resolver должен выявлять конфликт**

Источники:

meta.stripe.account_code

meta.account_code

Правила:

- если заполнен только один — использовать его;
- если заполнены оба и совпадают — использовать значение;
- если заполнены оба и различаются:

STRIPE_ACCOUNT_CODE_CONFLICT

Никакого молчаливого приоритета одного поля над другим.

Для acquiring_connections:

- 0 активных строк → STRIPE_ACCOUNT_NOT_RESOLVED;
- 1 активная строка → продолжить;
- >1 активных строк для одного provider/account_code → STRIPE_CONNECTION_AMBIGUOUS.

Нельзя использовать .single() без явной обработки неоднозначности.

&nbsp;

**5. Нормализация test/live marker**

Использовать оба возможных marker:

meta.stripe.livemode

meta.stripe.test_mode

Алгоритм:

только livemode:

  true  → live

  false → test

&nbsp;

только test_mode:

  true  → test

  false → live

&nbsp;

оба присутствуют:

  test_mode должен равняться !livemode

При противоречии:

STRIPE_MODE_CONFLICT

Если оба отсутствуют:

STRIPE_MODE_NOT_RESOLVED

После этого сравнить нормализованный payment mode с фактическим mode подключения.

При несовпадении:

STRIPE_MODE_MISMATCH

Никакого fallback на live/test connection.

&nbsp;

**6. Дополнить safe machine codes**

Добавить в canonical types:

STRIPE_ACCOUNT_NOT_RESOLVED

STRIPE_ACCOUNT_CODE_CONFLICT

STRIPE_CONNECTION_AMBIGUOUS

STRIPE_MODE_NOT_RESOLVED

STRIPE_MODE_CONFLICT

STRIPE_MODE_MISMATCH

STRIPE_SECRET_UNAVAILABLE

INVALID_STRIPE_RESOURCE

INVALID_STRIPE_ID

STRIPE_HTTP_ERROR

NETWORK_ERROR

REQUEST_TIMEOUT

Клиенту и audit передаётся только machine code и retryable.

Не передавать:

vault error message

Stripe response body

Stripe error message

stack trace

secret

Authorization header

&nbsp;

**7. Resource-specific ID validation**

Недостаточно общего isExactStripeId.

Ввести строгую таблицу:

payment_intents → ^pi_[A-Za-z0-9]+$

charges         → ^ch_[A-Za-z0-9]+$

invoices        → ^in_[A-Za-z0-9]+$

refunds         → ^re_[A-Za-z0-9]+$

credit_notes    → ^cn_[A-Za-z0-9]+$

subscriptions   → ^sub_[A-Za-z0-9]+$

Несовпадение resource и ID:

INVALID_STRIPE_ID

0 network calls

ID обязательно пропускать через encodeURIComponent, даже после regex validation.

Произвольный resource string запрещён — только enum.

&nbsp;

**8. Stripe API version и timeout**

Stripe-Version не выбирать заново.

Использовать ту же pinned version, которая уже применяется каноническим Stripe webhook/client в проекте.

В proof указать источник версии.

Каждый HTTP retrieve должен иметь AbortController/timeout.

При timeout:

REQUEST_TIMEOUT

retryable = true

При сетевой ошибке:

NETWORK_ERROR

retryable = true

При Stripe 4xx/5xx:

- не возвращать body;
- разрешено безопасно извлечь только:
- не включать message или full response.

&nbsp;

**9. Server-side connection lookup**

Lookup acquiring_connections и vault выполняются через существующий канонический server-side service client/helper.

Запрещено:

- передавать service-role или secret во frontend;
- использовать пользовательские значения connection ID;
- принимать account_code или mode из request body;
- доверять чему-либо кроме загруженной payments_v2 row.

Все account/mode данные определяются только из конкретного payment.

&nbsp;

**10. Lazy resolution**

Подтвердить фактическую последовательность:

JWT auth

→ RBAC refresh permission

→ payment UUID load

→ provider=stripe

→ refresh_provider=true

→ resolve account/mode

→ lookup active connection

→ vault read

→ exact Stripe retrieve

При refresh_provider=false:

0 acquiring_connections lookup

0 vault calls

0 Stripe HTTP calls

При provider не stripe:

0 Stripe factory calls

&nbsp;

**11. Production composition guard**

Статический тест на отсутствие строки () => null сохранить, но он не является единственным доказательством.

Добавить runtime composition test:

- импортировать production factory/composition;
- передать mock canonical connection lookup;
- передать mock vault;
- подтвердить, что factory реально строит StripeRetrieve;
- выполнить exact retrieve через mock fetch;
- получить whitelisted provider document.

Production entrypoint не должен иметь скрытого fallback stub.

&nbsp;

**12. Дополнить тесты**

К заявленным десяти добавить:

1. meta.stripe.account_code и meta.account_code различаются → conflict, 0 network.
2. Две active connections для одного account → ambiguous, 0 vault.
3. livemode и test_mode противоречат → mode conflict.
4. Connection mode отсутствует/невалиден → safe failure.
5. Resource charges + pi_* → invalid ID, 0 network.
6. Path-injection ID отклоняется.
7. Неизвестный resource отклоняется.
8. Stripe non-2xx не раскрывает response body.
9. Timeout → REQUEST_TIMEOUT.
10. Network throw → NETWORK_ERROR.
11. Request body не может подменить account/mode.
12. bePaid/local-only resolve не вызывает Stripe factory.

Итоговая цель:

не менее 48 тестов

0 failed

0 real network

0 production DB access

Если фактическое число выше — зафиксировать реальное.

&nbsp;

**13. Audit**

При refresh_provider=true audit должен отражать фактический итог factory:

stripe_account_resolved

stripe_mode

safe_error_code

retryable

Но не включать:

connectionId

secret name

secret value

vault path

Stripe URL

Stripe response body

connectionId допускается только в server-side diagnostics для super_admin, если это уже предусмотрено contract, и только masked. В audit его не писать.

&nbsp;

**14. Proof**

В обновлённом proof дополнительно показать:

- фактическую схему acquiring_connections;
- фактическую сигнатуру canonical vault helper;
- найденный/переиспользованный Stripe HTTP helper либо доказательство его отсутствия;
- account-code conflict matrix;
- mode normalization matrix;
- ambiguous connection guard;
- resource-prefix matrix;
- timeout/error sanitization;
- production composition runtime test;
- итоговое число тестов;
- полный список реально изменённых файлов;
- подтверждение отсутствия deploy/config/registry/frontend/DB изменений.

&nbsp;

**Gate status**

PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve A = PASS

PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve B = PARTIAL

PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve B.1 = APPROVED

Approve C = NOT APPROVED

Approve D = NOT APPROVED

После выполнения B.1 остановиться.

Deploy, frontend и production runtime не начинать.

&nbsp;

## Approve B.1 — Production wiring Stripe client в admin-payment-documents-resolve

Цель: устранить блокирующий недостаток `buildStripeClient = () => null` в production composition. Подключить канонический account+mode-aware Stripe client через существующие `_shared/acquiring/vault.ts` и `acquiring_connections`. Deploy и frontend запрещены.

### Scope (только эти файлы)

1. `supabase/functions/admin-payment-documents-resolve/index.ts` — заменить stub-фабрику на реальную lazy factory.
2. `supabase/functions/_shared/payments/documents/stripe-client-factory.ts` — НОВЫЙ shared-модуль: `createStripeClientForPayment(payment, deps)` + `StripeRetrieve` HTTP-реализация поверх `fetch` (только `*.retrieve(resource, id)`, exact ID).
3. `supabase/functions/admin-payment-documents-resolve/index.test.ts` — добавить ≥10 новых тестов (см. §6).
4. `.lovable/proofs/stripe_documents_drawer_v2_resolver.md` — обновить proof.

Никакие другие файлы, миграции, config.toml, registry, frontend, deploy — не трогаем.

### 1. Canonical chain (read-only)

```
payment.provider === 'stripe'
  ↓
account_code = payment.meta.stripe.account_code
            ?? payment.meta.account_code        (legacy fallback, тот же payment)
  ↓ (если null → STRIPE_ACCOUNT_NOT_RESOLVED, 0 network)
SELECT id, provider, account_code, test_mode, status
  FROM acquiring_connections
  WHERE provider='stripe' AND account_code=$1 AND status='active'
  ↓ (если 0 строк или status≠active → STRIPE_ACCOUNT_NOT_RESOLVED)
mode_marker = payment.meta.stripe.livemode (bool) ?? payment.meta.stripe.test_mode
  ↓ (если null/undefined → STRIPE_MODE_NOT_RESOLVED, 0 network)
assert: connection.test_mode === !mode_marker_live
  (mismatch → STRIPE_MODE_MISMATCH, 0 network, без раскрытия деталей)
  ↓
secret = readAcquiringSecret('stripe', account_code, 'secret_key')   // _shared/acquiring/vault.ts
  ↓ (throw → STRIPE_SECRET_UNAVAILABLE, secret/error message НЕ в response/audit)
StripeRetrieve = makeHttpStripeClient(secret)
```

Жёсткие запреты в factory:

- нет global default Stripe client;
- нет fallback на live при отсутствии test-секрета (и наоборот);
- нет выбора аккаунта по валюте/продукту/офферу/email/customer;
- нет прямого `Deno.env.get('STRIPE_SECRET_KEY')` (только через `readAcquiringSecret`).

### 2. HTTP Stripe client (whitelist API)

`makeHttpStripeClient(secret): StripeRetrieve` реализует ровно один метод:

```
retrieve(resource, id) → fetch(`https://api.stripe.com/v1/${resource}/${id}`,
  { headers: { Authorization: `Bearer ${secret}`, 'Stripe-Version': '<pinned>' } })
```

- pre-flight regex (повторно использует `isExactStripeId`), иначе `{ ok:false, error:{ code:'INVALID_ID' } }` без network;
- ресурс из enum: `payment_intents | charges | invoices | refunds | credit_notes | subscriptions`;
- ответ нормализуется в `{ok,status,data,error}`; **никаких полей карты/PII** не пробрасывается дальше (адаптер уже whitelist-ит, factory просто отдаёт `data`);
- сетевые ошибки → `{ok:false, error:{code:'NETWORK_ERROR'}}` без stack/secret.

### 3. Lazy resolution в entrypoint

В `index.ts`:

- удалить `buildStripeClient = async (_) => null`;
- объявить `buildStripeClient(account_code)` **без** реального построения здесь — фактически делегировать в `createStripeClientForPayment(payment, { supabase, readSecret })`;
- но т.к. текущий контракт `ResolverDeps.buildStripeClient(account_code)` берёт только `account_code`, расширяем до `buildStripeClient(payment): Promise<StripeRetrieve | null>` ИЛИ оставляем сигнатуру и резолвим mode внутри factory через дополнительный lookup payment.meta (передаём payment.meta как замыкание).
  - Решение: меняем сигнатуру deps на `buildStripeClient(args: { account_code: string; livemode: boolean | null }) => Promise<StripeRetrieve | null>` — payment.meta уже распаршен в основном flow, livemode извлекается там же и передаётся как аргумент. Это сохраняет DI-чистоту.
- factory вызывается **только** при `refresh && canRefresh && account_code`;
- при `refresh_provider=false` factory не вызывается → vault не читается → 0 network.

### 4. Безопасные коды отказа (machine codes, warning.detail)

Все возвращаются как `warnings: [{ code: 'PROVIDER_DOCUMENT_RETRIEVE_FAILED', retryable, detail: <code> }]`, без раскрытия секрета / vault error / Stripe HTTP body:

- `STRIPE_ACCOUNT_NOT_RESOLVED` — account_code пуст или нет active connection;
- `STRIPE_MODE_NOT_RESOLVED` — нет livemode-маркера в payment.meta;
- `STRIPE_MODE_MISMATCH` — connection.test_mode противоречит payment livemode;
- `STRIPE_SECRET_UNAVAILABLE` — vault throw;
- `NETWORK_ERROR`, `INVALID_ID`, плюс уже существующие Stripe error codes (передаются как есть из `error.code`, но без message).

### 5. Audit (без изменений контракта)

`admin.payment_documents.provider_refresh` пишется только при `refresh_provider=true`. В meta добавляется:

- `stripe_account_resolved: boolean | null`;
- `stripe_mode: 'test' | 'live' | null`;
- `safe_error_code` (уже есть) — пополняется новыми кодами.
Никогда не пишется: secret, vault error text, Stripe HTTP body, account secret key, full Stripe object.

### 6. Новые тесты (минимум 10, к существующим 28)

В `index.test.ts` (или новом `stripe-client-factory.test.ts` рядом):

1. `refresh_provider=false` → spy на factory: 0 вызовов; spy на vault: 0 вызовов; 0 network.
2. Stripe payment, валидный `account_code` + `livemode=false` + active test connection → factory вернула client, retrieve вызван exact, доки появились.
3. `account_code` отсутствует → `STRIPE_ACCOUNT_NOT_RESOLVED`, 0 network, 0 vault.
4. `account_code` есть, connection не найдена → `STRIPE_ACCOUNT_NOT_RESOLVED`, 0 vault.
5. `livemode` отсутствует → `STRIPE_MODE_NOT_RESOLVED`, 0 vault, 0 network.
6. test payment (livemode=false) против connection.test_mode=false → `STRIPE_MODE_MISMATCH`, 0 vault, 0 network.
7. live payment (livemode=true) против connection.test_mode=true → `STRIPE_MODE_MISMATCH`, 0 vault, 0 network.
8. Vault throw → `STRIPE_SECRET_UNAVAILABLE`; secret/error message отсутствуют в response и audit meta (assert по сериализованному JSON).
9. Exact charge retrieve → receipt URL появился, `source` содержит `provider_api`.
10. Exact invoice retrieve → hosted + pdf docs, dedup с локальными.
11. Production composition guard (статический тест): чтение исходника `index.ts`, assert что строка `= () => null` отсутствует и есть импорт `createStripeClientForPayment`.

Все тесты — без сети и без БД (через DI mocks). Цель: ≥38 тестов всего, 100% PASS, локально `supabase--test_edge_functions`.

### 7. Code-search proof (в обновлённом .md)

Команды и ожидаемые результаты:

```
rg -n '= \(\) => null' supabase/functions/admin-payment-documents-resolve/   → 0 matches
rg -n 'createStripeClientForPayment' supabase/functions/admin-payment-documents-resolve/index.ts   → ≥1
rg -n '\.list\(|\.search\(|autoPaging' supabase/functions/_shared/payments/documents/ supabase/functions/admin-payment-documents-resolve/   → 0
rg -n 'payments_v2' supabase/functions/admin-payment-documents-resolve/ supabase/functions/_shared/payments/documents/   → только SELECT, 0 INSERT/UPDATE/DELETE/upsert
rg -n 'bepaid-get-payment-docs' supabase/functions/admin-payment-documents-resolve/ supabase/functions/_shared/payments/documents/   → 0
rg -n "Deno\.env\.get\('STRIPE_SECRET_KEY" supabase/functions/admin-payment-documents-resolve/ supabase/functions/_shared/payments/documents/   → 0 (только vault path)
rg -n 'createSignedUrl' supabase/functions/admin-payment-documents-resolve/   → 1 (per-request, не сохраняется в БД)
```

### 8. Proof update

В `.lovable/proofs/stripe_documents_drawer_v2_resolver.md` добавить разделы:

- production composition graph (text ASCII);
- canonical vault/account/mode resolver chain (см. §1);
- test/live isolation matrix (4 кейса);
- exact retrieve calls (5 ресурсов + payment_intent.latest_charge);
- safe failure matrix (5 кодов × что НЕ попадает в response/audit);
- список новых тестов и итог (38+);
- подтверждение: `supabase--test_edge_functions` PASS, deploy НЕ выполнен.

### Gate

После B.1 — STOP. Approve C не начинать. Отчёт: `PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve B.1`.

### Жёсткие запреты

- deploy любой функции;
- любые миграции / RPC / новые таблицы;
- любые правки frontend / config.toml / registry;
- глобальный Stripe client, fallback на live, выбор аккаунта по валюте/продукту;
- запись secret/vault error/full Stripe object в response/audit/logs;
- любые `*.list/*.search/autoPaging/customer lookup/email lookup`;
- любые write-операции в `payments_v2`, `orders_v2`, `subscriptions_v2`, `ai_generated_documents`;
- запуск генерации документов;
- сохранение signed URL или provider URL в БД.