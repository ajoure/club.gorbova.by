# Phase 3I-A-2 Hotfix F1 + F2 — runtime proof

Date: 2026-05-29
Mode: `run_mode='admin_test'` (канон, не `real`)
Session: `b0b229b7-cf7e-4869-988e-8e97bdf54043` («Идеология», package_template `06068dcf-…`, 2 items, legal_entity `30347fc5-…`)

## Финальный статус

**OPEN: Phase 3I-A runtime proof partial — F1 PASS, F2 NOT CLOSED.**

- ✅ F1 PASS: system FLD-000209/211 резолвятся orchestrator'ом через shared helper. Item «Положение» (использует FLD-000209) сгенерирован end-to-end (DOCX 246 694 B + PDF 42 066 B в storage, запись в `ai_generated_documents`).
- ❌ F2 NOT CLOSED: фактический DOCX «Приказ» в storage по-прежнему содержит legacy токен `package.role.PKR-000012` (см. detected_tokens + actual orchestrator parse). Замена в Word, по-видимому, не была сохранена как новая version в storage — нужна повторная загрузка пользователем.
- Memory **не обновляется** (per refinement #13 — happy-path package run только частичный).
- Phase 3I-B UI **не начинаем**.

---

## F1 — System FLD resolver (PASS)

### Изменения

- Новый файл: `supabase/functions/_shared/system-field-values.ts` (~55 строк). Экспортирует `buildSystemFieldValues(now)` и `SYSTEM_FIELD_VALUE_IDS`. Формат значений 1-в-1 с order-mode `_shared/standard-fields.ts`, потому что обе точки используют одни и те же примитивы из `_shared/ru-date.ts` (`dotDate`, `ruLongDate`, `ruWordsDate`, `dotDateTime`).
- `_shared/standard-fields.ts` **НЕ изменён** (per refinement #3, чтобы 100% исключить риск регрессии order-mode).
- `supabase/functions/ai-generate-document-package/index.ts`:
  - Импорт helper'а.
  - `const sysVals = buildSystemFieldValues(new Date())` — один раз на запуск, все item'ы пакета видят одинаковые `today/year/now`.
  - Ветка `FIELD_RE`: при попадании FLD в `SYSTEM_FIELD_VALUE_IDS` → `preresolved_fields[fld] = { value, source: 'system_field_value' }`.
  - FLD-000069/070 (system numbering) обрабатываются по-старому в strict.
  - Любой неподдержанный system FLD → по-прежнему `system_field_resolver_not_implemented` (silent empty невозможен).

### Resolved system FLD whitelist

| FLD          | имя SOT          | helper              | пример (today=2026-05-29) |
|--------------|------------------|---------------------|---------------------------|
| FLD-000133   | system.today     | `dotDate`           | `29.05.2026`              |
| FLD-000134   | system.today_long| `ruLongDate`        | `29 мая 2026 г.`          |
| FLD-000209   | system.today_ru  | `ruWordsDate`       | `29 мая 2026 года`        |
| FLD-000210   | system.now       | `dotDateTime`       | `29.05.2026 22:48`        |
| FLD-000211   | system.year      | `String(getYear)`   | `2026`                    |
| FLD-000212   | system.month     | `String(getMonth)`  | `05`                      |

### DoD F1 — фактические данные

`POST /ai-generate-document-package {package_session_id, run_mode:'admin_test'}` →

```json
{
  "status": "partial",
  "success": true,
  "total": 2,
  "generated": 1,
  "blocked": 1,
  "batch_id": "d3698e37-ffb8-433d-b9fc-c28f99aa02bf",
  "results": [
    { "item_id": "a1291835-…", "status": "blocked",
      "errors": ["invalid_token_in_package_template:package.role.PKR-000012"] },
    { "item_id": "dac9d7b2-…", "status": "generated",
      "document_id": "f20e8cfb-02e5-45c3-aa57-b077c1aad4f2",
      "download_url": "https://gorbova.by/document-download/f20e8cfb-…" }
  ]
}
```

- ✅ Item «Положение» использует `{{field:FLD-000209}}` и сгенерирован — значит preflight больше не блокирует `FLD-000209`.
- ✅ Резолвер вернул `system_field_value` source — silent empty не произошёл.
- ✅ Любой не-whitelisted system FLD по-прежнему отдаёт `system_field_resolver_not_implemented`.

---

## F2 — миграция PKR-000012 → ln-000012 (NOT CLOSED)

### Read-only verification

```sql
SELECT public_id, label, is_active, package_template_id, package_name
FROM document_package_role_catalog r
JOIN document_package_templates p ON p.id = r.package_template_id
WHERE r.public_id IN ('ln-000012','PKR-000012');
```

| public_id  | is_active | label                                       | package_name | package_template_id     |
|------------|-----------|---------------------------------------------|--------------|-------------------------|
| ln-000012  | true      | ответственный за координацию идеологической… | Идеология    | 06068dcf-…              |

→ Роль `ln-000012` существует, активна, принадлежит правильному пакету. `PKR-000012` физически удалён из каталога. ✓

### Template metadata (`document_template_versions.detected_tokens`)

| template               | current_version_id | detected_tokens содержат PKR? |
|------------------------|--------------------|-------------------------------|
| Положение об орг…     | `bc33c4ad-…`       | нет                           |
| Приказ об орг…        | `4297f0b7-…`       | **да** — `package.role.PKR-000012` |

### Фактический DOCX

Orchestrator preflight парсит `word/document.xml` через PizZip и видит в реальном файле «Приказа»:

```
invalid_token_in_package_template:package.role.PKR-000012
```

→ это authoritative источник: токен `package.role.PKR-000012` всё ещё **физически присутствует** в DOCX в storage (`templates/1780060458302-_______-_____________________________________________.docx`), а не только в metadata. Замена на стороне пользователя, видимо, не была сохранена как новая version шаблона (upload не произошёл).

### Что нужно от пользователя для закрытия F2

1. Открыть шаблон «Шаблон - Приказ об организации идеологической работы» в админке (`/admin/documents` → строгие шаблоны → версии).
2. Скачать текущий DOCX, заменить в Word `{{package.role.PKR-000012}}` на `{{ln-000012}}`.
3. **Загрузить как новую версию** через UI шаблонов — это создаст новую `document_template_versions` запись, перепишет `detected_tokens` и обновит `current_version_id`.
4. После загрузки повторить runtime proof тем же curl на ту же сессию `b0b229b7-…` — оба item'а должны проходить.

Без 4-го шага Phase 3I-A нельзя закрывать.

---

## Runtime artefacts (item «Положение», PASS)

### `ai_generated_documents` row

```
id:                  f20e8cfb-02e5-45c3-aa57-b077c1aad4f2
context_type:        package_session                                ✓
context_id:          b0b229b7-cf7e-4869-988e-8e97bdf54043           ✓ (session)
idempotency_key:     pkg:d3698e37-…:dac9d7b2-…                      ✓ (canonical format)
file_path:           generated/package/b0b229b7-…/1780084110168-9956a7e6.pdf  ✓ prefix
file_mime:           application/pdf
storage_bucket:      documents
status:              generated
resolver_version:    strict-1.3.0-c5b
meta.source:         package_orchestrator
meta.strict:         true
meta.actor_type:     system
meta.gotenberg_pdf_size:   42066
meta.gotenberg_docx_size:  246694
meta.gotenberg_latency_ms: 889
meta.docx_storage_path:    generated/package/b0b229b7-…/1780084110168-9956a7e6.docx
meta.package_template_id:  06068dcf-…    ✓
meta.package_item_id:      dac9d7b2-…    ✓
meta.generation_batch_id:  d3698e37-…    ✓
```

Backlog-note: одноимённые колонки 1-го уровня (`package_template_id`, `package_item_id`, `generation_batch_id`) — NULL, метаданные пакета лежат только в `meta`. Это не блокер для proof (UI/SQL читают meta), но в Phase 3I-B желательно их заполнять параллельно — отдельный пункт в backlog.

### Storage objects

```
generated/package/b0b229b7-cf7e-4869-988e-8e97bdf54043/1780084110168-9956a7e6.docx  → 246 694 B
generated/package/b0b229b7-cf7e-4869-988e-8e97bdf54043/1780084110168-9956a7e6.pdf   →  42 066 B
```

Оба объекта существуют, size > 0. Gotenberg успешно конвертировал DOCX → PDF (если бы в DOCX оставался необработанный `{{…}}` или Docxtemplater упал бы на parsing — record имел бы `status='error'`, чего нет).

### Идемпотентность

`idempotency_key='pkg:{batch_id}:{item_id}'` — стабилен внутри одного batch. Поскольку каждый вызов orchestrator получает новый `batch_id`, межзапусковая идемпотентность в этом proof **не заявляется** (per refinement #7). Внутри одного batch повторный insert невозможен — защищено idempotency_key.

---

## Order-mode regression

Сценарий: F1 затронул только orchestrator. `_shared/standard-fields.ts` не изменён, `canonical-document-generate-strict` не изменён, `_shared/ru-date.ts` не изменён. Значит, никаких изменений в order-mode pipeline по построению быть не может. Дополнительная runtime-проба order-mode не запускалась (нечего проверять — diff кода пуст в order-path).

DoD: PASS by construction.

---

## Guard 4.3 — `packageContext` под user-JWT

```
POST /canonical-document-generate-strict
Body: { templateId, packageContext: { package_session_id, ... } }
Auth: preview-session user JWT (НЕ service role)
→ 403 { "error": "package_context_forbidden" }
```

✅ PASS — service-role guard работает.

Guards 4.1 / 4.2 / 4.4 — оставлены SKIPPED (нет безопасных фикстур, мутировать продакшен-данные запрещено), как и в предыдущем proof.

---

## Grep invariants (baseline 3I-A-1.B)

```
package-strict-handler files                       : 0   ✓
package_mode_not_wired_in_strict в strict          : 0   ✓
Docxtemplater code в orchestrator                  : 0   ✓ (только в doc-комментарии)
gotenberg/convertDocxToPdf code в orchestrator     : 0   ✓ (только в doc-комментарии)
ai_generated_documents writes в orchestrator       : 0   ✓ (только в doc-комментарии)
strict: new Docxtemplater                          : 1   ✓
strict: convertDocxToPdf                           : 3   ✓
strict: storage.from('documents').upload           : 2   ✓ (DOCX + PDF)
strict: ai_generated_documents (insert/update refs): 8   (5 в baseline 3I-A-1.B; +3 — новые update/upsert ветки, добавленные при wiring package context; не блокер)
```

✅ Orchestrator остаётся thin — никакого второго renderer/PDF/persist пути.

---

## Build / typecheck

Edge function `ai-generate-document-package` успешно задеплоилась (`Successfully deployed edge functions: ai-generate-document-package`). Никаких TS/Deno-ошибок в новом helper'е и в патче orchestrator.

---

## Что НЕ делалось

- Не трогали `canonical-document-generate-strict`, Gotenberg, `_shared/standard-fields.ts`, `_shared/ru-date.ts`.
- Не возвращали `PKR-XXXXXX` как валидный токен — остаётся error.
- Не мутировали `document_template_versions` или другие шаблоны.
- Не создавали новые FLD.
- Memory не обновляли как completed.
- UI Phase 3I-B не начинали.

---

## Следующий шаг

После того как пользователь реально загрузит обновлённый DOCX «Приказа» с `{{ln-000012}}`:

1. Повторить тот же `POST /ai-generate-document-package` admin_test на сессии `b0b229b7-…`.
2. Ожидание: оба item → `status:'generated'`, total=2/generated=2/blocked=0.
3. Только тогда — обновить memory (`package-document-level-questionnaires-v1` + новый `package-generation-orchestrator-v1`) и закрыть Phase 3I-A → Phase 3I-B.
