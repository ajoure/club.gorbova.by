# PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1

**Текущий статус:** Stage E.0.1 ✅ Discovery → Stage E.1 ✅ Storage+Specs → **ОЖИДАЕТ ПОДТВЕРЖДЕНИЯ** для Stage E.1a.

Proof'ы:
- `.lovable/proofs/docx_table_repeat_by_role_e01_discovery.md`
- `.lovable/proofs/docx_table_repeat_by_role_e1_storage.md`

---


1. План в целом правильный. Главное исправление после моего предыдущего замечания учтено: `votes`, `share_percent` и любые будущие данные не должны быть хардкодом, а должны быть **custom fields назначения роли**.
  &nbsp;
  Правильная модель:
2. Подтверждаю storage v1:
  - schema custom fields:
  - values:
  - table repeat config:
  ```text
  document_package_template_items.metadata.table_repeats
  ```
  Это правильное разделение. Не смешивать custom fields с `pf-*`, `package.fl.*` и `legal_details_persons`.
3. Перед миграцией обязательно выполнить Stage E.0.1 Discovery.
  &nbsp;
  Не начинать E.1, пока не подтверждено:
  - есть ли уже `metadata` в `document_package_template_items`;
  - есть ли уже `metadata` в `document_package_role_catalog`;
  - не теряется ли `metadata.custom` при `save_session_document_atomic`;
  - где именно сейчас формируется payload role assignments;
  - как сохраняются `position` и `position_gender`.
4. Если `document_package_role_catalog.metadata` уже есть — не делать повторную миграцию для него.
  &nbsp;
  Миграция должна быть строго add-only и только там, где колонки реально нет:
5. В custom fields v1 не вводить жёсткую валидацию `number/percent/date`.
  &nbsp;
  Типы можно хранить:
  ```text
  text
  number
  percent
  date
  ```
  Но значения в v1 сохранять как строку. Жёсткая типизация и арифметика — отдельный будущий этап.
6. Для key custom field утвердить строгий контракт:
  &nbsp;
  ```text
  ^[a-z][a-z0-9_]{0,49}$
  ```
  Запрещённые ключи:
  ```text
  position
  position_gender
  custom
  person_id
  role_catalog_id
  assignment_id
  id
  sort_order
  is_active
  ```
  Ошибки:
7. В UI нельзя давать основной сценарий через свободный ввод ключа.
  &nbsp;
  Основной UX:
  - админ создаёт custom field у роли;
  - в assignment карточке появляются поля для заполнения;
  - в table-repeat колонке поле выбирается из Select.
  Raw key input допустим только в `Расширенно`, только для `super_admin`.
8. `metadata.custom` должен сохраняться через существующий atomic save Stage 5, если Discovery подтвердит совместимость.
  В proof обязательно показать, что при сохранении assignment:
  - `metadata.position` не теряется;
  - `metadata.position_gender` не теряется;
  - `metadata.custom.votes` сохраняется;
  - `metadata.custom.share_percent` сохраняется;
  - соседние assignments не затрагиваются.
9. Если `save_session_document_atomic` сейчас перезаписывает metadata целиком и может потерять custom — STOP.
  &nbsp;
  Тогда сначала нужен маленький patch atomic metadata merge, а не продолжать table-repeat.
10. Scalar token `{{ln-XXXXXX.custom.<key>}}` нужен и должен быть реализован до table-repeat.

Он нужен не только для таблиц, но и для обычного текста документа.

Пример:

```text
{{ln-000015.custom.votes}}
{{ln-000015.custom.share_percent}}
```

11. Multi-policy для scalar custom fields подтверждаю:

- 0 assignments → `role_assignment_missing`;
- 1 assignment → значение;
- 2+ assignments → `multiple_persons_for_scalar_role_custom_field`.

Не делать join для `votes/share_percent`, чтобы не получить юридически странный текст вида `20%; 30%; 50%`.

12. Для table-repeat source type использовать именно:

```text
assignment_custom_field
```

А не `assignment_metadata` в основном UX. Это точнее и понятнее.

13. В Stage E.2 UI table-repeat в mapping колонок источник должен называться по-человечески:

```text
Доп. поле роли
```

А в JSON:

```json
{
  "source_type": "assignment_custom_field",
  "source_key": "votes"
}
```

14. В table-repeat v1 не добавлять `package.fl.FLD-*`, `package.ul.FLD-*`, `package.ip.FLD-*` как source column.

Подтверждаю: для строк по участникам источник данных должен быть role assignment, а не пакетное ФЛ/ЮЛ.

15. Поведение при 0 active assignments подтверждаю:

- удалить шаблонную строку;
- вернуть warning:
- не оставлять пустую строку с маркерами.

16. Для `{{tableRepeat:TR-XXXXXX}}` обязательно сделать classifier/validator до генератора.

Маркер должен быть:

```text
valid/info marker
```

А не `invalid` и не `legacy_tokens_found`.

17. В генераторе row expansion делать только если в DOCX найден маркер `tableRepeat`.

Документы без маркеров должны идти старым путём через Docxtemplater без изменений.

18. По `document.xml` работать осторожно.

В proof нужно показать:

- исходный `<w:tr>` с маркером;
- итоговые 3 `<w:tr>`;
- что стили/границы/выравнивание строки сохранены;
- что служебный маркер удалён.

19. Для source `package_field` в строке repeat нужно учитывать, что значение будет одинаковым для всех строк.

Это нормально, но в UI желательно подсказка:

```text
Значение пакетного поля одинаковое для всех строк.
```

20. Для `assignment_custom_field` значения должны быть разными по строкам.

В runtime proof обязательно:

```text
Петров — 20%
Иванов — 30%
Федорчук — 50%
```

Нельзя закрывать PASS, если в колонке голосов стоит один общий static text.

21. В E.1a UI role schema editor добавить защиту от удаления custom field, у которого уже есть значения в assignments.

Минимальный v1:

- показать warning;
- разрешить удаление только после подтверждения;
- значения в `metadata.custom` можно оставить как orphan values, но в UI они больше не отображаются.

Не делать автоматическую очистку значений в этом патче.

22. В E.1a values editor показывать поля только для активных role assignments соответствующей роли.

Если role assignment inactive — не показывать его как актуального получателя repeat-строки.

23. В `PackageRolesManager` при редактировании role metadata соблюдать merge.

Нельзя перезаписать:

```json
{
  "enable_person_subfields": true
}
```

при добавлении:

```json
{
  "assignment_custom_fields": [...]
}
```

Итог должен сохранить оба ключа.

24. В proof обязательно проверить, что `enable_person_subfields` не потерялся после добавления `assignment_custom_fields`.

Это важно, потому что мы уже использовали metadata роли для видимости расширенных полей.

25. В E.4 orchestrator должен передавать в strict только заранее подготовленные `preresolved_table_repeats`.

Strict не должен сам ходить в БД за assignments. Он должен получить готовые rows и только трансформировать DOCX.

26. В E.4 ошибки должны быть structured, без 500:

```text
table_repeat_config_missing
table_repeat_marker_missing
table_repeat_marker_not_in_row
table_repeat_no_assignments
table_repeat_column_unresolved
multiple_persons_for_scalar_role_custom_field
role_no_custom_field_def
```

27. В E.5 proof добавить отдельную регрессию по уже закрытым функциям:

- `{{ln-000015}}` работает;
- `{{ln-000015.passport_number_full}}` работает;
- `{{ln-000015.custom.votes}}` работает при 1 assignment и даёт controlled error при 3 assignments;
- `recipient.*` из per_role_person не сломан;
- обычный документ без tableRepeat генерируется как раньше.

28. В proof по custom fields обязательно показать, что данные не протекают в другие пакеты.

Минимум:

```sql
SELECT package_template_id, label, metadata->'assignment_custom_fields'
FROM document_package_role_catalog
WHERE label = 'Участник';
```

Нужно показать, что custom fields включены только у роли нужного package_template_id.

29. Не начинать E.2/E.3/E.4, пока E.1a не закрыт.

Причина: table-repeat должен выбирать `assignment_custom_field` из каталога, а не raw key.

30. Итоговый порядок подтверждаю:

```text
E.0.1 — Discovery custom assignment fields
E.1 — Metadata columns + shared specs
E.1a — Custom fields schema + values UI + scalar resolver
E.2 — UI table-repeat config
E.3 — Classifier/validator tableRepeat marker
E.4 — DOCX row expansion
E.5 — Runtime proof
```

31. После выполнения каждого stage — отдельный отчёт и proof. Не закрывать весь PATCH одним code-level отчётом.
32. Итоговый DoD дополнить:

- custom fields role schema сохраняется без потери `enable_person_subfields`;
- values сохраняются на assignment через atomic save;
- table-repeat использует custom field из Select;
- `votes/share_percent` различаются между строками;
- 3 active participants → 3 строки;
- marker не виден в итоговом DOCX;
- no cross-contamination;
- documents without marker zero-diff.

После этих правок план можно утверждать и начинать с E.0.1 Discovery.

&nbsp;

План: PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1 (revised)

Повторяемые строки таблицы в DOCX по роли + слой **role-assignment custom fields** (произвольные доп. поля назначения роли, задаваемые админом и используемые как в обычном тексте, так и в table-repeat).

Все источники колонок и плейсхолдеры — через ID/key из каталогов, без свободного ввода ключей в основном UX.

---

## Итоги Stage E.0 Discovery (ключевое из прошлого прохода)

- Генератор `supabase/functions/canonical-document-generate-strict/index.ts` — PizZip 3.1.6 + Docxtemplater 3.47.1. Логики клонирования `<w:tr>` нет. Подходящая точка для row-expansion — между `new PizZip(buf)` (line 777) и `new Docxtemplater(zip, …)` (line 1741), напрямую над raw `word/document.xml`.
- Резолвинг идёт через `preresolved_*` бэги (`fields`, `package_fields`, `ln_tokens`, `ln_subfield_tokens`, `pf_fields`) и `recipient.*`. Подмена — `docx.render(resolved)` (line 1756).
- В `document_package_template_items` нет jsonb-поля под per-item config; в `document_template_versions.token_manifest` класть нельзя (семантика). Соседний паттерн `metadata jsonb` есть у `document_package_item_role_assignments` и `document_package_field_catalog`.
- Assignment metadata уже читается (`md.position`, `md.position_gender`); UI редактирует `position` в `PackageDocumentCard.tsx`. «Голоса/доли» в пакетном контексте нигде не хранятся.
- Sub-fields физлица — 25 ключей в `_shared/ln-subfield-spec.ts` и `src/lib/documents/lnSubFieldSpec.ts` (mirror).
- Маркер `{{tableRepeat:TR-XXXXXX}}` сейчас отбрасывается `classifyPlaceholder` как `invalid` и падает в `legacy_tokens_found` — нужна явная пре-обработка.

## Дополнение к Discovery (Stage E.0.1 — Custom Assignment Fields)

Read-only исследование перед миграциями. Подтвердить:

1. **Где сейчас редактируется `document_package_item_role_assignments.metadata**` — какие точки записи (UI компоненты + edge functions), есть ли atomic save из Stage 5 (batch upsert) и формат payload. Цель: понять, можно ли добавить `metadata.custom` без новой edge function и без поломки atomic save.
2. **Где хранится `position**` — фиксируем factual: `metadata.position` (string), `metadata.position_gender` (m/f). Подтвердить, что после введения `metadata.custom = {…}` оба поля не пересекаются по ключу и `position` остаётся на верхнем уровне (для обратной совместимости генератора).
3. **Носитель schema custom fields** — выбор между:
  - `document_package_role_catalog.metadata.assignment_custom_fields` (роль уровня пакета — рекомендуется, поля «принадлежат» роли);
  - `document_package_template_items.metadata.assignment_custom_fields` (per-item override — на v1 не делаем);
  - `document_package_field_catalog` (не подходит — это поля пакета, не assignment).
   **Рекомендация v1: только role_catalog-уровень**, без per-item override.
4. **Наличие `metadata jsonb` колонки у `document_package_role_catalog**` — если её нет в SELECT-ах оркестратора (`ai-generate-document-package/index.ts`, `resolve-package-tokens.ts`), нужна одна миграция `ALTER TABLE … ADD COLUMN metadata jsonb DEFAULT '{}'` (паттерн идентичен item-уровню). Если уже есть — только расширить SELECT.
5. **Atomic save для assignments** — убедиться, что `metadata.custom` сериализуется по тому же пути и не теряется при пересоздании assignment'а в atomic batch.

Решение по миграциям откладывается до завершения E.0.1 (см. план Stage E.1).

---

## Архитектурные решения

### Storage


| Что                           | Где                                                               | Миграция                                                                         |
| ----------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `table_repeats[]` per-item    | `document_package_template_items.metadata.table_repeats`          | `ADD COLUMN metadata jsonb DEFAULT '{}'`                                         |
| **Schema custom fields роли** | `document_package_role_catalog.metadata.assignment_custom_fields` | `ADD COLUMN metadata jsonb DEFAULT '{}'` (если ещё нет — подтверждается в E.0.1) |
| **Values custom fields**      | `document_package_item_role_assignments.metadata.custom`          | без миграции                                                                     |


`metadata.custom` намеренно отделён от системных ключей (`position`, `position_gender`) — никаких смешений системных и пользовательских полей в одном неймспейсе.

### Контракты данных

**Schema custom field (на роли):**

```ts
type CustomFieldType = 'text' | 'number' | 'percent' | 'date'; // v1: реализуем все, UI рендерит text для всех, валидаторы — отдельной задачей

interface AssignmentCustomFieldDef {
  key: string;          // ^[a-z][a-z0-9_]{0,49}$, lowercase
  label: string;        // человекочитаемое имя
  type: CustomFieldType;
  placeholder?: string;
  required?: boolean;   // v1: только валидация в UI, не блокирующая
}

// document_package_role_catalog.metadata
interface RoleCatalogMetadata {
  assignment_custom_fields?: AssignmentCustomFieldDef[];
}
```

**Запрещённые ключи** (явная проверка в UI и на бэке при сохранении schema):
`position`, `position_gender`, `custom`, `person_id`, `role_catalog_id`, `assignment_id`, `id`, `sort_order`, `is_active`.

Ошибка: `assignment_custom_field_key_reserved:<key>` или `assignment_custom_field_key_invalid_format:<key>`.

**Values:**

```ts
// document_package_item_role_assignments.metadata
interface AssignmentMetadata {
  position?: string;
  position_gender?: 'm' | 'f' | null;
  custom?: Record<string, string>;  // key → значение (всё как строка в v1; конвертация по type — отдельно)
}
```

### Плейсхолдеры

Новый scalar-токен для использования custom field в обычном тексте документа:

```
{{ln-XXXXXX.custom.<key>}}
```

Парность фронт/бэк:

- regex `^(ln-\d{6,})\.custom\.([a-z][a-z0-9_]{0,49})$` в `placeholderClassifier`;
- новый kind `package_role_custom_field`.

Multi-policy (как у других scalar ln-токенов):

- 0 active assignments роли → `role_assignment_missing`;
- 1 → значение `metadata.custom.<key>` (пусто → пустая строка, не ошибка);
- ≥2 → `multiple_persons_for_scalar_role_custom_field`.

Внутри table-repeat `{{ln-XXXXXX.custom.<key>}}` НЕ нужен — значения берутся через mapping колонок (`source_type: 'assignment_custom_field'`). Если пользователь всё равно поставит scalar в шаблонной строке — резолвится по текущему assignment row.

### Источники колонок table-repeat (v1)


| source_type               | source_key                           | Описание                                |
| ------------------------- | ------------------------------------ | --------------------------------------- |
| `role_person`             | sub_field key из 25                  | Sub-field физлица назначенной роли      |
| `assignment_custom_field` | key из role.assignment_custom_fields | **Доп. поле роли** (новое; основной UX) |
| `package_field`           | pf-XXXXXX                            | Поле пакета                             |
| `static_text`             | литерал                              | Текст                                   |
| `row_number`              | —                                    | 1, 2, 3…                                |
| `empty`                   | —                                    | Пустая ячейка                           |


`assignment_metadata` (произвольный key) **исключён из основного UX**. Оставляем как «advanced» fallback в UI (collapsible «Расширенно»), доступный только super_admin, чтобы не плодить «голые» ключи без schema.

`package.fl.FLD-*` как колонка — **не в v1** (подтверждено пользователем).

### Маркер строки

`{{tableRepeat:TR-XXXXXX}}` в первой ячейке строки-шаблона. Стабильный ID `TR-######`, копируется кнопкой из UI.

---

## Этапы

### Stage E.0 — Discovery (текущий)

Завершён по generator/storage. **Доделать E.0.1** (custom assignment fields, см. выше) до любой миграции.

### Stage E.1 — Миграция (после E.0.1)

Одна миграция, две `ADD COLUMN` (если колонки реально отсутствуют — подтвердить в E.0.1):

```sql
ALTER TABLE public.document_package_template_items
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.document_package_role_catalog
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_dptem_metadata_gin
  ON public.document_package_template_items USING gin (metadata);
CREATE INDEX IF NOT EXISTS idx_dprc_metadata_gin
  ON public.document_package_role_catalog USING gin (metadata);
```

GRANT'ы и RLS у обеих таблиц уже настроены — не трогаем.

Shared TS-типы:

- `src/lib/documents/tableRepeatSpec.ts` + `supabase/functions/_shared/table-repeat-spec.ts` — `TableRepeatConfig`, `TableRepeatColumn` (включая `source_type: 'assignment_custom_field'`), `nextTableRepeatId`.
- `src/lib/documents/assignmentCustomFieldsSpec.ts` + `supabase/functions/_shared/assignment-custom-fields-spec.ts` — `AssignmentCustomFieldDef`, validator (`isValidCustomFieldKey`, `RESERVED_KEYS`).

### Stage E.1a — Assignment Custom Fields schema + UI + values (новый, обязателен до E.2)

1. **Schema editor в карточке роли пакета** — `PackageRolesManager.tsx` / `EditRoleDialog`:
  - блок «Дополнительные поля роли»;
  - список `{key, label, type, placeholder}` с add/edit/delete;
  - валидация key против regex и RESERVED_KEYS;
  - сохранение в `role_catalog.metadata.assignment_custom_fields` через **существующий путь обновления роли** (если такого пути нет — добавить тонкую edge `package-role-catalog-update-metadata`: verify_jwt + super_admin + audit, единственная мутация — `UPDATE document_package_role_catalog SET metadata = ... WHERE id = ...`).
2. **Values editor в карточке assignment** — `PackageDocumentCard.tsx`:
  - под существующим input «Должность» — динамически отрисованный список полей из `role.metadata.assignment_custom_fields`;
  - значения пишутся в `assignment.metadata.custom[key]`;
  - сохранение через **тот же atomic save Stage 5** (после подтверждения совместимости в E.0.1).
3. **Resolver для scalar `{{ln-XXXXXX.custom.<key>}}**`:
  - в `_shared/placeholderClassifier.ts` (+ mirror) — новый kind `package_role_custom_field`;
  - в `_shared/resolve-package-tokens.ts` — резолвинг по active assignments роли с multi-policy выше;
  - в `ai-generate-document-package/index.ts` — пополнение нового бэга `preresolved_ln_custom_tokens: Record<string,string>`;
  - в `canonical-document-generate-strict/index.ts` — подстановка по аналогии с `preresolved_ln_subfield_tokens`.
4. **Validator panel** — `PackageTemplateValidationPanel.tsx`:
  - `package_role_custom_field` отображается с reasoning: ok / `role_no_custom_field_def:<key>` (key не объявлен у роли) / `role_no_assignments` / `multiple_persons_for_scalar_role_custom_field`.

### Stage E.2 — UI table-repeat (после E.1a)

`PackageDocumentCard.tsx` — новая секция «Повторяемые строки таблиц».

Компоненты:

- `TableRepeatsManager.tsx` — список TR-конфигов, add/edit/delete, copy-marker.
- `TableRepeatEditorDialog.tsx`:
  - выбор роли (`document_package_role_catalog`, активные пакета);
  - таблица колонок: cell_index | Источник (Select) | Поле (зависимый Select) | Формат | Падеж;
  - источник `role_person` → Select из 25 sub-fields (группы ФИО/Паспорт/Адрес/Контакты/Банк);
  - источник **«Доп. поле роли»** (`assignment_custom_field`) → Select из `role.metadata.assignment_custom_fields` (label, key — disabled placeholder если у роли нет полей: «Добавьте дополнительные поля в настройках роли»);
  - источник `package_field` → Select из `document_package_field_catalog` (активные);
  - источник `static_text` → text input;
  - источник `row_number` / `empty` — без параметра;
  - collapsible «Расширенно» (super_admin only) — `assignment_metadata` с raw key input как fallback;
  - кнопка **«Скопировать маркер строки»** → `{{tableRepeat:TR-XXXXXX}}`.
- Preview: «Будет создано N строк» + список ФИО из активных assignments.

Запись — `UPDATE document_package_template_items SET metadata = ...` через тонкую edge `package-template-item-update-metadata` (verify_jwt + super_admin + audit).

### Stage E.3 — Classifier / Validator (раздельно, чтобы не смешивать с UI)

- `placeholderClassifier`: добавить kinds `package_table_repeat_marker` (для `tableRepeat:TR-…`) и `package_role_custom_field` (уже в E.1a, здесь окончательная парность).
- `PackageTemplateValidationPanel.tsx`: маркер `tableRepeat` отображается как **info** «Маркер повторяемой строки» с статусом сопоставления: ok / `table_repeat_config_missing:TR-…` / `table_repeat_role_no_assignments`. Не error.

### Stage E.4 — Generator (XML row expansion)

В `canonical-document-generate-strict/index.ts`, новая функция `expandTableRepeats(zip, ctx)` между PizZip и Docxtemplater.

Алгоритм:

1. Прочитать `word/document.xml` как raw XML.
2. Regex `\{\{tableRepeat:(TR-\d+)\}\}` — найти маркеры.
3. Для каждого маркера:
  - получить `TableRepeatConfig` из `ctx.preresolved_table_repeats[TR-…]` (готовится оркестратором);
  - подняться к ближайшему `<w:tr …>…</w:tr>`; если не нашли — `table_repeat_marker_not_in_row:TR-…`, continue;
  - получить active assignments роли (SQL ниже) + значения `metadata.custom`;
  - клонировать строку для каждого assignment, удалить маркер, заменить ячейки по mapping:
    - `role_person.<sub_field>` → существующий `renderLnSubField(person, sub_field)`;
    - `assignment_custom_field.<key>` → `assignment.metadata.custom[key] ?? ''`;
    - `package_field.<pf-id>` → из `preresolved_pf_fields` (общий для всех строк);
    - `static_text` → литерал;
    - `row_number` → индекс+1;
    - `empty` → '';
  - склеить клоны и заменить исходный `<w:tr>`.
4. Записать XML обратно в zip.
5. Docxtemplater дальше работает как обычно.

SQL (в оркестраторе):

```sql
SELECT a.id, a.person_id, a.sort_order, a.metadata,
       p.* -- legal_details_persons
FROM document_package_item_role_assignments a
JOIN legal_details_persons p ON p.id = a.person_id
WHERE a.package_session_id = :session_id
  AND a.package_template_item_id = :item_id
  AND a.role_catalog_id = :role_catalog_id
  AND a.is_active = true
  AND a.person_id IS NOT NULL
ORDER BY a.sort_order NULLS LAST, p.last_name, p.first_name, a.id;
```

Новые preresolved-бэги в payload generate-strict:

- `preresolved_table_repeats: Record<string, { config: TableRepeatConfig; rows: ResolvedRow[] }>`;
- `preresolved_ln_custom_tokens: Record<string, string>` (scalar `{{ln-XXXXXX.custom.<key>}}`).

Коды ошибок (HTTP 200 + structured response):

- `table_repeat_config_missing:TR-…`
- `table_repeat_marker_missing:TR-…` (warning)
- `table_repeat_marker_not_in_row:TR-…`
- `table_repeat_no_assignments:TR-…` (warning, шаблонную строку **удаляем**, подтверждено)
- `table_repeat_column_unresolved:TR-…:col=N:reason=…`
- `multiple_persons_for_scalar_role_custom_field:ln-…:key=…`
- `role_no_custom_field_def:ln-…:key=…`

Ветка expansion активируется ТОЛЬКО при наличии маркеров в DOCX — регрессии для обычных документов нет.

### Stage E.5 — Runtime proof

Документ «Список зарегистрированных лиц» (пакет «Годовое собрание участников»):

**Custom fields proof:**

- На роли «Участник» (`ln-000015`) объявлены custom fields: `votes` (label «Количество голосов», type text, placeholder «20%»), `share_percent` (label «Доля в уставном фонде», type text);
- 3 active assignments с **разными** значениями:
  - Петров — `votes=20%`, `share_percent=20%`;
  - Иванов — `votes=30%`, `share_percent=30%`;
  - Федорчук — `votes=50%`, `share_percent=50%`;
- Скрин UI: schema-editor у роли + values-editor у каждого assignment.

**Scalar token proof:**

- В обычном тексте документа `{{ln-000015.custom.votes}}` при 3 active → `multiple_persons_for_scalar_role_custom_field` (warning, как и для других scalar ln-токенов).

**Table-repeat proof:**

- DOCX-шаблон с одной строкой таблицы, маркер `{{tableRepeat:TR-XXXXXX}}` в первой ячейке;
- mapping: ФИО → паспорт серия+номер → личный номер → **Доп. поле «votes»** → **Доп. поле «share_percent»** → row_number;
- ожидаемо: 3 строки, разные значения голосов и долей в каждой, стили сохранены, нет cross-contamination.

**Регрессия:**

- Любой другой документ пакета без маркера и без custom-токенов генерируется идентично pre-patch (diff байтов значимо пустой);
- Существующее поле `position` не сломано (значение сохраняется и резолвится в шаблонах как раньше).

### Proof файл

`.lovable/proofs/docx_table_repeat_by_role_v1.md`:

- ссылка на discovery (E.0 + E.0.1);
- выбранный storage (table_repeats / custom_fields_schema / custom_values);
- SQL active assignments;
- скрины UI: role schema editor, assignment values editor, table-repeat editor;
- DOCX before (1 строка) / after (3 строки);
- excerpt `document.xml` до/после с границами `<w:tr>`;
- **отдельный раздел «Custom assignment fields proof»** с тремя разными значениями `votes`;
- регрессионный лог: обычный документ без маркера — ok, размер +0/−0 значимо.

---

## DoD

- Админ создаёт custom fields на уровне роли (label + key + type + placeholder).
- Значения custom fields заполняются на уровне конкретного role assignment (per-документ).
- Custom fields доступны в обычном тексте как `{{ln-XXXXXX.custom.<key>}}` с safe multi-policy.
- Table-repeat использует custom field как колонку через выбор из каталога (не свободный ввод ключа в основном UX).
- Значения в table-repeat не хардкодятся и **различаются между строками**.
- Custom fields одной роли не протекают в другие пакеты (хранятся per role-catalog, который scope'ed к пакету).
- Существующее `metadata.position` и `position_gender` не сломаны.
- Маркер `{{tableRepeat:TR-XXXXXX}}` не помечается как error.
- 3 active assignments → 3 строки таблицы, стили сохранены.
- Документы без маркера и без custom-токенов генерируются без изменений.
- Proof со всеми разделами создан.

## Out of scope (явно)

- per-item override schema custom fields (только role-level в v1);
- типизированная валидация custom field values (number/percent/date жёсткой валидации — позже; v1 хранит как строку);
- package.fl/ul/ip.FLD-* как источник колонки table-repeat;
- repeat по нескольким ролям одновременно / вложенные repeats / repeat по UL/IP;
- selective regeneration, автоархивация stale docs;
- визуальный DOCX-редактор;
- бизнес-логика голосов / расчёт долей.

---

## Порядок выполнения после approve

1. **E.0.1 Discovery** — read-only проверки atomic save и наличия `metadata` колонок (без кода, без миграций).
2. **E.1** — одна миграция (две `ADD COLUMN`, если нужно) + shared TS-spec'и.
3. **E.1a** — schema editor у роли, values editor у assignment, scalar resolver `{{ln-…custom.<key>}}`, classifier/validator update.
4. **E.2** — UI table-repeat (включая источник «Доп. поле роли»).
5. **E.3** — финализация classifier для маркера tableRepeat.
6. **E.4** — generator (XML row expansion) + оркестратор (preresolved бэги).
7. **E.5** — runtime proof на «Списке зарегистрированных лиц» с тремя разными `votes`.

Подтвердишь — переходим в build mode и стартуем со Stage E.0.1.