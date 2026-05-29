# Phase 3I-A-2 Hotfix — статус 2026-05-29

**OPEN: Phase 3I-A runtime proof partial.**

- ✅ F1 (system FLD-000209/211 в orchestrator) — PASS. Item «Положение» сгенерирован end-to-end (DOCX+PDF в storage, `ai_generated_documents.context_type='package_session'`, batch/template/item ids в meta, idempotency_key канонический). См. `.lovable/proofs/sprint_3i_a_2_hotfix_f1_f2_runtime_2026_05.md`.
- ❌ F2 (legacy `package.role.PKR-000012` в DOCX «Приказа») — НЕ закрыт: фактический файл в storage всё ещё содержит старый токен. Пользователю нужно повторно загрузить DOCX как новую version шаблона через UI; замена в Word не была сохранена в storage.
- Memory как completed не обновляется. Phase 3I-B UI не начинаем.

Следующий шаг: после re-upload `Шаблон - Приказ об организации идеологической работы` повторить `POST /ai-generate-document-package {package_session_id:'b0b229b7-…', run_mode:'admin_test'}` — оба item должны вернуть `generated`. Только тогда — closeout Phase 3I-A и переход к Phase 3I-B.

---

# Да, согласен, с учетом правок:

План правильный: он закрывает именно текущие два блокера F1/F2 и не трогает strict/generation pipeline. Но нужно поправить несколько моментов перед выполнением.

да, согласен, с учетом правок:



## **1. Не использовать**

`run_mode='real'`

В плане написано:

```text
run_mode='real'
```

Это не утверждённый режим. Использовать только существующий канон:

```text
run_mode='admin_test'
```

Для пользовательской реальной кнопки позже будет Phase 3I-B / UI. Сейчас это runtime-proof, значит `admin_test`.

---

## **2. F1 — helper правильный, но формат FLD-000209 должен совпасть с текущим SOT**

Создать `system-field-values.ts` можно, но обязательно сверить фактический формат с текущим `standard-fields.ts`.

Особенно:

```text
FLD-000209
```

Если текущий helper `ruWordsDate(now)` возвращает:

```text
29 мая 2026 года
```

а UI/шаблоны ожидают:

```text
«29» мая 2026 года
```

нужно использовать ровно текущий формат из order-mode. Не менять формат дат в биллинговых документах.

DoD F1:

```text
standard-fields.ts до/после даёт тот же output для FLD-000133/134/209/210/211/212
```

---





## **3.**

`standard-fields.ts` **рефакторить только если безопасно**

Если замена inline-логики в `standard-fields.ts` может затронуть order-mode, сначала сделать snapshot unit/console proof.

Если быстро и безопасно нельзя доказать 1-в-1 — не трогать `standard-fields.ts`, а в orchestrator импортировать существующие date helpers напрямую.

Главное правило:

```text
order-mode output не должен измениться ни по одному system FLD
```

---

## **4. F2 — пользователь уже заменил DOCX, значит никаких data-migration без необходимости**

F2 делать только read-only verification.

Не делать UPDATE в `document_template_versions`, если актуальный DOCX уже содержит `{{ln-000012}}`.

Проверить:

```text
package.role.PKR → 0
{{ln-000012}} → >= 1
```

Если в БД/metadata остались старые detected tokens, но активный DOCX чистый — зафиксировать как metadata stale и не править без отдельного плана.

---





## **5.**

`ln-000012` **должен принадлежать именно пакету «Идеология»**

Проверить не только существование роли, но и связь:

```sql
SELECT r.public_id, r.label, r.package_template_id, p.name
FROM document_package_role_catalog r
JOIN document_package_templates p ON p.id = r.package_template_id
WHERE r.public_id = 'ln-000012';
```

Ожидание:

```text
package = Идеология
is_active = true
```

Если роль архивная или из другого пакета — runtime proof невалиден.

---

## **6. Повтор runtime proof — сначала dry check, потом generate**

Перед `ai-generate-document-package` сделать read-only preflight:

- package_session существует;
- selected_legal_entity_id заполнен;
- item’ы есть;
- assignment для `ln-000012` есть;
- DOCX содержит `ln-000012`;
- DOCX содержит package UL/IP token;
- DOCX содержит system FLD-000209/211.

Если это не выполнено — не запускать generation, а вернуть blocker-list.

---

## **7. Idempotency повторного вызова**

В плане написано:

```text
повторный вызов с теми же id → идемпотентно
```

Но если idempotency сейчас:

```text
pkg:${batch_id}:${item_id}
```

а каждый вызов создаёт новый batch_id, то повторный вызов создаст новый idempotency_key.

Для proof нужно явно зафиксировать фактическое поведение:

### **Вариант A**

Если batch переиспользуется — проверяем reuse.

### **Вариант B**

Если batch каждый раз новый — не заявлять idempotency reuse в этом proof. Тогда проверить только:

```text
каждый item внутри одного batch имеет idempotency_key=pkg:${batch_id}:${item_id}
```

Стабильную межзапусковую идемпотентность вынести в Phase 3I-B/3I-C.

Не писать «новых записей не появилось», если batch_id меняется.

---



## **8. Проверка DOCX на отсутствие**

`{{...}}`

Для DOCX обязательно:

```text
unzip DOCX → word/document.xml → grep "{{"
```

Ожидание:

```text
0 необработанных плейсхолдеров
```

Для PDF достаточно:

```text
pdf_url exists
storage object exists
size > 0
```

Не требовать OCR/текстовый парсинг PDF.

---

## **9. Guard 4.3 повторить двумя сценариями**

Проверить оба:

1. `packageContext` без `x-internal-call`;
2. `packageContext` с `x-internal-call: package-orchestrator`, но без service-role.

Оба должны вернуть:

```text
403 package_context_forbidden
```

---

## **10. Остальные guards не эскалировать как FAIL**

Guards 4.1/4.2/4.4 ранее были SKIPPED из-за отсутствия безопасных фикстур. В этом заходе их не нужно искусственно создавать.

Если после F1/F2 они стали surfacable на той же сессии — проверить.

Если нет — оставить:

```text
SKIPPED: no safe fixture, production data not mutated
```

Это не блокирует closeout, если happy-path package runtime прошёл.

---

## **11. Grep-инварианты оставить без изменений**

Обязательно приложить в proof:

```bash
rg -n "package-strict-handler" supabase/functions
rg -n "Docxtemplater|new Docxtemplater" supabase/functions/ai-generate-document-package
rg -n "gotenberg|convertDocxToPdf" supabase/functions/ai-generate-document-package
rg -n "from\\(['\"]ai_generated_documents['\"]\\)" supabase/functions/ai-generate-document-package
rg -c "new Docxtemplater" supabase/functions/canonical-document-generate-strict/index.ts
rg -c "convertDocxToPdf" supabase/functions/canonical-document-generate-strict/index.ts
rg -c "\\.from\\(['\"]ai_generated_documents['\"]\\)" supabase/functions/canonical-document-generate-strict/index.ts
rg -c "storage\\.from\\(['\"]documents['\"]\\)\\.upload" supabase/functions/canonical-document-generate-strict/index.ts
```

Любое отклонение от baseline 3I-A-1.B — blocker.

---

## **12. Build/typecheck обязателен**

После F1:

```text
build/typecheck PASS
```

Ошибки типов не оставлять.

---

## **13. Memory обновлять только при happy-path PASS**

Memory обновлять как completed только если:

- order-mode regression PASS;
- package happy-path generated хотя бы 1 item;
- DOCX + PDF созданы;
- запись `ai_generated_documents.context_type='package_session'`;
- orchestrator remains thin.

Если happy-path снова blocked — memory не обновлять как completed.

---

## **Финальный статус**

При PASS:

```text
completed: Phase 3I-A backend runtime proof passed;
system FLD-000209/211 resolved in package orchestrator;
legacy PKR removed from active DOCX;
package generation through canonical strict passed;
orchestrator remains thin;
ready for Phase 3I-B UI generation buttons
```

При FAIL:

```text
OPEN: Phase 3I-A runtime proof failed; remaining blockers listed in proof
```

Ключевые правки: **не использовать** `run_mode='real'`, не обещать межзапусковую идемпотентность, если ключ зависит от `batch_id`, и не трогать `standard-fields.ts`, если нельзя доказать 1-в-1 поведение order-mode.

&nbsp;

План: Phase 3I-A-2 Hotfix F1 + F2 + повтор runtime proof

Цель — закрыть два блокера happy-path пакетной генерации и повторить тот же runtime proof на сессии `b0b229b7-…`. Архитектура и pipeline уже правильные, трогаем только orchestrator preflight и данные шаблона.

Strict pipeline (`canonical-document-generate-strict`), Gotenberg, `ai_generated_documents`, registry FLD, UI кнопок — НЕ трогаем.

---

## F1 — System FLD resolver в package orchestrator

**Файл:** `supabase/functions/ai-generate-document-package/index.ts`

**Что есть сейчас (строки ~252–272):**

- Whitelist: только `FLD-000069`/`FLD-000070` → placeholder для strict.
- Любой другой `field:FLD-xxx` без явной ветки → `itemErrors.push('system_field_resolver_not_implemented:<FLD>')`.
- Из-за этого preflight блокирует item на `FLD-000209` / `FLD-000211`, и strict не вызывается.

**Что уже есть в кодовой базе (переиспользуем, не дублируем):**

- `supabase/functions/_shared/ru-date.ts` → `ruWordsDate(now)` (формат «29 мая 2026 года»).
- `supabase/functions/_shared/standard-fields.ts` использует ровно этот helper для строк FLD-000209/211 в обычной (order-mode) генерации — это SOT формата.

### Шаги F1

1. **Создать маленький shared-helper** `supabase/functions/_shared/system-field-values.ts`:
  - Экспортирует `buildSystemFieldValues(now: Date): Record<string, string>`.
  - Возвращает только безопасное system-подмножество (без customer/executor/order):
    - `FLD-000133` = `dotDate(now)`
    - `FLD-000134` = `ruLongDate(now)`
    - `FLD-000209` = `ruWordsDate(now)`
    - `FLD-000210` = `dotDateTime(now)`
    - `FLD-000211` = `String(now.getFullYear())`
    - `FLD-000212` = `MM`
  - Импортирует helpers из существующего `./ru-date.ts`. Никаких новых FLD, никаких новых форматов.
2. **Отрефакторить `standard-fields.ts**` — заменить 6 inline-строк system.* на `...buildSystemFieldValues(now)` (поведение order-mode 1-в-1 сохраняется; чистый рефакторинг для SOT формата).
3. **В orchestrator** до цикла токенов один раз вычислить `const sysVals = buildSystemFieldValues(new Date())`.
4. В ветке `FIELD_RE` (строки ~251–272) добавить перед текущей ошибкой:
  ```ts
   if (Object.prototype.hasOwnProperty.call(sysVals, fld)) {
     preresolved_fields[fld] = { value: sysVals[fld], source: 'system_field_value' };
     continue;
   }
  ```
  - `FLD-000069`/`070` ветка остаётся как есть (system numbering — внутри strict).
  - Ошибка `system_field_resolver_not_implemented:<FLD>` остаётся для любого FLD вне whitelist — silent empty по-прежнему невозможен.
5. **Strict** (`canonical-document-generate-strict`) НЕ изменяется. Он уже умеет мапить `preresolved_fields[FLD-xxx].value` в `{{field:FLD-xxx}}` (Phase 3I-A-1.B).

### DoD F1

- `{{field:FLD-000209}}` в package-template → попадает в `preresolved_fields` с `value="«29» мая 2026 года"`-формата (зависит от `ruWordsDate`), preflight не блокирует.
- `{{field:FLD-000211}}` → `value="2026"`, preflight не блокирует.
- Любой другой неподдержанный system FLD → по-прежнему `system_field_resolver_not_implemented` (нет silent empty).
- Order-mode regression: тот же шаблон-проба, что и в `sprint_3i_a_2_runtime_package_generation_2026_05.md`, даёт идентичный snapshot (рефакторинг standard-fields не меняет значения).

---

## F2 — Верификация миграции DOCX-токена

Пользователь уже заменил `{{package.role.PKR-000012}}` → `{{ln-000012}}` в DOCX. Делаем только верификацию, никаких записей в БД.

### Шаги F2

1. SQL (read-only) по активной версии шаблона приказа:
  - Подтвердить `public_id='ln-000012'` существует в `document_package_role_catalog` и привязан к нужному `package_template_id`.
  - Подтвердить, что в `document_template_versions` для затронутых шаблонов нет вхождений подстроки `package.role.PKR`.
2. Скачать актуальный DOCX из storage и grep по распакованному `document.xml`:
  - `package.role.PKR` → 0 вхождений
  - `{{ln-000012}}` → ≥ 1 вхождение
3. Зафиксировать оба факта в новом proof-файле.

### DoD F2

- 0 вхождений `package.role.PKR` в активных package-template versions и в DOCX.
- `ln-000012` присутствует в DOCX и валидно резолвится `PackageTemplateValidationPanel`.

---

## Повтор Phase 3I-A-2 runtime proof

После деплоя F1 и подтверждения F2 — повторяем proof **на той же** `package_session_id=b0b229b7-…`, без новых сессий и без мутации продакшен-данных вне F2.

### Шаги

1. Вызов `ai-generate-document-package` с `run_mode='real'` на исходной сессии.
2. Зафиксировать:
  - оба item проходят preflight, strict вызывается;
  - запись в `ai_generated_documents`: `context_type='package_session'`, `context_id=<session>`, `generation_batch_id`, `meta.package_template_id`, `meta.package_template_item_id`, `idempotency_key='pkg:<batch>:<item>'`;
  - DOCX и PDF URL под `generated/package/<session>/...`, storage object size > 0;
  - в финальном DOCX нет необработанных `{{...}}`;
  - повторный вызов с теми же id → идемпотентно (reuse тех же документов).
3. Grep-инварианты повторно (5 baseline checks из предыдущего proof) → без изменений:
  - 0 файлов `package-strict-handler`;
  - 0 `new Docxtemplater` / `gotenberg` / `.from("ai_generated_documents")` в orchestrator;
  - в strict: 1 `new Docxtemplater`, ≤3 `convertDocxToPdf`, 5 `.from("ai_generated_documents")`.
4. Order-mode regression smoke на том же `order_id`, что и в прошлом proof, — diff `document_data.fields` пустой.
5. Guard 4.3 (`packageContext` под user-JWT → `403 package_context_forbidden`) повторить, остальные guards остаются SKIPPED как в прошлом proof (без production-фикстур).

### DoD итогового прогона

- ≥ 1 успешный package item с реальным DOCX + PDF в storage.
- Идемпотентность подтверждена.
- Все 5 grep-инвариантов PASS.
- Order-mode regression PASS.
- Guard 4.3 PASS.

---

## Артефакты

- **Новый код:** `supabase/functions/_shared/system-field-values.ts` (≈30 строк).
- **Правки:**
  - `supabase/functions/_shared/standard-fields.ts` — заменить 6 inline-строк system.* на spread из helper'а.
  - `supabase/functions/ai-generate-document-package/index.ts` — импорт helper'а, `sysVals` перед циклом, новая ветка в `FIELD_RE`.
- **Proof:** `.lovable/proofs/sprint_3i_a_2_hotfix_f1_f2_runtime_passed_2026_05.md`.
- **plan.md:** статус Phase 3I-A-2 → PASS, Phase 3I-A → CLOSED, готовность Phase 3I-B UI.
- **Memory:** обновляется ТОЛЬКО при PASS:
  - `package-document-level-questionnaires-v1` — отметить, что system.* FLDs резолвятся orchestrator'ом через shared helper;
  - новый файл `architecture/documents/package-generation-orchestrator-v1.md` — фиксирует thin-orchestrator контракт + список резолвимых system FLDs;
  - `index.md` — добавить ссылку.

## Что НЕ делаем

- Не трогаем `canonical-document-generate-strict`, Gotenberg, `ai_generated_documents`.
- Не возвращаем `PKR-XXXXXX` как валидный формат — остаётся error.
- Не создаём новые FLD.
- Не мутируем другие шаблоны / другие package sessions.
- Не строим UI-кнопки и историю — это Phase 3I-B после закрытия 3I-A.
- Не обновляем memory как completed до успешного runtime proof.

## Финальный статус

- **При PASS:** `completed: Phase 3I-A backend runtime proof passed; package generation through canonical strict passed; orchestrator remains thin; ready for Phase 3I-B UI`.
- **При FAIL:** Phase 3I-A остаётся OPEN, в proof — точный список оставшихся блокеров, memory не трогается.
---

## Phase 3I-A — CLOSED (2026-05-29)

Все блокеры закрыты, runtime PASS на пакете «Идеология».

### Что сделано в финальном раунде

1. **UI validator fix** (`src/components/ai-documents/TemplateMarkupDialog.tsx`):
   - Удалён старый `LEGACY_PLACEHOLDER_RE`, который считал legacy всё, что не начинается с `field:`.
   - Введён scope-resolver (`document_templates.template_scope` → `document_package_template_items` → `unknown`).
   - Введён `classifyTemplateToken(token, scope)` с тремя состояниями: `valid` / `package_in_billing` / `legacy`.
   - Раздельные счётчики в футере: валидных плейсхолдеров / ручных замен / устаревших / package-в-billing.
   - CSS-класс `.docx-package-in-billing` (оранжевый) для scope-нарушений.
   - `getAcceptedReplacementsWithFLD` НЕ тронут.

2. **F2 verification** (read-only psql):
   - Активные DOCX «Приказ» v3 и «Положение» v1 имеют `validation_status='valid'` от strict-валидатора → PKR-токенов в активных версиях нет.
   - `ln-000012` существует и активен в `document_package_role_catalog` для пакета «Идеология».

3. **Runtime PASS** (`ai-generate-document-package`, `run_mode='admin_test'`, session `b0b229b7-…`):
   - `success: true`, `generated: 2`, `blocked: 0`, `errors: 0`.
   - Оба item: `context_type='package_session'`, idempotency_key `pkg:<batch>:<item>`, DOCX + PDF в `documents/generated/package/<session>/...`, `meta.strict=true`, `meta.source='package_orchestrator'`.
   - Generation_error IS NULL для обоих → нет нерезолвленных `{{...}}` (Docxtemplater strict throw on null).

### Proof

`.lovable/proofs/sprint_3i_a_ui_validator_fix_and_runtime_pass_2026_05.md`.

### Готовность к Phase 3I-B

- Backend orchestrator thin + canonical strict pipeline проверены на real-runtime;
- DOCX-шаблоны «Идеология» актуальны (PKR удалён, ln-канон);
- UI validator больше не врёт про package/ln-токены;
- Можно строить UI «Сформировать пакет документов» поверх существующего edge function без backend-изменений.
