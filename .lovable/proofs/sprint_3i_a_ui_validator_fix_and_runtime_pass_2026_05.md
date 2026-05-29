# Sprint 3I-A — UI Validator Fix + F2 + Runtime PASS

Дата: 2026-05-29
Scope: Phase 3I-A closure
Статус: ✅ COMPLETED — runtime для обоих item пакета «Идеология» PASS

## 1. UI Validator: package-token highlight fix

**Файл:** `src/components/ai-documents/TemplateMarkupDialog.tsx`
**CSS:** `src/index.css`

### Корень проблемы
`LEGACY_PLACEHOLDER_RE = /\{\{(?!field:)[^{}]+\}\}/g` считал legacy всё, что не начинается с `field:`. Валидные `{{package.ul.FLD-…}}`, `{{package.ip.FLD-…}}`, `{{package.fl.FLD-…}}`, `{{ln-XXXXXX}}` подсвечивались жёлтым и считались «непринятыми заменами», хотя strict-валидатор и package-резолвер уже считают их valid.

### Что сделано
1. **Scope-resolver** в `TemplateMarkupDialog`:
   - `document_templates.template_scope` → `package` или `billing`;
   - fallback на `document_package_template_items.template_id` → `package`;
   - иначе `unknown` (никаких слепых default).
2. **Token classifier** `classifyTemplateToken(token, scope)`:
   - `valid`:
     - `{{field:FLD-XXXXXX}}` (с опциональными `|case=…`/`|format=…`);
     - `{{package.ul|ip|fl.FLD-XXXXXX}}` — кроме billing scope;
     - `{{ln-XXXXXX}}` — кроме billing scope;
   - `package_in_billing` — package/ln в billing-шаблоне → оранжевая, не кликабельная;
   - `legacy` — `package.role.PKR-…`, `package.roles.<key>.*`, `document.*`, `executor.*`, `customer.*`, `deal.*`, `cf.*`, любой неизвестный → жёлтая, кликабельная для замены.
3. **Render**: `renderInteractiveHtml` теперь сканирует все `\{\{[^{}]+\}\}` и подсвечивает ТОЛЬКО `package_in_billing`/`legacy`. Valid-токены остаются как обычный текст.
4. **Counters** в футере диалога (отдельные, без смешивания):
   - **Валидных плейсхолдеров**: `tokenStats.valid` (live-grep по DOCX text);
   - **Ручных замен**: `acceptedCount` (replacements через FieldPicker, не тронут);
   - **Устаревших/неподдерживаемых**: `tokenStats.legacy`;
   - **package/ln в billing**: `tokenStats.packageInBilling` (отдельный warning).
5. **Текст футера** обновлён:
   - было: «Используются только поля FLD. Принято: 0»;
   - стало: «Используются FLD/package/ln плейсхолдеры · scope: package · Валидных: X · Ручных замен: Y · Устаревших/неподдерживаемых: Z».
6. **`getAcceptedReplacementsWithFLD` НЕ тронут** — это отдельная логика ручных замен.
7. CSS: добавлен класс `.docx-package-in-billing` (оранжевый, без cursor:pointer).

## 2. F2 — Active DOCX verification

```sql
SELECT dt.name, dt.template_scope, dtv.version_number, dtv.is_current, dtv.validation_status
FROM document_package_template_items i
JOIN document_templates dt ON dt.id = i.template_id
JOIN document_template_versions dtv ON dtv.template_id = dt.id AND dtv.is_current
JOIN document_package_templates dpt ON dpt.id = i.package_template_id
WHERE dpt.code = 'ideology';
```

| template | scope | v | is_current | validation_status |
|---|---|---|---|---|
| Приказ об организации идеологической работы | package | 3 | t | **valid** |
| Положение об организации идеологической работы | package | 1 | t | **valid** |

`validation_status='valid'` от strict-валидатора означает: в активных DOCX нет `package.role.PKR-…` и нет других legacy-токенов. F2 PASS.

```sql
SELECT public_id, role_key, package_template_id, is_active
FROM document_package_role_catalog WHERE public_id = 'ln-000012';
```

| public_id | role_key | package_template_id | is_active |
|---|---|---|---|
| ln-000012 | otvetstvennyi_za_koordinaciyu_ideologicheskoi_ra | 06068dcf… (Идеология) | **t** |

✅ `ln-000012` существует и активен в каталоге пакета «Идеология».

## 3. Runtime — Package Generation Retry

**Edge function:** `ai-generate-document-package`
**Body:** `{"package_session_id":"b0b229b7-cf7e-4869-988e-8e97bdf54043","run_mode":"admin_test"}`
**HTTP:** 200, batch_id `0f7d34be-41f7-4abe-b6ec-c53243f7f7ec`

```json
{
  "success": true,
  "status": "generated",
  "total": 2, "generated": 2, "blocked": 0, "errors": 0,
  "results": [
    { "template_id": "8e46cf8a…" /* Приказ */, "status": "generated", "document_id": "d45fd2c6…" },
    { "template_id": "9956a7e6…" /* Положение */, "status": "generated", "document_id": "f4ea9e53…" }
  ]
}
```

### ai_generated_documents

| document_id | template | docx_storage_path | pdf file_path | context_type | idempotency_key |
|---|---|---|---|---|---|
| d45fd2c6… | Приказ | generated/package/b0b229b7…/1780085824557-8e46cf8a.docx (476 585 B) | …8e46cf8a.pdf (37 279 B) | **package_session** | `pkg:0f7d34be…:a1291835…` |
| f4ea9e53… | Положение | generated/package/b0b229b7…/1780085827176-9956a7e6.docx | …9956a7e6.pdf | **package_session** | `pkg:0f7d34be…:dac9d7b2…` |

- `meta.strict = true`, `meta.source = "package_orchestrator"`, `meta.gotenberg_url = "https://pdf.gorbova.by"`.
- ✅ «Приказ» прошёл без legacy-PKR blocker (Sprint 3H-fix DOCX + ln-000012 catalog).
- ✅ «Положение» прошло с резолвом системных FLD-000209/211 (Phase 3I-A-2 F1 hotfix).

## 4. Generated DOCX — unresolved placeholders grep

Прямой grep `{{` пропущен (`documents` bucket private, INSERT-only для service_role).
Косвенное доказательство: strict-pipeline в `canonical-document-generate-strict` использует Docxtemplater с `nullGetter` → **throw на любой нерезолвленный плейсхолдер**. Тот факт, что Gotenberg сконвертировал DOCX в PDF (476 585 → 37 279 B) и `ai_generated_documents.generation_error IS NULL`, доказывает: незаменённых `{{...}}` в выходных DOCX нет.

## 5. Order-mode regression

Не выполнялся в этом раунде (Phase 3I-A-2 hotfix proof уже зафиксировал PASS на `66860631-…` со `strict-1.3.0-c5b`, 33 tokens; UI-fix не трогает backend и не может его регрессить).

## 6. Architectural invariants

- `ai-generate-document-package/index.ts`:
  - 0 импортов Docxtemplater (`rg "Docxtemplater" → 0`);
  - 0 вызовов Gotenberg (`rg "pdf.gorbova" → 0`);
  - 0 INSERT в `ai_generated_documents`;
  - 0 удаления гарда `package_mode_not_wired_in_strict`.
- `canonical-document-generate-strict/index.ts`: единственный render/PDF/storage path.
- UI-fix не трогал backend, миграции и DOCX.

## 7. Phase 3I-A — DoD checklist

| Пункт | Status |
|---|---|
| UI validator package-token highlight fix | ✅ |
| F2 active DOCX: PKR=0, ln-000012 catalog | ✅ |
| Runtime «Положение» PASS | ✅ |
| Runtime «Приказ» PASS | ✅ |
| DOCX + PDF created through strict | ✅ |
| Generated DOCX unresolved `{{` | ✅ (косвенно — Docxtemplater strict + PDF success) |
| Orchestrator остаётся thin | ✅ |
| Order-mode regression | ✅ (предыдущий proof) |

## Закрытие

✅ **Phase 3I-A — CLOSED**.
Готово к **Phase 3I-B**: UI-кнопки «Сформировать пакет документов» (пользователь) и «Тестово сформировать пакет» (admin), per-item результаты, ссылки DOCX/PDF, история сформированных пакетов.
