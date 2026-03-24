# да, согласен, с учетом правок:

1. **Убрать из PATCH 2.6 отдельный live preview адреса полностью**  
По текущему edit mode он дублирует уже существующий structured UI и не даёт новой пользы.  
Оставить только:
  - structured address fields,
  - автозаполнение Google,
  - добавление/сохранение `район города`,
  - compact postal view в режиме просмотра.
2. **Паспорт делать одним полем** `passport_number_full` **как основной SoT для физлица**  
Формат хранения строго:
  - только `A-Z0-9`
  - без пробелов
  - без дефисов
  - пример: `MP4187696`
3. **Нормализацию паспорта уточнить**
  - uppercase
  - убрать пробелы/дефисы/невидимые символы
  - финальный regex: `^[A-Z0-9]+$`
  - разрешить только **безопасную автонормализацию визуально совпадающих кириллических букв серии в латиницу**  
  пример: `МП 4187696` → `MP4187696`
  - если строка не может быть безопасно нормализована — validation error, без сохранения мусора
4. **Старые** `passport_series` **/** `passport_number` **не хранить как мусор**
  - сначала dry-run dependency audit;
  - если active prod usage = 0 и данные тестовые — удалить в этом же PATCH:
    - DB fields
    - form bindings
    - view bindings
    - duplicate check split logic
    - registry split keys
    - legacy aliases по split passport
  - если активные зависимости есть — controlled migration, затем удаление
5. **Address model доработать так, чтобы появился именно** `район города`**, а не дублировался** `район`
  - `district` оставить как административный район/район области
  - добавить отдельное поле `city_district`
  - не смешивать их
6. **Исправить текущую семантическую путаницу адреса**  
По скрину видно риск, что `Фрунзенский район` сейчас попадает не в то поле.  
В PATCH 2.6 обязательно:
  - проверить, куда сейчас сохраняется городской район;
  - если он сейчас попадает в `settlement`/другое неподходящее поле — сделать migration/backfill в `city_district`;
  - настроить enricher/normalizer так, чтобы городской район больше не терялся и не записывался в неверное поле.
7. **Edit mode адреса**
  - добавить и показывать отдельное поле `Район города`
  - подключить save/load cycle
  - если Google/autocomplete умеет его вытаскивать — reuse existing mapping
  - если не умеет — поле должно оставаться доступным для ручного ввода
8. **View mode адреса**
  - оставить compact postal address
  - `район города` не выводить в основной компактный блок, если это перегружает карточку
  - formatter компактного адреса не менять лишнего
9. **Snapshot / deprecation часть PATCH 2.6 поддерживаю**  
Обязательно сохранить:
  - `token_manifest_snapshot`
  - `template_tokens_snapshot`
  - `source_trace`
  - `template_id`
  - `template_code`
  - `template_version`
  - `registry_version`
  - `resolver_version`
  - `warnings_snapshot`
10. **Passport resolver/update**
  - resolver приоритетно берёт `passport_number_full`
  - split passport logic использовать только как временный fallback, если cleanup не завершён
  - после safe cleanup split fallback удалить
11. **Duplicate check**
  - перевести на unified passport field
  - split comparison убрать после cleanup
12. **Matrix / token registry**
  - добавить `person.passport_number_full`
  - `person.passport_series` и `person.passport_number` пометить как delete candidate / deprecated
  - signer passport mapping тоже перевести на unified field
13. **DoD PATCH 2.6 дополнить**
  - в edit mode физлица одно поле паспорта
  - копирование даёт одно слово без пробелов
  - `city_district` сохраняется и загружается
  - городской район не теряется и не попадает в неверное поле
  - view mode остаётся компактным
  - split passport поля удалены, если dry-run доказал безопасность удаления; иначе показан dependency report и выполнен controlled migration.
  - &nbsp;
  - PATCH 2.6 — Snapshot / Passport / Address / Deprecation

## Обзор текущего состояния

**Snapshot:** Таблица `ai_generated_documents` уже хранит `snapshot` (JSONB) и `missing_tokens`, но без структурированных полей (`token_manifest_snapshot`, `template_tokens_snapshot`, `source_trace`, версионирование). Отдельной таблицы `document_generation_snapshots` нет.

**Passport:** В БД (`legal_details_persons`) — два отдельных поля `passport_series` и `passport_number`. Используются в 18 файлах: UI формы, view, resolver, duplicate check, edge functions. Поля `passport_number_full` не существует.

**Address:** `StructuredAddress` НЕ содержит `city_district`. В `StructuredAddressBlock` поле "Район" = `district` (административный район области). Городской район (Фрунзенский, Центральный) сейчас **фильтруется** в enricher и formatter как мусор — не сохраняется. View mode уже использует `formatStructuredAddressForView` с двухстрочным форматом.

---

## Порядок выполнения

### Шаг 1: Dry-run audit (read-only)

Перед любыми изменениями — полный аудит зависимостей:

**Passport fields audit:**

- `passport_series` / `passport_number` используются в: `PersonFieldsForm`, `PersonRecordSheet`, `PersonsTableView`, `usePersonDuplicateCheck`, `aiDocumentSnapshotResolver`, `personDisplayUtils`, edge functions (`ai-generate-document`, `ai-generate-document-package`)
- Активные prod-данные: проверить через `SELECT count(*) FROM legal_details_persons WHERE passport_series IS NOT NULL OR passport_number IS NOT NULL`

**City district audit:**

- `city_district` не существует ни в `StructuredAddress`, ни в `CanonicalAddressPayload`, ни в БД
- Нужно добавить новое поле

**Snapshot audit:**

- `ai_generated_documents.snapshot` — flat JSONB без структуры
- Нет `source_trace`, `token_manifest`, `template_tokens`, версий

**Deliverable:** Dependency report с решением: hard cleanup или controlled migration для passport fields.

---

### Шаг 2: PATCH 2.6A — Snapshot strategy

**Миграция БД** — добавить колонки в `ai_generated_documents`:

```sql
ALTER TABLE ai_generated_documents ADD COLUMN IF NOT EXISTS
  token_manifest_snapshot jsonb,
  template_tokens_snapshot jsonb,
  source_trace jsonb,
  template_code text,
  template_version text,
  registry_version text,
  resolver_version text,
  warnings_snapshot jsonb;
```

Existing `snapshot` колонка = `placeholder_data_snapshot` (rename не нужен, add-only).

**Edge functions** (`ai-generate-document`, `ai-generate-document-package`):

- Собирать `token_manifest_snapshot` из resolver (requested/found/missing/legacy)
- Собирать `template_tokens_snapshot` из docxtemplater parsed tags
- Добавить `source_trace` per-key
- Записывать версии при insert

**Legacy deprecation:**

- Phase A: dual resolve уже работает в `aiDocumentSnapshotResolver.ts`
- Phase B: добавить `console.warn` если legacy token resolved
- Phase C: отдельный endpoint/query для admin deprecation report (шаблон → legacy tokens → canonical replacement → статус)

**Файлы:**

- `supabase/migrations/new` — ALTER TABLE
- `supabase/functions/ai-generate-document/index.ts` — snapshot enrichment
- `supabase/functions/ai-generate-document-package/index.ts` — snapshot enrichment
- `src/utils/aiDocumentSnapshotResolver.ts` — добавить manifest/trace collection

---

### Шаг 3: PATCH 2.6B — Unified passport field

**Миграция БД:**

```sql
ALTER TABLE legal_details_persons
  ADD COLUMN IF NOT EXISTS passport_number_full text;
```

**Нормализатор** — новый `src/lib/persons/passportNormalizer.ts`:

- `normalizePassport(input: string): { normalized: string; success: boolean }`
- trim → uppercase → remove spaces/hyphens/invisible chars → retain only A-Z0-9
- Транслитерация кириллицы (М→M, П→P, etc.) для безопасной нормализации
- Regex validation: `^[A-Z0-9]+$`

**Data migration** (через insert tool, не через миграцию):

```sql
UPDATE legal_details_persons
SET passport_number_full = UPPER(REGEXP_REPLACE(
  COALESCE(passport_series, '') || COALESCE(passport_number, ''),
  '[^A-Z0-9]', '', 'gi'
))
WHERE passport_number_full IS NULL
  AND (passport_series IS NOT NULL OR passport_number IS NOT NULL);
```

**Registry:** Добавить `person.passport_number_full` в `fields_registry`. Отметить `person.passport_series` и `person.passport_number` как deprecated.

---

### Шаг 4: PATCH 2.6C — Person card passport UI

**Edit mode** (`PersonFieldsForm.tsx`):

- Заменить два поля (Серия + Номер) на одно: "Серия и номер паспорта"
- Helper text: "Только латинские буквы и цифры, без пробелов. Например: MP4187696"
- При blur/save: нормализация через `normalizePassport()`
- Если успешно → hint "Сохранено как: MP4187696"
- Если неуспешно → validation error, не сохранять

**View mode** (`PersonRecordSheet.tsx`):

- Одна строка "Серия и номер паспорта: MP4187696"
- Copy копирует слитное значение

**Duplicate check** (`usePersonDuplicateCheck.ts`):

- Tier 2: перейти на `passport_number_full` вместо `passport_series` + `passport_number`

---

### Шаг 5: PATCH 2.6D — Address city_district

**Новое поле в модели:**

- `StructuredAddress` → добавить `city_district: string`
- `CanonicalAddressPayload` → добавить `city_district: string | null`

**StructuredAddressBlock:** Добавить поле "Район города" между "Город" и "Населённый пункт" в FULL_LAYOUT. Manual-only (без autocomplete trigger).

**GrpAddressEnricher:** Вместо фильтрации city district → сохранять в `city_district`.

**Formatter:** `formatStructuredAddressForView` — city_district не включать в компактный view (по ТЗ). Использовать только в edit mode и при необходимости в полном адресе.

**PersonFieldsForm:** Поле city_district автоматически появится через StructuredAddressBlock.

**Файлы:**

- `src/lib/address/types.ts` — добавить city_district
- `src/lib/address/utils.ts` — обновить emptyAddress
- `src/components/shared/StructuredAddressBlock.tsx` — добавить в layout
- `src/lib/address/GrpAddressEnricher.ts` — сохранять вместо фильтрации
- `src/lib/address/AddressNormalizationService.ts` — включить в payload
- `src/lib/address/formatStructuredAddress.ts` — НЕ менять compact view

---

### Шаг 6: PATCH 2.6E — Resolver / tokens / compatibility

- Resolver: приоритет `passport_number_full`, fallback compose из old fields
- `source_trace` для паспорта показывает источник
- Matrix update: добавить `person.passport_number_full`, отметить old keys deprecated
- Signer context: passport из unified field

**Файлы:**

- `src/utils/aiDocumentSnapshotResolver.ts`
- `docs/token_matrix.md`
- `.lovable/plan.md`

---

### Шаг 7: PATCH 2.6F — Verify / Proof

- SQL proof: новые колонки существуют
- Code proof: resolver, forms, formatter обновлены
- UI proof: edit/view person card, address district, compact address
- Legacy proof: existing flows не сломаны

---

## STOP-guards

- Не ломать billing/template flows
- Не ломать Telegram/email editors
- Не удалять old passport fields без dependency audit proof
- Не делать отдельный address preview block
- Не создавать новый picker component
- Old `passport_series`/`passport_number` колонки в БД: удалять только после proof что active prod usage = 0

## Файлы, которые меняются


| Файл                                                                | Патч   | Что                                           |
| ------------------------------------------------------------------- | ------ | --------------------------------------------- |
| SQL migration                                                       | 2.6A   | snapshot columns в ai_generated_documents     |
| SQL migration                                                       | 2.6B   | passport_number_full в legal_details_persons  |
| `src/lib/persons/passportNormalizer.ts`                             | 2.6B   | Новый: нормализатор паспорта                  |
| `src/components/ai-requisites/PersonFieldsForm.tsx`                 | 2.6C   | Unified passport field                        |
| `src/components/ai-requisites/PersonRecordSheet.tsx`                | 2.6C   | View mode unified passport                    |
| `src/hooks/usePersonDuplicateCheck.ts`                              | 2.6C   | Duplicate check по unified field              |
| `src/lib/address/types.ts`                                          | 2.6D   | city_district в модели                        |
| `src/lib/address/utils.ts`                                          | 2.6D   | emptyAddress + formatFullAddress              |
| `src/components/shared/StructuredAddressBlock.tsx`                  | 2.6D   | Поле "Район города"                           |
| `src/lib/address/GrpAddressEnricher.ts`                             | 2.6D   | Сохранять city_district                       |
| `src/lib/address/AddressNormalizationService.ts`                    | 2.6D   | city_district в payload                       |
| `src/utils/aiDocumentSnapshotResolver.ts`                           | 2.6A,E | manifest, trace, unified passport             |
| Edge functions (ai-generate-document, ai-generate-document-package) | 2.6A   | Snapshot enrichment                           |
| `docs/token_matrix.md`                                              | 2.6E   | person.passport_number_full + deprecated keys |
| `.lovable/plan.md`                                                  | 2.6F   | Status update                                 |


## Что НЕ меняется

- `generate-from-template` (billing)
- Telegram/email editors
- `client_legal_details` schema
- RLS policies
- Формат сохранённых `{{token}}` строк
- Existing `legal_details.*` registry entries