# Sprint 3A — Generic package token manifest (reuse-first)

**Дата:** 2026-05-27
**Тип:** read-only discovery + manifest approval
**Статус:** completed: reuse-first manifest approved; ready for Sprint 3B registry/resolver implementation plan
**Кросс-ссылки:**
- `.lovable/plan.md`
- `.lovable/proofs/package_documents_sprint2_3_generic_model_correction_2026_05.md`
- `docs/TOKEN_ARCHITECTURE.md`
- `.lovable/memory/architecture/documents/field-id-first-canon.md`

## 0. Соблюдение правил

- 0 INSERT/UPDATE/DELETE/ALTER в БД (только `information_schema` + SELECT по существующим таблицам).
- 0 правок UI / `TokenizedRichInput` / `tokenRegistry.ts`.
- 0 правок edge functions / resolver / `canonical-document-generate-strict`.
- 0 namespace `documents:package:ideology` — не создаётся.
- Все связи в manifest — только UUID/id.

## 1. Read-only discovery results

### 1.1 fields_registry (entity_type='legal_details', archived_at IS NULL) — 47 FLD

Полный перечень собран SELECT (см. `tool-results://supabase--read_query/20260527-103229-534849`). Ключевые группы:

**Юрлицо (ЮЛ):** FLD-000009 leg_unp, FLD-000010 leg_org_form, FLD-000011 leg_name, FLD-000012 leg_address, FLD-000013 leg_director_position, FLD-000014 leg_director_name, FLD-000015 leg_acts_on_basis, FLD-000035…000042 (структурированный адрес ЮЛ + страна).

**ИП:** FLD-000016 ent_unp, FLD-000017 ent_name, FLD-000018 ent_address, FLD-000019 ent_acts_on_basis, FLD-000043…000050 (структурированный адрес ИП).

**Физлицо (внутри `client_legal_details`, не отдельная таблица):** FLD-000020 ind_full_name, FLD-000021 ind_birth_date, FLD-000022…000027 (паспорт+личный номер), FLD-000028…000034 (адрес).

**Банковские/контакты:** FLD-000004…000008 (bank_account, bank_name, bank_code, phone, email).

### 1.2 fields_registry (entity_type='package') — 8 FLD

| public_id | key | label | вердикт |
|---|---|---|---|
| FLD-000093 | package.signer.full_name | ФИО подписанта | legacy-corporate (defer, не reuse в 3A) |
| FLD-000094 | package.signer.position | Должность подписанта | legacy-corporate (defer) |
| FLD-000095 | package.chairperson.full_name | ФИО председателя | legacy-corporate, не для идеологии |
| FLD-000096 | package.secretary.full_name | ФИО секретаря | legacy-corporate, не для идеологии |
| FLD-000097 | package.participants | Участники собрания | legacy-corporate, не для идеологии |
| FLD-000098 | package.registered_persons | Зарегистрированные лица | legacy-corporate, не для идеологии |
| FLD-000101 | package.board_candidates | Кандидаты в совет директоров | legacy-corporate, не для идеологии |
| FLD-000102 | package.commission_members | Члены ревизионной комиссии | legacy-corporate, не для идеологии |

### 1.3 fields_registry (entity_type='legal_details_person', 'legal_details_entity_person_links')

**0 записей.** Физлица как отдельный entity_type **не представлены** в registry. ФИО физлица сейчас существует только как `ind_full_name` (FLD-000020) в `client_legal_details` для client_type='individual'.

### 1.4 document_token_registry — package-токены

**0 записей** с `field_id ∈ FLD-093…102` или `token_key LIKE 'package.%'`. Реестр package-токенов пуст.

### 1.5 Использование package-токенов в шаблонах

```sql
SELECT id, name, code, template_scope FROM document_templates
WHERE placeholders::text ~ 'package\.' OR editor_draft_content::text ~ 'package\.';
-- → 0 rows
```

Конфликтов с production шаблонами актов нет. Re-purpose FLD-93/94/97 безопасен **технически**, но в Sprint 3A не предлагается (требует resolver review).

### 1.6 Структура session/participants/role_catalog

`document_package_sessions`: `id`, `package_template_id`, `profile_id`, `user_id`, `product_id`, `tariff_id`, `selected_legal_entity_id`, `status`, `legal_entity_locked_at`, `metadata jsonb`.

`document_package_session_participants`: `id`, `package_session_id`, `entity_type`, `legal_entity_id`, `person_id`, `role_key`, `role_catalog_id`, `is_required`, `is_primary`, `metadata jsonb`.

`document_package_role_catalog`: `id`, `package_template_id`, `role_key`, `label`, `description`, `allowed_entity_types[]`, `required`, `min_count`, `max_count`, `sort_order`, `is_active`, `metadata jsonb`.

`legal_details_persons`: `id`, `profile_id`, `full_name`, `birth_date`, `personal_number`, `passport_*`, `phone`, `email`, `address_structured jsonb`. **Колонки `position` НЕТ.**

`legal_details_entity_person_links`: `id`, `legal_details_id`, `person_id`, `role_catalog_id`, `role_type`, `position_catalog_id`, `custom_role_text`, `custom_position_text`, `acts_on_basis`, `is_primary`, `start_date`, `end_date`. **Содержит position и acts_on_basis, но это company-level роль, а не package-level.**

## 2. Technical context determination (Sprint 3A discovery)

`TokenizedRichInput` / `tokenRegistry.ts` сейчас работают по `template_scope` шаблона (например `billing`, `package`, `internal`). Package-aware context резолвится не по namespace токена, а по полю `document_templates.template_scope` + `package_session_id` в snapshot.

**Вывод:** один и тот же `{{cf.legal_details.FLD-000011}}` в шаблоне с `template_scope='billing'` означает customer/executor (резолвится billing resolver), а в шаблоне с `template_scope='package'` означает компанию пакета (резолвится package resolver через `selected_legal_entity_id`). Решение о резолвере принимается **по template_scope**, а не по строке токена.

Это критично: **direct_reuse_same_token = безопасно ТОЛЬКО внутри template_scope='package'**. Использование того же токена в billing-шаблоне без `package_session_id` НЕ должно автоматически тянуть данные пакета.

## 3. Final generic package token manifest (для приказа «Идеология»)

### 3.1 Минимальный набор для первого приказа

Из приложенного документа «Идеология» приказ требует: наименование организации, город, дата приказа, номер приказа, ответственное лицо + должность, год плана, ФИО руководителя в подписи, должность руководителя.

| package_field | role_key | source_table | source_path | existing_FLD | source_FLD_id | reuse_model | supports_modifiers | decision |
|---|---|---|---|---|---|---|---|---|
| Наименование организации | — | client_legal_details | session.selected_legal_entity_id → leg_name (ЮЛ) / ent_name (ИП) | FLD-000011 / FLD-000017 | 9c05fdfc / d39c2018 | direct_reuse_same_token | case=genitive,nominative | reuse_existing |
| УНП организации | — | client_legal_details | session.selected_legal_entity_id → leg_unp / ent_unp | FLD-000009 / FLD-000016 | e78fdd86 / 25581901 | direct_reuse_same_token | — | reuse_existing |
| Юридический адрес | — | client_legal_details | session.selected_legal_entity_id → leg_address / ent_address | FLD-000012 / FLD-000018 | 408a4a9a / 2c7ad580 | direct_reuse_same_token | — | reuse_existing |
| Город организации | — | client_legal_details | session.selected_legal_entity_id → leg_address_city / ind_address_city | FLD-000039 / FLD-000031 | 6e61aa2a / f38194f8 | direct_reuse_same_token | case=prepositional | reuse_existing |
| ФИО руководителя (подпись) | company_head | participants[role_key='company_head'] → legal_details_persons.full_name | session_participants.person_id → full_name | FLD-000014 (legacy ЮЛ-resident) | 245754b6 | package_alias_to_existing_fld | case=genitive,format=initials | needs_new_only_if_missing |
| Должность руководителя | company_head | participants[role_key='company_head'] → metadata.position OR legal_details_entity_person_links.custom_position_text | metadata.position (recommended) | FLD-000013 (legacy ЮЛ-resident) | 3dbdefe8 | package_alias_to_existing_fld | case=genitive | needs_new_only_if_missing |
| ФИО ответственного лица | responsible_person | participants[role_key='responsible_person'] → legal_details_persons.full_name | session_participants.person_id → full_name | — | — | new_generic_fld_only_if_missing | case=genitive,format=initials | needs_new_only_if_missing |
| Должность ответственного | responsible_person | participants[role_key='responsible_person'] → metadata.position | metadata.position | — | — | new_generic_fld_only_if_missing | case=genitive | needs_new_only_if_missing |
| Номер приказа | — | document.number (Class B, scope=package) | allocate_document_number | n/a | n/a | direct_reuse_same_token | — | reuse_existing |
| Дата приказа | — | document.date (Class B) | snapshot.generated_at | n/a | n/a | direct_reuse_same_token | format=long_ru | reuse_existing |
| Год плана | — | session.metadata.plan_year | session.metadata.plan_year | — | — | new_generic_fld_only_if_missing | — | needs_new_only_if_missing |

### 3.2 Поля вне минимума для первого приказа

| package_field | decision |
|---|---|
| Подписант (если ≠ руководитель), составитель, контролёр | not_needed_for_first_order_template |
| Участники / ознакомленные лица (массивы) | defer_until_loop_support |
| Банковские реквизиты компании | not_needed_for_first_order_template |
| Полные паспортные данные ролей | not_needed_for_first_order_template |

## 4. Source mapping

```
document_package_sessions (id, package_template_id, selected_legal_entity_id, metadata)
  ├── selected_legal_entity_id ──► client_legal_details (ЮЛ/ИП/физлицо в зависимости от client_type)
  │     └── 47 FLD-000004…000050 (reuse напрямую через package resolver)
  └── document_package_session_participants (package_session_id, role_key, person_id, legal_entity_id, metadata)
        ├── person_id ──► legal_details_persons (full_name, паспорт, контакты)
        ├── legal_entity_id ──► client_legal_details (если роль исполняется юрлицом)
        └── metadata.position / metadata.acts_on_basis (package-level overrides)
```

**legal_details_entity_person_links** — read-only вспомогательный источник, **не используется** как fallback для package-role в Sprint 3B.

## 5. Role-key mapping (минимум для идеологии)

| role_key | label_в_роле_catalog | allowed_entity_types | min/max | источник полей |
|---|---|---|---|---|
| company_head | Руководитель организации | person | 1/1 | legal_details_persons + metadata.position |
| responsible_person | Ответственный за идеологическую работу | person | 1/1 | legal_details_persons + metadata.position |
| document_signer | Подписант документа | person | 0/1 | legal_details_persons (опционально, по умолчанию = company_head) |
| document_preparer | Составитель | person | 0/1 | legal_details_persons (deferred) |
| control_person | Контролирующее лицо | person | 0/1 | legal_details_persons (deferred) |
| participant | Участник (для массива) | person | 0/N | deferred until loop support |
| notified_person | Ознакомленное лицо | person | 0/N | deferred until loop support |

## 6. Company head source decision

**Решение:** Источник руководителя пакета — **ТОЛЬКО `participants[role_key='company_head']`**.

Fallback на `legal_details_entity_person_links.role_type='director'` **запрещён** в Sprint 3B. Если в session не назначена роль `company_head` → resolver возвращает `unresolved` + warning `package_role_company_head_not_assigned`. UI анкеты должен enforce min_count=1 для роли `company_head` перед формированием.

**Обоснование:** избегаем silent fallback. Пользователь может иметь нескольких company-link-руководителей; package role assignment делает выбор явным и аудируемым.

## 7. Position storage decision

**Решение:** Должность физлица в package-role хранится в **`document_package_session_participants.metadata.position`** (jsonb).

- `legal_details_persons.position` — **колонки нет**, добавлять не предлагается (физлицо может иметь разную должность в разных пакетах).
- `legal_details_entity_person_links.custom_position_text` — company-level, **не используется** для package-role.
- Новое поле в БД **не создаётся** в Sprint 3B (jsonb metadata достаточно).

Аналогично `metadata.acts_on_basis` для основания полномочий руководителя в контексте конкретного пакета.

## 8. Tokens approved for Sprint 3B (registry candidates)

**Direct reuse (без новых FLD, через package resolver по template_scope='package'):**

- FLD-000011 leg_name + FLD-000017 ent_name → компания пакета (имя)
- FLD-000009 leg_unp + FLD-000016 ent_unp → УНП
- FLD-000012 leg_address + FLD-000018 ent_address → юрадрес
- FLD-000039 leg_address_city → город (ЮЛ); FLD-000031 ind_address_city → город (физлицо)
- `document.number`, `document.date` — Class B canonical-keys (resolver уже существует)

**Новые generic package FLD (predлагается создать в Sprint 3B, итого ~5):**

1. `package.roles.company_head.full_name` — ФИО руководителя (резолв через role assignment)
2. `package.roles.company_head.position` — должность руководителя (metadata.position)
3. `package.roles.responsible_person.full_name` — ФИО ответственного
4. `package.roles.responsible_person.position` — должность ответственного
5. `package.context.plan_year` — год плана (session.metadata.plan_year)

Все 5 — generic, **без слова `ideology` в key/label**. Используются любым пакетом, в котором есть соответствующая роль/контекст.

## 9. Tokens deferred

- `package.participants[].*` — массивы, **defer_until_loop_support** (требуется отдельный proof DOCX loop renderer; backlog).
- `package.notified_persons[].*` — массивы, defer.
- `package.roles.document_preparer.*`, `package.roles.control_person.*`, `package.roles.document_signer.*` (когда ≠ company_head) — not_needed_for_first_order_template; будут добавлены позднее по мере появления шаблонов.
- Re-purpose FLD-93/94/97 — defer до Sprint 3B resolver review.

## 10. Tokens do_not_create

- `documents:package:ideology.*` или любой per-package namespace — **запрещено**.
- Дублирующие FLD для реквизитов компании (banking, address) — **запрещено** (reuse existing legal_details FLD).
- `package.signer.*` / `package.chairperson.*` / `package.secretary.*` под новые семантики — **запрещено** (legacy FLD-93…96 остаются legacy-corporate).

## 11. Anti-fallback rules

Закреплено для Sprint 3B resolver:

1. Package-токен не резолвится без `package_session_id`. Нет session → `unresolved`.
2. Role-based токен не резолвится без явного participants-row с `role_key`. Нет назначения → `unresolved` + warning `package_role_<role_key>_not_assigned`.
3. Запрещено: брать первое юрлицо пользователя, первого руководителя из `legal_details_entity_person_links`, первого подписанта без role assignment, матчинг по имени/УНП/email.
4. Reuse existing FLD = reuse source definition. Billing/customer context **не** автоматически переиспользуется в package-шаблоне; решение принимается по `template_scope`.
5. Behavior при отсутствии данных для каждого package_field из §3.1: `unresolved` + warning (non-blocking для UI preview, blocking для финальной генерации в Sprint 4).

## 12. Registry implementation plan для Sprint 3B (только план, без INSERT в 3A)

**Sprint 3B = registry/resolver implementation plan + execution.** Sprint 3A фиксирует только намерения:

1. **INSERT в `fields_registry`** (5 новых generic package FLD из §8). Все с `entity_type='package'`, generic key, generic label.
2. **INSERT в `document_token_registry`** (5 строк с `field_id` на новые FLD + 0 строк для direct reuse FLD — token resolver знает их по public_id).
3. **Расширение `tokenRegistry.ts` группой «Пакеты документов»** — context-aware фильтр для picker при `template_scope='package'`.
4. **Skeleton package resolver** в edge function (новая `canonical-package-resolve` или ветка в существующем resolver по `template_scope`). Источники строго по §4. Anti-fallback по §11.
5. **НЕ подключать** `canonical-document-generate-strict` (Sprint 4).
6. **Атомарность save participants** — отдельный RPC `package_session_replace_participants` (`.lovable/backlog/document_package_session_save_atomicity.md`).

## 13. Final status

**completed: reuse-first manifest approved; ready for Sprint 3B registry/resolver implementation plan.**

- 0 записей в БД сделано.
- 0 правок UI/edge сделано.
- 47 existing legal_details FLD подтверждены к reuse через package resolver.
- 5 новых generic package FLD идентифицированы (без `ideology` в имени).
- 8 legacy package FLD (FLD-93…102) подтверждены как legacy-corporate, не reuse в первой итерации.
- Все open decisions (company head source, position storage, минимум для приказа, deferred, do_not_create) — закрыты.
- Anti-fallback rules зафиксированы для Sprint 3B.

**Следующий шаг:** утверждение Sprint 3B — registry/resolver implementation plan (отдельный proof перед любым INSERT).
