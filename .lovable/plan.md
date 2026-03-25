# да, согласен, с учетом правок:

&nbsp;

1. **Исправить формулировку Этапа 1 про runtime_status.**
  Нельзя подменять runtime_status данными из document_[templates.is](http://templates.is)_active и template_path.
  Это разные сущности:
  &nbsp;
  - runtime_status = доказанная готовность шаблона к runtime-рендеру,
  - is_active/template_path/storage = доступность шаблона.
    Поэтому в патче нужно требовать **единый SoT для runtime_status**, а не выводить его из БД-доступности.
  &nbsp;
2. **Лучшее решение по sync:**
  не “документировать ручную синхронизацию”, а вынести runtime-status spec в **один shared source**, который используют и frontend, и server.
  То есть:
  &nbsp;
  - либо общий shared-модуль вне src/ и вне UI-слоя,
  - либо generated artifact/json, читаемый обоими слоями.
    Ручная двойная поддержка corporateTemplateSpec.ts + RUNTIME_STATUS_MAP — слабое место, это надо убрать.
  &nbsp;
3. **В Proof 2.1 сравнивать не только included/excluded, но и:**
  &nbsp;
  - legal_basis,
  - required_data,
  - runtime_status,
  - порядок документов.
    Иначе proof будет неполным.
  &nbsp;
4. **В Negative pre-flight proof нужен минимум 2 сценария, а не один:**
  &nbsp;
  - 0 eligible templates,
  - missing storage file или inactive template.
    В обоих случаях отдельно подтвердить:
  - generation не запускается,
  - batch не становится generated,
  - session остаётся/возвращается в confirmed.
  &nbsp;
5. **В History proof добавить именно UI-факт grouped batch, а не только SQL.**
  Нужен пруф:
  &nbsp;
  - batch виден в истории,
  - раскрывается,
  - документы скачиваются,
  - grouping по generation_batch_id не ломается.
  &nbsp;
6. **В Draft proof проверить не только отсутствие leg_* и passport_*, но и отсутствие дублирования ФИО/контактов как постоянного SoT.**
  Допустимы:
  &nbsp;
  - procedural refs,
  - временные значения для ручного fallback.
    Недопустимо:
  - хранить постоянные реквизиты как основной источник вместо ссылок на A/B/C слои.
  &nbsp;
7. **В Runtime activation matrix добавить жёсткое правило изменения статуса:**
  pending_sprint3 -> active только после полного proof-пакета по каждому шаблону:
  &nbsp;
  - render OK,
  - file uploaded,
  - DB record created,
  - template реально участвует в generation flow без ошибки.
    Без всех 4 пунктов статус не менять.
  &nbsp;
8. **В DoD добавить отдельный пункт Proof no second token system**
  Чтобы закрыть sprint окончательно, в финальном отчёте должно быть доказано:
  &nbsp;
  - не создан новый registry,
  - не создан новый placeholder format,
  - не появился отдельный corporate-only token namespace,
  - loops идут через существующий fields_registry + docxtemplater.
  &nbsp;
9. **В docs добавить отдельный раздел:**
  runtime_status ≠ template availability.
  Это нужно зафиксировать явно, чтобы потом никто не смешал capability и availability.
10. **Если хотите минимальный безопасный вариант патча:**
  сделать этот патч в 2 части:

&nbsp;

&nbsp;

&nbsp;

- сначала **sync/SoT для runtime_status**,
- потом **proof-close пакет** без дальнейших архитектурных изменений.
  Так будет чище и легче доказать закрытие.

&nbsp;

&nbsp;

В таком виде план хороший, но без этих правок остаётся риск смешать runtime_status и availability, а это сейчас главный архитектурный узкий момент.

&nbsp;

PATCH S3-PROOF-CLOSE — Финальная проверка и закрытие Sprint 3

## Проблема

Sprint 3 архитектурно корректен, но для закрытия нужен доказуемый proof-пакет по 5 направлениям. Также выявлена одна техническая проблема: `RUNTIME_STATUS_MAP` в `_shared/corporate-manifest.ts` — hardcoded копия, которая может разойтись с `corporateTemplateSpec.ts` (frontend SoT).

---

## Этап 1. Синхронизация RUNTIME_STATUS_MAP (единственное code-change)

**Проблема**: `corporate-manifest.ts` строки 67-86 содержат hardcoded `RUNTIME_STATUS_MAP`, который дублирует `corporateTemplateSpec.ts`. При изменении статуса шаблона на фронте (например, `pending_sprint3 → active`) сервер не узнает об этом — manifest расходится.

**Решение**: Добавить в `corporate-manifest.ts` параметр `runtimeStatusOverrides?: Record<string, string>` в `calculateServerManifest()`, который edge function заполняет из DB-запроса к `document_templates` (поле `is_active` + `template_path`). Это делает server manifest независимым от hardcoded map и 1:1 совместимым с фактическим состоянием шаблонов.

Альтернативно (проще): при каждом обновлении `corporateTemplateSpec.ts` обновлять `RUNTIME_STATUS_MAP` в `corporate-manifest.ts`. Документировать это правило в `docs/corporate-templates-rules.md`.

**Файлы**: `supabase/functions/_shared/corporate-manifest.ts`, `docs/corporate-templates-rules.md`

---

## Этап 2. Proof-пакет (без code changes — только проверки и документация)

### 2.1 Proof: Server manifest vs Frontend preview (1:1 совместимость)

Сравнить `calculateServerManifest()` и `calculatePackageManifest()` на 6 кейсах:

- `annual_meeting` + `law_default`
- `annual_meeting` + `charter_confirmed` + `has_board=true`
- `annual_meeting` + `has_auditor=true` + `has_audit_commission=true`
- `annual_meeting` + `charter_change` в agenda
- `sole_participant_decision` + `law_default`
- `annual_meeting` + `secret` voting

Для каждого: запустить обе функции с одинаковыми параметрами, сравнить состав, порядок, included/excluded.

**Метод проверки**: SQL-запрос к `ai_document_generation_batches.meta.manifest_snapshot` для реальных генераций, сравнить с фронтовым manifest.

### 2.2 Proof: Negative pre-flight guard

Invoke edge function с сессией, у которой:

- Все templates `pending_sprint3` (ни одного active) → ожидание: `"No eligible templates"`, session остается `confirmed`
- Или template с `is_active=false` в DB → ожидание: template excluded из eligible

**Метод**: `supabase--curl_edge_functions` с тестовой session_id.

### 2.3 Proof: History UI integration

Проверить, что `AiDocumentsHistoryView` корректно отображает corporate batches:

- Batch с `source='corporate_wizard'` в meta появляется во вкладке «История»
- Grouping по `generation_batch_id` работает
- Download links функционируют

**Метод**: SQL-запрос к `ai_document_generation_batches` + `ai_generated_documents` с `meta->>'source' = 'corporate_wizard'`, затем UI-screenshot.

### 2.4 Proof: Draft session не хранит постоянные реквизиты

SQL-запрос к `corporate_draft_sessions.corporate_params` — показать, что:

- Нет полей `leg_name`, `leg_address`, `leg_unp`, `passport_*`
- Есть только `person_id` ссылки, agenda, meeting details, candidates
- Реквизиты берутся из `client_legal_details` по `legal_details_id`

### 2.5 Proof: Runtime activation matrix

Для каждого из 10 `pending_sprint3` шаблонов: проверить, есть ли в `document_templates` запись с `code=X`, `is_active=true`, `template_path` IS NOT NULL, и файл в storage. Только после этого менять `runtime_status` в `corporateTemplateSpec.ts` и `RUNTIME_STATUS_MAP`.

---

## Файлы


| Файл                                               | Изменение                                                             |
| -------------------------------------------------- | --------------------------------------------------------------------- |
| `supabase/functions/_shared/corporate-manifest.ts` | Sync RUNTIME_STATUS_MAP или добавить override param                   |
| `docs/corporate-templates-rules.md`                | Добавить правило синхронизации runtime_status между frontend и server |


## DoD

1. `RUNTIME_STATUS_MAP` синхронизирован с `corporateTemplateSpec.ts` или parametrized
2. Proof manifest 1:1 на 6 кейсах задокументирован
3. Negative pre-flight proof — session не уходит в generated при отсутствии eligible templates
4. History UI proof — corporate batch отображается корректно
5. Draft session proof — нет дублирования постоянных реквизитов
6. Runtime activation matrix — поштучный статус каждого шаблона
7. Build clean