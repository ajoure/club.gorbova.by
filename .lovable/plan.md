да, согласен, с учетом правок:

1. **Добавить guard на реальные ошибки PostgREST**
  - В `document-data-snapshot.ts` нельзя превращать ошибку запроса к `orders_v2` в `skipped_no_order`.
  - Логика должна различать:
    - `order not found` → `skipped_no_order`;
    - SQL/PostgREST error → `snapshot_error`.
  - В `audit_logs` писать `document_data.snapshot_error` с `error.message`, `table`, `stage`.
2. **Проверить все select-поля в snapshot helper**
  - Перед фиксом сделать grep/quick audit по `document-data-snapshot.ts` на несуществующие поля/таблицы:
    - `paid_at`;
    - `product_tariffs`;
    - любые поля `tariff_offers/products/tariffs/orders_v2`, которых нет в live schema.
  - Исправить не только найденные 2 места, а все аналогичные ошибки в helper.
3. **Fallback offer_id сделать строго доказуемым**
  - Порядок резолва:
    1. `orders_v2.offer_id`;
    2. `orders_v2.meta.offer_id`;
    3. если есть уже существующий recurring resolver — использовать его только если он уже безопасно подключён.
  - В `document_data._provenance` записывать:
    - `offer_id`;
    - `offer_id_source`;
    - `tariff_id`;
    - `product_id`;
    - `document_defaults_source`.
4. **Не перезаписывать ручные override**
  - При backfill/rebuild snapshot не перетирать `fields[FLD].manual_override=true`.
  - Это особенно важно для старых сделок, если кто-то уже вручную правил поля.
5. **UI auto-select шаблона**
  - `useEffect` должен срабатывать только один раз после загрузки `orderMeta + templates`.
  - Не перетирать ручной выбор пользователя.
  - Если `template_id` из `document_data` отсутствует в списке активных шаблонов — показать warning, но не падать.
6. **Backfill только для одной тестовой сделки**
  - Не запускать массовый backfill.
  - Только:
  - После backfill проверить `auto_generated=false` / документ не создан автоматически.
7. **DoD дополнить**
  - `canonical-document-payment-hook` больше не возвращает `skipped_no_order` для существующего paid order.
  - `document_data._provenance.offer_id_source='order_meta'` для этой тестовой сделки.
  - `audit_logs` не содержит новых `snapshot_error` после фикса.
  - Preview по этой сделке показывает выбранный template_id из `document_data`.
  - Повторный вызов hook идемпотентен: не ломает существующий `document_data`, не создаёт документ, не дублирует audit сверх ожидаемого.
  - &nbsp;
  - План: устранить причины, по которым тестовая сделка не получила document_data и шаблон не выбрался автоматически.

## Diagnose (что нашёл)

Проверил тестовую сделку `ORD-TEST-MOYVTVB1` (id=`0f910225...`):

- `meta.document_data` = `null`.
- В `audit_logs` нет ни одной записи `document_data.snapshot_*` за всё время — снапшот НИКОГДА не отрабатывал успешно.
- Прямой вызов `canonical-document-payment-hook` для этого order_id вернул `"snapshot": "skipped_no_order"`, хотя заказ существует и `status='paid'`.

Корневые причины в `supabase/functions/_shared/document-data-snapshot.ts`:

1. **Несуществующая колонка `paid_at`.** Снапшот делает
  `select('id, status, ..., paid_at, created_at, meta')` из `orders_v2`. В таблице такой колонки нет (есть `paid_amount`, `created_at`, `updated_at`, `deal_date`). PostgREST возвращает ошибку → `data` = `null` → ранний выход `skipped_no_order`. Снапшот никогда не доходит до записи.
2. **Несуществующая таблица `product_tariffs`.** Запрос `from('product_tariffs')` падает (таблица называется `tariffs`). Даже если снапшот починим — defaults тарифа всегда будут пустые.
3. **Не используется `meta.offer_id` как fallback.** Для admin-test и для подписок `orders_v2.offer_id` часто `NULL`, а реальный оффер хранится в `meta.offer_id` (или резолвится recurring snapshot resolver). Сейчас, при `offer_id=NULL`, ВСЕ `document_defaults` оффера (включая `template_id` и `executor_id`) игнорируются. У тестовой сделки именно этот случай: `offer_id=NULL`, но `meta.offer_id=6f306cbc...` с полностью заполненным `document_defaults`.
4. **UI не подставляет шаблон автоматически.** В `src/components/ai-documents/DealDocumentsPanel.tsx` `selectedTemplateId` инициализируется как `null` и нигде не читает `orderMeta.document_data.template_id`. Даже когда снапшот починится, пользователь продолжит видеть пустой селектор.

## Fix (минимальный, точечный)

### 1) `supabase/functions/_shared/document-data-snapshot.ts`

- Заменить `paid_at` → использовать существующие колонки. Выбираем `updated_at, deal_date` дополнительно. `paidAt = order.deal_date || order.updated_at || order.created_at`.
- В select убрать `paid_at`, добавить `updated_at, deal_date`.
- Исправить имя таблицы: `from('product_tariffs')` → `from('tariffs')`.
- Резолв оффера: если `order.offer_id` пуст — взять `(order.meta as any)?.offer_id` как fallback и использовать его и для загрузки `tariff_offers.meta.document_defaults`, и для записи в `document_data.source.offer_id`.
- Аудит-провенанс: добавить флаг `offer_id_source: 'order'|'order_meta'|'none'` в `_provenance` для последующей диагностики.

### 2) `src/components/ai-documents/DealDocumentsPanel.tsx`

- Добавить `useEffect`, который при первой загрузке `orderMeta` и непустом `templates`, если `selectedTemplateId === null` и `orderMeta.document_data.template_id` существует и есть в `templates` — вызывает `setSelectedTemplateId(orderMeta.document_data.template_id)`.
- Никаких дополнительных кнопок и UI — только тихая авто-подстановка. Пользователь всё ещё может сменить шаблон вручную.

### 3) Backfill для уже созданной тестовой сделки

- После деплоя — вручную дернуть `canonical-document-payment-hook` с `{ order_id: '0f910225-0922-4608-b089-69bb8561f809' }`, чтобы построить снапшот для существующей сделки (флаг auto-gen остаётся `false`, поэтому документ не сгенерируется, но `document_data` запишется).

## DoD

1. SQL: `SELECT meta->'document_data' FROM orders_v2 WHERE id='0f910225-...'` возвращает объект с `template_id=b8aa7b9c-...`, `executor_id=d0c7fe75-...`, `executor_source='executor_offer'`, и непустым `fields` для `FLD-000103…FLD-000154`.
2. `audit_logs` содержит `document_data.snapshot_created` для этого order_id.
3. В карточке сделки `#ORD-TEST-MOYVTVB1` селектор шаблона при открытии вкладки документов автоматически показывает «Акт оказанных услуг» (или соответствующий template_id из оффера).
4. Плашка «Исполнитель» показывает имя из executor по умолчанию/из оффера и источник.
5. Новый payment flow (создание новой тестовой сделки) — `document_data` появляется автоматически без ручных действий.

## Что НЕ трогаем

- Schema/миграции — багов в DB нет, проблема в коде функции.
- `grant-access-for-order`, `canonical-document-payment-hook` логика — только snapshot helper.
- Generation/email/telegram — auto-gen flag остаётся `false`.
- Executor-поля в UI — остаются скрытыми, плашка как реализована в Sprint 11.