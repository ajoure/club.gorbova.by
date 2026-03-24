# Правила применения корпоративных шаблонов — Sprint 2

## Источник данных

- Machine-readable spec: `src/lib/corporate/corporateTemplateSpec.ts`
- Manifest constants: `src/lib/corporate/corporateRuleEngine.ts`
- Template resolver: `src/lib/corporate/corporateTemplateResolver.ts`
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

### Flow

```
corporate_wizard (UI)
  → calculatePackageManifest()     # rule engine формирует manifest
  → resolveManifestTemplates()     # resolver проверяет DB (record, is_active, template_path)
  → verifyStorageFiles()           # проверяет фактическое наличие файлов в storage bucket
  → validateTemplateAvailability() # validation layer (blocking / non-blocking / informational)
  → edge function (Sprint 3)      # генерация DOCX
```

> **Примечание:** `verifyStorageFiles()` использует `supabase.storage.list('templates')` для preview-time проверки.
> При значительном росте числа шаблонов может потребоваться более точная проверка по конкретным путям.

### Visibility policy: почему corporate templates скрыты из AI-менеджера

Corporate templates используют `template_scope = 'corporate'`, который **intentionally** не видим в generic AI templates UI (`scope = 'ai' | 'both'`).

Причины:
- Корпоративные шаблоны — системные нормативные документы, не пользовательские универсальные.
- Редактирование и использование идёт исключительно через corporate wizard, не через generic AI documents flow.
- Шаблоны содержат специфичную loop/conditional разметку для docxtemplater, не предназначенную для ручного редактирования.

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

## Правила включения шаблонов

### Annual Meeting (8 core + conditional)

| code | Когда включается | Когда исключается | legal_basis | Условие |
|---|---|---|---|---|
| corp_order_meeting | Всегда для annual_meeting | — | law_default | — |
| corp_notice | Всегда для annual_meeting | — | law_default | — |
| corp_notice_journal | Всегда для annual_meeting | — | law_default | — |
| corp_review_list | Всегда для annual_meeting | — | law_default | — |
| corp_draft_decisions | Всегда для annual_meeting | — | law_default | — |
| corp_registration_list | Всегда для annual_meeting | — | law_default | — |
| corp_protocol | Всегда для annual_meeting | — | law_default | — |
| corp_notification_decisions | Всегда для annual_meeting | — | law_default | — |
| corp_ballot | Тайное голосование или устав | Открытое голосование без требования устава | charter_confirmed | voting_form_secret_or_charter |
| corp_board_candidates | Совет директоров по уставу | Устав не подтверждён или совет не предусмотрен | charter_confirmed | has_board |
| corp_board_consent | Совет директоров по уставу | Устав не подтверждён или совет не предусмотрен | charter_confirmed | has_board |
| corp_auditor_candidates | Ревизор по уставу | Устав не подтверждён или ревизор не предусмотрен | charter_confirmed | has_auditor |
| corp_auditor_consent | Ревизор по уставу | Устав не подтверждён или ревизор не предусмотрен | charter_confirmed | has_auditor |
| corp_audit_commission | Рев. комиссия по уставу | Устав не подтверждён или комиссия не предусмотрена | charter_confirmed | has_audit_commission |
| corp_agenda_change_notice | Повестка изменена после извещения | — | user_selected | agenda_changed |
| corp_charter_amendments | В повестке — изменение устава | — | user_selected | agenda_has_charter_change |

### Sole Participant Decision (1 core + 1 conditional)

| code | Когда включается | legal_basis |
|---|---|---|
| corp_sole_decision | Всегда для sole_participant | law_default |
| corp_sole_appendices | При наличии приложений | user_selected |

### Externally Provided (manifest only, NO templates)

| code | Когда учитывается | Примечание |
|---|---|---|
| ext_annual_report | Всегда | Готовится руководством |
| ext_balance_sheet | Всегда | Готовится бухгалтерией |
| ext_audit_report | Всегда | Готовится аудитором |
| ext_auditor_conclusion | При наличии ревизора/комиссии | Условный внешний документ |

---

## Терминология (proof)

- ✅ «участники» (не «учредители») — во всех шаблонах
- ✅ «Решение единственного участника» (не «протокол единственного участника»)
- ✅ Подписант в corp_sole_decision — «Единственный участник» (не «Председатель»)
- ✅ Вид документа прописными: РЕШЕНИЕ, ПРОТОКОЛ, ИЗВЕЩЕНИЕ, ЖУРНАЛ, ПЕРЕЧЕНЬ, БЮЛЛЕТЕНЬ, УВЕДОМЛЕНИЕ, СВЕДЕНИЯ, СОГЛАСИЕ

---

## Resolver: типы недоступности

| Статус | Описание | Blocking? |
|---|---|---|
| `available` | Шаблон в БД, активен, файл указан, runtime active | — |
| `pending_sprint3` | Шаблон в БД, но требует поддержки loops/arrays | non-blocking |
| `missing_db_record` | Нет записи в document_templates | blocking (если active + included) |
| `inactive_template` | Запись есть, но is_active = false | blocking (если active + included) |
| `missing_template_path` | Запись есть, но template_path пуст | blocking (если active + included) |
| `missing_storage_file` | Путь указан, но файла нет в storage | blocking (если active + included) |
| `not_applicable` | Внешний документ, не генерируется | informational |

---

## Пакеты (ownership model)

Корпоративные пакеты НЕ хранятся в `document_package_templates` (таблица tenant-scoped, требует profile_id).

Состав пакета определяется динамически через `corporateRuleEngine.ts → calculatePackageManifest()` на основе:
- procedure_mode (annual_meeting / sole_participant_decision)
- charter_rules (confirmed / law_default)
- corporate_params (agenda, voting_form, etc.)

Это архитектурно корректнее, чем статический пакет, т.к. состав зависит от подтверждённых правил устава.

---

## GAP на Sprint 3

| Область | Описание |
|---|---|
| Runtime loops | Подстановка массивов (agenda.items, participants) в edge function |
| Conditional sections | if/else блоки в docxtemplater |
| Preview | Предпросмотр сгенерированного DOCX |
| Wizard → Edge Function | Передача параметров сессии в генератор |
| Activation | 9 шаблонов помечены `pending_sprint3` — требуют array support |
| Storage verification | `verifyStorageFiles()` — глубокая проверка при генерации |
