# да, согласен, с учетом правок:

&nbsp;

1. **Phase 1 оставить только corp_order_meeting без repeat blocks.**
  Для этого шаблона loops не нужны, поэтому:
  &nbsp;
  - RepeatBlockWrapper.tsx
  - loop-mapper
  - preview для массивов
    перенести в **Phase 2**, а не тащить в первый шаг.
  &nbsp;
2. **Разделить статусы и доступность редактора.**
  Не смешивать в одном поле:
  &nbsp;
  - template_status = draft | approved | in_development
  - отдельный флаг editor_mvp_enabled boolean default false
    Иначе editor_mvp_enabled становится не статусом шаблона, а режимом функции.
  &nbsp;
3. **template_content явно назвать staging-полем и зафиксировать это в схеме/коде.**
  Лучше:
  &nbsp;
  - template_content_jsonb или editor_draft_content
  - комментарий в миграции и в UI:
    staging only, not used by runtime generation
  &nbsp;
4. **В этом PATCH не добавлять passport-поля в fields_registry.**
  Они не нужны для corp_order_meeting и только расширят scope.
  Перенести это в:
  &nbsp;
  - **Phase 2** или
  - отдельный S4-PASSPORT-TOKENS
  &nbsp;
5. **TokenizedRichInput в Phase 1 использовать только для scalar canonical tokens.**
  Для corp_order_meeting этого достаточно:
  &nbsp;
  - организация
  - директор
  - дата/время/место
  - номер документа
    Loop-context mapping пока не нужен.
  &nbsp;
6. **Нужен явный import-flow DOCX → editor draft только для одного шаблона.**
  Зафиксировать порядок:
  &nbsp;
  - берем текущий DOCX из storage
  - извлекаем raw text
  - преобразуем в editor draft
  - сохраняем draft в staging
  - повторное открытие берет staging, а не DOCX
    Но рядом должна быть кнопка:
  - **“Сбросить draft и заново загрузить из DOCX”**
  &nbsp;
7. **Preview разделить на 2 режима, но скачивание оставить только raw preview.**
  &nbsp;
  - raw preview → скачать .txt/.html
  - editor preview → только визуальная проверка
    Не делать скачивание editor-preview.
  &nbsp;
8. **В UI явно показать предупреждение, что редактор не влияет на текущую генерацию.**
  В dialog сверху нужен постоянный banner:
  &nbsp;
  - “Это редактор черновика шаблона. Текущая runtime-генерация использует DOCX из storage.”
  &nbsp;
9. **Кнопку “Редактор” показывать только для editor_mvp_enabled=true.**
  Для остальных 4 будущих документов:
  &nbsp;
  - badge draft
  - кнопка disabled или скрыта
    Не открывать пустой редактор для in_development.
  &nbsp;
10. **DoD Phase 1 уточнить.**
  Phase 1 считается выполненной только если для corp_order_meeting есть:
  &nbsp;
  - открытие из существующего списка шаблонов
  - импорт DOCX в staging-draft
  - отображение [Label]
  - сохранение draft
  - повторное открытие draft
  - reset draft from DOCX
  - raw preview
  - editor preview
  - скачивание raw preview
  - явный banner “staging only”
  - без изменений runtime generation
  &nbsp;
11. **Backlog скорректировать так:**
  &nbsp;
  1. S4-INTERNAL-TEMPLATE-EDITOR Phase 1 — только corp_order_meeting
  2. S4-INTERNAL-TEMPLATE-EDITOR Phase 2 — еще 4 документа
  3. S4-REPEAT-BLOCKS-EDITOR
  4. S4-PASSPORT-TOKENS
  5. S4-EDITOR-DRAFT-TO-DOCX-EXPORT
  6. S4-DOCX-TO-RUNTIME-PROOF
  &nbsp;
12. **В useDocumentTemplates и manager-UI добавить явные поля:**
  &nbsp;
  - template_status
  - editor_mvp_enabled
  - has_editor_draft
    Чтобы в списке было сразу видно:
  - шаблон в разработке
  - редактор доступен
  - есть ли уже сохраненный draft
  &nbsp;

&nbsp;

&nbsp;

Если хочешь, следующим сообщением я соберу тебе уже **чистый финальный copy-paste план для Lovable** без комментариев.

&nbsp;

PATCH S4-INTERNAL-TEMPLATE-EDITOR — Phase 1: corp_order_meeting

## Суть

Proof/design-only editor для одного шаблона `corp_order_meeting`. Без изменений runtime генерации. Editor draft хранится отдельно от DOCX и явно помечен как staging.

## Жёсткие правила

- `template_content` = **editor_draft / staging only**. Runtime генерация берёт DOCX из storage. Editor не влияет на production.
- Runtime edge function **не меняется** (паспортные данные — отдельный будущий PATCH).
- Repeat blocks — упрощённая модель (визуальный контейнер + canonical loop syntax в storage), без TipTap custom Node.
- Phase 1 = только `corp_order_meeting`. Остальные 4 документа — Phase 2 после proof.

## Миграция БД

**Колонки в `document_templates`:**

- `template_status TEXT DEFAULT 'in_development'` — статус шаблона (`draft`, `approved`, `in_development`, `editor_mvp_enabled`)
- `template_content JSONB DEFAULT NULL` — editor draft (staging only, не SoT для runtime)

**UPDATE данные:**

- `corp_order_meeting` → `template_status = 'editor_mvp_enabled'`
- `corp_review_list`, `corp_notice`, `corp_notice_journal`, `corp_sole_decision` → `template_status = 'draft'`
- Все остальные corporate → `template_status = 'in_development'`

**Паспортные поля в `fields_registry**` (INSERT, не миграция):

- `person.passport_number_full` — "Паспорт: серия и номер"
- `person.passport_issued_date` — "Паспорт: дата выдачи"
- `person.passport_issued_by` — "Паспорт: кем выдан"
- `person.personal_number` — "Личный номер"

## Интеграция в существующий UI

Не создавать отдельную страницу. Встроить вход в редактор из существующего `AiDocumentTemplatesManager`:

- Для шаблонов с `template_status = 'editor_mvp_enabled'` добавить кнопку "Редактор" рядом с "Редактировать" / "Скачать"
- Кнопка открывает `CorporateTemplateEditorDialog` — полноэкранный Dialog

## Компоненты


| Файл                                                                | Назначение                                                                          |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/components/corporate-editor/CorporateTemplateEditorDialog.tsx` | Главный полноэкранный dialog с двумя режимами                                       |
| `src/components/corporate-editor/EditorModeView.tsx`                | Режим редактирования: TokenizedRichInput + repeat block wrappers + жёлтая подсветка |
| `src/components/corporate-editor/PreviewModeView.tsx`               | Два sub-режима: raw preview (тестовые данные) + editor preview (подсветка полей)    |
| `src/components/corporate-editor/RepeatBlockWrapper.tsx`            | Визуальный контейнер для loop-блоков (рамка + заголовок)                            |
| `src/lib/corporate/templateEditorMapper.ts`                         | Маппинг storage_token ↔ ui_label, включая loop-поля                                 |
| `src/lib/corporate/templateEditorTestData.ts`                       | Тестовые данные для preview                                                         |
| `src/hooks/useCorporateTemplateEditor.ts`                           | Хук: загрузка DOCX → парсинг → draft → save/load `template_content`                 |


## Маппер токенов (templateEditorMapper.ts)

Scalar:

- `{{legal_details.leg_name}}` → `[Название организации]`
- `{{legal_details.leg_director_name}}` → `[ФИО директора]`
- `{{meeting.date}}` → `[Дата собрания]`

Loop-поля с контекстом:

- `{#package.participants}` → заголовок блока "🔄 Участники"
- внутри: `{full_name}` → `[Участники → ФИО]`
- `{passport_number_full}` → `[Участники → Паспорт]`
- `{share_percent}` → `[Участники → Доля %]`
- `{votes_count}` → `[Участники → Количество голосов]`

Маппер строится поверх существующего `tokenStringToLabel()` из `tokenRegistry.ts` + дополнительный словарь для loop-внутренних полей.

## Repeat blocks — упрощённая модель

Storage: canonical `{#package.participants}...{/package.participants}` syntax.
UI: визуальный div-контейнер с рамкой, иконкой 🔄, заголовком. Внутри — обычный текст с token chips.
Без TipTap custom Node. Просто размеченный HTML-блок, который editor распознаёт при загрузке и оборачивает в `RepeatBlockWrapper`.

## Preview — два режима

1. **Raw preview**: подстановка тестовых данных из `templateEditorTestData.ts` → показ итогового текста. Кнопка "Скачать" → `.txt`.
2. **Editor preview**: подсветка всех мест с плейсхолдерами жёлтым (`bg-amber-100`), repeat blocks — голубым (`bg-blue-50`). Для визуального контроля.

## Ограничения MVP Phase 1

- `corp_notice` / `corp_notice_journal`: repeat block = один общий шаблон на массив, без персональной нарезки "на каждого участника"
- Preview скачивается как `.txt` / `.html`, не как DOCX
- Editor draft не экспортируется обратно в DOCX (отдельный PATCH)

## Backlog (зафиксированная последовательность)

1. **S4-INTERNAL-TEMPLATE-EDITOR Phase 1** (этот PATCH) — editor + draft + preview для `corp_order_meeting`
2. **S4-INTERNAL-TEMPLATE-EDITOR Phase 2** — перенос на 4 документа
3. **S4-EDITOR-DRAFT-TO-DOCX-EXPORT** — controlled export draft → DOCX runtime template
4. **S4-PASSPORT-TO-RUNTIME** — подключение паспортных данных в edge function payload
5. **S4-DOCX-TO-RUNTIME-PROOF** — runtime activation после утверждённых DOCX

## Файлы


| Файл                                                                | Действие                            |
| ------------------------------------------------------------------- | ----------------------------------- |
| Миграция: `template_status` + `template_content`                    | Создать                             |
| INSERT: passport поля в `fields_registry`                           | Создать                             |
| `src/components/corporate-editor/CorporateTemplateEditorDialog.tsx` | Создать                             |
| `src/components/corporate-editor/EditorModeView.tsx`                | Создать                             |
| `src/components/corporate-editor/PreviewModeView.tsx`               | Создать                             |
| `src/components/corporate-editor/RepeatBlockWrapper.tsx`            | Создать                             |
| `src/lib/corporate/templateEditorMapper.ts`                         | Создать                             |
| `src/lib/corporate/templateEditorTestData.ts`                       | Создать                             |
| `src/hooks/useCorporateTemplateEditor.ts`                           | Создать                             |
| `src/components/ai-documents/AiDocumentTemplatesManager.tsx`        | Добавить кнопку "Редактор"          |
| `src/hooks/useDocumentTemplates.tsx`                                | Обновить интерфейс DocumentTemplate |


## DoD Phase 1

1. Для `corp_order_meeting` загрузка DOCX → разбор в editor draft
2. Плейсхолдеры отображаются как `[Label]`, хранятся как `{{canonical.key}}`
3. Loop-поля отображаются как `[Участники → ФИО]`
4. Draft сохраняется в `template_content` (staging only)
5. Повторное открытие восстанавливает draft
6. Raw preview с тестовыми данными
7. Editor preview с подсветкой
8. Скачивание preview
9. Production runtime не затронут
10. `template_content` явно помечен как `editor_draft / staging`