# да, согласен, с учетом правок:

&nbsp;

1. corp_sole_appendices не считать шаблоном с условием has_appendices. По текущей логике manifest он идёт в ветке sole_participant_decision как включаемый шаблон этой процедуры. Формулировку про возможный блокер has_appendices убрать, иначе это даст ложный критерий proof.
2. В proof chain добавить отдельную обязательную проверку не только signed URL, но и факта, что в ai_generated_documents.template_code записан именно нужный template_code, а не просто создан какой-то документ в batch.
3. Для каждого из 4 сценариев в отчёте фиксировать:
  &nbsp;
  - corporate_draft_session_id
  - generation_batch_id
  - список template_code, реально вошедших в batch
  - какие шаблоны были included, но не попали в generation, если такое случится
  &nbsp;
4. Для сценариев has_board=true и has_auditor=true явно зафиксировать правило proof:
  &nbsp;
  - rules_basis = charter_confirmed
  - confirmed_charter_rules должны быть реально сохранены в session
  - недостаточно только UI-отображения, нужен факт в corporate_draft_sessions
  &nbsp;
5. Для charter_change добавить обязательную проверку, что в session/params вопрос повестки реально имеет requires_charter_change = true, а не только текстово выглядит как изменение устава.
6. В финальном отчёте добавить отдельный итоговый блок:
  &nbsp;
  - 6/6 proven либо
  - точный список, какие из 6 не закрылись и на каком шаге сломались: manifest / pre-flight / render / upload / db_row / signed_url
  &nbsp;
7. В docs/[corporate-templates-rules.md](http://corporate-templates-rules.md) добавить не просто S4-ACTIVE-PROOF Results block, а 2 блока:
  &nbsp;
  - S4-ACTIVE-PROOF execution results
  - remaining blockers / not proven templates, если хоть один кейс не закрыт полностью
  &nbsp;
8. Поскольку патч proof-only, в DoD лучше заменить Build clean на более релевантный критерий:
  &nbsp;
  - код не менялся или если код не менялся — build step N/A
    Иначе получится формальный, но пустой пункт.
  &nbsp;
9. В плане явно зафиксировать: runtime_status в этом патче не меняется, даже если proof неуспешен. Это только proof-сборка и документирование результатов.

&nbsp;

&nbsp;

PATCH S4-ACTIVE-PROOF — confirmed test sessions + proof remaining active templates

## Контекст

Текущее состояние:

- Все 18 DOCX-шаблонов зарегистрированы в DB (`document_templates`, `is_active=true`, `template_path` заполнен)
- Успешно сгенерированы только 2 шаблона: `corp_order_meeting`, `corp_review_list` (annual_meeting + law_default)
- 6 целевых шаблонов уже имеют `runtime_status: 'active'` в обоих файлах, но **без end-to-end proof**
- Существующая сессия: `116c0a66...` (annual_meeting, law_default, status=generated) — использует `legal_details_id = 30347fc5...` (АЖУР инкам), `profile_id = a4b7c8c9...`
- Persons хранятся в `legal_details_persons` без привязки к `legal_details_id` (привязка через `profile_id`)

## Жёсткие правила

- Не менять `corporateTemplateSpec.ts` и `corporate-manifest.ts` — шаблоны уже `active`
- Не создавать новые таблицы/колонки/функции
- Использовать существующий pipeline: session → edge function → storage → DB
- Тест-сессии создаются через UI wizard (confirmed через фронтенд), а не через прямой SQL insert
- Proof = реальный вызов edge function + проверка результатов в DB

## План выполнения

### Step 1. Создать 4 confirmed test sessions через UI

Каждая сессия создаётся через Corporate Wizard в preview, заполняется нужными данными и доводится до статуса `confirmed`.

**Сессия 1: sole_participant_decision**

- procedure_mode = `sole_participant_decision`
- legal_details_id = существующая организация
- 1 участник (единственный)
- Ожидаемые шаблоны: `corp_sole_decision` (always), `corp_sole_appendices` (conditional — нужно включить appendices)

**Сессия 2: annual_meeting + has_board=true**

- procedure_mode = `annual_meeting`
- rules_basis = `charter_confirmed`
- confirmed_charter_rules.has_board = true
- Ожидаемые шаблоны: `corp_board_consent` (+ `corp_board_candidates`, но он `pending_sprint3`)

**Сессия 3: annual_meeting + has_auditor=true**

- procedure_mode = `annual_meeting`
- rules_basis = `charter_confirmed`
- confirmed_charter_rules.has_auditor = true
- Ожидаемые шаблоны: `corp_auditor_candidates`, `corp_auditor_consent`

**Сессия 4: annual_meeting + charter_change**

- procedure_mode = `annual_meeting`
- agenda содержит вопрос с `requires_charter_change = true`
- Ожидаемые шаблоны: `corp_charter_amendments`

### Step 2. Вызвать edge function для каждой сессии

Для каждой confirmed сессии вызвать `ai-generate-corporate-package` через UI (кнопка генерации) или через `supabase.functions.invoke`.

### Step 3. Проверить proof chain по каждому шаблону

По каждому из 6 шаблонов выполнить SQL-проверку:

```text
Proof chain:
1. manifest include    → calculateServerManifest возвращает included=true
2. pre-flight pass     → шаблон не отфильтрован (есть в eligible)
3. render              → DOCX создан без ошибки
4. upload              → файл в storage bucket "documents"
5. ai_generated_documents → строка со status='generated'
6. generation_batch_id → привязка к batch
7. signed URL          → выдан
8. snapshot/meta       → source='corporate_wizard', corporate_draft_session_id, procedure_mode, report_year, resolver_version
```

### Step 4. Собрать финальный отчёт

Таблица:


| template_code           | session_type          | manifest_include | pre-flight | render | upload | db_row | batch_id | signed_url | status_before | status_after       |
| ----------------------- | --------------------- | ---------------- | ---------- | ------ | ------ | ------ | -------- | ---------- | ------------- | ------------------ |
| corp_sole_decision      | sole_participant      | ✓                | ✓          | ✓      | ✓      | ✓      | UUID     | ✓          | active        | active (confirmed) |
| corp_sole_appendices    | sole_participant      | ✓                | ✓          | ✓      | ✓      | ✓      | UUID     | ✓          | active        | active (confirmed) |
| corp_board_consent      | annual+board          | ✓                | ✓          | ✓      | ✓      | ✓      | UUID     | ✓          | active        | active (confirmed) |
| corp_auditor_candidates | annual+auditor        | ✓                | ✓          | ✓      | ✓      | ✓      | UUID     | ✓          | active        | active (confirmed) |
| corp_auditor_consent    | annual+auditor        | ✓                | ✓          | ✓      | ✓      | ✓      | UUID     | ✓          | active        | active (confirmed) |
| corp_charter_amendments | annual+charter_change | ✓                | ✓          | ✓      | ✓      | ✓      | UUID     | ✓          | active        | active (confirmed) |


### Step 5. Обновить docs

В `docs/corporate-templates-rules.md` добавить блок `S4-ACTIVE-PROOF Results` с:

- Proof table по всем 6 шаблонам
- batch_id для каждого сценария
- Дата проведения proof
- Итог: `6/6 templates proven end-to-end`

## Потенциальные блокеры

1. **corp_sole_appendices** — condition `has_appendices`. Нужно убедиться, что wizard позволяет включить appendices, иначе шаблон не попадёт в manifest. Если condition не реализован в UI — это блокер, который нужно задокументировать.
2. **DOCX template files** — все 18 файлов зарегистрированы в DB с `template_path`, но нужно проверить, что физические `.docx` файлы реально существуют в storage bucket `documents-templates`. Если файла нет — pre-flight отфильтрует шаблон.
3. **Wizard flow** — для `charter_confirmed` сценариев нужно пройти шаг подтверждения устава в wizard. Если wizard не позволяет задать `has_board=true` без загрузки устава — нужен manual confirmation через UI.

## Файлы


| Файл                                | Что делать                             |
| ----------------------------------- | -------------------------------------- |
| `docs/corporate-templates-rules.md` | Добавить S4-ACTIVE-PROOF Results block |
| Код не меняется                     | runtime_status уже active — proof-only |


## DoD

1. Созданы 4 confirmed test sessions под 4 сценария
2. Прогнаны все 6 remaining active templates через edge function
3. По каждому шаблону есть полный proof chain (DB rows + batch + signed URL + snapshot)
4. Финальный отчёт с таблицей proof по всем 6 шаблонам
5. Build clean
6. Отчёт на русском языке