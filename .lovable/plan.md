# Да, согласен, с учетом правок:

1. **Выбери и зафиксируй один вариант scope первого PR:**  
первый PR = **Foundation + DB migration**, но **без rollout в существующие формы**.  
То есть в первом PR:
  - создаются services / adapters / hooks / shared components,
  - добавляется `grp-lookup`,
  - добавляются JSONB shadow-поля в БД,
  - добавляются integration settings cards,
  - **не меняются** `IndividualDetailsForm`, `EntrepreneurDetailsForm`, `LegalEntityDetailsForm`, формы исполнителя и document-generation UI.
  Исправь в плане фразу  
  **«Никакие существующие формы, таблицы, edge functions не модифицируются в Phase 2»**  
  на:  
  **«В первом PR не модифицируются существующие пользовательские формы и существующая бизнес-логика сохранения, но добавляются новые shared-модули, edge function** `grp-lookup` **и add-only DB migration с canonical JSONB shadow-полями.»**
2. **Убери исключение для физлица и введи единый canonical-стандарт для всех типов адреса.**  
Сейчас нельзя оставлять физлицо вне общей модели, потому что текущие `ind_address_*` не покрывают международный адресный формат.
  Добавь в migration:
  - `client_legal_details.ind_address_structured JSONB DEFAULT NULL`
  - `client_legal_details.ent_address_structured JSONB DEFAULT NULL`
  - `client_legal_details.leg_address_structured JSONB DEFAULT NULL`
  - `executors.legal_address_structured JSONB DEFAULT NULL`
  И замени в плане тезис:  
  **«**`ind_address_*` **(физлицо) — уже structured, не нуждается в shadow-поле»**  
  на:  
  **«Для физлица также вводится** `ind_address_structured JSONB`**, потому что текущие** `ind_address_*` **являются только legacy BY-oriented representation и не покрывают единый международный canonical address model. В дальнейшем** `ind_address_*` **становятся compatibility-полями, производными или адаптируемыми из canonical structured address.»**
3. **Явно раздели canonical и legacy read/write правила.**  
Добавь отдельный блок:
  **Правила чтения:**
  - source of truth для нового кода = `*_address_structured`
  - если `*_address_structured` пустой → fallback на legacy string / legacy fields
  **Правила записи:**
  - новый код всегда пишет в `*_address_structured`
  - legacy string / legacy fields пересчитываются из canonical через adapter
  - legacy поля больше не считаются source of truth после появления structured JSONB
4. **Добавь обязательную совместимость для document generation и edge functions.**  
В плане сейчас это не зафиксировано.
  Добавь отдельный пункт:
  - все read-paths, связанные с генерацией документов, PDF, шаблонов, invoice/act preview и серверной сборкой реквизитов, должны быть переведены на правило:  
  `structured JSONB → fallback legacy fields/string`
  - до rollout это изменение проектируется и включается в DRY RUN, а выполняется в отдельном execute-этапе без поломки текущих шаблонов
5. **Уточни canonical payload.**  
Не пиши расплывчато «14 structured полей». Зафиксируй полный состав.
  Добавь в план такой canonical payload:
  ```ts
  interface CanonicalAddressPayload {
    country: string | null;
    country_code: string | null;
    postal_code: string | null;
    region: string | null;
    district: string | null;
    city: string | null;
    settlement: string | null;
    street: string | null;
    house: string | null;
    building: string | null;
    apartment: string | null;
    raw_input: string | null;
    formatted_address: string | null;
    google_place_id: string | null;
    lat: number | null;
    lng: number | null;
    source: 'manual' | 'google' | 'grp';
    last_verified_at: string | null;
  }

  ```
6. **GRP confirm-flow сделай строго с diff-preview, а не просто preview.**  
Исправь блок GRP Lookup так:
  - после lookup показывается preview результата,
  - отдельно показывается **список полей, которые будут заменены**,
  - пользователь подтверждает применение,
  - без подтверждения запись в форму не происходит,
  - silent overwrite запрещён.
  Добавь в DoD отдельный кейс:
  - при уже заполненной форме GRP preview показывает, какие поля будут заменены,
  - без нажатия «Заполнить» изменения не применяются.
7. **Добавь audit / SYSTEM ACTOR proof для автоматических заполнений и compatibility-save.**  
В плане нужно зафиксировать:
  - любое автоматическое заполнение адреса из Google / GRP,
  - любое автоматическое пересохранение legacy из structured,
  - любой backfill / compatibility rewrite  
  должны логироваться через `audit_logs` с доказуемым результатом.
  Добавь отдельный пункт:
  - для автоматических изменений адресных данных предусмотреть audit event с `actor_type='system'` или эквивалентной системной маркировкой согласно архитектуре проекта
8. **Перепиши DRY RUN, чтобы он проверял не только формы, но и серверные read-paths.**  
Добавь в DRY RUN обязательную таблицу проверки:
  - какие формы будут читать structured first
  - какие edge functions / preview dialogs / PDF generators будут читать structured first
  - где остаётся fallback на legacy
  - где возможны расхождения legacy vs canonical
  - какие старые адреса не могут быть полноценно нормализованы без ручного редактирования
9. **Перепиши список файлов первого PR, добавив migration.**  
В `Файлы Phase 2 (scope первого PR)` добавь:
  - `supabase/migrations/<timestamp>_add_canonical_address_shadow_fields.sql`
  И зафиксируй, что этот migration:
  - add-only,
  - без удаления и переименования старых полей,
  - без backfill на первом шаге,
  - без breaking changes для текущих форм.
10. **Исправь финальный hard constraint, чтобы он был однозначным.**  
Замени блок hard constraints на такой смысл:
  - settings cards — только test/config surface;
  - бизнес-логика адресов и GRP живёт в services/adapters;
  - canonical source of truth = structured JSONB;
  - legacy поля сохраняются только как compatibility layer;
  - первый PR включает foundation + migration;
  - rollout форм и read-path migration выполняются отдельным этапом;
  - silent overwrite запрещён;
  - add-only rollout обязателен.

Готовый ключевой выбор для вставки в план:

**Выбранный вариант:**  
**первый PR включает Foundation + add-only DB migration с canonical JSONB shadow-полями для всех типов адресов, включая физлицо; rollout форм, document-generation read-paths и compatibility adapters выполняется следующим этапом после DRY RUN.**

&nbsp;

План: Перенос Google Maps + МНС GRP Lookup — обновлённая версия с правками

## Обзор изменений относительно предыдущего плана

- Phase 2 теперь строго **integration surface + shared foundation** (не финальная архитектура)
- Добавлен **service/adapter layer** уже в Phase 2 (AddressNormalizationService, GooglePlacesAdapter, GrpLookupAdapter)
- `grp-lookup` edge function оставляет **JWT-валидацию в коде** (auth-required по умолчанию)
- Добавлена **Phase 2.5: Canonical Persistence Design** — JSONB shadow-поля рядом с legacy-строками
- Phase 3 получает **явные compatibility adapters** для каждой формы
- Добавлен **DRY RUN** этап между PLAN и EXECUTE
- GRP lookup использует **confirm-flow** (preview → подтверждение → заполнение)
- DoD расширен до **проверяемых кейсов** по странам и сценариям

---

## DIAGNOSE (выполнен)

### Текущее состояние адресов в БД


| Таблица                | Поля                                                            | Тип хранения                                                         |
| ---------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------- |
| `client_legal_details` | `ind_address_index/region/district/city/street/house/apartment` | Частично structured (7 полей, нет country/building/lat/lng/place_id) |
| `client_legal_details` | `ent_address`                                                   | Одна строка                                                          |
| `client_legal_details` | `leg_address`                                                   | Одна строка                                                          |
| `executors`            | `legal_address`                                                 | Одна строка                                                          |


### Текущее состояние юрлиц

- `client_legal_details`: `ent_unp`, `leg_unp`, `leg_name`, `leg_org_form`, `leg_director_*`
- `executors`: `unp`, `full_name`, `short_name`, `director_*`
- Нет отдельной таблицы `legal_entities` / `companies`
- Нет GRP metadata, registration_date, status, tax_office

### UI-формы с адресами


| Форма              | Файл                          | Текущий ввод                               |
| ------------------ | ----------------------------- | ------------------------------------------ |
| Физлицо            | `IndividualDetailsForm.tsx`   | 7 structured полей (без autocomplete)      |
| ИП                 | `EntrepreneurDetailsForm.tsx` | `ent_address` — одна строка Input          |
| Юрлицо             | `LegalEntityDetailsForm.tsx`  | `leg_address` — одна строка Input          |
| Исполнитель        | через `useExecutors`          | `legal_address` — одна строка              |
| Документогенерация | edge functions                | Сборка из полей / чтение строки (readonly) |


### Что есть vs что нужно

- Google Maps loader: нет
- Place autocomplete: нет
- StructuredAddress types: нет
- Address service/adapters: нет
- GRP lookup: нет
- `@types/google.maps`: не установлен

---

## PLAN

### Phase 2 — Integration Surface + Shared Foundation

**Scope:** перенос кода из Ajouré, создание service/adapter layer, settings cards. Без изменений в существующих формах и таблицах.

#### 2.1 Edge Function: `grp-lookup`

- Скопировать из Ajouré, заменить `esm.sh` import → `npm:`
- **Auth-required:** JWT-валидация в коде сохраняется (проверка `auth.getUser()`)
- `verify_jwt = false` в config.toml (стандарт проекта), но auth проверяется в коде вручную
- Добавить в `functions.registry.txt`

#### 2.2 Service / Adapter Layer (новое)


| Файл                                                  | Назначение                                                                                                                                                                                                                              |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/address/types.ts`                            | `StructuredAddress` interface (из Ajouré), `AddressSource`, `CanonicalAddressPayload`                                                                                                                                                   |
| `src/lib/address/utils.ts`                            | `emptyAddress`, `formatFullAddress`, `isAddressEmpty`, `buildAutocompleteQuery`                                                                                                                                                         |
| `src/lib/address/AddressNormalizationService.ts`      | `normalize(raw: Partial<StructuredAddress>): StructuredAddress` — валидация, очистка, сборка `full_address`. Source of truth logic: если `google_place_id` есть и поля не менялись вручную → source = 'google', иначе source = 'manual' |
| `src/lib/address/adapters/GooglePlacesAdapter.ts`     | `parseComponents(components): Partial<StructuredAddress>` — маппинг Google address_components в canonical model. Инкапсулирует все fallback-цепочки (locality → postal_town → admin_level_3 и т.д.)                                     |
| `src/lib/legal-entities/types.ts`                     | `GrpLookupResult`, `LegalEntityPreviewData`                                                                                                                                                                                             |
| `src/lib/legal-entities/normalizeUnp.ts`              | `normalizeUnp()`, `isValidUnp()`                                                                                                                                                                                                        |
| `src/lib/legal-entities/adapters/GrpLookupAdapter.ts` | `mapGrpResponse(raw): GrpLookupResult` — маппинг сырого ответа МНС в доменную модель. Внутренняя модель не зависит от формата GRP API                                                                                                   |


**Принцип:** UI-хуки работают **через сервисы/адаптеры**, а не напрямую с сырым Google/GRP форматом.

#### 2.3 Frontend: хуки


| Файл                                | Зависит от                                      |
| ----------------------------------- | ----------------------------------------------- |
| `src/hooks/useGoogleMapsLoader.ts`  | Standalone (singleton loader)                   |
| `src/hooks/usePlaceAutocomplete.ts` | `useGoogleMapsLoader`                           |
| `src/hooks/useGrpLookup.ts`         | `GrpLookupAdapter`, `supabase.functions.invoke` |


#### 2.4 Frontend: компоненты


| Файл                                               | Назначение                                                                                   |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/components/shared/StructuredAddressBlock.tsx` | Unified address input (из Ajouré). Использует `usePlaceAutocomplete` + `GooglePlacesAdapter` |


#### 2.5 Settings Cards (Интеграции → Разное)


| Файл                         | Назначение                                                   |
| ---------------------------- | ------------------------------------------------------------ |
| `GoogleMapsSettingsCard.tsx` | Статус API key, тестовый поиск — только test/config surface  |
| `GrpLookupSettingsCard.tsx`  | Тестовый поиск по УНП с preview — только test/config surface |


**Бизнес-логика НЕ живёт в settings cards.**

#### 2.6 Обновить `OtherIntegrationsTab.tsx`

Добавить обе карточки в grid.

#### 2.7 Зависимости

- `@types/google.maps` (devDependency)
- `VITE_GOOGLE_MAPS_API_KEY` — запросить у пользователя

---

### Phase 2.5 — Canonical Persistence Design (новое)

**Цель:** зафиксировать схему хранения canonical-адреса ДО rollout в формы.

#### DB Migration: JSONB shadow-поля

Добавить в `client_legal_details`:

- `ent_address_structured JSONB DEFAULT NULL` — canonical StructuredAddress для ИП
- `leg_address_structured JSONB DEFAULT NULL` — canonical StructuredAddress для юрлица

Добавить в `executors`:

- `legal_address_structured JSONB DEFAULT NULL` — canonical StructuredAddress

**Правила:**

- Legacy-строка (`ent_address`, `leg_address`, `legal_address`) **становится производной** от structured JSONB: `formatFullAddress(structured) → legacy string`
- Если structured заполнен — legacy = computed. Если structured пуст — legacy остаётся as-is (обратная совместимость)
- `ind_address_*` (физлицо) — уже structured, не нуждается в shadow-поле

#### Canonical Address Payload (хранится в JSONB)

```typescript
interface CanonicalAddressPayload {
  // 14 structured полей из StructuredAddress
  source: 'manual' | 'google' | 'grp';
  google_place_id: string | null;
  lat: number | null;
  lng: number | null;
  last_verified_at: string | null;  // ISO timestamp
  formatted_address: string | null; // = formatFullAddress(...)
}
```

#### Source of Truth после ручного редактирования

- При выборе из Google: `source = 'google'`, `google_place_id` заполнен
- При ручной правке любого поля после Google: `source = 'manual'`, `google_place_id` сохраняется для reference, но `last_verified_at` обнуляется
- При заполнении из GRP lookup: `source = 'grp'` (только адрес из реестра)
- `formatted_address` = `formatFullAddress(structured_fields)` — всегда пересчитывается

---

### DRY RUN (между PLAN и EXECUTE)

Перед выполнением Phase 3 — обязательный выход:

1. **Формы, которые будут затронуты:**
  - `IndividualDetailsForm.tsx` — `ind_address_*` ↔ `StructuredAddress` (adapter)
  - `EntrepreneurDetailsForm.tsx` — `ent_address` (legacy string) + `ent_address_structured` (canonical JSONB)
  - `LegalEntityDetailsForm.tsx` — `leg_address` (legacy string) + `leg_address_structured` (canonical JSONB) + GRP confirm-flow
  - Executor forms — `legal_address` + `legal_address_structured`
2. **Поля canonical vs legacy:**
  - Canonical: JSONB shadow-поля (structured)
  - Legacy: текущие строковые поля (сохраняются, значение = `formatFullAddress(canonical)`)
3. **Как собирается `full_address`:** через `AddressNormalizationService.normalize()` → `formatFullAddress()`
4. **Несовместимые старые адреса:** строки без структуры в `ent_address`, `leg_address`, `legal_address` — остаются as-is, пока пользователь не отредактирует (тогда появляется structured shadow)

---

### Phase 3 — Compatibility Layer + Form Rollout

#### Explicit Adapters для каждой формы


| Adapter                      | Маппинг                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| `IndividualAddressAdapter`   | `ind_address_index/region/district/city/street/house/apartment` ↔ `StructuredAddress` (двунаправленный) |
| `EntrepreneurAddressAdapter` | `ent_address` (string) + `ent_address_structured` (JSONB) ↔ `StructuredAddress`                         |
| `LegalEntityAddressAdapter`  | `leg_address` + `leg_address_structured` ↔ `StructuredAddress`                                          |
| `ExecutorAddressAdapter`     | `legal_address` + `legal_address_structured` ↔ `StructuredAddress`                                      |


**Принцип:** при сохранении формы adapter пишет И structured JSONB, И legacy string. При чтении — приоритет structured, fallback на legacy.

#### GRP Lookup: Confirm-Flow

В `LegalEntityDetailsForm`:

1. Пользователь вводит УНП → кнопка «Найти в реестре»
2. Edge function возвращает данные → показывается **preview-карточка** (название, адрес, статус, дата регистрации)
3. Пользователь нажимает «Заполнить» → данные вставляются в форму
4. **Никогда** не перетирает молча уже введённые данные
5. Если есть конфликт — показывает что будет заменено

---

### Phase 4–6 (будущее, не в scope)

- **Phase 4**: Отдельная таблица `addresses` (id, public_id, created_at, updated_at, metadata, FK, workspace_id)
- **Phase 5**: Data backfill legacy → structured
- **Phase 6**: Удаление legacy-полей

---

## Файлы Phase 2 (scope первого PR)


| Файл                                                                 | Действие              |
| -------------------------------------------------------------------- | --------------------- |
| `supabase/functions/grp-lookup/index.ts`                             | Создать               |
| `supabase/functions.registry.txt`                                    | Добавить `grp-lookup` |
| `src/lib/address/types.ts`                                           | Создать               |
| `src/lib/address/utils.ts`                                           | Создать               |
| `src/lib/address/AddressNormalizationService.ts`                     | Создать               |
| `src/lib/address/adapters/GooglePlacesAdapter.ts`                    | Создать               |
| `src/lib/legal-entities/types.ts`                                    | Создать               |
| `src/lib/legal-entities/normalizeUnp.ts`                             | Создать               |
| `src/lib/legal-entities/adapters/GrpLookupAdapter.ts`                | Создать               |
| `src/hooks/useGoogleMapsLoader.ts`                                   | Создать               |
| `src/hooks/usePlaceAutocomplete.ts`                                  | Создать               |
| `src/hooks/useGrpLookup.ts`                                          | Создать               |
| `src/components/shared/StructuredAddressBlock.tsx`                   | Создать               |
| `src/components/integrations/google-maps/GoogleMapsSettingsCard.tsx` | Создать               |
| `src/components/integrations/grp-lookup/GrpLookupSettingsCard.tsx`   | Создать               |
| `src/components/integrations/kinescope/OtherIntegrationsTab.tsx`     | Обновить              |


**Никакие существующие формы, таблицы, edge functions не модифицируются в Phase 2.**

---

## Verify / DoD (проверяемые кейсы)


| #   | Кейс                                          | Ожидание                                                                                    |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | Адрес BY (Минск) через Google autocomplete    | Все поля заполнены, `country_code = BY`, `source = google`                                  |
| 2   | Адрес PL (Warszawa) через Google              | `country_code = PL`, city = Warszawa, fallback-цепочки работают                             |
| 3   | Адрес EU с необычной структурой (UK / Turkey) | Заполняется максимум полей, пустые остаются пустыми, не крашится                            |
| 4   | Неполный адрес без индекса                    | `postal_code` пустой, `formatFullAddress` пропускает его, нет ошибки                        |
| 5   | Ручная правка после Google autocomplete       | `source` меняется на `manual`, `google_place_id` сохраняется, `last_verified_at` обнуляется |
| 6   | GRP lookup: найден                            | Preview показывает данные, по подтверждению — заполняет форму                               |
| 7   | GRP lookup: не найден                         | Сообщение «Организация не найдена»                                                          |
| 8   | GRP lookup: невалидный УНП (8 цифр)           | Ошибка валидации до отправки запроса                                                        |
| 9   | Legacy-строка и structured-данные согласованы | `formatFullAddress(structured)` === legacy string field                                     |
| 10  | Settings cards: тестовый поиск адреса         | Результат показывается в карточке, бизнес-логика не в карточке                              |


---

## Hard Constraints

- Settings cards — только test/config surface, бизнес-логика в services/adapters
- Адрес в новом коде НИКОГДА не сохраняется только строкой — всегда canonical structured
- Legacy-строка = производная от canonical, не наоборот
- Внутренняя модель НЕ зависит от формата Google/GRP API (через adapters)
- Add-only rollout через compatibility layer, без поломки production
- `grp-lookup` auth-required (JWT-проверка в коде)
- Если позже создаётся таблица `addresses`: id, public_id, created_at, updated_at, metadata, FK, workspace_id