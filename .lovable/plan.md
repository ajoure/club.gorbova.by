# Да, согласен, с учетом правок. План правильный: это именно тот hotfix, который нужен перед runtime-proof. Но нужно добавить несколько уточнений, чтобы не получить скрытую вторую логику внутри strict.

да, согласен, с учетом правок:

## **1. Package-mode не должен принимать legacy/billing runtime tokens**

В token parser уточнить:

В package-mode разрешены только:

```text
{{field:FLD-XXXXXX}}
{{field:FLD-XXXXXX|...}}
{{package.ul.FLD-XXXXXX}}
{{package.ip.FLD-XXXXXX}}
{{package.fl.FLD-XXXXXX}}
{{ln-XXXXXX}}
```

Старые/чужие форматы:

```text
{{customer.*}}
{{executor.*}}
{{deal.*}}
{{cf.*}}
{{package.role.PKR-*}}
{{package.roles.*}}
```

в package-mode должны давать error, а не проходить через старую legacy-ветку.

Иначе можно случайно протащить billing-context в пакетный документ.

---

## **2. Модификаторы для package/ln токенов**

Если parser уже поддерживает модификаторы для `{{field:FLD-...|case=...}}`, нужно либо:

### **Вариант A — поддержать сразу**

Разрешить:

```text
{{package.ul.FLD-XXXXXX|case=genitive}}
{{package.ip.FLD-XXXXXX|case=genitive}}
{{package.fl.FLD-XXXXXX|case=genitive}}
{{ln-XXXXXX|case=genitive}}
```

и применить тот же modifier pipeline, что для обычных `field:FLD`.

### **Вариант B — явно запретить пока**

Если сейчас это сложно, тогда такие токены должны давать понятную ошибку:

```text
package_token_modifier_not_supported
```

Нельзя молча игнорировать `|case=`.

Лучше выбрать Вариант A, если существующий modifier pipeline можно переиспользовать без отдельной логики.

---





## **3. Ключи**

`preresolved_fields` **нужно нормализовать**

В контракте `packageContext.preresolved_fields` ключи указаны как:

```text
FLD-XXXXXX
```

А render/resolved использует:

```text
field:FLD-XXXXXX
```

Нужно явно сделать нормализацию:

```ts
for (const [fid, entry] of Object.entries(packageContext.preresolved_fields)) {
  const normalizedKey = fid.startsWith('field:') ? fid : `field:${fid}`;
  docFields[fid] = ...
  resolved[normalizedKey] = String(entry.value ?? '');
}
```

Иначе `{{field:FLD-000209}}` может не найти значение.

---





## **4.**

`packageContext.template_id` **обязателен**

В плане упомянуто, что strict берёт `templateId = packageContext.template_id`. Нужно зафиксировать:

```text
Если packageContext есть, но packageContext.template_id отсутствует:
400 template_id_required
```

И orchestrator должен передавать `template_id` и на верхнем уровне body, и внутри `packageContext`.

---





## **5.**

`package_token_not_preresolved` **должен применяться ко всем package-токенам**

Hard error должен быть для:

```text
{{ln-XXXXXX}}
{{package.ul.FLD-XXXXXX}}
{{package.ip.FLD-XXXXXX}}
{{package.fl.FLD-XXXXXX}}
```

Если токен есть в DOCX, но его нет в соответствующем bag:

```text
package_token_not_preresolved
```

Никаких `String(undefined ?? '')`.

---





## **6. Для**

`field:FLD-*` **в package-mode тоже не должно быть silent empty**

Если в DOCX есть:

```text
{{field:FLD-XXXXXX}}
```

и это поле не системное/document и не пришло в `preresolved_fields`, strict должен вернуть ошибку до render:

```text
package_field_not_preresolved
```

Не ждать, пока оно уйдёт в пустую строку через missing/required check.

---



## **7. Pre-create row и**

`created_by`

В package-mode `created_by: null` допустим, но в audit/meta нужно явно писать:

```json
{
  "actor_type": "system",
  "source": "package_orchestrator",
  "package_session_id": "...",
  "generation_batch_id": "..."
}
```

Чтобы потом было понятно, кто создал документ.

---



## **8. Не добавлять новые**

`.from('ai_generated_documents')`

В DoD оставить строгую проверку:

```bash
rg -c "\.from\(['\"]ai_generated_documents['\"]\)" supabase/functions/canonical-document-generate-strict/index.ts
```

Количество должно быть равно hotfix-baseline.

Если количество увеличилось — blocker.

---



## **9. Проверить**

`storage.upload`

Допускается только параметризация `pathPrefix`.

Запрещено:

```text
новый uploadDocxPackage()
новый uploadPdfPackage()
новый отдельный storage.from('documents').upload(...)
```

Количество upload-блоков не должно увеличиться.

---

## **10. Orchestrator: PizZip только для чтения токенов**

В `ai-generate-document-package` PizZip допустим только для preflight/extract tokens.

Добавить grep:

```bash
rg -n "setData|render\(|generate\(" supabase/functions/ai-generate-document-package
```

Ожидание: 0.

---

## **11. Proof обязателен в этом заходе**

Создать:

```text
.lovable/proofs/sprint_3i_a_1b_package_mode_wired_2026_05.md
```

Минимально:

1. `package_mode_not_wired_in_strict` удалён.
2. Второго renderer нет.
3. Package-mode использует тот же Docxtemplater/Gotenberg/storage/ai_generated_documents path.
4. Orchestrator не содержит render/PDF/persist.
5. Количество `ai_generated_documents` write-points не увеличилось.
6. Количество storage upload-блоков не увеличилось.
7. Build/typecheck зелёный.

Runtime generation пока не делать — это Phase 3I-A-2.

---

## **12. Финальный статус этого захода**

После выполнения статус должен быть:

```text
completed: package-mode wired into canonical strict pipeline;
no second renderer;
no second Gotenberg path;
no second ai_generated_documents write path;
ready for Phase 3I-A-2 runtime proof
```

Не закрывать весь Sprint 3I-A до baseline/regression/runtime proof.

&nbsp;

План: Phase 3I-A-1.B — wiring package-mode в canonical strict pipeline

## Цель

Убрать временный short-circuit `501 package_mode_not_wired_in_strict` и пропустить package-mode через **те же** Docxtemplater / Gotenberg / storage.upload / `ai_generated_documents` блоки, что и order-mode. Никакого второго renderer, никакого второго insert.

## Текущее состояние

- Body парсится один раз, `generationContext: 'order' | 'package_session'` уже введён (line 316).
- Service-role guard для `packageContext` уже есть (lines 340–353).
- Order-only preflight/snapshot/B97 обёрнуты `if (generationContext === 'order')` (line 404+).
- Package-mode сейчас возвращает `501` на lines 547–554 — это блок, который надо удалить.
- Шаги ниже (load template/version, numbering, resolve, Docxtemplater render, Gotenberg, storage upload, persist в `ai_generated_documents`) выполняются для обоих контекстов, **но** жёстко привязаны к `order` (idempotency key, pre-create `context_type='order'`, storage prefix `generated/{order.id}`, persist `context_type='order'`, audit `order_id`).
- Package-mode stub `order` уже подготовлен на lines 663–678 (id = `package_session_id`, profile_id из ctx).
- В `resolved` ключи — это `t.raw_inside` (например `field:FLD-000069`). Custom parser Docxtemplater (line 1043) читает весь inside как имя переменной — значит для `package.ul.FLD-XXX` и `ln-XXX` ключ тоже совпадёт с `inside`.

## Изменения (только в `canonical-document-generate-strict/index.ts` и минимально в orchestrator)

### 1. Удалить `501`-gate (lines 540–554)

Полностью убрать early-return; пайплайн просто пойдёт дальше.

### 2. Token parser (lines ~703–717)

В цикле по `ANY_TOKEN_RE` добавить ветки **до** legacy-check:

- `^package\.(ul|ip|fl)\.FLD-\d+$` → если `generationContext==='package_session'`: записать в отдельный set `packageTokens`, добавить `raw_inside` в `parsedPackageRawInside`. Иначе → push в новый массив `packageTokensOutsideContext` → hard error `package_token_outside_package_context`.
- `^ln-\d+$` → аналогично; в order-mode → `ln_token_outside_package_context`.
- Существующая ветка `(document|executor|customer|deal|cf)\.` — оставить как есть.
- Существующий `parseStrictTokenInside` — без изменений (он покрывает `field:FLD-XXX|...`).

### 3. Numbering / pre-create row (lines 770–846)

Параметризовать:

- `idempotencyKey`:
  - order-mode: оставить `strict:${tpl.id}:${ver.id}:${order.id}` (или `body.idempotency_key`).
  - package-mode: `pkg:${packageContext.generation_batch_id}:${packageContext.package_template_item_id}`.
- `pre-create` insert (line 794): в package-mode заменить
  - `context_type: 'package_session'`
  - `context_id: packageContext.package_session_id`
  - добавить в `meta`: `{ strict: true, c5g_pre_created: true, package_template_id, package_item_id, generation_batch_id }`
  - `created_by: null` (system actor — `userId` в package-mode = null)
  - `title`: использовать `packageContext.title_override` или `tpl.name`.
- `allocate_document_number` RPC — **без изменений**: она работает по `document_id`. FLD-000069/000070 заполняются в общий `docFields` как раньше.

### 4. Resolve values (lines 848–933)

После основного цикла `for (const t of parsedTokens)` (строки 879–933) добавить **в package-mode** ещё один проход по новым токенам:

```ts
if (generationContext === 'package_session') {
  for (const rawInside of packageTokensOrLn) {
    const bag = rawInside.startsWith('ln-')
      ? packageContext.preresolved_ln_tokens
      : packageContext.preresolved_package_fields;
    if (!Object.prototype.hasOwnProperty.call(bag, rawInside)) {
      return json({ error: 'package_token_not_preresolved', token: `{{${rawInside}}}` }, 400);
    }
    resolved[rawInside] = String(bag[rawInside]?.value ?? '');
    sourceTrace[rawInside] = { status: 'resolved', source: bag[rawInside]?.source ?? 'package_preresolved', value: resolved[rawInside] };
  }
}
```

Hard-error без silent empty. Для существующих `field:FLD-XXX` в package-mode:

- В `docFields` (line 678 = `{}`) предзаполнить из `packageContext.preresolved_fields` **до** numbering-блока:
  ```ts
  } else {
    order = { ... };  // как сейчас
    docFields = {};
    for (const [fid, entry] of Object.entries(packageContext.preresolved_fields)) {
      docFields[fid] = { value: entry.value, source: entry.source, updated_at: new Date().toISOString() };
    }
  }
  ```
- FLD-000069 / FLD-000070 затем перезапишутся allocate-блоком (как и в order-mode).
- Если `field:FLD-XXX` найден в DOCX, но FLD отсутствует и в `preresolved_fields`, и в numbering → попадёт в `missing` → если `required` → `required_fields_empty` (это и есть «no silent empty»).

### 5. Storage prefix (lines 1141–1142)

```ts
const pathPrefix = generationContext === 'package_session'
  ? `generated/package/${packageContext.package_session_id}`
  : `generated/${order.id}`;
const docxPath = `${pathPrefix}/${ts}-${tpl.id.slice(0, 8)}.docx`;
const pdfPath  = `${pathPrefix}/${ts}-${tpl.id.slice(0, 8)}.pdf`;
```

Один и тот же `storage.from('documents').upload(...)` блок — не дублировать.

### 6. Persist в `ai_generated_documents` (lines 1207–1270)

В `docCommon` параметризовать:

- `context_type`: `'package_session'` vs `'order'`.
- `context_id`: `package_session_id` vs `order.id`.
- В package-mode добавить в `meta`: `package_template_id`, `package_item_id`, `generation_batch_id`.
- `title` в package-mode: `packageContext.title_override ||` ${tpl.name}`` (без `order.order_number`).
- `created_by`: `userId` (в package-mode = null — допустимо для system actor).

Количество `.from('ai_generated_documents')` вхождений **не увеличивается** (остаются те же 4: pre-create select, pre-create insert, final update, final insert).

### 7. Audit log (line 1277)

Параметризовать `meta`: в package-mode `package_session_id/package_template_id/package_item_id/generation_batch_id` вместо `order_id`. Action остаётся `document.generated`. Аналогично для `document.pdf_converted` / `document.pdf_failed` (lines 1122/1131) — заменить `order_id` на context-aware поле.

### 8. Orchestrator (`ai-generate-document-package/index.ts`)

Проверить, что в body передаётся `template_id` на верхнем уровне (strict ожидает его через `body?.template_id` → перетирается в package-mode `templateId = packageContext.template_id`, так что это не критично, но для совместимости — продублировать). Per-item обработка ответа: больше нет `501`, ловить только `success: true` / `error: ...`. Никаких новых render/PDF/persist путей не добавлять.

### 9. Hook

`useAiDocumentPackageGeneration.ts` — без изменений (контракт уже `{ package_session_id, run_mode? }`).

## Grep-инварианты (после изменений)

```bash
rg -n "package-strict-handler" supabase/functions                       # 0
rg -n "package_mode_not_wired_in_strict" supabase/functions             # 0
rg -n "Docxtemplater|new Docxtemplater" supabase/functions/ai-generate-document-package   # 0
rg -n "gotenberg|convertDocxToPdf" supabase/functions/ai-generate-document-package        # 0
rg -n "from\(['\"]ai_generated_documents['\"]\)" supabase/functions/ai-generate-document-package   # 0
rg -c "new Docxtemplater" supabase/functions/canonical-document-generate-strict/index.ts  # 1
rg -c "convertDocxToPdf" supabase/functions/canonical-document-generate-strict/index.ts   # 2
rg -c "\.from\(['\"]ai_generated_documents['\"]\)" supabase/functions/canonical-document-generate-strict/index.ts  # = hotfix baseline (4)
rg -c "storage.from\(['\"]documents['\"]\)\.upload" supabase/functions/canonical-document-generate-strict/index.ts # 2 (docx+pdf, без увеличения)
```

## Build / typecheck

Прогнать существующий проектный build/typecheck. Ошибки типов не оставлять (особенно по `packageContext!` в новой ветке pre-create и по `userId` = null в `created_by`).

## Proof

Создать `.lovable/proofs/sprint_3i_a_1b_package_mode_wired_2026_05.md`:

1. `501 package_mode_not_wired_in_strict` удалён (diff hunk).
2. Package-mode проходит через тот же render/PDF/persist (line-mapping).
3. Второго renderer/upload/insert нет (grep-инварианты).
4. Orchestrator всё ещё thin.
5. Build зелёный.
6. Order-path: статический diff не задевает order-only логику; runtime regression отложен на Phase 3I-A-2.

## Что НЕ делать в этом заходе

- Никакой runtime генерации (ни order, ни package).
- Никакого UI (пользовательская кнопка, admin test, история пакетов).
- Никаких обновлений memory как completed.
- Sprint 3I-A не закрывается.

## DoD Phase 3I-A-1.B


| #   | Критерий                                                                             | Проверка             |
| --- | ------------------------------------------------------------------------------------ | -------------------- |
| 1   | `501 package_mode_not_wired_in_strict` удалён                                        | `rg`                 |
| 2   | Package-mode использует единственный Docxtemplater/Gotenberg/upload/persist          | line-mapping в proof |
| 3   | Token parser принимает `package.(ul|ip|fl).FLD-XXX` и `ln-XXX` только в package-mode | code review          |
| 4   | Order-mode hard-error на `package.*` / `ln-*` (no leakage)                           | code review          |
| 5   | Hard-error `package_token_not_preresolved` (no silent empty)                         | code review          |
| 6   | Idempotency `pkg:${batch}:${item}`                                                   | code review          |
| 7   | Storage prefix `generated/package/{session_id}/...`                                  | code review          |
| 8   | `ai_generated_documents` insert/update — те же 4 точки                               | `rg -c`              |
| 9   | Orchestrator не содержит render/PDF/persist                                          | `rg`                 |
| 10  | Build зелёный                                                                        | typecheck            |
| 11  | Proof файл создан                                                                    | exists               |


После выполнения — следующий шаг **Phase 3I-A-2**: baseline order generation → runtime package proof → snapshot regression → memory/closeout.