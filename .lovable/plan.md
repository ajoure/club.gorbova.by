да, согласен, с учетом правок:

План Stage 2C принимаю. Реализация правильная: один `document_url` per row + единая кнопка документа в стиле bePaid.

# **Stage 2C — approve на Execute**

Цель корректная:

```text
PaymentsTable должен показывать один документ-action для Stripe payment/refund, как у bePaid.
```

Без:

```text
Invoice
PDF
Документ ещё не получен
```

если Stripe hosted URL доступен.

---

# **Что в плане правильно**



## **1. Единый**

`document_url`

Правильно добавить в `UnifiedPayment` derived field:

```text
document_url
```

Это UI-derived поле, а не новый SOT.

SOT остаётся:

```text
payments_v2.receipt_url
payments_v2.meta
parent_payment_id
provider_response
```

## **2. Payment/refund не смешивать**

Правильно:

- payment row открывает документ оплаты;
- refund row открывает документ возврата или hosted page, где виден refund;
- payment row не должен открывать refund URL;
- refund row не должен ошибочно писать «документ не получен», если можно открыть parent charge receipt / Stripe hosted page.

## **3. bePaid не трогать**

Правильно:

```text
bePaid document_url = receipt_url
```

и весь retry/получение чека через `bepaid-get-receipt` остаётся как есть.

---

# **Обязательные правки перед Execute**





## **1. Не использовать**

`checkout_session.url` **как document fallback**

В mapping для Stripe payment убрать или оставить только как debug, но не как документ.

```text
meta.stripe.checkout_session?.url
```

не является документом оплаты. Это checkout URL, который после оплаты может быть недоступен/истёк и не должен открываться как чек.

Итоговый priority для Stripe payment:

```text
1. meta.stripe.charge.receipt_url
2. receipt_url
3. meta.stripe.hosted_invoice_url
4. meta.stripe.invoice.hosted_invoice_url
5. meta.stripe.invoice_pdf
6. meta.stripe.invoice.invoice_pdf
7. null
```

## **2. Для refund fallback на parent charge receipt должен быть явно помечен**

Если refund row открывает receipt родительского charge, tooltip должен быть не «Открыть чек», а например:

```text
Открыть документ Stripe
```

или:

```text
Открыть квитанцию Stripe с информацией о возврате
```

Потому что это не отдельный refund PDF, а Stripe hosted receipt/charge page, где отражён refund.

## **3. Parent lookup должен работать по обоим ключам**

Для refund parent map искать родителя по:

```text
parent_payment_id
meta.parent_payment_id
meta.parent_payment_uid
provider_payment_id
meta.stripe.payment_intent_id
```

Но использовать только доказуемые связи.

Если parent найден неоднозначно — не подставлять случайный URL, а оставить `document_url=null` и зафиксировать в proof.

## **4. Не ломать статусы bePaid receipt**

В `ReceiptStatusBadge` не менять поведение bePaid.

Stripe-specific tooltip добавлять через provider-aware branch:

```text
if provider === 'stripe'
```

bePaid retry/get receipt должен остаться прежним.

## **5. Drawer — не блокирует PASS**

Согласен: если у Stripe есть несколько документов (`hosted_invoice_url`, `invoice_pdf`, `receipt_url`), в основной таблице оставляем одну кнопку.

Дополнительные ссылки в drawer — backlog, не блокирует Stage 2C.

Добавить backlog-note:

```text
PATCH-STRIPE-DOCUMENTS-DRAWER-V2
```

---

# **Исправленный mapping**

## **Stripe payment row**

```text
1. meta.stripe.charge.receipt_url
2. payments_v2.receipt_url
3. meta.stripe.hosted_invoice_url
4. meta.stripe.invoice.hosted_invoice_url
5. meta.stripe.invoice_pdf
6. meta.stripe.invoice.invoice_pdf
7. null
```

Запрещено:

```text
refund.receipt_url
refund hosted url
checkout_session.url
```

## **Stripe refund row**

```text
1. meta.provider_response.stripe.refund.receipt_url
2. meta.provider_response.stripe.refund.hosted_receipt_url
3. meta.stripe.refund.receipt_url
4. meta.stripe.refund.hosted_receipt_url
5. parent payment: meta.stripe.charge.receipt_url
6. parent payment: receipt_url
7. parent payment: meta.stripe.hosted_invoice_url
8. parent payment: meta.stripe.invoice.hosted_invoice_url
9. null
```

Если используется parent payment receipt, tooltip:

```text
Открыть документ Stripe с информацией о возврате
```

---

# **Execute разрешён**

Файлы:

```text
src/hooks/useUnifiedPayments.tsx
src/components/admin/payments/ReceiptStatusBadge.tsx
src/components/admin/payments/PaymentsTable.tsx
.lovable/proofs/stripe_ui_provider_parity_cleanup_v1.md
```

---

# **Verify Stage 2C**

Проверить 4 строки:

## **1. Stripe payment 2.00 USD**

Ожидаемо:

- одна кнопка документа;
- открывает hosted invoice / invoice PDF;
- нет сырого `Invoice/PDF` в таблице.

## **2. Stripe payment +5 BYN**

Ожидаемо:

- одна кнопка документа;
- открывает документ оплаты;
- не открывает refund document.

## **3. Stripe refund −5 BYN**

Ожидаемо:

- одна кнопка документа;
- открывает refund receipt или parent charge hosted page с refund information;
- нет «Документ ещё не получен», если fallback URL найден.

## **4. bePaid payment**

Ожидаемо:

- кнопка/статус чека работает как раньше;
- retry/get receipt не сломан.

---

# **DoD Stage 2C**

Stage 2C = PASS, если:

- Stripe payment row открывает документ оплаты;
- Stripe refund row открывает документ возврата / Stripe hosted page с refund info;
- payment row не открывает refund URL;
- refund row не показывает «документ не получен», если есть fallback URL;
- в таблице нет сырых `Invoice` / `PDF`;
- UI документа — единая иконка/кнопка как у bePaid;
- bePaid receipt UX не сломан;
- proof обновлён со SQL/meta и after screenshots.

Начинай Execute Stage 2C.

&nbsp;

Отчет о выполнении: discovery завершён. План Stage 2C ниже.

## Цель

В `/admin/payments` (PaymentsTable) убрать парные ссылки `Invoice` / `PDF` и сделать одну кнопку «Документы» (как у bePaid) для Stripe payment и refund строк. Payment-строка не должна открывать refund-URL; refund-строка не должна писать «Документ ещё не получен», если URL доступен (включая fallback на чек родительского charge).

## Discovery (read-only, уже выполнено)

Stripe в БД сейчас (3 строки):

- payment 2.00 USD (sub `sub_1TgWoO…`): `receipt_url=NULL`, в `meta.stripe`: `hosted_invoice_url`, `invoice_pdf`, `invoice_id`, `payment_intent_id`, `subscription_id`. → должна показать одну кнопку через invoice URL.
- payment 5.00 BYN (one-time, Сергей): `receipt_url` есть (Stripe hosted receipt), в `meta.stripe`: `payment_intent_id`, `checkout_session_id`. → одна кнопка через `receipt_url`.
- refund −5.00 BYN: `receipt_url=NULL`, `meta.provider_response.stripe.refund` без `hosted_receipt_url`; есть `parent_payment_id=2d40bc7e…` (это payment 5 BYN с готовым `receipt_url`). → fallback на чек родительского charge.

Текущий код:

- `useUnifiedPayments.tsx` уже извлекает `stripe_hosted_invoice_url` / `stripe_invoice_pdf` и `receipt_url`, но НЕ извлекает `parent_payment_id`, charge receipt и refund-специфичные URL.
- `PaymentsTable.tsx` (ячейка `receipt`, ~659–727) рендерит две сырые ссылки `Invoice` / `PDF` и для Stripe без URL пишет «Документ ещё не получен».
- `ReceiptStatusBadge.tsx` уже умеет работать с `provider='stripe'` (no-op для `bepaid-get-receipt`), но текущий fallback зависит от наличия `receipt_url`.

## Реализация

### 1. `src/hooks/useUnifiedPayments.tsx` — единый `document_url` per row

Добавить в тип `UnifiedPayment` поле `document_url: string | null` (читается ТОЛЬКО для рендера; SOT остаётся `receipt_url` + `meta`).

Резолвер (pure, без сетевых вызовов):

- bePaid: `document_url = receipt_url` (как сейчас).
- Stripe `transaction_type='payment'`:
  1. `meta.stripe.charge.receipt_url`
  2. `receipt_url` (если уже сохранён в колонке)
  3. `meta.stripe.hosted_invoice_url`
  4. `meta.stripe.invoice_pdf`
  5. `meta.stripe.checkout_session?.url` (если есть), иначе `null`.
  Никогда не использовать refund-URL для payment-строки.
- Stripe `transaction_type='refund'`:
  1. `meta.provider_response.stripe.refund.receipt_url` / `hosted_receipt_url` (если когда-нибудь появится)
  2. fallback: `receipt_url` родительского платежа — построить map `paymentId → receipt_url + meta.stripe.charge.receipt_url` по `payments_v2`, искать `meta.parent_payment_id` или `meta.parent_payment_uid` (= `provider_payment_id` родителя).
  3. fallback: `meta.stripe.hosted_invoice_url` родителя.
  4. иначе `null`.

Реализовать через два прохода: сначала собрать словарь родителей, затем при map'е refund-строк подставлять.

### 2. `src/components/admin/payments/ReceiptStatusBadge.tsx` — мягкий tooltip для Stripe

Минимальная правка: когда `provider='stripe'` и `derivedStatus='available'`, в тултипе показывать «Открыть документ Stripe» вместо «Открыть чек». Когда `unavailable` для Stripe и `transaction_type='refund'` — тултип «Документ возврата недоступен» (вместо общего «Чек недоступен»). Прокинуть опциональный `transactionType` пропс.

### 3. `src/components/admin/payments/PaymentsTable.tsx` — единая кнопка

Заменить блок `case 'receipt'` (lines ~659–727):

- Убрать ветку с двумя `<a>Invoice</a>` / `<a>PDF</a>`.
- Всегда рендерить `<ReceiptStatusBadge receiptUrl={payment.document_url} transactionType={payment.transaction_type} provider={payment.provider} … />`.
- Удалить fallback `«Документ ещё не получен»` для Stripe — теперь решает badge через `derivedStatus`. Для Stripe без URL badge покажет серый `XCircle` с тултипом «Документ недоступен» (он уже такой для Stripe).

bePaid-путь не меняется: `document_url = receipt_url`, бейдж работает идентично текущему поведению, кнопка «получить чек» (`bepaid-get-receipt`) сохраняется.

### 4. Drawer (опционально, без блокировки PASS)

Если у Stripe payment одновременно есть и charge receipt, и invoice/PDF — оставить кнопку одну (основной URL), а дополнительные ссылки (Invoice / PDF) перенести в существующий `PaymentDetailsDrawer` (вне основной таблицы). Если drawer-расширение не вмещается в Stage 2C — оставить как backlog-note в proof и не блокировать PASS.

## Proof (`.lovable/proofs/stripe_ui_provider_parity_cleanup_v1.md`)

Добавить раздел Stage 2C:

- Before: текущий рендер с `Invoice` / `PDF` и «Документ ещё не получен» (скрин уже у пользователя).
- SQL-снапшоты для трёх строк (2 USD / +5 BYN / −5 BYN) с `meta.stripe` / `meta.provider_response.stripe.refund` / `parent_payment_id` (готово из discovery выше).
- Mapping-логика payment / refund (копия из раздела 1 плана).
- After-скрины: payment $2 → invoice, payment +5 BYN → Stripe receipt, refund −5 BYN → чек родительского charge, bePaid regression (одна строка).
- DoD checklist Stage 2C.

## Файлы под изменение

- `src/hooks/useUnifiedPayments.tsx` (тип + резолвер + parent map).
- `src/components/admin/payments/ReceiptStatusBadge.tsx` (tooltip wording + опц. `transactionType`).
- `src/components/admin/payments/PaymentsTable.tsx` (ячейка `receipt`).
- `.lovable/proofs/stripe_ui_provider_parity_cleanup_v1.md` (раздел Stage 2C).

## DoD Stage 2C

- Stripe payment row открывает документ оплаты (charge receipt > invoice hosted > invoice pdf).
- Stripe refund row открывает чек/документ возврата (refund receipt, иначе чек родителя).
- Payment row никогда не указывает на refund-URL.
- Refund row не пишет «документ ещё не получен», когда есть fallback URL.
- В таблице нет сырых текстов `Invoice` / `PDF` — только единая кнопка-иконка как у bePaid.
- bePaid receipt-кнопка и retry через `bepaid-get-receipt` не сломаны.
- Proof обновлён, SQL и скрины приложены.