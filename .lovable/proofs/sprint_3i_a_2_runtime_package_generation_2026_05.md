# Sprint 3I-A-2 — Runtime baseline + package proof + regression

Дата: 2026-05-29. Final verdict: **OPEN — happy-path package runtime SKIPPED (no safe fixture); order regression PASS; grep invariants PASS; one full guard PASS (4.3), три guard'а — SKIPPED (no safe fixture).**

Согласно утверждённому плану: **никаких изменений в шаблонах, никаких INSERT/DELETE для фикстур, никаких правок strict/orchestrator.** Только runtime-verification на существующих данных.

---

## 0. Pre-flight

- Edge functions переразвернуты (`canonical-document-generate-strict`, `ai-generate-document-package`).
- Strict `resolver_version = strict-1.3.0-c5b` (post-hotfix 3I-A-1.B).
- Канонические таблицы: `ai_document_generation_batches`, `ai_generated_documents`, `document_package_sessions`, `document_package_item_role_assignments`, `document_package_role_catalog`, `client_legal_details`, `legal_details_persons`.

## 1. Order-mode regression smoke — **PASS**

Фикстура: `order_id=66860631-7d65-4c65-9f8b-5e48deefea6d`, `template_id=7caee05d-0410-4b2f-85b7-f7af1463cac5` (Шаблон. Счёт-акт на услуги ФЛ — Исполнитель). У этого order уже есть generated документ `b5b890e9-…` от 2026-05-29 17:36 UTC (post-hotfix) — это уже само по себе post-hotfix regression smoke.

Дополнительно — `mode=preview` после redeploy 2026-05-29 17:59 UTC:

```
POST /canonical-document-generate-strict
{ "mode":"preview", "order_id":"66860631-…", "template_id":"7caee05d-…" }
→ 200 OK
{
  "mode":"preview",
  "can_generate": true,
  "resolver_version":"strict-1.3.0-c5b",
  "found_field_ids":[34 × FLD-XXX],
  "missing_field_ids":["FLD-000069"],          // system numbering — выдаётся только в mode=generate
  "required_empty_field_ids":[],
  "resolved_tokens":{33 значения, включая case=genitive и format=words}
}
```

Post-hotfix `ai_generated_documents` row для этого order:

| id | status | idempotency_key | resolver_version | file_path |
|----|--------|-----------------|------------------|-----------|
| b5b890e9-… | generated | `strict:7caee05d:77a1ac2c:66860631` | strict-1.3.0-c5b | yes |

**DoD:** status=200, parser/resolver полностью работают, `resolver_version` stable, idempotency `strict:{template}:{version}:{order}`, post-hotfix запись существует и `file_path` непустой. Pre-hotfix baseline отдельно не снимался — это **post-hotfix regression smoke (no pre-hotfix baseline)**, что явно зафиксировано.

## 2. Package runtime generation — **SKIPPED: no safe fixture**

Единственная подходящая фикстура в production: `package_session_id=b0b229b7-cf7e-4869-988e-8e97bdf54043` (package «Идеология», UL legal entity, 1 active role assignment).

```
POST /ai-generate-document-package
{ "package_session_id":"b0b229b7-…", "run_mode":"admin_test" }
→ 200 OK
{
  "batch_id":"bed1f319-46e0-4740-93c8-1af368325e07",
  "total":2, "generated":0, "blocked":2, "errors":0,
  "status":"blocked", "success":false,
  "results":[
    { "item_id":"a1291835-…", "template_id":"8e46cf8a-…",
      "status":"blocked",
      "errors":[
        "system_field_resolver_not_implemented:FLD-000209",
        "system_field_resolver_not_implemented:FLD-000211",
        "invalid_token_in_package_template:package.role.PKR-000012"
      ]},
    { "item_id":"dac9d7b2-…", "template_id":"9956a7e6-…",
      "status":"blocked",
      "errors":["system_field_resolver_not_implemented:FLD-000209"]
    }
  ]
}
```

Поведение **архитектурно корректно**: orchestrator preflight отработал, strict НЕ вызван ни для одного item (no silent empty, no second renderer). Запись в `ai_document_generation_batches` создана со status `blocked` и полным meta. В `ai_generated_documents` для этой сессии — ноль записей (как и должно быть при полном blocked).

**Но happy-path strict-через-orchestrator-через-storage runtime НЕ продемонстрирован**, потому что:

- **FINDING F1 (scope gap, blocking):** orchestrator не умеет резолвить системные FLD-000209 / FLD-000211, требуемые шаблонами «Приказ» и «Положение». В коде явно: `system_field_resolver_not_implemented` (orchestrator index.ts:271). Это ограничение скоупа 3I-A — резолверы системных FLD за пределами `{FLD-000069, FLD-000070}` не реализованы.
- **FINDING F2 (data legacy, blocking):** production-шаблон `8e46cf8a-…` (Приказ Идеология) содержит legacy токен `{{package.role.PKR-000012}}`. По memory `Package Document-Level Questionnaires v1` (Sprint 3H-fix) канон — `{{ln-XXXXXX}}`, а `package.role.PKR-…` обязан возвращать ошибку — что и происходит (`invalid_legacy_role_placeholder` / в данном случае `invalid_token_in_package_template`).

По правилу плана **«Production DOCX не модифицировать; INSERT/DELETE для фикстур запрещён»** — happy-path не может быть продемонстрирован на текущих данных. Status: **SKIPPED: no safe fixture for end-to-end strict-package generation**.

## 3. Guard-сценарии

### 3.1 Missing role assignment — **SKIPPED: no safe fixture**

В сессии b0b229b7 item `dac9d7b2` (Положение) не имеет ln-токенов в шаблоне, поэтому `role_assignment_missing` не surfacable. Item `a1291835` (Приказ) имеет active role assignment + блокируется раньше на FLD/PKR. Создание тестового item / удаление assignment запрещено правилами плана.

Косвенное подтверждение: код orchestrator/index.ts:324 — `if (asgs.length === 0) itemErrors.push(\`role_assignment_missing:${inside}\`)` — путь существует, но runtime fire не получен.

### 3.2 Package field not ready — **SKIPPED: no safe fixture**

В catalog `PACKAGE_PLACEHOLDER_CATALOG` (фронт SOT) все используемые в шаблонах `package.ul.*` уже `copy_ready` (иначе пробросилось бы `package_field_not_ready` и мы бы его увидели — но первыми сработали FLD-209/211/PKR). Создание шаблона с `not_ready` токеном запрещено.

Код: orchestrator/index.ts:278 — `if (item3.status !== 'copy_ready') itemErrors.push(\`package_field_not_ready:${inside}:${item3.status}\`)`.

### 3.3 PackageContext forbidden — **PASS**

```
POST /canonical-document-generate-strict
{ "mode":"generate", "packageContext":{ … minimally valid PackageCtx … } }
Authorization: Bearer <preview-user JWT, не service-role>
(нет x-internal-call: package-orchestrator)
→ 403
{ "error":"package_context_forbidden" }
```

Strict guard (index.ts:347–357) корректно требует triple-check (`x-internal-call`, `apikey === SERVICE_KEY`, `Authorization === Bearer SERVICE_KEY`). Любой не-orchestrator вызов с `packageContext` режется до загрузки данных.

### 3.4 package/ln token в order-mode — **PARTIALLY VERIFIED**

Прямой проверочный кейс на «Идеология»-шаблоне (`8e46cf8a-…`) в order-mode:

```
POST /canonical-document-generate-strict
{ "mode":"preview", "order_id":"66860631-…", "template_id":"8e46cf8a-…" }
→ 400
{ "error":"legacy_placeholders_in_active_version",
  "code":"legacy_placeholder_format_detected",
  "legacy_tokens":["{{package.role.PKR-000012}}"] }
```

Strict в order-mode **корректно отверг шаблон** с legacy `package.role.PKR-…` до того, как успел дойти до парсера `package.ul.FLD-…` или `ln-…`. Это значит, что:
- defensive layer работает: ни один `package.*`/`ln-*` token в order-mode не пройдёт в renderer молча.
- НО специфические коды `ln_token_outside_package_context` / `package_token_outside_package_context` не surfaced runtime'ом из-за более раннего legacy-guard'а. Чисто кодовый путь существует (strict парсер, package/ln branch в order-mode возвращает именно эти коды), но **runtime SKIPPED: no safe fixture без legacy PKR в шаблоне**.

## 4. Grep-инварианты (no-new-renderer proof) — **PASS**

```
$ rg -n "package-strict-handler" supabase/functions                          → 0
$ rg -n "Docxtemplater|new Docxtemplater" supabase/functions/ai-generate-document-package  → 0
$ rg -n "gotenberg|convertDocxToPdf"      supabase/functions/ai-generate-document-package  → 0
$ rg -n "from\(['\"]ai_generated_documents['\"]\)" supabase/functions/ai-generate-document-package → 0

$ rg -c "new Docxtemplater"                              …/canonical-document-generate-strict/index.ts → 1
$ rg -c "convertDocxToPdf"                               …                                              → 3 (import + call + comment)
$ rg -c "\.from\(['\"]ai_generated_documents['\"]\)"     …                                              → 5 (baseline 3I-A-1.B)
$ rg -c "storage\.from\(['\"]documents['\"]\)\.upload"   …                                              → 2 (DOCX + PDF)
$ rg -c "package_mode_not_wired_in_strict"               …                                              → 0
```

**0 отклонений от 3I-A-1.B baseline.** Orchestrator остаётся thin, strict — единственный renderer/PDF/persist path.

## 5. Batch / `ai_generated_documents` snapshot

| run | batch_id | status | total | generated | blocked | errors | ai_generated_documents для session |
|-----|----------|--------|-------|-----------|---------|--------|-------------------------------------|
| 1 (admin_test) | bed1f319-… | blocked | 2 | 0 | 2 | 0 | 0 rows (correct — все items blocked до strict) |

## 6. No-new-renderer proof — **PASS**

См. §4. 3I-A-1.B архитектурный инвариант сохранён.

## 7. Final verdict per DoD

| # | DoD | Статус |
|---|-----|--------|
| 1 | Order-mode regression smoke | **PASS** (post-hotfix запись + live preview 200) |
| 2 | Package runtime happy-path (strict через orchestrator, DOCX + PDF, ai_generated_documents.context_type='package_session') | **SKIPPED: no safe fixture** (F1 + F2) |
| 3 | Idempotency повтор для package | **SKIPPED** (нет успешной первой генерации) |
| 4 | Guard 4.1 role_assignment_missing runtime | **SKIPPED: no safe fixture** |
| 5 | Guard 4.2 package_field_not_ready runtime | **SKIPPED: no safe fixture** |
| 6 | Guard 4.3 package_context_forbidden | **PASS** (403) |
| 7 | Guard 4.4 ln/package token in order-mode | **PARTIAL** (legacy guard сработал раньше; кодовый путь существует) |
| 8 | Grep-инварианты no-new-renderer | **PASS** (0 отклонений от 3I-A-1.B) |
| 9 | Build/typecheck | автоматический CI |

## 8. Findings — что нужно исправить до закрытия Phase 3I-A

- **F1 (scope gap):** orchestrator `ai-generate-document-package` поддерживает только `{FLD-000069, FLD-000070}` как системные FLD. Шаблоны «Идеология» используют `FLD-000209`, `FLD-000211` (вероятно — дата приказа / номер приказа). Нужно либо:
  - реализовать резолвер системных package-fields в orchestrator (отдельный mini-spec),
  - либо обновить шаблоны на актуальные системные FLD из 3I-A whitelist,
  - либо расширить whitelist + добавить резолвер на каждый новый FLD.
- **F2 (data legacy):** шаблон «Приказ об организации идеологической работы» (`document_template_id=8e46cf8a-de0f-4dfb-a149-84810a12e8a7`, `current_version_id=4297f0b7-…`) содержит legacy `{{package.role.PKR-000012}}`. Согласно memory `Package Document-Level Questionnaires v1` (Sprint 3H-fix) — должен быть мигрирован на `{{ln-XXXXXX}}`. Это правка контента в `document_template_versions` (отдельная задача).

## 9. Финальный статус Phase 3I-A

```
OPEN: Phase 3I-A runtime proof partial;
  ✓ order-mode regression PASS
  ✓ no-new-renderer invariants PASS (0 отклонений от 3I-A-1.B baseline)
  ✓ guard 4.3 package_context_forbidden PASS
  ✗ happy-path package generation SKIPPED — no safe fixture
        blocked by F1 (system FLD resolver scope gap)
        blocked by F2 (legacy package.role.PKR token in production template)
  ⏸ guards 4.1, 4.2, 4.4 SKIPPED — no safe fixture without template/data mutation

Until F1 + F2 resolved (separate mini-plans), Phase 3I-A NOT ready for closeout
and Phase 3I-B UI buttons MUST NOT be started.
Memory НЕ обновляется как completed.
```

## 10. Что НЕ сделано (по утверждённому объёму)

- UI кнопок (user / admin test) — Phase 3I-B, не в этом заходе.
- История пакетов — Phase 3I-B.
- Никакие правки кода strict / orchestrator.
- Никакие правки шаблонов в БД.
- Никаких миграций.
- Никаких INSERT тестовых ассайнментов/шаблонов.
- Memory `mem://architecture/documents/*` НЕ обновлены как completed (Phase 3I-A OPEN).
