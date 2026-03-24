# да, согласен, с учетом правок:

&nbsp;

1. **Этап 3: session status generating должен выставляться в одном месте, а не и на фронте, и в edge function.**
  Чтобы не было гонки состояний, зафиксируйте источник истины:
  &nbsp;
  - фронт делает pre-flight и только вызывает edge function;
  - **edge function** первой операцией ставит status='generating';
  - при успехе generated, при ошибке откат в confirmed.
    На фронте можно показывать локальный loading, но не писать финальный статус раньше сервера.
  &nbsp;
2. **Manifest filter в edge function должен использовать не сохраненный в session availability, а заново проходить resolver pipeline на сервере.**
  Иначе можно получить рассинхрон между Step 5 preview и реальным моментом генерации. На сервере перед генерацией нужно повторно:
  &nbsp;
  - собрать manifest,
  - resolve templates,
  - verify storage,
  - validate availability,
    и только потом генерировать included + active + available.
  &nbsp;
3. **В snapshot/meta не сохранять весь token_data_snapshot без фильтрации, если туда попадут лишние персональные данные.**
  Нужно явно ограничить snapshot:
  &nbsp;
  - сохранять только реально использованный payload по шаблону/пакету;
  - не тащить лишние поля из карточек физлиц и юрлиц, которые в документ не подставлялись.
    Иначе history-слой начнет хранить избыточные данные.
  &nbsp;
4. **Для package.participants и package.registered_persons зафиксируйте, что vote_count и votes_count должны быть приведены к одному стандарту.**
  В разных частях плана уже мелькали оба варианта. Нужно один canonical key внутри item_schema и payload, чтобы не получить тихую несовместимость с DOCX loops.
5. **Для decision.items в плане нужно явно указать источник params.decisions, либо признать, что сейчас это derived only из agenda без отдельного блока редактирования.**
  Сейчас формулировка двусмысленная. Нужен один вариант:
  &nbsp;
  - либо есть corporate_params.decisions[],
  - либо в Sprint 3 используем derived-only модель из agenda и fallback текста.
  &nbsp;
6. **В DoD добавьте proof server-side pre-flight, а не только client-side.**
  Нужно отдельно доказать, что даже если UI отдал устаревшие данные, сервер перед generation:
  &nbsp;
  - заново проверяет templates,
  - заново проверяет storage,
  - не генерирует недоступные шаблоны.
  &nbsp;
7. **В DoD добавьте proof, что draft session не превращается в хранилище постоянных реквизитов.**
  То есть показать, что в corporate_draft_sessions нет дублирования полей из A/B-слоев, а используются ссылки и procedural state.

&nbsp;

&nbsp;

В остальном план уже сильный и пригоден к запуску как финальный Sprint 3.

&nbsp;

Sprint 3 — Runtime DOCX generation из corporate wizard

## Слои хранения данных / Source of Truth (обязательное архитектурное правило)


| Слой                           | Таблица / источник                                          | Что хранит                                                                                                                                            | Правило                                                                                                                                 |
| ------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Карточка юрлица**         | `client_legal_details`                                      | Реквизиты, адрес, директор, банк, УНП, орг-форма                                                                                                      | Постоянный SoT. Не дублировать в draft session                                                                                          |
| **B. Карточка физлица**        | `legal_details_persons`                                     | ФИО, паспорт, контакты, личный номер                                                                                                                  | Постоянный SoT. Не копировать в draft session                                                                                           |
| **C. Связь физлицо ↔ юрлицо**  | `legal_details_entity_person_links`                         | Роли (участник, директор, представитель), доля, голоса, должность, основание полномочий                                                               | SoT для ролей и параметров участия. Председатель/секретарь — это роль в контексте процедуры, а не свойство человека                     |
| **D. Корпоративная процедура** | `corporate_draft_sessions`                                  | `procedure_mode`, `corporate_params` (agenda, meeting details, candidates, chair/secretary refs), charter state, manifest, warnings, status           | Хранит только процедурный контекст и ссылки на A/B/C. НЕ хранит реквизиты юрлица, паспорт, постоянные контакты, доли как первичный ввод |
| **E. Computed / derived**      | Runtime (edge function)                                     | `settlement_display`, boolean flags (`has_board`, etc.), `decision.items` (derived from agenda), `package.registered_persons` (filtered participants) | Вычисляется при генерации. Не сохраняется как SoT                                                                                       |
| **F. Snapshot / история**      | `ai_generated_documents` + `ai_document_generation_batches` | Что реально подставилось, из какого слоя, какие warnings, procedure_mode, manifest version, runtime_status                                            | Обязательная фиксация при каждой генерации                                                                                              |


### Запрет дублирования постоянных реквизитов в draft session

В `corporate_draft_sessions.corporate_params` **запрещено** хранить как первичный ввод:

- Реквизиты юрлица (название, адрес, УНП) — берутся из слоя A
- Паспортные данные — берутся из слоя B
- Постоянные контактные данные — берутся из слоя B
- Доли/голоса как "вечные" данные — берутся из слоя C

В draft session хранятся только: ссылки на сущности (`person_id`, `entity_id`, `legal_details_id`), процедурные массивы (agenda, participants list с attendance), charter/rule state, confirmed values на момент подготовки.

### Слой C — основной источник ролей

Директор, участник, представитель — это связи из `legal_details_entity_person_links`, а не свойства `legal_details_persons`. Председатель/секретарь — процедурные роли, хранятся в `corporate_params` как `person_id` ссылки.

### Таблица "что где живёт"


| Поле / группа      | SoT                                   | Где редактируется         | Как попадает в draft                                                   | Как попадает в payload                                        | Snapshot |
| ------------------ | ------------------------------------- | ------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------- | -------- |
| Название юрлица    | A: `client_legal_details.leg_name`    | Карточка реквизитов       | По `legal_details_id` ссылке                                           | Fetch из A → scalar `legal_details.leg_name`                  | Да       |
| Адрес юрлица       | A: `client_legal_details.leg_address` | Карточка реквизитов       | По ссылке                                                              | Fetch из A → scalar + derived `settlement_display`            | Да       |
| Паспорт физлица    | B: `legal_details_persons`            | Карточка физлица          | Не попадает                                                            | Не используется в corporate DOCX                              | Нет      |
| Доля / голоса      | C: `entity_person_links`              | Карточка связи            | `participants[]` содержит `person_id` + `share_percent` + `vote_count` | Из D.participants → array `package.participants`              | Да       |
| Председатель       | D: `corporate_params.chair`           | Step 3 wizard             | `chair.person_id` ссылка                                               | Fetch B по person_id → scalar `package.chairperson.full_name` | Да       |
| Секретарь          | D: `corporate_params.secretary`       | Step 3 wizard             | `secretary.person_id` ссылка                                           | Fetch B по person_id → scalar `package.secretary.full_name`   | Да       |
| Представитель      | D: `participants[].representative`    | Step 3 wizard             | Inline в participant entry                                             | → array field в `package.participants`                        | Да       |
| Agenda             | D: `corporate_params.agenda[]`        | Step 3 wizard             | Прямой ввод                                                            | → array `agenda.items`                                        | Да       |
| Decision items     | E: derived                            | Не редактируется отдельно | Derived из agenda                                                      | → array `decision.items` (fallback "Решение не принято")      | Да       |
| Registered persons | E: derived                            | Не редактируется отдельно | Filtered из participants                                               | → array `package.registered_persons` (attendance filter)      | Да       |


---

## Архитектурные constraints

1. НЕ создавать новый token engine / registry / placeholder format
2. Canonical keys из `fields_registry` — единственный SoT для токенов
3. Payload builder собирает данные из слоёв A/B/C/D, вычисляет E, фиксирует в F — не заменяет SoT
4. `settlement_display` — compatibility alias к `entity.settlement_display`, не новая запись в registry
5. Edge function — adapter поверх существующего паттерна; reuse helpers из `_shared/`
6. Запрет на hardcoded fallback arrays вне registry
7. Runtime status `pending_sprint3 → active` — только по поштучному proof
8. Generation scope Sprint 3: один документ на пакет/сессию, не per-participant
9. Step 5 использует reusable resolver pipeline (не дублирует Step 4)
10. Фильтр генерации: `included=true` + `runtime_status=active` + `availability=available` + `category !== 'externally_provided'`

---

## Этапы

### Этап 0. Gate — proof по fields_registry (STOP-gate)

До написания edge function:

1. Запросить все `data_type='array'` из `fields_registry`
2. Подтвердить 4 существующих: `package.participants`, `package.registered_persons`, `agenda.items`, `decision.items`
3. Добавить 2 недостающих миграцией: `package.board_candidates`, `package.commission_members`
4. Proof: корректные `public_id`, видны в picker в контексте `documents:annual_meeting`, label на русском, вставляется canonical placeholder
5. **Без этого proof — нельзя переходить к Этапу 2**

### Этап 1. Миграция

```sql
-- 1. board_candidates
INSERT INTO fields_registry (entity_type, key, label, data_type, display_order, options)
VALUES ('package', 'package.board_candidates', 'Кандидаты в совет директоров', 'array', 50,
  '{"source_strategy":"loop","item_schema":[
    {"key":"full_name","type":"text","label":"ФИО кандидата","required":true},
    {"key":"info","type":"text","label":"Сведения о кандидате","required":false}
  ]}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 2. commission_members
INSERT INTO fields_registry (entity_type, key, label, data_type, display_order, options)
VALUES ('package', 'package.commission_members', 'Члены ревизионной комиссии', 'array', 51,
  '{"source_strategy":"loop","item_schema":[
    {"key":"full_name","type":"text","label":"ФИО члена комиссии","required":true},
    {"key":"info","type":"text","label":"Сведения","required":false}
  ]}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 3. Link batches to corporate sessions
ALTER TABLE public.ai_document_generation_batches
  ADD COLUMN IF NOT EXISTS corporate_draft_session_id uuid
  REFERENCES public.corporate_draft_sessions(id) ON DELETE SET NULL;
```

### Этап 2. Shared helpers → `_shared/docx-helpers.ts`

Вынести из `ai-generate-document-package/index.ts` (строки 14-57, 192-194):

- `dateToRussianFormat()`, `fullNameToInitials()`, `generateDocumentNumber()`, `sanitizeFileName()`, `buildAddress()`, `entityName()`

В `ai-generate-document-package/index.ts` заменить inline копии на import (если безболезненно — тестируется, если нет — оставить). Новая function импортирует из `_shared/`. Остальные 4 edge functions НЕ трогать.

### Этап 3. Edge function adapter `ai-generate-corporate-package`

Новый файл: `supabase/functions/ai-generate-corporate-package/index.ts`

**Reuse из существующего pipeline:**

- `corsHeaders` (тот же паттерн)
- Auth + profile resolution (тот же паттерн)
- Helpers из `_shared/docx-helpers.ts`
- docxtemplater + PizZip init (`delimiters: {{/}}`, `paragraphLoop: true`)
- Storage download из `documents-templates`
- Upload → `documents/ai-generated/`
- Insert → `ai_generated_documents`
- Batch → `ai_document_generation_batches` (+ `corporate_draft_session_id`)

**Новый код (add-only adapter):**

- Input: `{ corporate_draft_session_id: string }`
- Fetch session (D), verify `profile_id`
- Fetch entity (A) по `legal_details_id`
- Manifest filter: `included=true` + `category !== 'externally_provided'` + `runtime_status === 'active'` + `availability === 'available'`
- Template lookup: по `code` + `template_scope='corporate'`

**Payload builder — 3 слоя, сборка из 6 слоёв хранения:**

1. **Canonical scalar fields** — собирается из слоёв A, B, C, D:
  - Из A: `legal_details.leg_name`, `legal_details.leg_director_name`, `legal_details.leg_director_position`, `legal_details.leg_address`, `legal_details.leg_unp`, `legal_details.leg_org_form`, `legal_details.leg_acts_on_basis`
  - Из B (по person_id ссылкам из D): `person.full_name`, `person.initials`
  - Из D: `meeting.date`, `meeting.time`, `meeting.location.full`, `meeting.report_year`, `package.chairperson.full_name`, `package.secretary.full_name`, `document.date`, `document.number`
2. **Canonical array fields** (canonical keys из `fields_registry`, как массивы в `doc.render()`):


| Key                          | Source layers                                     | Fallback                                             | Модель Sprint 3                        |
| ---------------------------- | ------------------------------------------------- | ---------------------------------------------------- | -------------------------------------- |
| `package.participants`       | D.participants + B (name fetch)                   | Пустой массив                                        | Финальная                              |
| `package.registered_persons` | D.participants filtered `attendance !== 'absent'` | `registration_time` = `meeting.time` если не указано | **Operational approximation Sprint 3** |
| `agenda.items`               | D.agenda                                          | `description` = ""                                   | Финальная                              |
| `decision.items`             | **Derived** (E): из D.agenda + D.decisions        | `decision_text` = "Решение не принято"               | **Temporary fallback Sprint 3**        |
| `package.board_candidates`   | D.candidates.board                                | `info` = ""                                          | Финальная                              |
| `package.commission_members` | D.candidates.auditor                              | `info` = ""                                          | Финальная                              |


**Запрет:** если для массива нет canonical key в `fields_registry`, он НЕ передаётся.

3. **Computed compatibility fields** (слой E, не новые токены):
  - `settlement_display` → alias к `entity.settlement_display`, derived из `leg_address`
  - Boolean flags: `has_board`, `has_auditor`, `has_audit_commission`, `is_secret_vote`, `has_charter_changes`

**Snapshot (слой F) — обязательный при каждой генерации:**
В `meta` batch/documents фиксировать:

- `source: 'corporate_wizard'`
- `corporate_draft_session_id`
- `procedure_mode`, `report_year`
- `manifest_snapshot` — какие templates были в manifest с какими runtime_status
- `token_data_snapshot` — финальный payload (что реально подставилось)
- `data_source_layers` — из каких слоёв (A/B/C/D) данные пришли
- `warnings` — какие warnings/non-blocking issues действовали
- `resolver_version` — для воспроизводимости

**Session status flow (state machine):**

```text
confirmed → generating → generated
                      ↘ confirmed (откат при ошибке)
```

- `generating` ставится **только после** успешного pre-flight
- При ошибке → откат в `confirmed`, не в `draft`/`preview`

**Per-packet scope (явное ограничение Sprint 3):**
`corp_notice`, `corp_notification_decisions`, `corp_ballot` — один документ на пакет/сессию. Per-participant — GAP Sprint 4.

### Этап 4. Reusable resolver pipeline

Вынести resolver pipeline из Step 4 в общий reusable helper:

```text
resolveManifestTemplates → verifyStorageFiles → validateTemplateAvailability
```

Step 4 и Step 5 оба используют этот helper без дублирования кода.

### Этап 5. Frontend — hook + Step 5

**Новый файл:** `src/hooks/useCorporatePackageGeneration.ts`

**Обновить:** `src/components/corporate/CorporateStep5Confirm.tsx`

- Подключить reusable resolver pipeline
- **Pre-flight summary**: сколько будет сгенерировано (included + active + available), сколько excluded, сколько pending, blocking issues
- Кнопка «Подтвердить и сформировать»
- **Строгий порядок при нажатии:**
  1. `flushSave(sessionId)`
  2. Заново прочитать актуальную session
  3. Заново собрать manifest
  4. `resolveManifestTemplates(manifest)`
  5. `verifyStorageFiles(items)`
  6. `validateTemplateAvailability(result)`
  7. Если blocking issues → stop, показать ошибку
  8. Только потом `status = 'generating'`
  9. Invoke edge function
- Удалить заглушку "Sprint 2"
- Показать результаты: download links

**Обновить:** `src/components/corporate/CorporateWizard.tsx`

- Status `generating` → блокировка навигации
- Status `generated` → показ результатов

### Этап 6. Runtime status transition (поштучный proof)

Каждый из 10 `pending_sprint3` переводится в `active` **только после** фактического proof:


| Template                    | Loop/section                               | Status      |
| --------------------------- | ------------------------------------------ | ----------- |
| corp_notice                 | agenda.items                               | pending → ? |
| corp_notice_journal         | package.participants                       | pending → ? |
| corp_draft_decisions        | agenda.items, decision.items               | pending → ? |
| corp_registration_list      | package.registered_persons                 | pending → ? |
| corp_protocol               | agenda.items, participants, decision.items | pending → ? |
| corp_notification_decisions | decision.items                             | pending → ? |
| corp_ballot                 | agenda.items                               | pending → ? |
| corp_board_candidates       | package.board_candidates                   | pending → ? |
| corp_audit_commission       | package.commission_members                 | pending → ? |
| corp_agenda_change_notice   | agenda.items                               | pending → ? |


### Этап 7. Документация

Обновить `docs/corporate-templates-rules.md`:

- Generation flow с указанием слоёв хранения
- Source of truth таблица (6 слоёв)
- Token compatibility: canonical keys only
- Per-packet scope для Sprint 3
- settlement_display: compatibility alias
- decision.items / package.registered_persons: temporary Sprint 3 models
- Раздел "Proof no second token system"

Обновить `supabase/functions.registry.txt` — добавить `ai-generate-corporate-package` (файл реально является реестром, строки 1-4 подтверждают).

---

## Файлы


| Файл                                                              | Что                                            |
| ----------------------------------------------------------------- | ---------------------------------------------- |
| `supabase/functions/_shared/docx-helpers.ts` (NEW)                | Shared helpers                                 |
| `supabase/functions/ai-generate-corporate-package/index.ts` (NEW) | Edge function adapter                          |
| `supabase/functions/ai-generate-document-package/index.ts`        | Import helpers из _shared (если безболезненно) |
| `src/lib/corporate/useResolverPipeline.ts` (NEW)                  | Reusable resolver pipeline                     |
| `src/hooks/useCorporatePackageGeneration.ts` (NEW)                | Frontend hook                                  |
| `src/components/corporate/CorporateStep5Confirm.tsx`              | Pre-flight + generation + results              |
| `src/components/corporate/CorporateStep4Preview.tsx`              | Использовать reusable pipeline                 |
| `src/components/corporate/CorporateWizard.tsx`                    | Status generating/generated                    |
| `src/lib/corporate/corporateTemplateSpec.ts`                      | pending → active по proof                      |
| `docs/corporate-templates-rules.md`                               | SoT + generation flow + token proof            |
| `supabase/functions.registry.txt`                                 | Add ai-generate-corporate-package              |
| DB migration                                                      | 2 array tokens + corporate_draft_session_id    |


## Что НЕ делается

- Новый token engine / registry / placeholder format
- Hardcoded corporate-only array keys вне registry
- Дублирование реквизитов юрлица/физлица в draft session
- Per-participant generation (GAP Sprint 4)
- AI parsing устава
- DOCX preview в браузере
- Рефакторинг helpers в остальных 4 edge functions

## DoD

1. **Proof fields_registry**: 6 array tokens (4+2), корректные public_id, видны в picker, canonical placeholder
2. **Proof end-to-end arrays** (полный путь для `agenda.items`, `package.participants`, `decision.items`): fields_registry → picker → canonical placeholder → payload → docxtemplater render → generated DOCX
3. **Proof generation из wizard**: Step 5 → pre-flight → invoke → files в storage + records в `ai_generated_documents` + batch
4. **Proof loops** для всех 6 canonical array keys
5. **Proof conditional sections**: `has_board`, `has_auditor`, etc.
6. **Proof settlement_display**: template `{{settlement_display}}`, runtime берёт из `entity.settlement_display`, новая запись в registry не создана, новый token format не появился
7. **Proof no second token system**: нет нового registry, нет нового placeholder format, нет hardcoded corporate-only namespace, arrays через fields_registry + docxtemplater + adapter
8. **Proof visual picker совместимость**: array fields видны, label на русском, canonical placeholder
9. **Proof history integration (UI-факт)**: corporate batch во вкладке «История», grouping не сломан, документы скачиваются, meta содержит `source='corporate_wizard'` и `corporate_draft_session_id`
10. **Proof snapshot**: в batch/document meta зафиксировано что подставилось, из какого слоя, какие warnings, какой procedure_mode, manifest version
11. **Proof поштучный runtime status**: матрица template → loop → render → storage file → DB record → итоговый status
12. **Shared helpers**: `_shared/docx-helpers.ts` создан и используется
13. Build clean

## Proof no second token system (обязательный раздел финального отчёта)

В отчёте Sprint 3 должно быть доказано:

- Не создан новый registry
- Не создан новый placeholder format
- Не появился corporate-only token namespace вне существующих правил `fields_registry`
- Arrays/loops идут через `fields_registry` + текущий docxtemplater engine + add-only adapter
- Corporate templates совместимы с существующим visual picker

## GAP на Sprint 4

- **Per-participant DOCX generation** (`corp_notice`, `corp_ballot`, `corp_notification_decisions` — Sprint 3 = только один документ на пакет, без per-participant split)
- AI parsing устава через существующий token pipeline (`fields_registry` + canonical keys), не через отдельный AI-слой
- DOCX preview в браузере (отдельный нефункциональный блок)
- Полноценная модель регистрации участников (расширение `package.registered_persons`)