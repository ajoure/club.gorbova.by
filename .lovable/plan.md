да, согласен, с учетом правок:

Все пункты плана сохраняются по принципу add-only/no-loss. Approve B разрешён после следующих уточнений.

**1. Config и registry не означают deploy**

В Approve B разрешены repo-only изменения:

supabase/config.toml

supabase/functions.registry.txt

Добавить:

[functions.admin-payment-documents-resolve]

verify_jwt = true

Но зафиксировать в proof:

function deployed = false

runtime production unchanged = true

Shared-файлы входят в bundle будущей функции и отдельно не деплоятся.

&nbsp;

**2. Использовать канонический RBAC-helper, а не проверять названия ролей вручную**

Не реализовывать разрозненные проверки вида:

role === admin || role === accountant

Использовать существующий канонический helper/guard, найденный в Approve A.

Правила:

- просмотр разрешён только пользователю, который уже имеет действующее право просмотра платежей;
- accountant получает просмотр только в том случае, если существующий payment-RBAC уже это разрешает;
- refresh_provider=true — только существующий строгий edit/admin guard;
- diagnostics — только super_admin;
- обычный пользователь — 403.

Новые permission names, роли, таблицы и migrations не создавать.

&nbsp;

**3. Зафиксировать HTTP-контракт функции**

Минимальные ответы:

400 INVALID_REQUEST

401 UNAUTHORIZED

403 FORBIDDEN

404 PAYMENT_NOT_FOUND

200 RESOLVED

Ошибка одного provider adapter не должна превращать весь resolve в 500.

При Stripe/bePaid API failure функция возвращает:

{

  "provider_documents": [

    {

      "status": "error"

    }

  ],

  "warnings": [

    {

      "code": "PROVIDER_DOCUMENT_RETRIEVE_FAILED",

      "retryable": true

    }

  ]

}

Raw provider error text клиенту не возвращать.

500 допустим только для необработанной внутренней ошибки resolver.

&nbsp;

**4. Устранить противоречие по Stripe Credit Note**

В этом патче запрещены Stripe list/search.

Поэтому credit note разрешено получать только при наличии точного доказанного:

cn_*

Наличие только invoice_id не разрешает выполнять:

creditNotes.list({ invoice })

Если точного credit_note_id нет:

credit note = unavailable

Не искать credit note по customer, invoice history, refund, сумме или дате.

&nbsp;

**5. Exact retrieve chain**

Допустима только цепочка по точным ID, уже связанным с payment:

payment_intent_id → retrieve PI

charge_id → retrieve Charge

invoice_id → retrieve Invoice

refund_id → retrieve Refund

credit_note_id → retrieve Credit Note

subscription_id → retrieve Subscription

Разрешено использовать точный ID, полученный из exact-retrieved объекта, например:

PaymentIntent.latest_charge = ch_*

Invoice.payment_intent = pi_*

При этом запрещены:

list

search

поиск по customer

поиск по email

поиск по сумме

поиск по дате

В тестах отдельно доказать отсутствие вызовов list/search.

&nbsp;

**6. Определить canonical external_id для каждого provider document**

Дедупликация невозможна без стабильного external_id.

Использовать:

Stripe receipt       → charge_id

Stripe hosted invoice → invoice_id

Stripe invoice PDF    → invoice_id

Stripe credit note    → credit_note_id

bePaid receipt        → transaction.uid или provider_payment_id

Canonical identity:

provider + document_type + external_id

URL не является identity и не используется для дедупликации.

Если bePaid receipt URL существует, но отсутствуют и transaction UID, и provider payment ID:

status = unavailable

warning = PROVIDER_DOCUMENT_ID_NOT_RESOLVED

Не дедуплицировать по URL.

&nbsp;

**7. bePaid refresh остаётся строго read-only**

Если существующая bePaid retrieval-логика неотделима от записи в:

payments_v2

orders_v2

provider_response

receipt_url

её не вызывать.

Тогда поведение:

локальный receipt найден → показать

локальный receipt отсутствует → BEPAID_REFRESH_NOT_AVAILABLE_READ_ONLY

Не считать это ошибкой всего drawer.

bepaid-get-payment-docs не вызывать, если он имеет write-side-effects.

&nbsp;

**8. Generation status — только через доказанно read-only entrypoint**

Нельзя вызывать существующий endpoint только потому, что он называется resolver, если внутри возможны:

document generation

document number allocation

audit generation action

DB update

Допустимо:

- использовать существующий pure/read-only shared resolver;
- вынести из канонического resolver чистую read-only функцию без изменения правил;
- вызвать существующий endpoint только после доказательства отсутствия write-side-effects.

Если pure read-only entrypoint отсутствует и его нельзя безопасно выделить:

STOP

GENERATION_RESOLVER_NOT_READ_ONLY

Не копировать document_scenarios и generation-правила в новый resolver.

&nbsp;

**9. Internal documents: не угадывать версии**

Использовать только:

payment.order_id

→ ai_generated_documents.order_id

Правила:

- identity каждого документа = его UUID;
- если схема содержит канонические version, supersedes_id, parent_document_id или аналог — использовать их;
- если канонического поля версии нет, документы не склеивать;
- не определять «последнюю версию» по имени файла, номеру или URL;
- сортировка — детерминированно по created_at DESC, затем UUID;
- status маппится только из фактического DB status.

Если есть несколько документов с разными UUID, они не считаются дублями без канонической version relation.

&nbsp;

**10. URL allowlist проверять строго**

Hostname matching:

[pay.stripe.com](http://pay.stripe.com)

[invoice.stripe.com](http://invoice.stripe.com)

[files.stripe.com](http://files.stripe.com)

[bepaid.by](http://bepaid.by)

*.[bepaid.by](http://bepaid.by)

Для wildcard принимать только boundary-safe subdomain:

host === "[bepaid.by](http://bepaid.by)"

или

host.endsWith(".[bepaid.by](http://bepaid.by)")

Не принимать:

[evilbepaid.by](http://evilbepaid.by)

[bepaid.by.evil.com](http://bepaid.by.evil.com)

Правила:

- только https:;
- username/password в URL запрещены;
- javascript:, data:, file:, blob: запрещены;
- unsafe URL не возвращать клиенту;
- query string не писать в audit;
- external provider URL по умолчанию:
- signed storage URL:

can_open = true

can_download = true

expires_at заполнен

Signed URL создаётся только на текущий resolve и нигде не сохраняется.

&nbsp;

**11. Provider refresh audit**

Audit создаётся для каждой попытки:

refresh_provider=true

включая:

SUCCESS

NO_DOCUMENTS

PROVIDER_ERROR

ACCOUNT_NOT_RESOLVED

READ_ONLY_REFRESH_UNAVAILABLE

Actor хранить в канонических колонках audit:

actor_type = user/admin

actor_user_id = JWT sub

Safe meta:

payment_id

provider

document_types_found

source

verdict

safe_error_code

retryable

Не дублировать в meta:

- URL;
- card data;
- ФИО;
- customer;
- полный provider response;
- secret/account credentials.

При refresh_provider=false отдельный audit открытия drawer не создавать.

&nbsp;

**12. Тесты должны быть полностью изолированными**

Все provider clients, Supabase client, clock и signed-URL generator передавать через dependency injection/mocks.

Локальные тесты не должны:

- обращаться к production DB;
- обращаться к Stripe;
- обращаться к bePaid;
- создавать реальные signed URLs;
- писать реальные audit rows.

Дополнительно к утверждённой матрице проверить:

0 network calls

0 DB writes при refresh_provider=false

ровно 1 safe audit attempt при refresh_provider=true

0 generation calls

0 document number allocations

0 unsafe URLs в response

Тест refresh не меняет payments_v2 должен проверять не только итоговое состояние mock, но и отсутствие вызова update/insert/upsert/delete для payments_v2.

&nbsp;

**13. Technical payment marker**

Создать или обновить отдельный backlog-артефакт:

.lovable/backlog/stripe_test_fixture_marker_[v1.md](http://v1.md)

В текущем resolver:

- не определять fixture по сумме;
- не хардкодить UUID;
- не возвращать TEST_PAYMENT_DOCUMENT_BLOCKED;
- не запускать generation;
- только показывать существующие provider/internal documents.

&nbsp;

**14. Proof должен подтвердить отсутствие второго write-path**

В:

.lovable/proofs/stripe_documents_drawer_v2_[resolver.md](http://resolver.md)

добавить code-search proof:

payments_v2 insert/update/delete/upsert → отсутствует в новом resolver

document generate/regenerate → отсутствует

document number allocation → отсутствует

Stripe list/search → отсутствует

bepaid-get-payment-docs invocation → отсутствует

signed URL persistence → отсутствует

Также указать полный будущий deploy scope Approve D:

admin-payment-documents-resolve

frontend bundle

Shared-модули входят только в bundle resolver.

&nbsp;

**15. Gate status**

PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve A = PASS

PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve B = APPROVED

Approve C = NOT APPROVED

Approve D = NOT APPROVED

После реализации Approve B остановиться и вернуть один consolidated отчёт.

Deploy, frontend-разработку и production runtime не начинать.

&nbsp;

План: PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve B

Approve A = PASS, Approve B = APPROVED. Реализую только backend-код и локальные тесты. Deploy, миграции, frontend, изменение lifecycle/payments_v2 — запрещены.

## Scope

1. Edge Function (НЕ деплоить):
  - `supabase/functions/admin-payment-documents-resolve/index.ts`
  - `supabase/functions/admin-payment-documents-resolve/index.test.ts`
2. Shared layer (exact paths из Approve B §3):
  - `_shared/payments/documents/types.ts` — Canonical contract, machine codes, URL kinds.
  - `_shared/payments/documents/url-security.ts` — https-only, allowlist (`pay.stripe.com`, `invoice.stripe.com`, `files.stripe.com`, `*.bepaid.by`), `url_kind`, `can_open/download/copy`.
  - `_shared/payments/documents/stripe-documents.ts` — account+mode-aware adapter, exact retrieve по pi_/ch_/in_/re_/cn_/sub_, whitelist полей, без list/search и без fallback на live/default.
  - `_shared/payments/documents/bepaid-documents.ts` — read-only извлечение из локального `receipt_url` и `provider_response.transaction.receipt_url`; без write-side-effects; при невозможности чистого refresh → `BEPAID_REFRESH_NOT_AVAILABLE_READ_ONLY`.
  - `_shared/payments/documents/internal-documents.ts` — связь по `payment.order_id → ai_generated_documents.order_id`, identity = UUID, signed URL короткоживущий, не сохраняется.
  - `_shared/payments/documents/generation-status.ts` — обёртка над существующим canonical document resolver, только resolve статуса (read-only), без вызова generation.
3. Config:
  - `supabase/config.toml`: добавить
4. Registry:
  - `supabase/functions.registry.txt`: добавить `admin-payment-documents-resolve` (P1, deploy выполняется только в Approve D).
5. Proof: `.lovable/proofs/stripe_documents_drawer_v2_resolver.md` — по структуре §15.

## Contract (фикс)

Input: `{ payment_id: uuid, refresh_provider: boolean }`.
Output: canonical response из §4 с полями `payment`, `provider_documents[]`, `internal_documents[]`, `generation`, `diagnostics`, `warnings[]`.
Каждый документ содержит `url`, `url_kind`, `can_open`, `can_download`, `can_copy`, `expires_at`. Unsafe URL → `status=unavailable` + warning `UNSAFE_DOCUMENT_URL`, не отдаётся клиенту.

## RBAC

`has_role_v2` для существующих ролей:

- view (admin/super_admin/accountant с правом просмотра платежей) → resolve без refresh;
- edit/admin → refresh_provider=true;
- super_admin → diagnostics;
- остальные → 403.
Новых ролей/прав/миграций нет.

## Запрещено в Approve B

INSERT/UPDATE/DELETE `payments_v2`; создание документа; выделение номера; изменение order/payment/subscription/access; авто-вызов generation; сохранение provider/signed URL; вызов `bepaid-get-payment-docs` с записью; Stripe list/search; fallback на live/default account; refund по эвристике; новая таблица/RPC/migration; дубликат provider-документа; возврат unsafe URL.

## Audit (только при refresh_provider=true)

`audit_logs.action = admin.payment_documents.provider_refresh`. Safe meta: `payment_id, provider, actor_user_id, document_types_found, source, verdict, safe_error_code, retryable`. PCI/PII/URL/secrets — не логируются.

## Generation status

Допустимые коды: `NO_DOCUMENT_SCENARIO`, `MISSING_REQUIRED_REQUISITES`, `DOCUMENT_ALREADY_GENERATED`, `GENERATION_IN_PROGRESS`, `GENERATION_FAILED`, `PAYMENT_NOT_LINKED_TO_ORDER`, `REFUND_USES_PARENT_DOCUMENTS`, `STRIPE_ACCOUNT_NOT_RESOLVED`. `TEST_PAYMENT_DOCUMENT_BLOCKED` — НЕ выставлять (нет canonical marker; backlog `PATCH-STRIPE-TEST-FIXTURE-MARKER-V1` сохраняется).

## Refund

Только `payments_v2.meta.parent_payment_id` + подтверждённые exact provider relations. Parent найден → `source=parent_payment`, `REFUND_USES_PARENT_DOCUMENTS`. Нет → warning `REFUND_PARENT_NOT_RESOLVED`. Эвристики запрещены.

## Дедупликация

Provider identity = `provider + type + external_id`. Internal identity = UUID. Слияние local+API только при exact identity → `source=local_meta+provider_api`. Не по URL/имени/номеру.

## Тесты (минимум 20 + дополнительные)

20 кейсов из §14 + 5 дополнительных (обычный пользователь → 403; refresh не меняет `payments_v2`; exact retrieve без list/search; diagnostics скрыты не-super_admin; PCI forbidden fields отсутствуют). Запуск через Deno test локально, без deploy.

## Stop-conditions

Реализация немедленно останавливается при любом из условий §Stop-conditions сообщения.

## Gate status после Approve B

- A = PASS
- B = выполнено локально, deploy НЕ выполнен
- C = NOT APPROVED
- D = NOT APPROVED

После реализации — STOP и `Отчёт о выполнении: PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve B` с разделами из §15 (файлы, diff-summary, dependency graph, contract, RBAC, Stripe account/mode resolution, exact retrieve proof, bePaid read-only proof, refund parent, internal document relation, URL-security, dedup, тесты и результаты, подтверждение no-deploy/no-DB/no-lifecycle changes, proposed deploy scope для Approve D).