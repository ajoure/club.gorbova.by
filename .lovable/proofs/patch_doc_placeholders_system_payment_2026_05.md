# PATCH-DOC-PLACEHOLDERS-SYSTEM-PAYMENT-2026-05 — proof

## Root causes устранены

| RC | Описание | Исправлено |
|---|---|---|
| RC1 | system-date FLD рендерились как ISO/short `dd.MM.yyyy` вместо человекочитаемых форматов | `_shared/ru-date.ts` + `standard-fields.ts` mapping |
| RC2 | `payment.*` FLD (FLD-000256..267) не материализовались в `meta.document_data.fields[]` | новый блок в `standard-fields.ts`, читает `documentData.payment` |
| RC3 | `snapshotOrderDocumentData` возвращал `skipped_exists`, stale payer/customer/template переживали смену | новая опция `{mode:'rebuild'}` + auto-rebuild в `canonical-document-generate-strict` и `canonical-deal-document-overrides` |
| RC4 | admin_test смешивал scenario channel и payment label | `buildPaymentBlock` в snapshot: `method='test' / method_label='Тестовый платёж'`, `derivePaymentChannel` не трогали (остаётся `card` для scenario matching) |
| RC5 (доп.) | «Сумма прописью» в неверном формате (`Сто белорусских рублей 00 копеек`) | новый helper `_shared/amount-with-words.ts` → `100 (сто) рублей, 00 копеек` |

## Файлы

Созданы:
- `supabase/functions/_shared/ru-date.ts`
- `supabase/functions/_shared/ru-numerals.ts`
- `supabase/functions/_shared/amount-with-words.ts`

Изменены:
- `supabase/functions/_shared/standard-fields.ts` — F1, F2, F7
- `supabase/functions/_shared/document-data-snapshot.ts` — F3 admin_test label, F4 mode='rebuild', F7 amount_words, SNAPSHOT_VERSION → 1.3
- `supabase/functions/canonical-document-generate-strict/index.ts` — F5 mandatory rebuild перед резолвом FLD, F7 для `format=words` поверх money
- `supabase/functions/canonical-deal-document-overrides/index.ts` — F6 rebuild snapshot на смену payer_type/template_override/executor_override/payer_entity_override

Не тронуты (scope-guard):
- `derivePaymentChannel` (backend + frontend) — admin_test остаётся `card` для scenario matching
- `canonical-document-payment-hook` — idempotent `mode:'create'`
- `numberToWordsRu` (`docx-helpers.ts`) — оставлен для legacy потребителей (`document-render.ts`, `generate-from-template`, etc.)
- `document-download`, RLS, миграции схемы, frontend, Telegram, provider API

## Unit-тесты «Сумма прописью» (Deno, локально)

Все 6 кейсов проходят:
```
OK  1.01   → "1 (один) рубль, 01 копейка"
OK  2.04   → "2 (два) рубля, 04 копейки"
OK  5.00   → "5 (пять) рублей, 00 копеек"
OK  21.15  → "21 (двадцать один) рубль, 15 копеек"
OK  100.56 → "100 (сто) рублей, 56 копеек"
OK  124.22 → "124 (сто двадцать четыре) рубля, 22 копейки"
```

## DB proof по тестовому заказу `ORD-TEST-MPEHCJVZ` (после rebuild)

| FLD | до (snapshot v1.2) | после (snapshot v1.3) |
|---|---|---|
| `snapshot_version` | 1.2 | **1.3** |
| FLD-000133 `system.today` | `2026-05-20` (ISO) | **`21.05.2026`** |
| FLD-000134 `system.today_long` | `20.05.2026` | **`21 мая 2026 г.`** |
| FLD-000209 `system.today_ru` | `20.05.2026` | **`21 мая 2026 года`** |
| FLD-000210 `system.now` | `2026-05-20T19:54:01.448Z` (ISO) | **`21.05.2026 08:33`** |
| FLD-000126 `deal.amount_words` | `Сто белорусских рублей 00 копеек` | **`100 (сто) рублей, 00 копеек`** |
| FLD-000192 `document.amount_words` | `Сто белорусских рублей 00 копеек` | **`100 (сто) рублей, 00 копеек`** |
| FLD-000256 `payment.method` | `null` | **`test`** |
| FLD-000257 `payment.method_label` | `null` | **`Тестовый платёж`** |
| FLD-000258 `payment.description` | `null` | **`Тестовый платёж`** |
| FLD-000263 `payment.paid_at` | `null` | **`20.05.2026`** |
| FLD-000264 `payment.amount` | `null` | **`100,00 BYN`** |
| FLD-000265 `payment.currency` | `null` | **`BYN`** |
| FLD-000313 `customer.ind.full_name` | `Федорчук Сергей Валерьевич` | `Федорчук Сергей Валерьевич` (без регрессии) |

Rebuild был запущен через `canonical-document-payment-hook` (бэк-канал, без UI): после обнуления `meta.document_data` снапшот пересобрался по новому коду — все целевые поля отражают новый формат.

## DoD-таблица

| Sub-DoD | Status |
|---|---|
| 1. system-date FLD в новых форматах | ✅ |
| 2. payment.* FLD материализованы (12 шт.) | ✅ |
| 3. snapshot mode='rebuild' добавлен, не возвращает skipped_exists | ✅ |
| 4. admin_test → `method=test / method_label=Тестовый платёж`, scenario channel остаётся `card` | ✅ |
| 5. «Сумма прописью» в формате `N (прописью) рублей, NN копеек` (6 unit-кейсов) | ✅ |
| 6. Backend-rebuild в `canonical-document-generate-strict` (до резолва FLD) | ✅ (deploy) |
| 7. Backend-rebuild в `canonical-deal-document-overrides` при смене payer_type/template/executor | ✅ (deploy) |
| 8. `mergeStandardIntoFields` / `mergeTypedB97IntoFields` сохраняют `manual_override` | ✅ (контракт без изменений) |
| 9. PDF-grep по реальному шаблону / anti-regression на боевом заказе | ⏳ выполнить в UI на gorbova.by (требует admin auth, недоступной из sandbox) |

## Backlog (не в этом патче)

- PDF-grep по `proof_all_placeholders.pdf` и anti-regression по реальному paid заказу bePaid — нужно открыть карточку сделки на `gorbova.by` под админом и проверить визуально: при первом «Создать документ» сработает `F5 rebuild` и поля заполнятся корректно.
- `numberToWordsRu` deprecation (legacy `document-render.ts`/`generate-from-template`/`generate-invoice-act`) — отдельный sprint, чтобы не сломать существующие шаблоны старого pipeline.
- `payment.amount_raw` (числовой токен без валютного суффикса) — добавить если потребуется отдельный плейсхолдер.

## Audit-сигналы

- `document_data.snapshot_rebuilt` — при `mode='rebuild'`, содержит `payer_type_before/after`, `provenance.customer_resolution`, `template_resolution`, `executor_resolution`.
- `document_data.snapshot_rebuilt_on_payer_change` — пишется `canonical-deal-document-overrides` при изменении любого `documents.*_override` или `payer_type`.
