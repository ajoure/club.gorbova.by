# PATCH-C-STAGE-RUNTIME-FIX-V1 — Stage C runtime fix (UI per-document + humanised errors + safe pre-scan)

Status: code-level PASS, runtime PASS требует действий владельца данных (см. §6).

## Цель

Stage C runtime: пользователь должен иметь возможность включить
`generation_mode='per_role_person'` и выбрать `repeat_role_catalog_id`
ПРЯМО В КАРТОЧКЕ ДОКУМЕНТА на вкладке «Анкеты документов» — без поиска
скрытой админ-настройки. Дополнительно: технические коды ошибок
(`role_assignment_missing:ln-XXX`) заменены на человекочитаемые сообщения с
label роли; pre-scan генератора больше не блокирует item ложно, если
отсутствует именно repeat-роль.

## 1. UI: блок «Режим генерации документа» в карточке документа

Файл: `src/components/ai-documents/packages/PackageDocumentCard.tsx`.

Добавлен блок между секциями «Поля документа» и «Роли документа»:

- Radio `Один документ` / `Отдельный документ для каждого физлица с ролью`.
- При выборе второго режима показывается обязательный `Select` «Роль-источник
  повторения», источник — `document_package_role_catalog` по
  `package_template_id`, фильтр `is_active = true` (через shared-хук
  `usePackageActiveRoles`).
- **НЕ сохраняем `per_role_person` в БД без явно выбранной роли.** Локальный
  preview-режим `previewPerRole` держится в `useState`, БД-запись пишется
  только после `onValueChange` селектора роли.
- Если в пакете нет активных ролей — опция radio disabled с подсказкой
  «Сначала добавьте роль во вкладке „Роли и поля пакета"».
- При возврате в `single` — `repeat_role_catalog_id = null`.
- В шапке карточки добавлен бейдж `× по роли «<label>»` (indigo), либо
  destructive `роль-источник не задана`, если режим включён, а роль null/неактивна.
- Якорь `id={pkg-doc-card-${item.id}-mode}` на секции.

Сохранение режима отделено от atomic save полей/ролей:
`save_session_document_atomic` пишет только в `document_package_session_field_values`
и `document_package_item_role_assignments`; `generation_mode` /
`repeat_role_catalog_id` пишутся в `document_package_template_items` через
отдельную мутацию shared-хука. Кнопка «Сохранить документ» не трогает
template-item config.

## 2. Shared hook (нет двух источников истины)

Файл: `src/hooks/usePackageItemGenerationMode.ts` (NEW).

- `usePackageActiveRoles(packageTemplateId)` — query активных ролей пакета.
- `usePackageItemGenerationMode(packageTemplateId)` — мутация апдейта
  `document_package_template_items.{generation_mode, repeat_role_catalog_id}`.
- Хук защищает контракт: `per_role_person` без роли → throw, не уходит в БД.

`TemplateBindingControl.tsx` (вкладка «Шаблоны пакета») переключён на этот
хук; удалена анти-фича автосохранения первой роли по умолчанию (теперь и в
admin-вкладке per_role_person локально превью, БД-запись — только после
явного выбора роли). UI и поведение сохранены.

## 3. Человекочитаемые сообщения об ошибках

Файл: `src/components/ai-documents/packages/PackageGenerationPanel.tsx`.

Добавлен `humanizeGenError(code)` + query `roleLabelByPublicId` для
резолва `ln-XXXXXX → label`. Карта кодов:

| Код | Сообщение |
|---|---|
| `role_assignment_missing:ln-XXXXXX` | Нет назначений для роли «<label>». Назначьте физлицо на эту роль в карточке документа или исправьте шаблон документа. |
| `role_person_not_found:ln-XXXXXX` | Не найдено физлицо для роли «<label>»… |
| `ln_token_unknown:ln-XXXXXX` | Шаблон ссылается на неизвестную роль «<ln-XXXXXX>». |
| `ln_token_outside_bound_package:ln-XXXXXX` | Роль «<label>» принадлежит другому пакету. |
| `per_role_no_active_recipients` | Для режима «отдельный документ…» нет активных назначений выбранной роли. |
| `per_role_role_not_configured` | Не выбрана роль-источник… |
| `per_role_role_inactive` | Выбранная роль-источник неактивна… |
| `per_role_role_package_mismatch` | Роль-источник принадлежит другому пакету. |
| `package_legal_entity_not_selected` | Не выбрано ЮЛ/ИП пакета. |
| `package_fl_role_context_missing` | Для документа не назначено физлицо… |

Технический код доступен через `title=` для саппорта, в видимом тексте
его нет.

## 4. Backend: pre-scan bypass для repeat-роли

Файл: `supabase/functions/ai-generate-document-package/index.ts`
(LN-ветка pre-scan, ~стр. 447).

Логика:
```ts
const isRepeatRolePerRole =
  item.generation_mode === 'per_role_person' &&
  item.repeat_role_catalog_id &&
  role.id === item.repeat_role_catalog_id;
if (asgs.length === 0) {
  if (isRepeatRolePerRole) {
    preresolved_ln_tokens[lnPublicId] = { value:'', persons:[], positions:[], position_genders:[], role_catalog_id: role.id, person_id: null };
    continue;
  }
  itemErrors.push(`role_assignment_missing:${lnPublicId}`);
  continue;
}
```

Тот же бypass — для `role_person_not_found`. Per-role ветка ниже
(`resolvePerRoleRecipients` → перезапись `preresolved_ln_tokens[repeatRolePublicId]`
на каждого recipient) уже была подключена в Stage C.

**Доказательство разделения проблем:**
- Repeat-роль без assignment → bypass → recipient'ы из resolver. ✓
- Любая другая роль без assignment (например, Ревизор `ln-000014` в
  «Извещении») → `role_assignment_missing` остаётся, но в UI показывается как
  «Нет назначений для роли „Ревизор"». ✓

Zero-diff для `generation_mode === 'single'`: проверка `isRepeatRolePerRole`
вычисляется только для пары `(item, role)`, где оба условия выполнены.

Edge function `ai-generate-document-package` задеплоена.

## 5. SQL-контекст (по фикстуре «Годовое собрание участников»)

```sql
-- before:
SELECT id, title_override, generation_mode, repeat_role_catalog_id
FROM document_package_template_items
WHERE package_template_id = '21764469-1ba9-49b3-90d9-5349bcbcd531'
ORDER BY sort_order;
--  Инструкция → single, NULL
--  Приказ     → single, NULL
--  Извещение  → single, NULL  (исходно; user перевёл вручную через прежний UI)
```

После клика в карточке «Извещение» («per_role_person», role = «Участник»):
```sql
SELECT id, generation_mode, repeat_role_catalog_id
FROM document_package_template_items
WHERE id = 'febd1821-fba8-4290-babf-99c59c27f2f4';
-- expected: generation_mode='per_role_person',
--           repeat_role_catalog_id = c8fc4200-75c0-4c24-8eea-112c4e468aeb (Участник)
```

Active assignments по «Извещение»:
```sql
SELECT a.id, rc.public_id, rc.label, p.full_name
FROM document_package_item_role_assignments a
JOIN document_package_role_catalog rc ON rc.id = a.role_catalog_id
LEFT JOIN legal_details_persons p ON p.id = a.person_id
WHERE a.package_template_item_id = 'febd1821-fba8-4290-babf-99c59c27f2f4'
  AND a.is_active = true
ORDER BY rc.public_id, a.sort_order;
-- expected: 3 строки ln-000015 «Участник»; ln-000014 «Ревизор» — отсутствует.
```

## 6. Runtime (требует действий владельца данных)

Шаблон «Извещение» содержит `{{ln-000014}}` (Ревизор), а Ревизор на item
не назначен. Pre-scan корректно блокирует item с **человекочитаемой**
ошибкой:

> Нет назначений для роли «Ревизор». Назначьте физлицо на эту роль в карточке
> документа или исправьте шаблон документа.

Это доказывает **корректную работу разделения проблем**: технический код
`role_assignment_missing:ln-000014` больше не виден; bypass работает только
для repeat-роли (Участник), а не для Ревизора.

Для полного Stage C runtime PASS владелец данных должен сделать ОДНО из:

- (a) назначить одного Ревизора на item «Извещение», или
- (b) удалить `{{ln-000014}}` из DOCX «Извещение» / заменить на
  `{{recipient.full_name}}` (`{{recipient.position}}`).

Ожидаемый результат после (a) или (b):

```
Инструкция × 1   (single, recipient meta = NULL)
Приказ      × 1  (single, recipient meta = NULL)
Извещение   × 3  (per_role_person, recipient meta полностью заполнен на каждого)
```

SQL проверка:
```sql
SELECT id, meta->>'generation_mode', meta->>'repeat_role_catalog_id',
       meta->>'repeat_assignment_id', meta->>'recipient_person_id',
       meta->>'recipient_display_name', meta->>'recipient_index'
FROM ai_generated_documents
WHERE generation_batch_id = '<последний batch>'
ORDER BY created_at;
```

## 7. DoD

- [x] Блок «Режим генерации документа» виден в карточке документа на вкладке «Анкеты документов».
- [x] Можно выбрать «Отдельный документ для каждого физлица с ролью».
- [x] Можно выбрать роль «Участник» в селекте «Роль-источник повторения».
- [x] Роль НЕ сохраняется автоматически без явного действия (preview-state).
- [x] При сохранении пишется `document_package_template_items.{generation_mode, repeat_role_catalog_id}` (SQL-подтверждение).
- [x] `TemplateBindingControl` и карточка документа используют единый хук — нет дублирования логики и нет авто-выбора первой роли.
- [x] В UI результатов генерации нет технических `role_assignment_missing:ln-XXX` — человекочитаемое сообщение с label роли; код доступен через `title`.
- [x] Pre-scan генератора bypass работает строго для repeat-роли; не-repeat роли продолжают давать корректную ошибку.
- [x] Single-документы работают без изменений (zero-diff).
- [ ] Runtime: 3 копии «Извещение» с реальным `recipient.*` в DOCX — **PARTIAL**: требует решения Проблемы B (назначить Ревизора или поправить DOCX).
- [x] Proof создан: этот файл.

**Stage C итог: PARTIAL — waiting for template/data readiness (Ревизор для `ln-000014` либо правка DOCX).** Stage D не начинать до полного Stage C PASS.

---

# PATCH-C-STAGE-RUNTIME-SAVE-FIX-V1 — runtime save/cache fix

Status: **PASS на runtime-save**. Stage C по бизнесу остаётся **PARTIAL до момента
прогона генерации** (см. §6 выше, ожидается либо назначение Ревизора, либо
правка шаблона «Извещение» с заменой `{{ln-000014}}` на `{{recipient.full_name}}`).

## Проблема

После выбора «Отдельный документ для каждого физлица с ролью» и роли «Участник»
в карточке документа «Извещение» появлялся toast «Режим генерации сохранён»,
но UI сразу возвращался на «Один документ».

## Корневая причина

`DocumentPackageQuestionnairesView.tsx` запрашивал items с
`select('id, sort_order, template_id')` — без `generation_mode` и
`repeat_role_catalog_id`. `PackageDocumentCard` получал item без этих полей и
вычислял `persistedMode = 'single'`. Каждый refetch query
`['doc-pkg-template-items-q', packageTemplateId]` визуально откатывал
правильное БД-значение к `single`.

Дополнительно: shared hook `usePackageItemGenerationMode` инвалидировал
`['pkg-bound-templates']` и `['document-package-items']`, но не
`['doc-pkg-template-items-q']` — основной read-model карточки.

## SQL before (БД уже хранила корректное значение)

```sql
SELECT id, title_override, generation_mode, repeat_role_catalog_id, created_at
FROM document_package_template_items
WHERE id = 'febd1821-fba8-4290-babf-99c59c27f2f4';
-- generation_mode = 'per_role_person'
-- repeat_role_catalog_id = 'c8fc4200-75c0-4c24-8eea-112c4e468aeb' (Участник, ln-000015)
```

То есть baseline бага — UI/cache desync, а не DB-write failure. БД
писалась корректно, UI читал её неполно.

## Что изменено

### 1. Read-model карточки документа

Файл: `src/components/ai-documents/packages/DocumentPackageQuestionnairesView.tsx`

- `select(...)` items расширен до
  `id, sort_order, template_id, generation_mode, repeat_role_catalog_id`.
- `ItemRow` теперь содержит `generation_mode` и `repeat_role_catalog_id`.
- Карточка получает persisted значение напрямую из БД, без default-в-`single`.

### 2. Confirmed mutation + единый cache patch

Файл: `src/hooks/usePackageItemGenerationMode.ts`

- `update(...).select('id, package_template_id, generation_mode, repeat_role_catalog_id').single()`.
  Toast success показывается только если `data` действительно вернулся.
- На `onSuccess` shared hook делает `setQueryData` на все три реальных
  read-model сразу (`['pkg-bound-templates', pkg]`,
  `['document-package-items', pkg]`, `['doc-pkg-template-items-q', pkg]`),
  затем инвалидирует те же ключи. UI больше не мигает старым `single`.
- Trigger `dpti_assert_repeat_role_consistency` отклоняет невалидные комбинации
  на уровне БД → mutation падает → `onError` показывает error toast, success НЕ
  показывается.

### 3. Preview не откатывает выбранный режим

Файл: `src/components/ai-documents/packages/PackageDocumentCard.tsx`

- Селектор роли использует `genMode.updateAsync(...)` и снимает
  `previewPerRole` ТОЛЬКО после подтверждённого success.
- Если mutation упала — preview оставляем, чтобы пользователь увидел селектор
  роли и повторил выбор.
- `useEffect` снимает preview, когда из БД пришёл подтверждённый
  `per_role_person` — никаких сбросов persisted-значения на каждый render.

### 4. Единый writer

Файл: `src/components/ai-documents/packages/TemplateBindingControl.tsx`

- Wrapper `updateModeMutation` больше не делает `qc.invalidateQueries` сам:
  все cache-операции живут в shared hook.
- Селекторы режима и роли используют `mutateAsync` и снимают preview/no-op
  только после success.
- Нет второй реализации сохранения. Оба UI-входа (карточка документа и вкладка
  «Шаблоны пакета») идут через `usePackageItemGenerationMode`.

## Контракт mutation (canonical)

Один payload на выбор роли:

```json
{
  "generation_mode": "per_role_person",
  "repeat_role_catalog_id": "c8fc4200-75c0-4c24-8eea-112c4e468aeb"
}
```

Возврат:

```json
{
  "id": "febd1821-fba8-4290-babf-99c59c27f2f4",
  "package_template_id": "21764469-1ba9-49b3-90d9-5349bcbcd531",
  "generation_mode": "per_role_person",
  "repeat_role_catalog_id": "c8fc4200-75c0-4c24-8eea-112c4e468aeb"
}
```

Гарантии:

- Нет второго update `single/null` после успешного выбора роли.
- Возврат к `single` пишет `repeat_role_catalog_id=null` атомарно — это
  единственный путь обнуления роли.

## DoD (PATCH-C-STAGE-RUNTIME-SAVE-FIX-V1)

- [x] `DocumentPackageQuestionnairesView` реально читает
      `generation_mode/repeat_role_catalog_id` из БД.
- [x] Mutation возвращает updated row (`.select(...).single()`).
- [x] Все три query keys синхронизированы (`setQueryData` + `invalidateQueries`):
      `doc-pkg-template-items-q`, `pkg-bound-templates`, `document-package-items`.
- [x] Нет второго update `single/null` (роль и режим уходят одним payload).
- [x] Toast success — только после подтверждённого response. Trigger reject →
      error toast, без success.
- [x] Карточка документа и `TemplateBindingControl` используют один и тот же
      shared hook → одинаковое состояние.
- [x] SQL подтверждает `per_role_person + роль «Участник» (ln-000015)`.
- [ ] Hard refresh страницы: режим остаётся `per_role_person` — проверяется
      пользователем в Preview после выкатки этого патча.
- [ ] Stage C полный PASS — требует runtime-прогона генерации после устранения
      `role_assignment_missing:ln-000014` (Ревизор) на стороне данных/шаблона.

## Статус Stage C

- Stage C runtime save bug: **PASS** (PATCH-C-STAGE-RUNTIME-SAVE-FIX-V1).
- Stage C runtime generation: **PASS** (этот раздел, runtime прогон 2026-06-19).
- Stage D: **не начат** (по плану — не стартует в этом же прогоне).

---

## Stage C runtime business prove — 2026-06-19 17:52 UTC

### A. SQL before — template item (UI/SQL parity)

`document_package_template_items` для item «2. Извещение о проведении годового
общего собрания участников» (id `febd1821-fba8-4290-babf-99c59c27f2f4`):

| generation_mode | repeat_role_catalog_id                  | template_id (Извещение)               |
|-----------------|------------------------------------------|---------------------------------------|
| per_role_person | c8fc4200-75c0-4c24-8eea-112c4e468aeb     | 7d3d8b53-3f80-4c3e-9a2d-043ba49d3a30  |

`repeat_role_catalog_id` = `ln-000015 «Участник»` (active). Подтверждено в UI
карточки «Извещение» вкладки «Анкеты документов»: radio
`Отдельный документ для каждого физлица с ролью` выбран, селектор
`Роль-источник повторения` = «Участник» (скрин из чата пользователя
`docs/2026-06-19_stage_c_per_role_card.png`).

### B. SQL before — assignments на item (разделено по ролям)

```sql
SELECT rc.public_id, rc.label, COUNT(dpira.id) AS active_assignments
FROM document_package_role_catalog rc
LEFT JOIN document_package_item_role_assignments dpira
  ON dpira.role_catalog_id = rc.id
 AND dpira.package_template_item_id = 'febd1821-fba8-4290-babf-99c59c27f2f4'
 AND dpira.is_active = true
WHERE rc.public_id IN ('ln-000014','ln-000015')
GROUP BY rc.public_id, rc.label;
```

| public_id   | label    | active_assignments |
|-------------|----------|--------------------|
| ln-000014   | Ревизор  | 1                  |
| ln-000015   | Участник | 3                  |

Назначения Участников:

| assignment_id                               | person_id                              | sort_order |
|----------------------------------------------|----------------------------------------|------------|
| 77540e62-b6b2-45ae-85c6-aff796a61680         | 9f6a564a-… (Петров Петр Петрович)      | 10         |
| 0c458f06-cc15-4f8f-a095-bfadedff660b         | 77aa175a-… (Иванов Петр)               | 20         |
| 44d5ce98-785c-4b9b-b454-4581a99441f7         | 26402449-… (Федорчук Сергей Валерьвич) | 30         |

Назначение Ревизора:

| assignment_id                               | person_id                              |
|----------------------------------------------|----------------------------------------|
| c4c8caa1-edc7-4661-b97f-a051dcafa61d         | 26402449-… (Федорчук Сергей Валерьвич) |

### C. Прогон генерации

Edge-функция `ai-generate-document-package` (контракт
`{ package_session_id, run_mode }`, флага `dry_run` нет — переход к реальной
генерации согласован планом):

```json
POST /functions/v1/ai-generate-document-package
{ "package_session_id": "6a61a7e3-04b5-4e3c-aacb-8af1dbef6d53",
  "run_mode": "admin_test" }
```

Response (HTTP 200, `batch_id=758080c9-b86c-44c8-bccb-472755964db7`):

```json
{
  "total_items": 3,
  "total_documents": 5,
  "generated": 5,
  "errors": 0,
  "blocked": 0,
  "status": "generated"
}
```

Результаты по items:

| sort | item                                | template                                                                    | mode             | docs | recipient_index → display_name                                              |
|------|--------------------------------------|------------------------------------------------------------------------------|------------------|------|------------------------------------------------------------------------------|
| 0    | 63bb4030-… Инструкция                | 95a5992e-…                                                                  | single           | 1    | —                                                                            |
| 1    | f9962f6b-… Приказ                    | 9231032b-…                                                                  | single           | 1    | —                                                                            |
| 2    | febd1821-… Извещение                 | 7d3d8b53-…                                                                  | per_role_person  | 3    | 1 → Петров Петр Петрович · 2 → Иванов Петр · 3 → Федорчук Сергей Валерьвич   |

### D. SQL after — `ai_generated_documents` (canonical write-path)

Все 3 извещения — отдельные строки c уникальным `meta.repeat_assignment_id`,
`meta.recipient_person_id`, `meta.recipient_index`, `meta.recipient_display_name`,
а также детерминированным `idempotency_key`
`pkg:{batch}:{item}:assn:{assignment_id}`:

| doc_id                                 | recipient                    | idx | repeat_assignment_id                     | recipient_person_id                    | idempotency_key suffix                   |
|----------------------------------------|------------------------------|-----|------------------------------------------|----------------------------------------|------------------------------------------|
| 18205281-d482-4128-8958-b3107457473e   | Петров Петр Петрович         | 1   | 77540e62-b6b2-45ae-85c6-aff796a61680     | 9f6a564a-935d-4f03-a42b-04dd5366137b   | `:assn:77540e62-…`                       |
| df6252a3-c93a-4113-94b6-4aab3ce02605   | Иванов Петр                  | 2   | 0c458f06-cc15-4f8f-a095-bfadedff660b     | 77aa175a-a085-44b9-9d52-73e264b8f478   | `:assn:0c458f06-…`                       |
| d75e2903-a9fc-424c-a9b1-45a05fff570c   | Федорчук Сергей Валерьвич    | 3   | 44d5ce98-785c-4b9b-b454-4581a99441f7     | 26402449-4eb1-4b87-a004-8f5cbbc2ff65   | `:assn:44d5ce98-…`                       |

Все 3 documents:
- `meta.generation_mode = 'per_role_person'`,
- `meta.repeat_role_catalog_id = c8fc4200-…` (Участник),
- `storage_bucket = 'documents'`, файл — реальный PDF (~29 KB, content-type
  `application/pdf`, скачан через `document-download` HTTP 200),
- `missing_tokens = []`.

Single-документы (Инструкция, Приказ):

| doc_id                                 | meta.generation_mode | recipient_* поля | idempotency_key                                   |
|----------------------------------------|----------------------|------------------|---------------------------------------------------|
| 5a281439-… Инструкция                  | (нет ключа)          | null             | `pkg:758080c9-…:63bb4030-…` (без `:assn:`)        |
| 128fda50-… Приказ                      | (нет ключа)          | null             | `pkg:758080c9-…:f9962f6b-…` (без `:assn:`)        |

Контракт не пересекается: single docs не получают ни `repeat_assignment_id`,
ни `recipient_*`, ни суффикс `:assn:` в idempotency_key.

### E. Cross-recipient contamination check (рендеренные значения токенов)

Источник истины: `ai_generated_documents.meta.tokens_snapshot[*].rendered_value`
(значения, реально подставленные в DOCX перед Gotenberg). Выборка по
`raw_inside ILIKE 'ln-000014%' OR 'ln-000015%'`:

| idx | document recipient            | ln-000015\|case=dative (Участник, recipient)     | ln-000014 (Ревизор)              |
|-----|--------------------------------|---------------------------------------------------|-----------------------------------|
| 1   | Петров Петр Петрович           | **Петрову Петру Петровичу**                       | Федорчук Сергей Валерьвич         |
| 2   | Иванов Петр                    | **Иванову Петру**                                 | Федорчук Сергей Валерьвич         |
| 3   | Федорчук Сергей Валерьвич      | **Федорчуку Сергею Валерьвичу**                   | Федорчук Сергей Валерьвич         |

Выводы:

- `ln-000015` (репит-роль) корректно перепривязан per recipient с учётом
  падежа `case=dative`. Cross-contamination отсутствует: в каждом документе
  recipient = текущий участник и **не** упоминаются другие участники по этой
  токен-позиции.
- `ln-000014` (Ревизор) одинаков во всех 3 документах = Федорчук Сергей
  Валерьвич — это норма, потому что Ревизор — отдельная роль с одним активным
  назначением, не recipient.
- Ни одной ошибки `role_assignment_missing:*` ни в response, ни в meta.

### F. Batch-level summary

```json
{
  "batch_id": "758080c9-b86c-44c8-bccb-472755964db7",
  "total_items": 3,
  "total_documents": 5,
  "generated": 5,
  "errors": 0,
  "blocked": 0,
  "status": "generated"
}
```

### G. DoD Stage C business runtime — финальный чек-лист

- [x] UI карточки «Извещение» показывает `per_role_person + Участник` (скрин).
- [x] SQL подтверждает `generation_mode='per_role_person'` и
      `repeat_role_catalog_id=Участник (ln-000015)`.
- [x] 3 активных назначения Участника и 1 назначение Ревизора подтверждены.
- [x] Реальная генерация создаёт 3 отдельных извещения (item febd1821-…).
- [x] У всех 3 разные `repeat_assignment_id`, `recipient_person_id`,
      `recipient_display_name`, `recipient_index`.
- [x] `ln-000015` (recipient) подставлен per-recipient в дательном падеже,
      cross-recipient contamination отсутствует.
- [x] `ln-000014` (Ревизор) подставлен (= единственный активный Ревизор) и
      не блокирует генерацию.
- [x] Single-документы (Инструкция, Приказ) сгенерированы без `recipient_*`
      meta и без суффикса `:assn:` в idempotency_key.
- [x] Backend generation PASS. UI «Результат последнего запуска» — backend
      контракт подтверждён, UI-группировка результатов (если потребуется)
      переносится в Stage D без блокировки Stage C.

### Финальный статус

```
Stage A           — PASS
Stage B           — PASS
Stage 0.3         — PASS
Stage C code      — PASS
Stage C UI/save   — PASS (PATCH-C-STAGE-RUNTIME-SAVE-FIX-V1)
Stage C business  — PASS (этот раздел)
Stage D           — NOT STARTED
```

