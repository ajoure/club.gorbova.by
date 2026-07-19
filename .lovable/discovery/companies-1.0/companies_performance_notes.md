# companies_performance_notes.md

Только агрегаты. Никакого PII в этом документе.

## 1. Cardinality (snapshot Discovery 1.0)

Запросы через `psql`:

| Таблица | count | Комментарий |
|---|---|---|
| `profiles` | 11 981 | все контакты |
| `orders_v2` | 4 203 | все сделки |
| `client_legal_details` | 48 | всего (billing + document) |
| `client_legal_details` где `purpose='billing' AND client_type IN ('legal_entity','entrepreneur')` | 17 | canonical auto-source |
| — из них с нормализуемым УНП (не NULL) | 17 | 100% покрытие |
| — distinct нормализованный УНП | 16 | одна коллизия (2 карточки с одинаковым УНП) |
| `client_legal_details.purpose='billing' AND client_type='individual'` | 24 | individual, **не** auto-source |

Распределение `client_legal_details`:

```
 entrepreneur | billing  | 10
 entrepreneur | document |  2
 individual   | billing  | 24
 individual   | document |  1
 legal_entity | billing  |  7
 legal_entity | document |  4
```

## 2. Ожидаемый размер `companies` (Phase 1 backfill)

- **Первый backfill:** ≤ 16 компаний (по distinct УНП billing legal_entity/entrepreneur).
- **Через 12 месяцев (оценка):** 100–500 компаний.
- **Ceiling:** 10 000–50 000 (импорт «база юрлиц + прозвон», Phase 9).

## 3. Коллизии УНП в текущем billing

`distinct_unp = 16` vs `count = 17` → **1 коллизия** (одно и то же УНП, разные `profile_id` или дублированная карточка). В Phase 3 backfill обрабатывать как: создать одну `companies` + два `company_contacts` (или два `client_legal_details_company_map`). Правило: matching УНП → merge-map, поля не перезаписывать (см. freeze §8).

## 4. Индексы для `companies` (Phase 1 рекомендация)

Обязательные:

- PK `id uuid`.
- UNIQUE `(country, unp_normalized)` WHERE `unp_normalized IS NOT NULL` — dedupe.
- UNIQUE `public_id`.
- btree `status`.
- btree `created_at DESC`.

Для поиска (по фактическому размеру данных):

- Btree `unp_normalized` — под ≤10k достаточно.
- **GIN + pg_trgm** на `full_name` — включить только при переходе >5k компаний. Discovery-рекомендация: **не создавать в Phase 1**, добавить в Phase 9 (импорт базы юрлиц) как отдельная миграция.
- `pg_trgm` extension уже включена в проекте (см. `scripts/export-full-schema.sql`).

## 5. Индексы для `company_contacts`

- PK `id uuid`.
- UNIQUE `(company_id, profile_id, role)`.
- btree `company_id`.
- btree `profile_id`.

## 6. Индексы для `client_legal_details_company_map`

- PK `id uuid`.
- UNIQUE `client_legal_details_id`.
- btree `company_id`.

## 7. Индексы для `company_sync_queue`

- btree `(status, next_run_at)` для воркера.
- btree `entity_id`.
- btree `locked_by` (partial WHERE locked_by IS NOT NULL).

## 8. Full text search

- **Не** внедрять `tsvector` в Phase 1.
- Мониторить `EXPLAIN` на `search_companies` при N>5000.

## 9. Caching / virtualization

- React Query — как везде.
- Table virtualization — включить в `AdminCompanies` при N>1000 (react-virtual). Не блокирует Phase 7.

## 10. Follow-up после N>10 000

- pg_trgm GIN на `full_name`, `short_name`.
- Partial index `(status='active')`.
- Пагинация keyset вместо offset.
