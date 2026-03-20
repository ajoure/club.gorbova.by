# Да, согласен, с учетом правок:

1. Добавь **RBAC и ownership-check** в явном виде.  
Недостаточно просто safe access token. Нужно отдельно зафиксировать:
  - кто именно может читать store config;
  - кто может менять;
  - кто может только видеть diagnostics;
  - обязательная проверка привязки `integration_instance` к текущему amo install/context.
2. Добавь правило **secret never returns to client**.  
В `get`/status surface нельзя возвращать:
  - raw secret;
  - masked secret, если это не нужно для UX;
  - любые данные, по которым можно восстановить secret.  
  Только backend state:
  - `secret_present: true/false`
  - `last_test_at`
  - `connection_status`
  - `payments_unlocked`
3. Зафиксируй **patch semantics** для save/update.  
Нужно явно прописать:
  - partial update;
  - пустые поля не стирают сохранённые значения;
  - изменение `shop_id` / `publishable_key` / `secret_key` не должно случайно обнулять соседние поля;
  - save должен быть идемпотентным.
4. Добавь **audit_logs** как обязательный DoD.  
Для всех действий:
  - save config
  - replace secret
  - delete secret
  - test connection
  - unlock payments  
  Должны быть реальные записи в `audit_logs` с actor, integration_instance, amo_account_id, outcome.
5. Нужен **single backend status contract** для settings UI.  
Не разрозненные проверки в нескольких местах, а один агрегированный backend response:
  - `config_exists`
  - `shop_id_present`
  - `publishable_key_present`
  - `secret_present`
  - `connection_status`
  - `last_test_at`
  - `last_test_error`
  - `payments_unlocked`
  - `locked_reason`
6. Добавь **anti-race / double-submit protection**.  
Нужно явно предусмотреть:
  - повторный click по Save/Test не создает параллельные операции;
  - `test` не стартует до завершения `save`;
  - stale response не должен перетирать более новое состояние.
7. Зафиксируй **backend-first unlock logic**.  
`advancedSettings` должен разблокироваться только по backend state, а не по локальному состоянию формы/клиента. После reload состояние должно восстанавливаться из backend без расхождений.
8. Добавь **diagnostics proof**, что test использует backend secret.  
Не просто декларацию, а проверяемый DoD:
  - test без сохраненного secret → predictable fail/locked;
  - test после сохранения → использует backend binding;
  - client-side введённый, но не сохранённый secret не должен влиять на результат test.
9. Ограничь scope этого спринта еще жестче.  
Явно написать:
  - без расширения iframe бизнес-функций;
  - без новой платежной логики;
  - без новых source-of-truth таблиц;
  - только store connection setup + locked/unlocked flow + diagnostics.
10. Добавь verify по кешу amoCRM как обязательный пакет доказательств.  
Не только version bump, а еще:

- новый ZIP реально загружен;
- runtime fingerprint совпадает;
- old cached artifact не исполняется;
- Source-of-Truth Diff = PASS приложен в отчете.

В остальном направление правильное.  
Ключевая фиксация:

- безопасность не через `amo_account_id`;
- source of truth остается в existing integration storage;
- новый EF только wrapper/aggregator;
- locked/unlocked flow backend-driven;
- этот спринт закрывает только подключение магазина и разблокировку раздела платежей.
- &nbsp;
- План: Phase 3.2 — Address enrichment + Org form dictionary + Apartment field

## DIAGNOSE

### Проблема 1: Compact layout не содержит поле `apartment`

`COMPACT_LAYOUT` в `StructuredAddressBlock.tsx` (строки 48-56) не включает `{ key: 'apartment' }`. Поэтому `оф. 49л` из МНС парсится в `addr.apartment`, но не отображается в форме ЮЛ/ИП (они используют `compact` layout).

### Проблема 2: Адрес из МНС не обогащается через Google

`GrpAddressParser` разбирает flat-строку в preliminary structured, но результат не прогоняется через Google для дозаполнения (house, postal_code, region, country, place_id, lat, lng).

### Проблема 3: Org form — простой Select без поиска

Текущий `ORG_FORM_OPTIONS` (8 значений) — статический select без searchable. Нет справочника по странам СНГ, нет алиасов, нет flow для «Другое» с двумя полями.

## DRY RUN

### Переиспользуемые компоненты

- `StructuredAddressBlock` — добавить `apartment` в COMPACT_LAYOUT
- `usePlaceAutocomplete` — использовать `fetchPredictions` + `fetchPlaceDetails` для enrichment
- `GooglePlacesAdapter.parseComponents` — маппинг Google → StructuredAddress
- `GrpAddressParser.parseGrpAddress` — уже парсит flat → preliminary structured
- `GrpAutofillService` — orchestration, diff

### Что применяется в каждой форме после confirm


| Поле                      | LegalEntity                   | Entrepreneur          | Executors         |
| ------------------------- | ----------------------------- | --------------------- | ----------------- |
| org_form (full canonical) | да                            | нет                   | нет               |
| clean_name                | да → `leg_name`               | нет (full_name as-is) | да → `full_name`  |
| short_name                | нет                           | нет                   | да → `short_name` |
| parsed+enriched address   | да                            | да                    | да                |
| registration_date         | только в diff, не сохраняется | только в diff         | только в diff     |
| tax_office_*              | только в diff, не сохраняется | только в diff         | только в diff     |


### Что НЕ создаем

- Новых таблиц / миграций
- Новых edge functions
- Side-state для registration_date / tax_office (нет подтвержденных полей в БД)

## Файлы и изменения

### PATCH-1: Поле помещения в compact layout

**Файл:** `src/components/shared/StructuredAddressBlock.tsx`

В `COMPACT_LAYOUT` (строка 48-56) добавить `apartment` после `building`:

```
{ key: 'apartment', label: 'Кв./Офис', placeholder: '' },
```

### PATCH-2: GRP → Google address enrichment

**Новый файл:** `src/lib/address/GrpAddressEnricher.ts`

Сервис, который:

1. Принимает preliminary `StructuredAddress` из `GrpAddressParser`
2. Формирует query из заполненных полей через `formatFullAddress()`
3. Вызывает Google Places `AutocompleteSuggestion.fetch()` + `Place.fetchFields()`
4. Мержит результат: Google-поля перезаписывают пустые поля preliminary, но `apartment` из МНС сохраняется (Google обычно не возвращает офис)
5. Устанавливает `source = 'grp'`, `google_place_id`, `lat`, `lng`

**Изменения в формах** (`LegalEntityDetailsForm`, `EntrepreneurDetailsForm`, `AdminExecutors`):

В `handleGrpConfirm` после получения `parsed_address`:

1. Вызвать `GrpAddressEnricher.enrich(parsedAddress)`
2. Результат записать в `setAddress(enrichedAddress)`
3. Enrichment асинхронный — показать spinner на адресном блоке
4. Если Google не ответил — fallback на preliminary parsed address

### PATCH-3: Справочник форм собственности СНГ

**Новый файл:** `src/lib/legal-entities/OrgFormDictionary.ts`

```text
interface OrgFormEntry {
  fullName: string;        // canonical, хранится в БД
  shortName: string;       // для display
  country: string;         // 'BY', 'RU', 'KZ'...
  aliases: string[];       // для поиска: ['ООО', 'общество с огр']
}
```

Справочник ~25-30 форм для BY (уже есть в `ORG_FORM_FULL_TO_SHORT`), плюс основные RU/KZ.

**Новый компонент:** `src/components/legal-details/OrgFormCombobox.tsx`

Searchable combobox (на базе `cmdk` / Popover+Command из shadcn):

- Поиск по `fullName`, `shortName`, `aliases`
- В dropdown показывает: `ЗАО — Закрытое акционерное общество`
- Value = `fullName` (canonical)
- Displayed selected = `shortName` (compact)
- Последний пункт: «Другое»

**При выборе «Другое»:** показать 2 дополнительных Input:

- Полная форма (обязательное)
- Краткая форма (обязательное)
- Оба сохраняются: `leg_org_form = полная`, `leg_org_form_short = краткая` (или в одном поле через separator — зависит от наличия колонки)

**Изменение:** `LegalEntityDetailsForm.tsx` — заменить `<Select>` на `<OrgFormCombobox>`

### PATCH-4: Проверка колонки для краткой формы

Нужно проверить, есть ли `leg_org_form_short` в `client_legal_details`. Если нет — либо добавить миграцию, либо хранить short form только как derived через dictionary lookup.

## Порядок выполнения

1. PATCH-1: Добавить `apartment` в `COMPACT_LAYOUT`
2. PATCH-3: Создать `OrgFormDictionary` + `OrgFormCombobox`
3. PATCH-2: Создать `GrpAddressEnricher`, интегрировать в 3 формы
4. Обновить `LegalEntityDetailsForm` — заменить Select на OrgFormCombobox + flow для «Другое»
5. VERIFY

## DoD

- Поле `Кв./Офис` видно в compact layout всех форм
- После GRP confirm адрес обогащен через Google (house, postal_code, region, country, place_id, lat, lng заполнены)
- Если Google не вернул apartment — сохраняется значение из МНС
- Форма собственности выбирается через searchable combobox
- Поиск работает по полному и краткому названию
- Canonical = полная форма в БД
- Для «Другое» — 2 ручных поля (full + short)
- Пользователь может вручную исправить любой адресный сегмент после enrichment
- Legacy string пересчитывается из canonical при save