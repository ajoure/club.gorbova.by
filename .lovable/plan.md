# да, согласен, с учетом правок:

1. **Уточнить главную формулировку Sprint 3A**
  &nbsp;
  Сейчас цель всё ещё звучит как подготовка “новых package-токенов”. Нужно жестче зафиксировать:
2. **Исправить формулировку про package-токен в шаблоне**
  &nbsp;
  В §6 написано:
  Package-токен в шаблоне = тот же `{{cf.legal_details.FLD-XXXXXX}}`, но резолвится через `package_session.selected_legal_entity_id`
  Это потенциально опасно: один и тот же `{{cf.legal_details.FLD-*}}` может сейчас означать обычный реквизит/заказчика, а в package context — компанию пакета.
  Лучше заменить на:
3. **Добавить проверку, как template context определяется технически**
  &nbsp;
  В read-only discovery добавить:
4. **Добавить обязательный** `source_field_id` **/ reuse mapping**
  &nbsp;
  В manifest добавить колонку:
  ```md
  source_FLD_id / source_registry_id
  ```
  Итоговая таблица должна быть:
  ```md
  | package_field | role_key | source_table | source_path | existing_FLD | source_FLD_id | reuse_model | decision |
  ```
  Где `reuse_model`:
  - `direct_reuse_same_token`;
  - `package_alias_to_existing_fld`;
  - `new_generic_fld_only_if_missing`;
  - `defer`.
5. **Уточнить “не создавать новые FLD без approve”**
  &nbsp;
  В §10 ожидаемый статус заменить:
  ```md
  completed: reuse-first manifest approved; ready for Sprint 3B registry/resolver planning
  ```
  А не “new generic package tokens list finalized”, чтобы Lovable не воспринял это как разрешение создавать новые FLD.
6. **Добавить обязательный анализ существующих FLD для физлиц**
  &nbsp;
  В §2.1 добавить:
  ```md
  Отдельно вывести existing FLD для:
  - ФИО физлица;
  - должность;
  - паспорт/документ;
  - личный номер;
  - адрес;
  - телефон;
  - email;
  - подпись/расшифровка подписи, если есть.
  ```
  Для пакета «Идеология» физлица важны не меньше юрлица: руководитель, ответственное лицо, составитель, участники, ознакомленные лица.
7. **Добавить обязательный анализ existing FLD для юрлица/ИП**
  &nbsp;
  В §2.1 добавить:
8. **Добавить связь с первым шаблоном приказа**
  &nbsp;
  В §3 добавить подтаблицу:
  ```md
  Минимальный набор для приказа:
  - наименование организации;
  - город;
  - дата приказа;
  - номер приказа;
  - руководитель / подписант;
  - ответственное лицо;
  - должность ответственного;
  - год плана;
  - ФИО руководителя в подписи.
  ```
  Это вытекает из приложенного документа: приказ содержит организацию, город, дату, номер, ответственное лицо, приложения, руководителя и подпись.  
9. **Добавить статус “не нужен для первого приказа”**
  &nbsp;
  В `decision` добавить:
  ```md
  not_needed_for_first_order_template
  ```
  Иначе manifest может раздуться. Для Sprint 3A важно выбрать минимум для первого приказа, а не сразу всё.
10. **Уточнить open decision по должности**

В §5.2 добавить:

```md
Если должность физлица уже есть в `legal_details_persons`, использовать её.
Если должность зависит от конкретного пакета/роли, хранить в `document_package_session_participants.metadata.position`.
Не брать должность из `legal_details_entity_person_links`, если она относится к company-role, а не package-role.
```

11. **Добавить запрет silent reuse billing/customer tokens**

```md
Нельзя использовать billing/customer token в package template, если resolver не доказывает package_session context.
Reuse existing FLD означает reuse source definition, а не автоматическое использование billing context.
```

12. **Добавить проверку падежей и форматирования**

Существующие акты используют модификаторы `case=genitive`, `format=words` и др. В manifest добавить колонку:

```md
supports_modifiers
```

Проверить, поддержат ли package-context значения:

- падежи ФИО;
- падежи должности;
- даты;
- числа прописью.

Это важно, потому что в шаблоне счета-акта уже используются падежные модификаторы для FLD-токенов.  

13. **Добавить “no resolver fallback” в DoD**

В DoD добавить:

```md
- Для каждого package_field указано, что произойдет при отсутствии данных: unresolved/warning/blocking.
- Нет ни одного silent fallback на первое юрлицо/физлицо пользователя.
```

14. **Sprint 3B пока не называть implementation**

После Sprint 3A следующий шаг лучше назвать:

```md
Sprint 3B — registry/resolver implementation plan
```

а не сразу “registry + resolver skeleton”, чтобы сначала утвердить, будет ли direct reuse или alias/wrapper.

В остальном план правильный: он уже фиксирует reuse-first, read-only, запрет per-package namespace и запрет генерации. Главная правка — **не считать заранее, что existing** `{{cf.legal_details.FLD-*}}` **можно безопасно вставлять в package templates без отдельного package-aware context/resolver решения**.

&nbsp;

План: Sprint 3A — Generic package token manifest approve (reuse-first)

## 0. Правила исполнения

- Только русский язык во всех артефактах.
- Sprint 3A = **manifest approval only**, read-only discovery.
- **Никаких** INSERT/UPDATE/DELETE/ALTER в `fields_registry`, `document_token_registry`, `document_package_role_catalog`, `document_package_sessions*`.
- Никаких изменений UI picker / `TokenizedRichInput` / `tokenRegistry.ts`.
- Никаких изменений resolver и `canonical-document-generate-strict`.
- Никакой генерации документов.
- Все связи только через UUID/id.
- **Запрещено** создавать namespace `documents:package:ideology` или иной per-package namespace.
- Единственный смысловой namespace package-токенов: `documents:package`.
- Адаптация пакета — только через `package_code` + `document_package_role_catalog`.
- **Reuse-first**: новые FLD предлагать только если доказано, что existing FLD отсутствует или непригоден.

## 1. Цель

Составить и утвердить manifest **переиспользования существующих FLD реквизитов** (юрлица/ИП/физлица) в контексте `package_session`, плюс зафиксировать минимально необходимые новые generic package-токены — без записи в БД.

## 2. Read-only discovery (SELECT-only)

Через `supabase--read_query` собрать:

1. **Существующие FLD реквизитов:**
  - `fields_registry` WHERE `entity_type IN ('legal_details','legal_details_person','legal_details_entity_person_links','package')` AND `archived_at IS NULL` — собрать `id`, `public_id`, `key`, `label`, `entity_type`, `display_order`.
2. **Текущие package-токены:**
  - `document_token_registry` WHERE `field_id IN (FLD-093,094,095,096,097,098,101,102)` или namespace package — подтвердить, что записей нет (или зафиксировать что есть).
3. **Структура session:**
  - Колонки `document_package_sessions`, `document_package_session_participants`, `document_package_role_catalog` (через `information_schema.columns`) — подтвердить `selected_legal_entity_id`, `person_id`, `legal_entity_id`, `role_key`, `metadata`.
4. **Структура реквизитов:**
  - Колонки `client_legal_details`, `legal_details_persons`, `legal_details_entity_person_links`.
5. **Использование в шаблонах:**
  - Regex-скан `document_templates.content` на наличие любых `{{cf.legal_details.FLD-*}}`, `{{cf.legal_details_person.FLD-*}}`, `{{package.*}}` — для оценки конфликтов и совместимости.

## 3. Структура manifest

Для **каждого** поля, нужного для первого шаблона приказа «Идеология», заполнить строку:


| package_field | role_key | source_table | source_path | existing_FLD | reuse_token | decision |
| ------------- | -------- | ------------ | ----------- | ------------ | ----------- | -------- |


Где `decision ∈ {reuse_existing, needs_new_only_if_missing, defer_until_loop_support, defer_until_source_exists, do_not_create}`.

### 3.1 Группы полей

**A. Компания пакета** (`package_session.selected_legal_entity_id → client_legal_details`):

- full_name, short_name, unp, client_type, legal_address, postal_address, bank_details (если есть FLD).
- Ожидание: 100% reuse существующих `cf.legal_details.FLD-*`.

**B. Руководитель компании** (рекомендация: только через package role `company_head`):

- full_name, position, authority_basis.
- Источник: `participants WHERE role_key='company_head' → person_id → legal_details_persons` (+ при необходимости `metadata.position`, `metadata.authority_basis`).
- Fallback на `legal_details_entity_person_links` **запрещён** (anti-fallback).

**C. Role-based лица** (из `document_package_session_participants` по `role_key`):

- `responsible_person`, `document_signer`, `document_preparer`, `control_person`.
- Поля: full_name, position.
- Источник ФИО: `legal_details_persons` через `person_id`. Источник должности: решить в п. 5.

**D. Массивы (loops)**:

- `participants[]`, `notified_persons[]`.
- Статус по умолчанию: `defer_until_loop_support` (требуется proof поддержки повторяемых блоков в DOCX renderer; отдельный backlog).

## 4. Anti-fallback (закрепить в proof)

Запрещено резолвить package-токен без `package_session_id`. Запрещено:

- брать первое юрлицо пользователя;
- брать первого руководителя из `legal_details_entity_person_links` без явного назначения роли `company_head`;
- брать любого подписанта/составителя без role assignment в session_participants;
- матчить по имени/УНП/email/slug.

Нет session или нет role assignment → `unresolved` + warning, без silent fallback.

## 5. Open decisions (зафиксировать ответ в proof)

1. **Источник руководителя**: только `participants[role_key='company_head']` (рекомендуется) vs допуск fallback на `legal_details_entity_person_links`.
2. **Хранилище должности физлица в роли пакета**: `legal_details_persons.position` / `legal_details_entity_person_links.position` / `document_package_session_participants.metadata.position` / новое поле.
3. **Минимальный набор токенов для первого шаблона приказа «Идеология»** — финальный список (≤ ~10 токенов).
4. **Что отложить до поддержки loops** (явный список).
5. **Что не создавать** во избежание мусора (явный список).

## 6. Reuse vs new — правило принятия

- Если existing FLD совпадает по семантике (например, `legal_details.leg_full_name`) → `reuse_existing`. Package-токен в шаблоне = тот же `{{cf.legal_details.FLD-XXXXXX}}`, но резолвится через `package_session.selected_legal_entity_id` (это уже Sprint 3B-resolver).
- Если existing FLD отсутствует и поле нужно для первого шаблона → `needs_new_only_if_missing` с обоснованием.
- Re-purpose FLD-93/94/97 — только после resolver review (Sprint 3B), в 3A — `defer`.
- Новые FLD должны быть generic под `documents:package`, без слова `ideology` в key/label.

## 7. Артефакты

Создать `.lovable/proofs/package_documents_sprint3a_generic_token_manifest_2026_05.md` со секциями:

1. Read-only discovery results (snapshot SELECT-результатов).
2. Final generic package token manifest (таблица п. 3).
3. Source mapping (session → реквизиты).
4. Role-key mapping (role_key → source_path).
5. Company head source decision (ответ на open decision №1).
6. Position storage decision (ответ на №2).
7. Tokens approved for Sprint 3B (минимальный список для приказа).
8. Tokens deferred (loops, optional).
9. Tokens do_not_create.
10. Anti-fallback rules.
11. Registry implementation plan for Sprint 3B (что именно INSERT-ить и куда).
12. Final status.

Обновить `.lovable/plan.md` — отметить Sprint 3A как in_progress → completed после approve.

## 8. STOP-зоны

- `payments_v2`, `orders_v2`, `subscriptions_v2`, `entitlements`, `access_rules`, `tariff_offers`.
- `allocate_document_number`, `document_scenarios`, billing/customer/executor resolver, FLD актов.
- Signature `canonical-document-generate-strict`.
- Per-package namespaces.
- Любые DDL/DML.

## 9. DoD

- Proof-файл создан со всеми 12 секциями.
- Для каждого поля первого шаблона приказа есть строка manifest с явным `decision`.
- Все open decisions (п. 5) имеют утверждённый ответ.
- Подтверждено: 0 записей в БД, 0 правок UI, 0 правок edge functions.
- Финальный статус: `completed: generic package token manifest approved; ready for Sprint 3B` либо `partial: manifest requires source decisions`.

## 10. Финальный статус (ожидаемый)

`completed: reuse-first manifest approved; new generic package tokens list finalized; ready for Sprint 3B registry + resolver skeleton`.