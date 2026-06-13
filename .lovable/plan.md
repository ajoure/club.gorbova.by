## да, согласен, с учетом правок:

Все пункты плана сохраняются по принципу add-only/no-loss. Ниже — финальные уточнения к evidence pack. После этого новые требования не добавлять без нового фактического блокера.





## **1. Не считать**

`Publishing is scheduled` **доказательством успешной публикации**

Для §4 нужны два разных факта:

```text
publish request accepted
deployment completed successfully
```

Фраза:

```text
Publishing is scheduled
```

подтверждает только постановку в очередь.

Финальный `PASS` допускается после подтверждения одного из следующих фактов:

- publish tool вернул `success/completed`;
- deployment/build log показывает успешное завершение;
- опубликованный сайт отдаёт новую версию frontend bundle;
- browser proof подтверждает появление нового UI, отсутствовавшего до публикации.

Если публикация осталась только в статусе scheduled:

```text
BULK_CANCEL_UI = WAITING_FOR_PUBLISH_COMPLETION
PAYMENTS_DOCUMENTS_UI = WAITING_FOR_PUBLISH_COMPLETION
FINAL VERDICT = PARTIAL
```

---

## **2. Проверять deployed Edge Functions через фактический источник проекта**

Не предполагать, что таблица:

```text
edge_functions_registry
```

обязательно существует и является каноническим реестром Supabase.

Использовать фактические доступные источники:

- список deployed functions через Supabase tooling;
- `supabase/functions.registry.txt`;
- `supabase/config.toml`;
- директории `supabase/functions/<function>`;
- deployment logs/version inventory;
- при наличии реальной внутренней registry-таблицы — использовать её дополнительно.

В proof указывать источник каждого вывода:

```text
source absent
config absent
registry absent
deployment absent
callers absent
```

Удаление source-файла само по себе не доказывает удаление deployed function.

---

## **3. Полный mapping шести удалённых функций**

Для каждой функции зафиксировать:

```text
function name
production purpose
последняя известная версия
source before
source after
config before/after
registry before/after
deployed before/after
frontend callers
edge-function callers
cron callers
CI/workflow callers
причина удаления
recovery possibility
```

Если функция не была задеплоена, писать:

```text
SOURCE_REMOVED / NOT DEPLOYED
```

а не «удалена из production».

Если была задеплоена:

```text
DEPLOYED FUNCTION DELETED
```

с фактическим tool result.

---

## **4. Не помещать чувствительные raw security payload в proof**

В `.lovable/proofs/stripe_final_closure_runtime_v1.md` запрещено вставлять полностью:

- SMTP-пароли;
- токены;
- hardcoded passwords;
- секретные значения;
- SQL dump contents;
- authorization headers;
- scanner evidence, содержащее секрет.

Для security scan сохранять только sanitised evidence:

```text
finding_id
scanner
severity
affected resource
safe description
action
status before
status after
verification timestamp
```

Секреты заменять:

```text
[REDACTED]
```

Raw tool payload допускается только если предварительно доказано, что он не содержит секретных данных.

---











## **5. Security findings: различать**

`gone`**,** `resolved` **и** `accepted risk`

Финальная матрица должна использовать точные статусы:

```text
GONE_AFTER_RESCAN
RESOLVED_AFTER_RESCAN
ACCEPTED_RISK
STILL_OPEN
NOT_REPRODUCED
```

Нельзя писать `gone`, если finding вручную переведён в ignored.

Для `SUPA_security_definer_view` обязательно указать:

```text
action = ACCEPTED_RISK
owner
business justification
affected view
почему SECURITY DEFINER требуется
какие compensating controls существуют
review date
```

Если обоснования или compensating controls нет, finding нельзя закрывать как accepted risk.

---

## **6. Повторный scan должен быть действительно новым**

Зафиксировать:

```text
baseline_scan_id / timestamp
closing_scan_id / timestamp
force_refresh = true
```

Подтвердить, что closing scan выполнен после:

- удаления функций;
- применения RLS;
- обновления policies;
- публикации либо окончательного security execute.

Нельзя использовать кэшированный scan как after-proof.

---

## **7. RLS evidence по 13 backup-таблицам**

Для каждой таблицы проверить фактические свойства:

```text
relrowsecurity = true
relforcerowsecurity = true, если именно это было применено
policies
grants
owner
row count
production references
retention verdict
```

Не требовать искусственно одинаковых названий policies, если фактически применён другой безопасный contract.

Главное доказательство:

- `anon` не может SELECT/INSERT/UPDATE/DELETE;
- `authenticated` не может SELECT/INSERT/UPDATE/DELETE;
- обычный admin через пользовательский JWT также не получает доступ;
- recovery доступен только доверенному server-side/service-role процессу;
- production-код таблицы не читает.

### **Важно**

Не добавлять `GRANT ALL TO service_role` только ради proof, если service-role уже имеет необходимый доступ или обходит RLS по канонической модели проекта.

Любые новые grants в рамках evidence-only run запрещены.

Проверять фактическое состояние, а не менять его.

---

## **8. Service-role recovery proof должен быть безопасным**

Для recovery proof достаточно:

```sql
SELECT count(*) FROM <backup_table>;
```

через канонический server-side/service-role connection.

Запрещено:

- выводить содержимое строк;
- показывать PII;
- показывать URL-токены;
- выполнять UPDATE/DELETE;
- создавать временные публичные endpoints для проверки.

В proof хранить только:

```text
table
service-role SELECT succeeded
row_count
timestamp
```

---

## **9. Dependency scan backup-таблиц**

Разделить найденные ссылки:

```text
PRODUCTION_RUNTIME_REFERENCE
MIGRATION_REFERENCE
PROOF/DOCUMENTATION_REFERENCE
RECOVERY_SCRIPT_REFERENCE
```

Для verdict `production references = 0` допустимы migration/proof/recovery references, но они должны быть классифицированы.

Проверить минимум:

- `src/`;
- `supabase/functions/`;
- активные SQL functions/views;
- cron;
- workflows;
- RPC;
- текущие migrations;
- recovery scripts.

---

## **10. Browser proof не заменять выводом из кода**

Для §5 нужен фактический browser runtime после публикации.

Обязательно:

- открыть published URL;
- выполнить hard reload или cache-busting;
- проверить актуальную UI-функцию;
- сохранить screenshot;
- зафиксировать network request/response для drawer;
- подтвердить отсутствие console errors.

### **Bulk cancel**

Проверить:

```text
кнопка видна super_admin
диалог открывается
несколько UUID принимаются
dry-run вызывается
batch_id отображается/сохраняется в flow
execute не запускать на клиентской подписке
```

Если row-checkbox multi-select отсутствует, не называть это полноценным табличным multi-select. Финальный факт формулировать честно:

```text
bulk batch input через paste-of-UUIDs = PASS
row-checkbox UX = backlog
```

Это не блокирует PASS, если утверждённый рабочий batch-flow доступен пользователю.

---

## **11. Payments documents proof по Рыштаковой и Матук**

Для каждой строки вернуть отдельный фактический результат:

```text
contact
payment_id
provider
receipt_url
provider uid present
ReceiptStatusBadge state
badge click result
Documents action result
resolver HTTP status
provider_documents count
internal_documents count
warnings
blocked_reason
final verdict
```

Не использовать формулировку «аудит-маркер `has_uid=true`», если это просто frontend diagnostic field, а не audit log.

Для bePaid с `receipt_url=NULL` подтвердить:

- является ли badge кликабельным;
- какой endpoint вызывается;
- создаётся ли receipt;
- открывается ли drawer;
- нет ли конфликта между legacy receipt handler и новым drawer.

### **Допустимые финальные verdict**

```text
WORKS_AS_DESIGNED
DATA_MISSING
LEGACY_RECEIPT_FLOW_REQUIRED
FRONTEND_FIXED_AND_PUBLISHED
BACKEND_DEFECT
```

Если backend defect обнаружен, resolver не передеплоивать в evidence-only run; вернуть отдельный STOP.

---

## **12. Не считать отсутствие браузера не блокирующим автоматически**

План правильно предусматривает честный verdict.

Если browser tooling недоступен и невозможно подтвердить новую опубликованную UI-версию:

```text
строка 3 Bulk cancel published UI = DEFERRED_MANUAL_UAT
строка 7 Payments documents UI = DEFERRED_MANUAL_UAT
финальный инженерный verdict = PARTIAL
```

`PASS` возможен только при фактическом browser proof либо другом равноценном runtime-доказательстве опубликованного bundle.

---

## **13. Bundle/version proof**

Git commit hash сам по себе не доказывает, что именно этот commit опубликован.

Предпочтительный proof:

```text
publish/deploy ID
completed timestamp
published asset hash
network JS bundle hash
browser-visible feature
```

Сравнение pre/post bundle hash допустимо только если pre-publish hash был реально сохранён.

Если baseline hash отсутствует, доказательством новой версии служат:

- новый уникальный UI;
- deployment ID;
- completed deployment log;
- актуальный asset timestamp/hash.

---

## **14. Regression после security fix**

Regression должен покрыть не только страницы, но и последствия удаления функций/RLS.

Обязательно:

```text
site root = 200
auth flow работает
/admin/payments работает
bulk cancel UI загружается
documents drawer загружается
Stripe checkout smoke без создания оплаты
bePaid checkout smoke без создания оплаты
public links открываются
критические webhooks версии unchanged
```

Удалённые test/dev functions не должны возвращать рабочий business response:

```text
404 / function not found
```

но не требуется вызывать их с секретами или реальными payload.

---

## **15. Lifecycle delta проверять по correlation и точным строкам**

Запрос:

```text
updated_at > run_start
```

может включать нормальный пользовательский трафик.

Для каждого delta определить:

```text
row UUID
timestamp
actor/source
correlation
связь с closing run
verdict
```

Глобальные counts — дополнительный сигнал.

Финальный regression FAIL только при доказанной связи изменения со closing run.

---





## **16.**

`cron.job` **и системные каталоги**

Если direct SQL-доступ к `cron.job`, grants или системным каталогам недоступен:

- не создавать новые privileged функции;
- использовать доступный read-only tooling;
- честно указать `NOT ACCESSIBLE`;
- дополнить code/workflow search.

Не выдавать предположение за проверенный факт.

---



## **17. Обновление**

`.lovable/plan.md`

Разрешена только одна add-only строка:

```text
STRIPE-FINAL-CLOSURE-SPRINT-V1 / CLOSING RUN:
evidence pack зафиксирован, итоговый verdict <...>, proof <path>.
```

Не переписывать существующий master plan и ранее зафиксированные статусы.

---

## **18. Финальная closure matrix**

Девять строк должны использовать только:

```text
PASS
CANCELLED_AS_NOT_NEEDED
KEEP_UNTIL_DATE
DEFERRED_OPERATIONAL_UAT
FAIL
```

Для строк 3 и 7 `DEFERRED_OPERATIONAL_UAT` допустим только при честно отсутствующем browser runtime. Тогда общий проект может считаться инженерно закрытым, но отчёт должен различать:

```text
ENGINEERING IMPLEMENTATION = PASS
PUBLISHED UI VERIFICATION = DEFERRED_OPERATIONAL_UAT
```

Не использовать `PASS`, если публикация не завершилась или UI не проверен.

---

## **19. Финальный verdict**

### **Полный PASS**

Только если:

- повторный security scan подтверждён;
- удаление функций доказано source/config/registry/deployment;
- backup RLS доказан;
- publish завершён;
- новая версия подтверждена;
- browser proof выполнен;
- regression PASS;
- closure matrix не содержит FAIL или неподтверждённых PASS.

### **PASS WITH DEFERRED OPERATIONAL UAT**

Допустим только если:

- инженерные и security изменения доказаны;
- publish завершён;
- browser tooling объективно недоступен;
- ручной UAT записан как operational checklist;
- нет признаков runtime-дефекта.

### **PARTIAL**

Если:

- publish только scheduled;
- повторный scan не выполнен;
- deployed functions не проверены;
- browser proof отсутствует без объективной причины;
- RLS/recovery/dependency proof неполный.

---

## **20. Финальный отчёт**

В конце существующего proof добавить:

```text
Отчёт о выполненной работе:
STRIPE-FINAL-CLOSURE-SPRINT-V1 / CLOSING RUN — EVIDENCE PACK
```

С обязательными полями:

```text
Security fix-to-patch root cause
Удалённые функции
Security findings before/after
Backup RLS/recovery
Publish result
Browser runtime
Payments documents results
Bulk cancel UI result
Regression
Closure matrix
Final verdict
Remaining operational checklist
```

После фиксации evidence pack — STOP. Новые исправления, migrations, deploy или security actions не выполнять в рамках этого этапа.

&nbsp;

План: STRIPE-FINAL-CLOSURE-SPRINT-V1 / CLOSING RUN — EVIDENCE PACK

Цель: дополнить существующий `.lovable/proofs/stripe_final_closure_runtime_v1.md` финальной секцией с доказуемыми фактами по 8 пунктам пользователя. Никакого нового плана/спринта/нового кода. Только сбор, верификация и фиксация фактов. Изменения RLS/удаление функций фиксируются как security fix-to-patch с явным root cause и regression proof.

### Что будет добавлено в proof-файл

Новая секция «CLOSING RUN — EVIDENCE PACK» с 8 подсекциями строго в порядке требований пользователя.

---

#### §1. Полный список удалённых Edge Functions (6)

Источник: история текущего спринта + verify через Supabase functions registry.

Список к подтверждению:

1. `test-full-trial-flow` (root cause: hardcoded `test-flow-2024` секрет, создавал реальные orders/subscriptions/entitlements)
2. `test-payment-direct` (root cause: hardcoded `test-direct-2024` секрет)
3. `migrate-data-export` (root cause: unauth публичный SQL-dump 50+ таблиц с SMTP/токенами)
4. `qa-seed-accounts` (root cause: hardcoded admin/user пароли в коде)
5. `test-quiz-progress` (root cause: unauth + service_role, писал в auth.users)
6. `test-getcourse-sync` (root cause: unauth + service_role, читал orders/profiles по orderId)

Verify: `supabase--read_query` к `edge_functions_registry` + `ls supabase/functions/` — обоих не должно быть.

---

#### §2. Матрица 7 security findings

Таблица: finding_id | scanner | level | action (deleted_source/resolved/ignored) | обоснование | финальный статус.

Источник: цепочка `security--manage_security_finding` вызовов + повторный `security--get_scan_results` (force=true).

Ожидаемые строки (требуют верификации повторным сканом):


| #   | finding                                                       | action                            | статус |
| --- | ------------------------------------------------------------- | --------------------------------- | ------ |
| 1   | `agent_security/hardcoded_test_secrets`                       | deleted_source                    | gone   |
| 2   | `agent_security/migrate_data_export_noauth`                   | deleted_source                    | gone   |
| 3   | `agent_security/qa_hardcoded_passwords`                       | deleted_source                    | gone   |
| 4   | `agent_security/test_funcs_no_auth`                           | deleted_source                    | gone   |
| 5   | `supabase_lov/stripe_cleanup_backup_payment_links_url_tokens` | resolved (RLS+deny-all)           | gone   |
| 6   | `supabase_lov/stripe_cleanup_backup_tables_no_rls`            | resolved (RLS+deny-all)           | gone   |
| 7   | `supabase/SUPA_rls_disabled_in_public`                        | resolved (RLS на 5 legacy backup) | gone   |


Доп. (не в исходной семёрке, требует явной фиксации): `supabase/SUPA_security_definer_view` — **ignored** с обоснованием (см. security-memory). Включить в матрицу отдельной строкой "accepted risk".

Verify: повторный `security--run_security_scan` + diff против baseline до миграций.

---

#### §3. 13 backup-таблиц: точные имена, policies, recovery, deps

Источник: `psql` против `pg_tables` + `pg_policies` + `information_schema.role_table_grants` + rg по кодовой базе.

Stripe-cleanup (8):

- `_stripe_cleanup_2026_06_backup_access_grant_ledger`
- `_stripe_cleanup_2026_06_backup_entitlements`
- `_stripe_cleanup_2026_06_backup_orders`
- `_stripe_cleanup_2026_06_backup_payment_links`
- `_stripe_cleanup_2026_06_backup_payments`
- `_stripe_cleanup_2026_06_backup_provider_events`
- `_stripe_cleanup_2026_06_backup_provider_subs`
- `_stripe_cleanup_2026_06_backup_subscriptions`

Legacy backup (5):

- `_backup_entitlement_delete_byn_2026_05_shulyak`
- `_backup_entitlement_tariff_id_backfill_2026_05`
- `_microcorrection_rollback_2026_05_03_backup`
- `_orders_cohort_b_cleanup_2026_05_backup`
- `_orders_orphan_cleanup_2026_05_backup`

По каждой подтвердить:

- `rowsecurity=true` + `relforcerowsecurity=true`;
- две policies: `deny_all_anon` RESTRICTIVE, `deny_all_authenticated` RESTRICTIVE, обе USING(false)/WITH CHECK(false);
- `GRANT ALL ... TO service_role` присутствует, GRANT для anon/authenticated отсутствует;
- Recovery proof: тестовый SELECT через service-role (psql или edge curl) возвращает строки → recovery возможен;
- Dependency scan: `rg -F "_stripe_cleanup_2026_06_backup_" supabase/ src/` и аналогично legacy-префиксы — должен быть 0 production-ссылок (допустимы только миграции и proof-файлы).

---

#### §4. Повторная публикация — артефакты деплоя

Зафиксировать:

- Точное UTC-время вызова `preview_ui--publish`;
- URL: `https://gorbova.lovable.app`;
- Статус из ответа tool: "Publishing is scheduled";
- Сборка ID/коммит-хэш (через `git log -1` после публикации или из deploy_logs таблицы);
- Hard-reload check: `browser--navigate_to_url` на published URL с cache-busting `?v=<ts>`, скрин 200 OK + актуальная версия (по хэшу JS-бандла в Network).

---

#### §5. Browser proof новой версии

Сценарий через browser-tools (после ~60s ожидания деплоя):

1. `navigate_to_url` → `https://gorbova.lovable.app/admin/payments` (логин при необходимости).
2. Открыть вкладку bePaid Subscriptions → подтвердить кнопку `StripeBulkCancelDialog` видна (скриншот).
3. Открыть `/admin/payments` → строка Рыштаковой → кнопка «Документы» → `PaymentDocumentsDrawer` открывается, показывает корректный data-state (receipt_url=NULL → бейдж "Чек не сформирован" + аудит-маркер `has_uid=true`).
4. То же для одной из строк Матук — корректное состояние по 2 из 5 receipt_url present.
5. Hash JS-бандла из Network ≠ pre-publish snapshot (доказательство, что не кэш).

Если browser недоступен — пометить как "browser unavailable, manual UAT required" и зафиксировать в backlog (не блокирует PASS, но снимает финальную галочку до ручной проверки).

---

#### §6. Confirm удалённые функции не вызываются

Поиск ссылок:

- `rg -F "test-full-trial-flow|test-payment-direct|migrate-data-export|qa-seed-accounts|test-quiz-progress|test-getcourse-sync" supabase/ src/ .github/`
- Допустимые матчи: исторические миграции (`supabase/migrations/*.sql`) и proof-файлы. Любые матчи в `src/`, активных edge functions, cron jobs, workflow YAML, `supabase/config.toml` → блокер.
- DB-проверка: `SELECT name FROM edge_functions_registry WHERE name IN (...)` → пусто.
- Cron: `SELECT jobname, command FROM cron.job WHERE command ILIKE ANY(ARRAY['%test-full-trial-flow%', ...])` → пусто.

---

#### §7. Regression после security-изменений

Smoke-чек:

- `curl -I https://gorbova.lovable.app` → 200;
- `/auth` рендерится, login flow жив (browser sanity);
- `/admin/payments` загружается без 500 (browser);
- Stripe/bePaid checkout не затронуты: `git diff` по `bepaid-*` и `stripe-*` функциям за этот ран → пусто; версии webhook-ов не менялись (`edge_functions_registry.version` snapshot до/после);
- Lifecycle delta: `SELECT count(*) FROM orders_v2/subscriptions_v2/entitlements/access_rules/provider_subscriptions/payments_v2 WHERE updated_at > <run_start>` ⇒ ожидаем 0 строк, изменённых данным раном (изменения легитимного трафика игнорируются по actor != system).

---

#### §8. Updated closure matrix (9 строк, без WAITING/PARTIAL)

Финальная таблица в новой секции:


| #   | Object                          | Verdict                 |
| --- | ------------------------------- | ----------------------- |
| 1   | Billing period display          | PASS                    |
| 2   | Bulk cancel backend             | PASS                    |
| 3   | Bulk cancel UI (published)      | PASS                    |
| 4   | Provider-aware conflict         | PASS                    |
| 5   | Fixture marker write-side       | CANCELLED_AS_NOT_NEEDED |
| 6   | Canary                          | KEEP_UNTIL_2026-12-31   |
| 7   | Payments documents UI           | PASS                    |
| 8   | Backup retention + RLS lockdown | PASS                    |
| 9   | Final regression/UAT            | PASS                    |


Любая строка, которая по факту проверок останется WAITING (например, browser unavailable для §5) — НЕ переписывается в PASS, а фиксируется честно с явным остатком в backlog, и тогда verdict спринта остаётся PARTIAL до закрытия этой строки.

---

### Технические артефакты, которые будут собраны и положены в proof

- `psql` выводы: pg_tables/pg_policies/role_table_grants/edge_functions_registry/cron.job (raw блоки в `<details>`).
- `rg` выводы по 6 удалённым именам функций.
- JSON ответа `security--get_scan_results` (force=true) до и после.
- `preview_ui--publish` response (без подмены формулировок).
- Browser screenshots (если доступен) — пути в `/mnt/documents/closing-run/`.
- Git diff списка файлов за ран (только имена) для regression-доказательства.

### Файлы, которые будут изменены

- `.lovable/proofs/stripe_final_closure_runtime_v1.md` — добавление секции «CLOSING RUN — EVIDENCE PACK» в конец, без переписывания предыдущих секций.
- `.lovable/plan.md` — короткая запись о фиксации (одна строка), без нового плана.

### Что НЕ будет сделано

- Никаких новых миграций.
- Никаких новых edge-функций, ре-деплоев существующих webhook/access функций.
- Никаких изменений в lifecycle-таблицах.
- Никаких новых memory-записей сверх уже обновлённой security-memory.
- Никаких изменений publish visibility/slug.

### Критерии готовности (DoD)

1. Все 8 подсекций §1–§8 заполнены фактами, а не утверждениями.
2. Повторный `security--get_scan_results` не содержит ни одного из 7 исходных critical findings.
3. Closure matrix не содержит WAITING/PARTIAL — либо PASS, либо явный backlog-маркер.
4. Verdict в конце CLOSING RUN: PASS — только если все 9 строк PASS/закрыты-как-нужно; иначе честный PARTIAL с перечислением остатка.
---

STRIPE-FINAL-CLOSURE-SPRINT-V1 / CLOSING RUN: evidence pack зафиксирован, итоговый verdict = PASS WITH DEFERRED OPERATIONAL UAT, proof .lovable/proofs/stripe_final_closure_runtime_v1.md (секция «CLOSING RUN — EVIDENCE PACK»).
