# да, согласен, с учетом правок:

1. **Уточнить маркировку плана**
  &nbsp;
  &nbsp;
  - Заголовок должен быть строго:  
  `План: единый канонический пайплайн генерации документов для всех тарифов`
  - В плане явно указать:
    - план должен быть составлен на русском языке;
    - отчет о выполненной работе должен быть составлен на русском языке;
    - вся переписка, пояснения и результаты — только на русском языке.
2. **Не утверждать без proof, что** `document-data-snapshot.ts` **не требует изменений**
  - Формулировку заменить на безопасную:
    - сначала read-only проверить `snapshotOrderDocumentData`, `pick<>`, порядок `offer → tariff → product → fallback`;
    - только после proof подтвердить, что изменений не требуется.
  - Иначе есть риск, что `canonical-document-generate-strict` вызывает rebuild, но snapshot всё равно берёт не тот source.
3. **Добавить обязательный DIAGNOSE перед изменениями**  
В план добавить read-only блок:
  - найти все вызовы `document-auto-generate`;
  - найти все вызовы `canonical-document-generate-strict`;
  - проверить фактический контракт body/response обеих функций;
  - проверить, какие UI-компоненты используют `useRegenerateDocument` / `useResendDocument`;
  - проверить таблицы `generated_documents`, `orders_v2.meta.document_data`, `tariff_offers.meta.document_defaults`;
  - проверить, нет ли cron/webhook/edge-вызовов legacy-функции вне frontend.
4. **Resend нельзя смешивать с rebuild без явного контракта**
  - Для `useResendDocument` нужно разделить:
    - `regenerate` = rebuild snapshot + новый документ;
    - `resend` = отправка уже существующего файла без изменения snapshot, если файл есть.
  - Если файла нет — только тогда допустим fallback на canonical generate + send.
  - В DoD добавить proof, что resend не создает лишние дубли документов при повторной отправке.
5. **Legacy proxy должен сохранять backward-compatible response**  
В `document-auto-generate` proxy добавить требование:
  - сохранить старые поля ответа, которые ждёт frontend/toast/UI;
  - сохранить обработку `document_id`;
  - сохранить `send_email/send_telegram`;
  - не менять коды ошибок без необходимости;
  - если legacy action неизвестен — вернуть понятную ошибку и audit.
6. **Audit** `document.snapshot_service_name_source` **лучше писать не как отдельное действие на каждую мелочь, а с payload**  
Добавить в план структуру audit:
  - `action='document.snapshot_service_name_source'`
  - `entity_type='order'`
  - `entity_id=order_id`
  - `metadata: { source, service_name, offer_id, tariff_id, product_id, template_id, generated_document_id, mode }`
  - `actor_type='system'` для backend-triggered и текущий user/admin для ручной перегенерации, если доступно.
7. **Добавить STOP-guards**  
Остановить выполнение, если:
  - `offer_id` в заказе отсутствует и невозможно доказуемо восстановить offer-level defaults;
  - canonical response не совместим с UI;
  - `canonical-document-generate-strict` не умеет корректно работать с `document_id`;
  - snapshot rebuild меняет не только `service_name`, но и другие юридически значимые поля без proof;
  - найден внешний вызов `document-auto-generate`, для которого proxy не покрывает контракт.
8. **Уточнить bulk-подход**  
Текущая формулировка «bulk-скрипт не требуется» допустима только для текущего исправления, но в план нужно добавить:
  - никаких массовых перегенераций без отдельного dry-run;
  - ручная перегенерация только выборочно;
  - если потребуется массовое исправление старых документов — отдельный PATCH с dry-run → execute → verify.
9. **Добавить проверку не только PDF, но и snapshot/source**  
В DoD добавить machine-check:
  - `orders_v2.meta.document_data.service_name`;
  - `generated_documents` по последней версии;
  - `audit_logs.metadata.source='offer'`;
  - фактический текст в PDF/DOCX.  
  Проверка только PDF недостаточна.
10. **Добавить проверку шаблонного поля** `FLD-000186`  
В план внести:

&nbsp;

- проверить, что `FLD-000186` действительно единственный источник поля «Наименование оказываемых услуг» во всех релевантных шаблонах;
- проверить, нет ли legacy alias/token, который подставляется поверх canonical значения.

11. **Добавить no-duplicates invariant**  
После regenerate/resend проверить:

- resend не создает новый `generated_documents`, если должен только отправлять;
- regenerate создает новую версию/запись ожидаемым способом;
- нет нескольких активных документов одного типа без понятного статуса/versioning.

12. **Расширить регрессию по другим продуктам**  
Формулировку по «Закрытие года», `CB`, консультации сделать обязательной, но безопасной:

- read-only выбрать по одному оплаченному заказу каждого типа;
- если offer-level defaults отсутствуют — не чинить автоматически, а зафиксировать список offer_id/product_id/tariff_id;
- заполнение defaults — отдельная админская операция или отдельный PATCH.

13. **Добавить финальный отчет с diff-summary**  
В Definition of Done добавить, что отчет должен содержать:

- измененные файлы;
- diff-summary;
- какие вызовы legacy найдены;
- какие покрыты proxy;
- SQL/read-only proof до/после;
- примеры заказов CHAT/BUSINESS/FULL/ИДЕОЛОГИЯ;
- audit proof;
- список deferred/follow-up, если останется.

14. **Не удалять legacy из registry**  
Текущий пункт корректный: `document-auto-generate` оставить в registry как compatibility layer. Дополнительно указать:

- не удалять env/config/permissions legacy-функции до отдельного cleanup-спринта;
- после стабилизации собрать метрику `document.legacy_proxy_invoked` и только потом решать вопрос удаления.

15. **Добавить SYSTEM ACTOR proof**  
В DoD добавить:

- должна появиться реальная запись в `audit_logs` с `actor_type='system'`, `actor_user_id=NULL`, заполненным `actor_label` для backend/proxy-вызова;
- для ручного admin regenerate — actor должен быть текущий пользователь/admin, если архитектура это поддерживает.

В остальном направление правильное: legacy нужно не удалять резко, а превратить в compatibility proxy, а основным SoT для генерации сделать canonical snapshot + `canonical-document-generate-strict`.

&nbsp;

План: единый канонический пайплайн генерации документов для всех тарифов

## Контекст / диагностика

Проверка БД и кода показывает следующее.

1. Поля `meta.document_defaults.service_name` заполнены корректно у всех «Оплатить»-офферов Gorbova Club (CHAT, BUSINESS, FULL, ИДЕОЛОГИЯ) — там везде записано «Услуга по предоставлению платного доступа к ресурсам и материалам Клуба (Подписка) на 30 дней». На уровне `tariffs.meta.document_defaults` и `products_v2.meta.document_defaults` — пусто. То есть значения, введённые в кнопке, физически сохранены.
2. В snapshot'е оплаченных заказов BUSINESS/FULL `orders_v2.meta.document_data.service_name` либо отсутствует (старые заказы — `snapshot_version=NULL`), либо содержит другой текст («Услуга по предоставлению **временного** платного доступа…»), не совпадающий с актуальным значением из offer-defaults.
3. В системе сосуществуют **два** пайплайна генерации:
  - **Канонический**: `grant-access-for-order` → `canonical-document-payment-hook` → `snapshotOrderDocumentData` (snapshot из offer→tariff→product defaults) → `canonical-document-generate-strict` (всегда `mode='rebuild'`, рендер через `_shared/standard-fields.ts`, `FLD-000186 = documentData.service_name || product.name`). По нему работает CHAT.
  - **Legacy**: `document-auto-generate` — собственная сборка плейсхолдеров, **не читает `offer.meta.document_defaults**`, берёт `service_title` из `order.tariff.document_params.service_title` или фоллбэк на `tariff.name`/`product.name`. Именно поэтому BUSINESS получает в документе «Gorbova Club. Тариф «BUSINESS»» — это legacy-фоллбэк, а не значение из настроек кнопки.
  - Хуки `useResendDocument` и `useRegenerateDocument` (`src/hooks/useGeneratedDocuments.tsx`) до сих пор зовут именно legacy `document-auto-generate`.

Корневая причина: для части тарифов документы создаются/перегенерируются через legacy путь, который игнорирует canonical-снапшот и поле «Наименование услуги» из кнопки.

## Цель

Все продукты и тарифы генерируют документы строго через канонический пайплайн `canonical-document-generate-strict`, читающий значения из `offer.meta.document_defaults` (через snapshot). Legacy `document-auto-generate` выводится из эксплуатации.

## Шаги

1. **Frontend — перевести regenerate/resend на canonical**
  - `src/hooks/useGeneratedDocuments.tsx`:
    - `useRegenerateDocument` → `supabase.functions.invoke('canonical-document-generate-strict', { body: { order_id, template_id?, force_rebuild: true } })`.
    - `useResendDocument` → канонический resend (если функции нет — добавить тонкий action `resend` в `canonical-document-generate-strict` либо отдельную `canonical-document-resend`, повторно использующую уже сгенерированный файл из `generated_documents.file_path`).
  - UI в `DealDocumentsPanel`, `DealPayerDocumentsCard`, `OrderDocuments`, `AdminProductsDocs`, `StrictDocumentTemplatesManager` оставить без изменений по верстке — хук обновится прозрачно.
2. **Backend — отключить legacy `document-auto-generate**`
  - Заменить тело `supabase/functions/document-auto-generate/index.ts` на тонкий прокси, который:
    - принимает `{ action, order_id, document_id, template_id, send_email, send_telegram }`,
    - вызывает `canonical-document-generate-strict` (rebuild) или canonical-resend,
    - возвращает совместимый ответ,
    - пишет `audit_logs` `document.legacy_proxy_invoked` для отслеживания оставшихся вызовов.
  - Цель — не сломать ни один внешний вызов и одновременно гарантировать, что вся генерация идёт через канон.
3. **Snapshot rebuild для существующих оплаченных заказов**
  - Канон уже делает `mode='rebuild'` при каждой генерации, значит ручная перегенерация в админке автоматически подтянет актуальный `service_name` из `offer.meta.document_defaults`. Дополнительный bulk-скрипт не требуется — достаточно, что новые/перегенерированные документы будут корректными.
  - На странице «Документы» для каждого тарифа продукта оставить существующую кнопку «Перегенерировать», теперь она будет идти через канон.
4. **Audit / контроль**
  - В `canonical-document-generate-strict` добавить запись в `audit_logs`:
    - `document.snapshot_service_name_source = offer|tariff|product|fallback_product_name` (на основе того, откуда взялся `service_name` через `pick<>`).
    - Это позволит в логах быстро видеть, какой тариф ещё «падает» на product.name fallback.
  - Никаких изменений в `document-data-snapshot.ts` не требуется (логика `pick` уже корректна).
5. **Регрессия / DoD**
  - Тестово перегенерировать документы по трём оплаченным заказам (CHAT, BUSINESS, FULL) → во всех PDF в поле «Наименование оказываемых услуг» появляется текст из offer.meta.document_defaults.service_name.
  - Заказ ИДЕОЛОГИЯ — то же самое.
  - В `audit_logs` строки `document.snapshot_service_name_source` показывают `offer` для всех четырёх тарифов.
  - Вызовы `document-auto-generate` ведут в канон (audit `document.legacy_proxy_invoked` появляется, документ создаётся).
  - CHAT-поведение не меняется (snapshot уже корректен, путь тот же).
  - Все прочие продукты (`Закрытие года`, `CB`, консультации и т. п.) — точечно перегенерировать по одному заказу каждого, убедиться, что service_name берётся из настроек кнопки, иначе указать в баг-трекере и заполнить defaults в админке.

## Технические детали

- Файлы:
  - `src/hooks/useGeneratedDocuments.tsx` — поменять имена вызываемых edge-функций.
  - `supabase/functions/document-auto-generate/index.ts` — заменить на тонкий прокси.
  - `supabase/functions/canonical-document-generate-strict/index.ts` — добавить audit `document.snapshot_service_name_source` и (при отсутствии) action `resend`.
- Контракт `canonical-document-generate-strict` уже принимает `order_id` и автоматически делает rebuild snapshot.
- Никаких миграций БД не требуется — все нужные поля и индексы существуют.
- `document-auto-generate` остаётся в `supabase/functions.registry.txt`, чтобы не сломать клиентов; внутри — только прокси.

## Definition of Done

- Во всех документах по всем тарифам Gorbova Club поле «Наименование оказываемых услуг» равно тексту из настройки кнопки «Наименование услуги» (offer-level).
- В коде нет двух конкурирующих пайплайнов генерации: legacy `document-auto-generate` целиком делегирует в canonical.
- Хуки `useRegenerateDocument` / `useResendDocument` ходят в canonical напрямую.
- В `audit_logs` для каждой генерации видно источник `service_name` (`offer/tariff/product/fallback`).
- Регрессия CHAT не нарушена; BUSINESS, FULL, ИДЕОЛОГИЯ дают корректный текст.