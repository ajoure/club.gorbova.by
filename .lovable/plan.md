# да, согласен, с учетом правок:

Все пункты плана сохраняются по принципу add-only/no-loss. Ниже — единый consolidated-пакет обязательных уточнений. Новых дополнений после этого пакета не добавлять, если не появятся новые факты RUN 1, код, DDL или runtime-блокер.

## **1. RUN 1 должен завершиться окончательной scope-матрицей**

До начала реализации для каждого workstream вернуть:

```text
workstream
текущая архитектура
точные файлы
точные таблицы и поля
нужна ли migration
нужна ли новая Edge Function
нужен ли redeploy существующей функции
риски bePaid/Stripe
execute scope
deferred scope
verdict
```

Допустимые verdict:

```text
READY_TO_IMPLEMENT
ALREADY_IMPLEMENTED
MERGE_WITH_EXISTING
DEFERRED_OPERATIONAL_UAT
CANCELLED_AS_NOT_NEEDED
STOP_BLOCKER
```

После RUN 1 запрещено расширять scope без нового обнаруженного факта.

---

## **2. Не создавать функциональность повторно**

Перед созданием каждого endpoint/helper/UI выполнить anti-duplication discovery.

Особенно проверить существование:

```text
single Stripe cancel endpoint
bulk subscription actions
subscription period presenter
provider-aware subscription resolver
technical/test payment metadata
multi-select subscriptions UI
system actor audit helper
```

Если пригодная функция уже существует — расширять её add-only.

Новый endpoint разрешён только при доказанном отсутствии подходящего существующего пути.

---

## **3. Billing period: сначала определить владельца истины**

Не добавлять новые поля в БД только ради отображения, если данные уже доступны в:

```text
subscriptions_v2
provider_subscriptions
provider metadata
tariff_offers
```

В RUN 1 обязательно определить:

```text
canonical owner каждой даты
source priority
timezone
null semantics
provider parity
```

Пример приоритета должен быть доказан фактической архитектурой:

```text
canonical local field
→ exact provider snapshot
→ safe unavailable
```

Запрещено:

- вычислять даты по `created_at + interval`;
- использовать `+30 дней`;
- подменять `current_period_end` датой entitlement;
- показывать `next_charge_at`, если подписка отменена немедленно;
- считать `cancel_at_period_end` завершённой подпиской.

Если для заполнения UI потребовался provider API call, он не должен выполняться при каждом render страницы.

---

## **4. Billing period не должен менять lifecycle**

Workstream A — presenter/read model.

Запрещено в нём:

```text
обновление статусов подписки
создание invoice/payment
изменение provider_subscriptions
изменение entitlement
перенос next_charge_at
```

Любой обнаруженный дефект lifecycle оформить отдельным fix-to-patch внутри спринта, но не маскировать UI-изменением.

---

## **5. Bulk cancel: dry-run должен выдавать подписанный batch token**

Execute не должен принимать просто повторный список UUID после dry-run.

Dry-run должен создать безопасный краткоживущий идентификатор:

```text
batch_id
actor_user_id
selected subscription UUIDs
mode
eligibility snapshot/hash
expires_at
```

Execute принимает:

```json
{
  "batch_id": "uuid",
  "confirm": true
}
```

и повторно валидирует состояние каждой подписки перед отменой.

Если состояние изменилось после dry-run:

```text
STALE_DRY_RUN
```

для конкретной строки или всего batch согласно фактической архитектуре.

Нельзя доверять eligibility, присланной frontend.

---

## **6. Bulk cancel: scope по provider определить в RUN 1**

В плане нельзя заранее смешивать все provider.

Первый execute scope:

```text
Stripe only
```

если именно для Stripe подтверждён безопасный single-cancel flow.

bePaid:

- либо остаётся вне execute;
- либо включается только при наличии доказанного канонического single-cancel;
- regression обязателен независимо от того, входит ли bePaid в execute.

Нельзя создавать общую bulk-отмену, которая внутри имеет несимметричное или непроверенное поведение provider.

---

## **7. Immediate cancellation требует отдельного строгого gate**

Для `immediate` обязательно:

- повторное явное подтверждение;
- ввод причины;
- показ последствий;
- запрет отмены production-клиента в runtime proof;
- повторная проверка active entitlements;
- использование только существующего single-cancel lifecycle;
- отсутствие прямого удаления access;
- отсутствие прямого Telegram revoke;
- отсутствие автоматического refund, если это не является существующей бизнес-логикой.

Если безопасный immediate single-flow не подтверждён:

```text
period_end = IMPLEMENT
immediate = DEFERRED
```

Это не блокирует закрытие всего финального спринта при наличии отдельного доказанного verdict.

---

## **8. Bulk cancel и SYSTEM ACTOR**

Не создавать искусственную системную операцию только ради SYSTEM ACTOR proof.

SYSTEM ACTOR обязателен лишь если после bulk cancel реально запускается background reconcile.

Тогда proof должен показать:

```text
admin bulk execute audit:
actor_user_id = реальный JWT sub

background reconcile audit:
actor_type = system
actor_user_id = NULL
actor_label заполнен
correlation_id/batch_id совпадает
```

Если фоновой операции нет, SYSTEM ACTOR для workstream B помечается:

```text
NOT APPLICABLE
```

с объяснением, а не имитируется.

---



## **9. Multi-select не смешивать с известным багом**

`/admin/products-v2`

Проверить фактический компонент выбора в таблице подписок.

Нужно подтвердить:

- выбор нескольких произвольных строк;
- shift-range, только если уже поддерживается таблицей;
- select all;
- снятие отдельной строки;
- выбор не сбрасывается при открытии dry-run;
- pagination/filter semantics понятны.

Не переносить автоматически backlog-баг таблицы продуктов в таблицу подписок.

---

## **10. Conflict helper: определить бизнес-ключ конфликта**

Provider-aware не означает «конфликтует любая активная подписка другого provider».

RUN 1 должен установить canonical business identity:

```text
profile/contact
product
tariff/package
subscription domain
business stream
offer
```

Конфликт определяется только по доказанному бизнес-ключу.

Нельзя блокировать:

- разные независимые продукты;
- разные business streams;
- допустимые параллельные подписки;
- one-time заказы;
- завершённые подписки;
- technical fixture.

Для cross-provider conflict вернуть таблицу:

```text
existing provider
requested provider
same business identity
status
policy
verdict
```

---

## **11. Conflict helper не должен преждевременно менять закрытые checkout flows**

Сначала:

1. создать/исправить pure provider-aware helper;
2. покрыть тестами;
3. подключить к одному Stripe caller;
4. доказать результат;
5. затем подключать остальные callers.

Если для подключения bePaid/public checkout требуется redeploy закрытой критической функции:

```text
STOP
SHARED_DEPENDENCY_REDEPLOY_REQUIRED
```

Вернуть dependency graph.

Не передеплоивать массово checkout-функции только из-за общего shared import.

---

## **12. Fixture marker: разделить marker и бизнес-последствия**

Workstream D сначала создаёт только каноническую маркировку:

```text
is_test_fixture
fixture_type
marked_at
marked_by
source
```

После этого отдельно определить, какие consumers реально должны учитывать marker.

Нельзя автоматически добавлять все последствия одновременно:

```text
не учитывать в выручке
не выдавать доступ
не отправлять CRM
не создавать документы
```

Каждое последствие должно быть подтверждено существующим бизнес-правилом.

Минимально допустимое поведение:

- badge в admin UI;
- audit;
- запрет production document generation, если это уже утверждённое правило;
- доступ и payment lifecycle без изменений.

---

## **13. Historical fixture marking требует отдельного dry-run**

Dry-run должен вернуть exact UUID:

```text
payment_id
order_id
provider
marker_before
evidence
planned_marker
```

Execute:

- только по утверждённому exact UUID;
- idempotent;
- без поиска по сумме, email, дате;
- без изменения status, amount, order, access;
- с реальным admin audit.

Если доказательств недостаточно, строка остаётся:

```text
UNCONFIRMED_FIXTURE
```

и не помечается.

---

## **14. Canary нельзя удалять до завершения финальной regression**

Порядок Workstream E изменить:

```text
inventory callers
→ сохранить recovery source
→ завершить основной deploy/runtime
→ подтвердить public webhook health
→ удалить canary
→ проверить отсутствие функции
```

Не проводить «smoke реальных public webhooks» посредством создания новых business webhook events.

Разрешён только безопасный transport/auth smoke, который не создаёт payment/order/subscription/access.

Перед удалением:

- source/recovery snapshot;
- config/registry mapping;
- доказательство callers=0;
- список реальных public webhooks с версиями before.

После удаления:

- canary отсутствует;
- реальные public webhooks версии не изменились;
- `verify_jwt=false` реальных webhook сохранён.

---

## **15. Backup tables: в этом спринте по умолчанию retention verdict, а не DROP**

Физический DROP разрешён только после финального RUN 4 regression PASS.

Поэтому порядок:

```text
RUN 1–2: inventory + proposed verdict
RUN 3: никаких DROP до завершения runtime
RUN 4: финальный verdict
после PASS: DROP_NOW execute только для полностью безопасных таблиц
```

Если есть хотя бы одна неопределённость:

```text
RETAIN_UNTIL_DATE
```

с точной датой, owner и причиной.

Не удалять backup-таблицы ради формального закрытия спринта.

---

## **16. Проверка references backup tables должна быть широкой**

Проверить не только FK:

- SQL functions;
- views/materialized views;
- Edge Functions;
- frontend queries;
- migrations;
- cron jobs;
- RPC;
- docs/recovery scripts;
- manual restore instructions.

`references=0` означает отсутствие всех этих зависимостей.

---

## **17. Deploy-план формируется только после dependency graph**

До RUN 3 вернуть таблицу:

```text
changed file
bundle/function
почему нужен deploy
shared consumers
нужен ли redeploy consumer
risk
```

Если изменение shared helper попадает в bundle нескольких функций, нельзя предполагать, что достаточно deploy одной функции.

При необходимости redeploy закрытой функции:

```text
STOP
SHARED_DEPENDENCY_REDEPLOY_REQUIRED
```

и отдельное решение по минимальному безопасному scope.

---

## **18. Не требовать четыре отдельных ответа при отсутствии блокеров**

Пользователь просит завершить быстро.

Допустимый режим:

- RUN 1–2 выполнить непрерывно;
- дать один промежуточный consolidated отчёт перед production deploy;
- после deploy выполнить RUN 3–4;
- дать один финальный отчёт.

Не останавливать работу ради отчёта после каждого workstream.

Однако непосредственно перед destructive execute или production bulk cancellation обязателен STOP.

---

## **19. Runtime bulk-cancel proof не должен отменять клиента**

Production runtime:

- dry-run на существующих данных;
- execute только на подтверждённой fixture;
- при отсутствии fixture — integration proof + `NOT AVAILABLE IN CURRENT FIXTURES`.

Запрещено создавать новую платную подписку только ради отмены.

Отсутствие execute-fixture не блокирует закрытие workstream, если:

- dry-run runtime PASS;
- execute integration tests PASS;
- Stripe mock/API contract proof PASS;
- access/Telegram guards доказаны.

---

## **20. Public checkout и bePaid regression**

Workstream C обязан доказать не только тесты helper, но и отсутствие изменения пользовательского поведения:

```text
bePaid recurring existing customer
bePaid new recurring checkout
Stripe recurring checkout
one-time checkout
public payment link
admin payment link
```

Если конкретный live fixture отсутствует, использовать existing integration tests и обозначить это честно.

---

## **21. Final UAT не должен повторно открывать закрытые патчи**

Все first-real-event пункты оформить только как operational checklist.

Статусы:

```text
DEFERRED_OPERATIONAL_UAT
```

Они не являются:

- незакрытым PATCH;
- причиной PARTIAL;
- основанием для нового deploy;
- основанием для нового sprint.

Новый fix-to-patch создаётся только при реальном FAIL первого события.

---

## **22. Финальный backlog inventory должен охватить весь Stripe master sprint**

Проверить не только новые пять workstream, но и:

```text
provider abstraction
Stripe sandbox/live setup
one-time checkout
subscription lifecycle
customer portal
public links
product acquiring settings
payment profiles
currencies
documents
reporting
card enrichment
webhook lifecycle
refund/dispute
billing period
bulk cancel
fixture marker
backup/canary
```

Для каждого:

```text
status
proof file
deferred operational check
remaining blocker
```

Не оставлять записи без статуса.

---

## **23. Финальный PASS допускает контролируемые deferred verdict**

Пункты не должны искусственно блокировать закрытие:

- нет live trial fixture;
- нет безопасной subscription fixture для bulk execute;
- ещё не наступил первый recurring invoice;
- ещё не появился live Stripe invoice PDF;
- retention date backup-таблицы ещё не наступила.

При этом обязательны:

```text
код и тесты PASS
runtime доступной части PASS
security/regression PASS
чёткий deferred checklist
нет блокирующего дефекта
```

---

## **24. Уточнённый финальный DoD**

`STRIPE-FINAL-CLOSURE-SPRINT-V1 = PASS` при выполнении исходных 22 пунктов с такими трактовками:

- bulk execute runtime может быть `NOT AVAILABLE IN CURRENT FIXTURES`, если integration proof полный;
- immediate cancel может быть `DEFERRED` при отсутствии безопасного подтверждённого lifecycle;
- backup table может иметь `RETAIN_UNTIL_DATE`;
- first-real-cycle остаётся `DEFERRED_OPERATIONAL_UAT`;
- SYSTEM ACTOR может быть `NOT APPLICABLE`, если фоновой операции нет;
- всё это не должно скрывать реальные FAIL или lifecycle/security regression.

---

## **Итоговый режим исполнения**

```text
RUN 1:
полный discovery + scope freeze

RUN 2:
implementation + полный test suite

ПРОМЕЖУТОЧНЫЙ ОТЧЁТ:
точный deploy scope, migrations, cleanup verdicts, blockers

RUN 3:
deploy + runtime доступных безопасных сценариев

RUN 4:
regression + cleanup + backlog/deferred closure

ФИНАЛЬНЫЙ ОТЧЁТ:
PASS / PARTIAL / FAIL
```

Если после RUN 1 нет STOP-condition и нет destructive execute, сразу продолжать RUN 2 без нового плана.

&nbsp;

План: STRIPE-FINAL-CLOSURE-SPRINT-V1

Финальный объединённый спринт по завершению Stripe-интеграции. Выполняется четырьмя непрерывными прогонами без промежуточных approve-gates. STOP — только при реальном блокере (см. §8).

## Жёсткие правила

- Язык артефактов: только русский. Финальный отчёт начинается строго: `Отчёт о выполненной работе: STRIPE-FINAL-CLOSURE-SPRINT-V1`.
- Порядок: DISCOVERY → CONSOLIDATED FINDINGS → DRY-RUN → EXECUTE → DEPLOY → RUNTIME PROOF → FINAL CLOSURE.
- Add-only / no-loss: bePaid lifecycle, stripe-webhook, bepaid-webhook, grant-access-*, telegram access, document generation, orders_v2/payments_v2/entitlements/access_rules/payment_links — НЕ трогать без прямой необходимости.
- Связи только по UUID и точным provider object IDs. Запрещены связи по email/ФИО/сумме/дате.
- SYSTEM ACTOR proof обязателен для фоновых операций; для ручных — actor_user_id = JWT sub.
- Никаких массовых операций без dry-run, batch, idempotency, audit.
- Никаких прямых удалений entitlements или Telegram revoke из bulk endpoint.

## Scope (6 workstream'ов)

- **A.** PATCH-STRIPE-BILLING-PERIOD-MODE-V2 — корректное отображение периода, trial, next charge, cancel-at-period-end.
- **B.** PATCH-STRIPE-BULK-CANCEL-V2 — безопасная массовая отмена Stripe-подписок с dry-run и period_end/immediate.
- **C.** PATCH-PROVIDER-AWARE-SUBSCRIPTION-CONFLICT-V1 — устранение hardcode `provider='bepaid'` в shared conflict helper.
- **D.** PATCH-STRIPE-TEST-FIXTURE-MARKER-V1 — канонический server-only marker технических платежей.
- **E.** PATCH-STRIPE-INFRA-CLEANUP-V1 — backup tables retention verdict, удаление canary `public-webhook-deploy-probe`, инвентаризация мёртвых артефактов.
- **F.** STRIPE-FINAL-UAT-AND-CLOSURE-V1 — единый regression + deferred first-real-event checklist + backlog classification.

## RUN 1 — Discovery (read-only)

Артефакт: `.lovable/discovery/stripe_final_closure_sprint_v1.md`.

- **A.** Mapping всех источников периода/trial/next_charge (subscriptions_v2, provider_subscriptions, orders_v2, payments_v2, Stripe sub/invoice/checkout, offer/tariff). Таблица «поле UI → текущий источник → канонический → fallback → риск → решение». Определить canonical fields (payment_mode, billing_interval[*count], trial, current_period_*, next_charge_at, cancel_at[_period_end], ended_at) под фактическую архитектуру.
- **B.** Single cancel flow, Stripe cancel endpoint, RBAC, reconcile pipeline, UI selection. Dry-run contract `{selected, eligible, skipped, blocked, items[]}` с per-item полями (sub_id, provider_sub_id, provider, status, mode, eligibility, skip_reason, access_effect).
- **C.** Аудит `_shared/subscription-conflict.ts`, все callers, provider matrix (bepaid/stripe/future).
- **D.** Существующие conventions metadata fixture (meta.test_payment/fixture/technical/...), список fixture-UUID из истории. Запрещены heuristics по amount/email/date.
- **E.** Backup tables (`*_backup_*`, `_stripe_cleanup_*`): name, created, rows, size, refs, purpose, restore, last use, retention deadline, drop eligibility. Canary: config, registry, callers, deployment, external traffic. Dead artifacts inventory.
- **F.** Единая матрица deferred proof (card enrichment по 3 event'ам, consultation PDF, drawer live Stripe, recurring cycle, invoice.payment_failed, replay/idempotency, non-admin RBAC) с разметкой «можно сейчас / нет fixture / покрыто тестами / требует первого реального».

STOP-conditions RUN 1: destructive migration, конкурирующие subscription models, bulk cancel невозможен без прямого удаления access, дефект в single cancel, backup всё ещё используется production, canary имеет caller, conflict helper требует изменения закрытого bePaid lifecycle, нужно менять webhook contract. Иначе сразу RUN 2.

## RUN 2 — Implementation + tests

### A. Billing period

- Один provider-agnostic presenter/resolver, переиспользовать существующий subscription DTO.
- Stripe и bePaid — единый UI contract. Не вычислять next_charge_at как +30 дней, если provider дал точную дату. Trial не подменяет основной period. One-time не показывается как подписка. `cancel_at_period_end=true` ≠ уже отменена.
- UI: `/admin/subscriptions`, карточка подписки/сделки. В `/admin/payments` — только компактная связанная информация, без дубля subscription management.

### B. Bulk cancel

- Один endpoint `admin-bulk-cancel-subscriptions` (или расширение существующего, если безопасно).
- Input: `{subscription_ids[], mode: period_end|immediate, dry_run, reason}`. Batch ≤ 50, только UUID, super_admin.
- Dry-run обязателен; execute обрабатывает только утверждённые ID; idempotency per-sub; ошибка одной не ломает batch.
- Period_end: Stripe `cancel_at_period_end=true`, доступ до конца периода. Immediate: второе подтверждение, существующий single-cancel lifecycle. Никаких прямых entitlement writes и Telegram revoke из bulk endpoint — доступ только через канонический reconcile.
- Audit: `admin.subscriptions.bulk_cancel.{dry_run,execute}` + SYSTEM ACTOR для follow-up reconcile.
- UI: multi-select, кнопка по выбору, явное разделение period_end / immediate.

### C. Provider-aware conflict helper

- Убрать hardcode `provider='bepaid'`. Contract: requested_provider/offer/profile, existing business subs, conflict policy.
- Конфликт: active, pending, past_due (если блокирует по политике), cancel_at_period_end (пока период активен). Не конфликт: cancelled+завершено, expired, failed checkout без sub, fixture.
- Использовать в: Stripe checkout, bePaid recurrent, admin checkout/link, public checkout. bePaid regression — proof обязателен.

### D. Fixture marker

- Канонический server-only marker (имя поля — по фактической convention из discovery). Клиент задать не может.
- Исторические fixture — только по UUID из discovery, через dry-run. Запрещены mass update по сумме/email/date.
- Поведение: badge в admin UI; нет production document generation, если бизнес-правило запрещает; нет CRM/document automation, если архитектура это подтверждает; access/payment lifecycle не меняется без отдельного правила.
- Audit `admin.payment.fixture_mark`.

### E. Infra cleanup

- **Canary**: если callers=0 → удалить function + config + registry + temporary harness. Реальные public webhooks НЕ трогать. Proof: «before deployed / after absent / реальные webhooks unchanged».
- **Backup tables**: для каждой verdict `DROP_NOW | RETAIN_UNTIL_DATE | KEEP_AS_CANONICAL_RECOVERY`. DROP_NOW только при refs=0, восстановление не нужно, regression PASS, истёкший retention, dry-run подтверждён. RETAIN — фиксировать дату/owner/reason. KEEP — restore-инструкция. Не оставлять без verdict.

### Тесты (минимум)

- A: recurring monthly/yearly, trial, period_end cancel, immediate cancelled, one-time, missing provider date, Stripe/bePaid parity, timezone, next_charge не вычисляется ошибочно.
- B: dry-run, period_end, immediate, repeated execute, mixed, batch>50, provider missing, partial Stripe error, no direct entitlement writes, no Telegram revoke, audit actor, SYSTEM ACTOR follow-up.
- C: Stripe active, bePaid active, cross-provider, pending, past_due, cancel_at_period_end active, cancelled, fixture ignored, one-time не recurring conflict, bePaid regression.
- D: server-only, exact UUID, no amount heuristic, audit, document guard, UI badge, client spoof blocked.

Полный backend/frontend suite PASS — обязательно.

## RUN 3 — Deploy + runtime

- Pre-deploy: backend/frontend tests, typecheck, build, code-search guards, PCI scan. Падение → STOP `PRE_DEPLOY_TEST_FAILED`.
- Baseline snapshot: payments_v2, orders_v2, subscriptions_v2, provider_subscriptions, entitlements, access_rules, payment_links, ai_generated_documents, audit_logs, webhook versions, access counts.
- Deploy ТОЛЬКО фактически изменённые функции спринта. Запрещён автоматический redeploy stripe-webhook/bepaid-webhook/grant-access-*/telegram/documents. Если shared import требует redeploy закрытой функции → STOP `SHARED_DEPENDENCY_REDEPLOY_REQUIRED` с dependency graph.
- Runtime A: реальные Stripe recurring / bePaid recurring / one-time / trial (если fixture есть) / cancel_at_period_end (если fixture есть). Отсутствие — `NOT AVAILABLE IN CURRENT FIXTURES` + test proof.
- Runtime B: НЕ отменять реальных клиентов. Допустимо: dry-run на реальных без execute; execute только на подтверждённой технической fixture или mocked/integration proof.
- Runtime D: пометить только подтверждённые UUID, проверить badge/audit/нет documents/нет lifecycle delta.
- Cleanup: canary удалить после успешных smoke реальных public webhooks без их redeploy; backup tables — по verdict RUN 2.

## RUN 4 — Final closure

- Общий regression: bePaid one-time/recurring PASS, Stripe one-time PASS, Stripe recurring PASS либо deferred first-real-cycle, refund PASS, documents drawer PASS, card enrichment PASS + deferred live, consultation PASS + deferred first-real PDF, access/Telegram/payment links/public checkout — 0 regression.
- `.lovable/proofs/stripe_first_real_event_checklist_v1.md` — один файл со всеми deferred (event, expected behavior, SQL/audit checks, failure condition, owner, no deploy required). Эти пункты НЕ считаются открытыми патчами.
- Backlog: каждому Stripe-item присвоить `CLOSED | MERGED_INTO_FINAL_SPRINT | DEFERRED_OPERATIONAL_UAT | CANCELLED_AS_NOT_NEEDED`. Артефакт: `.lovable/proofs/stripe_final_backlog_inventory_v1.md`.

## Stop-conditions (немедленный STOP)

Lifecycle delta связанная со спринтом; массовая отмена без dry-run; прямое удаление entitlements; авто Telegram revoke из bulk; Stripe test/live mismatch; bePaid conflict regression; document generation для fixture; secret/PCI leak; private Storage leak; webhook redeploy вне scope; backup table удаляется при refs>0; canary имеет caller; production-клиент как тест.

## DoD

Все 22 пункта из §9 исходного запроса (билинг корректен, one-time≠recurring, bulk cancel с dry-run+execute, period_end/immediate разделены, bulk не пишет access, conflict helper provider-aware без hardcode, fixture marker канонический и не по сумме/email/date, canary удалён или сохранён с причиной, каждая backup table с verdict, все тесты PASS, PCI PASS, bePaid/Stripe regression PASS, webhooks не передеплоены без необходимости, audit + SYSTEM ACTOR proof, backlog классифицирован, first-real-event checklist создан, нет блокирующих Stripe-патчей).

## Артефакты

Создать:

- `.lovable/discovery/stripe_final_closure_sprint_v1.md`
- `.lovable/proofs/stripe_final_closure_implementation_v1.md`
- `.lovable/proofs/stripe_final_closure_runtime_v1.md`
- `.lovable/proofs/stripe_first_real_event_checklist_v1.md`
- `.lovable/proofs/stripe_final_backlog_inventory_v1.md`

Обновить:

- `.lovable/plan.md`
- `.lovable/architecture/canonical_infrastructure_v1.md`

## Формат отчётов

После каждого RUN — короткий отчёт `Отчёт о выполненной работе: STRIPE-FINAL-CLOSURE-SPRINT-V1 / RUN N` и сразу продолжение, если нет STOP-condition. Финальный — `Отчёт о выполненной работе: STRIPE-FINAL-CLOSURE-SPRINT-V1` с verdict PASS / PARTIAL / FAIL. Новые планы между RUN'ами не создавать. Блокирующие дефекты — fix-to-patch внутри этого же спринта. Некритичное — в backlog без задержки закрытия.