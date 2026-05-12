## да, согласен, с учетом правок:

1. **Не делать всё A → B → C → D → F одним проходом**

Это слишком большой патч. Разбить:

```text
Sprint A: payment.* namespace + повторный smoke
Sprint B: legal_entity payer source + smoke legal entity
Sprint C: canonical numbering non-strict
Sprint D: structured addresses
Sprint E: aliases payer/service/order
```

Сейчас запускать только **Sprint A**, потому что `payment.*` уже есть в registry/picker, но renderer не поддерживает — это главный разрыв.

2. **В Sprint A не трогать нумерацию, юрлица и адреса**

Иначе будет сложно понять, что сломалось.

STOP для Sprint A:

```text
Не менять:
- document.number;
- allocate_document_number;
- client_legal_details selection logic;
- legal_entity payer;
- address rendering;
- executor/customer address logic;
- document scenarios;
- orders_v2/payment_v2 schema.
```

3. *Sprint A: payment. должен использовать последний successful payment по order_id**

Точно зафиксировать selector:

```text
payments_v2
WHERE order_id = current order_id
AND status = 'succeeded'
ORDER BY paid_at DESC NULLS LAST, created_at DESC
LIMIT 1
```

Без fuzzy matching по email/сумме.

4. **В document_data snapshot добавить payment block**

Да, но только read-only snapshot:

```json
payment: {
  payment_id,
  provider,
  payment_channel,
  method,
  method_label,
  description,
  card_brand,
  card_brand_normalized,
  card_last4,
  card_holder,
  paid_at,
  amount,
  currency,
  provider_transaction_id,
  external_reference,
  selection_reason
}
```

5. **Renderer overlay должен сначала брать snapshot payment, потом live fallback**

Порядок:

```text
1. orders_v2.meta.document_data.payment
2. live payments_v2 lookup
3. empty values + warning payment_data_missing
```

6. **payment.description**

Формула:

```text
card/apple/google:
  method_label + ", " + brand + " **** " + last4 + optional ", " + holder

erip:
  "ЕРИП" + optional ", операция " + provider_payment_id

bank_transfer:
  "Банковский перевод" + optional ", № " + provider_payment_id

other:
  method_label + optional provider_payment_id
```

Не использовать `meta.description` как основной источник, потому что это не факт платежа. Можно fallback в конце.

7. `payment.amount` **лучше форматировать явно**

В renderer:

```text
payment.amount = formatMoney(amount, currency)
payment.amount_raw = raw numeric — не добавлять сейчас, если нет токена
```

Если registry token `payment.amount` ожидает currency/money — пусть будет человекочитаемо.

8. **source_trace**

Добавить:

```text
if (k.startsWith('payment.')) return 'payments_v2'
```

Если взято из snapshot:

```text
source может быть payments_v2_snapshot или payments_v2
```

Главное — в proof должно быть понятно.

9. **warnings**

Если payment не найден:

```text
payment_data_missing
```

Если payment найден, но часть card-полей пустая:

```text
не blocker
```

Apple Pay / Google Pay без `holder/brand/last4` — допустимо.

10. **Smoke после Sprint A**

Использовать текущий smoke template, но добавить payment.* блок:

```text
Платеж:
Способ оплаты: {{payment.method_label}}
Описание платежа: {{payment.description}}
Бренд карты: {{payment.card.brand}}
Последние 4 цифры: {{payment.card.last4}}
Держатель: {{payment.card.holder}}
Дата оплаты: {{payment.paid_at|format=short}}
Сумма платежа: {{payment.amount}}
Валюта: {{payment.currency}}
ID транзакции: {{payment.provider_transaction_id}}
Внешняя ссылка: {{payment.external_reference}}
```

Ожидаемо:

- unresolved_count=0;
- нет `{{...}}`;
- если часть payment fields пустая — документ не падает;
- `source_trace` содержит payment source;
- `payments_v2` не изменён.

11. **amount aliases не трогать в Sprint A**

Так как discovery показал, что `deal.amount_formatted` / `deal.amount_in_words` уже фактически работают, не чинить их сейчас. Только проверить в smoke.

## **Утвержденный запуск**

```text
Запускай только Sprint A: payment.* namespace в canonical document renderer + snapshot payment block + smoke proof.

Остальные Sprint B/C/D/F не выполнять в этом проходе.
```

После Sprint A отдельно вернемся к юрлицам.

&nbsp;

Discovery-отчёт + план следующего патча (canonical document render)

> Структурированный отчёт по факту кода/БД. Ничего не меняли — только проверка.

---

### 1. Нумерация документов


| Параметр                                             | Факт                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Где генерируется `document.number`                   | (a) **strict** path: `canonical-document-generate-strict/index.ts:427-468` — `rpc('allocate_document_number', { p_document_id, p_now })`, формат `DDMM/N`, FLD-000069. (b) **non-strict** path: `_shared/document-render.ts:118 generateDocNumber('AKT')` → random `AKT-{yymmdd}-{rnd}`, line 269 пишет `'document.number'`, line 569 — повторно при PDF render. |
| Расходует ли preview/smoke боевую последовательность | **strict**: `mode='generate'` расходует, `mode='preview'` НЕ дергает RPC (line 633). **non-strict**: random fallback ничего не расходует, но и не каноничен — каждый раз новый.                                                                                                                                                                                  |
| Test/smoke режим                                     | Отдельного нет. Strict mode='preview' = безопасный; non-strict — random.                                                                                                                                                                                                                                                                                         |
| Риск                                                 | Non-strict путь не использует `document_number_sequences` и не воспроизводим. Если переключим non-strict на RPC без preview-разделения — будем расходовать счётчик на каждый smoke.                                                                                                                                                                              |


---

### 2. Canonical generation


| Точка                         | Файл                                                                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Основная функция (production) | `supabase/functions/canonical-document-generate/index.ts` (нестрогий путь, использует общий `_shared/document-render.ts`)              |
| Strict-вариант                | `supabase/functions/canonical-document-generate-strict/index.ts` — поле-по-полю через FLD-XXXXXX, своя allocate-схема                  |
| Snapshot                      | `supabase/functions/_shared/document-data-snapshot.ts` (пишет `orders_v2.meta.document_data`) + overlay в `document-render.ts:313-352` |
| `source_trace`                | `document-render.ts:391-409` (sourceFor)                                                                                               |
| `warnings_snapshot`           | `document-render.ts` массив `warnings` (`document_data_snapshot_missing`, `document_data_live_fallback_used` и т.д.)                   |
| Legacy (нельзя ломать)        | `ai-generate-document`, `generate-from-template`, `generate-invoice-act`, `generate-document-pdf`, `document-auto-generate`            |


---

### 3. Renderer namespaces (factual)


| Namespace    | Registry          | Renderer (`document-render.ts`)                              | Источник                                                                       | Статус                                                                                                |
| ------------ | ----------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `document.*` | 30                | строки 270-274 (`number`, `date`, `date_short`, форматы дат) | system.generated                                                               | **OK**                                                                                                |
| `system.*`   | 6                 | через `system.generated` ветку sourceFor                     | system                                                                         | **OK** (минимально)                                                                                   |
| `customer.*` | 24                | строки 288-300                                               | `client_legal_details` (`is_default=true`) + `orders_v2.customer_email`        | **частично**: всегда берётся `is_default=true` row, payer_type не учитывается → юрлицо не подставится |
| `payer.*`    | **0**             | **отсутствует**                                              | —                                                                              | **NOT SUPPORTED**                                                                                     |
| `executor.*` | 15                | строки 277-287                                               | `executors` (`legal_address` flat, `legal_address_structured` НЕ используется) | **частично**: адрес плоский, нет `д./пом./корп.`                                                      |
| `deal.*`     | 28                | строки 302-311 + overlay 322-352 (snapshot)                  | `orders_v2` + snapshot                                                         | **OK** (включая `amount_formatted`/`amount_in_words` aliases)                                         |
| `service.*`  | **0**             | **отсутствует**                                              | —                                                                              | **NOT SUPPORTED** (есть `deal.service_name`)                                                          |
| `payment.*`  | **12 в registry** | **0 в renderer**                                             | должен быть `payments_v2`                                                      | **BLOCKER**: registry есть, renderer нет                                                              |
| `order.*`    | 10                | **0 в renderer** (нет ни одной строки `'order.`)             | должен быть `orders_v2`                                                        | **NOT SUPPORTED**: только в registry                                                                  |


---

### 4. Payment placeholders (детально)

`payments_v2` колонки: `amount`, `currency`, `provider`, `provider_payment_id`, `card_brand`, `card_last4`, `card_holder`, `paid_at`, `meta`, `provider_response`.


| Token                             | Registry | Renderer | Источник доступен                                               | Действие                                                                            |
| --------------------------------- | -------- | -------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `payment.method`                  | да       | **нет**  | `payments_v2.provider` или `meta.method`                        | добавить в renderer                                                                 |
| `payment.method_label`            | да       | **нет**  | derive из `provider`+`card_brand`+`meta.payment_channel`        | reuse `derivePaymentChannel()`                                                      |
| `payment.description`             | да       | **нет**  | `payments_v2.meta.description` или `'Оплата за {product_name}'` | добавить                                                                            |
| `payment.card.brand`              | да       | **нет**  | `payments_v2.card_brand`                                        | добавить                                                                            |
| `payment.card.brand_normalized`   | да       | **нет**  | normalize(`card_brand`)                                         | добавить helper                                                                     |
| `payment.card.last4`              | да       | **нет**  | `payments_v2.card_last4`                                        | добавить                                                                            |
| `payment.card.holder`             | да       | **нет**  | `payments_v2.card_holder`                                       | добавить                                                                            |
| `payment.paid_at`                 | да       | **нет**  | `payments_v2.paid_at` (formatted ru-RU)                         | добавить + поддержка `|format=`                                                     |
| `payment.amount`                  | да       | **нет**  | `payments_v2.amount` (formatMoney)                              | добавить                                                                            |
| `payment.currency`                | да       | **нет**  | `payments_v2.currency`                                          | добавить                                                                            |
| `payment.provider_transaction_id` | да       | **нет**  | `payments_v2.provider_payment_id`                               | добавить (внимание: registry называет `transaction_id`, БД — `provider_payment_id`) |
| `payment.external_reference`      | да       | **нет**  | `payments_v2.meta.external_reference` или `meta.external_ref`   | добавить                                                                            |


**Вывод**: namespace полностью не имплементирован в renderer → **BLOCKER**.

---

### 5. Amount aliases — статус по факту

Проверка snapshot последних paid orders:

```
amount=100, amount_words='Сто белорусских рублей 00 копеек', currency='BYN'
```

Код:

- `document-render.ts:305-306` — defaults для `deal.amount_formatted` и `deal.amount_in_words` есть.
- `document-render.ts:322-327` — snapshot overlay тоже выставляет оба.

**Вывод**: aliases уже работают. Жалоба «пустой» относится к старому smoke до фикса snapshot.executor — закрывается повторным smoke (см. п.10). **NOT a bug.**

---

### 6. Физлицо / юрлицо


| Вопрос                                                | Факт                                                                                                                                                                                                                                                     |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Где определяется `payer_type`                         | `orders_v2.payer_type` (text, default `'individual'`). Snapshot читает в `document-data-snapshot.ts:229`.                                                                                                                                                |
| individual → откуда `customer.*`                      | `client_legal_details WHERE profile_id=X AND is_default=true` (snapshot:149-163). Renderer берёт ind_full_name/ind_address_*.                                                                                                                            |
| legal_entity → откуда **должны** браться `customer.*` | `client_legal_details WHERE profile_id=X AND client_type='legal'` → `leg_name`, `leg_unp`, `leg_address`, `leg_director_*`, `leg_acts_on_basis`, `bank_*`.                                                                                               |
| Умеет ли renderer                                     | Частично: `buildCustomerName()/buildCustomerAddress()` уже ветвятся по `client_type`. НО: snapshot загружает строку **только по `is_default=true**` — если default это individual, документ юрлица заполнится физлицом.                                  |
| Что добавить                                          | В snapshot: при `payer_type='legal_entity'` грузить `client_type='legal'` (fallback latest if no `is_default`); при `individual` — `client_type='individual'`. Дополнительно учесть `orders_v2.meta.documents.payer_legal_details_id` если будет введён. |


**Вывод**: **BLOCKER** для документов юрлица.

---

### 7. Адреса


| Поле                            | Источник                                                                   | Структура         | Текущий рендер                                  | Проблема                                      |
| ------------------------------- | -------------------------------------------------------------------------- | ----------------- | ----------------------------------------------- | --------------------------------------------- |
| `customer.address` (individual) | `client_legal_details.ind_address_*` flat + `ind_address_structured jsonb` | оба есть          | `buildCustomerAddress()` использует только flat | нет префиксов `д./пом./корп.`, нет `АГ`       |
| `customer.address` (legal)      | `leg_address` text + `leg_address_structured jsonb`                        | оба есть          | flat fallback                                   | то же                                         |
| `executor.address`              | `executors.legal_address` text + `legal_address_structured jsonb`          | оба есть          | `executor?.legal_address` flat (line 280)       | то же                                         |
| Источник «АГ Дукора»            | `*_structured.settlement_type` + `settlement`                              | поля в jsonb есть | не читаются                                     | нужно использовать структурированный источник |


**Reusable formatter уже существует**: `src/lib/address/formatStructuredAddress.ts` (frontend). Нужен backend mirror в edge-functions (Deno) с тем же контрактом.

**Вывод**: **HIGH** (видимый дефект в PDF), но не блокирует базовую логику.

---

### 8. Сценарии документов


| Проверка                                     | Факт                                                                                                              |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `document_scenarios` применяются в snapshot  | Да — `document-data-snapshot.ts` использует `resolveDocumentScenario()` (`_shared/document-scenario-resolver.ts`) |
| `template_resolution.source` в `_provenance` | Да — записывается (`override`/`scenario`/`defaults`)                                                              |
| `executor_resolution.source`                 | Да — добавлено в предыдущем спринте; используется `explicitExecutorIdLayered`                                     |
| Fallback `document_defaults`                 | Да — `pick<string>('template_id')` с приоритетом offer→tariff→product                                             |
| Override priority                            | `orders_v2.meta.documents.template_override` / `executor_override` имеют наивысший приоритет                      |


**Вывод**: **OK**, ничего не меняем.

---

### 9. Что не упустить из утверждённого плана


| Статус       | Пункт                                                                                                                                                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅ Закрыто    | Document scenarios SOT, template_resolution provenance, executor_resolution provenance, snapshot executor fix, deal.amount aliases (фактически работают), strict-path canonical numbering, legacy auto-grant Telegram отключён, `derivePaymentChannel` mirror |
| ❌ Не закрыто | `payment.*` в renderer (12 токенов), `payer_type='legal_entity'` загрузка реквизитов юрлица, structured address rendering (executor + customer), `order.*` namespace (10 токенов в registry), non-strict `document.number` без random fallback                |
| 🔴 Blocker   | (1) `payment.*` namespace, (2) legal_entity → leg_* в snapshot, (3) random `document.number` в non-strict path                                                                                                                                                |
| 🟡 Deferred  | `payer.*` aliases (если решим добавить), `service.*` aliases, `case=genitive` морфология, `order.*` namespace, ONLYOFFICE preview, Google Drive sync                                                                                                          |


---

### 10. Следующий патч — конкретный план

**Порядок:** Sprint A (payment.*) → Sprint B (legal_entity payer) → Sprint C (canonical numbering non-strict) → Sprint D (structured addresses) → Sprint F (smoke proof). Sprint E (aliases) — отдельным follow-up.

#### Sprint A — `payment.*` namespace

- **Файл:** `supabase/functions/_shared/document-render.ts`
- **Что:** в `resolverValues` добавить mapping всех 12 токенов из таблицы п.4.
- **Источник:** `payments_v2` row (последний `succeeded` по `order_id`). Если уже грузится в snapshot (`paysForChannel`) — переиспользовать. Иначе добавить read-only выборку в renderer.
- **Snapshot:** в `document-data-snapshot.ts` добавить блок `documentData.payment = {...}` для воспроизводимости + overlay в renderer (`if (docData.payment) {...}`).
- **sourceFor:** добавить `if (k.startsWith('payment.')) return 'payments_v2';`.
- **STOP-guards:** не пишем в `payments_v2`. При отсутствии succeeded payment → пустые значения + `warnings.push('payment_data_missing')` (допустимый warning).
- **DoD:** в smoke source_trace появляется `payments_v2`; PDF содержит метод/последние 4 цифры/дату оплаты.

#### Sprint B — payer_type → правильный источник реквизитов

- **Файл:** `supabase/functions/_shared/document-data-snapshot.ts` (строки 149-163)
- **Что:** заменить безусловную выборку `is_default=true` на ветвление:
  - `legal_entity` → `WHERE client_type='legal' ORDER BY is_default DESC, updated_at DESC LIMIT 1`
  - `individual` → `WHERE client_type='individual' ORDER BY is_default DESC, updated_at DESC LIMIT 1`
- **Provenance:** `_provenance.customer_resolution = { payer_type, picked_legal_details_id, client_type, source }`.
- **STOP-guards:** не модифицировать `client_legal_details`. Если строки нет → warning `customer_legal_details_missing_for_payer_type` (не блокер).
- **DoD:** для order с `payer_type='legal_entity'` в PDF: `customer.name = leg_name`, `customer.unp = leg_unp`, `customer.address` юрлица.

#### Sprint C — каноническая нумерация в non-strict пути

- **Файл:** `supabase/functions/_shared/document-render.ts` (lines 118, 269, 569) + `supabase/functions/canonical-document-generate/index.ts`
- **Что:** удалить `generateDocNumber` random fallback. В `mode='generate'`: precreate `ai_generated_documents` row → `rpc('allocate_document_number')` → inject в `resolved_tokens['document.number']`. В `mode='preview'`: подставлять `«preview-DDMM»` + `warnings.push('document_number_preview_only')`. Counter не двигается.
- **Idempotency:** ключ `canonical:{tpl_id}:{ver_id}:{context_id}`.
- **STOP-guards:** не вызывать `allocate_document_number` в preview/smoke. Не дублировать row при повторе с тем же idempotency_key.
- **DoD:** `1205/N` в PDF generate; `document_number_sequences` инкрементируется ровно на 1; preview не двигает счётчик.

#### Sprint D — structured адреса (executor + customer)

- **Файл:** `supabase/functions/_shared/document-render.ts` (functions `buildCustomerAddress`, ветка executor) + новый `_shared/format-address.ts` (Deno mirror `src/lib/address/formatStructuredAddress.ts`).
- **Что:** хелпер `buildAddressFromStructured(struct, { apartmentPrefix:'пом.' })` → priority structured → fallback flat. Включает префиксы `д./корп./пом.`, settlement_type (`АГ`).
- **Файл-комментарий:** «Backend mirror of src/lib/address/formatStructuredAddress.ts. Keep logic in sync.»
- **Provenance:** `_provenance.address_resolution = { executor: 'structured'|'flat'|'empty', customer: ... }`.
- **STOP-guards:** структурированный источник игнорируем, если структура пустая (все поля null) — fallback на flat. Не угадываем `settlement_type` если его нет.
- **DoD:** PDF executor: `ул. Панфилова, д. 2, пом. 49л, 220035, г. Минск`; customer корректная склейка.

#### Sprint E (deferred follow-up) — `payer.*`, `service.*`, `order.*` aliases

- **Решение:** `payer.*` ← alias на `customer.*`; `service.*` ← alias на `deal.service_*`; `order.*` ← mapping на `orders_v2`.
- Регистрация в `document_token_registry` через миграцию + alias-копирование в renderer после построения `resolverValues`.

#### Sprint F — повторный E2E smoke (proof)

- Тот же smoke main + negative + новый `payer_type='legal_entity'` smoke.
- Проверить: `unresolved_count=0`; в PDF нет `{{...}}`; `document.number = "DDMM/N"`; `payment.*` заполнены; `executor.address` со структурой; для legal smoke — `customer.*` от leg_*.
- `source_trace` обязан содержать: `payments_v2`, `orders_v2`, `client_legal_details` (individual или legal), `executors`, `tariff_offers.meta.document_scenarios`/`document_defaults`, `system.generated`.
- `warnings_snapshot` — только допустимые: `payment_data_missing` (если так), `document_number_preview_only`, `address_structured_partial`. **Никаких `*_unsupported_in_renderer`.**
- Single proof: `.lovable/proofs/document_render_payment_payer_address_numbering_v1.md`.

#### Memory updates (после реализации)

- `mem://architecture/documents/payment-namespace-renderer.md` — payment.* источник = succeeded `payments_v2`, snapshot блок `documentData.payment`.
- `mem://architecture/documents/document-numbering-canonical.md` — единственный writer = `allocate_document_number`; preview не расходует.
- `mem://architecture/documents/address-rendering-standard.md` — structured SOT, flat fallback, префиксы `д./корп./пом.`.
- Обновить `mem://architecture/documents/payer-vs-payment-channel-sot.md`: `payer_type` определяет ветку `client_legal_details` (individual vs legal); `is_default` — НЕ единственный источник.

#### Что НЕ делаем сейчас

- Не трогаем `canonical-document-generate-strict` (он каноничен).
- Не делаем морфологию/`case=genitive`.
- Не меняем схему `payments_v2`/`orders_v2`.
- Не модифицируем `allocate_document_number` RPC.
- Не добавляем поля юрлица в `client_legal_details`.

---

### Риски

- Если у профиля нет `client_type='legal'` row, документ юрлица будет частично пустой → warning + UI-подсказка «Заполните юр. реквизиты».
- `payments_v2.meta.description` может быть пуст — fallback `'Оплата за {product_name}'`.
- `legal_address_structured` null для старых записей → flat fallback обязателен.
- `provider_payment_id` в БД vs `provider_transaction_id` в registry — это alias, не разные поля.

После approve выполняю A → B → C → D → F. Sprint E — отдельным сообщением.