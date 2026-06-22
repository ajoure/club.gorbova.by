## да, согласен, с учетом правок:

1. Stage E.2 можно выполнять только как UI/config layer.
  &nbsp;
  Итоговый статус после выполнения:
  ```text
  Stage E.2 — PASS: table-repeat UI/config layer
  ```
  Без заявлений, что DOCX уже размножает строки или что `{{tableRepeat:TR-XXXXXX}}` уже валидируется генератором.
2. Перед реализацией сохранения `metadata.table_repeats` нужно подтвердить фактический write-path.
  &nbsp;
  В плане написано:
  ```text
  через уже существующий atomic-save items
  ```
  Но если такого безопасного audited write-path для `document_package_template_items.metadata` нет — STOP.
  Тогда не делать прямой client-side update, а дать маленький plan на безопасный metadata update path:
3. Сохранение `document_package_template_items.metadata` должно быть merge-only.
  &nbsp;
  Нельзя писать:
  ```ts
  metadata = { table_repeats: nextRepeats }
  ```
  Нужно:
  ```ts
  metadata = {
    ...freshMetadata,
    table_repeats: nextRepeats
  }
  ```
  Перед save перечитать свежий `metadata`, чтобы не затереть будущие ключи item-level metadata.
4. В UI показывать номера колонок по-человечески с 1, но хранить `cell_index` как 0-based.
  &nbsp;
  Пример:
  ```text
  UI: Колонка 1
  storage: cell_index = 0
  ```
  Иначе пользователь будет путаться.
5. Для `assignment_metadata` оставить только advanced fallback.
  &nbsp;
  В основном UX показывать источники:
  ```text
  Физлицо роли
  Доп. поле роли
  Поле пакета
  Статичный текст
  Номер строки
  Пусто
  ```
  `assignment_metadata` — только в раскрытом блоке:
  ```text
  Дополнительно / raw metadata key
  ```
  Желательно только для super_admin.
6. Для `assignment_custom_field` source key выбирать только из schema выбранной роли:
  &nbsp;
  ```text
  role.metadata.assignment_custom_fields[].key
  ```
  Если роль поменяли — список custom fields и warning по orphan-source должны пересчитаться сразу.
7. Orphan-ref policy подтверждаю:
  &nbsp;
  Если custom field удалили из роли, но TR-конфиг ещё ссылается на старый key:
  - конфиг не удалять;
  - save не блокировать;
  - показать warning:
  - E.4 потом даст structured warning/resolution.
8. Для source `role_person` UI должен ограничивать `case` и `format` по типу поля.
  &nbsp;
  Минимально:
  - `case` показывать для:
  - `format` показывать для:
  ```text
  full_name / short_name / signature_short
  birth_date / passport_issued_date / passport_valid_until
  ```
  Для паспорта, email, телефона, bank fields не показывать `case`.
9. Для source `package_field` добавить подсказку:
  &nbsp;
  ```text
  Значение пакетного поля одинаковое для всех строк.
  ```
  Это важно, чтобы не использовать `pf-*` для индивидуальных голосов/долей каждого участника.
10. Для `static_text` также добавить подсказку:

```text
Статичный текст будет одинаковым во всех строках.
```

11. В preview количества строк не обращаться к генератору.

Preview должен считать только active assignments текущей роли:

```text
package_session_id + package_template_item_id + role_catalog_id + is_active=true + person_id IS NOT NULL
```

Если session-context нет — показывать:

```text
Строк будет столько, сколько активных назначений выбранной роли в анкете документа.
```

12. `{{tableRepeat:TR-XXXXXX}}` в каталоге плейсхолдеров можно добавить в E.2, но обязательно как служебный marker.

В hint указать:

```text
Это служебный маркер строки таблицы. Валидация маркера и генерация строк будут подключены на E.3/E.4.
```

Не заявлять, что marker уже полностью валиден для генерации.

13. Если текущий validator до E.3 будет подсвечивать `{{tableRepeat:TR-XXXXXX}}` как invalid, это ожидаемо.

В E.2 proof нужно прямо написать:

```text
Marker copy/config реализован. Validator support для marker — Stage E.3.
```

Не закрывать E.2 как validator PASS.

14. Добавить refresh/cache DoD.

После создания TR-конфига:

- сохранить;
- F5;
- открыть тот же документ;
- `table_repeats[]` восстановились 1-в-1 через `readTableRepeats`;
- marker остался тем же;
- role/columns/source_key сохранились.

15. `nextTableRepeatId` должен искать максимум среди всех существующих `TR-######` текущего item metadata.

Не начинать каждый раз с `TR-000001`, если уже есть удалённые/старые ID. Нужен монотонный next ID в рамках item.

16. При удалении TR-конфига не чистить DOCX-шаблон.

UI должен предупредить:

```text
Конфиг будет удалён, но если маркер уже вставлен в DOCX-шаблон, его нужно удалить из файла вручную.
```

Автоматическое редактирование DOCX out of scope.

17. Валидация перед save:

- duplicate TR id — block save;
- empty role_catalog_id — block save;
- duplicate `cell_index` внутри одного TR — warning или block. Рекомендация: block, чтобы одна колонка не получала два значения.
- negative `cell_index` — block;
- non-integer `cell_index` — block;
- missing `source_key` для role_person / assignment_custom_field / package_field / static_text — block, кроме orphan-ref custom field, где warning.

18. В `packagePlaceholderCatalog.ts` не показывать category «Повторяемые строки», если для текущего item нет `table_repeats[]`.

Если каталог не имеет context текущего template_item, не внедрять глобальные TR-маркеры без context. Сначала проверить архитектуру каталога.

19. Если общий верхний каталог «Документы → Плейсхолдеры» не знает конкретный `template_item`, там нельзя корректно показать `{{tableRepeat:TR-...}}`.

В таком случае:

- показывать TR markers только во вкладке плейсхолдеров внутри конкретного пакета/document item;
- либо добавить явную привязку к выбранному item.

Не показывать чужие TR-маркеры глобально.

20. Proof должен показать, что item-level metadata merge не затронул:

- `document_package_role_catalog.metadata.enable_person_subfields`;
- `document_package_role_catalog.metadata.assignment_custom_fields`;
- `document_package_item_role_assignments.metadata.custom`.

Эти сущности в других таблицах, но важно доказать, что E.2 их не трогал.

21. В proof добавить SQL по самому item metadata до/после с искусственным existing key.

Например до:

```json
{
  "some_existing_key": "keep"
}
```

После:

```json
{
  "some_existing_key": "keep",
  "table_repeats": [...]
}
```

Это докажет merge-only storage.

22. В proof добавить явно:

```text
canonical-document-generate-strict — не изменялся
ai-generate-document-package — не изменялся
package-tokens-dry-run — не изменялся
save_session_document_atomic — не изменялся
migrations — нет
```

23. Не начинать E.3 после E.2 без отдельного отчёта и подтверждения.

После этих уточнений Stage E.2 можно выполнять.

&nbsp;

Stage E.2 — UI/config слой table-repeat

**Prerequisite:** `Stage E.1a — PASS` (`.lovable/proofs/docx_table_repeat_by_role_e1a_custom_fields.md`)

### Scope (только UI/config)

Реализовать UI редактирования повторяемых строк таблиц поверх **уже существующей** SOT-спеки:

- `src/lib/documents/tableRepeatSpec.ts` (frontend)
- `supabase/functions/_shared/table-repeat-spec.ts` (edge mirror)

Хранение: `document_package_template_items.metadata.table_repeats[]` (уже определено в spec, схема не меняется).

### Что делаем

1. **UI-секция «Повторяемые строки таблиц»** в `PackageDocumentCard.tsx` (зона ai-documents/packages, под существующим блоком ролей/полей).
  - Список созданных `TableRepeatConfig` для текущего `template_item`.
  - Кнопка «Добавить повторяемую строку» → создаёт новый `TR-XXXXXX` через `nextTableRepeatId` поверх всех id внутри `metadata.table_repeats`.
  - Карточка конфига: `label` (UI-only), выбор `role_catalog_id` (Select из ролей пакета), редактор колонок, кнопка удаления.
2. **Редактор колонок** (внутри карточки конфига):
  - Список колонок с `cell_index` (0-based, числовой инпут).
  - `source_type` Select из 7 значений spec'а: `role_person`, `assignment_custom_field`, `package_field`, `static_text`, `row_number`, `empty`, `assignment_metadata`.
  - Условные подполя в зависимости от `source_type`:
    - `role_person` → `source_key` (Select sub-field из 25 person sub-fields), опц. `case` (nominative/genitive/dative/accusative/instrumental/prepositional), опц. `format` (short/full/long).
    - `assignment_custom_field` → `source_key` (**Select только из уже созданных** `assignment_custom_fields[].key` выбранной роли; если у роли нет custom fields → disabled + подсказка «Сначала создайте custom field в роли»).
    - `package_field` → `source_key` (Select из `pf-XXXXXX` доступных полей пакета).
    - `static_text` → `source_key` (текстовый инпут — литерал).
    - `row_number` / `empty` → без подполей.
    - `assignment_metadata` → `source_key` (свободный текст, advanced fallback, скрыто за «Дополнительно»).
  - Кнопки «Добавить колонку», «Удалить колонку», drag-reorder опц. (sort через `cell_index`).
3. **Copy marker**: рядом с каждым TR-конфигом — кнопка «Скопировать маркер» → `{{tableRepeat:TR-XXXXXX}}` (для вставки в первую ячейку шаблонной строки DOCX). Также добавить эти маркеры в `packagePlaceholderCatalog.ts` (категория «Повторяемые строки») для drag&drop из общего каталога плейсхолдеров.
4. **Preview количества строк**: рядом с выбранной ролью показать `N = assignments по role_catalog_id в текущей сессии` (если есть session-context) или `N = ?` (без сессии — просто подсказка «строк = число назначений роли»). Источник — уже существующий хук на `document_package_item_role_assignments`. Без обращения к генератору.
5. **Сохранение** через уже существующий atomic-save шаблонных items:
  - Merge только ключа `table_repeats` в `template_items.metadata` (не затирать другие ключи метадаты item'а).
  - Перед save — валидация:
    - все `TR-id` уникальны;
    - `role_catalog_id` выбран;
    - все колонки с `source_type` ∈ {role_person, assignment_custom_field, package_field, static_text} имеют непустой `source_key`;
    - `assignment_custom_field.source_key` существует в `role.assignment_custom_fields[].key` (orphan-ref → warning, не блок: маркер всё равно сохраняется, как и в orphan-policy E.1a).
  - Использовать `readTableRepeats` для round-trip нормализации.
6. **Forward-compat** со spec'ом E.1: ничего не удаляем из `TableRepeatColumn` (case, format, assignment_metadata остаются), просто не показываем advanced поля в UI v1 кроме явного раскрытия «Дополнительно».

### Out of scope (НЕ делаем в E.2)

- DOCX row expansion в `canonical-document-generate-strict` → **E.4**.
- Реальная подстановка значений в строки таблицы → **E.4**.
- Изменения в `ai-generate-document-package`, `package-tokens-dry-run` (резолвер табличных значений) → **E.3**.
- RPC `save_session_document_atomic` не меняем (signature/permissions/RLS остаются).
- Никаких миграций (схема `table_repeats` уже в JSONB metadata).
- Никаких изменений в `assignmentCustomFieldsSpec.ts` / `placeholderClassifier.ts` / резолвере `{{ln-...custom...}}` — они закрыты в E.1a.

### Файлы

- `src/components/ai-documents/packages/PackageDocumentCard.tsx` — встроить секцию «Повторяемые строки таблиц».
- `src/components/ai-documents/packages/TableRepeatsEditor.tsx` *(new)* — основной редактор (список конфигов + редактор колонок).
- `src/components/ai-documents/packages/TableRepeatColumnRow.tsx` *(new)* — отдельный компонент строки колонки с условным рендером по `source_type`.
- `src/hooks/useTemplateItemTableRepeats.ts` *(new)* — read/write `metadata.table_repeats` через существующий atomic-save items, без новых RPC.
- `src/utils/packagePlaceholderCatalog.ts` — добавить категорию «Повторяемые строки» с маркерами `{{tableRepeat:TR-XXXXXX}}` из текущего template_item.
- `src/lib/documents/tableRepeatSpec.ts` — при необходимости добавить чистый helper `validateTableRepeatConfig` (без изменения типов/SOT); mirror в `supabase/functions/_shared/table-repeat-spec.ts`.

### Proof

`.lovable/proofs/docx_table_repeat_by_role_e2_ui_config.md` со следующим:

1. Ссылка на закрытый prerequisite `Stage E.1a — PASS`.
2. Скриншоты/описание UI:
  - создание TR-конфига, выбор роли, добавление 3 колонок (role_person sub-field, assignment_custom_field из E.1a, static_text);
  - copy маркера `{{tableRepeat:TR-000001}}`;
  - preview «строк = N» по роли;
  - попытка выбрать `assignment_custom_field` для роли без custom fields → disabled + подсказка.
3. SQL до/после на тестовом `template_item`:
  ```sql
   SELECT id, metadata->'table_repeats'
   FROM document_package_template_items
   WHERE id = '<item_id>';
  ```
   Показать, что другие ключи `metadata` (`enable_person_subfields` на роли, `assignment_custom_fields`, любые existing item-level ключи) **не затронуты**.
4. Orphan-ref сценарий: удалили `assignment_custom_field` из роли → в TR-конфиге `source_key` остаётся, UI помечает warning, save проходит. dry-run по `{{tableRepeat:TR-...}}` пока не реализован (это E.3).
5. Явное disclaimer'ом в Proof:
  - `canonical-document-generate-strict` НЕ тронут;
  - реальное row expansion в DOCX НЕ реализовано (E.4);
  - резолвер табличных значений в `package-tokens-dry-run` НЕ реализован (E.3);
  - RPC `save_session_document_atomic` signature/permissions не менялись;
  - security linter: новых SECURITY DEFINER не добавлено;
  - миграций нет.
6. Frontend/edge spec parity подтверждён (diff helpers, если добавляли).

### DoD

- UI секции «Повторяемые строки таблиц» работает на странице пакета.
- Можно создать TR-XXXXXX, выбрать роль, сконфигурировать колонки, сохранить, перезагрузить — конфиг возвращается из БД 1-в-1 через `readTableRepeats`.
- `assignment_custom_field` source выбирается только из реально определённых custom fields роли (E.1a).
- Маркер `{{tableRepeat:TR-XXXXXX}}` копируется и доступен в каталоге плейсхолдеров.
- Preview числа строк отображается, когда есть session-context.
- Никаких изменений в генераторе / DOCX-резолвере / RPC / миграциях.
- Proof создан и явно фиксирует, что E.3/E.4 ещё не закрыты.

### Финальный статус

```
Stage E.2 — PASS: table-repeat UI/config layer (no DOCX expansion, no token resolver)
```

После E.2 — отдельный отчёт. Не начинать E.3 до подтверждения.