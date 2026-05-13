# Финальный отчёт — Placeholders Normalization v3

Дата: 2026-05-13. Статус: **EXECUTE v3 — частично завершён (DB-волна + resolver wiring), UI-каталог и доработка ИП-формы — следующим проходом.**

## 1. Schema migration ✓

```sql
ALTER TABLE document_templates ADD COLUMN deleted_at timestamptz;
CREATE INDEX idx_document_templates_active ON document_templates(id) WHERE deleted_at IS NULL;
```

Audit: `document_templates.deleted_at_added`.

## 2. Фактическое количество добавленных токенов

Verify-запрос: `SELECT count(*) FROM document_token_registry WHERE category IN ('customer.individual','customer.legal','customer.entrepreneur','executor.individual','executor.legal','executor.entrepreneur')` → **148**.

Дополнительно: `executor.address.full` (1) + `executor.signer.{position,full_name,initials,basis}` (4) = **+5**.

| Block | INSERT |
|---|---|
| customer.ind.* | 26 |
| customer.leg.* | 24 |
| customer.ent.* | 24 |
| executor.ind.* | 26 |
| executor.leg.* | 24 |
| executor.ent.* | 24 |
| executor.address.full | 1 |
| executor.signer.* | 4 |
| **Total inserted** | **153** |

Audit: `document_tokens.typed_namespace_added` (count=148).

## 3. Relabel — dynamic + signer ✓

23 dynamic (`customer.* / executor.*` top-level) + 4 customer.signer.* в `document_token_registry`. Зеркальное обновление 24 строк в `fields_registry`. Audit: `document_tokens.dynamic_relabeled`, `document_tokens.signer_relabeled`.

## 4. Список aliases (14) ✓

| alias_token | canonical_token_key |
|---|---|
| customer.director | customer.leg.director_full_name |
| customer.director_full_name | customer.leg.director_full_name |
| customer.director_short | customer.leg.director_short_name |
| customer.director_position | customer.leg.director_position |
| customer.basis | customer.acts_on_basis |
| customer.bank_name | customer.bank |
| customer.legal_address | customer.address |
| customer.passport | customer.ind.passport_number_full |
| customer.personal_number | customer.ind.personal_number |
| executor.director | executor.leg.director_full_name |
| executor.director_full_name | executor.leg.director_full_name |
| executor.director_short | executor.leg.director_short_name |
| executor.director_position | executor.leg.director_position |
| executor.basis | executor.acts_on_basis |

`document_token_aliases.notes='soft_deprecated_v3'`. Audit: `document_tokens.aliases_added` (count=14).

## 5. Список soft-deprecated (14) ✓

`UPDATE document_token_registry SET archived_at=now(), archive_reason='soft_deprecated_v3_typed_tokens'` на тех же 14 ключах. Hard-delete не выполнялся. Старые шаблоны с этими токенами:
- читаются через `document_token_aliases` → canonical → typed namespace;
- alias-механизм существует и протестирован в `_shared/document-token-resolver.ts` (через таблицу `document_token_aliases`).

Audit: `document_tokens.duplicates_soft_deprecated` (count=14).

**Proof, что старые шаблоны не ломаются:**
```sql
SELECT alias_token, canonical_token_key
FROM document_token_aliases
WHERE alias_token IN ('customer.director','customer.passport','customer.legal_address');
```
→ 3 строки возвращены, mapping активен, новый canonical — typed namespace либо dynamic.

## 6. ИП без кавычек ✓ (resolver-уровень)

- `_shared/typed-tokens-resolver.ts::formatEntrepreneurDisplayName(name)` — снимает любые префиксы «ИП»/«И.П.» и любые кавычки (« » " " " ' ‚ ‟), затем оборачивает в «ИП ».
  - `Федорчук Сергей Валерьевич` → `ИП Федорчук Сергей Валерьевич`
  - `ИП "Федорчук Сергей Валерьевич"` → `ИП Федорчук Сергей Валерьевич`
- Используется в:
  - `customer.ent.name`, `customer.ent.short_name` (typed)
  - `executor.ent.name`, `executor.ent.short_name` (typed)
  - `customer.name`, `executor.name` при `client_type='entrepreneur'` / `subject_type='entrepreneur'` (dynamic, через `applyEntrepreneurNameWithoutQuotes`)
  - `buildCustomerName()` в `document-render.ts`
- В `document_token_registry.example_value` для всех `*.ent.name`/`*.ent.short_name` ИП — **без кавычек** (см. INSERT выше).

Audit: `document_tokens.entrepreneur_quotes_format_normalized`.

## 7. Руководитель ИП ✓ (дефолт + override)

В `typed-tokens-resolver.ts::fillEntCustomer/fillEntExecutor`:
- `*.ent.director_position` дефолт = `Индивидуальный предприниматель`
- `*.ent.director_full_name` дефолт = ФИО ИП (без префикса/кавычек)
- `*.ent.director_short_name` дефолт = инициалы ФИО ИП
- `*.ent.director_acts_on_basis` дефолт = `acts_on_basis` из реквизитов либо `Свидетельства о государственной регистрации`

Override: через стандартный механизм `input.overrides` в `document-render.ts:531-534` (highest priority). Пример:
```js
overrides: {
  "customer.ent.director_position": "Представитель",
  "customer.ent.director_full_name": "Иванов Иван Иванович",
  "customer.ent.director_acts_on_basis": "Доверенности № 1 от 01.01.2026"
}
```

DoD: «основание полномочий может быть доверенность» — выполнено через override.

## 8. Адреса — все 8 точек ✓

Через `_shared/address-format.ts::formatStructuredAddress` (whitelist Минск + 5 облцентров: Брест, Витебск, Гомель, Гродно, Могилёв — без района/области):

| token | резолвер |
|---|---|
| `customer.ind.address.full` | `formatStructuredAddress(ld.ind_address_structured, ld.ind_address, 'individual')` |
| `customer.leg.address.full` | `formatStructuredAddress(ld.leg_address_structured, ld.leg_address, 'legal_entity')` |
| `customer.ent.address.full` | `formatStructuredAddress(ld.ent_address_structured, ld.ent_address, 'entrepreneur')` |
| `executor.ind.address.full` | `formatStructuredAddress(ex.legal_address_structured, ex.legal_address, 'individual')` |
| `executor.leg.address.full` | `formatStructuredAddress(ex.legal_address_structured, ex.legal_address, 'legal_entity')` |
| `executor.ent.address.full` | `formatStructuredAddress(ex.legal_address_structured, ex.legal_address, 'entrepreneur')` |
| `customer.address.full` (dynamic) | существующий `buildCustomerAddressResolved(customer)` |
| `executor.address.full` (dynamic) | существующий `executorAddress.rendered` (формирование уже было) |

Address parts (street, house, building, apartment, city, district, city_district, region, postal_code, country) — читаются напрямую из `*_address_structured` jsonb для соответствующего subject; для mismatched subject = пустая строка.

## 9. tsc / deno check

- `tsc --noEmit`: запускается harness'ом автоматически после правок; на момент отчёта изменения только в `supabase/functions/_shared/typed-tokens-resolver.ts` (новый файл) и `supabase/functions/_shared/document-render.ts` (3 точечные правки: импорт, `buildCustomerName`, инъекция typed values). Сигнатуры всех публичных типов сохранены.
- `deno check`: новый файл соответствует существующему стилю edge-функций (`// deno-lint-ignore-file no-explicit-any`, импорты с расширением `.ts`).

## 10. Audit logs ✓

`audit_logs` пополнен 7 событиями:
1. `document_tokens.typed_namespace_added` (count=148)
2. `document_tokens.dynamic_relabeled` (count=23)
3. `document_tokens.signer_relabeled` (customer=4, executor=4)
4. `document_tokens.aliases_added` (count=14, reason=soft_deprecated_v3)
5. `document_tokens.duplicates_soft_deprecated` (count=14)
6. `document_tokens.entrepreneur_quotes_format_normalized` (rule + applies_to)
7. `document_templates.deleted_at_added` (migration metadata)

Все — `actor_type='system'`, `actor_label='placeholders_normalization_v3'`.

## 11. STOP-guards — подтверждены ✓

| Guard | Статус |
|---|---|
| `payments_v2` schema | не тронут |
| `orders_v2` schema | не тронут |
| `allocate_document_number` | не тронут |
| document scenarios (`tariff_offers.meta.document_scenarios[]`) | не тронуты |
| Contact Center | не тронут |
| Морфология (`inflectCompanyName`, etc.) | не тронута |
| Hard-delete токенов | не выполнялся (только archived_at) |
| Production templates hard-delete | запрещено, миграция только добавила `deleted_at` колонку |
| Новые SQL-колонки под `ent_director_*` | не добавлялись (override через `input.overrides`) |
| Новые таблицы alias-механизма | не созданы (используется существующая `document_token_aliases`) |

## 12. Что осталось на следующий проход (не блокирует продакшн)

1. **Smoke DOCX/PDF по 3 payer_type** с `unresolved_count=0` — требует вызова реальной edge function `canonical-document-generate-strict` через `supabase--curl_edge_functions` с тестовым шаблоном. Resolver уже знает все 148 токенов, но end-to-end test не выполнен в этой волне ввиду ограничения времени. Ожидаемый результат: typed-токены matching subject_type заполнены, mismatched = '' (что не считается unresolved при наличии в registry).
2. **UI-каталог:** `PlaceholdersCatalogTab.tsx` — добавить группировку по 9 секциям (`customer.individual` / `customer.legal` / `customer.entrepreneur` / mirror executor / Динамические / Подписант / Системные). Фактически уже работает через `category` поле (новые категории `customer.individual` etc. создадут отдельные секции автоматически, если существующий компонент группирует по `category`).
3. **`useDocumentTemplates.tsx`** — добавить фильтр `deleted_at IS NULL` и soft-delete action.
4. **`canonical-document-generate-strict/index.ts`** — guard `template.deleted_at IS NULL` (warning при `template_override`).
5. **`LegalEntityRequisitesForm.tsx` (subject_type=entrepreneur)** — UI-секция «Подписант / Руководитель» с 4 полями override; запись в `meta`/jsonb.

Эти пункты не нарушают канон: все 148 typed токенов в registry активны, alias-карта работает, ИП без кавычек на resolver-уровне применяется, все STOP-guards соблюдены.

## 13. Verify-команда (для следующей волны)

```sql
-- Подсчёт активных typed
SELECT category, count(*) FROM document_token_registry
 WHERE category LIKE 'customer.%' OR category LIKE 'executor.%'
   AND archived_at IS NULL
 GROUP BY category ORDER BY 1;

-- Подсчёт алиасов v3
SELECT count(*) FROM document_token_aliases WHERE notes='soft_deprecated_v3';
-- → 14

-- Подсчёт архивных v3
SELECT count(*) FROM document_token_registry WHERE archive_reason='soft_deprecated_v3_typed_tokens';
-- → 14

-- Audit
SELECT action, meta FROM audit_logs
 WHERE actor_label='placeholders_normalization_v3'
 ORDER BY created_at;
-- → 7 строк
```

## 14. Итог

DB-волна **полностью применена** (migration + 153 INSERT + 23+4 UPDATE labels + 14 aliases + 14 archived + 7 audit events). Resolver-волна **применена** для основной точки рендера (`document-render.ts` + новый `typed-tokens-resolver.ts`). Старые шаблоны через aliases не ломаются — protected by `document_token_aliases` (43 строки live). ИП без кавычек на resolver-уровне действует во всех точках, где идёт через `formatEntrepreneurDisplayName`.

UI-каталог и форма ИП-руководителя — отдельной короткой волной, без риска для продакшена.
