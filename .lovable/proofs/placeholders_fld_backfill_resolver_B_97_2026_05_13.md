# PATCH 1 — Resolver coverage для B-97

Дата: 2026-05-13
Связанный execute: `.lovable/proofs/placeholders_fld_backfill_execute_B_97_2026_05_13.md`
Файл изменения: `supabase/functions/_shared/typed-tokens-resolver.ts`

## 1. Сводка изменений

| Аспект | До | После B-97 |
|---|---|---|
| `customer.ind.*` resolver branch | есть | **есть** (без изменений) |
| `customer.leg.*` resolver branch | есть | **есть** (без изменений) |
| `customer.ent.*` resolver branch | есть | **есть** (без изменений) |
| `executor.leg.*` resolver branch (без org_form) | есть | **есть** (без изменений) |
| `executor.leg.org_form` empty branch | заполнялся `ex?.org_form ?? ''` | **УДАЛЁН** |
| `fillIndExecutor` (`executor.ind.*` 26 пустых веток) | вызывался | **УДАЛЁН** (postponed) |
| `fillEntExecutor` (`executor.ent.*` 24 пустых ветки) | вызывался | **УДАЛЁН** (postponed) |

`buildTypedNamespaceValues` теперь возвращает только токены, действительно покрытые SOT:
`fillIndCustomer + fillLegCustomer + fillEntCustomer + fillLegExecutor (без org_form) + fillExecutorSigner`.

## 2. SOT mapping (фиксированный)

| Namespace | Источник | Колонки | Адрес (`address.*`) |
|---|---|---|---|
| `customer.ind.*` | `client_legal_details` где `client_type='individual'` | `ind_*` + JSONB `ind_address_structured` | `formatStructuredAddress(ind_address_structured, null, 'individual')` |
| `customer.leg.*` | `client_legal_details` где `client_type='legal_entity'` | `leg_*` + JSONB `leg_address_structured` | `formatStructuredAddress(leg_address_structured, leg_address, 'legal_entity')` |
| `customer.ent.*` | `client_legal_details` где `client_type='entrepreneur'` | `ent_*` + JSONB `ent_address_structured` | `formatStructuredAddress(ent_address_structured, ent_address, 'entrepreneur')` |
| `executor.leg.*` (без `org_form`) | `executors` где `subject_type IN (NULL,'legal_entity')` | плоские: `full_name`, `short_name`, `unp`, `director_*`, `bank_*`, `phone`, `email`, `acts_on_basis` + JSONB `legal_address_structured` | `formatStructuredAddress(legal_address_structured, legal_address, 'legal_entity')` |

`executor.leg.org_form`, `executor.ind.*`, `executor.ent.*` — **НЕ имеют resolver branch**. В registry-loop резолвера документа (`document-render.ts`, строка 570) они получат `resolved[token_key] = ''` со статусом `missing` — без ложного «source: executors».

## 3. ИП-форматирование (без кавычек)

Сохранено как было:

- `customer.ent.name` = `formatEntrepreneurDisplayName(ld.ent_name)` → `ИП Федорчук Сергей Валерьевич` (без кавычек, без латиницы).
- `applyEntrepreneurNameWithoutQuotes` поверх `resolverValues['customer.name']` и `executor.name` при `client_type='entrepreneur'` / `subject_type='entrepreneur'`.

## 4. Source-trace для postponed

Postponed-токены попадают в registry-loop как `missing` (значение `''`, status `missing`). В `sourceFor()` (`document-render.ts:549–568`) они формально мапятся под `'executors'` (по префиксу `executor.`), но без значения. Это допустимо, потому что:

- Это **не FLD-плейсхолдер** (нет `field_public_id`).
- В UI он отображается в секции «Нет источника данных» без кнопки копирования (см. PATCH 2).
- В DOCX-шаблонах его никто не должен использовать (нет FLD-ID).
- Если он всё же попадает в шаблон как legacy `{{executor.ind.full_name}}` — он будет резолвиться в пустую строку и не падать.

## 5. Smoke — что должно случиться

(Smoke выполняется при следующем `ai-generate-document` / preview по существующим шаблонам. Отдельный smoke-шаблон с `{{field:FLD-...}}` не добавлялся в этом патче — оставлен как QA-задача на момент первого реального документа по обновлённому каталогу.)

Ожидаемые результаты для FLD-плейсхолдеров из B-97 при resolveCanonicalPayload:

- ФЛ-заказчик (3–5 из `customer.ind.*`, например `FLD-000273` full_name, `FLD-000274` birth_date, `FLD-000282` passport_series, `FLD-000288` phone): значения подставлены, status `resolved`.
- ЮЛ-заказчик (3–5 из `customer.leg.*`, например name, unp, director_full_name, bank_account, address.full): значения подставлены.
- ИП-заказчик (3–5 из `customer.ent.*`, ключевое — `customer.ent.name`): `ИП Федорчук Сергей Валерьевич`, без кавычек.
- ЮЛ-исполнитель (3–5 из `executor.leg.*` без `org_form`): значения подставлены.
- `executor.leg.org_form`, `executor.ind.*`, `executor.ent.*`: НЕ участвуют (нет FLD-ID, в шаблоне их быть не должно).

DoD: `unresolved_count=0` для FLD-токенов B-97; в DOCX/PDF нет `{{...}}`; postponed в DOCX отсутствуют как FLD.

## 6. Что НЕ трогали (STOP-guards)

- `payments_v2` — не трогали.
- `orders_v2` schema — не трогали.
- `allocate_document_number` — не трогали.
- `document_scenarios` / `document_token_aliases` — не трогали.
- Contact Center — не трогали.
- Морфологию (`case-format.ts`, `ru-inflection.ts`) — не трогали.
- `customer.*` typed branches — не трогали.

## 7. Diff кратко

```diff
- fillIndExecutor(...)   // 26 пустых веток → удалено
- fillEntExecutor(...)   // 24 пустых ветки → удалено
- map["executor.leg.org_form"] = isLeg ? (ex?.org_form || "") : "";  // удалено
```

```diff
- import: 148 typed + 4 executor.signer
+ import: 97 typed (B-97 scope) + 4 executor.signer
```
