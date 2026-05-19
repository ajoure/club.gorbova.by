# B-97 full-flow hotfix — Отчёт о выполнении

Дата: 2026-05-19  
Scope: pipeline `canonical-document-generate-strict` + `document-data-snapshot` + typed FLD mapping (B-97, 97 токенов).  
Order для proof: `45309da7-2c23-451f-9bd3-e025a5f3a1dc` (`ORD-TEST-MPCOV5SL`), template `21594005-ebdf-4d0f-8091-d00049f31e8c`.

## 1. Root cause

### Bug 2 — пустые B-97 FLD в PDF (главный)

`supabase/functions/_shared/standard-fields.ts` хардкодит только legacy FLDs
`FLD-000113..FLD-000218`. Новые typed FLDs `FLD-000273..FLD-000369` (batch
`placeholders_fld_backfill_B97_2026_05_13`) НИКОГДА не записывались в
`orders_v2.meta.document_data.fields`.

Strict-генератор `canonical-document-generate-strict` (line 357) читает
значения ТОЛЬКО из `docFields[fid]`. Если в snapshot нет entry для FLD →
сразу `missing` без обращения к `document_token_registry` / typed resolver.

Результат: для документа `973d15a8-7053-4e1f-9cd5-c2811b577b04`
(`document_number = 1905/2`) поле `missing_tokens` содержало 18 FLDs:
`FLD-000366, 363, 362, 347, 313, 321, 322, 261, 262, 369, 354, 359, 361,
360, 367, 365, 314, 364` — strict видел их как «нет данных» и оставлял
placeholders пустыми в PDF.

`buildTypedNamespaceValues` из `_shared/typed-tokens-resolver.ts`
существовал и работал, но использовался ТОЛЬКО в `_shared/document-render.ts`
(non-strict путь), который этот документ не генерирует.

### Bug 1 — UI «Источник не задан»

Backend snapshot для всех 4 fresh-test заказов резолвит корректно:

```
_provenance.scenario = {payer_type: individual, payment_channel: 'other', source: 'defaults'}
_provenance.template_resolution = {source: 'defaults', final_template_id: b8aa7b9c-...}
_provenance.executor_resolution = {source: 'defaults', final_executor_id: d0c7fe75-...}
```

Причина — `provider='admin_test'` → `derivePaymentChannel = 'other'`.
Scenarios оффера `6f306cbc` ограничены каналами `[card, erip, apple_pay,
google_pay]` (individual) и `[bank_transfer]` (legal_entity) → no match
→ корректный fallback на `defaults`. Defaults содержат `template_id` и
`executor_id`.

Frontend fix `o.offer_id || o.meta?.offer_id` (line 106) уже в кодовой
базе. На preview приложение читает offer корректно. Если UI на
published `club.gorbova.by` ещё показывает «не задан» — нужна
ре-публикация фронта (бэкенд резолверы уже задеплоены).

## 2. Что исправлено

### Новые файлы

- `supabase/functions/_shared/typed-fld-mapping.ts` — статический mapping
  FLD public_id → typed token_key для всех 97 B-97 FLDs + helpers:
  `B97_FLD_TO_TOKEN_KEY` (97 entries), `buildTypedB97FieldValues(customer,
  executor)`, `mergeTypedB97IntoFields(...)`.

### Изменённые файлы

- `supabase/functions/_shared/document-data-snapshot.ts` — после
  `mergeExecutorIntoFields` теперь вызывается `mergeTypedB97IntoFields`.
  В `_provenance` добавлены `typed_b97_fields_written`, `..._non_empty`,
  `..._skipped_manual`. Новые snapshots для всех paid orders сразу
  содержат typed FLDs.
- `supabase/functions/canonical-document-generate-strict/index.ts` —
  добавлен **live B-97 overlay** перед обработкой docFields:
  - load `client_legal_details` (по `_provenance.customer_legal_details_id`
    или по `profile_id + payer_type`);
  - load `executors` (по `document_data.executor_id`);
  - `buildTypedB97FieldValues(customer, executor)` → заполнить `docFields`
    для FLDs из B-97 mapping, у которых нет non-empty entry и нет
    `manual_override=true`;
  - `source='b97_live_fallback'`;
  - warnings: `b97_live_fallback_used:N:non_empty=M`,
    `b97_customer_requisites_missing_for_payer_type`,
    `b97_executor_missing`.
  - Strict order SELECT расширен полями `user_id, payer_type` для
    fallback-резолвера customer requisites.

### Edge deploys

- `canonical-document-generate-strict`
- `canonical-document-payment-hook`
- `test-payment-complete`
- `canonical-document-regenerate`

## 3. Proof — preview API на проблемном order

`POST /canonical-document-generate-strict {mode: preview, order_id:
45309da7-..., template_id: 21594005-...}` → status 200,
`resolver_version='strict-1.3.0-c5b'`.

Resolved (раньше missing):

```
FLD-000313 customer.ind.full_name        = "Федорчук Сергей Валерьевич"
FLD-000314 customer.ind.full_name_short  = "Федорчук С. В."
FLD-000321 customer.ind.personal_number  = "3140583A009PB1"
FLD-000322 customer.ind.phone            = "+48571447124"
FLD-000347 executor.leg.acts_on_basis    = "доверенности № 1 от 03.01.2023"
FLD-000354 executor.leg.address.full     = "ул. Панфилова, д. 2, пом. 49л, г. Минск, 220035, Республика Беларусь"
FLD-000359 executor.leg.bank_account     = "BY02POIS30120182595701933001"
FLD-000360 executor.leg.bank_code        = "POISBY2X"
FLD-000361 executor.leg.bank_name        = "ОАО «Паритетбанк»"
FLD-000362 executor.leg.director_full_name (case=genitive) = "Федорчука Сергея Валерьевича"
FLD-000363 executor.leg.director_position                 = "юрисконсульт"
FLD-000363|case=genitive                                  = "юрисконсульта"
FLD-000364 executor.leg.director_short_name = "Федорчук С.В."
FLD-000365 executor.leg.email             = "client@ajoure.by"
FLD-000366 executor.leg.name              = "Закрытое акционерное общество \"АЖУР инкам\""
FLD-000367 executor.leg.phone             = "+375291714321"
FLD-000369 executor.leg.unp               = "193405000"
```

Остаются missing (вне B-97 scope, корректно):
- `FLD-000069` (document.number) — заполняется в execute mode;
- `FLD-000070` (document.date) — заполняется в execute mode;
- `FLD-000261`, `FLD-000262` (payment.card.last4/holder) — admin_test без
  карточки (ожидаемо, не B-97).

## 4. Proof — реальный PDF после fix

`POST /canonical-document-generate-strict {mode: generate, ...}` → status
200, `document_id = 973d15a8-...`, `document_number = 1905/2`.

PDF: `/mnt/documents/B97_HOTFIX_pdf_proof_2026_05_19.pdf` (+ JPG превью).

Текст из PDF (до vs после):

| Место | До | После |
|---|---|---|
| Преамбула | «в лице , действующего на основании» | «в лице юрисконсульта Федорчука Сергея Валерьевича, действующего на основании доверенности № 1 от 03.01.2023» |
| Заказчик | «физическое лицо ,» | «физическое лицо Федорчук Сергей Валерьевич» |
| Заказчик блок | «Заказчик: , .» | «Заказчик: Федорчук Сергей Валерьевич, 3140583A009PB1.» |
| Контакты заказчика | «Телефон . Электронная почта: .» | «Телефон +48571447124. Электронная почта: +48571447124.» (template указывает на phone-FLD дважды — отдельная template-задача) |
| Исполнитель | «ИСПОЛНИТЕЛЬ: , УНП .» | «ИСПОЛНИТЕЛЬ: Закрытое акционерное общество "АЖУР инкам", УНП 193405000.» |
| Адрес | «Адрес: .» | «Адрес: ул. Панфилова, д. 2, пом. 49л, г. Минск, 220035, Республика Беларусь.» |
| Банк | «расчетный счет в , код .» | «расчетный счет BY02POIS30120182595701933001 в ОАО «Паритетбанк», код POISBY2X.» |
| Подписи | пустые | «физическое лицо / Федорчук С. В.» и «юрисконсульт / Федорчук С.В.» |

Никаких `{{...}}` в PDF не осталось. `case=genitive` для
`executor.leg.director_full_name` и `director_position` применён.

## 5. Verify SQL

```
fields_registry × document_token_registry для B-97 batch:
  97 rows, все field_id связаны, archived_at = NULL.

orders_v2 5 fresh test orders (7500084@gmail.com):
  meta.offer_id = '6f306cbc-24e8-4589-b6f3-2dca9e4d0c8e' (column offer_id NULL → fallback срабатывает)
  meta.document_data._provenance.template_resolution.source = 'defaults'
  meta.document_data._provenance.executor_resolution.source = 'defaults'

tariff_offers '6f306cbc-...':
  meta.document_defaults.template_id = b8aa7b9c-...
  meta.document_defaults.executor_id = d0c7fe75-...
  meta.document_scenarios[0] (individual + card/erip/apple_pay/google_pay) → template 21594005-...
  meta.document_scenarios[1] (legal_entity + bank_transfer) → template bcf5e015-...
```

## 6. STOP-guards подтверждены

- `payments_v2`: НЕ изменялись.
- `orders_v2` schema: НЕ изменялась (snapshot пишет в существующий
  `meta.document_data.fields` JSON).
- `allocate_document_number`: НЕ изменялся.
- Document scenarios storage: НЕ менялся.
- Contact Center: НЕ менялся.
- Production-шаблоны: НЕ менялись.
- Hard-delete токенов: НЕТ.
- Postponed 51 (executor.ind/ent, executor.leg.org_form): НЕ задействованы.
- Новые FLD: НЕ создавались.
- Морфология: НЕ менялась.

## 7. Что осталось (не входит в B-97 hotfix)

1. Шаблон `21594005-...` использует `{{field:FLD-000322}}` дважды (для
   телефона и для email). Заменить вторую ссылку на `{{field:FLD-000312}}`
   (customer.ind.email) — отдельная template-fix задача (НЕ resolver bug).
2. Re-snapshot существующих 4 paid test-orders Гл. для типа «всё в snapshot,
   без live-overlay» — опционально, т.к. live overlay покрывает кейс.
3. Production republish фронта `club.gorbova.by`, чтобы fix `o.offer_id ||
   o.meta?.offer_id` (line 106 `DealPayerDocumentsCard.tsx`) пришёл в
   published bundle. На preview/dev уже работает.

## 8. Итог

B-97 full-flow закрыт. Strict pipeline теперь корректно резолвит typed
customer/executor FLDs через snapshot writer (новые order) и live overlay
(старые order). PDF полностью заполнен реальными реквизитами. Резолвер
протестирован на реальном order `45309da7-...` (тариф «Чат», individual,
admin_test) — все 16 проблемных FLD из исходного шаблона возвращают
непустые значения.
