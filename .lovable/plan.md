&nbsp;

да, согласен, с учетом правок:

Дополни план обязательным правилом исполнения:

&nbsp;

## Исполнение одним проходом, без растягивания патча

&nbsp;

Этот PATCH нужно выполнять одним цельным проходом:

&nbsp;

1. Сначала сделать полный read-only review/dry-run:

   - проверить текущие значения FLD;

   - проверить snapshot до rebuild;

   - проверить payment/system/amount_words/customer fields;

   - проверить, какие функции реально используются;

   - зафиксировать root cause и expected diff.

&nbsp;

2. После этого сразу выполнить реализацию F7 → F1 → F2 → F3 → F4 → F5 → F6.

&nbsp;

3. Не дробить на отдельные мини-патчи и не возвращаться с сообщениями вида:

   - «сделал discovery, жду подтверждения»;

   - «сделал F1, продолжать?»;

   - «нужен отдельный спринт на payment/system/amount_words».

&nbsp;

4. Остановиться можно только при реальном STOP-блокере:

   - требуется миграция схемы, которой нет в плане;

   - нет данных/SOT для обязательного FLD;

   - обнаружен риск затронуть payments_v2 / orders_v2 schema / RLS / provider API;

   - dry-run показывает, что фикс выходит за scope этого PATCH.

&nbsp;

5. Если блокера нет — выполнить весь PATCH до конца и дать один финальный отчёт:

   - что было в dry-run;

   - что изменено;

   - какие файлы затронуты;

   - DB proof до/после;

   - preview proof;

   - PDF proof;

   - anti-regression по 2 заказам;

   - source_trace/warnings;

   - итоговая DoD-таблица.

&nbsp;

6. Не делать ручную имитацию успеха:

   - не подставлять значения вручную в order/meta;

   - не чинить только тестовый заказ;

   - не скрывать пустые FLD;

   - не закрывать задачу без PDF proof.

&nbsp;

7. Финальный результат должен закрыть весь scope этого PATCH:

   - system date FLD;

   - payment.* FLD;

   - rebuild snapshot;

   - admin_test label/method;

   - сумма прописью в формате `100 (сто) рублей, 56 копеек`;

   - backend rebuild перед strict generation;

   - rebuild при смене payer_type/overrides;

   - proof_all_placeholders с resolved value OR explicit empty reason.

&nbsp;

Итог: один полный review + одна реализация + один verify-отчёт. Не растягивать PATCH на цепочку отдельных сообщений.

После этого можно запускать.

&nbsp;

План: PATCH-DOC-PLACEHOLDERS-SYSTEM-PAYMENT-2026-05 (revised)

## Root causes (4)

- **RC1** — system-date FLD (FLD-000133/134/209/210) форматировались как ISO/`dd.MM.yyyy` вместо человекочитаемых вариантов из UI-label.
- **RC2** — `payment.*` FLD (FLD-000256..267) не материализуются в `meta.document_data.fields[]`, хотя `documentData.payment` блок собран.
- **RC3** — `snapshotOrderDocumentData` возвращает `skipped_exists`, поэтому смена `payer_type` / реквизитов / `template_override` / `executor_override` не пересобирает FLD; в PDF попадают stale значения.
- **RC4** — admin_test смешивает «канал для scenario matching» (`card`) и «лейбл способа оплаты в документе» (`Тестовый платёж`). Нужно строго разделить.

## F1. Системные FLD (`_shared/standard-fields.ts`)

Вынести RU-date helpers в `_shared/ru-date.ts` (de-dup с `canonical-document-generate-strict`):

- `dotDate(d)` → `dd.MM.yyyy`
- `ruLongDate(d)` → `dd месяц yyyy г.`
- `ruWordsDate(d)` → `d месяц yyyy года`
- `dotDateTime(d)` → `dd.MM.yyyy HH:mm` (TZ = `Europe/Minsk` через `_shared/timezone.ts`)

Финальный mapping (одно значение на FLD, никаких dual ISO+readable):


| FLD                            | value                                                                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| FLD-000133 `system.today`      | `dotDate(now)`                                                                                                               |
| FLD-000134 `system.today_long` | `ruLongDate(now)`                                                                                                            |
| FLD-000209 `system.today_ru`   | `ruWordsDate(now)`                                                                                                           |
| FLD-000210 `system.now`        | `dotDateTime(now)` (`20.05.2026 22:30`). ISO-вариант откладываем в backlog (отдельный `system.now_iso`, **не в этом патче**) |
| FLD-000211 `system.year`       | без изменений                                                                                                                |


## F2. `payment.*` FLD материализация

В `standard-fields.ts` добавить блок, читающий `documentData.payment`:


| FLD                                          | source key                      | formatter                                                                                                                                                                                |
| -------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FLD-000256 `payment.method`                  | `payment.method`                | as-is                                                                                                                                                                                    |
| FLD-000257 `payment.method_label`            | `payment.method_label`          | as-is                                                                                                                                                                                    |
| FLD-000258 `payment.description`             | `payment.description`           | as-is                                                                                                                                                                                    |
| FLD-000259 `payment.card.brand`              | `payment.card_brand`            | as-is                                                                                                                                                                                    |
| FLD-000260 `payment.card.brand_normalized`   | `payment.card_brand_normalized` | as-is                                                                                                                                                                                    |
| FLD-000261 `payment.card.last4`              | `payment.card_last4`            | as-is                                                                                                                                                                                    |
| FLD-000262 `payment.card.holder`             | `payment.card_holder`           | as-is                                                                                                                                                                                    |
| FLD-000263 `payment.paid_at`                 | `payment.paid_at`               | `dotDate`                                                                                                                                                                                |
| FLD-000264 `payment.amount`                  | `payment.amount`                | `**formatMoney(amount, currency)**` → `100,00 BYN` (это пользовательский плейсхолдер «Сумма платежа», см. label в `fields_registry`; raw-вариант отложен в backlog `payment.amount_raw`) |
| FLD-000265 `payment.currency`                | `payment.currency`              | upper                                                                                                                                                                                    |
| FLD-000266 `payment.provider_transaction_id` | as-is                           | &nbsp;                                                                                                                                                                                   |
| FLD-000267 `payment.external_reference`      | as-is                           | &nbsp;                                                                                                                                                                                   |


**Live fallback**: если `documentData.payment` пуст/null — `standard-fields.ts` сам запрашивает последний succeeded `payments_v2` (как уже делает snapshot для buildPaymentBlock). При полном отсутствии платежа:

- все 12 FLD = `""`
- audit warning `payment_data_missing` (общий) + per-field `payment_field_empty:<FLD>` в `source_trace[fid].warnings`.

## F3. `documentData.payment.method` / `method_label` для admin_test

В `_shared/document-data-snapshot.ts → buildPaymentBlock`:

- если `p.provider ∈ {admin_test, admin_test_direct}` → `method='test'`, `method_label='Тестовый платёж'`, `description='Тестовый платёж'`.
- остальные ветки без изменений (card/erip/bank_transfer/apple_pay/google_pay).

`derivePaymentChannel` **не трогаем** — для admin_test продолжает возвращать `card` (нужно для `document_scenarios` matching).
Frontend `src/utils/derivePaymentChannel.ts` тоже без изменений.

## F4. Snapshot rebuild

`_shared/document-data-snapshot.ts`:

- `snapshotOrderDocumentData(supabase, orderId, opts?: { mode?: 'create' | 'rebuild' })`, default `'create'`.
- В `'rebuild'`:
  - НЕ возвращать `skipped_exists`;
  - перезаписать `documentData` полностью;
  - `mergeStandardIntoFields` / `mergeTypedB97IntoFields`: если existing.value пуст ИЛИ `manual_override !== true` → перезаписать новым значением (включая пустое → новое непустое). Сохранять только `manual_override=true`. Это исправляет stale пустые FLD от старого snapshot.
  - audit `document_data.snapshot_rebuilt` с `{ changed_fld_count, manual_override_skipped, payer_type_before/after }`.

## F5. Гарантия rebuild на backend (НЕ на frontend)

`canonical-document-generate-strict/index.ts`:

- В начале handler (после загрузки `order` и до резолва FLD): `await snapshotOrderDocumentData(supabase, orderId, { mode: 'rebuild' })`. Безусловно (контекст всегда order).
- После rebuild перечитать `order.meta.document_data.fields` свежим SELECT.
- Frontend `useDownloadDocument` может вызывать rebuild как оптимизацию, но это не SOT.

`**canonical-document-payment-hook` не трогаем** — там остаётся idempotent `mode: 'create'` (skipped_exists на оплате — корректное поведение).

## F6. UI trigger при смене payer_type

`canonical-deal-fields-update` (или ближайший edge function, обновляющий `orders_v2.payer_type` / `meta.documents.template_override` / `executor_override` / `payer_entity_override`):

- после UPDATE `orders_v2` → `snapshotOrderDocumentData(supabase, orderId, { mode: 'rebuild' })`.
- audit `document_data.snapshot_rebuilt_on_payer_change` с before/after.
- Frontend: после успешного ответа от edge function — invalidate React Query для `document_data` / `useOrderDocuments` (без дополнительного rebuild-вызова).

## F7. «Сумма прописью» (FLD-000192 `document.amount_words` + FLD-000126 `deal.amount_words`)

**Текущий формат** (`numberToWordsRu` в `_shared/docx-helpers.ts`): `Сто белорусских рублей 00 копеек` — **неверно**.

**Требуемый формат**: `100 (сто) рублей, 56 копеек`.

Правило:

1. числовая сумма целыми рублями;
2. в скобках сумма прописью строчными буквами;
3. согласованное слово `рубль/рубля/рублей` (для BYN — без «белорусских»);
4. копейки двумя цифрами `00..99`;
5. согласованное слово `копейка/копейки/копеек`.

Создать новый helper `_shared/amount-with-words.ts` → `formatAmountWithWordsByRublesAndKopecks(amount, currency='BYN')`. Использует существующие `ruIntToWords` / `ruPlural` из `canonical-document-generate-strict` (вынести в `_shared/ru-numerals.ts`).

Тест-кейсы:


| input        | output                                        |
| ------------ | --------------------------------------------- |
| `1,01 BYN`   | `1 (один) рубль, 01 копейка`                  |
| `2,04 BYN`   | `2 (два) рубля, 04 копейки`                   |
| `5,00 BYN`   | `5 (пять) рублей, 00 копеек`                  |
| `21,15 BYN`  | `21 (двадцать один) рубль, 15 копеек`         |
| `100,56 BYN` | `100 (сто) рублей, 56 копеек`                 |
| `124,22 BYN` | `124 (сто двадцать четыре) рубля, 22 копейки` |


Применить helper в `standard-fields.ts` для:

- FLD-000126 `deal.amount_words`
- FLD-000192 `document.amount_words`

И обновить эквивалент в `canonical-document-generate-strict` для `format=words` поверх `data_type=money` (чтобы in-line `{{field:FLD-000125|format=words}}` тоже выдавал новый формат).

**НЕ трогаем**: `FLD-000125 deal.amount`, `FLD-000264 payment.amount`, `FLD-000160 order.amount` — числовые/форматированные поля остаются как есть.

Backlog: «прежний» `numberToWordsRu` оставляем как deprecated с warning-логом, чтобы выявить других потребителей.

## Verify (DoD)

### 1. Reconcile DB (psql)

```sql
-- до rebuild
select payer_type, meta->'document_data'->'_provenance'->'customer_resolution',
       meta->'document_data'->'fields'->'FLD-000209' as today_ru_before,
       meta->'document_data'->'fields'->'FLD-000264' as pay_amt_before,
       meta->'document_data'->'fields'->'FLD-000192' as amt_words_before,
       meta->'document_data'->'fields'->'FLD-000313' as cust_ind_before
from orders_v2 where order_number='ORD-TEST-MPEHCJVZ';

-- сменить payer_type через UI, затем rebuild — re-query те же поля.
```

DoD: для test-order **после rebuild**:

- FLD-000133 `system.today` = `20.05.2026`
- FLD-000134 `system.today_long` = `20 мая 2026 г.`
- FLD-000209 `system.today_ru` = `20 мая 2026 года`
- FLD-000210 `system.now` = `20.05.2026 HH:mm`
- FLD-000264 `payment.amount` = `100,00 BYN`
- FLD-000257 `payment.method_label` = `Тестовый платёж`
- FLD-000256 `payment.method` = `test`
- FLD-000192 `document.amount_words` = `100 (сто) рублей, 00 копеек`
- FLD-000313 `customer.ind.full_name` = `Федорчук Сергей Валерьевич` (после переключения на individual)
- FLD-000321 `customer.ind.personal_number` = из карточки
- FLD-000322 `customer.ind.phone` = из карточки
- `_provenance.customer_resolution.client_type` = `individual`
- `_provenance.customer_legal_details_id` ≠ id юр-карточки

### 2. Preview через `curl_edge_functions /canonical-document-generate-strict` (mode=preview) по test-order

- `resolved_tokens['field:FLD-000209']` = `20 мая 2026 года`
- `resolved_tokens['field:FLD-000264']` = `100,00 BYN`
- `resolved_tokens['field:FLD-000257']` = `Тестовый платёж`
- `resolved_tokens['field:FLD-000313']` = `Федорчук Сергей Валерьевич`
- `resolved_tokens['field:FLD-000192']` = `100 (сто) рублей, 00 копеек`
- `source_trace[FLD-000264].warnings` = `[]` (платёж есть)
- `source_trace[FLD-000256..267]` все имеют `source: 'snapshot_payment'`

### 3. PDF проверка (`/mnt/documents/proof_all_placeholders.pdf`)

Загрузить DOCX с ВСЕМИ FLD из реестра (`{{field:FLD-XXXXXX}}`), запустить generate, скачать PDF, `pdftotext` → grep:

- `20 мая 2026 года` ✓
- `20.05.2026` ✓
- `Федорчук Сергей Валерьевич` ✓
- `100,00 BYN` ✓
- `100 (сто) рублей, 00 копеек` ✓
- `Тестовый платёж` ✓

### 4. Anti-regression — 2 заказа

- Test order `ORD-TEST-MPEHCJVZ` (новый сценарий, admin_test).
- Реальный исторический order с заполненным старым snapshot и реальной оплатой bePaid (выберу из БД paid + bePaid + meta.document_data NOT NULL, **не трогая user-facing статус**).
- В обоих после rebuild: payment FLD заполнены, system FLD в новом формате, customer FLD соответствуют actual `payer_type`.

### 5. Postponed-51 в proof-шаблоне

Postponed token-keys (`executor.ind.*`, `executor.ent.*`, `executor.leg.org_form`) — отмечены в `source_trace[].warnings` как `postponed_no_sot`, **не считаются багом** этого патча.

### 6. Proof all placeholders DoD

Для каждого из ~260 FLD в proof-шаблоне:
`resolved value` OR `explicit empty reason in source_trace/warnings` (`payment_field_empty:<FLD>`, `postponed_no_sot`, `no_data_in_source`, `customer_type_mismatch` и т.д.).

### 7. Sub-DoD: «Сумма прописью» отдельным пунктом

Все 6 тест-кейсов из F7 проходят (snapshot + preview + PDF).

## Scope-guard

НЕ трогаем:

- `derivePaymentChannel` (backend + frontend) — admin_test остаётся `card` для scenario matching.
- `canonical-document-payment-hook` — `mode: 'create'`, idempotent.
- `grant-access-for-order`, bePaid webhook, RLS, миграции схемы.
- `document-download` (закрыт PATCH-DOC-DOWNLOAD-HEADER-ASCII).
- `FLD-000125/160/264-raw` денежные форматы (только `amount_words` FLD-000126/192 меняются).
- Telegram / provider API / access-rules.

## Артефакт

`.lovable/proofs/patch_doc_placeholders_system_payment_2026_05.md` — RC1..RC4, dry-run snapshot diff (before/after), preview-output по test-order + одному real order, PDF-grep proof, DoD-таблица с 7 пунктами, source_trace выдержки.

## Файлы

- `supabase/functions/_shared/ru-date.ts` *(new)*
- `supabase/functions/_shared/ru-numerals.ts` *(new — вынесено из strict generator)*
- `supabase/functions/_shared/amount-with-words.ts` *(new)*
- `supabase/functions/_shared/standard-fields.ts` *(F1, F2, F7)*
- `supabase/functions/_shared/document-data-snapshot.ts` *(F3, F4)*
- `supabase/functions/canonical-document-generate-strict/index.ts` *(F5 — rebuild call, refactor использования ru-numerals/ru-date, F7 в applyFormat)*
- `supabase/functions/canonical-deal-fields-update/index.ts` *(F6 — rebuild на смену payer_type/overrides)*
- `.lovable/proofs/patch_doc_placeholders_system_payment_2026_05.md` *(proof)*

Дальше: подтвердите — выполню по порядку F7 → F1 → F2 → F3 → F4 → F5 → F6, потом Verify (DB → preview → PDF → anti-regression).