# План в целом правильный: это уже **не разработка**, а фактическая проверка, что backend foundation работает. Но есть несколько опасных мест: нельзя создавать/удалять тестовые данные без отдельного rollback, нельзя менять реальные шаблоны, и `run_mode: "real"` лучше заменить на утверждённые значения.

Готовый ответ Lovable:

да, согласен, с учетом правок:



## **1. Не использовать**

`run_mode: "real"`

В текущем плане указано:

```json
{ "package_session_id": "...", "run_mode": "real" }
```

Но ранее канон был:

```text
user_generate
admin_test
```

Для runtime proof использовать:

```json
{ "package_session_id": "...", "run_mode": "admin_test" }
```

`real` не вводить как новый режим, чтобы не плодить несовместимые статусы.

---





## **2. Не создавать и не удалять тестовые данные через**

`insert/delete`**, если можно обойтись существующими**

В шаге 4.1 написано, что можно создать тестовый item через `supabase--insert`, а потом удалить.

Правка:

```text
По умолчанию использовать только существующие данные.
Любой INSERT/DELETE для тестовой фикстуры запрещён без отдельного mini-plan + rollback proof.
```

Если для guard-сценария нет подходящих данных:

- зафиксировать `SKIPPED: no safe fixture`;
- не мутировать production.

Исключение — только если отдельно согласовано.

---

## **3. Не править шаблоны в БД ради guard-сценариев**

В шаге 4.2 и 4.4 нельзя временно вставлять неправильные токены в реальные DOCX/шаблоны.

Правка:

```text
Guard-сценарии проверять только на уже существующих шаблонах или через безопасный isolated test template, если он уже есть.
Production DOCX не модифицировать.
```

Если нет шаблона с нужным неправильным токеном:

```text
SKIPPED with reason: no safe fixture
```

---





## **4. Для order-mode regression не вызывать**

`mode=generate`**, если это создаёт новый документ без необходимости**

Если strict поддерживает `mode=preview`, сначала использовать preview.

Порядок:

1. `mode=preview` — основной regression.
2. `mode=generate` — только если нужно доказать DOCX/PDF и есть безопасный idempotency_key.

Для generate использовать явный тестовый ключ:

```text
idempotency_key = regression:3i-a-2:<order_id>:<template_id>
```

Чтобы не плодить дубли.

---

## **5. Уточнить idempotency для package runtime**

Повторный вызов может создать новый batch, но документы item должны быть идемпотентны по:

```text
pkg:${batch_id}:${item_id}
```

Если batch_id каждый раз новый, то idempotency будет новым и документы тоже могут создаваться заново.

Нужно выбрать один из двух вариантов и зафиксировать:

### **Вариант A — batch reuse**

Для одного `package_session_id + run_mode + template set` переиспользовать открытый/последний batch.

### **Вариант B — новый batch каждый запуск**

Тогда idempotency документа должен быть не от batch_id, а от стабильного ключа:

```text
pkg:${package_session_id}:${package_template_item_id}:admin_test
```

Иначе повторный вызов не проверяет идемпотентность, а создаёт новые документы.

Для proof лучше выбрать **B-stable idempotency for admin_test**.

---





## **6. Проверка “нет голых**

`{{...}}`**” в DOCX/PDF**

Для DOCX это можно проверить через unzip `word/document.xml`.

Для PDF автоматическая проверка может быть ненадёжной.

Правка:

```text
DOCX: обязательно проверить XML на отсутствие raw placeholders.
PDF: проверить наличие pdf_url + размер файла > 0; визуальный/текстовый анализ PDF опционален.
```

---

## **7. Проверить не только URL, но и storage object exists**

Для каждого generated item проверить:

```text
docx_url not null
pdf_url not null
storage object exists
file size > 0
```

Это важнее, чем просто наличие URL.

---





## **8.**

`ai_document_generation_batches` **— уточнить фактическое имя таблицы**

В плане используются оба варианта:

```text
ai_document_generation_batches
document_package_generation_batches
```

Нужно использовать только фактическую таблицу.

По предыдущему discovery это:

```text
ai_document_generation_batches
```

В proof не использовать неправильное имя `document_package_generation_batches`.

---

## **9. Проверка service-role guard**

Для 4.3 нужно проверить два сценария:

1. `packageContext` без `x-internal-call`;
2. `packageContext` с `x-internal-call`, но без service-role.

Оба должны вернуть:

```text
403 package_context_forbidden
```

---

## **10. Billing field guard**

Для `billing_field_in_package_template` не менять шаблон.

Если нет безопасного package-template с billing-FLD, зафиксировать:

```text
SKIPPED: no safe fixture
```

Не вставлять billing-FLD в реальный приказ ради теста.

---

## **11. Grep-инварианты оставить, но добавить build/typecheck**

Добавить обязательный пункт:

```text
Build/typecheck после runtime proof — PASS.
```

Ошибки типов не оставлять.

---

## **12. Memory обновлять только при полном PASS**

Если runtime package generation прошёл, но часть guard-сценариев SKIPPED из-за отсутствия безопасных фикстур, memory можно обновлять только с пометкой:

```text
completed with skipped guard fixtures
```

Если есть FAIL — memory не обновлять как completed.

---

## **Обновлённый итоговый статус**

Если всё PASS:

```text
completed: Phase 3I-A backend runtime proof passed;
order-mode regression passed;
package generation through canonical strict passed;
DOCX/PDF created through existing pipeline;
orchestrator remains thin;
ready for Phase 3I-B UI generation buttons
```

Если часть guard-сценариев SKIPPED:

```text
completed with fixture gaps: core runtime passed, skipped guards documented;
ready for Phase 3I-B only after deciding whether skipped guards need dedicated test fixtures
```

Если есть FAIL:

```text
OPEN: Phase 3I-A runtime proof failed; fix required before UI Phase 3I-B
```

Ключевая правка: **не мутировать реальные шаблоны/данные ради guard-тестов** и не использовать новый `run_mode: real`. Для proof достаточно безопасного `admin_test` и существующих данных.

&nbsp;

План: Phase 3I-A-2 — runtime proof package generation

## Цель

Доказать фактически на проде, что:

1. Order-mode `canonical-document-generate-strict` не сломан hotfix'ом.
2. Package-mode реально проходит через тот же strict pipeline (Docxtemplater → Gotenberg → storage → `ai_generated_documents`).
3. `ai-generate-document-package` остаётся thin orchestrator.
4. Guard-сценарии возвращают канонические error codes без silent empty / без второго renderer.

Никакого UI, никаких новых функций — только runtime-verification и proof.

---

## Шаг 1. Подготовка фикстур (read-only DB)

1.1. Через `supabase--read_query`:

- Найти один paid order с активным `tariff_offers.meta.document_scenarios` и шаблоном, который уже успешно генерировался ранее (для order baseline).
- Найти `package_session` пакета «Идеология» с готовым `client_legal_details` (ЮЛ или ИП) и минимум одним `document_package_item_role_assignments` для item с `{{ln-XXXXXX}}`.
- Зафиксировать `order_id`, `template_id`, `package_session_id`, `package_template_id`, список item_id + их шаблонов.

1.2. По каждому пакетному template_item проверить DOCX (через `storage.from('documents').download` → unzip → `document.xml`) и убедиться, что в шаблоне есть как минимум:

- один `{{ln-XXXXXX}}`;
- один `{{package.(ul|ip).FLD-XXXXXX}}`;
- один системный `{{field:FLD-000069}}` или `{{field:FLD-000070}}`.

Если такого item нет — выбрать другой пакет/item; ничего в шаблонах не править.

---

## Шаг 2. Order-mode regression smoke

2.1. `supabase--curl_edge_functions` POST `/canonical-document-generate-strict` с реальным order_id + template_id + payer/payment_channel из meta. Без `packageContext`.

2.2. Зафиксировать в proof:

- request body (sanitized);
- HTTP status;
- response: `resolver_version`, `context_type='order'`, `idempotency_key`, `token_manifest_snapshot`, `warnings`, `docx_url`, `pdf_url`;
- запись в `ai_generated_documents` (через read_query): `context_type`, `context_id`, `meta`.

2.3. Сравнить с прошлым успешным snapshot этого шаблона (если есть в `ai_generated_documents`). Если pre-hotfix baseline отсутствует — явно зафиксировать как **post-hotfix regression smoke (no pre-hotfix baseline)**.

DoD: status=200, `docx_url` + `pdf_url` непустые, новая запись в `ai_generated_documents` создана/реюзнута идемпотентно.

---

## Шаг 3. Package runtime generation (happy path)

3.1. `supabase--curl_edge_functions` POST `/ai-generate-document-package` body `{ package_session_id, run_mode: "real" }`. Авторизация — super_admin JWT текущего preview-пользователя.

3.2. Через `read_query` зафиксировать:

- `document_package_generation_batches`: батч создан, статус terminal;
- per-item status (`generated` / `blocked` / `error`);
- `ai_generated_documents` для каждого `generated` item: `context_type='package_session'`, `context_id=package_session_id`, `meta.generation_batch_id`, `meta.package_template_id`, `meta.package_item_id`, `meta.actor_type='system'`, `meta.source='package_orchestrator'`;
- `idempotency_key` соответствует `pkg:${batch_id}:${item_id}`;
- DOCX/PDF URL под префиксом `generated/package/${package_session_id}/`.

3.3. Скачать один DOCX + PDF через storage signed URL — убедиться, что placeholders фактически подставлены (нет голых `{{...}}` в видимом тексте).

3.4. Повторный вызов с тем же `package_session_id` (idempotency check):

- новых записей в `ai_generated_documents` не появилось;
- `idempotency_key` сматчился;
- HTTP 200, batch reuse или новый batch с уже-готовыми items.

---

## Шаг 4. Guard-сценарии

Все вызовы через `supabase--curl_edge_functions`, фиксируем status + error code в proof.

4.1. **Missing role assignment** — найти/создать (через `supabase--insert` если нужен тестовый item) item с `{{ln-XXXXXX}}`, но без записи в `document_package_item_role_assignments` для этой роли. Запустить orchestrator.

- Ожидание: strict для item НЕ вызывается, item.status=`blocked`/`error`, error=`role_assignment_missing`.

4.2. **Package field not ready** — выбрать item, в шаблоне которого есть `{{package.ul.FLD-XXXXXX}}`, отсутствующий в `copy_ready` каталоге (либо временно ЮЛ не выбран в session).

- Ожидание: strict не вызывается ИЛИ возвращает `package_field_not_ready` / `package_token_not_preresolved`. Без silent empty.

4.3. **PackageContext forbidden** — прямой вызов `/canonical-document-generate-strict` с `packageContext` под обычным authenticated user JWT (не service-role, без `x-internal-call: package-orchestrator`).

- Ожидание: HTTP 403, error=`package_context_forbidden`.

4.4. **Package/ln token в order-mode** — вызов order-mode strict с шаблоном, где есть `{{ln-XXXXXX}}` или `{{package.ul.FLD-XXXXXX}}`, БЕЗ `packageContext`.

- Ожидание: error=`ln_token_outside_package_context` или `package_token_outside_package_context`. Без silent empty.

---

## Шаг 5. Grep-инварианты (no-new-renderer proof)

```
rg -n "package-strict-handler" supabase/functions                                    → 0
rg -n "Docxtemplater|new Docxtemplater" supabase/functions/ai-generate-document-package → 0
rg -n "gotenberg|convertDocxToPdf"      supabase/functions/ai-generate-document-package → 0
rg -n "from\(['\"]ai_generated_documents['\"]\)" supabase/functions/ai-generate-document-package → 0
rg -c "new Docxtemplater"  supabase/functions/canonical-document-generate-strict/index.ts → 1
rg -c "convertDocxToPdf"   supabase/functions/canonical-document-generate-strict/index.ts → ≤3
rg -c "\.from\(['\"]ai_generated_documents['\"]\)" …/canonical-document-generate-strict/index.ts → 5 (baseline 3I-A-1.B)
rg -c "storage\.from\(['\"]documents['\"]\)\.upload" …/canonical-document-generate-strict/index.ts → 2
```

Вывод приклеить в proof. Любое отклонение от baseline 3I-A-1.B = FAIL → Phase 3I-A остаётся OPEN.

---

## Шаг 6. Proof файл

Создать `.lovable/proofs/sprint_3i_a_2_runtime_package_generation_2026_05.md` с секциями:

1. Order-mode regression smoke (фикстура + request/response + DB snapshot).
2. Package runtime generation (batch + per-item + storage URLs + idempotency повтор).
3. Guard-сценарии (4 × case с request/response/audit).
4. Grep-инварианты (вывод rg).
5. Batch / `ai_generated_documents` snapshot table.
6. No-new-renderer proof (3I-A-1.B baseline diff = 0).
7. Final verdict: PASS / FAIL по каждому DoD.

---

## Шаг 7. Memory + closeout

Только если **все** runtime checks и guards PASS:

- Обновить `mem://architecture/documents/package-document-level-questionnaires-v1`: статус → "Sprint 3I-A backend foundation complete; package generation runs through canonical strict pipeline".
- Добавить новую memory `mem://architecture/documents/package-generation-orchestrator-v1`: orchestrator-only contract, strict — единственный render/PDF/persist path, idempotency `pkg:{batch}:{item}`, storage prefix, guard error codes.
- Обновить `mem://index.md` (Core или Memories — описание ниже).
- Финальный статус Phase 3I-A: `completed: backend package generation foundation ready; ai-generate-document-package thin orchestrator; canonical-document-generate-strict sole render/PDF/persist; order regression passed; package runtime passed; guards passed; ready for Phase 3I-B`.

Если хотя бы один guard или runtime check FAIL — memory НЕ обновляется как completed, в proof пишется FAIL + причина, Phase 3I-A остаётся OPEN, эскалация в чат.

---

## Что НЕ делается в этом заходе

- UI кнопки (user / admin test) — Phase 3I-B.
- История пакетов — Phase 3I-B.
- Любые правки кода strict / orchestrator (только если runtime обнаружит регрессию — тогда отдельный hotfix-план).
- Любые правки шаблонов в БД.
- Любые миграции.

---

## Технические детали

- Все DB-вызовы — через `supabase--read_query` (диагностика) и `supabase--insert` (только если нужен тестовый role_assignment для guard 4.1; помечается `meta.test_fixture=true` и удаляется в конце — через migration с DELETE).
- Edge function вызовы — `supabase--curl_edge_functions`, для guard 4.3 — с явным `Authorization: Bearer <не-service-role JWT>`.
- Storage download — через `supabase.storage.from('documents').createSignedUrl` (read-only).
- Никаких изменений в `supabase/config.toml`, `.env`, типах.