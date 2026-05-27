# Sprint 3A.1 — Corrective Discovery (read-only)

Дата: 2026-05-27
Тип: discovery + reuse-first manifest
Изменений БД/edge/UI/миграций: **0**.
SOT-источники: `fields_registry`, `document_token_registry`, `document_token_aliases`, `information_schema.columns`, исходники `supabase/functions/_shared/case-format.ts` и `document-render.ts`.

---

## 0. Контекст и цель

Sprint 3B execution plan v1 ставился на паузу из-за предложения создать новые FLD `package.roles.*.full_name`, `package.context.plan_year`. Перед любым INSERT в `fields_registry`/`document_token_registry` 3A.1 обязан доказать, какие existing FLD реально покрывают первый приказ (Идеология) через reuse + role-context, и только остаток объявляется «доказанно новым».

Инвариант:

```
роль в пакете (role_key)  =  кто выбран (person_id или legal_entity_id)
поле физлица/юрлица (FLD) =  какое значение взять
```

---

## 1. Discovery: existing FLD (read-only результаты)

### 1.1 Person-context FLD

Schema `fields_registry` не содержит колонки `category` (только `entity_type, key, label, data_type, options, description, public_id, display_order`). Поиск выполнен по `entity_type` + по подстрокам `key`/`label`.

**`entity_type='contact'` (FLD-000135..140)**

| public_id | key | label |
|---|---|---|
| FLD-000135 | `contact.full_name` | Контакт: полное имя |
| FLD-000136 | `contact.first_name` | Контакт: имя |
| FLD-000137 | `contact.last_name` | Контакт: фамилия |
| FLD-000138 | `contact.email` | Контакт: email |
| FLD-000139 | `contact.phone` | Контакт: телефон |
| FLD-000140 | `contact.telegram_username` | Контакт: Telegram username |

> Source: `profiles`/контакты владельца кабинета. Это **не** person-в-пакетной-роли.

**`entity_type='customer' / 'customer_ent' / 'customer_ind'` (FLD-000113..145, FLD-000213..217, FLD-000288..295, FLD-000313..)**

| public_id | key | label |
|---|---|---|
| FLD-000113 | `customer.name` | Заказчик: Название / ФИО по типу плательщика |
| FLD-000114 | `customer.short_name` | Заказчик: Краткое название / ФИО |
| FLD-000213 | `customer.director` | Заказчик: директор (ЮЛ) |
| FLD-000214 | `customer.director_short` | Заказчик: директор, инициалы (ЮЛ) |
| FLD-000215 | `customer.director_full_name` | Заказчик: ФИО руководителя (ЮЛ) |
| FLD-000216 | `customer.director_position` | Заказчик: должность руководителя (ЮЛ) |
| FLD-000217 | `customer.acts_on_basis` | Заказчик: Руководитель действует на основании |
| FLD-000289 | `customer.ent.director_full_name` | Заказчик ИП: Руководитель ФИО |
| FLD-000290 | `customer.ent.director_position` | Заказчик ИП: Руководитель должность |
| FLD-000291 | `customer.ent.director_short_name` | Заказчик ИП: Руководитель ФИО кратко |
| FLD-000293 | `customer.ent.name` | Заказчик ИП: ФИО |
| FLD-000295 | `customer.ent.short_name` | Заказчик ИП: ФИО кратко |
| FLD-000313 | `customer.ind.full_name` | Заказчик ФЛ: ФИО |
| FLD-000288 | `customer.ent.director_acts_on_basis` | Заказчик ИП: на основании |

> Source: billing-context (заказчик = плательщик в счёт-акте). **Status: `existing_found_but_context_unconfirmed`** — это **billing-specific** FLD, резолвятся в biller-resolver и привязаны к invoice flow. **Reuse в package-context запрещён без alias-wrapper**: пакетный «руководитель» ≠ «директор заказчика».

**`entity_type='package'` (FLD-000093..102 legacy corporate, частично)**

| public_id | key | label |
|---|---|---|
| FLD-000095 | `package.chairperson.full_name` | ФИО председателя |
| FLD-000096 | `package.secretary.full_name` | ФИО секретаря |
| FLD-000097 | `package.participants` | Участники собрания (array) |
| FLD-000098 | `package.registered_persons` | Зарегистрированные лица (array) |
| FLD-000101 | `package.board_candidates` | Кандидаты в совет директоров (array) |
| FLD-000102 | `package.commission_members` | Члены ревизионной комиссии (array) |

> Status: **legacy_corporate** (собрания акционеров). Не подходят как generic `company_head`/`responsible_person`.

**Person-в-пакетной-роли (responsible_person / company_head / document_signer) в `fields_registry` отсутствует.**
Поиск по `entity_type IN ('person','legal_details_person','legal_details_persons','individual','entity_person','natural_person')` → **0 строк**.

### 1.2 Падежи ФИО

Запрос по `key`/`label` (`genitive|dative|accusative|instrumental|prepositional|case|родительн|дательн|винительн|творительн|предложн|падеж`) → **0 строк в `fields_registry`**.

> Падежи реализованы НЕ через отдельные FLD, а через render-модификатор `|case=...` (см. §3).

### 1.3 Document / system FLD

**Document (entity_type='document')** — generic для всех документов:

| public_id | key | label | data_type |
|---|---|---|---|
| **FLD-000069** | `document.number` | Номер документа | text |
| **FLD-000070** | `document.date` | Дата документа | date |
| FLD-000182 | `document.contract_number` | Договор: номер | string |
| FLD-000183 | `document.contract_date` | Договор: дата | date |
| FLD-000184 | `document.act_number` | Акт: номер | string |
| FLD-000185 | `document.act_date` | Акт: дата | date |

> `document.number`/`document.date` — generic document FLD, не связаны с конкретным договором/актом. **Pre-confirmation**: используются в счёт-акте; универсальность для приказа подтверждается тем, что они единственные generic «номер/дата документа» в registry — все остальные document-FLD типизированы (`contract_*`, `act_*`). **Status: reuse_with_universality_pre_confirmed; final_confirmation в Sprint 3B coverage matrix.**

**System (entity_type='system')**:

| public_id | key | label |
|---|---|---|
| FLD-000133 | `system.today` | Система: сегодня |
| FLD-000134 | `system.today_long` | Система: сегодня (длинная) |
| FLD-000209 | `system.today_ru` | Сегодня прописью |
| **FLD-000211** | `system.year` | Текущий год |

**Meeting (entity_type='meeting')**:

| public_id | key | label |
|---|---|---|
| **FLD-000082** | `meeting.report_year` | Отчётный год |

> Для «года плана» **2 кандидата**:
> - `FLD-000211 system.year` — автоматический текущий год; **не подходит**, если план составляется в декабре на следующий год.
> - `FLD-000082 meeting.report_year` — пользовательский «отчётный год»; семантически близко к «плановый год». **Status: `existing_found_but_context_unconfirmed`** — нужно подтвердить, что resolver `meeting.report_year` можно перепривязать к `package_session.metadata.plan_year` без поломки legacy meeting-документов, ЛИБО ввести аналог `package.context.plan_year` со своим source mapping в package-scope.

### 1.4 Legal-details: город / адрес

Все три категории юрлица имеют отдельную колонку `city`:

| public_id | key | label | для |
|---|---|---|---|
| FLD-000039 | `legal_details.leg_address_city` | Город (ЮЛ) | ЮЛ |
| FLD-000047 | `legal_details.ent_address_city` | Город (ИП) | ИП |
| FLD-000031 | `legal_details.ind_address_city` | Город | ФЛ |

> Также есть полные адреса: FLD-000012 (ЮЛ), FLD-000018 (ИП), и структурированные jsonb-колонки `*_address_structured`. **Status: reuse** — отдельный FLD «город приказа» **не создавать**. Город приказа = выбор по типу выбранного юрлица (`client_legal_details.client_type` → соответствующий `*_address_city`). Если приказа подписывается ЮЛ — `FLD-000039`.

### 1.5 Token registry / aliases

- `document_token_registry` (колонки: `token_key, ui_label, category, source_type, field_id, resolver_key, data_type, archived_at, archive_reason, …`) — поддерживает разделение source_type (FLD vs resolver) и archive_reason для soft-disable.
- `document_token_aliases` (колонки: `alias_token, canonical_token_key, template_id, template_version_id, notes, metadata`) — **поддерживает alias-wrapper из коробки** для Варианта B.

---

## 2. Schema person/package

### 2.1 `legal_details_persons` (SOT для физлиц-участников пакетов)

Колонки: `id, profile_id, full_name, birth_date, personal_number, passport_series, passport_number, passport_issued_by, passport_issued_date, passport_valid_until, phone, email, address_structured, notes, is_active, passport_number_full`.

> **Только** `full_name` единой строкой; **нет** отдельных surname/first_name/middle_name; **нет** должности; **нет** колонок падежей.

### 2.2 `document_package_session_participants`

Колонки: `package_session_id, entity_type, legal_entity_id, person_id, role_key, role_catalog_id, is_required, is_primary, metadata (jsonb), …`

> `metadata` — место для пакет-специфичной должности (`metadata.position`) и любых per-package overrides.

### 2.3 `document_package_sessions`

Колонки: `selected_legal_entity_id, package_template_id, product_id, tariff_id, status, metadata (jsonb), …`

> `metadata` — место для `plan_year` (если решено не использовать `meeting.report_year`).

---

## 3. Render capability check

`supabase/functions/_shared/case-format.ts` + `document-render.ts`:

- Уже реализована поддержка **`|case=…`** модификатора для customer/payer/executor токенов (`document-render.ts:846..880`).
- Модификатор обрабатывает строки → склонения (через morph-helper).
- Точка добавления `|role=…` существует там же (loop по template-токенам).

**Вывод по варианту A vs B:**

- **Вариант A (role-aware placeholder)** технически реалистичен: pipe-парсер уже есть, нужно добавить ветку `|role=…` в тот же loop. Но требует расширения render-кода и риска регрессии в billing-токенах.
- **Вариант B (alias-wrapper через `document_token_aliases`)** — инфраструктура уже существует (`alias_token → canonical_token_key`). Не требует изменений render-кода; package-токены резолвятся через wrapper, который указывает на existing person FLD + role_key в `metadata`.

**Принятое решение: ВАРИАНТ B (alias-wrapper) для Sprint 3B v2.**
Обоснование:
1. Render-код не меняется → billing/customer/executor резолверы не затрагиваются → 0 риск регрессии.
2. `document_token_aliases` уже моделирует точно эту связку.
3. UI picker токенов работает с canonical-token_key, alias прозрачен.
4. Падежи продолжают работать через существующий `|case=` поверх wrapper-результата.

---

## 4. Coverage Matrix первого приказа (Идеология)

Decision-коды:
- `reuse` — existing FLD + path подтверждены.
- `reuse_via_role_alias` — existing person FLD + alias-wrapper с `role_key`.
- `existing_found_but_context_unconfirmed` — FLD есть, но прямой reuse требует решения (alias или новый scope).
- `needs_new_only_if_proven_missing` — кандидат на новый FLD при доказанном отсутствии.
- `defer` — отложено.

| Поле приказа | Existing FLD | Source path | Decision |
|---|---|---|---|
| Наименование организации | `FLD-000010` (leg_name) или эквивалент юрлица/ИП/ФЛ | `client_legal_details.leg_name/ent_name/ind_full_name` через `package_session.selected_legal_entity_id` | reuse |
| УНП | `FLD-000011 legal_details.leg_unp` (и ИП-аналог) | `client_legal_details.leg_unp/ent_unp` | reuse |
| Юр. адрес | FLD-000012 (ЮЛ) / FLD-000018 (ИП) | `client_legal_details.leg_address/ent_address` | reuse |
| **Город приказа** | **FLD-000039 / FLD-000047 / FLD-000031** | `client_legal_details.*_address_city` (выбор по client_type) | **reuse** (новый FLD НЕ создаётся) |
| **Номер приказа** | **FLD-000069 document.number** | `document.number` (generic) | reuse (pre-confirmed; final check в 3B) |
| **Дата приказа** | **FLD-000070 document.date** | `document.date` (generic) | reuse (pre-confirmed; final check в 3B) |
| **Год плана** | **FLD-000082 meeting.report_year** ИЛИ новый `package.context.plan_year` | `document_package_sessions.metadata.plan_year` | **existing_found_but_context_unconfirmed** — решение в 3B: (a) расширить resolver `meeting.report_year` на package_session metadata; (b) ввести `package.context.plan_year`. FLD-000211 `system.year` НЕ подходит (декабрь → следующий год). |
| **ФИО руководителя** | `legal_details_persons.full_name` (нет existing FLD для person в registry) | `participants{role_key=company_head}.person_id → legal_details_persons.full_name` | **reuse_via_role_alias** (Вариант B): создаётся alias-token, source — person registry record (которая сама добавляется как single canonical person FLD, см. §5). |
| ФИО руководителя (падежи) | существующий `|case=` модификатор | wrapper результат `FLD-XXXX|case=genitive` | reuse через render-модификатор |
| **Должность руководителя** | `document_package_session_participants.metadata.position` | participants(role_key=company_head).metadata.position | reuse_via_role_alias (resolver-source, не FLD-source). **Доказать**: применим ли существующий `|case=` к строке из jsonb — DoD пункт. |
| **ФИО ответственного** | как и руководитель — через alias `responsible_person` | `participants{role_key=responsible_person}.person_id → legal_details_persons.full_name` | reuse_via_role_alias |
| Должность ответственного | participants.metadata.position | participants(role_key=responsible_person).metadata.position | reuse_via_role_alias |

---

## 5. Что реально нужно (минимальный набор для Sprint 3B v2)

### 5.1 Доказанно НЕ существует

1. **Один canonical person FLD «ФИО физлица из package-role»** — резолвится из `legal_details_persons.full_name` через `participants.role_key + person_id`.
   - 0 строк в registry с `entity_type IN ('person', 'legal_details_person', …)`.
   - `contact.full_name` (FLD-000135) — это владелец кабинета, не подходит.
   - `customer.director_full_name` (FLD-000215) — billing-context, billing-resolver.
   - Predлагается: **1 FLD `legal_details_persons.full_name`** с `entity_type='legal_details_person'`, **без role-привязки**. Role вводится через alias-wrapper.

2. **Resolver-source для `participants.metadata.position`** — не FLD, а resolver-key в `document_token_registry.resolver_key='package_participant_position'`. Без FLD-источника.

### 5.2 Кандидаты в alias-wrapper (НЕ новые FLD)

В `document_token_aliases` (или эквивалентном wrapper-механизме):

- `package.role.company_head.full_name` → canonical `legal_details_persons.full_name` + `metadata.role_key='company_head'`.
- `package.role.responsible_person.full_name` → то же + `role_key='responsible_person'`.
- `package.role.document_signer.full_name` → то же + `role_key='document_signer'`.
- `package.role.company_head.position` → resolver `package_participant_position` + `metadata.role_key='company_head'`.
- `package.role.responsible_person.position` → то же + `role_key='responsible_person'`.

### 5.3 Год плана — открытый вопрос

В Sprint 3B v2 принять одно из:
- **Опция R** (reuse): расширить resolver `FLD-000082 meeting.report_year` так, чтобы при `template_scope='package'` он читал `document_package_sessions.metadata.plan_year`. Риск: семантическая нагрузка одного FLD двумя контекстами.
- **Опция N** (минимально-новый): ввести **1 FLD `package.context.plan_year`** (data_type=number) с source `document_package_sessions.metadata.plan_year`, **только** если опция R создаёт регрессию.

### 5.4 Итог «новых FLD»

- **Гарантированно 1**: `legal_details_persons.full_name` (canonical person FLD, без роли).
- **Возможно 1**: `package.context.plan_year` — только при выборе Опции N.
- **0 alias-wrapper токенов** не считаются «новыми FLD» — они wrapper'ы поверх existing source.

> Прежний драфт Sprint 3B v1 предлагал 5 новых FLD. После 3A.1: **максимум 2**, минимально — **1**.

---

## 6. DoD выполнения 3A.1

- [x] SQL §3.1–§3.4 выполнены (read-only), результаты выше.
- [x] `FLD-000069`/`FLD-000070` подтверждены как generic document.number/date (final-check перенесён в 3B coverage).
- [x] Coverage matrix §4 заполнена с конкретными `public_id` и decision-кодами, включая `existing_found_but_context_unconfirmed`.
- [x] Capability check рендера: `|case=` поддержан; `|role=` отсутствует, но не требуется (выбран Вариант B alias-wrapper).
- [x] Принято решение **Вариант B** (§3).
- [x] Контракт «должность = `participants.metadata.position`» зафиксирован (§4, §5.2).
- [x] Discovery по `document_token_registry` + `document_token_aliases` выполнено (§1.5).
- [x] Discovery по адресной модели юрлица (отдельные `*_address_city`) выполнен (§1.4).
- [x] Список разрешённых новых FLD (§5.4) с доказательством отсутствия — приведён.

### Открытые проверки, переносимые в Sprint 3B v2 implementation plan

- [ ] **Final-check универсальности `FLD-000069`/`FLD-000070`** для не-billing scope (приказ): scan production-шаблонов, что они не конфликтуют с `act_number/contract_number`.
- [ ] **Морфология должности из `metadata.position`**: тестовый прогон `|case=genitive` поверх строки JSONB → подтвердить, что текущий morph-helper не требует прединдексации.
- [ ] **Опция R vs N** для года плана.
- [ ] **Опция A vs B окончательное закрепление**: B принят, но если на этапе alias-implementation выявится, что `document_token_aliases` не имеет `resolver_key` поля и не передаёт `metadata.role_key` в render-context, — fallback на Вариант A (добавление `|role=` в render). Сейчас по схеме `document_token_aliases.metadata jsonb` есть.

---

## 7. Финальный статус Sprint 3A.1

**`completed: minimal new alias/wrapper tokens required, source fields reused`**

Расшифровка:
- Реальный объём «новых FLD»: **1 гарантированно** (`legal_details_persons.full_name`) + **до 1 опционально** (`package.context.plan_year` только если Опция R не проходит).
- Всё остальное (`company_head.full_name`, `responsible_person.full_name`, `document_signer.full_name`, `*.position`, `город приказа`, `номер/дата приказа`) — **alias-wrapper или прямой reuse**, без новых source-FLD.
- Variant B (alias через `document_token_aliases`) — выбран.
- Render-код, billing-резолвер, executor-резолвер, customer-резолвер, `canonical-document-generate-strict` signature — **не меняются**.

---

## 8. Что Sprint 3B v2 implementation plan ДОЛЖЕН содержать

1. Точная миграция **1 FLD** `legal_details_persons.full_name` (+ опционально 1 FLD `package.context.plan_year`).
2. INSERT'ы в `document_token_aliases` для 5 wrapper-токенов (см. §5.2).
3. Resolver-key `package_participant_position` в `document_token_registry` (без FLD-source, source_type=resolver).
4. Минимальная routing-точка в `canonical-document-generate-strict` для `template_scope='package'` — только подключение wrapper-резолвинга, billing-путь не трогается.
5. Feature-flag `documents_package_resolver_enabled=false` по умолчанию.
6. Coverage matrix первого приказа с финальной проверкой FLD-000069/070 на универсальность.
7. Soft-disable rollback через `archived_at`/`archive_reason`.
8. Proof-пакет: duplicate-check, migration SQL, alias inserts, billing regression proof (0 diff в billing-резолверах), signature unchanged proof, no generation proof.

**Запрещено в 3B v2 без отдельного approve:**
- Создание любых FLD сверх §5.4.
- Изменение billing/customer/executor резолверов.
- Изменение signature `canonical-document-generate-strict`.
- Fallback через `legal_details_entity_person_links` без явного флага.

---

## 9. Связанные документы

- `.lovable/proofs/package_documents_sprint3a_closure_clarifications_2026_05.md` — Sprint 3A closure (reuse-first manifest).
- `.lovable/proofs/package_documents_sprint3b_implementation_plan_2026_05.md` — Sprint 3B v1 (**superseded** этим документом).
- `.lovable/plan.md` — обновлён: Sprint 3B v1 отозван, статус 3A.1 = completed.
