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

- Stage C runtime save bug: **PASS** (этот патч).
- Stage C runtime generation: **PARTIAL** — ждёт фикса
  `ln-000014 Ревизор` (назначение участника на роль ИЛИ замена токена в
  шаблоне «Извещение» на `{{recipient.full_name}}`).
- Stage D: **не начинать** до полного Stage C PASS.
