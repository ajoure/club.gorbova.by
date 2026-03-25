# да, согласен, с учетом правок:

&nbsp;

1. Зафиксируй явно в начале плана: **это proof/design-only PATCH, без любых изменений шаблонов, статусов и runtime-логики**. Результат этого PATCH — только 5 артефактов и список решений на согласование.
2. В разделе про извлечение текста из DOCX не привязывайся жестко к pandoc. Запиши так:
  &nbsp;
  - основной способ: unzip XML / парсинг word/document.xml
  - допустимый вспомогательный способ: pandoc, если доступен
    Чтобы план не зависел от одного инструмента.
  &nbsp;
3. В Артефакте B для каждого внутреннего шаблона добавь отдельный блок:
  &nbsp;
  - current_docx_quality = real_text / mixed / stub
  - approval_blocked_by = none / no_text / legacy_placeholders / missing_registry / unclear_logic
    Это поможет сразу понять, что можно утверждать, а что пока нельзя.
  &nbsp;
4. В Артефакте C добавь еще одно поле:
  &nbsp;
  - decision_for_future_editor = keep / replace_with_canonical / remove / needs_user_decision
    Этого сейчас не хватает для реального перехода к своему редактору.
  &nbsp;
5. В Артефакте C отдельно разделяй:
  &nbsp;
  - found_in_docx
  - available_in_payload
  - available_in_fields_registry
    Потому что это три разные проверки, и их нельзя смешивать в один gap.
  &nbsp;
6. В Артефакте D по склонению добавь отдельную пометку:
  &nbsp;
  - declension_source = auto_library / manual_wording / not_needed
    Это удобнее, чем только can_be_auto_declined.
  &nbsp;
7. В Артефакте E добавь:
  &nbsp;
  - legacy_placeholders_count
  - canonical_placeholders_count
  - missing_in_registry_count
  - loops_count
  - conditional_blocks_count
    Чтобы инвентаризация была не только описательной, но и измеримой.
  &nbsp;
8. В разделе backlog после согласования зафиксируй явно:
  следующий шаг приоритетно — **свой внутренний template editor**, а не просто “или controlled DOCX rewrite flow”.
  То есть последовательность лучше записать так:
  &nbsp;
  - S4-TEMPLATE-DESIGN
  - S4-INTERNAL-TEMPLATE-EDITOR
  - S4-TEMPLATE-APPROVAL-TO-DOCX-MIGRATION
  - S4-DOCX-TO-RUNTIME-PROOF
  &nbsp;
9. Добавь отдельный блок требований к будущему внутреннему редактору, чтобы текущие артефакты собирались уже под него:
  &nbsp;
  - block-based editing
  - token picker с ui_label / storage_token
  - loop block editor
  - conditional block editor
  - versioning
  - preview before save
  - safe draft/published states для шаблонов
  &nbsp;
10. В DoD добавь:

&nbsp;

&nbsp;

&nbsp;

- по каждому из 18 внутренних шаблонов должно быть понятно, **можно ли его переносить в собственный редактор без потери структуры**
- по каждому шаблону должен быть статус: editor_migration_easy / medium / hard

&nbsp;

&nbsp;

&nbsp;

11. Для 4 внешних документов в short card добавь еще:

&nbsp;

&nbsp;

&nbsp;

- should_be_visible_in_package_ui = yes/no
- should_have_user_checklist_item = yes/no
  Это важно для UX пакета, даже если они не генерируются.

&nbsp;

&nbsp;

&nbsp;

12. И отдельно зафиксируй:
  **никакие placeholders, найденные в DOCX, не считаются правильными только потому, что они уже есть в шаблоне**. Правильность определяется только после сверки с canonical payload + registry + согласованием.

&nbsp;

&nbsp;

В таком виде план уже правильный и пригодный для запуска.

&nbsp;

PATCH S4-TEMPLATE-DESIGN — согласование корпоративных DOCX до дальнейшей генерации

## Суть

Остановить proof/activation. Собрать по каждому из 22 документов полную design card на основе **фактически скачанных и прочитанных DOCX-файлов**, кода и manifest-логики. Добавить placeholder gap analysis, матрицу склонений, инвентаризацию DOCX. Только после утверждения пользователем переходить к правкам.

## Жёсткие правила

- Код не меняется. Build step = N/A.
- `runtime_status` не меняется.
- Legacy placeholders в DOCX не становятся новым стандартом → помечаются `legacy_found=yes`, `canonical_replacement_required=yes/no`.
- DOCX layout утверждаем по факту, placeholder standard — только canonical-first.
- `decision.items` и `package.registered_persons` помечаются как `temporary_model / approximation`, не как финальный дизайн.
- `ready_for_runtime = no | partial` по всем 22 документам (никогда `yes`).
- Никакие найденные тексты DOCX не считаются утверждёнными автоматически. Даже если файл существует и использовался в proof — текст проходит ручное согласование.
- Никакой Google Docs / iframe / Drive-интеграции. Редактирование шаблонов будет строиться на собственном editor-flow внутри платформы. Текущий PATCH — только инвентаризация, design cards, placeholder map, матрица склонений.

---

## Артефакты (5 штук)

### Артефакт A: Сводная матрица всех 22 документов

**Файл**: `/mnt/documents/corporate_template_design_matrix.md`

Колонки:

- `code`
- `название`
- `тип` — обязательный / условный / внешний
- `режим` — annual_meeting / sole_participant / оба
- `condition` — условие включения
- `has_loops`
- `exists_in_system` — зарегистрирован в DB
- `docx_present` — файл есть в storage
- `logic_present` — есть в manifest rule engine
- `payload_present` — есть в edge function payload
- `user_approved` — нет (по всем)
- `ready_for_runtime` — no / partial
- `approval_priority` — порядковый номер для пакетного согласования (от простого к сложному)

Для `ext_*`: `generation=no`, `placeholder_map=n/a`, `text_approval=n/a`, `manifest_role=external_only`.

### Артефакт B: Design cards по всем 22 документам

**Файл**: `/mnt/documents/corporate_template_design_cards.md`

**18 внутренних** — полная design card:

1. **Код и название**
2. **Назначение** — 1-2 предложения
3. **Когда включается** — условие из rule engine
4. **Source of truth**:
  - `source_of_truth_for_layout = actual_docx`
  - `source_of_truth_for_logic = manifest/rule_engine`
  - `source_of_truth_for_payload = edge_function`
5. **Фактический текущий текст / skeleton из DOCX** — извлечённый из реального файла:
  - заголовок
  - подзаголовок
  - вводный блок
  - основная часть
  - табличные части
  - подписи
  - приложения / сноски
  - `status = full_text | placeholder_only | empty`
  - `needs_text_approval = true/false`
6. **Фактически найденные placeholders в DOCX** — полный список из реального файла
7. **Ожидаемые placeholders по payload** — из `buildCorporateScalarPayload`, `buildCorporateArrayPayload`, `buildBooleanFlags`
8. **Gap / расхождения**:
  - есть в DOCX, но нет в payload
  - есть в payload, но нет в DOCX
  - есть в DOCX в legacy/ad-hoc виде (`legacy_found=yes`, `canonical_replacement_required=yes/no`)
  - есть loop в DOCX, но нет canonical array source
  - есть conditional block, но нет boolean source
9. **Связь с A/B/C/D/E/F слоями**:
  - A: что из `client_legal_details`
  - B: что из `legal_details_persons`
  - C: что из `legal_details_entity_person_links`
  - D: что из `corporate_draft_sessions` / params
  - E: что computed
  - F: что уходит в snapshot
10. **Табличные данные** (для документов с таблицами):
  - название таблицы, колонки, источник каждой колонки, loop source
    - что заполняется автоматически, что заглушка / approximation
    - `decision.items` → `temporary_model`
    - `package.registered_persons` → `temporary_model`
11. **ФИО и роли** (для каждой роли: председатель, секретарь, директор, участник, представитель, подписант):
  - используется ли просто ФИО / ФИО + роль
    - требуется ли склонение роли
    - требуется ли склонение ФИО
12. **Блок "Что утверждаем"**:
  - название документа
    - сам текст
    - состав блоков
    - список плейсхолдеров
    - что автоматически / что не автоматизируется сейчас
    - открытые вопросы
13. **Editor-readiness**:
  - `editor_ready = yes/no`
    - `can_be_edited_in_internal_template_editor = yes/no`
14. **Future editor mode** — блок для проектирования собственного редактора:
  - `plain_text_blocks` — какие части редактируются как обычный текст
    - `table_blocks` — какие как таблица
    - `loop_blocks` — какие как конструктор loop
    - `conditional_blocks` — какие как conditional toggle

**4 внешних** — отдельные short cards:

- код, название, почему внешний
- участвует ли в manifest (да, как `externally_provided`)
- `generation=no`, `placeholder_map=n/a`, `text_approval=n/a`
- нужны ли ссылки/напоминания в интерфейсе пакета
- нужно ли показывать как "ожидаются от пользователя"
- нужен ли status в будущем editor-flow
- нужен ли дизайн/текст внутри системы

### Артефакт C: Placeholder map

**Файл**: `/mnt/documents/corporate_template_placeholder_map.md`

По каждому из 22 документов:

- `template_code`
- `placeholder`
- `тип` = scalar / array / computed / boolean
- `категория` = `canonical_existing` / `legacy_found` / `missing_in_registry`
- `format_in_docx` = `{{scalar}}` / `{#loop}...{/loop}` / conditional / legacy / plain text placeholder
- `источник слоя` = A / B / C / D / E
- `откуда берётся` = конкретное поле / derived logic
- `обязателен / условный`
- `используется в` = текст / таблица / подпись / шапка
- `есть ли сейчас в DOCX фактически` = yes/no
- `canonical_replacement_needed` = yes/no
- `ui_label` — человекочитаемое имя для будущего редактора
- `storage_token` — canonical token, который реально хранится
- `editor_ready = yes/no`
- `can_be_edited_in_internal_template_editor = yes/no`

Для `ext_*`: перечислены с `generation=no`, `placeholder_map=n/a`, `manifest_role=external_only`.

Категория `missing_in_registry` обязательна: если в DOCX найден placeholder, которого нет в `fields_registry`, он явно вынесен как проблема.

### Артефакт D: Склонение — проектирование + матрица падежей

**Файл**: `/mnt/documents/corporate_template_declension_matrix.md`

**Проектирование**:

- Библиотека: `lvovich` (Deno-совместимая, 0 зависимостей)
- Модуль: `supabase/functions/_shared/russian-declension.ts`
- Обёртки: `declineName(fullName, case)`, `declineCity(city, case)`, `declinePosition(position, case)`, `declineRole(role, case)`

**Объекты склонения**:

- ФИО (genitive, dative, instrumental)
- Города (prepositional)
- Должности (genitive, dative, instrumental, prepositional)
- Роли (председатель, секретарь, ревизор — genitive, dative, instrumental)
- Наименования юрлиц при грамматическом согласовании (где необходимо)

По каждому:

- `can_be_auto_declined = yes/no`
- `requires_manual_template_wording = yes/no`

**Матрица падежей по документам**:


| документ           | поле                  | нужен падеж | обязательно/желательно | есть ли в тексте место | can_be_auto_declined |
| ------------------ | --------------------- | ----------- | ---------------------- | ---------------------- | -------------------- |
| corp_protocol      | chairperson.full_name | genitive    | обязательно            | да                     | yes                  |
| corp_notice        | person.full_name      | dative      | обязательно            | да                     | yes                  |
| corp_order_meeting | director_position     | genitive    | обязательно            | да                     | requires_manual      |
| ...                | ...                   | ...         | ...                    | ...                    | ...                  |


Заполняется по фактическому тексту из DOCX.

### Артефакт E: Инвентаризация DOCX

**Файл**: `/mnt/documents/corporate_template_docx_inventory.md`

По каждому из 18 внутренних:

- `template_code`
- `template_path`
- `db_record_exists`
- `storage_file_exists`
- `docx_download_ok`
- `text_extracted_ok`
- `loops_detected`
- `conditional_blocks_detected`
- `empty_or_stub`
- `docx_has_real_text` — полноценный текст
- `docx_contains_only_stub` — только заглушки/placeholder skeleton
- `docx_contains_mixed_real_and_stub` — частично реальный, частично заглушка

Это основа для design cards — без инвентаризации cards строятся на предположениях.

---

## Как извлекаем текст из DOCX

1. Получить `template_path` для каждого из 18 шаблонов из DB (`document_templates`)
2. Скачать из storage bucket `documents-templates`
3. Извлечь текст через `pandoc` (unpack XML)
4. Зафиксировать: заголовки, тело, таблицы, подписи, `{{...}}` placeholders, `{#...}{/...}` loop-блоки, условные секции
5. Если текст пустой/заглушка → `status=placeholder_only`, `needs_text_approval=true`

---

## Порядок документов (approval_priority)

1. `corp_order_meeting` — эталон стиля (уже работает)
2. `corp_review_list` — простой (уже работает)
3. `corp_notice` — loops: agenda.items
4. `corp_notice_journal` — loops: package.participants
5. `corp_draft_decisions` — loops: agenda.items, decision.items
6. `corp_registration_list` — loops: package.registered_persons
7. `corp_protocol` — самый сложный
8. `corp_notification_decisions` — loops: decision.items
9. `corp_sole_decision` — уже работает
10. `corp_sole_appendices`
11. `corp_ballot`
12. `corp_board_candidates`
13. `corp_board_consent`
14. `corp_auditor_candidates`
15. `corp_auditor_consent`
16. `corp_audit_commission`
17. `corp_charter_amendments`
18. `corp_agenda_change_notice`

19–22. `ext_annual_report`, `ext_balance_sheet`, `ext_audit_report`, `ext_auditor_conclusion`

---

## Итоговый блок: что можно / нельзя утверждать сейчас

**Можно**: структура документа, фактический текущий текст, placeholders, gaps, слои данных, editor-readiness.

**Нельзя**: финальную автоматизацию, runtime correctness, склонение, loops, conditional rendering — до отдельного PATCH после согласования.

---

## Backlog-переход после согласования

Зафиксированная последовательность (три шага, не два):

1. **S4-TEMPLATE-DESIGN** (этот PATCH) — согласование документов
2. **S4-TEMPLATE-APPROVAL-TO-DOCX** — правка DOCX по утверждённым design cards через внутренний template editor или controlled DOCX rewrite flow с canonical placeholders. Включает: правку текста, placeholder corrections, loops/conditional blocks, склонённые placeholders.
3. **S4-DOCX-TO-RUNTIME-PROOF** — proof и runtime activation только после утверждённых и переписанных DOCX.

---

## Файлы проекта


| Файл                                                     | Что делать           |
| -------------------------------------------------------- | -------------------- |
| `/mnt/documents/corporate_template_design_matrix.md`     | Создать — Артефакт A |
| `/mnt/documents/corporate_template_design_cards.md`      | Создать — Артефакт B |
| `/mnt/documents/corporate_template_placeholder_map.md`   | Создать — Артефакт C |
| `/mnt/documents/corporate_template_declension_matrix.md` | Создать — Артефакт D |
| `/mnt/documents/corporate_template_docx_inventory.md`    | Создать — Артефакт E |
| Код проекта                                              | Не меняется          |


## Техническая реализация

1. Запросить DB: `document_templates` WHERE `template_scope='corporate'` — получить все 18 записей с `template_path`
2. Для каждого `template_path` скачать файл из storage `documents-templates`
3. Извлечь текст через pandoc / unpack XML
4. Найти все `{{...}}` и `{#...}{/...}` токены
5. Сопоставить с payload из `buildCorporateScalarPayload` (строки 124-191 edge function), `buildCorporateArrayPayload` (строки 193-261), `buildBooleanFlags` (строки 263-275)
6. Сопоставить с `TEMPLATE_SPECS` из `corporateTemplateSpec.ts`
7. Сопоставить с `fields_registry` (DB) для проверки canonical vs legacy vs missing
8. Собрать все 5 артефактов

---

## DoD

1. Все 18 внутренних DOCX реально скачаны и прочитаны (Артефакт E)
2. По всем 22 документам есть запись в matrix (Артефакт A)
3. По всем 18 внутренним есть полная design card с Gap/расхождения (Артефакт B)
4. По всем 4 внешним есть short card с обоснованием и UX-блоком (Артефакт B)
5. По всем 22 документам есть placeholder coverage (Артефакт C)
6. Ни один legacy placeholder не остался без пометки `legacy_found` / `canonical_replacement_needed`
7. Каждый placeholder, найденный в DOCX, но отсутствующий в `fields_registry`, явно помечен как `missing_in_registry`
8. Собрана матрица полей для склонения — ФИО, города, должности, роли, наименования юрлиц (Артефакт D)
9. По каждому из 18 внутренних шаблонов понятно, что пользователь будет редактировать в собственном редакторе (блок future_editor_mode)
10. По каждому placeholder понятно, как он отображается в UI (`ui_label`) и как хранится (`storage_token`)
11. По каждому legacy placeholder принято решение: оставить временно / заменить на canonical / удалить
12. По всем 22 документам `ready_for_runtime = no | partial` (никогда `yes`)
13. `runtime_status` не менялся
14. Код не менялся → Build step N/A
15. Дальнейший proof остановлен до утверждения пользователем текста и placeholder map
16. Отчёт на русском языке