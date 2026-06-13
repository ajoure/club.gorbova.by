да, согласен, с учетом правок:

Все пункты плана сохраняются по принципу add-only/no-loss. Approve D разрешён с уточнениями ниже.

**1. Не требовать искусственного создания runtime-fixtures**

Runtime-проверка выполняется только на уже существующих безопасных данных.

Если в production отсутствует подходящий фактический пример:

- Stripe hosted invoice;
- Stripe invoice PDF;
- credit note;
- refund без parent;
- payment с внутренними документами определённого типа;
- готовая view-only admin-учётная запись,

не создавать ради proof:

- новый платёж;
- новый refund;
- новый документ;
- новую роль;
- новую подписку;
- новый заказ.

В отчёте ставить:

NOT AVAILABLE IN CURRENT FIXTURES

и подтверждать соответствующий код-путь локальными тестами.

Отсутствие необязательного production-fixture не блокирует PASS, если:

- реализация покрыта тестами;
- основной drawer работает на доступных реальных платежах;
- архитектурная функция не заявляется как runtime-проверенная без факта.

&nbsp;

**2. Frontend deploy не перекладывать на пользователя без необходимости**

Lovable должен самостоятельно выполнить доступный ему publish/deploy workflow.

Фраза:

уведомить пользователя нажать Update

допустима только если платформа технически требует подтверждения владельца и агент действительно не может завершить публикацию самостоятельно.

В таком случае:

backend deploy = выполнен

frontend deploy = WAITING_FOR_OWNER_PUBLISH_CONFIRMATION

Approve D = PARTIAL

До фактической публикации frontend и browser runtime proof нельзя заявлять финальный PASS.

Не просить пользователя выполнять:

- консольные команды;
- SQL;
- JWT-вызовы;
- ручные технические smoke-тесты.

&nbsp;

**3. Baseline должен быть транзакционно привязан к тестовому окну**

Глобальные counts могут измениться из-за обычной работы сайта.

Перед runtime proof зафиксировать:

baseline_started_at

runtime_actor_user_id

контрольные payment_id

runtime_correlation_id

После proof сравнивать:

1. конкретные контрольные строки;
2. записи, созданные или изменённые в интервале теста;
3. audit rows с данным actor/correlation;
4. глобальные counts только как дополнительный сигнал.

Естественные изменения других пользователей не считать регрессией без доказанной связи с drawer.

Для каждого обнаруженного delta указать:

entity

row UUID

created_at / updated_at

actor/source

связь с runtime test

verdict: expected | unrelated activity | regression

&nbsp;

**4. Нулевая регрессия должна проверяться по конкретным полям**

Для контрольных payment rows сохранить before/after snapshot минимум:

id

status

order_id

subscription_id

amount

currency

receipt_url

meta

provider_response

updated_at

Для связанных сущностей:

orders_v2.id/status/updated_at

subscriptions_v2.id/status/updated_at

provider_subscriptions.id/status/updated_at

entitlements.id/status/expires_at/updated_at

ai_generated_documents.id/status/document_number/created_at

При обычном открытии drawer:

refresh_provider=false

обязательный результат:

0 DB writes

0 audit rows provider_refresh

0 document creation

0 document number allocation

При ручном refresh допускается только утверждённая safe audit row.

&nbsp;

**5. Audit proof использовать по фактической схеме**

Не хардкодить значение:

actor_type = admin

если такого значения нет в действующем contract.

Проверить фактические допустимые значения audit_[logs.actor](http://logs.actor)_type и использовать каноническое значение проекта.

Обязательно доказать:

actor_user_id = JWT sub пользователя [7500084@gmail.com](mailto:7500084@gmail.com)

actor_user_id IS NOT NULL

payment_id заполнен

provider заполнен

action = admin.payment_documents.provider_refresh

В audit отсутствуют:

полные URL

query parameters

Stripe response body

vault error

secret

connection credentials

card data

ФИО владельца карты

customer object

&nbsp;

**6. Smoke без JWT не заменяет authenticated runtime**

После deploy проверить два отдельных сценария:

**Без JWT**

admin-payment-documents-resolve

→ 401

**С реальным JWT пользователя с правом просмотра**

refresh_provider=false

→ 200

→ canonical DTO проходит runtime validation

**Без права refresh**

refresh_provider=true

→ 403

если существует безопасный готовый fixture пользователя.

Если готового view-only fixture нет, сохранить ранее утверждённый fallback:

backend RBAC unit/integration test

+

frontend component test

+

отсутствие write-action в rendered state

Новую роль ради proof не создавать.

&nbsp;

**7. Не запускать provider refresh на произвольной Stripe-строке**

Для ручного Stripe refresh сначала read-only подтвердить:

provider = stripe

account_code определён

mode определён

active acquiring connection однозначна

есть exact provider object ID

Если хотя бы одно условие не выполнено, refresh не запускать ради эксперимента.

Зафиксировать безопасный verdict resolver:

STRIPE_ACCOUNT_NOT_RESOLVED

STRIPE_MODE_NOT_RESOLVED

STRIPE_MODE_MISMATCH

NO_PROVIDER_DOCUMENTS

Не менять payment metadata для подготовки fixture.

&nbsp;

**8. bePaid refresh не должен вызывать legacy write-flow**

Для bePaid без локального receipt ожидаемое безопасное поведение может быть:

BEPAID_REFRESH_NOT_AVAILABLE_READ_ONLY

Это считается PASS, если подтверждено:

bepaid-get-payment-docs не вызван

payments_v2 не изменён

provider_response не изменён

receipt_url не записан

drawer остаётся рабочим

Не требовать появления bePaid receipt ценой вызова старого writer.

&nbsp;

**9. Внутренние документы проверять только read-only**

Для payment, связанного с существующим order:

- зафиксировать список ai_generated_documents до открытия drawer;
- открыть drawer;
- открыть или скачать существующий документ;
- повторить SELECT после проверки.

Обязательный результат:

document count delta = 0

document number delta = 0

document status delta = 0

generation audit delta = 0

Нельзя нажимать или временно добавлять generation/regeneration controls ради proof.

&nbsp;

**10. Проверка webhook-регрессии**

Подтвердить не только совпадение версий:

stripe-webhook version before = after

bepaid-webhook version before = after

но и отсутствие этих функций в deploy command/result Approve D.

Не отправлять новые тестовые webhook events в рамках этого патча.

Достаточно:

- version/deployment inventory;
- отсутствие webhook в deploy scope;
- ранее подтверждённые webhook proofs;
- отсутствие изменений связанных файлов.

&nbsp;

**11. PCI scan выполнять по фактическим данным, созданным патчем**

Проверить:

resolver response

audit_logs новых refresh-attempts

новые frontend logs — должны отсутствовать

изменённые backend/shared files

Forbidden keys минимум:

pan

card_number

cvc

cvv

exp_month

exp_year

fingerprint

authorization

secret_key

client_secret

Наличие допустимого слова в исходном тесте или type guard не считать утечкой. Verdict строить по runtime response/audit и фактическому persistence.

&nbsp;

**12. Runtime screenshots не должны содержать чувствительные данные**

Перед сохранением proof проверить отсутствие на скриншотах:

- полного email клиента;
- полного телефона;
- Stripe customer ID без маскирования;
- полного provider object ID, если diagnostics требует masking;
- signed URL;
- card holder;
- внутренних storage paths;
- секретов.

Admin email [7500084@gmail.com](mailto:7500084@gmail.com) допускается только как подтверждение actor/account, если это необходимо для proof.

&nbsp;

**13. Допустимые fixes**

Фраза «код не меняем» остаётся основным правилом.

Точечный fix-to-patch допускается только если runtime выявил реальный блокирующий дефект.

Перед исправлением:

описать дефект

указать root cause

перечислить exact files

подтвердить отсутствие scope expansion

После исправления обязательно повторить:

backend tests

frontend tests

deploy только изменённого утверждённого scope

runtime scenario

regression comparison

Архитектурные улучшения и необязательные UI-доработки переносить в backlog и не задерживать закрытие Approve D.

&nbsp;

**14. Финальный verdict**

**PASS**

Только если:

admin-payment-documents-resolve реально задеплоен

frontend реально опубликован

основной Stripe runtime PASS

основной bePaid regression PASS

internal documents read-only PASS

refund available fixture PASS либо NOT AVAILABLE с test proof

audit actor proof PASS

security/PCI PASS

lifecycle regression отсутствует

webhooks не передеплоены

**PARTIAL**

Если backend задеплоен, но:

- frontend не опубликован;
- browser runtime не выполнен;
- критичный доступный fixture не проверен;
- audit runtime row не получена.

**FAIL**

Если обнаружены:

- lifecycle write;
- автоматическая генерация документа;
- private Storage leak;
- PCI/secret leak;
- регрессия bePaid receipt;
- несанкционированный webhook redeploy.

&nbsp;

**Gate status**

PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve D = APPROVED

Выполнить pre-deploy verification, точечный deploy, доступный runtime proof и один consolidated финальный отчёт.

Следующие Stripe-патчи автоматически не начинать.

&nbsp;

## План: PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve D

Финальный deploy утверждённой архитектуры. Код не меняем, только верификация → deploy → runtime proof → отчёт.

### Scope deploy (строго)

- Edge Function: `admin-payment-documents-resolve` (включает bundle shared `_shared/payments/documents/*`)
- Frontend bundle (PaymentsTable + PaymentDocumentsDrawer + hook/utils/types)

Запрещено передеплоивать: `stripe-webhook`, `bepaid-webhook`, `public-checkout`, `grant-access-*`, document generation functions. Secrets и `acquiring_connections` не трогаются. Никаких новых функций / RPC / таблиц / миграций / drawers.

### Этап 1. Pre-deploy verification

1. Запустить Deno tests для `admin-payment-documents-resolve` (ожидание 56/56 PASS).
  - Подтвердить: production Stripe client ≠ stub, account/mode-aware factory подключён, нет Stripe list/search, нет записи в `payments_v2`, нет вызова generation, signed/provider URL не сохраняются.
2. Запустить `bunx vitest run` (ожидание 189/189 PASS).
  - Подтвердить: PaymentDocumentsDrawer читает только canonical response; первое открытие `refresh_provider=false`; provider refresh только вручную; `isSafeHttpsUrl` блокирует unsafe action; существующая колонка receipt в `PaymentsTable.tsx` не изменена; нет generation/regeneration UI; stale-response guard (seqRef) работает.
3. Если хоть один тест падает → STOP + `PRE_DEPLOY_TEST_FAILED`.

### Этап 2. Baseline (read-only SQL)

До deploy зафиксировать через `supabase--read_query`:

- counts: `payments_v2`, `orders_v2`, `subscriptions_v2`, `provider_subscriptions`, `entitlements`, `ai_generated_documents`, `access_rules`
- `payment_links.current_uses` (sum)
- последние номера внутренних документов (счёт/акт/счёт-акт/договор)
- контрольные Stripe и bePaid `payment.id` для runtime-проверки
- текущие версии `stripe-webhook` и `bepaid-webhook` (для проверки «не передеплоены»)

### Этап 3. Deploy

1. `supabase--deploy_edge_functions(["admin-payment-documents-resolve"])`.
2. Подтвердить `verify_jwt=true` через `supabase/config.toml` + smoke-вызов без JWT → 401.
3. Frontend deploy: уведомить пользователя нажать «Update» в publish-диалоге (frontend deploy не автоматический).

### Этап 4. Runtime proof (под `7500084@gmail.com` в реальном браузере)

Матрица сценариев:


| Кейс                                                      | Что проверяем                                                                                                              |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Stripe с local receipt                                    | drawer открывается, receipt отображается                                                                                   |
| Stripe с hosted invoice / invoice PDF                     | provider documents отображаются после ручного refresh                                                                      |
| Stripe без локальных документов                           | empty state корректный                                                                                                     |
| Stripe ручной refresh                                     | срабатывает только по confirm                                                                                              |
| Stripe открытие drawer                                    | НЕТ auto-refresh (`refresh_provider=false`)                                                                                |
| bePaid с receipt                                          | существующая кнопка чека работает как раньше                                                                               |
| bePaid без local receipt                                  | provider refresh НЕ вызывает старый write-flow                                                                             |
| Refund row                                                | используется `meta.parent_payment_id`, отметка «Документ относится к исходному платежу»                                    |
| Внутренние документы (заказ со счёт/акт/счёт-акт/договор) | отображаются read-only, открываются/скачиваются через canonical resolver, новый документ НЕ создаётся, номер не выделяется |
| Empty states                                              | без provider docs / без internal / без order / provider API down / refund parent unknown                                   |


### Этап 5. RBAC proof

- Admin с view-only → видит документы, refresh скрыт.
- Admin с write → refresh доступен.
- Super_admin → diagnostics видны.
- Без права просмотра → 403 от edge function.
- Generation/regeneration отсутствуют во всех ролях.

### Этап 6. Security proof

- Все URL = HTTPS (secondary guard `isSafeHttpsUrl`).
- Private storage остаётся private; signed URL = short-lived, не сохраняется.
- Provider URL не сохраняется.
- URL не попадают в audit.
- Secrets и connection credentials не в response/log/audit.
- Raw Stripe/bePaid body не возвращается.
- PCI forbidden keys = 0.
- Реальный `audit_logs` row `admin.payment_documents.provider_refresh`: actor_user_id = JWT sub, actor_type ∈ {user, admin}, payment_id заполнен, provider заполнен, safe_error_code безопасный.

### Этап 7. Regression after deploy

Повторный SQL и сравнение с baseline. Все дельты должны быть = 0 (с поправкой на естественную пользовательскую активность вне drawer):

- payments_v2 / orders_v2 / subscriptions_v2 / provider_subscriptions / entitlements / access_rules / payment_links.current_uses / ai_generated_documents (unexpected) / document numbering
- 0 авто-документов при открытии drawer
- 0 дублей provider documents
- bePaid receipt regression = PASS
- Stripe webhook regression = PASS
- webhook-функции не передеплоены (версии совпадают)

### Этап 8. UI proof

Скриншоты:

1. Stripe + provider docs
2. Stripe + internal docs
3. bePaid
4. Refund с parent-отметкой
5. Empty state
6. Super_admin diagnostics
7. Существующая колонка чека
8. Панель без кнопок generation/regeneration

### Этап 9. Финальный отчёт

`Отчёт о выполнении: PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve D` с: deployed functions + versions, изменённые файлы, diff-summary, результаты тестов, runtime matrix, screenshots, audit proof, SQL before/after, PCI proof, bePaid regression, webhook regression, deferred пункты, verdict PASS/PARTIAL/FAIL. STOP.

### Допустимые fix-to-patch в ходе Approve D

Только точечные правки в утверждённом scope (resolver, shared docs modules, drawer/card/hook/types/utils, add-only PaymentsTable, тесты, proof). Архитектурный рефакторинг запрещён. Каждый дефект — отдельный fix с DoD.

### Stop conditions

- любой pre-deploy test fail
- любой PCI / private storage leak
- любой lifecycle delta > 0 (вне естественной активности)
- любой auto-create документа при открытии drawer
- любая попытка передеплоить webhook