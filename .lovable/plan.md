# План: Перенос Google Maps + МНС GRP Lookup — финальная версия

## Статус: Phase 2 — ВЫПОЛНЕНО ✅

### Что сделано в Phase 2 (первый PR)

**Foundation + add-only DB migration с canonical JSONB shadow-полями.**

#### Созданные файлы:

| Файл | Назначение |
|---|---|
| `src/lib/address/types.ts` | `StructuredAddress`, `CanonicalAddressPayload`, `AddressSource` |
| `src/lib/address/utils.ts` | `emptyAddress`, `formatFullAddress`, `isAddressEmpty`, `buildAutocompleteQuery` |
| `src/lib/address/AddressNormalizationService.ts` | Валидация, нормализация, source of truth logic |
| `src/lib/address/adapters/GooglePlacesAdapter.ts` | Маппинг Google address_components → StructuredAddress |
| `src/lib/legal-entities/types.ts` | `LegalEntityLookupResult`, `GrpMetaBranch`, `LegalEntityPreviewData` |
| `src/lib/legal-entities/normalizeUnp.ts` | `normalizeUnp`, `isValidUnp`, `normalizeAndValidateUnp` |
| `src/lib/legal-entities/adapters/GrpLookupAdapter.ts` | Маппинг GRP API → доменная модель |
| `supabase/functions/grp-lookup/index.ts` | Edge function для запроса к МНС API (auth-required) |
| `src/hooks/useGoogleMapsLoader.ts` | Singleton loader для Google Maps JS SDK |
| `src/hooks/usePlaceAutocomplete.ts` | Хук автоподсказок через Places API |
| `src/hooks/useGrpLookup.ts` | Хук для вызова grp-lookup через adapter |
| `src/components/shared/StructuredAddressBlock.tsx` | Unified structured address input |
| `src/components/integrations/google-maps/GoogleMapsSettingsCard.tsx` | Settings card: Google Maps |
| `src/components/integrations/grp-lookup/GrpLookupSettingsCard.tsx` | Settings card: МНС GRP Lookup |

#### Обновлённые файлы:

| Файл | Изменение |
|---|---|
| `src/components/integrations/kinescope/OtherIntegrationsTab.tsx` | Добавлены GoogleMapsSettingsCard + GrpLookupSettingsCard |
| `supabase/functions.registry.txt` | Добавлен `grp-lookup` |
| `tsconfig.app.json` | Добавлен `"types": ["google.maps"]` |

#### DB Migration:

- `client_legal_details.ind_address_structured JSONB DEFAULT NULL`
- `client_legal_details.ent_address_structured JSONB DEFAULT NULL`
- `client_legal_details.leg_address_structured JSONB DEFAULT NULL`
- `executors.legal_address_structured JSONB DEFAULT NULL`

**Add-only. Без удаления/переименования старых полей. Без backfill.**

---

## VERIFY Phase 2

### 1. Миграция: JSONB shadow-поля подтверждены

SQL-запрос:
```sql
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('client_legal_details', 'executors')
  AND column_name IN ('ind_address_structured', 'ent_address_structured', 'leg_address_structured', 'legal_address_structured');
```

Результат: 4 поля существуют, тип `jsonb`, nullable `YES`.

| table_name | column_name | data_type | is_nullable |
|---|---|---|---|
| client_legal_details | ent_address_structured | jsonb | YES |
| client_legal_details | ind_address_structured | jsonb | YES |
| client_legal_details | leg_address_structured | jsonb | YES |
| executors | legal_address_structured | jsonb | YES |

### 2. Edge function grp-lookup: 4 сценария

| # | Сценарий | Результат | Статус |
|---|---|---|---|
| 1 | Без JWT (из браузера) | 401 Unauthorized (auth check в коде, строки 54-74) | ✅ |
| 2 | С JWT + валидный УНП `192560618` | `{ found: true, data: { full_name: "Горбова Екатерина Сергеевна", ... } }` | ✅ |
| 3 | С JWT + валидный УНП `100000001` (не найдено) | `{ found: false }` | ✅ |
| 4 | С JWT + невалидный УНП `12345678` (8 цифр) | HTTP 400 `{ error: "УНП должен содержать ровно 9 цифр" }` | ✅ |

### 3. Google Maps: автоподсказки

- Кнопка «Лупа» удалена
- Ввод >= 3 символов → `fetchPredictions` вызывается автоматически (debounce 300ms)
- Выбор подсказки → парсинг через `GooglePlacesAdapter` → отображение результата

### 4. UI: переименование МНС

- Заголовок карточки: `Поиск по УНП (МНС)`
- Описание: `Поиск юрлица по УНП через реестр МНС`
- Badge: `Доступно`
- Все error/status тексты на русском

### 5. Architectural proof

**Сервисный слой (бизнес-логика):**
- `src/lib/address/AddressNormalizationService.ts` — нормализация, source of truth logic
- `src/lib/address/adapters/GooglePlacesAdapter.ts` — маппинг Google → StructuredAddress
- `src/lib/legal-entities/adapters/GrpLookupAdapter.ts` — маппинг GRP API → доменная модель

**UI-карточки (только test/config surface):**
- `GoogleMapsSettingsCard.tsx` — вызывает `usePlaceAutocomplete` + `GooglePlacesAdapter`, не содержит доменной логики
- `GrpLookupSettingsCard.tsx` — вызывает `useGrpLookup` + `GrpLookupAdapter.resultToPreview()`, не содержит доменной логики

**Edge function:** JWT обязателен (строки 54-74 `grp-lookup/index.ts` — проверка `Authorization` header + `supabase.auth.getUser()`)

### Финальный статус: Phase 2 closed ✅

---

## Canonical Address Payload

```typescript
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

## Правила чтения/записи

**Чтение:** source of truth = `*_address_structured`. Если пустой → fallback на legacy.
**Запись:** новый код всегда пишет в `*_address_structured`. Legacy = производная через adapter.

---

## Следующие этапы (не в scope Phase 2)

### DRY RUN (перед Phase 3)
- Какие формы читают structured first
- Какие edge functions/PDF generators читают structured first
- Где остаётся fallback на legacy
- Какие старые адреса не могут быть нормализованы

### Phase 3 — Compatibility Layer + Form Rollout
- IndividualAddressAdapter: `ind_address_*` ↔ StructuredAddress
- EntrepreneurAddressAdapter: `ent_address` + `ent_address_structured`
- LegalEntityAddressAdapter: `leg_address` + `leg_address_structured` + GRP confirm-flow
- ExecutorAddressAdapter: `legal_address` + `legal_address_structured`
- GRP confirm-flow: preview → diff → подтверждение (silent overwrite запрещён)
- Audit logging: actor_type='system' для автозаполнений

### Phase 4–6 (будущее)
- Отдельная таблица `addresses`
- Data backfill
- Удаление legacy-полей

## Hard Constraints
- Settings cards — только test/config surface
- Бизнес-логика в services/adapters
- Canonical source of truth = structured JSONB
- Legacy поля = compatibility layer
- Silent overwrite запрещён
- Add-only rollout обязателен
- `grp-lookup` auth-required (JWT в коде)

## Требуется от пользователя
- `VITE_GOOGLE_MAPS_API_KEY` для работы Google Maps autocomplete
