# Dry-run v3 — нормализация плейсхолдеров (PLACEHOLDERS-NORMALIZATION-2026-05-13)

Status: **DRY-RUN ONLY — execute не подтверждён**.
Дата: 2026-05-13.
Связанные артефакты: `placeholders_normalization_dryrun_2026_05_13.md` (v1), `.lovable/plan.md` (v3 approved).

## 0. SOT — таблицы и UI

| Entity | Actual table | Actual JSON path / columns | Used by renderer | Used by UI |
|---|---|---|---|---|
| ФЛ (individual) | `individual_requisites` | `data` jsonb (canonical keys из `INDIVIDUAL_CANONICAL_KEYS`, 16 ключей) | `_shared/document-token-resolver.ts`, `document-render.ts` | `IndividualRequisitesForm.tsx`, `IndividualDetailsForm.tsx` |
| ЮЛ (legal_entity) | `legal_entities_requisites` (`subject_type='legal_entity'`) | `data` jsonb (`LEGAL_ENTITY_CANONICAL_KEYS`, 15 ключей) | те же | `LegalEntityRequisitesForm.tsx`, `LegalEntityDetailsForm.tsx` |
| ИП (entrepreneur) | `legal_entities_requisites` (`subject_type='entrepreneur'`) | `data` jsonb (`ENTREPRENEUR_CANONICAL_KEYS`, 11 ключей) | те же | `LegalEntityRequisitesForm.tsx` (тот же компонент с `subject_type='entrepreneur'`), `EntrepreneurDetailsForm.tsx` |
| Адрес structured | `data.address_structured` (jsonb внутри `data`) | parts: street, house, building, apartment, city, district, city_district, region, postal_code, country | `formatStructuredAddress` в `_shared/document-render.ts` | компоненты адресных полей в `*RequisitesForm.tsx` |

`client_legal_details` — legacy. Read-only, остаётся для backward-compat (`useLegalDetails`/`legal_details` registry-секция).

---

## 1. Текущее состояние БД (на момент dry-run)

### 1.1 `document_token_registry` (active)

| Префикс | Кол-во | Замечания |
|---|---|---|
| `customer.*` (top-level) | 20 | включая `customer.address.full`, `customer.legal_address`, `customer.bank_name`, `customer.basis`, `customer.director*`, `customer.passport`, `customer.personal_number` |
| `customer.signer.*` | 4 | basis, full_name, initials, position |
| `executor.*` | 15 | без `executor.legal_address`, `executor.bank_name` |
| **Total customer/executor** | **39** | typed namespaces (`*.ind.*`, `*.leg.*`, `*.ent.*`) пока ОТСУТСТВУЮТ |

### 1.2 `fields_registry`

| entity_type | rows |
|---|---|
| customer | 20 |
| customer_signer | 4 |
| executor | 15 |
| user_requisites | 37 |
| legal_details | 47 |

### 1.3 `document_token_aliases`

43 строки. Активно используются для `{{payer.*}}`, `{{order.*}}`, `{{service.*}}`, `document.*` → `deal.*`. Канонический мост alias → token_key — таблица `document_token_aliases`. Колонка `meta.alias_of` НЕ нужна.

---

## 2. Архитектура целевая

Параллельные namespaces **поверх** существующих динамических токенов:

```
customer.ind.*    customer.leg.*    customer.ent.*
executor.ind.*    executor.leg.*    executor.ent.*
```

Динамические `customer.*` / `executor.*` остаются как "по типу плательщика" (резолв через `payer_type`). `customer.signer.*` / `executor.signer.*` — отдельная группа «Подписант», НЕ мерджится с «Руководитель».

Конвенция labels:
- typed: `«Заказчик ФЛ: Паспорт серия»`
- dynamic: `«Заказчик: Название / ФИО по типу плательщика»`
- signer: `«Заказчик подписант: ФИО»`

---

## 3. Точные counts (сверка с UI)

### 3.1 Заказчик ФЛ (`customer.ind.*`) — **26 токенов**

База — `INDIVIDUAL_CANONICAL_KEYS` (16) минус `address`/`address_structured` (заменяем на 11 address-tokens) плюс computed `full_name_short`:

| # | token_key | new_label | UI source | example |
|---|---|---|---|---|
| 1 | `customer.ind.full_name` | Заказчик ФЛ: ФИО | `data.full_name` | Иванов Иван Иванович |
| 2 | `customer.ind.full_name_short` | Заказчик ФЛ: ФИО кратко | computed | Иванов И. И. |
| 3 | `customer.ind.birth_date` | Заказчик ФЛ: Дата рождения | `data.birth_date` | 01.01.1990 |
| 4 | `customer.ind.personal_number` | Заказчик ФЛ: Личный номер | `data.personal_number` | 1234567A012PB5 |
| 5 | `customer.ind.passport_series` | Заказчик ФЛ: Паспорт серия | `data.passport_series` | MP |
| 6 | `customer.ind.passport_number` | Заказчик ФЛ: Паспорт номер | `data.passport_number` | 1234567 |
| 7 | `customer.ind.passport_number_full` | Заказчик ФЛ: Паспорт серия и номер | `data.passport_number_full` | MP1234567 |
| 8 | `customer.ind.passport_issued_by` | Заказчик ФЛ: Паспорт кем выдан | `data.passport_issued_by` | Партизанским РУВД г. Минска |
| 9 | `customer.ind.passport_issued_date` | Заказчик ФЛ: Паспорт дата выдачи | `data.passport_issued_date` | 15.05.2015 |
| 10 | `customer.ind.passport_valid_until` | Заказчик ФЛ: Паспорт действителен до | `data.passport_valid_until` | 15.05.2025 |
| 11 | `customer.ind.address.full` | Заказчик ФЛ: Адрес полный | computed via `formatStructuredAddress` | ул. Панфилова, д. 2, пом. 49л, г. Минск, 220035, Республика Беларусь |
| 12 | `customer.ind.address.street` | Заказчик ФЛ: Адрес улица | `data.address_structured.street` | Панфилова |
| 13 | `customer.ind.address.house` | Заказчик ФЛ: Адрес дом | `address_structured.house` | 2 |
| 14 | `customer.ind.address.building` | Заказчик ФЛ: Адрес корпус | `address_structured.building` | 1 |
| 15 | `customer.ind.address.apartment` | Заказчик ФЛ: Адрес помещение/квартира | `address_structured.apartment` | 49л |
| 16 | `customer.ind.address.city` | Заказчик ФЛ: Адрес населённый пункт | `address_structured.city` | Минск |
| 17 | `customer.ind.address.district` | Заказчик ФЛ: Адрес район | `address_structured.district` | — (Минск whitelist) |
| 18 | `customer.ind.address.city_district` | Заказчик ФЛ: Адрес район города | `address_structured.city_district` | — (Минск whitelist) |
| 19 | `customer.ind.address.region` | Заказчик ФЛ: Адрес область | `address_structured.region` | — (Минск whitelist) |
| 20 | `customer.ind.address.postal_code` | Заказчик ФЛ: Адрес индекс | `address_structured.postal_code` | 220035 |
| 21 | `customer.ind.address.country` | Заказчик ФЛ: Адрес страна | `address_structured.country` | Республика Беларусь |
| 22 | `customer.ind.bank_account` | Заказчик ФЛ: Расчётный счёт / IBAN | `data.bank_account` | BY00ALFA30120000000000000000 |
| 23 | `customer.ind.bank_name` | Заказчик ФЛ: Банк | `data.bank_name` | ЗАО «Альфа-Банк» |
| 24 | `customer.ind.bank_code` | Заказчик ФЛ: БИК / код банка | `data.bank_code` | ALFABY2X |
| 25 | `customer.ind.phone` | Заказчик ФЛ: Телефон | `data.phone` | +375 29 123-45-67 |
| 26 | `customer.ind.email` | Заказчик ФЛ: Email | `data.email` | client@example.by |

### 3.2 Заказчик ЮЛ (`customer.leg.*`) — **24 токена**

База — `LEGAL_ENTITY_CANONICAL_KEYS` (15) минус `address`/`address_structured` плюс 11 address-tokens:

| # | token_key | new_label | UI source | example |
|---|---|---|---|---|
| 1 | `customer.leg.org_form` | Заказчик ЮЛ: Форма собственности | `data.org_form` | ООО |
| 2 | `customer.leg.name` | Заказчик ЮЛ: Название | `data.name` | ООО "Ромашка" |
| 3 | `customer.leg.short_name` | Заказчик ЮЛ: Краткое название | `data.short_name` | ООО "Ромашка" |
| 4 | `customer.leg.unp` | Заказчик ЮЛ: УНП | `data.unp` | 123456789 |
| 5 | `customer.leg.director_position` | Заказчик ЮЛ: Руководитель должность | `data.director_position` | Директор |
| 6 | `customer.leg.director_full_name` | Заказчик ЮЛ: Руководитель ФИО | `data.director_full_name` | Иванов Иван Иванович |
| 7 | `customer.leg.director_short_name` | Заказчик ЮЛ: Руководитель ФИО кратко | `data.director_short_name` | Иванов И. И. |
| 8 | `customer.leg.acts_on_basis` | Заказчик ЮЛ: Руководитель действует на основании | `data.acts_on_basis` | Устава |
| 9 | `customer.leg.address.full` | Заказчик ЮЛ: Адрес полный | computed | ул. Панфилова, д. 2, г. Минск, 220035, Республика Беларусь |
| 10–19 | `customer.leg.address.{street\|house\|building\|apartment\|city\|district\|city_district\|region\|postal_code\|country}` | Заказчик ЮЛ: Адрес {улица/дом/корпус/помещение/населённый пункт/район/район города/область/индекс/страна} | `address_structured.*` | ... |
| 20 | `customer.leg.bank_account` | Заказчик ЮЛ: Расчётный счёт / IBAN | `data.bank_account` | BY00ALFA30120000000000000000 |
| 21 | `customer.leg.bank_name` | Заказчик ЮЛ: Банк | `data.bank_name` | ЗАО «Альфа-Банк» |
| 22 | `customer.leg.bank_code` | Заказчик ЮЛ: БИК / код банка | `data.bank_code` | ALFABY2X |
| 23 | `customer.leg.phone` | Заказчик ЮЛ: Телефон | `data.phone` | +375 17 200-00-00 |
| 24 | `customer.leg.email` | Заказчик ЮЛ: Email | `data.email` | office@romashka.by |

**Терминология:** `Руководитель` = лицо, подписывающее документ от имени стороны (не обязательно «Директор» по штатному расписанию). Поле `Руководитель должность` = «Директор» / «Юрисконсульт» / «Представитель» / …. Поле `Руководитель действует на основании` = «Устава» / «Доверенности № X от …» / …

### 3.3 Заказчик ИП (`customer.ent.*`) — **24 токена**

База — `ENTREPRENEUR_CANONICAL_KEYS` (11) минус `address`/`address_structured` плюс 11 address-tokens плюс **4 токена руководителя/подписанта**:

| # | token_key | new_label | UI source | example |
|---|---|---|---|---|
| 1 | `customer.ent.name` | Заказчик ИП: ФИО | `data.name` | Федорчук Сергей Валерьевич |
| 2 | `customer.ent.short_name` | Заказчик ИП: ФИО кратко | `data.short_name` | Федорчук С. В. |
| 3 | `customer.ent.unp` | Заказчик ИП: УНП | `data.unp` | 192345678 |
| 4 | `customer.ent.acts_on_basis` | Заказчик ИП: Действует на основании | `data.acts_on_basis` | Свидетельства о государственной регистрации |
| 5 | `customer.ent.director_position` | Заказчик ИП: Руководитель должность | `data.ent_director_position` ?? default `Индивидуальный предприниматель` | Индивидуальный предприниматель |
| 6 | `customer.ent.director_full_name` | Заказчик ИП: Руководитель ФИО | `data.ent_director_full_name` ?? default `data.name` | Федорчук Сергей Валерьевич |
| 7 | `customer.ent.director_short_name` | Заказчик ИП: Руководитель ФИО кратко | `data.ent_director_short_name` ?? default `data.short_name` | Федорчук С. В. |
| 8 | `customer.ent.director_acts_on_basis` | Заказчик ИП: Руководитель действует на основании | `data.ent_director_acts_on_basis` ?? default `data.acts_on_basis` | Свидетельства о государственной регистрации |
| 9 | `customer.ent.address.full` | Заказчик ИП: Адрес полный | computed | ... |
| 10–19 | `customer.ent.address.{...}` | Заказчик ИП: Адрес {...} | `address_structured.*` | ... |
| 20 | `customer.ent.bank_account` | Заказчик ИП: Расчётный счёт / IBAN | `data.bank_account` | BY00 |
| 21 | `customer.ent.bank_name` | Заказчик ИП: Банк | `data.bank_name` | ЗАО «Альфа-Банк» |
| 22 | `customer.ent.bank_code` | Заказчик ИП: БИК / код банка | `data.bank_code` | ALFABY2X |
| 23 | `customer.ent.phone` | Заказчик ИП: Телефон | `data.phone` | +375 29 ... |
| 24 | `customer.ent.email` | Заказчик ИП: Email | `data.email` | ip@example.by |

**Override руководителя ИП:** дефолт = ФИО самого ИП + «Индивидуальный предприниматель» + acts_on_basis из реквизитов; пользователь может перекрыть `ent_director_position`/`ent_director_full_name`/`ent_director_short_name`/`ent_director_acts_on_basis` через UI-секцию «Подписант / Руководитель» в форме ИП. Хранится в **существующем jsonb `data`** — никаких новых SQL-колонок.

### 3.4 Исполнитель — зеркально

| Block | Tokens |
|---|---|
| `executor.ind.*` | 26 |
| `executor.leg.*` | 24 |
| `executor.ent.*` | 24 |

### 3.5 Итог typed (новые INSERT)

| Block | Customer | Executor |
|---|---|---|
| ФЛ (`*.ind.*`) | 26 | 26 |
| ЮЛ (`*.leg.*`) | 24 | 24 |
| ИП (`*.ent.*`) | 24 | 24 |
| **Sub-total** | **74** | **74** |
| **Total typed (INSERT)** | | **148** |

### 3.6 Динамические (relabel only)

| token_key | new_label |
|---|---|
| `customer.name` | Заказчик: Название / ФИО по типу плательщика |
| `customer.short_name` | Заказчик: Краткое название / ФИО по типу плательщика |
| `customer.address` | Заказчик: Адрес по типу плательщика |
| `customer.address.full` | Заказчик: Адрес полный по типу плательщика |
| `customer.unp` | Заказчик: УНП (ЮЛ/ИП) |
| `customer.account` | Заказчик: Расчётный счёт / IBAN по типу плательщика |
| `customer.bank` | Заказчик: Банк по типу плательщика |
| `customer.bank_code` | Заказчик: БИК / код банка по типу плательщика |
| `customer.acts_on_basis` | Заказчик: Руководитель действует на основании (ЮЛ/ИП) |
| `customer.email` | Заказчик: Email |
| `customer.phone` | Заказчик: Телефон |
| `customer.client_type` | Заказчик: Тип плательщика |

12 customer + 12 executor (`executor.address.full` отсутствует в БД — добавим INSERT) = **24 dynamic** (23 UPDATE + 1 INSERT `executor.address.full`).

### 3.7 Подписант (relabel only)

| token_key | new_label |
|---|---|
| `customer.signer.position` | Заказчик подписант: Должность |
| `customer.signer.full_name` | Заказчик подписант: ФИО |
| `customer.signer.initials` | Заказчик подписант: ФИО кратко |
| `customer.signer.basis` | Заказчик подписант: Действует на основании |

4 customer + 4 executor (executor.signer.* в БД отсутствует — INSERT) = **8 signer**.

---

## 4. Soft-deprecate + alias

| legacy token_key | canonical | reason | action |
|---|---|---|---|
| `customer.director` | `customer.leg.director_full_name` | rename, label был «директор» | archived_at + alias |
| `customer.director_full_name` | `customer.leg.director_full_name` | typed dup | archived_at + alias |
| `customer.director_short` | `customer.leg.director_short_name` | typed dup | archived_at + alias |
| `customer.director_position` | `customer.leg.director_position` | typed dup | archived_at + alias |
| `customer.basis` | `customer.acts_on_basis` | duplicate | archived_at + alias |
| `customer.bank_name` | `customer.bank` | duplicate (top-level dynamic) | archived_at + alias |
| `customer.legal_address` | `customer.address` | duplicate | archived_at + alias |
| `customer.passport` | `customer.ind.passport_number_full` | rename | archived_at + alias |
| `customer.personal_number` | `customer.ind.personal_number` | rename | archived_at + alias |
| executor mirror (5 шт.) | executor mirror | — | archived_at + alias |

**Total soft-deprecated:** 9 customer + 5 executor = **14**.
**Total aliases insert:** 14 (1:1 с soft-deprecated; алиасы `{{payer.*}}` остаются неизменными).

---

## 5. ИП без кавычек — отдельная секция

### 5.1 Правило

| Сущность | Формат | Пример |
|---|---|---|
| ЮЛ | `{org_form} "{name}"` | ООО "Ромашка" |
| ИП | `ИП {full_name}` (без кавычек) | ИП Федорчук Сергей Валерьевич |
| ФЛ | `{full_name}` | Иванов Иван Иванович |

Кавычки запрещены вокруг ФИО ИП. Формы собственности (`ИП`, `ООО`, `ЗАО`, `ОАО`, `УП`, `ЧУП`) **никогда** не оборачиваются в кавычки.

### 5.2 Точки правки

| Файл | Что меняется |
|---|---|
| `supabase/functions/_shared/document-token-resolver.ts` | composer для `customer.ent.name` / `executor.ent.name` / dynamic `customer.name` при `payer_type=entrepreneur` собирает `«ИП » + data.name` без кавычек |
| `supabase/functions/_shared/document-render.ts` | `formatStructuredAddress` не трогаем; добавляем `formatEntrepreneurDisplayName(name)` → `ИП ${name}` |
| `src/utils/inflectCompanyName.ts` (если есть) | guard: для ИП не оборачивать |
| `document_token_registry.example_value` для ИП | новые INSERT уже без кавычек (см. таблицу 3.3) |
| `PlaceholdersCatalogTab.tsx` | preview-колонка использует `example_value` напрямую |

### 5.3 DoD

- Smoke DOCX/PDF для `payer_type=entrepreneur` рендерит `ИП Федорчук Сергей Валерьевич` без кавычек.
- Catalog preview для `customer.ent.name` отображается как `ИП Федорчук Сергей Валерьевич`.
- Старые шаблоны со «вшитыми» кавычками (`ИП "..."`) читаются (не ломаются), но canonical output — без кавычек.
- Audit event: `document_tokens.entrepreneur_quotes_format_normalized`.

---

## 6. UI-каталог: 9 групп

| Группа | Источник | Кол-во |
|---|---|---|
| Заказчик ФЛ | `customer.ind.*` | 26 |
| Заказчик ЮЛ | `customer.leg.*` | 24 |
| Заказчик ИП | `customer.ent.*` | 24 |
| Исполнитель ФЛ | `executor.ind.*` | 26 |
| Исполнитель ЮЛ | `executor.leg.*` | 24 |
| Исполнитель ИП | `executor.ent.*` | 24 |
| Динамические | `customer.*` / `executor.*` (top-level) | 24 |
| Подписант | `*.signer.*` | 8 |
| Системные / Документ / Сделка / Оплата | прочие | без изменений |

Внутри группы label показывается с обрезанным префиксом («Паспорт серия»), полный label («Заказчик ФЛ: Паспорт серия») — в поиске и tooltip.

DoD поиска:
- «Заказчик ФЛ паспорт» → `customer.ind.passport_*`
- «ИП руководитель доверенность» → `customer.ent.director_acts_on_basis`
- «Исполнитель ЮЛ расчетный счет» → `executor.leg.bank_account`

---

## 7. UI-поля без token / token без UI

### UI без token (после execute — 0)

Все 16 ind + 15 leg + 11 ent UI-canonical ключей покрыты (с учётом того что `address`/`address_structured` развёрнуты в 11 address-tokens, а `address_structured` сам по себе — служебный).

### Token без UI (после execute — 1 декларированный)

- `customer.ent.director_*` (4 токена) — UI-секция «Подписант / Руководитель» в форме ИП требует докрутки в `LegalEntityRequisitesForm.tsx` (`subject_type='entrepreneur'`). Хранение в `data.ent_director_*`. Фронт-добавка делается в этом же спринте.

---

## 8. Миграция (один transaction)

```
ALTER TABLE document_templates ADD COLUMN deleted_at timestamptz;
CREATE INDEX idx_document_templates_active ON document_templates(id) WHERE deleted_at IS NULL;

INSERT INTO document_token_registry (token_key, ui_label, category, source_type, data_type, example_value, ...)
VALUES (...148 строк...);

UPDATE document_token_registry SET ui_label='...' WHERE token_key IN (...23 dynamic + 8 signer...);

INSERT INTO document_token_aliases (alias_token, canonical_token_key, notes, metadata)
VALUES (...14 строк...);

UPDATE document_token_registry
  SET archived_at = now(), archive_reason='soft_deprecated_v3_typed_tokens'
  WHERE token_key IN (...14 строк...);

INSERT INTO audit_logs (event, ...)
VALUES
  ('document_tokens.typed_namespace_added', ...),
  ('document_tokens.dynamic_relabeled', ...),
  ('document_tokens.signer_relabeled', ...),
  ('document_tokens.aliases_added', ...),
  ('document_tokens.duplicates_soft_deprecated', ...),
  ('document_tokens.entrepreneur_quotes_format_normalized', ...),
  ('document_templates.deleted_at_added', ...);
```

---

## 9. Code-changes (preview)

| Файл | Что |
|---|---|
| `supabase/functions/_shared/document-token-resolver.ts` | резолверы для 6 typed namespaces; ИП-композер без кавычек; ИП-руководитель: дефолт + override через `data.ent_director_*` |
| `supabase/functions/_shared/document-render.ts` | `formatEntrepreneurDisplayName`; расширить `formatStructuredAddress` на 6 namespaces |
| `supabase/functions/canonical-document-generate-strict/index.ts` | guard `template.deleted_at IS NULL` (warning, не hard fail при `template_override`) |
| `src/hooks/useDocumentTemplates.tsx` | фильтр `deleted_at IS NULL` + soft-delete action |
| `src/components/admin/DealPayerDocumentsCard.tsx` | warning при удалённом `template_override` |
| `src/components/ai-documents/PlaceholdersCatalogTab.tsx` | 9 групп + preview column |
| `src/components/requisites-v2/LegalEntityRequisitesForm.tsx` | для `subject_type='entrepreneur'` секция «Подписант / Руководитель» с 4 полями override |
| `src/lib/requisites-v2/fieldMap.ts` | расширить `ENTREPRENEUR_CANONICAL_KEYS` ключами `ent_director_position`/`ent_director_full_name`/`ent_director_short_name`/`ent_director_acts_on_basis` |
| `src/utils/templateAutoSuggest.ts` | обновить ссылки на canonical token_keys |

---

## 10. STOP-guards (повтор)

- `payments_v2`, `orders_v2`, `allocate_document_number` — не трогаем
- document scenarios — не трогаем
- Contact Center — не трогаем
- Морфология — не трогаем
- Hard-delete токенов запрещён
- Production-шаблоны не удаляются
- Подписант (`*.signer.*`) не мерджится с руководителем
- Никаких новых SQL-колонок ради ИП-руководителя — только `data.ent_director_*` jsonb
- Alias-механизм — существующая `document_token_aliases`, никаких новых таблиц/колонок
- Soft-delete templates делается в этом же спринте, но ОТДЕЛЬНОЙ миграцией (порядок: 1) deleted_at + guards, 2) placeholders typed INSERT/UPDATE)
- В новых артефактах — только UUID и отображаемое product_name, никаких product code

---

## 11. Verify-план

1. `tsc --noEmit` clean
2. `deno check` clean (для edge functions)
3. Smoke DOCX/PDF для трёх payer_type:
   - **ФЛ:** ФИО, паспорт серия, паспорт номер, паспорт серия+номер, адрес полный, банк/IBAN
   - **ЮЛ:** название, форма собственности, УНП, руководитель должность, руководитель ФИО, действует на основании, адрес полный, банк/IBAN
   - **ИП:** `ИП Федорчук Сергей Валерьевич` без кавычек, УНП, руководитель автозаполнен, override руководителя (Представитель + Доверенность) перекрывает дефолт
4. Alias smoke: `{{customer.director}}` рендерится корректно через alias на `customer.leg.director_full_name`
5. Адрес для Минска: `ул. Панфилова, д. 2, г. Минск, 220035, Республика Беларусь` (без района/области)
6. UI: `/admin/ai-documents` группирует по 9 секциям; поиск находит по русскому labels
7. `unresolved_count = 0` для всех трёх payer_type на тестовом шаблоне со 148 typed + 24 dynamic + 8 signer токенами

---

## 12. Что ждёт подтверждения перед execute

1. Counts в этом dry-run: 148 typed INSERT, 31 UPDATE labels, 14 aliases, 14 soft-deprecated, 1 миграция (`deleted_at`).
2. ИП без кавычек — правило закреплено.
3. Подписант не мерджится; руководитель ИП с override.
4. 3 паспортных поля (series + number + number_full) — все три остаются.
5. Расширение `ENTREPRENEUR_CANONICAL_KEYS` на 4 director-override ключа в jsonb (без SQL-колонок).

**STOP. Жду подтверждения «execute v3», после чего одной волной:**
1. Migration `deleted_at`.
2. Massive INSERT/UPDATE токенов + aliases + archived_at (через `supabase--insert`).
3. Code-changes (resolver/render/UI).
4. Smoke + verify report → `placeholders_normalization_v3_report_2026_05_13.md`.
