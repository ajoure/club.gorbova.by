# Master Token Matrix — Gate Artifact (PATCH 2.5)

> **Gate rule:** Без утверждения этой матрицы нельзя переходить к PATCH 2.6, финальной canonical-нормализации 4 DOCX, удалению legacy aliases.

> **Источник данных:** live query `fields_registry` + manual doc usage classification (doc1–doc4).

> **Дата генерации:** 2026-03-24

---

## Reuse 1:1 (existing keys, новые ключи НЕ создавались)

| Запрошено (package.*) | Reused existing key | Причина |
|---|---|---|
| package.notice.method | meeting.notice.method | Идентичная семантика, entity_type=meeting |
| package.meeting.location.full | meeting.location.full | Идентичная семантика |
| package.review.location.full | meeting.review.location.full | Идентичная семантика |
| package.review.from | meeting.review.start | Идентичная семантика (start=from) |
| package.candidates.deadline | meeting.candidates.deadline | Идентичная семантика |
| package.report_year | meeting.report_year | Идентичная семантика |

**legal_details.*** — 47 записей reused 1:1, без alias и без нового ключа.

**meeting.*** — 15 записей reused 1:1 (включая 3 добавленных в PATCH 2.4: review.to, review.break_from, review.break_to).

---

## New add-only keys (созданы в рамках новой модели)

| entity_type | Кол-во | Ключи |
|---|---|---|
| entity | 6 | entity.address.legal.full, entity.director_short, entity.name, entity.settlement_display, entity.settlement.name, entity.settlement.type.short |
| entity_person | 6 | entity_person.acts_on_basis, entity_person.is_primary, entity_person.position, entity_person.role_label, entity_person.share_percent, entity_person.start_date |
| person | 11 | person.full_name, person.initials, person.address, person.birth_date, person.email, person.phone, person.personal_number, person.passport_series, person.passport_number, person.passport_issued_by, person.passport_issued_date, person.passport_valid_until |
| document | 3 | document.number, document.date, document.date_short |
| package (scalar) | 4 | package.signer.full_name, package.signer.position, package.chairperson.full_name, package.secretary.full_name |
| package (array) | 2 | package.participants, package.registered_persons |
| agenda (array) | 1 | agenda.items |
| decision (array) | 1 | decision.items |
| meeting (add-only) | 3 | meeting.review.to, meeting.review.break_from, meeting.review.break_to |

---

## Full Matrix

> Колонки doc1–doc4: ✓ = используется, — = не используется. Usage — **manual classification** (gate artifact).
> status: `reused` | `new` | `legacy-only` | `legacy+canonical`

### legal_details (entity_type: legal_details) — 47 записей, все reused

| canonical_key | ui_label | scalar_array | token_context | resolver_scope | status | doc1_order | doc2_notice | doc3_registration | doc4_protocol | legacy_alias |
|---|---|---|---|---|---|---|---|---|---|---|
| legal_details.leg_name | Название организации | scalar | documents | db | reused | ✓ | ✓ | ✓ | ✓ | entity_name |
| legal_details.leg_unp | УНП (ЮЛ) | scalar | documents | db | reused | ✓ | ✓ | — | — | — |
| legal_details.leg_address | Юридический адрес (ЮЛ) | scalar | documents | db | reused | ✓ | ✓ | — | — | entity_address |
| legal_details.leg_director_name | ФИО руководителя | scalar | documents | db | reused | ✓ | ✓ | — | ✓ | director_name |
| legal_details.leg_director_position | Должность руководителя | scalar | documents | db | reused | ✓ | ✓ | — | ✓ | director_position |
| legal_details.leg_acts_on_basis | Действует на основании (ЮЛ) | scalar | documents | db | reused | ✓ | — | — | — | — |
| legal_details.leg_org_form | Форма собственности | scalar | documents | db | reused | ✓ | ✓ | ✓ | ✓ | — |
| legal_details.leg_address_city | Город (ЮЛ) | scalar | documents | db | reused | — | — | — | — | — |
| legal_details.leg_address_street | Улица (ЮЛ) | scalar | documents | db | reused | — | — | — | — | — |
| legal_details.leg_address_house | Дом (ЮЛ) | scalar | documents | db | reused | — | — | — | — | — |
| legal_details.leg_address_apartment | Кв./Офис (ЮЛ) | scalar | documents | db | reused | — | — | — | — | — |
| legal_details.leg_address_building | Корпус (ЮЛ) | scalar | documents | db | reused | — | — | — | — | — |
| legal_details.leg_address_region | Область (ЮЛ) | scalar | documents | db | reused | — | — | — | — | — |
| legal_details.leg_address_country | Страна (ЮЛ) | scalar | documents | db | reused | — | — | — | — | — |
| legal_details.leg_address_postal_code | Индекс (ЮЛ) | scalar | documents | db | reused | — | — | — | — | — |
| legal_details.bank_name | Банк | scalar | documents | db | reused | — | — | — | — | — |
| legal_details.bank_code | БИК / Код банка | scalar | documents | db | reused | — | — | — | — | — |
| legal_details.bank_account | Расчётный счёт (IBAN) | scalar | documents | db | reused | — | — | — | — | — |
| legal_details.phone | Телефон | scalar | documents | db | reused | — | — | — | — | — |
| legal_details.email | Email | scalar | documents | db | reused | — | — | — | — | — |
| legal_details.ent_name | Имя ИП | scalar | documents | db | reused | — | — | — | — | — |
| legal_details.ent_unp | УНП (ИП) | scalar | documents | db | reused | — | — | — | — | — |
| legal_details.ent_address | Адрес (ИП) | scalar | documents | db | reused | — | — | — | — | — |
| legal_details.ent_acts_on_basis | Действует на основании (ИП) | scalar | documents | db | reused | — | — | — | — | — |
| legal_details.ent_address_city | Город (ИП) | scalar | documents | db | reused | — | — | — | — | — |
| legal_details.ent_address_street | Улица (ИП) | scalar | documents | db | reused | — | — | — | — | — |
| legal_details.ent_address_house | Дом (ИП) | scalar | documents | db | reused | — | — | — | — | — |
| legal_details.ent_address_apartment | Кв./Офис (ИП) | scalar | documents | db | reused | — | — | — | — | — |
| legal_details.ent_address_building | Корпус (ИП) | scalar | documents | db | reused | — | — | — | — | — |
| legal_details.ent_address_region | Область (ИП) | scalar | documents | db | reused | — | — | — | — | — |
| legal_details.ent_address_country | Страна (ИП) | scalar | documents | db | reused | — | — | — | — | — |
| legal_details.ent_address_postal_code | Индекс (ИП) | scalar | documents | db | reused | — | — | — | — | — |
| legal_details.ind_full_name | ФИО | scalar | documents | db | reused | — | — | — | — | — |
| legal_details.ind_birth_date | Дата рождения | scalar | documents | db | reused | — | — | — | — | — |
| legal_details.ind_personal_number | Личный номер | scalar | documents | db | reused | — | — | — | — | — |
| legal_details.ind_passport_series | Серия паспорта | scalar | documents | db | reused | — | — | — | — | — |
| legal_details.ind_passport_number | Номер паспорта | scalar | documents | db | reused | — | — | — | — | — |
| legal_details.ind_passport_issued_by | Кем выдан паспорт | scalar | documents | db | reused | — | — | — | — | — |
| legal_details.ind_passport_issued_date | Дата выдачи паспорта | scalar | documents | db | reused | — | — | — | — | — |
| legal_details.ind_passport_valid_until | Паспорт действителен до | scalar | documents | db | reused | — | — | — | — | — |
| legal_details.ind_address_city | Город | scalar | documents | db | reused | — | — | — | — | — |
| legal_details.ind_address_street | Улица | scalar | documents | db | reused | — | — | — | — | — |
| legal_details.ind_address_house | Дом | scalar | documents | db | reused | — | — | — | — | — |
| legal_details.ind_address_apartment | Квартира | scalar | documents | db | reused | — | — | — | — | — |
| legal_details.ind_address_district | Район | scalar | documents | db | reused | — | — | — | — | — |
| legal_details.ind_address_region | Область | scalar | documents | db | reused | — | — | — | — | — |
| legal_details.ind_address_index | Индекс | scalar | documents | db | reused | — | — | — | — | — |

### entity (entity_type: entity) — 6 записей, все new

| canonical_key | ui_label | scalar_array | token_context | resolver_scope | status | doc1_order | doc2_notice | doc3_registration | doc4_protocol | legacy_alias |
|---|---|---|---|---|---|---|---|---|---|---|
| entity.name | Наименование (авто) | scalar | documents | computed | new | ✓ | ✓ | ✓ | ✓ | entity_name |
| entity.director_short | Директор (Фамилия И.О.) | scalar | documents | computed | new | ✓ | — | — | ✓ | — |
| entity.address.legal.full | Юридический адрес (полный) | scalar | documents | computed | new | ✓ | ✓ | — | — | entity_address |
| entity.settlement_display | Населённый пункт (с типом) | scalar | documents | computed | new | ✓ | ✓ | ✓ | ✓ | — |
| entity.settlement.name | Название н.п. | scalar | documents | computed | new | — | — | — | — | — |
| entity.settlement.type.short | Тип н.п. (кратко) | scalar | documents | computed | new | — | — | — | — | — |

### person (entity_type: person) — 11 записей, все new

| canonical_key | ui_label | scalar_array | token_context | resolver_scope | status | doc1_order | doc2_notice | doc3_registration | doc4_protocol | legacy_alias |
|---|---|---|---|---|---|---|---|---|---|---|
| person.full_name | ФИО (полное) | scalar | documents | db | new | — | — | ✓ | ✓ | — |
| person.initials | ФИО (кратко) | scalar | documents | computed | new | — | — | — | — | — |
| person.address | Адрес (физлицо) | scalar | documents | db | new | — | — | — | — | — |
| person.birth_date | Дата рождения | scalar | documents | db | new | — | — | — | — | — |
| person.email | Email (физлицо) | scalar | documents | db | new | — | — | — | — | — |
| person.phone | Телефон (физлицо) | scalar | documents | db | new | — | — | — | — | — |
| person.personal_number | Личный номер (физлицо) | scalar | documents | db | new | — | — | — | — | — |
| person.passport_series | Серия паспорта | scalar | documents | db | new | — | — | — | — | — |
| person.passport_number | Номер паспорта | scalar | documents | db | new | — | — | — | — | — |
| person.passport_issued_by | Паспорт выдан | scalar | documents | db | new | — | — | — | — | — |
| person.passport_issued_date | Дата выдачи паспорта | scalar | documents | db | new | — | — | — | — | — |
| person.passport_valid_until | Паспорт действителен до | scalar | documents | db | new | — | — | — | — | — |

### entity_person (entity_type: entity_person) — 6 записей, все new

| canonical_key | ui_label | scalar_array | token_context | resolver_scope | status | doc1_order | doc2_notice | doc3_registration | doc4_protocol | legacy_alias |
|---|---|---|---|---|---|---|---|---|---|---|
| entity_person.position | Должность (связь) | scalar | documents | db | new | — | — | — | — | — |
| entity_person.role_label | Роль (связь) | scalar | documents | db | new | — | — | — | — | — |
| entity_person.share_percent | Доля % | scalar | documents | db | new | — | — | ✓ | ✓ | — |
| entity_person.acts_on_basis | Действует на основании (связь) | scalar | documents | db | new | — | — | — | — | — |
| entity_person.is_primary | Основная связь | scalar | documents | db | new | — | — | — | — | — |
| entity_person.start_date | Дата начала полномочий | scalar | documents | db | new | — | — | — | — | — |

### meeting (entity_type: meeting) — 15 записей, 12 reused + 3 new

| canonical_key | ui_label | scalar_array | token_context | resolver_scope | status | doc1_order | doc2_notice | doc3_registration | doc4_protocol | legacy_alias |
|---|---|---|---|---|---|---|---|---|---|---|
| meeting.date | Дата собрания | scalar | documents:annual_meeting | manual | reused | ✓ | ✓ | ✓ | ✓ | — |
| meeting.time | Время собрания | scalar | documents:annual_meeting | manual | reused | ✓ | ✓ | ✓ | ✓ | — |
| meeting.location.full | Место проведения собрания | scalar | documents:annual_meeting | manual | reused | ✓ | ✓ | ✓ | ✓ | — |
| meeting.notice.date | Дата направления извещения | scalar | documents:annual_meeting | manual | reused | — | ✓ | — | — | — |
| meeting.notice.method | Способ уведомления | scalar | documents:annual_meeting | manual | reused | — | ✓ | — | — | — |
| meeting.registration.date | Дата регистрации участников | scalar | documents:annual_meeting | manual | reused | — | — | ✓ | — | — |
| meeting.registration.from | Начало регистрации | scalar | documents:annual_meeting | manual | reused | — | — | ✓ | — | — |
| meeting.registration.to | Окончание регистрации | scalar | documents:annual_meeting | manual | reused | — | — | ✓ | — | — |
| meeting.review.start | Начало рассмотрения вопросов | scalar | documents:annual_meeting | manual | reused | — | ✓ | — | ✓ | — |
| meeting.review.location.full | Место ознакомления с материалами | scalar | documents:annual_meeting | manual | reused | — | ✓ | — | — | — |
| meeting.candidates.deadline | Срок выдвижения кандидатов | scalar | documents:annual_meeting | manual | reused | — | ✓ | — | — | — |
| meeting.report_year | Отчётный год | scalar | documents:annual_meeting | manual | reused | ✓ | — | — | ✓ | — |
| meeting.review.to | Окончание рассмотрения вопросов | scalar | documents:annual_meeting | manual | new | — | — | — | ✓ | — |
| meeting.review.break_from | Начало перерыва | scalar | documents:annual_meeting | manual | new | — | — | — | ✓ | — |
| meeting.review.break_to | Окончание перерыва | scalar | documents:annual_meeting | manual | new | — | — | — | ✓ | — |

### document (entity_type: document) — 3 записи, все new

| canonical_key | ui_label | scalar_array | token_context | resolver_scope | status | doc1_order | doc2_notice | doc3_registration | doc4_protocol | legacy_alias |
|---|---|---|---|---|---|---|---|---|---|---|
| document.number | Номер документа | scalar | documents | computed | new | ✓ | ✓ | ✓ | ✓ | document_number |
| document.date | Дата документа | scalar | documents | computed | new | ✓ | ✓ | ✓ | ✓ | document_date |
| document.date_short | Дата документа (кратко) | scalar | documents | computed | new | — | — | — | — | — |

### package — scalar roles (entity_type: package) — 4 записи, все new

| canonical_key | ui_label | scalar_array | token_context | resolver_scope | status | doc1_order | doc2_notice | doc3_registration | doc4_protocol | legacy_alias |
|---|---|---|---|---|---|---|---|---|---|---|
| package.signer.full_name | ФИО подписанта | scalar | documents:annual_meeting | package_role | new | ✓ | ✓ | — | — | — |
| package.signer.position | Должность подписанта | scalar | documents:annual_meeting | package_role | new | ✓ | ✓ | — | — | — |
| package.chairperson.full_name | ФИО председателя | scalar | documents:annual_meeting | package_role | new | — | — | — | ✓ | — |
| package.secretary.full_name | ФИО секретаря | scalar | documents:annual_meeting | package_role | new | — | — | — | ✓ | — |

### package — arrays (entity_type: package) — 2 записи, все new

| canonical_key | ui_label | scalar_array | token_context | resolver_scope | item_schema | status | doc1_order | doc2_notice | doc3_registration | doc4_protocol | legacy_alias |
|---|---|---|---|---|---|---|---|---|---|---|---|
| package.participants | Участники собрания | array | documents:annual_meeting | loop | full_name✱, share_percent✱, votes_count | new | — | — | — | ✓ | — |
| package.registered_persons | Зарегистрированные лица | array | documents:annual_meeting | loop | full_name✱, registration_time, representative, share_percent | new | — | — | ✓ | — | — |

### agenda (entity_type: agenda) — 1 запись, new

| canonical_key | ui_label | scalar_array | token_context | resolver_scope | item_schema | status | doc1_order | doc2_notice | doc3_registration | doc4_protocol | legacy_alias |
|---|---|---|---|---|---|---|---|---|---|---|---|
| agenda.items | Вопросы повестки дня | array | documents:annual_meeting | loop | number✱, title✱, speaker, decision_text, votes_for, votes_against, votes_abstained | new | ✓ | ✓ | — | ✓ | — |

### decision (entity_type: decision) — 1 запись, new

| canonical_key | ui_label | scalar_array | token_context | resolver_scope | item_schema | status | doc1_order | doc2_notice | doc3_registration | doc4_protocol | legacy_alias |
|---|---|---|---|---|---|---|---|---|---|---|---|
| decision.items | Принятые решения | array | documents:annual_meeting | loop | agenda_number✱, text✱, result | new | — | — | — | ✓ | — |

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
| Всего записей в registry | 97 |
| Reused 1:1 | 59 (47 legal_details + 12 meeting) |
| New add-only | 38 |
| Legacy aliases (known) | entity_name, entity_address, director_name, director_position, document_number, document_date |
| Array tokens | 4 (package.participants, package.registered_persons, agenda.items, decision.items) |
| Scalar role tokens | 4 (signer ×2, chairperson, secretary) |

---

## Gate conditions

- [ ] Matrix утверждена владельцем
- [ ] Все legacy_alias задокументированы
- [ ] Doc usage (doc1–doc4) проверен на соответствие реальным DOCX
- [ ] После утверждения — можно переходить к PATCH 2.6
