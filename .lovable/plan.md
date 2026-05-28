# да, согласен, с учетом правок:

## **Решения по открытым вопросам**

1. **Адреса ЮЛ/ИП/ФЛ — использовать** `address_structured`**, не создавать плоские колонки.**

Подтверждаю вариант:

```text
leg_address_structured->>'street'
ent_address_structured->>'street'
legal_details_persons.address_structured->>'street'
```

Плоские колонки типа `leg_address_street`, `ent_address_house` и т.п. **не создавать**, чтобы не получить два источника правды.

2. **SOT для “Пакет: ФЛ” —** `legal_details_persons`**.**

Подтверждаю:

```text
document_package_session_participants.person_id
→ legal_details_persons
```

Не использовать `client_legal_details.ind_*` для пакетных физлиц, потому что это физлицо-плательщик/клиент, а в пакетах физлица — это отдельные участники, руководители, ответственные и т.д.

3. `bank_*` **для** `legal_details_persons` **— добавить nullable колонки.**

Подтверждаю миграцию:

```sql
ALTER TABLE public.legal_details_persons
  ADD COLUMN IF NOT EXISTS bank_account text,
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS bank_code text;
```

Без backfill. Без новых таблиц. Без изменения RLS, если текущие policies уже покрывают таблицу.

---

## **Обязательные уточнения перед execution**

Добавь в план:

```md
1. Для адресов ЮЛ/ИП/ФЛ использовать только structured JSONB source:
   - `client_legal_details.leg_address_structured`;
   - `client_legal_details.ent_address_structured`;
   - `legal_details_persons.address_structured`.

   Плоские address-колонки не создавать.

2. Для `Пакет: ФЛ` source of truth = `legal_details_persons`.
   `client_legal_details.ind_*` не использовать для пакетных физлиц.

3. Добавить в `legal_details_persons` только недостающие банковские поля:
   - `bank_account`;
   - `bank_name`;
   - `bank_code`.

4. После миграции UI физлица должен позволять заполнять:
   - ФИО;
   - паспортные данные;
   - личный номер;
   - структурированный адрес;
   - банк;
   - расчётный счёт / IBAN;
   - БИК / код банка;
   - телефон;
   - email.

5. Проверить, что форма физлица пишет именно в `legal_details_persons`, а не в `client_legal_details.ind_*`.

6. Проверить, что форма ЮЛ/ИП пишет адрес в `leg_address_structured` / `ent_address_structured`, и эти же поля читаются пакетными плейсхолдерами.

7. Не запускать генерацию и не трогать `canonical-document-generate-strict`.
```

## **Финальный approve**

Можно выполнять Sprint 3E по плану:

```text
jsonb-path для адресов;
legal_details_persons как SOT для ФЛ;
bank_* добавить в legal_details_persons;
без генерации;
без новых таблиц реквизитов;
без изменения биллинговых FLD.

План: Sprint 3E — выравнивание пакетных реквизитов UL / IP / FL
```

## 0. Цель

Довести пакетные группы плейсхолдеров до 1:1 соответствия с биллинговыми «Заказчик ЮЛ / ИП / ФЛ»:

- `Пакет: ЮЛ` = 24/24 поля,
- `Пакет: ИП` = 24/24 поля,
- `Пакет: ФЛ` = 26/26 поля.

Каждое поле должно быть либо `copy_ready` (есть source path + package-aware token Variant B), либо явно `deferred` с письменной причиной. UI заполнения реквизитов должен быть один и тот же для биллинга и пакета (одна база `client_legal_details` / `legal_details_persons`).

## 1. Жёсткие ограничения (повторяют Sprint 3D и расширяют)

- Не трогать `canonical-document-generate-strict`, Gotenberg, `ai_generated_documents`, billing resolver.
- Не запускать генерацию (ни single, ни package).
- Не менять существующие биллинговые FLD групп «Заказчик ЮЛ / ИП / ФЛ» и «Исполнитель ЮЛ» (FLD-000273..346).
- Не копировать данные из `orders_v2` в пакетные сессии.
- Использовать только существующие таблицы: `client_legal_details`, `legal_details_persons`, `document_package_sessions`, `document_package_session_participants`. Новых таблиц реквизитов не создавать.
- Новые FLD создавать только после duplicate-check по `fields_registry` (uniq на `(entity_type, key)`); дубликаты биллинговых FLD-000004..050 запрещены.
- Package token — только Variant B: `{{package.ul|ip|fl.FLD-XXXXXX}}`. Биллинговый `{{field:FLD-...}}` в пакетных группах не copy-ready.
- `_shared/resolve-package-tokens.ts` остаётся `HARDCODED_ENABLED=false` (резолвер не активируется — Sprint 3F).

## 2. Discovery (обязателен до любых миграций)

### 2.1. Реальная схема `client_legal_details` (уже снято)

- ЮЛ: `leg_org_form, leg_name, leg_unp, leg_address, leg_address_structured (jsonb), leg_director_position, leg_director_name, leg_acts_on_basis`.
- ИП: `ent_name, ent_unp, ent_address, ent_address_structured (jsonb), ent_acts_on_basis`.
- ФЛ (внутри `client_legal_details`): `ind_full_name, ind_birth_date, ind_passport_*, ind_personal_number, ind_address_index/region/district/city/street/house/apartment, ind_address_structured (jsonb)`.
- Общие banking/contact: `bank_account, bank_name, bank_code, phone, email`.
- **Плоских колонок `leg_address_street/house/building/apartment/city/region/postal_code/country` и `ent_address_*` НЕТ** — данные живут только в `leg_address_structured` / `ent_address_structured`.

### 2.2. Реальная схема `legal_details_persons`

- Есть: `full_name, birth_date, personal_number, passport_series, passport_number, passport_number_full, passport_issued_by, passport_issued_date, passport_valid_until, phone, email, address_structured (jsonb), is_active, notes`.
- **Нет**: плоских адресных колонок, банк-реквизитов (`bank_account/bank_name/bank_code`).

### 2.3. Реальные FLD в `fields_registry` (entity_type=`legal_details`)

- FLD-000004..050 — биллинговая база (все нужные ЮЛ/ИП/ФЛ поля уже есть, включая адресный breakdown ЮЛ FLD-000035..042 и ИП FLD-000043..050, ФЛ FLD-000020..034).
- Биллинговые группы «Заказчик ЮЛ / ИП / ФЛ» (FLD-000273..346) — это формирующий слой биллинга, не реестр legal_details. Не трогаем.

### 2.4. Несогласованности текущего каталога Sprint 3D (зафиксированы как баги, требующие фикса)

1. `PACKAGE_UL` ссылается на `client_legal_details.leg_address_street/...country` — **колонок нет**. Должно быть `leg_address_structured->>'street'` и т.д.
2. `PACKAGE_IP` ссылается на `ent_address_street/...country` — **колонок нет**. Должно быть `ent_address_structured->>'...'`.
3. `PACKAGE_FL` указывает SOT `legal_details_persons` для всех 26 полей, но банк-реквизитов в `legal_details_persons` нет — поля помечены `missing_source_column` без обоснования выбора таблицы. Нужно решить SOT для FL (см. §3.3).
4. UL/IP: «Адрес: район / район города» помечены `missing_source_column`, хотя `*_address_structured` уже содержит эти ключи. Это `pending_field` с jsonb-source, не отсутствие колонки.

## 3. Решения (требуют утверждения вместе с планом)

### 3.1. Адресный breakdown ЮЛ/ИП — БЕЗ новых колонок

Использовать существующие `leg_address_structured` / `ent_address_structured` (jsonb) как source. Resolver-path:

```
client_legal_details.leg_address_structured->>'street'
client_legal_details.leg_address_structured->>'house'
... (building, apartment, city, district, city_district, region, postal_code, country)
```

FLD-000035..050 уже существуют и переиспользуются (`reuse_existing_field_definition` = label/type/mapping; package source path — jsonb). Это убирает необходимость в миграции «добавить плоские колонки» и сохраняет одну SOT-форму ввода (одна structured-форма для биллинга и пакета).

Альтернатива (если отклонишь) — миграция с плоскими колонками; больше работы, риск рассинхрона с structured. По умолчанию принимаем jsonb-path.

### 3.2. Адресный breakdown ИП — `ent_address_structured`

Сейчас `ent_address_structured` есть, но в UI `EntrepreneurDetailsForm` нужно проверить, что оно реально заполняется (см. §5). Если нет — добавить тот же structured-блок (без новых колонок).

### 3.3. SOT для «Пакет: ФЛ» — `legal_details_persons` + миграция

`document_package_session_participants` уже ссылается на `person_id → legal_details_persons` (см. memory). Значит SOT = `legal_details_persons`. Требуются миграции:

1. `ALTER TABLE legal_details_persons ADD COLUMN bank_account text, ADD COLUMN bank_name text, ADD COLUMN bank_code text;` — пустые/nullable, без backfill.
2. FLD не дублируем — переиспользуем биллинговые FLD-000004/5/6 (label/type/format те же), package token = `{{package.fl.FLD-000004}}` и т.д., source path = `legal_details_persons.bank_*`.
3. Адресный breakdown ФЛ — по принципу §3.1: jsonb-path `legal_details_persons.address_structured->>'street'`, FLD-000028..034 + FLD-000301/302 (страна/район — если нет в реестре, см. §3.4).

### 3.4. Недостающие FLD (после duplicate-check)

Сверка показывает: для биллинга есть всё, для пакета новых FLD не нужно (всё переиспользуется через `reuse_existing_field_definition`). Если duplicate-check на этапе исполнения покажет пробел (например, отсутствует FLD «страна» для ФЛ) — создаём строго после manifest-proof, с `key = legal_details.ind_address_country` и т.п., и фиксируем в proof.

### 3.5. UI заполнения реквизитов — одна форма, один SOT

- `OrganizationDetailsForm` / `LegalEntityDetailsForm` (ЮЛ): должны записывать `leg_address_structured` через Google Maps autocomplete (`useGoogleMapsLoader`) + ручная правка; UNP autofill (`useLegalDetails` / соответствующий хук) пишет в `client_legal_details.leg_*`, а не в billing-only слой.
- `EntrepreneurDetailsForm` (ИП): то же самое для `ent_*` + `ent_address_structured`. Если structured-блок отсутствует — добавить, переиспользуя компонент адреса из ЮЛ.
- `IndividualDetailsForm` / `PersonFieldsForm` (ФЛ): structured-адрес для `legal_details_persons.address_structured` + новые поля `bank_*` после миграции; ФИО/паспорт/личный номер уже есть.
- Никакой отдельной «package-only» формы. Анкета пакета использует те же формы через `selected_legal_entity_id` / `person_id`.

## 4. Шаги исполнения

1. **Discovery proof** — снимок реальной схемы (см. §2), полная mapping-таблица 24/24/26 c колонкой «Решение» (jsonb-path / новая колонка / переиспользуемый FLD / deferred).
2. **Миграция (минимальная)**:
  - `ALTER TABLE legal_details_persons ADD COLUMN bank_account text, bank_name text, bank_code text;`
  - Никаких изменений в `client_legal_details` (структурированные адреса уже есть).
  - Никаких новых FLD по умолчанию; если §3.4 покажет пробел — отдельная вставка в `fields_registry` через `supabase--insert` с duplicate-guard.
3. **Обновить `src/utils/packagePlaceholderCatalog.ts**`:
  - UL/IP адресные элементы: статус `copy_ready`, `source_path = '<table>_address_structured->>"<key>"'`, package token остаётся.
  - FL: после миграции — `bank_*` → `copy_ready`; адресный breakdown — `copy_ready` через `address_structured->>...`; всё остаётся одинаковым по форме `package.fl.FLD-XXXXXX`.
  - Убрать ложные `missing_source_column` там, где есть jsonb-source.
4. **UI patch (frontend, без бизнес-логики биллинга)**:
  - В `EntrepreneurDetailsForm` подключить тот же structured-address блок, что и в `OrganizationDetailsForm`, если он отсутствует.
  - В `IndividualDetailsForm` / `PersonFieldsForm` добавить поля `bank_account / bank_name / bank_code` и structured-адрес, сохраняющий в `legal_details_persons.address_structured` (без дублирования в `client_legal_details.ind_*`).
  - Проверить, что UNP-autofill пишет в `client_legal_details`, не в billing-only слой (читаем `useLegalDetails.tsx`).
5. **UI smoke (без генерации)**:
  - Открыть `/admin/documents` → вкладка плейсхолдеров: «Пакет: ЮЛ/ИП/ФЛ» — все строки `copy_ready`, кроме явно deferred.
  - Создать тест-ЮЛ через UNP autofill → проверить, что structured-адрес заполнился и доступен через тот же UI.
  - Создать тест-ФЛ → банковские поля + structured-адрес сохраняются.
6. **Billing regression (без генерации)**:
  - Группы «Заказчик ЮЛ/ИП/ФЛ» и «Исполнитель ЮЛ» отображаются без изменений.
  - FLD-000004..050 не модифицированы (SQL diff пустой).
  - Существующие шаблоны (акт/счёт) открываются, плейсхолдеры рендерятся как раньше.
7. **Update memory + proof**:
  - `mem://architecture/documents/package-token-aliases-v1` — расширить разделом «jsonb-path source + bank_* для FL».
  - `.lovable/proofs/package_documents_sprint3e_requisites_alignment_2026_05.md` со всеми секциями из §8.

## 5. Технические детали

### 5.1. Resolver contract (read-only, не активируется)

```
package.ul.FLD-000035 → client_legal_details.leg_address_structured->>'street'
                       WHERE id = document_package_sessions.selected_legal_entity_id
package.ip.FLD-000043 → client_legal_details.ent_address_structured->>'street'  (тот же id)
package.fl.FLD-000032 → legal_details_persons.address_structured->>'street'
                       WHERE id = (SELECT person_id FROM document_package_session_participants
                                   WHERE session_id=? AND role_key=?)
package.fl.FLD-000004 → legal_details_persons.bank_account (после миграции)
```

### 5.2. SQL миграции

```sql
ALTER TABLE public.legal_details_persons
  ADD COLUMN IF NOT EXISTS bank_account text,
  ADD COLUMN IF NOT EXISTS bank_name    text,
  ADD COLUMN IF NOT EXISTS bank_code    text;
-- RLS/GRANTs не изменяются: используется существующая политика persons.
```

Никаких CHECK на формат — валидация UI/triggers по аналогии с `client_legal_details.bank_*` (если нужно — отдельным шагом, не в этом спринте).

### 5.3. Pre-flight для FLD-insert (если §3.4 сработает)

```sql
SELECT 1 FROM fields_registry
 WHERE entity_type='legal_details' AND key=$1 AND archived_at IS NULL;
```

Insert только если пусто; в proof — `duplicate_check: passed`.

## 6. DoD

- Mapping-таблица: ЮЛ 24/24, ИП 24/24, ФЛ 26/26 — каждая строка имеет `copy_ready` или explicit `deferred` + reason.
- `legal_details_persons.bank_*` колонки существуют.
- `packagePlaceholderCatalog.ts` обновлён: jsonb-path source для адресных полей UL/IP/FL; bank_* для FL — `copy_ready`.
- UI `EntrepreneurDetailsForm`, `IndividualDetailsForm`/`PersonFieldsForm` поддерживают все нужные поля.
- UNP autofill + Google Maps пишут в общую базу (`client_legal_details`), не в billing-only слой — подтверждено чтением хука.
- Billing FLD-000004..050 не изменены (SQL-diff пуст); биллинговые группы открываются.
- Генерация не запускалась; Gotenberg/`ai_generated_documents`/`canonical-document-generate-strict` не тронуты.
- Memory + proof обновлены; финальный статус:
`completed: package UL/IP/FL requisites aligned with billing requisites structure; missing fields resolved or explicitly deferred; package placeholders ready for real DOCX authoring; generation still deferred`.

## 7. Открытые вопросы (требуют твоего ответа до execute)

1. **§3.1/§3.3 jsonb-path vs новые плоские колонки** — по умолчанию идём через `*_address_structured->>'...'`. Подтверди или попроси плоские колонки.
2. **§3.3 SOT для «Пакет: ФЛ»** — `legal_details_persons` (+ миграция bank_*). Альтернатива: использовать `client_legal_details.ind_*` (там адрес уже плоский и есть banking через общие поля). Что выбираем?
3. *§5.2 миграция bank_ для persons** — добавляем nullable колонки без backfill. OK?

Жду подтверждения; после approve выполняю строго по плану.