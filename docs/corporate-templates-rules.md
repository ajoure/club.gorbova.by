# Правила применения корпоративных шаблонов — Sprint 3

## Источник данных

- Machine-readable spec: `src/lib/corporate/corporateTemplateSpec.ts`
- Manifest constants: `src/lib/corporate/corporateRuleEngine.ts`
- Server manifest: `supabase/functions/_shared/corporate-manifest.ts`
- Template resolver: `src/lib/corporate/corporateTemplateResolver.ts`
- Resolver pipeline: `src/lib/corporate/useResolverPipeline.ts`
- DOCX-исходники: `assets/corporate-templates/`
- Storage: `documents-templates/templates/corp_*.docx`
- DB: `document_templates` (template_scope = 'corporate')

---

## Архитектура: manifest-driven corporate flow

### Почему НЕ DB packages (`document_package_templates`)

Корпоративные пакеты **не хранятся** в `document_package_templates` по следующим причинам:

1. **Таблица tenant-scoped** — требует `profile_id`, а корпоративные пакеты — системные нормативные комплекты.
2. **Динамический состав** — набор документов зависит от подтверждённых правил устава (`charter_rules`), формы голосования, повестки дня и других параметров сессии. Статический DB package не может это выразить.
3. **Rule engine уже решает эту задачу** — `calculatePackageManifest()` формирует состав пакета на лету.

### Flow (Sprint 3)

```
corporate_wizard (UI)
  → calculatePackageManifest()             # frontend rule engine (preview)
  → resolveManifestTemplates()             # resolver: DB check
  → verifyStorageFiles()                   # storage check
  → validateTemplateAvailability()         # validation (blocking / non-blocking)
  → flushSave session                      # save to DB
  → invoke ai-generate-corporate-package   # edge function
    ↓
  [edge function — server SoT]
  → fetch session (Layer D)
  → calculateServerManifest()              # SERVER-SIDE manifest recalculation
  → serverSidePreFlight()                  # resolve + verify + validate
  → set status='generating' (ONLY after pre-flight OK)
  → batchFetchPersons()                    # Layer B lookup by person_id
  → buildPayload (3 layers: scalar/array/boolean)
  → docxtemplater render per template
  → upload to storage
  → insert ai_generated_documents (with enhanced snapshot)
  → insert/update batch
  → set status='generated' or rollback to 'confirmed'
```

### Server SoT vs Draft JSON

| Артефакт | Назначение | Source of truth? |
|---|---|---|
| `session.package_manifest` (DB JSON) | Draft/debug artifact для UI preview | **НЕТ** — не используется при generation |
| `calculateServerManifest()` (edge function) | Server-side recalculation из params/rules | **ДА** — единственный SoT для generation |
| Frontend `calculatePackageManifest()` | Preview в wizard UI | Только для отображения |

**Правило**: draft session `package_manifest` — это сохранённый снимок для отладки. При generation edge function заново пересчитывает manifest из `corporate_params` + `confirmed_charter_rules` + `procedure_mode`.

### Status flow (state machine)

```text
confirmed → [server pre-flight OK] → generating → generated
                                                ↘ confirmed (rollback on error)
```

- `generating` ставится **только edge function** после успешного pre-flight
- Frontend показывает локальный loading, но НЕ пишет status
- При ошибке generation → откат в `confirmed`, не в `draft`/`preview`
- При 0 eligible templates → session остаётся `confirmed` (generating не ставится)

### Visibility policy: почему corporate templates скрыты из AI-менеджера

Corporate templates используют `template_scope = 'corporate'`, который **intentionally** не видим в generic AI templates UI (`scope = 'ai' | 'both'`).

---

## Слои хранения данных / Source of Truth

| Слой | Таблица / источник | Что хранит | Правило |
|---|---|---|---|
| **A. Карточка юрлица** | `client_legal_details` | Реквизиты, адрес, директор, банк, УНП | Постоянный SoT. Не дублировать в draft session |
| **B. Карточка физлица** | `legal_details_persons` | ФИО, паспорт, контакты | Постоянный SoT. Edge function делает batch lookup по person_id |
| **C. Связь физлицо ↔ юрлицо** | `legal_details_entity_person_links` | Роли, доля, голоса, должность | SoT для ролей и параметров участия |
| **D. Корпоративная процедура** | `corporate_draft_sessions` | procedure_mode, corporate_params (refs + procedural data), charter state, manifest, status | Только процедурный контекст и ссылки на A/B/C |
| **E. Computed / derived** | Runtime (edge function) | settlement_display, boolean flags, decision.items, registered_persons | Вычисляется при генерации |
| **F. Snapshot / история** | `ai_generated_documents` + batches | Что подставилось, из какого слоя, manifest, warnings | Обязательная фиксация |

### Запрет дублирования

В `corporate_draft_sessions.corporate_params` **запрещено** хранить как первичный ввод: реквизиты юрлица, паспортные данные, постоянные контакты. Используются ссылки (`person_id`, `legal_details_id`).

### Person lookup rule

**Единое правило**: `person_id` → lookup из Layer B (`legal_details_persons`), fallback на `name` только если `person_id` отсутствует. Применяется к: chair, secretary, participants, board_candidates, auditor_candidates.

---

## Матрица: manifest constant → DB template → storage file

| Manifest code | DB record | Storage file | Category | Runtime |
|---|---|---|---|---|
| corp_order_meeting | ✅ | templates/corp_order_meeting.docx | system_generated | active |
| corp_notice | ✅ | templates/corp_notice.docx | system_generated | pending_sprint3 |
| corp_notice_journal | ✅ | templates/corp_notice_journal.docx | system_generated | pending_sprint3 |
| corp_review_list | ✅ | templates/corp_review_list.docx | system_generated | active |
| corp_draft_decisions | ✅ | templates/corp_draft_decisions.docx | system_generated | pending_sprint3 |
| corp_registration_list | ✅ | templates/corp_registration_list.docx | system_generated | pending_sprint3 |
| corp_protocol | ✅ | templates/corp_protocol.docx | system_generated | pending_sprint3 |
| corp_notification_decisions | ✅ | templates/corp_notification_decisions.docx | system_generated | pending_sprint3 |
| corp_sole_decision | ✅ | templates/corp_sole_decision.docx | system_generated | active |
| corp_sole_appendices | ✅ | templates/corp_sole_appendices.docx | conditional_generated | active |
| corp_ballot | ✅ | templates/corp_ballot.docx | conditional_generated | pending_sprint3 |
| corp_board_candidates | ✅ | templates/corp_board_candidates.docx | conditional_generated | pending_sprint3 |
| corp_board_consent | ✅ | templates/corp_board_consent.docx | conditional_generated | active |
| corp_auditor_candidates | ✅ | templates/corp_auditor_candidates.docx | conditional_generated | active |
| corp_auditor_consent | ✅ | templates/corp_auditor_consent.docx | conditional_generated | active |
| corp_audit_commission | ✅ | templates/corp_audit_commission.docx | conditional_generated | pending_sprint3 |
| corp_agenda_change_notice | ✅ | templates/corp_agenda_change_notice.docx | conditional_generated | pending_sprint3 |
| corp_charter_amendments | ✅ | templates/corp_charter_amendments.docx | conditional_generated | active |
| ext_annual_report | manifest only | — | externally_provided | — |
| ext_balance_sheet | manifest only | — | externally_provided | — |
| ext_audit_report | manifest only | — | externally_provided | — |
| ext_auditor_conclusion | manifest only | — | externally_provided | — |

---

## Payload builder: 3 слоя, сборка из 6 слоёв хранения

### 1. Canonical scalar fields

Собирается из слоёв A, B, D:
- Из A: `legal_details.leg_name`, `leg_director_name`, `leg_director_position`, `leg_address`, `leg_unp`, `leg_org_form`, `leg_acts_on_basis`
- Из B (batch lookup по person_id): `package.chairperson.full_name`, `package.secretary.full_name`
- Из D: `meeting.date`, `meeting.time`, `meeting.location.full`, `meeting.report_year`

### 2. Canonical array fields (из fields_registry)

| Key | Source | Модель Sprint 3 |
|---|---|---|
| `package.participants` | D.participants + B lookup | Финальная |
| `package.registered_persons` | D.participants filtered | Operational approximation |
| `agenda.items` | D.agenda | Финальная |
| `decision.items` | Derived (E) из D.agenda | Temporary fallback |
| `package.board_candidates` | D.candidates.board + B lookup | Финальная |
| `package.commission_members` | D.candidates.auditor + B lookup | Финальная |

**Canonical key**: `votes_count` в payload (маппинг из internal `vote_count`).

### 3. Computed compatibility fields (слой E)

- `settlement_display` → alias к `entity.settlement_display`, derived из `leg_address`
- Boolean flags: `has_board`, `has_auditor`, `has_audit_commission`, `is_secret_vote`, `has_charter_changes`

### settlement_display

- Шаблон использует `{{settlement_display}}`
- Runtime берёт значение из `entity.leg_address` (derived)
- Новая запись в `fields_registry` **не создаётся**
- Новый token format **не появляется**

---

## Enhanced Snapshot (Layer F)

Каждый `ai_generated_documents` record содержит в `snapshot`:

- `used_scalar_keys` — список непустых scalar keys
- `array_summary` — `{ key: length }` для каждого array (без данных — нет дублирования ПД)
- `boolean_flags` — все boolean flags на момент генерации
- `procedure_mode`, `report_year`
- `refs` — `legal_details_id`, `corporate_draft_session_id`, `chair_person_id`, `secretary_person_id`
- `manifest_snapshot_for_template` — runtime_status/included для данного шаблона
- `resolver_version`

В `meta` batch:
- `source: 'corporate_wizard'`
- `manifest_snapshot` — полный manifest на момент генерации
- `pre_flight_issues`

В `meta` каждого document:
- `source: 'corporate_wizard'`
- `corporate_draft_session_id`
- `procedure_mode`, `report_year`
- `data_source_layers` — откуда данные (A/B/D/E)
- `warnings`, `resolver_version`
- При ошибке: `error_stage` (template_download / storage_upload / signed_url)

---

## Token compatibility (Proof no second token system)

- Не создан новый registry
- Не создан новый placeholder format
- Не появился corporate-only token namespace
- Arrays/loops идут через `fields_registry` + docxtemplater engine + add-only adapter
- Corporate templates совместимы с существующим visual picker

---

## Per-packet scope (Sprint 3)

`corp_notice`, `corp_notification_decisions`, `corp_ballot` — один документ на пакет/сессию.
Per-participant generation — GAP Sprint 4.

---

## Resolver: типы недоступности

| Статус | Описание | Blocking? |
|---|---|---|
| `available` | Шаблон в БД, активен, файл указан, runtime active | — |
| `pending_sprint3` | Шаблон в БД, но требует поддержки loops/arrays | non-blocking |
| `missing_db_record` | Нет записи в document_templates | blocking |
| `inactive_template` | Запись есть, но is_active = false | blocking |
| `missing_template_path` | Запись есть, но template_path пуст | blocking |
| `missing_storage_file` | Путь указан, но файла нет в storage | blocking |
| `not_applicable` | Внешний документ, не генерируется | informational |

---

## runtime_status ≠ template availability

**Это разные сущности, которые нельзя смешивать.**

| Понятие | Что означает | Источник | Когда меняется |
|---|---|---|---|
| `runtime_status` | Доказанная готовность шаблона к runtime-рендеру (render OK, file uploaded, DB record created, generation flow без ошибки) | `corporateTemplateSpec.ts` (primary SoT) + `DEFAULT_RUNTIME_STATUS` в `corporate-manifest.ts` (synchronized fallback) | Только после полного proof-пакета по шаблону |
| `availability` | Доступность шаблона: DB active + template_path + storage file | Проверяется в `serverSidePreFlight()` при каждой генерации | Может меняться в любой момент (удалён файл, деактивирован шаблон) |

**Правила:**
- `runtime_status = 'active'` НЕ означает availability — шаблон может быть active, но файл удалён из storage
- `availability = 'available'` НЕ означает runtime_status active — шаблон может быть доступен, но не прошёл proof
- Для генерации нужны ОБА: `runtime_status === 'active'` AND `availability === 'available'`
- Изменение `runtime_status` с `pending_sprint3` на `active` допускается ТОЛЬКО после proof: render OK → file uploaded → DB record created → download works

### Временное правило синхронизации runtime_status (до появления DB-колонки)

**До добавления `document_templates.runtime_status` колонки в БД** действует следующее жёсткое правило:

1. **Primary SoT**: `src/lib/corporate/corporateTemplateSpec.ts` → `runtime_status` field
2. **Synchronized fallback**: `supabase/functions/_shared/corporate-manifest.ts` → `DEFAULT_RUNTIME_STATUS` map
3. **Правило изменения**: любое изменение статуса шаблона допускается **только одной задачей в двух файлах одновременно**
4. **Запрет**: менять статус в одном файле без синхронного изменения во втором
5. **Верификация**: в финальном отчёте обязателен proof sync без расхождений

### Запрет массового перевода статусов

`pending_sprint3 → active` допускается **только по каждому шаблону отдельно**, после полного proof:
1. render OK
2. upload OK  
3. record in `ai_generated_documents` created
4. download OK
5. UI/history OK

Без всех 5 пунктов статус не менять.

---

## Фильтр генерации (обязательный, runtime)

Шаблон генерируется **только если**:
1. `included = true` (manifest rule engine)
2. `category !== 'externally_provided'`
3. `runtime_status === 'active'` (from DEFAULT_RUNTIME_STATUS or overrides)
4. `availability === 'available'` (server pre-flight: DB active + template_path + storage file)

---

## Терминология

- ✅ «участники» (не «учредители»)
- ✅ «Решение единственного участника» (не «протокол единственного участника»)
- ✅ Подписант в corp_sole_decision — «Единственный участник» (не «Председатель»)

---

## Почему Sprint 3 ещё не закрыт без successful end-to-end generation

Наличие template records + storage files + pre-flight pass **не равно** закрытию Sprint 3.

Для закрытия необходимо:
1. Хотя бы один corporate batch end-to-end (render + upload + DB record + download) — **✅ ВЫПОЛНЕНО 2026-03-25**
2. Error-doc трассировка при upload failure — **✅ ВЫПОЛНЕНО** (batch `fa63000b` содержит raw error proof)
3. Proof manifest 1:1 по 6 кейсам
4. UI-proof history integration
5. Runtime activation matrix по фактическому proof для каждого шаблона

Без этих доказательств спринт открыт, даже если вся архитектура на месте.

---

## GAP на Sprint 4

| Область | Описание |
|---|---|
| Per-participant generation | `corp_notice`, `corp_ballot`, `corp_notification_decisions` — по участнику |
| AI parsing устава | Через существующий token pipeline |
| DOCX preview | В браузере |
| Runtime activation | 9 шаблонов `pending_sprint3` — перевод по поштучному proof |
| Registered persons | Полноценная модель регистрации (расширение `package.registered_persons`) |
| DB column `runtime_status` | Добавить в `document_templates` для хранения SoT runtime_status в БД |

---

## Proof-пакет Sprint 3 (PATCH S3-CLOSE-3)

### Raw upload error proof

**Batch `fa63000b`** (2026-03-25): upload failed с raw error:
```
Upload failed: Invalid key: ai-generated/.../CORP-PKG-260325-034_1_Решение_приказ_о_проведении_...docx
```
**Причина**: `sanitizeFileName()` допускал кириллицу в storage keys, а Supabase Storage требует ASCII-only keys.
**Исправление**: добавлена транслитерация кириллица→ASCII в `_shared/docx-helpers.ts`.
**Результат**: error-doc записи созданы с `error_stage: 'storage_upload'` и raw error message → трассировка не потеряна. ✅

### Proof: End-to-end generation success

**Batch `2222f7ff`** (2026-03-25, после fix):
- `corp_order_meeting`: render OK → upload OK → DB record `7f7940c2` → signed URL OK ✅
- `corp_review_list`: render OK → upload OK → DB record `37a7d8f7` → signed URL OK ✅
- Batch status: `generated` ✅
- Session status: `generated` ✅

### Proof: meta/snapshot содержит обязательные поля

Для каждого документа из batch `2222f7ff`:
- `meta.source = 'corporate_wizard'` ✅
- `meta.corporate_draft_session_id = '116c0a66...'` ✅
- `meta.procedure_mode = 'annual_meeting'` ✅
- `meta.report_year = '2025'` ✅
- `meta.resolver_version = 'sprint3_fix1'` ✅
- `snapshot.procedure_mode`, `snapshot.report_year`, `snapshot.resolver_version` ✅

### Proof: Negative pre-flight guard

**Сценарий 1**: Все eligible templates имеют `runtime_status = 'pending_sprint3'` → 0 eligible → response: `"No eligible templates"`, session остаётся `confirmed`. ✅

**Сценарий 2**: Upload failed → session откатилась в `confirmed`, batch status = `error`, error-doc records созданы с raw error. ✅

### Proof: Draft session не хранит постоянные реквизиты

SQL proof: `corporate_params` не содержит `leg_name`, `leg_address`, `leg_unp`, `passport_*`, `ind_full_name`, `phone`. Содержит: `person_id` ссылки, `agenda`, `chair`, `secretary`, `participants`. Реквизиты берутся из `client_legal_details` по `legal_details_id`. ✅

### Proof: Server manifest vs Frontend preview (manifest parity)

`calculateServerManifest()` (corporate-manifest.ts) и `calculatePackageManifest()` (corporateRuleEngine.ts) используют **идентичные**:
- Шаблонные массивы: `ANNUAL_MEETING_TEMPLATES` (8), `SOLE_PARTICIPANT_TEMPLATES` (2), `CONDITIONAL_TEMPLATES` (8), `EXTERNALLY_PROVIDED_DOCUMENTS` (4)
- Порядок: одинаковый (определяется порядком в массивах)
- Условия включения: `has_board`, `has_auditor`, `has_audit_commission`, `voting_form === 'secret'`, `requires_charter_change`
- `legal_basis` логика: `law_default` по умолчанию, `charter_confirmed` при подтверждённом уставе
- `required_data` маппинг: идентичный `TEMPLATE_REQUIRED_DATA`
- `runtime_status`: resolveRuntimeStatus() с одним и тем же DEFAULT_RUNTIME_STATUS

**Machine-readable proof**: manifest_snapshot сохраняется в `ai_document_generation_batches.meta.manifest_snapshot` при каждой генерации. Для batch `2222f7ff` snapshot содержит 2 eligible шаблона с `runtime_status: 'active'` и `included: true`, что совпадает с frontend preview.

### Proof: No second token system

- ✅ Не создан новый registry
- ✅ Не создан новый placeholder format
- ✅ Нет corporate-only token namespace
- ✅ Arrays/loops через fields_registry + docxtemplater + add-only adapter
- ✅ `votes_count` — canonical key в payload, маппинг из internal `vote_count`

### Runtime activation matrix

| Template | DB active | Storage | runtime_status | End-to-end proof | Download proof |
|---|---|---|---|---|---|
| corp_order_meeting | ✅ | ✅ | **active** | ✅ batch `2222f7ff` | ✅ signed URL works |
| corp_review_list | ✅ | ✅ | **active** | ✅ batch `2222f7ff` | ✅ signed URL works |
| corp_sole_decision | ✅ | ✅ | active | not tested (sole mode) | — |
| corp_sole_appendices | ✅ | ✅ | active | not tested (conditional) | — |
| corp_board_consent | ✅ | ✅ | active | not tested (conditional) | — |
| corp_auditor_candidates | ✅ | ✅ | active | not tested (conditional) | — |
| corp_auditor_consent | ✅ | ✅ | active | not tested (conditional) | — |
| corp_charter_amendments | ✅ | ✅ | active | not tested (conditional) | — |
| corp_notice | ✅ | ✅ | pending_sprint3 | excluded ✅ | — |
| corp_notice_journal | ✅ | ✅ | pending_sprint3 | excluded ✅ | — |
| corp_draft_decisions | ✅ | ✅ | pending_sprint3 | excluded ✅ | — |
| corp_registration_list | ✅ | ✅ | pending_sprint3 | excluded ✅ | — |
| corp_protocol | ✅ | ✅ | pending_sprint3 | excluded ✅ | — |
| corp_notification_decisions | ✅ | ✅ | pending_sprint3 | excluded ✅ | — |
| corp_ballot | ✅ | ✅ | pending_sprint3 | excluded ✅ | — |
| corp_board_candidates | ✅ | ✅ | pending_sprint3 | excluded ✅ | — |
| corp_audit_commission | ✅ | ✅ | pending_sprint3 | excluded ✅ | — |
| corp_agenda_change_notice | ✅ | ✅ | pending_sprint3 | excluded ✅ | — |

---

## Остаточные GAP после S3-CLOSE-3

1. **9 шаблонов остаются `pending_sprint3`** — требуют loop-поддержки и поштучного proof для activation
2. **6 шаблонов `active` не протестированы end-to-end** — sole_decision, board_consent, auditor_candidates, auditor_consent, charter_amendments, sole_appendices (требуют соответствующих сессий)
3. **UI-proof history integration** — batch виден в UI, но полный UI-proof (grouping, download из браузера) требует проверки с учётки пользователя
4. **DB column `runtime_status`** — временное правило sync работает, но полноценный SoT через DB ещё не реализован
5. **Manifest parity machine-readable proof** — snapshot сохраняется в batch.meta, но формальное JSON-сравнение по 6 кейсам ещё не выполнено (требует 6 разных сессий)
