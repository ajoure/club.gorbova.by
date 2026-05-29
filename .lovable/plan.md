Да, согласен, с учетом правок:

Главное: план уже правильный по архитектуре. Он делает именно то, что нужно: **не создаёт новый генератор**, а расширяет существующую генерацию через `canonical-document-generate-strict`. Но перед execution нужно добавить несколько защит, чтобы не сломать биллинговые документы и не получить полурабочую генерацию пакета.

да, согласен, с учетом правок:

## **1. Baseline биллинговой генерации — обязательный STOP-gate**

До любых правок `canonical-document-generate-strict`:

- снять baseline на одном реальном paid order;
- сохранить request/response/snapshot;
- после правок повторить тот же вызов;
- если order-path изменился — Sprint 3I-A считается BLOCKED.

В proof явно указать:

```text
order-mode без packageContext = поведение не изменилось
context_type='order'
idempotency_key pattern прежний
DOCX/PDF формируются
billing resolver не изменился
```





## **2.**

`packageContext` **должен быть доступен только orchestrator-у**

Нельзя разрешать обычному UI напрямую вызывать `canonical-document-generate-strict` с `packageContext`.

Добавить guard:

```text
packageContext allowed only for internal service-role call from ai-generate-document-package
```

Если обычный JWT передал `packageContext`:

```text
403 package_context_forbidden
```

## **3. Выбираем вариант B, но только по copy_ready каталогу**

Phase 3I-A должна покрыть:

```text
{{ln-XXXXXX}}
{{package.ul.FLD-XXXXXX}}
{{package.ip.FLD-XXXXXX}}
{{package.fl.FLD-XXXXXX}}
{{field:FLD-XXXXXX}} системные/document поля
```

Но только если поле есть в `packagePlaceholderCatalog` со статусом `copy_ready`.

Если токен не найден в каталоге или статус не `copy_ready`:

```text
package_field_not_ready
```

Запрещено подставлять пустую строку молча.





## **4.**

`package.fl.FLD-*` **нельзя оставлять пустым warning**

Не принимать вариант, где `package.fl.FLD-*` рендерится пустой строкой.

Если не получается определить физлицо для `package.fl.FLD-*`, должен быть blocker:

```text
package_fl_role_context_missing
```

Иначе мы получим документ, который формально сгенерирован, но фактически битый.

## **5. Уточнить FL-логику**

Для `{{package.fl.FLD-XXXXXX}}` нужно явно описать, откуда берётся person:

```text
package_session_id
+ package_template_item_id
+ document_package_item_role_assignments
+ person_id
→ legal_details_persons
```

Если в одном документе несколько ролей/несколько физлиц и токен `package.fl.FLD-*` не указывает, к какой роли относится, не делать fallback.

Только ошибка:

```text
package_fl_role_context_missing
```



## **6.**

`role_assignment_missing`

В validation это warning.

В generation preflight это blocker.

Правило:

```text
Если в DOCX есть {{ln-XXXXXX}},
но по текущему package_session_id + package_template_item_id + role_catalog_id
нет active assignment,
orchestrator НЕ вызывает strict для этого item.
```

Вернуть:

```text
role_assignment_missing
```





## **7.**

`{{field:FLD-...}}` **в package-mode**

В package-mode разрешены системные и документные поля:

```text
{{field:FLD-000069}} — номер документа
{{field:FLD-000070}} — дата документа
{{field:FLD-000209}} — сегодня прописью
{{field:FLD-000211}} — текущий год
```

Но биллинговые реквизитные FLD в package-template должны быть blocker перед генерацией:

```text
billing_field_in_package_template
```

Пояснение:

```text
Для реквизитов пакета используйте плейсхолдеры Пакет: ЮЛ / ИП / ФЛ.
```





## **8.**

`ai-generate-document-package` **— только orchestrator**

В файле `ai-generate-document-package/index.ts` запрещены:

```text
Docxtemplater
PizZip
Gotenberg
convertDocxToPdf
storage upload generated files напрямую
ai_generated_documents.insert напрямую
```

Разрешено только:

```text
load package_session
load template_items
preflight
build packageContext
invoke canonical-document-generate-strict
aggregate results
audit_logs
update ai_document_generation_batches
```

## **9. DOCX/PDF должны идти через существующий strict**

Результат каждого item:

```text
DOCX — через существующий strict/render path
PDF — через существующий Gotenberg path внутри strict
ai_generated_documents — только через strict
```

Orchestrator только собирает результат.

## **10. Batch / history — без молчаливых миграций**

Перед кодом проверить схему:

```text
ai_document_generation_batches
ai_generated_documents.generation_batch_id
ai_generated_documents.package_template_id
ai_generated_documents.package_template_item_id
ai_generated_documents.context_type/context_id
```

Если всё есть — использовать.

Если чего-то нет — сначала discovery/proof, потом минимальная миграция. Не добавлять поля молча.

## **11. Strict parser matrix**

В order-mode:

```text
{{field:FLD-XXXXXX}} — valid
{{ln-XXXXXX}} — error ln_token_outside_package_context
{{package.ul.FLD-XXXXXX}} — error package_token_outside_package_context
{{package.ip.FLD-XXXXXX}} — error package_token_outside_package_context
{{package.fl.FLD-XXXXXX}} — error package_token_outside_package_context
```

В package-mode:

```text
{{field:FLD-XXXXXX}} — valid только для разрешённых системных/document полей
{{ln-XXXXXX}} — valid, если preresolved
{{package.ul.FLD-XXXXXX}} — valid, если preresolved
{{package.ip.FLD-XXXXXX}} — valid, если preresolved
{{package.fl.FLD-XXXXXX}} — valid, если preresolved
```

Если токен не preresolved:

```text
package_token_not_preresolved
```

## **12. UI в этой фазе не делать, но hook не ломать**

Phase 3I-A не добавляет кнопки.

Но `useAiDocumentPackageGeneration` можно привести к новому контракту:

```text
{ package_session_id, run_mode? }
```

Существующие места вызова не должны сломать build.

Если кнопки ещё нет — это нормально. UI будет Phase 3I-B.

## **13. Proof обязателен**

В proof добавить:

1. Baseline strict order до изменений.
2. Regression strict order после изменений.
3. Grep: нет Docxtemplater/PizZip в orchestrator.
4. Grep: нет Gotenberg/convertDocxToPdf в orchestrator.
5. Grep: нет прямого insert в `ai_generated_documents` из orchestrator.
6. Runtime package generation через strict:
  - минимум 1 item;
  - минимум 1 `{{ln-XXXXXX}}`;
  - минимум 1 `{{package.ul.FLD-XXXXXX}}` или `{{package.ip.FLD-XXXXXX}}`;
  - минимум 1 системный `{{field:FLD-000069}}` или `{{field:FLD-000070}}`;
  - результат: DOCX URL, PDF URL, `ai_generated_documents.context_type='package_session'`.
7. Missing assignment:
  - strict не вызывается;
  - item получает `role_assignment_missing`.
8. Package field not ready:
  - strict не вызывается;
  - item получает `package_field_not_ready`.
9. Service-role guard:
  - user JWT + packageContext → 403.
10. Billing generation не изменилась.

## **14. Финальный статус Phase 3I-A**

После выполнения статус должен быть:

```text
completed: package backend foundation ready;
ai-generate-document-package is thin orchestrator;
canonical-document-generate-strict supports guarded packageContext;
DOCX/PDF generated through existing strict pipeline;
billing generation regression passed;
UI generation buttons deferred to Phase 3I-B
```

## **Коротко**

План можно утверждать, но только с этими условиями:

1. **Выбираем B** — `ln + UL/IP/FL + system fields`, но только по `copy_ready`.
2. **Никаких пустых строк молча**.
3. **Сначала baseline биллинга, потом изменения, потом regression**.
4. **Orchestrator не должен сам рендерить и писать документы**.
5. **UI-кнопки оставляем на Phase 3I-B**, это нормально.
6. &nbsp;
7. План: Sprint 3I-A — Package generation backend foundation (B-ограниченный)

## Цель

Подключить пакетную генерацию документов через уже существующий `canonical-document-generate-strict` (DOCX + Gotenberg PDF + `ai_generated_documents`), без нового рендерера и без silent fallback. Вариант **B по уже утверждённому `packagePlaceholderCatalog**`: резолвить только `copy_ready` поля; всё остальное — explicit preflight error.

Phase 3I-B (UI/admin/history) и 3I-C (финальный proof closeout) — отдельные заходы, в этой фазе не делаем.

---

## 0. Pre-work: baseline биллинговой генерации (BLOCKER)

До любых правок `canonical-document-generate-strict`:

1. Выбрать 1 существующий paid order с биллинговым шаблоном (есть `{{field:FLD-...}}`, DOCX + PDF исторически генерировался).
2. Вызвать strict (`mode=generate`) и зафиксировать baseline в `.lovable/proofs/sprint_3i_a_strict_baseline_<date>.md`:
  - request body;
  - HTTP status, `resolver_version`;
  - `token_manifest_snapshot`;
  - warnings;
  - `context_type='order'`, `idempotency_key` pattern;
  - наличие `docx_url`, `pdf_url`, запись в `ai_generated_documents`.
3. Этот baseline — обязательный референс для regression в п.7.

Если baseline снять невозможно (нет подходящего order) — фаза останавливается и эскалируется.

---

## 1. `canonical-document-generate-strict` — минимально-инвазивная package-ветка

### 1.1 Контракт

Добавить опциональный `packageContext` (без него поведение byte-for-byte как сейчас):

```ts
packageContext?: {
  package_session_id: string;
  package_template_id: string;
  package_template_item_id: string;
  generation_batch_id: string;
  profile_id: string;
  // Pre-resolved orchestrator-ом:
  preresolved_fields:        Record<`FLD-${string}`, { value: string; source: string }>; // системные/document
  preresolved_package_fields: Record<string, { value: string; source: string; catalog_tech_key: string }>; // ключ = токен `package.ul|ip|fl.FLD-XXXXXX`
  preresolved_ln_tokens:     Record<`ln-${string}`, { value: string; role_catalog_id: string; person_id: string }>;
}
```

### 1.2 Guard (закрытость от UI)

В самом начале handler:

- Если `body.packageContext` присутствует И вызов не service-role (нет `x-internal-call: package-orchestrator` + verified service-role JWT) → `403 package_context_forbidden`.
- Service-role gate: проверка `req.headers.get('apikey')`/Authorization service-role-key matches `SUPABASE_SERVICE_ROLE_KEY`, плюс header-marker.

### 1.3 Единый `generationContext`

Ввести локальный объект, через него идёт вся логика записи/snapshot/idempotency:

```ts
generationContext = {
  kind: 'order' | 'package_session',
  profile_id,
  context_type,                // 'order' | 'package_session'
  context_id,                  // order_id | package_session_id
  package_template_id?, package_item_id?, generation_batch_id?,
  idempotency_key,             // order: текущая логика; package: `pkg:${batch_id}:${item_id}`
}
```

### 1.4 Branching (один явный if)

```ts
const isPackageMode = Boolean(body.packageContext);

if (!isPackageMode) {
  // СУЩЕСТВУЮЩИЙ order-path — не трогаем
}
if (isPackageMode) {
  // package-path: order_id не требуется,
  // skip: payment guards, snapshotOrderDocumentData, B-97 fallback, derivePaymentChannel,
  //       offer/order resolution.
  // docFields = packageContext.preresolved_fields (FLD-only)
  // packageValues = packageContext.preresolved_package_fields
  // lnValues = packageContext.preresolved_ln_tokens
}
```

Запрет: размазывать `if (isPackageMode)` по всему файлу — только через `generationContext`.

### 1.5 Token validation matrix


| Token                                | Order mode                                | Package mode |
| ------------------------------------ | ----------------------------------------- | ------------ |
| `{{field:FLD-XXXXXX}}` + format/case | ✅                                         | ✅            |
| `{{package.ul.FLD-XXXXXX}}`          | ❌ `package_token_outside_package_context` | ✅            |
| `{{package.ip.FLD-XXXXXX}}`          | ❌ same                                    | ✅            |
| `{{package.fl.FLD-XXXXXX}}`          | ❌ same                                    | ✅            |
| `{{ln-XXXXXX}}`                      | ❌ `ln_token_outside_package_context`      | ✅            |


Любой token, отсутствующий в `preresolved_*` (хотя `packageContext` есть) → strict error `package_token_not_preresolved` (no silent empty string).

### 1.6 DOCX/PDF/storage/audit

Без изменений: тот же DOCX render, тот же Gotenberg path, тот же `ai_generated_documents.insert`. Меняется только `context_type`, `context_id`, и опциональные `package_template_id`, `package_template_item_id`, `generation_batch_id` (см. п.6).

---

## 2. `ai-generate-document-package` — полная замена на thin orchestrator

### 2.1 Запрещено в файле (grep-guard в proof)

`Docxtemplater`, `PizZip`, прямой `gotenberg`/`convertDocxToPdf`, прямой `supabase.from('ai_generated_documents').insert`, прямой storage upload сгенерированных файлов.

### 2.2 Разрешено

Load session + items + templates → preflight → build `packageContext` per item → invoke strict (service-role + `x-internal-call`) → aggregate → update `ai_document_generation_batches` → `audit_logs`.

### 2.3 Body

```ts
{ package_session_id: string, run_mode?: 'user_generate' | 'admin_test' }
```

Auth: user JWT обязателен; orchestrator делает ownership-check (`session.profile_id === auth.uid()` или super_admin для `admin_test`).

### 2.4 Preflight (item-level, blocker)

Для каждого `document_package_template_items[i]`:

1. Извлечь токены из шаблона (использовать существующий `extractDocxPlaceholders` + парсер strict).
2. Для каждого `{{ln-XXXXXX}}`:
  - роль есть в `document_package_role_catalog` (`public_id=ln-XXXXXX`, `package_template_id` совпадает с шаблоном пакета) — иначе `ln_token_unknown` или `ln_token_outside_bound_package`;
  - assignment есть в `document_package_item_role_assignments` для `(package_session_id, package_template_item_id, role_catalog_id, is_active=true)` — иначе `role_assignment_missing` (blocker для generation; в Phase 3H уже warning в validator).
3. Для каждого `{{package.(ul|ip|fl).FLD-XXXXXX}}`:
  - найти в `packagePlaceholderCatalog` (shared с фронтом) → если нет → `package_token_unknown`;
  - `status !== 'copy_ready'` → `package_field_not_ready`;
  - для UL/IP: `session.selected_legal_entity_id` обязателен — иначе `package_legal_entity_not_selected`;
  - для FL: ambiguity guard — если в item больше одной FL-роли с разными `person_id`, требуется явный role-context (из catalog item `package_resolver_hint` либо явная привязка токена к роли). Если контекст не определяется → `package_fl_role_context_missing`.
4. Для `{{field:FLD-XXXXXX}}` системных/document/meeting/agenda — список allow-list (по `fields_registry.entity_type ∈ {system,document,meeting,agenda,decision,package}`). Биллинговые `entity_type` (см. `src/utils/billingFldGroups.ts`) в package-mode → `billing_field_in_package_template` (blocker).

Если по item есть blocker → orchestrator **не вызывает** strict для этого item, item помечается `status='blocked'` с массивом errors.

### 2.5 Per-item build `packageContext`

- `preresolved_fields`: системные/document FLD из source-таблиц (session, item, package_template, текущая дата/номер) по уже зарегистрированному в каталоге mapping (FLD-000069, FLD-000070 и т.д.). Никаких новых FLD без manifest.
- `preresolved_package_fields`: пройти по copy_ready `package.ul|ip|fl.FLD-*`, прочитать из `client_legal_details` (для UL/IP, через `session.selected_legal_entity_id`) и `legal_details_persons` (для FL, через `document_package_item_role_assignments.person_id`) согласно `source_path` каталога.
- `preresolved_ln_tokens`: текстовый рендер по `document_package_role_catalog.output_template` (если есть) либо default (ФИО) на основании `legal_details_persons` назначенного человека.

### 2.6 Idempotency / batch

- Создать ОДНУ запись `ai_document_generation_batches(status='pending', package_session_id, run_mode, total_items, generated=0, errors=0)`.
- Для каждого item: `idempotency_key = pkg:${batch_id}:${item_id}` передаётся в strict.
- После всех items → пересчитать `status ∈ {generated, partial, failed, blocked}`.

### 2.7 Response

```ts
{ batch_id, status, total, generated, errors, results: [{ item_id, status, document_id?, docx_url?, pdf_url?, errors? }] }
```

---

## 3. `_shared/resolve-package-tokens.ts`

- Публичная обёртка `resolvePackageToken` остаётся с `HARDCODED_ENABLED=false` (не трогаем).
- Orchestrator/strict импортируют `resolvePackageTokenCore` напрямую только во внутреннем package generation path. В proof — grep:
  - `rg "resolvePackageTokenCore" src/` → 0 (кроме тестов);
  - import есть только в `supabase/functions/ai-generate-document-package/` и `supabase/functions/canonical-document-generate-strict/` (если strict сам вызовет на validation) и в `*.test.ts`.

---

## 4. Shared `packagePlaceholderCatalog`

Sprint 3D-каталог уже есть в `src/utils/packagePlaceholderCatalog.ts`. Орchестратор внутри edge-функции должен использовать ТУ ЖЕ таблицу. Делаем зеркало в `supabase/functions/_shared/packagePlaceholderCatalog.ts` (точная копия данных + helper `findByPackageToken`). Тест: проверка, что список `tech_key`+`reused_fld`+`source_path` идентичен фронтовому SOT.

Никаких новых FLD и новых source mapping в этой фазе.

---

## 5. UI / hooks — минимальные изменения

В этой фазе UI кнопку не подключаем. `useAiDocumentPackageGeneration` обновить только до нового контракта (`package_session_id`, опц. `run_mode`), но не вызывать из новых мест. Существующие места вызова (если есть) — пометить TODO Phase 3I-B и не ломать TypeScript.

---

## 6. Discovery перед миграциями (без миграций в этой фазе, если не нужно)

Проверить SQL:

- `ai_document_generation_batches` — есть ли колонки `package_session_id`, `run_mode`, `total_items`, `generated`, `errors`, `status`;
- `ai_generated_documents` — есть ли `generation_batch_id`, `package_template_id`, `package_template_item_id`, поддерживается ли `context_type='package_session'`.

Если **всё есть** → миграций не делаем.
Если чего-то не хватает → **сначала** мини-discovery proof, **потом** одна точечная миграция в этой же фазе (CREATE/ALTER + GRANT). Никаких новых сущностей сверх перечисленных.

---

## 7. Proof (обязателен для закрытия фазы)

Файл `.lovable/proofs/sprint_3i_a_package_backend_<date>.md`:

1. **Baseline strict (order)** — снапшот из п.0.
2. **Regression strict (order)** — повтор того же вызова после правок: `resolver_version`, `token_manifest_snapshot`, warnings, `context_type`, `idempotency_key`, наличие DOCX/PDF — идентичны baseline. Diff = 0 значимых полей.
3. **Greps (приложить вывод)**:
  - `rg -n "Docxtemplater|PizZip" supabase/functions/ai-generate-document-package/` → 0
  - `rg -n "gotenberg|convertDocxToPdf" supabase/functions/ai-generate-document-package/` → 0
  - `rg -n "ai_generated_documents'\)\.insert\|from\(.ai_generated_documents.\)" supabase/functions/ai-generate-document-package/` → 0
  - `rg -n "resolvePackageTokenCore" src/` → 0
4. **Runtime package generation** на реальном тестовом пакете:
  - ≥1 item;
  - ≥1 `{{ln-XXXXXX}}` с заполненным assignment;
  - ≥1 `{{package.ul.FLD-XXXXXX}}` ИЛИ `{{package.ip.FLD-XXXXXX}}`;
  - ≥1 системный `{{field:FLD-000069}}` / `{{field:FLD-000070}}`;
  - выход: DOCX url, PDF url, запись `ai_generated_documents` с `context_type='package_session'`, `generation_batch_id`, `package_template_id`, `package_template_item_id`.
5. **Missing assignment scenario**: убрать assignment одной роли → orchestrator не зовёт strict для этого item, возвращает `role_assignment_missing`, batch status `partial`/`blocked`.
6. **Outside-context scenario**: вызвать strict в order-mode с шаблоном, содержащим `{{ln-...}}` → strict вернёт `ln_token_outside_package_context`.
7. **Service-role guard**: попытка дернуть strict с `packageContext` обычной user-JWT → 403 `package_context_forbidden`.
8. **Billing-token-in-package guard**: package-template с `{{field:FLD-<customer_*>}}` → preflight `billing_field_in_package_template`.

---

## 8. Что НЕ делаем в Phase 3I-A

- UI «Сформировать пакет» (user) и «Тестово сформировать» (admin).
- Per-item UI с результатами/скачиванием.
- Package generation history page.
- `HARDCODED_ENABLED=true` flip публичной обёртки.
- Email/Telegram авто-отправка.
- Любые новые FLD, новые `source_path`, расширение `document_token_registry` за пределы того, что уже есть в `packagePlaceholderCatalog`.

---

## Технический раздел: файлы, которые будут затронуты

- `supabase/functions/canonical-document-generate-strict/index.ts` — `packageContext` branch, service-role guard, token validation matrix, единый `generationContext`. Order-path не модифицируется логически.
- `supabase/functions/ai-generate-document-package/index.ts` — полная замена на thin orchestrator. Legacy renderer-импорты удаляются.
- `supabase/functions/_shared/packagePlaceholderCatalog.ts` — зеркало SOT с фронта (read-only data + `findByPackageToken`).
- `supabase/functions/_shared/resolve-package-tokens.ts` — без структурных изменений; экспорт `resolvePackageTokenCore` уже есть.
- `src/hooks/useAiDocumentPackageGeneration.ts` — контракт сужается до `{ package_session_id, run_mode? }`. Существующие call sites адаптируются под новый ввод, но кнопок/новых UI не добавляем.
- (опционально) одна точечная миграция: ALTER `ai_generated_documents` / `ai_document_generation_batches` — только если discovery в п.6 покажет нехватку. Иначе — без миграций.
- `.lovable/proofs/sprint_3i_a_strict_baseline_*.md`, `.lovable/proofs/sprint_3i_a_package_backend_*.md`.
- `.lovable/plan.md` — фиксация фазы.
- Memory: дополнить `mem://architecture/documents/package-document-level-questionnaires-v1.md` секцией про strict packageContext + thin orchestrator; обновить `mem://index.md` одной строкой.

## Definition of Done

1. Baseline + regression strict order-generation — идентичны (proof п.1, п.2).
2. Orchestrator — thin, без legacy renderer/Gotenberg/insert (greps п.3).
3. Реальный пакет генерируется через strict; DOCX + PDF + `ai_generated_documents(context_type='package_session')` (п.4).
4. Все preflight/guard сценарии работают (п.5–п.8).
5. Никаких новых FLD/source mapping; package-резолв только по `copy_ready` каталогу.
6. UI остался без новых кнопок; Phase 3I-B можно начинать на готовой backend-поверхности.