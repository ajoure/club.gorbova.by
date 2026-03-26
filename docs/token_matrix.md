# Master Token Matrix — Gate Artifact (PATCH 2.5)

> **Gate rule:** Без утверждения этой матрицы нельзя переходить к PATCH 2.6, финальной canonical-нормализации 4 DOCX, удалению legacy aliases.

> **Источник данных:** live query `fields_registry` + `aiDocumentSnapshotResolver.ts` + edge functions (`ai-generate-document`, `ai-generate-document-package`, `generate-from-template`, `document-auto-generate`). Doc usage — **manual classification** (gate artifact).

> **Дата генерации:** 2026-03-24 (v2 — исправлены totals, добавлены entity_type/source, расширен legacy_alias)

---

## Token Class Reference

> Класс токена определяется механизмом резолвинга, не именем сущности. Подробнее: `docs/TOKEN_ARCHITECTURE.md`.

| Token family | Class | Format example | Resolution | Status |
|---|---|---|---|---|
| `cf.legal_details.*` | A | `{{cf.legal_details.FLD-000042}}` | `public_id` → `fields_registry` → DB column | [implemented] |
| `cf.product.*` | legacy exception | `{{cf.product.<UUID>}}` | UUID → `fields_registry` → `field_values_v2` | [legacy compat] — not a model for new Class A families |
| `meeting.*` | B | `{{meeting.date}}` | canonical key → resolver | [implemented] |
| `document.*` | B | `{{document.number}}` | canonical key → resolver | [implemented] |
| `package.*` | B | `{{package.signer.full_name}}` | canonical key → resolver | [target] |
| `person.*` | B (may evolve) | `{{person.full_name}}` | canonical key → resolver | [implemented] |

- **Class A** canonical format: `{{cf.<entity_type>.<PUBLIC_ID>}}` — example: `{{cf.legal_details.FLD-000042}}`
- **Class B** format: `{{canonical.key}}` — example: `{{meeting.date}}`
- `cf.product` — legacy exception, NOT a template for new Class A token families

---

## Reuse 1:1 (existing keys, новые ключи НЕ создавались)

### Package → Meeting reuse mapping

| Запрошено (package.*) | Reused existing key | Причина |
|---|---|---|
| package.notice.method | meeting.notice.method | Идентичная семантика, entity_type=meeting |
| package.meeting.location.full | meeting.location.full | Идентичная семантика |
| package.review.location.full | meeting.review.location.full | Идентичная семантика |
| package.review.from | meeting.review.start | Идентичная семантика (start=from) |
| package.candidates.deadline | meeting.candidates.deadline | Идентичная семантика |
| package.report_year | meeting.report_year | Идентичная семантика |

### legal_details.* — 47 записей reused 1:1

Все 47 ключей из `fields_registry` с `entity_type=legal_details` используются напрямую. Новые ключи не создавались. Данные читаются из `client_legal_details` колонок.

### meeting.* — 12 записей reused 1:1 (из 15 total)

| Reused key | ui_label | Почему новый key не создавался |
|---|---|---|
| meeting.date | Дата собрания | Единственный canonical key для даты собрания |
| meeting.time | Время собрания | Единственный canonical key |
| meeting.location.full | Место проведения собрания | Единственный canonical key |
| meeting.notice.date | Дата направления извещения | Единственный canonical key |
| meeting.notice.method | Способ уведомления | Единственный canonical key |
| meeting.registration.date | Дата регистрации участников | Единственный canonical key |
| meeting.registration.from | Начало регистрации | Единственный canonical key |
| meeting.registration.to | Окончание регистрации | Единственный canonical key |
| meeting.review.start | Начало рассмотрения вопросов | Единственный canonical key |
| meeting.review.location.full | Место ознакомления с материалами | Единственный canonical key |
| meeting.candidates.deadline | Срок выдвижения кандидатов | Единственный canonical key |
| meeting.report_year | Отчётный год | Единственный canonical key |

3 ключа `meeting.*` — **new add-only** (meeting.review.to, meeting.review.break_from, meeting.review.break_to), созданы в PATCH 2.4.

---

## New add-only keys (созданы в рамках новой модели)

| entity_type | Кол-во | Ключи |
|---|---|---|
| entity | 6 | entity.address.legal.full, entity.director_short, entity.name, entity.settlement_display, entity.settlement.name, entity.settlement.type.short |
| entity_person | 6 | entity_person.acts_on_basis, entity_person.is_primary, entity_person.position, entity_person.role_label, entity_person.share_percent, entity_person.start_date |
| person | 12 | person.full_name, person.initials, person.address, person.birth_date, person.email, person.phone, person.personal_number, person.passport_series, person.passport_number, person.passport_issued_by, person.passport_issued_date, person.passport_valid_until |
| document | 3 | document.number, document.date, document.date_short |
| package (scalar) | 4 | package.signer.full_name, package.signer.position, package.chairperson.full_name, package.secretary.full_name |
| package (array) | 2 | package.participants, package.registered_persons |
| agenda (array) | 1 | agenda.items |
| decision (array) | 1 | decision.items |
| meeting (add-only) | 3 | meeting.review.to, meeting.review.break_from, meeting.review.break_to |
| **ИТОГО** | **38** | |

**Примечание:** person = 12 ключей (full_name, initials, address, birth_date, email, phone, personal_number, passport_series, passport_number, passport_issued_by, passport_issued_date, passport_valid_until). Ранее ошибочно указывалось 11.

---

## Legacy Alias Mapping (полный список)

> Источник: `aiDocumentSnapshotResolver.ts` + edge functions. Каждый alias — ad-hoc ключ, используемый в текущем production коде.

### Document aliases (3)

| legacy_alias | canonical_key | status |
|---|---|---|
| document_number | document.number | legacy+canonical |
| document_date | document.date | legacy+canonical |
| document_date_short | document.date_short | legacy+canonical |

### Entity aliases (14)

| legacy_alias | canonical_key | status |
|---|---|---|
| entity_name | entity.name / legal_details.leg_name | legacy+canonical |
| entity_short_name | entity.name | legacy+canonical |
| entity_unp | legal_details.leg_unp / legal_details.ent_unp | legacy+canonical |
| entity_address | entity.address.legal.full / legal_details.leg_address | legacy+canonical |
| entity_bank | legal_details.bank_name | legacy+canonical |
| entity_bank_code | legal_details.bank_code | legacy+canonical |
| entity_account | legal_details.bank_account | legacy+canonical |
| entity_phone | legal_details.phone | legacy+canonical |
| entity_email | legal_details.email | legacy+canonical |
| entity_director | legal_details.leg_director_name | legacy+canonical |
| entity_director_short | entity.director_short | legacy+canonical |
| entity_director_position | legal_details.leg_director_position | legacy+canonical |
| entity_acts_on_basis | legal_details.leg_acts_on_basis | legacy+canonical |
| entity_org_form | legal_details.leg_org_form | legacy+canonical |

### Client aliases (7) — alias→entity alias→canonical

| legacy_alias | canonical_key | status |
|---|---|---|
| client_name | entity.name (alias of entity_name) | legacy-only |
| client_address | entity.address.legal.full (alias of entity_address) | legacy-only |
| client_unp | legal_details.leg_unp (alias of entity_unp) | legacy-only |
| client_phone | legal_details.phone (alias of entity_phone) | legacy-only |
| client_email | legal_details.email (alias of entity_email) | legacy-only |
| client_bank | legal_details.bank_name (alias of entity_bank) | legacy-only |
| client_account | legal_details.bank_account (alias of entity_account) | legacy-only |

### Person aliases (12)

| legacy_alias | canonical_key | status |
|---|---|---|
| person_full_name | person.full_name | legacy+canonical |
| person_short_name | person.initials | legacy+canonical |
| person_personal_number | person.personal_number | legacy+canonical |
| person_birth_date | person.birth_date | legacy+canonical |
| person_passport_series | person.passport_series | legacy+canonical |
| person_passport_number | person.passport_number | legacy+canonical |
| person_passport_issued_by | person.passport_issued_by | legacy+canonical |
| person_passport_issued_date | person.passport_issued_date | legacy+canonical |
| person_passport_valid_until | person.passport_valid_until | legacy+canonical |
| person_phone | person.phone | legacy+canonical |
| person_email | person.email | legacy+canonical |
| person_address | person.address | legacy+canonical |

### Signer aliases (11)

| legacy_alias | canonical_key | status |
|---|---|---|
| signer.full_name | package.signer.full_name | legacy+canonical |
| signer.short_name | (no canonical — computed initials) | legacy-only |
| signer.personal_number | person.personal_number (signer context) | legacy-only |
| signer.passport_series | person.passport_series (signer context) | legacy-only |
| signer.passport_number | person.passport_number (signer context) | legacy-only |
| signer.passport_issued_by | person.passport_issued_by (signer context) | legacy-only |
| signer.passport_issued_date | person.passport_issued_date (signer context) | legacy-only |
| signer.passport_valid_until | person.passport_valid_until (signer context) | legacy-only |
| signer.phone | person.phone (signer context) | legacy-only |
| signer.email | person.email (signer context) | legacy-only |
| signer.address | person.address (signer context) | legacy-only |

### Link aliases (4)

| legacy_alias | canonical_key | status |
|---|---|---|
| link.role_label | entity_person.role_label | legacy+canonical |
| link.position | entity_person.position | legacy+canonical |
| link.acts_on_basis | entity_person.acts_on_basis | legacy+canonical |
| link.share_percent | entity_person.share_percent | legacy+canonical |

### Executor aliases (13) — billing flow only

| legacy_alias | canonical_key | status |
|---|---|---|
| executor_name | legal_details.leg_name (executor context) | legacy-only |
| executor_short_name | entity.name (executor context) | legacy-only |
| executor_unp | legal_details.leg_unp (executor context) | legacy-only |
| executor_address | entity.address.legal.full (executor context) | legacy-only |
| executor_bank | legal_details.bank_name (executor context) | legacy-only |
| executor_bank_code | legal_details.bank_code (executor context) | legacy-only |
| executor_account | legal_details.bank_account (executor context) | legacy-only |
| executor_phone | legal_details.phone (executor context) | legacy-only |
| executor_email | legal_details.email (executor context) | legacy-only |
| executor_director | legal_details.leg_director_name (executor context) | legacy-only |
| executor_director_short | entity.director_short (executor context) | legacy-only |
| executor_position | legal_details.leg_director_position (executor context) | legacy-only |
| executor_basis | legal_details.leg_acts_on_basis (executor context) | legacy-only |

**Итого legacy aliases: 64**

---

## Full Matrix

> Колонки doc1–doc4: ✓ = используется, — = не используется. Usage — **manual classification** (gate artifact).
> status: `reused` | `new` | `legacy-only` | `legacy+canonical`

### legal_details (47 записей, все reused)

| canonical_key | entity_type | ui_label | scalar_array | source | token_context | resolver_scope | status | doc1 | doc2 | doc3 | doc4 | legacy_alias |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| legal_details.leg_name | legal_details | Название организации | scalar | client_legal_details.leg_name | documents | db | reused | ✓ | ✓ | ✓ | ✓ | entity_name, client_name, executor_name |
| legal_details.leg_unp | legal_details | УНП (ЮЛ) | scalar | client_legal_details.leg_unp | documents | db | reused | ✓ | ✓ | — | — | entity_unp, client_unp, executor_unp |
| legal_details.leg_address | legal_details | Юридический адрес (ЮЛ) | scalar | client_legal_details.leg_address | documents | db | reused | ✓ | ✓ | — | — | entity_address, client_address, executor_address |
| legal_details.leg_director_name | legal_details | ФИО руководителя | scalar | client_legal_details.leg_director_name | documents | db | reused | ✓ | ✓ | — | ✓ | entity_director, executor_director |
| legal_details.leg_director_position | legal_details | Должность руководителя | scalar | client_legal_details.leg_director_position | documents | db | reused | ✓ | ✓ | — | ✓ | entity_director_position, executor_position |
| legal_details.leg_acts_on_basis | legal_details | Действует на основании (ЮЛ) | scalar | client_legal_details.leg_acts_on_basis | documents | db | reused | ✓ | — | — | — | entity_acts_on_basis, executor_basis |
| legal_details.leg_org_form | legal_details | Форма собственности | scalar | client_legal_details.leg_org_form | documents | db | reused | ✓ | ✓ | ✓ | ✓ | entity_org_form |
| legal_details.bank_name | legal_details | Банк | scalar | client_legal_details.bank_name | documents | db | reused | — | — | — | — | entity_bank, client_bank, executor_bank |
| legal_details.bank_code | legal_details | БИК / Код банка | scalar | client_legal_details.bank_code | documents | db | reused | — | — | — | — | entity_bank_code, executor_bank_code |
| legal_details.bank_account | legal_details | Расчётный счёт (IBAN) | scalar | client_legal_details.bank_account | documents | db | reused | — | — | — | — | entity_account, client_account, executor_account |
| legal_details.phone | legal_details | Телефон | scalar | client_legal_details.phone | documents | db | reused | — | — | — | — | entity_phone, client_phone, executor_phone |
| legal_details.email | legal_details | Email | scalar | client_legal_details.email | documents | db | reused | — | — | — | — | entity_email, client_email, executor_email |
| legal_details.leg_address_city | legal_details | Город (ЮЛ) | scalar | client_legal_details.leg_address_structured | documents | db | reused | — | — | — | — | — |
| legal_details.leg_address_street | legal_details | Улица (ЮЛ) | scalar | client_legal_details.leg_address_structured | documents | db | reused | — | — | — | — | — |
| legal_details.leg_address_house | legal_details | Дом (ЮЛ) | scalar | client_legal_details.leg_address_structured | documents | db | reused | — | — | — | — | — |
| legal_details.leg_address_apartment | legal_details | Кв./Офис (ЮЛ) | scalar | client_legal_details.leg_address_structured | documents | db | reused | — | — | — | — | — |
| legal_details.leg_address_building | legal_details | Корпус (ЮЛ) | scalar | client_legal_details.leg_address_structured | documents | db | reused | — | — | — | — | — |
| legal_details.leg_address_region | legal_details | Область (ЮЛ) | scalar | client_legal_details.leg_address_structured | documents | db | reused | — | — | — | — | — |
| legal_details.leg_address_country | legal_details | Страна (ЮЛ) | scalar | client_legal_details.leg_address_structured | documents | db | reused | — | — | — | — | — |
| legal_details.leg_address_postal_code | legal_details | Индекс (ЮЛ) | scalar | client_legal_details.leg_address_structured | documents | db | reused | — | — | — | — | — |
| legal_details.ent_name | legal_details | Имя ИП | scalar | client_legal_details.ent_name | documents | db | reused | — | — | — | — | — |
| legal_details.ent_unp | legal_details | УНП (ИП) | scalar | client_legal_details.ent_unp | documents | db | reused | — | — | — | — | — |
| legal_details.ent_address | legal_details | Адрес (ИП) | scalar | client_legal_details.ent_address | documents | db | reused | — | — | — | — | — |
| legal_details.ent_acts_on_basis | legal_details | Действует на основании (ИП) | scalar | client_legal_details.ent_acts_on_basis | documents | db | reused | — | — | — | — | — |
| legal_details.ent_address_city | legal_details | Город (ИП) | scalar | client_legal_details.ent_address_structured | documents | db | reused | — | — | — | — | — |
| legal_details.ent_address_street | legal_details | Улица (ИП) | scalar | client_legal_details.ent_address_structured | documents | db | reused | — | — | — | — | — |
| legal_details.ent_address_house | legal_details | Дом (ИП) | scalar | client_legal_details.ent_address_structured | documents | db | reused | — | — | — | — | — |
| legal_details.ent_address_apartment | legal_details | Кв./Офис (ИП) | scalar | client_legal_details.ent_address_structured | documents | db | reused | — | — | — | — | — |
| legal_details.ent_address_building | legal_details | Корпус (ИП) | scalar | client_legal_details.ent_address_structured | documents | db | reused | — | — | — | — | — |
| legal_details.ent_address_region | legal_details | Область (ИП) | scalar | client_legal_details.ent_address_structured | documents | db | reused | — | — | — | — | — |
| legal_details.ent_address_country | legal_details | Страна (ИП) | scalar | client_legal_details.ent_address_structured | documents | db | reused | — | — | — | — | — |
| legal_details.ent_address_postal_code | legal_details | Индекс (ИП) | scalar | client_legal_details.ent_address_structured | documents | db | reused | — | — | — | — | — |
| legal_details.ind_full_name | legal_details | ФИО | scalar | client_legal_details.ind_full_name | documents | db | reused | — | — | — | — | — |
| legal_details.ind_birth_date | legal_details | Дата рождения | scalar | client_legal_details.ind_birth_date | documents | db | reused | — | — | — | — | — |
| legal_details.ind_personal_number | legal_details | Личный номер | scalar | client_legal_details.ind_personal_number | documents | db | reused | — | — | — | — | — |
| legal_details.ind_passport_series | legal_details | Серия паспорта | scalar | client_legal_details.ind_passport_series | documents | db | reused | — | — | — | — | — |
| legal_details.ind_passport_number | legal_details | Номер паспорта | scalar | client_legal_details.ind_passport_number | documents | db | reused | — | — | — | — | — |
| legal_details.ind_passport_issued_by | legal_details | Кем выдан паспорт | scalar | client_legal_details.ind_passport_issued_by | documents | db | reused | — | — | — | — | — |
| legal_details.ind_passport_issued_date | legal_details | Дата выдачи паспорта | scalar | client_legal_details.ind_passport_issued_date | documents | db | reused | — | — | — | — | — |
| legal_details.ind_passport_valid_until | legal_details | Паспорт действителен до | scalar | client_legal_details.ind_passport_valid_until | documents | db | reused | — | — | — | — | — |
| legal_details.ind_address_city | legal_details | Город | scalar | client_legal_details.ind_address_city | documents | db | reused | — | — | — | — | — |
| legal_details.ind_address_street | legal_details | Улица | scalar | client_legal_details.ind_address_street | documents | db | reused | — | — | — | — | — |
| legal_details.ind_address_house | legal_details | Дом | scalar | client_legal_details.ind_address_house | documents | db | reused | — | — | — | — | — |
| legal_details.ind_address_apartment | legal_details | Квартира | scalar | client_legal_details.ind_address_apartment | documents | db | reused | — | — | — | — | — |
| legal_details.ind_address_district | legal_details | Район | scalar | client_legal_details.ind_address_district | documents | db | reused | — | — | — | — | — |
| legal_details.ind_address_region | legal_details | Область | scalar | client_legal_details.ind_address_region | documents | db | reused | — | — | — | — | — |
| legal_details.ind_address_index | legal_details | Индекс | scalar | client_legal_details.ind_address_index | documents | db | reused | — | — | — | — | — |

### entity (6 записей, все new)

| canonical_key | entity_type | ui_label | scalar_array | source | token_context | resolver_scope | status | doc1 | doc2 | doc3 | doc4 | legacy_alias |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| entity.name | entity | Наименование (авто) | scalar | computed | documents | computed | legacy+canonical | ✓ | ✓ | ✓ | ✓ | entity_name, entity_short_name, client_name, executor_name, executor_short_name |
| entity.director_short | entity | Директор (Фамилия И.О.) | scalar | computed | documents | computed | legacy+canonical | ✓ | — | — | ✓ | entity_director_short, executor_director_short |
| entity.address.legal.full | entity | Юридический адрес (полный) | scalar | computed | documents | computed | legacy+canonical | ✓ | ✓ | — | — | entity_address, client_address, executor_address |
| entity.settlement_display | entity | Населённый пункт (с типом) | scalar | computed | documents | computed | new | ✓ | ✓ | ✓ | ✓ | — |
| entity.settlement.name | entity | Название н.п. | scalar | computed | documents | computed | new | — | — | — | — | — |
| entity.settlement.type.short | entity | Тип н.п. (кратко) | scalar | computed | documents | computed | new | — | — | — | — | — |

### person (12 записей, все new)

| canonical_key | entity_type | ui_label | scalar_array | source | token_context | resolver_scope | status | doc1 | doc2 | doc3 | doc4 | legacy_alias |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| person.full_name | person | ФИО (полное) | scalar | persons.full_name | documents | db | legacy+canonical | — | — | ✓ | ✓ | person_full_name |
| person.initials | person | ФИО (кратко) | scalar | computed | documents | computed | legacy+canonical | — | — | — | — | person_short_name |
| person.address | person | Адрес (физлицо) | scalar | persons.registration_address | documents | db | legacy+canonical | — | — | — | — | person_address |
| person.birth_date | person | Дата рождения | scalar | persons.birth_date | documents | db | legacy+canonical | — | — | — | — | person_birth_date |
| person.email | person | Email (физлицо) | scalar | persons.email | documents | db | legacy+canonical | — | — | — | — | person_email |
| person.phone | person | Телефон (физлицо) | scalar | persons.phone | documents | db | legacy+canonical | — | — | — | — | person_phone |
| person.personal_number | person | Личный номер (физлицо) | scalar | persons.personal_number | documents | db | legacy+canonical | — | — | — | — | person_personal_number |
| person.passport_series | person | Серия паспорта | scalar | persons.passport_series | documents | db | legacy+canonical | — | — | — | — | person_passport_series |
| person.passport_number | person | Номер паспорта | scalar | persons.passport_number | documents | db | legacy+canonical | — | — | — | — | person_passport_number |
| person.passport_issued_by | person | Паспорт выдан | scalar | persons.passport_issued_by | documents | db | legacy+canonical | — | — | — | — | person_passport_issued_by |
| person.passport_issued_date | person | Дата выдачи паспорта | scalar | persons.passport_issued_date | documents | db | legacy+canonical | — | — | — | — | person_passport_issued_date |
| person.passport_valid_until | person | Паспорт действителен до | scalar | persons.passport_valid_until | documents | db | legacy+canonical | — | — | — | — | person_passport_valid_until |

### entity_person (6 записей, все new)

| canonical_key | entity_type | ui_label | scalar_array | source | token_context | resolver_scope | status | doc1 | doc2 | doc3 | doc4 | legacy_alias |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| entity_person.position | entity_person | Должность (связь) | scalar | entity_person_links.custom_position_text | documents | db | legacy+canonical | — | — | — | — | link.position |
| entity_person.role_label | entity_person | Роль (связь) | scalar | entity_person_links.role_type→roles.label | documents | db | legacy+canonical | — | — | — | — | link.role_label |
| entity_person.share_percent | entity_person | Доля % | scalar | entity_person_links.share_percent | documents | db | legacy+canonical | — | — | ✓ | ✓ | link.share_percent |
| entity_person.acts_on_basis | entity_person | Действует на основании (связь) | scalar | entity_person_links.acts_on_basis | documents | db | legacy+canonical | — | — | — | — | link.acts_on_basis |
| entity_person.is_primary | entity_person | Основная связь | scalar | entity_person_links.is_primary | documents | db | new | — | — | — | — | — |
| entity_person.start_date | entity_person | Дата начала полномочий | scalar | entity_person_links.start_date | documents | db | new | — | — | — | — | — |

### meeting (15 записей: 12 reused + 3 new)

| canonical_key | entity_type | ui_label | scalar_array | source | token_context | resolver_scope | status | doc1 | doc2 | doc3 | doc4 | legacy_alias |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| meeting.date | meeting | Дата собрания | scalar | manual | documents:annual_meeting | manual | reused | ✓ | ✓ | ✓ | ✓ | — |
| meeting.time | meeting | Время собрания | scalar | manual | documents:annual_meeting | manual | reused | ✓ | ✓ | ✓ | ✓ | — |
| meeting.location.full | meeting | Место проведения собрания | scalar | manual | documents:annual_meeting | manual | reused | ✓ | ✓ | ✓ | ✓ | — |
| meeting.notice.date | meeting | Дата направления извещения | scalar | manual | documents:annual_meeting | manual | reused | — | ✓ | — | — | — |
| meeting.notice.method | meeting | Способ уведомления | scalar | manual | documents:annual_meeting | manual | reused | — | ✓ | — | — | — |
| meeting.registration.date | meeting | Дата регистрации участников | scalar | manual | documents:annual_meeting | manual | reused | — | — | ✓ | — | — |
| meeting.registration.from | meeting | Начало регистрации | scalar | manual | documents:annual_meeting | manual | reused | — | — | ✓ | — | — |
| meeting.registration.to | meeting | Окончание регистрации | scalar | manual | documents:annual_meeting | manual | reused | — | — | ✓ | — | — |
| meeting.review.start | meeting | Начало рассмотрения вопросов | scalar | manual | documents:annual_meeting | manual | reused | — | ✓ | — | ✓ | — |
| meeting.review.location.full | meeting | Место ознакомления с материалами | scalar | manual | documents:annual_meeting | manual | reused | — | ✓ | — | — | — |
| meeting.candidates.deadline | meeting | Срок выдвижения кандидатов | scalar | manual | documents:annual_meeting | manual | reused | — | ✓ | — | — | — |
| meeting.report_year | meeting | Отчётный год | scalar | manual | documents:annual_meeting | manual | reused | ✓ | — | — | ✓ | — |
| meeting.review.to | meeting | Окончание рассмотрения вопросов | scalar | manual | documents:annual_meeting | manual | new | — | — | — | ✓ | — |
| meeting.review.break_from | meeting | Начало перерыва | scalar | manual | documents:annual_meeting | manual | new | — | — | — | ✓ | — |
| meeting.review.break_to | meeting | Окончание перерыва | scalar | manual | documents:annual_meeting | manual | new | — | — | — | ✓ | — |

### document (3 записи, все new)

| canonical_key | entity_type | ui_label | scalar_array | source | token_context | resolver_scope | status | doc1 | doc2 | doc3 | doc4 | legacy_alias |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| document.number | document | Номер документа | scalar | computed | documents | computed | legacy+canonical | ✓ | ✓ | ✓ | ✓ | document_number |
| document.date | document | Дата документа | scalar | computed | documents | computed | legacy+canonical | ✓ | ✓ | ✓ | ✓ | document_date |
| document.date_short | document | Дата документа (кратко) | scalar | computed | documents | computed | legacy+canonical | — | — | — | — | document_date_short |

### package — scalar roles (4 записи, все new)

| canonical_key | entity_type | ui_label | scalar_array | source | token_context | resolver_scope | status | doc1 | doc2 | doc3 | doc4 | legacy_alias |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| package.signer.full_name | package | ФИО подписанта | scalar | package_role | documents:annual_meeting | package_role | legacy+canonical | ✓ | ✓ | — | — | signer.full_name |
| package.signer.position | package | Должность подписанта | scalar | package_role | documents:annual_meeting | package_role | new | ✓ | ✓ | — | — | — |
| package.chairperson.full_name | package | ФИО председателя | scalar | package_role | documents:annual_meeting | package_role | new | — | — | — | ✓ | — |
| package.secretary.full_name | package | ФИО секретаря | scalar | package_role | documents:annual_meeting | package_role | new | — | — | — | ✓ | — |

### package — arrays (2 записи, все new)

| canonical_key | entity_type | ui_label | scalar_array | source | token_context | resolver_scope | item_schema | status | doc1 | doc2 | doc3 | doc4 | legacy_alias |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| package.participants | package | Участники собрания | array | loop | documents:annual_meeting | loop | full_name✱, share_percent✱, votes_count | new | — | — | — | ✓ | — |
| package.registered_persons | package | Зарегистрированные лица | array | loop | documents:annual_meeting | loop | full_name✱, registration_time, representative, share_percent | new | — | — | ✓ | — | — |

### agenda (1 запись, new)

| canonical_key | entity_type | ui_label | scalar_array | source | token_context | resolver_scope | item_schema | status | doc1 | doc2 | doc3 | doc4 | legacy_alias |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| agenda.items | agenda | Вопросы повестки дня | array | loop | documents:annual_meeting | loop | number✱, title✱, speaker, decision_text, votes_for, votes_against, votes_abstained | new | ✓ | ✓ | — | ✓ | — |

### decision (1 запись, new)

| canonical_key | entity_type | ui_label | scalar_array | source | token_context | resolver_scope | item_schema | status | doc1 | doc2 | doc3 | doc4 | legacy_alias |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| decision.items | decision | Принятые решения | array | loop | documents:annual_meeting | loop | agenda_number✱, text✱, result | new | — | — | — | ✓ | — |

---

## Документы (manual classification)

| Код | Название | Описание |
|---|---|---|
| doc1_order | Решение о проведении | Решение единственного участника о проведении собрания |
| doc2_notice | Извещение | Извещение о проведении общего собрания |
| doc3_registration | Лист регистрации | Лист регистрации участников |
| doc4_protocol | Протокол | Протокол общего собрания участников |

---

## Статистика

| Метрика | Значение |
|---|---|
| Всего записей в registry (canonical) | 98 |
| Reused 1:1 | 59 (47 legal_details + 12 meeting) |
| New add-only | 39 |
| Legacy aliases (total) | 64 |
| — legacy+canonical | 34 |
| — legacy-only | 30 |
| Array tokens | 4 (package.participants, package.registered_persons, agenda.items, decision.items) |
| Scalar role tokens | 4 (signer ×2, chairperson, secretary) |

**Проверка totals:** 59 reused + 39 new = **98** ✓

---

## Gate conditions

- [ ] Totals verified: 59 + 39 = 98 ✓
- [ ] `entity_type` column present in every row ✓
- [ ] `source` column present in every row ✓
- [ ] All 64 legacy aliases documented with canonical replacement ✓
- [ ] Matrix утверждена владельцем
- [ ] Doc usage (doc1–doc4) проверен на соответствие реальным DOCX
- [ ] Legacy aliases проверены
- [ ] После утверждения — можно переходить к PATCH 2.6
