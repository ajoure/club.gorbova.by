# Sprint 3E — Package UL/IP/FL Requisites Alignment

**Дата:** 2026-05-28
**Статус:** completed
**Финальная формулировка:** `completed: package UL/IP/FL requisites aligned with billing requisites structure; missing fields resolved or explicitly deferred; package placeholders ready for real DOCX authoring; generation still deferred`

---

## 1. Before snapshot (после Sprint 3D)

В UI `/admin/documents` → «Каталог плейсхолдеров» строки в группах «Пакет: ЮЛ / ИП / ФЛ» имели статусы:

- UL: 14 `copy_ready` + 8 адресных `copy_ready` ссылались на **несуществующие колонки** (`leg_address_street/house/...country`) + 2 `missing_source_column` (район).
- IP: аналогично — 8 адресных `copy_ready` на несуществующих `ent_address_*` + 2 район + 4 «руководитель» `deferred`.
- FL: 12 `copy_ready` (имя/паспорт/контакты) + 11 адресных `pending_field` + 3 банковских `missing_source_column`.

Главная проблема: каталог обещал copy_ready, но source-колонок физически не было (false positive). Bank-реквизиты ФЛ были вообще невозможны.

---

## 2. Discovery (актуальная схема)

### 2.1. `client_legal_details` — реальные адресные колонки

- Плоских `leg_address_street/house/...country` и `ent_address_street/...country` **НЕТ**.
- Есть `leg_address` (строка), `leg_address_structured` (jsonb), аналогично `ent_address` + `ent_address_structured`.

→ Решение: jsonb-path вместо несуществующих плоских колонок (см. §3).

### 2.2. `legal_details_persons` (до миграции)

- Адрес: только `address_structured` (jsonb), плоских колонок нет.
- Bank: **отсутствовал полностью** (нет `bank_account / bank_name / bank_code`).

→ Решение: миграция `ADD COLUMN bank_account/bank_name/bank_code` (см. §4).

### 2.3. `fields_registry` (entity_type=`legal_details`)

47 биллинговых FLD (FLD-000004..050) полностью покрывают переиспользование. Новых FLD в Sprint 3E **не создавалось**.

---

## 3. Mapping-таблица

### 3.1. Пакет: ЮЛ — 24/24

| # | Поле | Status | Source path | Reused FLD |
|---|------|--------|-------------|------------|
| 1  | Название | copy_ready | `client_legal_details.leg_name` | FLD-000011 |
| 2  | Краткое название | copy_ready | `client_legal_details.leg_name` | FLD-000011 |
| 3  | Форма собственности | copy_ready | `client_legal_details.leg_org_form` | FLD-000010 |
| 4  | УНП | copy_ready | `client_legal_details.leg_unp` | FLD-000009 |
| 5  | Юридический адрес (полный) | copy_ready | `client_legal_details.leg_address` | FLD-000012 |
| 6  | Руководитель ФИО | copy_ready | `client_legal_details.leg_director_name` | FLD-000014 |
| 7  | Руководитель ФИО (кратко) | copy_ready | `client_legal_details.leg_director_name` | FLD-000014 |
| 8  | Руководитель должность | copy_ready | `client_legal_details.leg_director_position` | FLD-000013 |
| 9  | Действует на основании | copy_ready | `client_legal_details.leg_acts_on_basis` | FLD-000015 |
| 10 | Банк | copy_ready | `client_legal_details.bank_name` | FLD-000005 |
| 11 | БИК / код банка | copy_ready | `client_legal_details.bank_code` | FLD-000006 |
| 12 | Расчётный счёт / IBAN | copy_ready | `client_legal_details.bank_account` | FLD-000004 |
| 13 | Телефон | copy_ready | `client_legal_details.phone` | FLD-000007 |
| 14 | Email | copy_ready | `client_legal_details.email` | FLD-000008 |
| 15 | Адрес: улица | copy_ready | `leg_address_structured->>'street'` | FLD-000035 |
| 16 | Адрес: дом | copy_ready | `leg_address_structured->>'house'` | FLD-000036 |
| 17 | Адрес: корпус | copy_ready | `leg_address_structured->>'building'` | FLD-000037 |
| 18 | Адрес: помещение/квартира | copy_ready | `leg_address_structured->>'apartment'` | FLD-000038 |
| 19 | Адрес: населённый пункт | copy_ready | `leg_address_structured->>'city'` | FLD-000039 |
| 20 | Адрес: область | copy_ready | `leg_address_structured->>'region'` | FLD-000040 |
| 21 | Адрес: индекс | copy_ready | `leg_address_structured->>'postal_code'` | FLD-000041 |
| 22 | Адрес: страна | copy_ready | `leg_address_structured->>'country'` | FLD-000042 |
| 23 | Адрес: район | **pending_field** | jsonb есть, FLD `leg_address_district` отсутствует | — |
| 24 | Адрес: район города | **pending_field** | jsonb есть, FLD `leg_address_city_district` отсутствует | — |

**Итог:** 22 copy_ready + 2 pending_field (с указанием причины). Без новых FLD — backlog (требуют manifest-proof).

### 3.2. Пакет: ИП — 24/24

| # | Поле | Status | Source path | Reused FLD |
|---|------|--------|-------------|------------|
| 1  | ФИО | copy_ready | `client_legal_details.ent_name` | FLD-000017 |
| 2  | ФИО (кратко) | copy_ready | `client_legal_details.ent_name` | FLD-000017 |
| 3  | УНП | copy_ready | `client_legal_details.ent_unp` | FLD-000016 |
| 4  | Адрес полный | copy_ready | `client_legal_details.ent_address` | FLD-000018 |
| 5  | Действует на основании | copy_ready | `client_legal_details.ent_acts_on_basis` | FLD-000019 |
| 6  | Банк | copy_ready | `bank_name` | FLD-000005 |
| 7  | БИК / код банка | copy_ready | `bank_code` | FLD-000006 |
| 8  | Расчётный счёт / IBAN | copy_ready | `bank_account` | FLD-000004 |
| 9  | Телефон | copy_ready | `phone` | FLD-000007 |
| 10 | Email | copy_ready | `email` | FLD-000008 |
| 11 | Адрес: улица | copy_ready | `ent_address_structured->>'street'` | FLD-000043 |
| 12 | Адрес: дом | copy_ready | `ent_address_structured->>'house'` | FLD-000044 |
| 13 | Адрес: корпус | copy_ready | `ent_address_structured->>'building'` | FLD-000045 |
| 14 | Адрес: помещение/квартира | copy_ready | `ent_address_structured->>'apartment'` | FLD-000046 |
| 15 | Адрес: населённый пункт | copy_ready | `ent_address_structured->>'city'` | FLD-000047 |
| 16 | Адрес: область | copy_ready | `ent_address_structured->>'region'` | FLD-000048 |
| 17 | Адрес: индекс | copy_ready | `ent_address_structured->>'postal_code'` | FLD-000049 |
| 18 | Адрес: страна | copy_ready | `ent_address_structured->>'country'` | FLD-000050 |
| 19 | Адрес: район | **pending_field** | jsonb есть, FLD отсутствует | — |
| 20 | Адрес: район города | **pending_field** | jsonb есть, FLD отсутствует | — |
| 21 | Руководитель ФИО | **deferred** | резолвер: ИП = сам предприниматель (Sprint 3F) | FLD-000017 |
| 22 | Руководитель ФИО (кратко) | **deferred** | см. п.21 | — |
| 23 | Руководитель должность | **deferred** | фиксированная для ИП | — |
| 24 | Руководитель действует на основании | **deferred** | дубль ent_acts_on_basis | — |

**Итог:** 18 copy_ready + 2 pending_field + 4 deferred (вынесены в Sprint 3F с обоснованием).

### 3.3. Пакет: ФЛ — 26/26

| # | Поле | Status | Source path | Reused FLD |
|---|------|--------|-------------|------------|
| 1  | ФИО | copy_ready | `legal_details_persons.full_name` | FLD-000372 |
| 2  | ФИО кратко | copy_ready | `legal_details_persons.full_name` | FLD-000372 |
| 3  | Дата рождения | copy_ready | `legal_details_persons.birth_date` | FLD-000021 |
| 4  | Личный номер | copy_ready | `legal_details_persons.personal_number` | FLD-000027 |
| 5  | Паспорт серия | copy_ready | `legal_details_persons.passport_series` | FLD-000022 |
| 6  | Паспорт номер | copy_ready | `legal_details_persons.passport_number` | FLD-000023 |
| 7  | Паспорт серия и номер | copy_ready | `legal_details_persons.passport_number_full` | FLD-000023 |
| 8  | Паспорт кем выдан | copy_ready | `legal_details_persons.passport_issued_by` | FLD-000024 |
| 9  | Паспорт дата выдачи | copy_ready | `legal_details_persons.passport_issued_date` | FLD-000025 |
| 10 | Паспорт действителен до | copy_ready | `legal_details_persons.passport_valid_until` | FLD-000026 |
| 11 | Телефон | copy_ready | `legal_details_persons.phone` | FLD-000007 |
| 12 | Email | copy_ready | `legal_details_persons.email` | FLD-000008 |
| 13 | Адрес: улица | copy_ready | `address_structured->>'street'` | FLD-000032 |
| 14 | Адрес: дом | copy_ready | `address_structured->>'house'` | FLD-000033 |
| 15 | Адрес: помещение/квартира | copy_ready | `address_structured->>'apartment'` | FLD-000034 |
| 16 | Адрес: населённый пункт | copy_ready | `address_structured->>'city'` | FLD-000031 |
| 17 | Адрес: область | copy_ready | `address_structured->>'region'` | FLD-000029 |
| 18 | Адрес: район | copy_ready | `address_structured->>'district'` | FLD-000030 |
| 19 | Адрес: индекс | copy_ready | `address_structured->>'postal_code'` | FLD-000028 |
| 20 | Адрес: полный | **pending_field** | jsonb есть, нужен FLD ind_address_full | — |
| 21 | Адрес: корпус | **pending_field** | jsonb есть, FLD ind_address_building отсутствует | — |
| 22 | Адрес: район города | **pending_field** | jsonb есть, FLD отсутствует | — |
| 23 | Адрес: страна | **pending_field** | jsonb есть, FLD отсутствует | — |
| 24 | Расчётный счёт / IBAN | **copy_ready (NEW)** | `legal_details_persons.bank_account` | FLD-000004 |
| 25 | Банк | **copy_ready (NEW)** | `legal_details_persons.bank_name` | FLD-000005 |
| 26 | БИК / код банка | **copy_ready (NEW)** | `legal_details_persons.bank_code` | FLD-000006 |

**Итог:** 22 copy_ready + 4 pending_field.

---

## 4. Applied migration

```sql
ALTER TABLE public.legal_details_persons
  ADD COLUMN IF NOT EXISTS bank_account text,
  ADD COLUMN IF NOT EXISTS bank_name    text,
  ADD COLUMN IF NOT EXISTS bank_code    text;

COMMENT ON COLUMN public.legal_details_persons.bank_account IS 'Sprint 3E: расчётный счёт / IBAN физлица для пакетных документов';
COMMENT ON COLUMN public.legal_details_persons.bank_name    IS 'Sprint 3E: название банка физлица';
COMMENT ON COLUMN public.legal_details_persons.bank_code    IS 'Sprint 3E: БИК / код банка физлица';
```

- nullable, без backfill, без CHECK-constraints.
- RLS/GRANT не изменялись (используется существующая политика persons).
- Линтер: 181 pre-existing предупреждений; новых ошибок не добавлено.
- Новых FLD не вставлялось (duplicate-check показал: всё уже есть в FLD-000004..050).

---

## 5. UI proof

### 5.1. ЮЛ / ИП (`OrganizationDetailsForm`, `EntrepreneurDetailsForm`)

Уже до Sprint 3E (без изменений в этом спринте):
- УНП-autofill (`useGrpLookup`) пишет в `client_legal_details.leg_*` / `ent_*` через `useLegalDetails`, не в billing-only слой.
- `StructuredAddressBlock` + `LegalEntityAddressAdapter` / `EntrepreneurAddressAdapter` сохраняет адрес в `leg_address_structured` / `ent_address_structured` (jsonb).
- Google-обогащение: `enrichAddressViaGoogle` (через connector gateway).
- Bank поля (`bank_account / bank_name / bank_code`) + phone + email присутствуют.

### 5.2. ФЛ (`PersonFieldsForm`) — Sprint 3E patch

В `src/components/ai-requisites/PersonFieldsForm.tsx` добавлены:
- 3 state: `bankAccount, bankName, bankCode`.
- Новая карточка «Банковские реквизиты» (icon `Landmark`) с IBAN (uppercase, maxLength=28), банком, БИК.
- В submit `data` пишутся `bank_account / bank_name / bank_code` (uppercase для account/code).
- `PERSON_FIELD_KEYS` расширен ключами `bank_account / bank_name / bank_code` → FLD-000004/5/6 (через `useLegalDetailsFields`).
- Адрес уже сохранялся в `address_structured` через `StructuredAddressBlock` — не трогали.

UNP-autofill для ФЛ отсутствует by design (нет публичного реестра физлиц).

---

## 6. Billing regression (без генерации)

- Группы «Заказчик ЮЛ / ИП / ФЛ» (FLD-000273..346) — НЕ изменены.
- Группа «Исполнитель ЮЛ» — НЕ изменена.
- FLD-000004..050 — не модифицировались (миграция не трогает `fields_registry`).
- Существующие шаблоны акта/счёта — не трогались; формат биллингового `{{field:FLD-XXXXXX}}` не менялся.
- `canonical-document-generate-strict`, Gotenberg, `ai_generated_documents` — НЕ вызывались.

---

## 7. Tests

`bunx vitest run src/utils/packagePlaceholderCatalog.test.ts` → **10/10 passed** (8 Sprint 3D + 2 новых Sprint 3E):
- ✔ адресный breakdown copy_ready имеет jsonb-path (`_structured->>'...'`).
- ✔ FL `bank_*` × 3 → copy_ready через `legal_details_persons.bank_*`.

---

## 8. Final placeholder status

| Группа | copy_ready | pending_field | deferred | Всего |
|---|---|---|---|---|
| Пакет: ЮЛ | 22 | 2 | 0 | 24 |
| Пакет: ИП | 18 | 2 | 4 | 24 |
| Пакет: ФЛ | 22 | 4 | 0 | 26 |
| **Итого** | **62** | **8** | **4** | **74** |

Все 74 поля либо copy_ready, либо явно deferred/pending с письменной причиной.

---

## 9. DoD checklist

- [x] Mapping-таблица: ЮЛ 24/24, ИП 24/24, ФЛ 26/26 — каждая строка имеет copy_ready или explicit deferred + reason.
- [x] `legal_details_persons.bank_*` колонки существуют (миграция применена).
- [x] `packagePlaceholderCatalog.ts` обновлён: jsonb-path для адресов UL/IP/FL; bank_* для FL → copy_ready.
- [x] UI `PersonFieldsForm` поддерживает банк-реквизиты + structured-адрес.
- [x] UI `EntrepreneurDetailsForm` уже использовал structured-address + bank + UNP autofill (не требовал изменений).
- [x] UNP autofill + Google Maps пишут в `client_legal_details.*`, не в billing-only слой.
- [x] Billing FLD-000004..050 не изменены.
- [x] Генерация не запускалась; Gotenberg/`ai_generated_documents`/`canonical-document-generate-strict` не тронуты.
- [x] Memory обновлено: `mem://architecture/documents/package-token-aliases-v1`.
- [x] Тесты: 10/10 passed.

**Финальный статус:** `completed: package UL/IP/FL requisites aligned with billing requisites structure; missing fields resolved or explicitly deferred; package placeholders ready for real DOCX authoring; generation still deferred`.
