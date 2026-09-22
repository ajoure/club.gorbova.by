# План: выполнение SHA 8603fcab (PR #517) — reuse renewal-checkout + контролируемый 409

Режим подготовки: READ-ONLY. Код, данные, миграции не изменялись; deploy и Publish не выполнялись.

## 1. Проверка дельты (confirmed)

`origin/main` = HEAD = `8603fcab46d8bd649bb98e393710683eb45ba3e5`, дерево чистое.
Дельта `86cd71d0 → 8603fcab` затрагивает ровно 5 заявленных файлов + `.lovable/plan.md` (документ, не код). Миграций нет.

- `_shared/pending-subscription-checkout.ts`: в `samePendingSubscriptionPurchase` `offer_id` исключается из контрактного сравнения **только** когда у существующего заказа `offer_id=null` **и** `meta.payment_flow==='renewal_subscription'` **и** у предложения `offer_id` задан. Все прочие проверки сохранены: не удалён, статус `pending|failed`, `paid_amount=0`, совпадение `user_id/product_id/tariff_id`, точное `final_price`, валюта, полный остальной контрактный контекст (`purchase_snapshot` и т.д.).
- `bepaid-create-subscription-checkout/index.ts`: стадия `pending_checkout_lookup` обёрнута try/catch. Шесть reconciliation-кодов (orphan / multiple pending / existing provider / multiple live / pending purchase payment / pending checkout payment) возвращают HTTP 409 JSON `{success:false, code:'CHECKOUT_RECONCILIATION_REQUIRED', incident_id}` и warn-лог без PII. Любая другая ошибка пробрасывается в прежний путь 500.
- `normalizeEdgeFunctionError.ts`: новое сообщение «Найдена незавершённая оплата. Обратитесь в поддержку и сообщите код обращения.» до общей ветки internal error.
- Тесты: контракт 409-кода + 3 новых кейса на renewal-reuse (и негативные: другой payment_flow, другой тариф, другая цена).

Root cause подтверждён: публичная ссылка не совпадала с системным renewal-заказом только из-за отсутствующего `offer_id`, что уводило поток в reconciliation-throw → необработанные 500.

Локально: targeted Vitest 9/9 PASS. **GitHub checks точного SHA — UNKNOWN**: в песочнице нет `gh`/токена GitHub, статус проверок прочитать нечем. Перед выполнением подтвердите зелёные checks на стороне GitHub.

## 2. Execute-план

1. Sync ровно `8603fcab46d8bd649bb98e393710683eb45ba3e5`; read-back HEAD == origin/main, дерево чистое, дельта = 5 файлов, миграций 0.
2. Проверки: targeted Vitest (2 файла), typecheck, production build.
3. Deploy только `bepaid-create-subscription-checkout`. Никаких миграций, никаких изменений данных.
4. Publish фронтенда (нужен из-за нового сообщения об ошибке).
5. Baseline до шага 6: счётчики orders_v2 / payments_v2 / subscriptions_v2 / provider_subscriptions / crm_checkout_attempts.

## 3. Безопасная runtime-проверка (ссылка Бобровник)

- Один повторный запрос по существующей публичной ссылке; ожидание: ответ 200 с **переиспользованием** прежнего provider-confirmed checkout — тот же `order_id`, та же `subscription_v2_id`, тот же `bepaid_subscription_id`; новый provider checkout не создаётся.
- Если провайдер отдаёт не переиспользуемое состояние — ожидается контролируемый 409 `CHECKOUT_RECONCILIATION_REQUIRED` с `incident_id`, а не «Internal server error».
- Read-back дельт за окно проверки: orders_v2 = 0, payments_v2 = 0, subscriptions_v2 = 0, provider_subscriptions = 0; новых `crm_checkout_attempts` со `state='ready'` не появляется.
- Повтор запроса идемпотентен: те же идентификаторы, снова нулевые дельты.
- URL оплаты, токены и персональные данные не выводятся; только masked ID, статусы и счётчики.
- Оплата не проводится, платёж не подтверждается, сообщений клиенту не отправляется.

## 4. Стоп-условия

Расхождение SHA, грязное дерево, красные GitHub checks, появление любой коммерческой строки, ответ с сырым «Internal server error» или неоднозначный rowcount — остановка и отчёт без Publish/повторных вызовов.
