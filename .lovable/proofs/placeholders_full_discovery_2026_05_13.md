# Отчет о выполнении: полный read-only discovery плейсхолдеров и UI реквизитов

Дата: 2026-05-13
Режим: read-only. Никаких миграций, токенов, labels, резолверов, шаблонов, кода UI не менялось.
SOT: `document_token_registry`, `fields_registry`, `legal_entities_requisites`, `individual_requisites`, `src/components/ai-documents/PlaceholdersCatalogTab.tsx`, `src/components/requisites-v2/*`, `src/lib/requisites-v2/fieldMap.ts`.

---

## 0. TL;DR — главная причина текущего хаоса

| Источник проблемы | Влияние |
|---|---|
| **Проблема UI-фильтрации (самая критичная)** | `PlaceholdersCatalogTab` строка 179: `if (!r.field_id || !publicId) skipped++; continue;` — режет ВСЕ токены без `field_id`. |
| **Проблема данных registry** | 154 активных токена в `document_token_registry` существуют **без `field_id`** (по проекту так и задумывались — это runtime-резолверы через `resolver_key`), но UI считает их «битыми». |
| **Проблема группировки** | `SECTION_DEFINITIONS[9].categories` смешивает `system + document + deal + payment + contact + product + tariff + offer + legal_details` в одну секцию «Системные / Документ / Сделка / Оплата» (81 токен). |
| **Проблема отсутствующих токенов** | Реальных `missing_token` нет — токены ФЛ/ЮЛ/ИП существуют и заполнены (по 24–26 строк на сущность). Они просто невидимы UI. |
| **Проблема лишних/orphan токенов** | `executor.signer.*` (4 шт.) — без `field_id`, источника заполнения в UI реквизитов нет (override-only); `customer.signer.*` (4 шт.) — с `field_id`, но та же ситуация (нет UI-источника). |

**Вывод:** массовое добавление новых токенов НЕ нужно. Нужна одна точечная правка UI каталога + ревью группировки.

---

## 1. Фактическая структура UI реквизитов

Маршрут: `/settings/legal-details` → `RequisitesV2Manager`.
Три вкладки = три `subject_type`:

| Вкладка UI | subject_type | Таблица БД | Форма |
|---|---|---|---|
| Физлицо | `individual` | `individual_requisites` | `IndividualRequisitesForm.tsx` |
| Организация (ЮЛ) | `legal_entity` | `legal_entities_requisites` | `LegalEntityRequisitesForm.tsx` |
| ИП | `entrepreneur` | `legal_entities_requisites` | `LegalEntityRequisitesForm.tsx` (тот же компонент, режим ИП) |

Каноничные ключи в JSONB `data` (SOT — `src/lib/requisites-v2/fieldMap.ts`):

### 1.1 ЮЛ (`LEGAL_ENTITY_CANONICAL_KEYS`, 15 полей)
`org_form, name, short_name, unp, address, address_structured, director_position, director_full_name, director_short_name, acts_on_basis, bank_account, bank_name, bank_code, phone, email`

Структурированный адрес (`address_structured`): `street, house, building, apartment, city, region, postal_code, country` (по `fieldMap.ts`; `district` в structured-схеме ЮЛ нет).

### 1.2 ИП (`ENTREPRENEUR_CANONICAL_KEYS`, 14 полей, та же таблица)
`name, short_name, unp, address, address_structured, acts_on_basis, bank_account, bank_name, bank_code, phone, email` + override подписанта: `ent_director_position, ent_director_full_name, ent_director_short_name, ent_acts_on_basis_override`.

### 1.3 ФЛ (`INDIVIDUAL_CANONICAL_KEYS`, 16 полей)
`full_name, birth_date, personal_number, passport_series, passport_number, passport_number_full, passport_issued_by, passport_issued_date, passport_valid_until, address, address_structured, bank_account, bank_name, bank_code, phone, email`

### 1.4 GRP-расширение (read-only из ЕГР)
`grp_registration_date, grp_tax_office_code, grp_tax_office_name, grp_status_code, grp_status_name, grp_short_name, grp_liquidation_date, grp_liquidation_reason, grp_last_fetched_at`

### 1.5 Объём данных в проде
- `legal_entities_requisites`: 11 строк
- `individual_requisites`: 10 строк

---

## 2. Фактический registry в БД (срез по category)

```sql
SELECT category, COUNT(*) FILTER (WHERE archived_at IS NULL) active,
       COUNT(*) FILTER (WHERE archived_at IS NULL AND field_id IS NULL) no_field_id,
       COUNT(*) FILTER (WHERE archived_at IS NULL AND field_id IS NOT NULL) with_field_id
FROM document_token_registry GROUP BY category;
```

| category | active | без field_id | с field_id |
|---|---:|---:|---:|
| contact | 6 | 0 | 6 |
| customer | 12 | 1 | 11 |
| **customer.entrepreneur** | **24** | **24** | **0** |
| **customer.individual** | **26** | **26** | **0** |
| **customer.legal** | **24** | **24** | **0** |
| customer.signer | 4 | 0 | 4 |
| deal | 38 | 0 | 38 |
| document | 2 | 0 | 2 |
| executor | 11 | 1 | 10 |
| **executor.entrepreneur** | **24** | **24** | **0** |
| **executor.individual** | **26** | **26** | **0** |
| **executor.legal** | **24** | **24** | **0** |
| **executor.signer** | **4** | **4** | **0** |
| legal_details | 0 | 0 | 0 |
| offer | 7 | 0 | 7 |
| payment | 12 | 0 | 12 |
| product | 4 | 0 | 4 |
| system | 6 | 0 | 6 |
| tariff | 6 | 0 | 6 |
| **ИТОГО active** | **260** | **154** | **106** |

Сходимость:
- «скрыто без field_id: 154» = 26+24+24+26+24+24+4+1+1 = **154** ✓
- секция 9 «Системные / Документ / Сделка / Оплата» (categories: system, document, deal, payment, contact, product, tariff, offer, legal_details) = 6+2+38+12+6+4+6+7+0 = **81** ✓
- секция 7 «Динамические поля» (categories: customer, executor) = 12+11 = **23**, но скрыто 2 без field_id → видно **21**

Все токены `customer.{ind|leg|ent}.*` и `executor.{ind|leg|ent}.*` имеют `source_type='system'`, заполненный `resolver_key` (например `customer.ent.name`, `customer.ind.passport_series`) и `example_value`. То есть они **архитектурно корректные runtime-резолверы**, а не «битые».

---

## 3. Фактическая логика группировки каталога

Файл `src/components/ai-documents/PlaceholdersCatalogTab.tsx`:

- Строки **177–189** — мэппинг строк:
  ```ts
  if (!r.field_id || !publicId) { skipped += 1; continue; }
  ```
  Это и есть единственная причина «скрыто без field_id: 154».

- Строки **95–109** — `SECTION_DEFINITIONS` (9 секций):

| # | label | categories | active токенов | видно сейчас | проблема |
|---|---|---|---:|---:|---|
| 1 | Заказчик ФЛ | `customer.individual` | 26 | **0** | все 26 без field_id → отрезаны UI |
| 2 | Заказчик ЮЛ | `customer.legal` | 24 | **0** | все 24 без field_id → отрезаны UI |
| 3 | Заказчик ИП | `customer.entrepreneur` | 24 | **0** | все 24 без field_id → отрезаны UI |
| 4 | Исполнитель ФЛ | `executor.individual` | 26 | **0** | все 26 без field_id → отрезаны UI |
| 5 | Исполнитель ЮЛ | `executor.legal` | 24 | **0** | все 24 без field_id → отрезаны UI |
| 6 | Исполнитель ИП | `executor.entrepreneur` | 24 | **0** | все 24 без field_id → отрезаны UI |
| 7 | Динамические поля | `customer, executor` | 23 | 21 | 2 dynamic без field_id отрезаны (resolver_key есть) |
| 8 | Подписант | `customer.signer, executor.signer` | 8 | **4** | 4 `customer.signer.*` видны; 4 `executor.signer.*` без field_id — отрезаны |
| 9 | Системные / Документ / Сделка / Оплата | 9 разных categories | 81 | 81 | смешаны 4 сущности в одну секцию |

Формат placeholder в UI жёстко прибит к `{{field:FLD-XXXXXX}}` (стр. 9–13 + `buildFieldPlaceholder(t.field_public_id!, ...)`). У runtime-резолверов FLD-ID нет — отсюда и фильтр.

---

## 4. Почему типизированные группы пустые (детально)

Условие попадания строки в каталог:

```ts
SELECT ... FROM document_token_registry
WHERE archived_at IS NULL          -- активна
AND field_id IS NOT NULL           -- ЕСТЬ привязка к fields_registry
AND fields_registry.public_id IS NOT NULL  -- ЕСТЬ FLD-ID
```

Фактические значения у customer.individual / customer.legal / customer.entrepreneur / executor.* (всего 148 строк):
- `field_id = NULL` — у всех 148
- `resolver_key` — заполнен (например `customer.leg.director_full_name`)
- `source_type = 'system'`
- `example_value` — заполнен

→ `actual count = 0` для шести типизированных групп, потому что **UI-фильтр требует FLD-ID, которого у runtime-резолверов нет по дизайну**.

Это **не проблема данных registry** — токены спроектированы как runtime-резолверы и резолвятся напрямую через `resolver_key` без `fields_registry`. Это **проблема UI**: каталог поддерживает только формат `{{field:FLD-XXXXXX}}` и игнорирует токены, которые работают как `{{token:customer.leg.name}}` / runtime.

---

## 5. Почему системные/документ/сделка/оплата смешались

Строки 104–108 `SECTION_DEFINITIONS`:

```ts
{
  id: "system",
  label: "9. Системные / Документ / Сделка / Оплата",
  categories: ["system", "document", "deal", "payment", "contact", "product", "tariff", "offer", "legal_details"],
}
```

Одна секция объединяет 9 разных `category`. В БД эти категории УЖЕ разделены — это решение принято в коде каталога, а не в данных. Разбиение тривиально: достаточно расщепить эту секцию на 4–5 отдельных в `SECTION_DEFINITIONS`.

---

## 6. Mapping UI field → DB path → token_key → label → visible_in_catalog_now

Подробная таблица (по `LEGAL_ENTITY_CANONICAL_KEYS` × token_key из БД). Колонка `visible_now` отражает текущую UI-видимость.

### 6.1 ЮЛ (Заказчик)

| UI field (data.*) | DB path | token_key | ui_label | status | visible_now |
|---|---|---|---|---|---|
| org_form | legal_entities_requisites.data.org_form | customer.leg.org_form | Заказчик ЮЛ: Форма собственности | ok | **no** |
| name | …data.name | customer.leg.name | Заказчик ЮЛ: Название | ok | **no** |
| short_name | …data.short_name | customer.leg.short_name | Заказчик ЮЛ: Краткое наименование | ok | **no** |
| unp | …data.unp | customer.leg.unp | Заказчик ЮЛ: УНП | ok | **no** |
| address | …data.address | customer.leg.address.full | Заказчик ЮЛ: Адрес полный | ok | **no** |
| address_structured.street | …data.address_structured.street | customer.leg.address.street | … Адрес улица | ok | **no** |
| address_structured.house | … | customer.leg.address.house | … Адрес дом | ok | **no** |
| address_structured.building | … | customer.leg.address.building | … Адрес корпус | ok | **no** |
| address_structured.apartment | … | customer.leg.address.apartment | … Адрес помещение | ok | **no** |
| address_structured.city | … | customer.leg.address.city | … Адрес населённый пункт | ok | **no** |
| address_structured.region | … | customer.leg.address.region | … Адрес область | ok | **no** |
| address_structured.postal_code | … | customer.leg.address.postal_code | … Адрес индекс | ok | **no** |
| address_structured.country | … | customer.leg.address.country | … Адрес страна | ok | **no** |
| director_position | …data.director_position | customer.leg.director_position | … Руководитель должность | ok | **no** |
| director_full_name | …data.director_full_name | customer.leg.director_full_name | … Руководитель ФИО | ok | **no** |
| director_short_name | …data.director_short_name | customer.leg.director_short_name | … Руководитель ФИО кратко | ok | **no** |
| acts_on_basis | …data.acts_on_basis | customer.leg.acts_on_basis | … Действует на основании | ok | **no** |
| bank_account | …data.bank_account | customer.leg.bank_account | … Расчётный счёт / IBAN | ok | **no** |
| bank_name | …data.bank_name | customer.leg.bank_name | … Банк | ok | **no** |
| bank_code | …data.bank_code | customer.leg.bank_code | … БИК | ok | **no** |
| phone | …data.phone | customer.leg.phone | … Телефон | ok | **no** |
| email | …data.email | customer.leg.email | … Email | ok | **no** |

Всего 24 токена `customer.legal` — полное покрытие 15 каноничных полей + 8 address-subfields + (по факту в registry сейчас 24 строки — точное совпадение). Зеркально `executor.legal` — 24 строки.

### 6.2 ИП (Заказчик)
24 токена `customer.entrepreneur.*` (см. выдержку из read_query): `customer.ent.name, short_name, unp, acts_on_basis, director_position, director_full_name, director_short_name, director_acts_on_basis, address.full, address.street, address.house, address.building, address.apartment, address.city, address.region, address.postal_code, address.country, bank_account, bank_name, bank_code, phone, email, …` — все статусом `ok`, **visible_now: no**.

### 6.3 ФЛ (Заказчик)
26 токенов `customer.individual.*`: `full_name, short_name, birth_date, personal_number, passport_series, passport_number, passport_number_full, passport_issued_by, passport_issued_date, passport_valid_until, address.full + 8 sub, bank_account, bank_name, bank_code, phone, email` — все статусом `ok`, **visible_now: no**.

### 6.4 Исполнитель ФЛ/ЮЛ/ИП
Зеркально (26 + 24 + 24 = 74 токена), все `ok`, **visible_now: no**.

### 6.5 Universal / dynamic (customer, executor)
Видны 21 из 23. По 1 dynamic-токену в `customer` и `executor` — без field_id — отрезаны. Пример dynamic: `customer.name` (label «Заказчик: Название / ФИО по типу плательщика»), `customer.address.full`, `customer.bank`, `customer.account`, `customer.unp`, `customer.client_type`.

---

## 7. Списки

### missing_token (нет токена под UI-полем)
**Пусто.** Все 15 ЮЛ + 14 ИП + 16 ФЛ каноничных полей + структурированный адрес покрыты existing-токенами (по 24–26 строк × 6 сущностей).

### orphan_token (токен есть, источника заполнения в UI нет)
- `customer.signer.full_name, customer.signer.initials, customer.signer.position, customer.signer.basis` — 4 шт, **с field_id, видны в UI**, но нет формы заполнения «Подписант заказчика» (override-only из карточки сделки).
- `executor.signer.full_name, executor.signer.initials, executor.signer.position, executor.signer.basis` — 4 шт, **без field_id, не видны**, тоже override-only.
- Возможные кандидаты в orphan среди dynamic (`customer.bank`, `customer.account`, `customer.unp`) — формально валидны, но дублируют типизированные. Требуют решения «оставить как universal / скрыть».

### duplicate_token
- Логических дубликатов нет. Dynamic (`customer.name`) и типизированный (`customer.leg.name`/`customer.ind.full_name`/`customer.ent.name`) — это намеренно разные сущности (универсальный vs типизированный).

### legacy_token
- В `document_token_registry` `category = 'legal_details'` имеет **0 active токенов** — legacy namespace `legal_details.*` уже расчищен.
- В коде остался `src/lib/legal-details/fieldMap.ts` (старый `leg_*` / `ent_*` / `ind_*` маппинг) — он используется только формами для нормализации legacy JSONB при чтении. На каталог плейсхолдеров не влияет.

---

## 8. Разбор «Подписант»

Группа состоит из двух наборов токенов:
- `customer.signer.{full_name, initials, position, basis}` — 4 шт, **с field_id**, видны.
- `executor.signer.{full_name, initials, position, basis}` — 4 шт, **без field_id**, не видны.

UI-источника заполнения этих полей в `/settings/legal-details` **нет** — формы ФЛ/ЮЛ/ИП не содержат блока «Подписант» отдельно от руководителя. Override `ent_director_*` для ИП лежит в той же `data` JSONB и резолвится через `customer.ent.director_*`, а не через `customer.signer.*`.

Декларация: `customer.signer.*` предполагается как **override подписанта на уровне сделки** (контрагент представлен не директором, а доверенным лицом), но UI-формы карточки сделки не были найдены при discovery (поиск по `customer.signer`, `signer_full_name`, `signer_position` в `src/` дал 0 совпадений вне registry/каталога).

**Решение для execute v4 (требует подтверждения):**
- Переименовать секцию в каталоге: «Подписант сделки / override».
- Скрывать по умолчанию (переключатель «Технические данные»), либо переносить в отдельную служебную секцию.
- Asymmetric `executor.signer.*` без field_id — выровнять с `customer.signer.*` (либо привязать к `fields_registry`, либо обоим разрешить runtime-резолв через UI-фикс из §10).
- Создание UI-формы «Подписант сделки» вне scope discovery — backlog.

---

## 9. Разбор «Динамические поля» → «Универсальные поля»

Это резолверы вида «один токен — выбор значения по `customer.client_type`»:

| token_key | поведение |
|---|---|
| customer.name | ФЛ → full_name; ЮЛ → name; ИП → «ИП {name}» |
| customer.short_name | то же, краткие формы |
| customer.unp | ЮЛ.unp / ИП.unp / ФЛ → пусто |
| customer.address | по типу плательщика |
| customer.address.full | то же, полный формат |
| customer.bank / bank_code / account | банковские по типу |
| customer.phone / email / acts_on_basis / client_type | универсально |

Зеркально 11 шт. для `executor.*`.

Решение в отчёте: переименовать секцию «Динамические поля» → «Универсальные поля», уточнить labels («Заказчик: ФИО / название автоматически по типу плательщика»), оставить отдельной секцией, не сливать с системными.

---

## 10. Предложение новой структуры групп (только текст, без выполнения)

Новый порядок секций в `SECTION_DEFINITIONS`:

| # | label | categories |
|---|---|---|
| 1 | Заказчик ФЛ | customer.individual |
| 2 | Заказчик ЮЛ | customer.legal |
| 3 | Заказчик ИП | customer.entrepreneur |
| 4 | Исполнитель ФЛ | executor.individual |
| 5 | Исполнитель ЮЛ | executor.legal |
| 6 | Исполнитель ИП | executor.entrepreneur |
| 7 | Универсальные поля | customer, executor |
| 8 | Документ | document |
| 9 | Сделка | deal |
| 10 | Оплата | payment |
| 11 | Системные поля | system |
| 12 | Подписант сделки / override | customer.signer, executor.signer |
| 13 | Технические / legacy | contact, product, tariff, offer, legal_details |

Labels — по списку из ТЗ пользователя (приведены полностью в исходном сообщении: «Заказчик ФЛ: ФИО полностью» … «Исполнитель ИП: …»). Все они уже есть в БД с правильным префиксом «Заказчик ФЛ: …» — переименований не требуется, только проверка на единый стиль.

---

## 11. Черновик Execute v4 (НЕ выполнять до approve)

1. **UI-фикс каталога (минимальный, критический).** В `PlaceholdersCatalogTab.tsx`:
   - Расширить `CatalogRow.field_public_id` до `string | null` без потери и не отбрасывать токены без `field_id`.
   - Для таких токенов формировать placeholder не как `{{field:FLD-XXXXXX}}`, а как `{{token:<token_key>}}` (нужно подтвердить, что резолверы документов уже его принимают; иначе — путь 1b).
   - 1b: альтернатива — массово создать `fields_registry` строки для 154 runtime-токенов и привязать `field_id`. Дороже и требует миграции; см. п. 4 ниже.
2. **Группировка.** Расщепить секцию 9 на отдельные «Документ / Сделка / Оплата / Системные / Технические». Переименовать «Динамические поля» → «Универсальные поля». Переименовать «Подписант» → «Подписант сделки / override».
3. **Подписант executor.signer.** Решить с владельцем: подтянуть `field_id` (или зеркальное runtime-резолвер-решение из п. 1) — асимметрия с `customer.signer` устранена.
4. **Field-registry backfill (по запросу).** Если выбран путь 1b — миграция: на каждый из 154 токенов завести `fields_registry` (public_id `FLD-...`), проставить `field_id` в `document_token_registry`. После этого UI-фикс п. 1 не нужен.
5. **Labels.** Локальный sweep — проверить, что все 260 active токенов имеют label вида «<Сущность> <Тип>: <Поле>»; точечно поправить расходящиеся.
6. **Docs.** Обновить `.lovable/memory/architecture/documents/field-id-first-canon.md` — описать «field_id-first для документных полей + runtime-резолверы для customer/executor/signer» как двойной канон, либо явно зафиксировать выбор.

Никаких действий в `payments_v2`, `orders_v2`, `allocate_document_number`, document scenarios, Contact Center, морфологии не предполагается.

---

## 12. Summary (по запросу)

```
Discovery завершён.

Найдено:
- UI-полей (3 формы реквизитов):  ЮЛ 15 + ИП 14 + ФЛ 16 = 45 каноничных
  (+ structured address sub-fields × 2 формы, + GRP read-only 9)
- активных плейсхолдеров в document_token_registry: 260
- из них видно в каталоге сейчас:                   106
- скрыто фильтром «без field_id»:                   154
- пустых групп каталога:                              6
  (Заказчик ФЛ/ЮЛ/ИП, Исполнитель ФЛ/ЮЛ/ИП)
- missing_token:    0  (все UI-поля покрыты токенами)
- orphan_token:     8  (customer.signer.*, executor.signer.*)
- duplicate_token:  0  (universal vs typed — намеренно)
- legacy_token:     0  active (legal_details category пуст)

Главная причина текущего хаоса:
- проблема UI-фильтрации:  ДА (PlaceholdersCatalogTab требует field_id для всех)
- проблема данных registry:  ЧАСТИЧНО (154 токена без field_id — by design как runtime-резолверы)
- проблема группировки:    ДА (9-я секция смешала 9 категорий в одну)
- проблема отсутствующих токенов:  НЕТ
- проблема лишних/orphan токенов:  ДА (8 signer-токенов без UI-источника)

Предлагаемый execute v4:
1. UI-фикс каталога — разрешить токены без field_id (рендер через {{token:...}}),
   либо альтернатива 1b — backfill field_id миграцией.
2. Расщепить секцию 9 на 4 отдельные (Документ / Сделка / Оплата / Системные),
   переименовать «Динамические» → «Универсальные», «Подписант» → «Подписант сделки / override».
3. Выровнять executor.signer с customer.signer (асимметрия без field_id).
4. (опционально) field_id backfill 154 токенов.
5. Sweep labels на единый шаблон.
6. Обновить memory/документ канона field-id-first.

Жду подтверждения execute v4.
```

---

## DoD выполнения discovery

- [x] Создан `.lovable/proofs/placeholders_full_discovery_2026_05_13.md` со всеми 12 разделами.
- [x] Таблицы заполнены реальными данными из БД (`document_token_registry`, `legal_entities_requisites`, `individual_requisites`) и кода (`PlaceholdersCatalogTab.tsx`, `requisites-v2/fieldMap.ts`).
- [x] Никаких изменений в БД / registry / резолверах / UI каталога / шаблонах.
- [x] Summary с явным ожиданием approve на execute v4 (см. §12).
