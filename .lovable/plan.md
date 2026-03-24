# да, согласен, с учетом правок:

&nbsp;

1. **Не использовать новое значение template_scope='corporate', пока не доказано, что текущие queries его видят.**
  По аудиту раньше использовались ai / both. Если сейчас фронт и хуки фильтруют только ai/both, то templates с corporate просто не появятся.
  Нужно либо:
  &nbsp;
  - использовать уже поддерживаемый scope,
  - либо add-only сначала расширить фильтры/типизацию под corporate и дать proof.
    Без этого Sprint 2 можно “сделать”, но UI его не увидит.
  &nbsp;
2. **Пакеты document_package_templates нельзя создавать с абстрактным profile_id без доказанной модели владения.**
  Нужно явно зафиксировать:
  &nbsp;
  - это глобальные системные пакеты,
  - или пакеты конкретного профиля/аккаунта.
    Если таблица tenant-scoped, нужен безопасный способ seed/ownership. Иначе потом пакеты не будут видны нужному пользователю.
  &nbsp;
3. **В Sprint 2 не ограничиваться только storage + DB insert. Нужно хранить исходники шаблонов в репозитории как source of truth.**
  Нужен add-only артефакт уровня:
  &nbsp;
  - docs/templates/corporate/... или
  - assets/corporate-templates/...
    Чтобы шаблоны были версионируемы, проверяемы и воспроизводимы, а не существовали только в storage.
  &nbsp;
4. **По каждому шаблону нужен не просто template_notes, а отдельный machine-readable manifest/spec.**
  Для каждого code зафиксировать:
  &nbsp;
  - category
  - always/conditional/external
  - legal_basis
  - required_data
  - conditional_requirements
  - doc_type
  - sort_order_default
    Это лучше сделать отдельным config/spec файлом, а не только markdown-документацией.
  &nbsp;
5. **required_data в corporateRuleEngine.ts не выводить “из placeholders автоматически”, если это недоказуемо.**
  Placeholders и required business data — не одно и то же.
  Нужно разделить:
  &nbsp;
  - технические placeholders в DOCX,
  - бизнес-обязательность данных для применения шаблона.
    Иначе можно получить ложные required fields.
  &nbsp;
6. **В annual_meeting пакете бюллетень (corp_ballot) не должен быть always required без явного условия.**
  Он зависит от выбранной формы голосования/процедуры. Его лучше сразу перевести в conditional_generated, а не в базовое обязательное ядро, если не доказано, что он нужен всегда.
7. **corp_order_meeting нужно назвать нейтральнее на уровне архитектуры.**
  Не “приказ” как единственный вариант, а что-то вроде:
  &nbsp;
  - corp_meeting_convocation_act
  - или оставить текущий code, но в notes явно указать:
    это шаблон-обертка, который может быть решением/приказом/иным актом в зависимости от модели созыва.
    Потому что по уставу и корпоративной структуре это не всегда именно приказ директора.
  &nbsp;
8. **Условные шаблоны по совету директоров / ревизору / комиссии сразу связать с charter_confirmed или manual confirmed rules.**
  Не допускать, чтобы они включались просто по свободному выбору без подтвержденной правовой основы.
9. **Для DOCX-шаблонов сразу зафиксировать, какие из них реально можно подключить в Sprint 2, а какие только подготовить “в storage, но не включать в runtime package”.**
  Особенно для loop-heavy документов:
  &nbsp;
  - журнал извещений,
  - registration list,
  - ballot,
  - protocol,
  - проекты решений.
    Если runtime arrays еще нет, нужно явно разделить:
  - готов к runtime сейчас
  - подготовлен, но activation only after Sprint 3.
  &nbsp;
10. **Нужен отдельный proof по терминологии и naming rules в самих DOCX.**
  Не только в docs и DB metadata, а именно в тексте шаблонов:

&nbsp;

&nbsp;

&nbsp;

- участники, не учредители;
- решение единственного участника, не протокол;
- корректные заголовки видов документов.

&nbsp;

&nbsp;

&nbsp;

11. **externally_provided не должны создаваться как templates, если система их не генерирует.**
  Их нужно держать в manifest/docs/rules, но не обязательно заводить как DOCX-шаблоны в document_templates, если они только учитываются и не формируются системой.
  Это важно, чтобы не размыть границу между “генерируемым” и “внешним”.
12. **В DoD добавить матрицу “manifest constant → DB template → storage file → package item”.**
  Иначе будет сложно доказать, что связка реально полная и без дыр.

&nbsp;

&nbsp;

Если это принять, то Sprint 2 уже можно запускать.

&nbsp;

Sprint 2 — Нормативные шаблоны корпоративных документов + правила применения

## Анализ текущего состояния

**Что уже есть:**

- Manifest constants в `corporateRuleEngine.ts` (строки 41-73): 9 annual_meeting + 2 sole_participant + 7 conditional + 4 externally_provided
- `document_templates` таблица с полями: code, name, document_type, template_path, template_scope, placeholders, template_notes, is_active
- Storage bucket `documents-templates` для DOCX-файлов
- `document_package_templates` + `document_package_template_items` для пакетов
- Token matrix в `docs/token_matrix.md` с 98 токенами
- docxtemplater в edge functions с `{{}}` delimiters и `paragraphLoop: true`

**Что нужно сделать:**
Создать DOCX-файлы → загрузить в storage → вставить записи в `document_templates` → создать 2 пакета в `document_package_templates` → обновить docs

## Объём работ

Sprint 2 состоит из 3 частей:

### Часть A: Генерация DOCX-шаблонов (11 core + 7 conditional = 18 шаблонов)

Каждый DOCX создаётся через `docx-js` (Node.js) с форматированием по `docs/corporate-document-formatting.md`:

- A4, поля 20/20/30/10 мм (1134/1134/1701/567 DXA)
- Times New Roman 14pt
- Абзацный отступ 12.5 мм
- Название вида документа ПРОПИСНЫМИ по центру

**Шаблоны annual_meeting (9):**


| code                          | Вид документа                        | Ключевые токены                                                                                               |
| ----------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `corp_order_meeting`          | РЕШЕНИЕ о проведении собрания        | entity.name, meeting.date, meeting.time, meeting.location.full, agenda.items                                  |
| `corp_notice`                 | ИЗВЕЩЕНИЕ участнику                  | entity.name, meeting.date, person.full_name, agenda.items, meeting.review.*                                   |
| `corp_notice_journal`         | ЖУРНАЛ направления извещений         | entity.name, package.participants (loop), meeting.notice.date                                                 |
| `corp_review_list`            | ПЕРЕЧЕНЬ документов для ознакомления | entity.name, meeting.review.*                                                                                 |
| `corp_draft_decisions`        | ПРОЕКТЫ РЕШЕНИЙ                      | entity.name, agenda.items (loop), decision.items (loop)                                                       |
| `corp_registration_list`      | СПИСОК зарегистрированных лиц        | entity.name, package.registered_persons (loop)                                                                |
| `corp_ballot`                 | БЮЛЛЕТЕНЬ для голосования            | entity.name, person.full_name, agenda.items (loop)                                                            |
| `corp_protocol`               | ПРОТОКОЛ собрания                    | entity.name, meeting.*, agenda.items (loop), package.participants, package.chairperson.*, package.secretary.* |
| `corp_notification_decisions` | УВЕДОМЛЕНИЕ о решениях               | entity.name, person.full_name, decision.items (loop)                                                          |


**Шаблоны sole_participant_decision (2):**


| code                   | Вид документа                                |
| ---------------------- | -------------------------------------------- |
| `corp_sole_decision`   | РЕШЕНИЕ единственного участника              |
| `corp_sole_appendices` | Приложения к решению единственного участника |


**Условные шаблоны (7):**
`corp_board_candidates`, `corp_board_consent`, `corp_auditor_candidates`, `corp_auditor_consent`, `corp_audit_commission`, `corp_agenda_change_notice`, `corp_charter_amendments`

Для loop-полей (agenda.items, package.participants) шаблоны будут использовать docxtemplater loop syntax: `{#agenda.items}...{/agenda.items}`. В текущем Sprint 2 шаблоны **создаются с loop-разметкой**, но полноценная runtime-подстановка массивов — GAP на Sprint 3.

### Часть B: Вставка записей в БД

**18 записей в `document_templates`:**

- `template_scope = 'corporate'`
- `document_type` по виду: 'решение', 'извещение', 'протокол', 'журнал', 'перечень', 'бюллетень', 'уведомление', 'список', 'проекты'
- `template_notes` с описанием назначения и условий применения
- `placeholders` — массив используемых токенов
- `is_active = true`

**2 записи в `document_package_templates**` (нужен profile_id, будет seed-скрипт):

- `annual_meeting` — 9 items
- `sole_participant_decision` — 2 items

**Связки в `document_package_template_items**` с sort_order и is_required.

### Часть C: Документация + маппинг manifest ↔ templates

**Новый файл `docs/corporate-templates-rules.md`:**

- Полная таблица: code → когда включается → когда исключается → legal_basis → required_data → category
- Разделение system_generated / externally_provided / conditional_generated
- GAP на Sprint 3

**Обновление `corporateRuleEngine.ts`:**

- Добавить `required_data` и `missing_data` в manifest builder на основе реальных placeholders шаблонов
- Верифицировать 1:1 mapping manifest codes ↔ DB template codes

## Технический подход

### Генерация DOCX

Скрипт на Node.js через `code--exec` с `docx-js`:

1. Генерировать каждый шаблон с правильным форматированием
2. Встроить `{{placeholder}}` токены в текст
3. Для loop-полей использовать `{#array}...{/array}` синтаксис docxtemplater
4. Сохранить в `/tmp/` → загрузить в storage `documents-templates/templates/corp_*`
5. Валидировать каждый DOCX

### Вставка данных

Через `supabase--insert` tool для записей в `document_templates`.
Пакеты создаются отдельно через тот же инструмент.

## Файлы


| Файл / артефакт                                           | Что                               |
| --------------------------------------------------------- | --------------------------------- |
| 18 DOCX файлов в storage `documents-templates/templates/` | Шаблоны                           |
| `document_templates` (18 INSERT)                          | Записи шаблонов                   |
| `document_package_templates` (2 INSERT)                   | Пакеты                            |
| `document_package_template_items` (11 INSERT)             | Связки                            |
| `docs/corporate-templates-rules.md` (NEW)                 | Правила применения                |
| `src/lib/corporate/corporateRuleEngine.ts`                | Добавить required_data в manifest |


## Что НЕ меняется

- Edge functions
- Corporate wizard UI
- Draft persistence / reopen flow
- Token registry / resolver
- Existing billing/ai templates

## GAP на Sprint 3

- Runtime подстановка массивов (loops) в edge function
- Генерация DOCX из corporate wizard (connect wizard → edge function)
- Conditional sections в docxtemplater (if/else blocks)
- Preview rendered DOCX перед финализацией

## DoD

- 18 DOCX-шаблонов загружены в storage
- 18 записей в document_templates с template_scope='corporate'
- 2 пакета в document_package_templates
- 11 связок в document_package_template_items
- Manifest constants 1:1 с реальными template codes
- docs/corporate-templates-rules.md с полной таблицей правил
- Терминология: участники, решение единственного участника
- externally_provided не заведены как system_generated
- Build clean