План:

1. **Проблема**
   - В счёте для ЮЛ заполняется заказчик, но не заполняются исполнитель и параметры услуги: наименование, единица, количество, сроки и суммы из кнопки/тарифа.
   - Создавать новый механизм не нужно: надо переиспользовать уже существующий canonical pipeline генерации актов/документов по покупкам.

2. **Диагностика**
   - Существующий рабочий источник данных для актов — `snapshotOrderDocumentData` в `supabase/functions/_shared/document-data-snapshot.ts`.
   - `canonical-document-generate-strict` уже вызывает этот snapshot перед генерацией и умеет брать:
     - `tariff_offers.meta.document_scenarios[]` → `template_id`, `executor_id`;
     - `tariff_offers.meta.document_defaults` → `service_name`, `unit`, `quantity`, `unit_price`, `payment_due_days`, `execution_days`;
     - `executors` → данные исполнителя.
   - Фактическая причина: `invoice-checkout-issue` создаёт заказ со `status='draft'`, а `snapshotOrderDocumentData` жёстко пропускает все заказы не в `paid`. Поэтому snapshot не пересобирается, и в документ попадает только частичный `meta.document_data._provenance.customer_legal_details_id`, без полей исполнителя и услуги.
   - Дополнительная причина: внутри snapshot канал оплаты для invoice-only вычисляется из `payments_v2`; платежа ещё нет, значит канал `null`, сценарий `legal_entity + bank_transfer` не матчится. Даже если убрать paid-guard, без подсказки invoice-канала сценарий может не выбрать `executor_id`.
   - Ещё найден риск: в snapshot сейчас `payer_type` сводится к `legal_entity | individual`, из-за чего `entrepreneur` может терять свой сценарий. Это лучше поправить тем же каноническим способом.

3. **Предлагаемое решение**
   - Не создавать новую функцию генерации.
   - Расширить существующий `snapshotOrderDocumentData` опцией для pre-payment invoice:
     - разрешить rebuild для заказа `meta.checkout_kind='invoice'` и `meta.awaits_payment=true` даже при `status='draft'`;
     - для такого заказа принудительно использовать `paymentChannel='bank_transfer'`;
     - сохранить текущий paid-only guard для всех остальных документов.
   - В `canonical-document-generate-strict` передавать эту опцию в уже существующий вызов `snapshotOrderDocumentData`, когда активен `pre_payment_invoice`.
   - При необходимости поправить `payer_type` resolver в snapshot, чтобы он поддерживал `entrepreneur`, а не превращал его в `individual`.
   - После этого invoice-only счёт будет идти через тот же snapshot/strict pipeline, что и акты по покупкам, и подтянет уже настроенные данные из кнопки/тарифа/продукта/исполнителя.

4. **Изменяемые компоненты**
   - Edge/shared logic:
     - `supabase/functions/_shared/document-data-snapshot.ts`
     - `supabase/functions/canonical-document-generate-strict/index.ts`
   - Возможно только комментарии/минимальная корректировка в:
     - `supabase/functions/invoice-checkout-issue/index.ts`
   - Таблицы, RPC, новые edge functions, UI-компоненты, enum, cron jobs не создаются.

5. **Что не будет изменено**
   - Не будет нового workflow документов.
   - Не будет новой таблицы, RPC или дублирующей edge function.
   - Не будет ручного заполнения исполнителя в invoice function.
   - Не будет изменения шаблонов DOCX и настроек тарифов, если текущие настройки уже валидны.
   - Не будет массового исправления старых заказов без отдельного dry-run/repair-плана.

6. **Dry-run**
   - Проверить на последнем invoice-order, что:
     - `tariff_offers.meta.document_scenarios` содержит сценарий `legal_entity + bank_transfer` с `executor_id` и `template_id`;
     - `tariff_offers.meta.document_defaults` содержит `service_name`, `unit`, `quantity`, `unit_price`, сроки;
     - default/exact executor существует и активен.
   - После кода выполнить точечную генерацию/проверку через существующий edge flow на одном заказе или новом тестовом счёте.

7. **Execute**
   - Добавить опцию `allowPrePaymentInvoice`/аналог в `snapshotOrderDocumentData`.
   - В snapshot:
     - не возвращать `skipped_not_paid` для invoice draft с `checkout_kind='invoice'` и `awaits_payment=true`;
     - для такого режима использовать `bank_transfer` как канал сценария;
     - записывать provenance, чтобы было видно, что snapshot собран как pre-payment invoice.
   - В strict generator передавать эту опцию только когда `isInvoiceCheckout=true`.
   - Сохранить старое поведение для оплаченных актов и документов по покупкам.

8. **STOP-guards**
   - Остановиться, если заказ не имеет `meta.checkout_kind='invoice'` и `meta.awaits_payment=true`.
   - Остановиться, если `offer_id` не связан с тарифом/продуктом заказа.
   - Остановиться, если сценарий invoice-only не даёт `template_id`, а fallback тоже пустой.
   - Остановиться, если исполнитель не найден ни по сценарию, ни по default executor — не подставлять фиктивные данные.
   - Не выполнять массовый UPDATE старых документов в рамках этого патча.

9. **DoD**
   - Новый счёт ЮЛ формируется через `canonical-document-generate-strict` без отдельной новой логики.
   - В `orders_v2.meta.document_data` после генерации есть:
     - `template_id`, `executor_id`, `executor_source`;
     - `service_name`, `unit`, `quantity`, `unit_price`, `amount`;
     - `_provenance.scenario.payment_channel='bank_transfer'`.
   - В PDF подтягиваются данные исполнителя и услуги из уже настроенных кнопок/тарифов/продукта.
   - Генерация актов по обычным оплаченным покупкам не меняет поведение.

10. **Риски и зависимости**
   - Старые уже созданные PDF не изменятся автоматически; для них нужен отдельный repair/regenerate шаг, если потребуется.
   - Если в конкретной кнопке несколько сценариев `legal_entity + bank_transfer`, будет использован существующий порядок resolver-а; это уже текущий SOT.
   - Если шаблон использует не те FLD-токены, данные могут быть в snapshot, но не отображаться в PDF — это проверяется отдельно по source_trace/field_ids.