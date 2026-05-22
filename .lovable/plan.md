## да, согласен, с учетом правок:

1. **Переоформить заголовки строго**
  &nbsp;
  &nbsp;
  - Вместо `## Отчет о диагностике` сделать:  
  `Отчет о выполненной работе: диагностика ошибки генерации документов в /purchases`
  - Вместо `## План фикса` сделать:  
  `План: исправление определения payment_channel в canonical-document-generate-strict`
2. **Шаг 1 — корректный и приоритетный**
  - Расширение SELECT в `canonical-document-generate-strict` на `meta, card_last4, card_brand` — правильный минимальный фикс.
  - Это действительно объясняет, почему `derivePaymentChannel()` падает в `other`.
3. **Добавить STOP-guard перед деплоем**  
Перед execute обязательно проверить:
  - что `derivePaymentChannel()` реально принимает тот же объект `paymentRow`;
  - что `card_last4` существует в `payments_v2`;
  - что поле называется именно `card_last4`, а не лежит только в `provider_response`;
  - что для ERIP/Apple Pay/Google Pay логика не ломается.
4. **Уточнить** `mode='preview' / mode='generate'`  
В плане указано `mode='preview'`, но ранее canonical-функция могла принимать `force_rebuild`, `admin_force`, `order_id`, `template_id`. Нужно добавить read-only проверку фактического контракта функции, чтобы Lovable не отправил несуществующий `mode`.
5. **Добавить тест не только по Багинской**  
В DoD добавить минимум:
  - 1 заказ с card;
  - 1 заказ с bank_transfer;
  - 1 заказ с ERIP, если есть;
  - 1 заказ Apple/Google Pay, если есть.
  Иначе можно починить card, но сломать остальные каналы.
6. **Frontend mirror — не “если нет, добавить”, а строго verify**  
Шаг 2 правильно оставить как проверочный. Но если frontend mirror используется только для UI-доступности кнопки, он не должен становиться вторым source of truth. Backend canonical guard остается главным.
7. **Audit после фикса**  
В DoD добавить проверку:
  - `document.generate_blocked_document_template_not_configured` не появляется для заказов, где `payments_v2.card_last4 IS NOT NULL`;
  - появляется успешный audit с resolved scenario/template/source;
  - желательно metadata: `{ payment_channel: "card", scenario_source: "offer", template_id }`.
8. **UX-правку лучше сделать отдельным мелким UI patch**  
Шаг 6 можно оставить в этом плане, но пометить как `UI-only follow-up внутри этого же спринта`, чтобы не смешивать critical backend fix и косметику.
9. **Proof-файл — правильно**  
`.lovable/proofs/document_generate_strict_payment_channel_fix_2026_05_22.md` оставить. Обязательно добавить туда:
  - before: `payment_channel=other`, blocked `no_template`;
  - after: `payment_channel=card`, scenario matched, template_id найден;
  - список изменённых файлов;
  - diff-summary.
10. **Добавить обязательные языковые требования**  
В план явно вставить:

&nbsp;

- план должен быть составлен на русском языке;
- отчет о выполненной работе должен быть составлен на русском языке;
- вся переписка, пояснения, proof и результаты — только на русском языке.

Итог: фикс правильный, минимальный и безопасный. Главное — не ограничиться одной строкой SELECT без проверки фактического контракта функции и без регрессии по другим payment channels.

&nbsp;

Отчет о диагностике

### Симптом

- Админ: «Создать документ» работает (с ошибкой в UI, но документ создаётся).
- Клиент в /purchases: «Ошибка, попробуйте через 10 секунд» / «Edge function not working».
- У клиентов, заполнивших новую карточку реквизитов, и у исторических сделок — одинаково.

### Root cause (proof из БД + audit_logs)

1. `audit_logs` за 22.05.2026 для Багинской (order `aca70f03…`, `7014f44d…`, `baf5801c…`) забит записями:
  ```
   document.generate_blocked_document_template_not_configured
   meta: { offer_source: "order_offer", reason: "no_template" }
  ```
2. У оффера `bc0f7a90` (тариф Багинской) сценарии в `tariff_offers.meta.document_scenarios[]` СУЩЕСТВУЮТ корректно:
  - `payer_type: individual` + `payment_channels: [card, erip, apple_pay, google_pay]` → `template_id: 7caee05d`
  - `payer_type: legal_entity` + `payment_channels: [bank_transfer]` → `template_id: bcf5e015`
3. Платежи в `payments_v2`: `provider='bepaid'`, `status='succeeded'`, `card_last4` заполнен (`8215`, `0714`, `6478`), но `meta.payment_method` / `meta.is_erip` / `meta.payment_channel` — все NULL (bePaid их не пишет).
4. `derivePaymentChannel(row)` корректно возвращает `'card'` через ветку `if (row.card_last4 && row.card_last4.length > 0) return 'card'`.
5. **НО** в `supabase/functions/canonical-document-generate-strict/index.ts:346-350` SELECT по `payments_v2` берёт только `id, status, provider, receipt_url, provider_response, created_at` — **без `meta` и без `card_last4**`.
6. В результате `derivePaymentChannel` получает строку без `meta` и без `card_last4` → возвращает `'other'`.
7. Сценарий `individual + other` в `document_scenarios` не существует → `resolveDocumentScenario.source='none'` → `isOfferDocumentEnabled` возвращает `no_template` → клиенту HTTP 403.
8. Админ нажимает ту же кнопку, но через UI админки идёт `admin_force=true` → guard пропускается, `template_id` подтягивается fallback'ом из последнего `ai_generated_documents` для заказа → документ генерируется.

Это полностью объясняет: «у админа работает, у клиента — нет», «у всех, кто сегодня добавил реквизиты, не работает», «исторические сделки тоже не скачиваются».

### Что НЕ виновато

- Карточка реквизитов плательщика заполнена корректно.
- Шаблоны и сценарии оффера корректны.
- RLS / auth / JWT — корректны.
- Это НЕ Edge-функция «не работает» в смысле таймаута; функция отвечает 403 с error code, а UI показывает generic «попробуйте через 10 секунд» через `normalizeEdgeFunctionError`.

---

## План фикса

### Шаг 1. Расширить SELECT в canonical-document-generate-strict

Файл: `supabase/functions/canonical-document-generate-strict/index.ts`, строки 346-350.

Текущий SELECT:

```ts
.select('id, status, provider, receipt_url, provider_response, created_at')
```

Новый SELECT:

```ts
.select('id, status, provider, receipt_url, provider_response, created_at, meta, card_last4, card_brand')
```

Это единственное минимально необходимое изменение бэкенда — после него `derivePaymentChannel` получит полную строку и вернёт `'card'`, сценарий `individual+card` смэтчится, `template_id 7caee05d` будет возвращён, и self-service генерация заработает.

### Шаг 2. Зеркальная правка в `DealPayerDocumentsCard` (админка) — проверка

Прочитать `src/components/admin/DealPayerDocumentsCard.tsx` и `src/lib/documents/purchaseDocumentRules.ts` (frontend mirror) — убедиться, что они тоже подгружают `card_last4` + `meta`. Если нет — добавить.

### Шаг 3. Verify по реальным заказам Багинской

После деплоя:

1. `curl_edge_functions` POST `/canonical-document-generate-strict` с JWT клиента по order `7014f44d-3a78-46a1-9360-e956b378dae9` (Багинская, mode='preview').
2. Ожидаемый ответ: success, `template_id=7caee05d…`, `source: 'scenario'`.
3. Затем `mode='generate'` — должен вернуть signed URL DOCX без 403.
4. Проверить `audit_logs`: новые записи `document.generated` (а не `*_blocked_*`).

### Шаг 4. Sweep: сколько ещё клиентов задеты

Read-only SQL:

```sql
SELECT count(*), count(distinct order_id_meta) 
FROM audit_logs 
WHERE action = 'document.generate_blocked_document_template_not_configured'
  AND created_at >= '2026-05-01';
```

Сформировать список затронутых orders для отчёта.

### Шаг 5. Backfill для исторических заказов — НЕ НУЖЕН

Никаких миграций данных, апдейтов реквизитов или повторных привязок не требуется:

- Реквизиты плательщика лежат в правильных таблицах и читаются корректно.
- Сценарии офферов корректны.
- Просто после фикса все исторические и новые заказы (где `card_last4` заполнен) сразу станут видеть «Сформировать документ» из ЛК.

### Шаг 6. Улучшить UX-сообщение об ошибке (мелкое UI)

В `OrderListItem.tsx` сейчас при `error: 'document_template_not_configured'` показывается «Не удалось сформировать документ». Использовать `normalizeEdgeFunctionError` с маппингом этого кода → «Для этого тарифа документ временно недоступен, обратитесь в поддержку» — чтобы клиенты в будущем не видели «попробуйте через 10 секунд».

### Шаг 7. Proof

Создать `.lovable/proofs/document_generate_strict_payment_channel_fix_2026_05_22.md`:

- Diagnose (SQL evidence: order/offer/payment dump)
- Patch (1 строка SELECT)
- Dry-run (curl preview по 3 заказам Багинской)
- Execute (deploy edge function)
- Verify (curl generate + audit_logs check + UI check в /purchases)
- Sweep count «затронуто ровно N заказов восстановлено».

### DoD

- SELECT расширен, функция задеплоена.
- Багинская из своего ЛК успешно жмёт «Сформировать документ» без 403.
- В `audit_logs` после деплоя нет новых `document.generate_blocked_document_template_not_configured` для заказов с `card_last4 != null`.
- Sweep-отчёт по затронутым заказам в proof.
- UI-маппинг ошибок (Шаг 6) выкачен.

### Что НЕ делаем (по запросу пользователя)

- Не блокируем редактирование реквизитов после генерации документа — пусть меняют свободно, в чеке всё равно зафиксирована карта оплаты.
- Не пересоздаём исторические документы.
- Не трогаем реквизиты клиентов в БД.

### Технические детали

- Затронутый файл бэкенда: `supabase/functions/canonical-document-generate-strict/index.ts` (1 SELECT-строка).
- Возможные затронутые файлы UI: `src/components/purchases/OrderListItem.tsx`, `src/lib/documents/purchaseDocumentRules.ts`, `src/components/purchases/SubscriptionDocumentActions.tsx` (зеркальная проверка fields).
- Без миграций БД, без новых таблиц/RPC, без изменения RLS.
- Без правок canonical-document-send / document-download — там та же логика не используется.