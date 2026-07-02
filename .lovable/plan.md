## План: Флоу «Оплата по счёту» на сайте (юрлицо, банковский перевод)

### Триггер (без новых полей и тумблеров)
Кнопка = «оплата по счёту», если у оффера в `meta.document_scenarios` есть **включённый** сценарий с `payer_type='legal_entity'` и `payment_channels=['bank_transfer']` (уже настраивается на вкладке «Документы»). Никаких новых enum/чекбоксов не добавляем.

При таком триггере:
- Клик по кнопке НЕ вызывает bePaid/эквайринг.
- Остальные каналы (Карта, ЕРИП, Apple Pay, Google Pay) для этой конкретной кнопки блокируются автоматически — потому что мастер не выходит на экран выбора провайдера, а сразу открывает флоу счёта.
- Мастер счёта отрабатывает: логин → выбор/добавление юрлица → генерация PDF → отправка email + Telegram → создание сделки в CRM по настройкам кнопки.

### Мастер (in-site Dialog поверх iframe через существующий bridge)
Компонент `InvoiceCheckoutDialog.tsx` (новый), шаги:
1. **Auth** — переиспользуем `InlineAuthForm` / `useInlineAuth` из `PaymentDialog`. Пропускается, если пользователь уже залогинен.
2. **Плательщик** — список юрлиц из `legal_entity_requisites` (scope=`user_requisites`) через существующий `useRequisitesV2`. Кнопка «+ Добавить юрлицо».
3. **Новое юрлицо** — встроенный `LegalEntityRequisitesForm` без изменений (автозаполнение по УНП уже работает).
4. **Подтверждение** — «Продукт · Тариф — Сумма BYN», плательщик, кнопка «Выставить счёт».
5. **Успех** — «Счёт №… отправлен на email и в Telegram. Ждём оплату — доступ выдадим автоматически после подтверждения.»

### Backend: `supabase/functions/invoice-checkout-issue` (новая, verify_jwt=true)
Одним атомарным вызовом:
1. Валидирует JWT + Zod-тело (`offer_id`, `tariff_id`, `product_id`, `legal_entity_requisites_id`).
2. Проверяет, что `legal_entity_requisites.user_id = auth.uid()`.
3. Резолвит сценарий через существующий `resolveDocumentScenario` (payer=`legal_entity`, channel=`bank_transfer`). Если сценарий не найден → 422.
4. **Создаёт сделку в CRM** по правилам кнопки (`offer.meta.crm_binding` из вкладки «Дополнительно»): воронка + `stage_on_create`. Ответственный — по существующим правилам продукта/оффера. В `deal.meta` пишем `{ checkout_kind: 'invoice', invoice_number, awaits_payment: true }` — это та самая «пометка», по которой позже (уже вне этой задачи) свяжем входящий платёж со сделкой и переведём её в стадию «Оплачено».
5. Создаёт `orders_v2` (`status='pending'`, `payer_type='legal_entity'`, `legal_entity_requisites_id`, `deal_id`, `invoice_email`, `meta.checkout_kind='invoice'`).
6. Вызывает существующую `canonical-document-generate-strict` со сценарием → получает `document_id` + PDF-URL + `invoice_number`.
7. Вызывает существующую `canonical-document-send` → email пользователя + Telegram (если привязан).
8. Возвращает `{ order_id, deal_id, invoice_number, pdf_url }`.

Ничего нового в БД не создаём: `orders_v2`, `deals`, `legal_entity_requisites`, `canonical_documents` — всё уже есть.

### Frontend
- `HtmlIframePreview` bridge (`open-offer`): при получении оффера с `bank_transfer`-сценарием юрлица монтировать `InvoiceCheckoutDialog` вместо `PaymentDialog`. Определение — фронтовая утилита `isInvoiceOnlyOffer(offer)` поверх `resolveDocumentScenario`.
- Точки монтирования: `UniversalPricingSection`, `ProductLanding`, `SitePageBySlug`, `PricingSection` — все уже принимают оффер, добавляем ветку.
- Правки в админке НЕ нужны: настройка сценария на вкладке «Документы» уже даёт всё, что требуется.

### Что явно НЕ делаем в этой задаче
- Не добавляем радио «Оплата по счёту» в «Способ оплаты» оффера (по твоей правке).
- Не связываем входящий платёж со сделкой автоматически — оставляем на следующую задачу; готовим только пометку `awaits_payment` + `invoice_number` в `deal.meta`.
- Не меняем существующий флоу карточной оплаты и bePaid-эквайринга.

### Порядок работ
1. Diagnose: подтвердить структуру `offer.meta.crm_binding` (воронка + `stage_on_create`) и наличие `deal.meta` jsonb; проверить, что `resolveDocumentScenario` матчит `bank_transfer` для `legal_entity`.
2. Frontend утилита `isInvoiceOnlyOffer` + маршрутизация клика на новый диалог.
3. Компонент `InvoiceCheckoutDialog` (шаги, переиспользование `InlineAuthForm` + `RequisitesV2` + `LegalEntityRequisitesForm`).
4. Edge-функция `invoice-checkout-issue` (auth-gate, Zod, атомарно: сделка → заказ → документ → отправка).
5. Verify (Playwright): не залогинен → клик по кнопке «Оплатить» на «По счёту 375 BYN» → логин → добавить юрлицо → «Выставить счёт» → успех, счёт в `canonical_documents`, сделка в воронке «Gorbova Club» на стадии «Регистрация» с `meta.awaits_payment=true`, письмо в `email_outbox`, сообщение в Telegram.

### DoD
- На сайте «Идеологическая работа» кнопка тарифа «ПО СЧЁТУ» открывает мастер счёта, не эквайринг.
- Пользователь без выхода со страницы: логинится, добавляет юрлицо, получает счёт на email + Telegram.
- В CRM появляется сделка в воронке/стадии, заданной в «Дополнительно» кнопки, с меткой ожидания оплаты по номеру счёта.
- Другие кнопки (Карта — 350 BYN, Индивидуальный договор) продолжают работать как раньше.
