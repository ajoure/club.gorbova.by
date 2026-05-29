# да, согласен, с учетом правок:

## 1. Не писать «order-path байт-в-байт сохранён», если файл всё равно меняется

Фраза рискованная. Правильнее:

text Order-path должен быть функционально идентичен: те же входы, guards, resolver_version, snapshot, idempotency, context_type='order', DOCX/PDF output. 

Потому что обёртка if (generationContext === 'order') технически всё равно меняет файл.

В proof потом сравнивать не “байты”, а поведение и ключевые snapshot-поля.

---

## 2. Запретить новый package-render helper внутри strict

Даже после удаления package-strict-handler.ts Lovable может создать новый helper типа:

text renderPackageDocument() convertPackageToPdf() insertPackageGeneratedDocument() 

Добавить жёстко:

text Запрещено создавать отдельные функции/ветки, которые дублируют render/PDF/storage/ai_generated_documents для package-mode. 

Разрешено только:

text preparePackageValues() buildGenerationContext() 

То есть package-mode готовит значения, а не генерирует документ отдельно.

---

## 3. packageContext должен передавать template_id

В плане в одном месте написано templateId = packageContext.template_id, но в контракте packageContext его нет.

Добавить в контракт:

ts packageContext?: {   template_id: string;   package_session_id: string;   package_template_id: string;   package_template_item_id: string;   generation_batch_id: string;   profile_id: string;   preresolved_fields: Record<string, { value: string; source: string }>;   preresolved_package_fields: Record<string, { value: string; source: string; catalog_tech_key: string }>;   preresolved_ln_tokens: Record<string, { value: string; role_catalog_id: string; person_id: string }>; } 

Без template_id package-mode не должен стартовать:

text 400 template_id_required 

---

## 4. Service-role guard должен быть строгим

Проверка только x-internal-call недостаточна.

Нужно требовать одновременно:

text x-internal-call: package-orchestrator Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY> apikey: <SUPABASE_SERVICE_ROLE_KEY> 

Если packageContext есть, но нет хотя бы одного условия:

text 403 package_context_forbidden 

---

## 5. Нельзя использовать packageContext.profile_id без сверки orchestrator-а

В Phase 3I-A-1 strict получает profile_id из packageContext. Это допустимо только если orchestrator до вызова уже проверил ownership.

Добавить в ai-generate-document-package обязательный check:

text session.profile_id === auth.uid() OR has_role_v2(auth.uid(), 'admin'/'super_admin') 

В strict proof зафиксировать: strict доверяет profile_id только service-role orchestrator-у.

---

## 6. package_token_not_preresolved должен быть hard error

В package-mode запрещены пустые строки.

Добавить явно:

text Если в DOCX найден {{ln-XXXXXX}}, {{package.ul/ip/fl.FLD-XXXXXX}} или {{field:FLD-XXXXXX}}, но ключ отсутствует в соответствующем preresolved bag — strict возвращает 400 package_token_not_preresolved. 

Не warning, не empty string.

---

## 7. Для {{field:FLD-...}} в package-mode уточнить источник

В package-mode {{field:FLD-...}} должен быть разрешён только для системных/документных полей, которые orchestrator заранее положил в preresolved_fields.

То есть strict не должен сам пытаться брать billing/order поля.

Добавить:

text В package-mode strict не читает orders_v2.meta.document_data.fields вообще. Все field:FLD значения приходят только из packageContext.preresolved_fields. 

---

## 8. Prefix storage допустим менять только параметром

План допускает prefix:

text generated/{order_id}/… generated/package/{package_session_id}/… 

Ок, но добавить:

text Разрешена только параметризация path-prefix перед существующим upload. Нельзя создавать второй upload-блок. 

---

## 9. ai_generated_documents insert/update — только один участок

В strict нельзя добавить второй insert/update для package-mode.

Добавить grep-инвариант:

bash rg -n "from\\(['\"]ai_generated_documents['\"]\\)" supabase/functions/canonical-document-generate-strict/index.ts 

Ожидание:

text количество вхождений не увеличилось относительно состояния до hotfix 

---

## 10. PizZip в orchestrator допустим только для preflight

В плане это есть, но нужно сделать формально:

text PizZip в ai-generate-document-package разрешён только в функции extractTokensFromDocx/preflight. Запрещено использовать PizZip для setData/render/generate. 

Grep proof должен проверять отсутствие:

bash rg -n "setData|render\\(|generate\\(" supabase/functions/ai-generate-document-package 

---

## 11. Не откладывать все proof-файлы

В плане написано: “никаких proof-файлов в этом заходе”.

Но хотя бы один короткий proof по hotfix нужен, иначе потом сложно доказать, что второй генератор удалён.

Добавить минимальный artifact:

text .lovable/proofs/sprint_3i_a_1_hotfix_no_second_renderer_2026_[05.md](http://05.md) 

Содержимое:

- удалён package-strict-handler.ts;

- grep package-strict-handler = 0;

- grep direct Gotenberg in orchestrator = 0;

- grep direct ai_generated_documents insert in orchestrator = 0;

- grep Docxtemplater render in orchestrator = 0;

- canonical-document-generate-strict содержит только один render/PDF/persist path.

Runtime baseline/regression оставить на Phase 3I-A-2.

---

## 12. Phase 3I-A-1 DoD уточнить

DoD должен быть:

text 1. package-strict-handler удалён. 2. canonical-document-generate-strict не импортирует package handler. 3. package-mode внутри strict только готовит/использует values, но не имеет второго render/PDF/persist блока. 4. ai-generate-document-package не содержит render/PDF/persist. 5. useAiDocumentPackageGeneration приведён к контракту { package_session_id, run_mode? }. 6. build зелёный. 7. hotfix proof с grep-инвариантами создан. 

---

## 13. Следующий шаг после hotfix

После Phase 3I-A-1 сразу Phase 3I-A-2:

text baseline order generation regression order generation runtime package generation missing assignment scenario package field not ready scenario service-role guard scenario 

Только после этого закрывать backend foundation.

&nbsp;

План: Phase 3I-A-1 — Hotfix архитектурного нарушения Sprint 3I-A

## Контекст и проблема

В предыдущем заходе был создан `supabase/functions/_shared/package-strict-handler.ts` (541 строка), который фактически является **вторым strict-генератором**: содержит собственный `Docxtemplater` render, собственный вызов `convertDocxToPdf` (Gotenberg), собственный upload в storage и собственные `INSERT/UPDATE` в `ai_generated_documents`. Это нарушает базовое правило Sprint 3I-A — единственный render/PDF/persist путь обязан быть в `canonical-document-generate-strict`.

В `canonical-document-generate-strict/index.ts` (строки 308–322) сделан early-return в этот handler — это и нужно убрать. Order-path и его существующие шаги (Docxtemplater на стр. 951, Gotenberg на стр. 1029, insert/update `ai_generated_documents` на стр. 1171/1178, `allocate_document_number` на стр. 735) остаются нетронутыми и становятся **единственным** render/PDF/persist путём для обоих контекстов.

`ai-generate-document-package` в целом написан корректно как thin orchestrator (preflight + invoke strict + aggregate), его трогаем минимально.

## Цель захода

Перевести package-mode на переиспользование существующего render/PDF/storage/persist кода в `canonical-document-generate-strict`, удалив параллельный handler. Никакого runtime proof и closeout до выполнения этого хотфикса.

## Объём (только то, что меняется)

### 1) Удалить параллельный генератор

- Удалить файл `supabase/functions/_shared/package-strict-handler.ts` целиком.
- В `canonical-document-generate-strict/index.ts` удалить блок early-dispatch (≈ строки 308–322), включая dynamic `import('../_shared/package-strict-handler.ts')`.

### 2) Внедрить package-ветку внутри основного pipeline `canonical-document-generate-strict`

Главный принцип: **никаких новых вызовов Docxtemplater / Gotenberg / storage.upload / ai_generated_documents.insert** — переиспользуем те, что уже есть в файле. Добавляем только early branching по подготовке `tpl/ver/values/profile_id/context_*` и точечные guard'ы вокруг order-only шагов.

Изменения в `canonical-document-generate-strict/index.ts`:

1. **Header guard для service-role calls.** До любой работы: если `req.headers.get('x-internal-call') === 'package-orchestrator'`, проверить, что `apikey`/`Authorization` соответствуют `SUPABASE_SERVICE_ROLE_KEY`. Если нет — `403 package_context_forbidden`. Если header отсутствует, но в body есть `packageContext` — тоже `403 package_context_forbidden`.
2. **Введём `generationContext: 'order' | 'package_session'`.** Определяется по наличию `body.packageContext`. Order-path сохраняет точное поведение.
3. **Подготовительный блок (template/version/profile).** Вынести существующий код «загрузить tpl + ver + profile_id из orders_v2» в небольшой helper или просто обернуть в `if (generationContext === 'order') { …существующий код… } else { …package-ветка… }`. В package-ветке:
  - `templateId = packageContext.template_id` (обязателен; иначе `400 template_id_required`).
  - `profile_id = packageContext.profile_id`.
  - Полностью пропустить: загрузку `orders_v2`, payment-guard, `snapshotOrderDocumentData`/rebuild, `derivePaymentChannel`, B-97 fallback, `resolveDocumentScenario`, `buildTypedB97FieldValues`.
  - `context_type = 'package_session'`, `context_id = packageContext.package_session_id`. Дополнительно при insert/update пробросить `package_template_id`, `package_item_id`, `generation_batch_id` (см. шаг 6).
4. **Token parser/validator: расширить матрицу только в package-mode.** Существующий парсер принимает `{{field:FLD-XXXXXX}}` (+ модификаторы `format/case`). В package-mode дополнительно разрешить:
  - `{{field:FLD-XXXXXX}}` (как в order-mode, но значения берутся из `packageContext.preresolved_fields`),
  - `{{package.(ul|ip|fl).FLD-XXXXXX}}` → значение из `packageContext.preresolved_package_fields`,
  - `{{ln-XXXXXX}}` → значение из `packageContext.preresolved_ln_tokens`.
   Любой другой токен в package-mode → `400 invalid_token_in_package_template`. Любой allowed-токен с отсутствующим ключом в соответствующем bag → `400 package_token_not_preresolved` (никаких silent empty strings).
5. **Numbering (FLD-000069 / FLD-000070).** Идемпотентность — `idempotency_key = pkg:${packageContext.generation_batch_id}:${packageContext.package_template_item_id}`. Используем **существующий** код pre-create row + `allocate_document_number` (≈ стр. 696–735) — параметризуем `context_type/context_id/idempotency_key/profile_id/template_id` и пакетные ID. Никакого нового кода нумерации.
6. **Render / PDF / Storage / Persist.** Полностью переиспользуем существующий код:
  - `Docxtemplater` блок (стр. 951–) — один и тот же. Источник значений — единый объект `resolved` (для order — как сейчас, для package — собранный из preresolved bags + system numbering).
  - `convertDocxToPdf` (стр. 1029) — тот же вызов, та же конфигурация Gotenberg, тот же error path и audit `document.pdf_converted` / `document.pdf_failed`.
  - Storage upload — тот же. Допустимо параметризовать prefix (`generated/{order_id}/…` vs `generated/package/{package_session_id}/…`) ровно одной строкой над существующим `.upload(...)` — без дублирования логики.
  - `ai_generated_documents` insert/update (стр. 1171/1178) — те же запросы. В package-mode добавить `package_template_id`, `package_item_id`, `generation_batch_id`, `context_type='package_session'`. Никаких новых `from('ai_generated_documents')`.
7. **Audit.** Использовать существующие audit-инсёрты `document.generated`, `document.pdf_converted`, `document.pdf_failed`, расширив `meta` пакетными ID. Новых audit-actions не добавляем.

### 3) `ai-generate-document-package` — минимальная правка

- Убрать любой намёк на render: убедиться, что в файле нет `Docxtemplater`, нет `convertDocxToPdf`/`gotenberg`, нет `.from('ai_generated_documents')`. (`PizZip` остаётся **только** для preflight token extraction.)
- Оставить контракт invoke strict как есть: `POST` с `x-internal-call: package-orchestrator`, `apikey/Authorization = SERVICE_ROLE_KEY`, body `{ mode:'generate', packageContext: {…} }`.
- Агрегация per-item результатов и обновление `ai_document_generation_batches` — как сейчас.

### 4) Frontend hook

- `src/hooks/useAiDocumentPackageGeneration.ts`: привести параметры мутации к `{ package_session_id, run_mode? }` (сейчас передаёт `package_template_id`, `legal_details_id` и т. п., что не совпадает с новым контрактом orchestrator). Никаких UI-кнопок в этой фазе не добавляем — только починка типов.

### 5) Документация / план

- Обновить `.lovable/plan.md`: Phase 3I-A-1 (hotfix) — описать удаление package-strict-handler и переиспользование единого pipeline.
- Никаких memory-апдейтов, никаких proof-файлов в этом заходе — они появятся только после успешного runtime proof в следующем заходе (Phase 3I-A-2).

## Жёсткие grep-инварианты (после хотфикса)

```
rg -n "Docxtemplater|PizZip" supabase/functions/_shared/package-strict-handler.ts
# → файл должен отсутствовать

rg -n "Docxtemplater|new Docxtemplater" supabase/functions/ai-generate-document-package
# → 0

rg -n "gotenberg|convertDocxToPdf" supabase/functions/ai-generate-document-package
# → 0

rg -n "from\(['\"]ai_generated_documents['\"]\\)|ai_generated_documents.*insert" \
  supabase/functions/ai-generate-document-package
# → 0

rg -n "package-strict-handler" supabase/functions
# → 0 (импорт из strict удалён вместе с файлом)

rg -n "Docxtemplater|convertDocxToPdf|from\(['\"]ai_generated_documents['\"]\\)" \
  supabase/functions/canonical-document-generate-strict/index.ts
# → ровно те же вхождения, что и до Sprint 3I-A (никаких новых)
```

## Что НЕ делаем в этом заходе

- Не запускаем runtime package generation.
- Не делаем baseline/regression order-генерации (это уже Phase 3I-A-2, после хотфикса).
- Не добавляем UI-кнопки пользователя/админа (Phase 3I-B).
- Не правим memory index, не пишем proof-файлы.
- Не меняем order-path: ни одна строка существующего order-flow не редактируется (только оборачивается в `if (generationContext === 'order')`).

## DoD Phase 3I-A-1

- Файл `_shared/package-strict-handler.ts` отсутствует.
- В `canonical-document-generate-strict/index.ts` нет dynamic import package-handler'а; package-ветка реализована на тех же `Docxtemplater` / `convertDocxToPdf` / `storage.upload` / `ai_generated_documents` вызовах, что и order-ветка.
- Все grep-инварианты выше выполняются.
- `ai-generate-document-package` остаётся thin orchestrator; build зелёный; типы hook'а совпадают с новым контрактом.
- Order-path байт-в-байт сохранён (visual diff ограничен только обёрткой `if (generationContext === 'order')` и параметризацией prefix/idempotency_key/context_type).

Следующий шаг после approve и реализации хотфикса — Phase 3I-A-2: baseline order-генерации → runtime package proof → memory/closeout.