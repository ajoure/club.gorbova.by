# Проверка просроченных продлений bePaid

## Проблема и поведение

INV-P0-1 использовал устаревший provider_subscriptions как окончательную
истину. Теперь старый снимок определяет кандидатов, а фиксированный GET bePaid
подтверждает состояние. Порог 24 часа сохранён. Ошибка провайдера, неизвестный
статус, отсутствующая дата и превышенный лимит проверок остаются actionable.
Отказ по платежу и активный provider stream при неактивной локальной подписке
видны отдельно в существующей вкладке ручной проверки. Это не зелёный статус.

Диагностика не меняет provider_subscriptions, подписки, права или деньги.
`action=diagnose_renewals` возвращает только результат, без отчётов и отправок.
Обычный полный отчёт сохраняет прежний сценарий; `notify=false` позволяет
выполнить контролируемую проверку без Telegram-уведомления.
Вызов требует точного runtime service/cron credential либо проверенного
пользователя с ролью admin/super_admin. Произвольного заголовка недостаточно.

## Узкое восстановление оплаченного продолжения

В существующий service-only payments-reconcile добавлен явный параметр
`paidContinuation` исключительно с `queueItemId`, `expectedUpdatedAt` и
`providerSubscriptionId`. По умолчанию этот режим — dry-run.

Параметры `sourceSubscriptionId`, `targetSubscriptionId`, `previousPaymentUid`,
`expectedProviderUpdatedAt` берутся из защищённых read-only данных операции,
не из email/суммы/названия и не из публичного файла релиза.

Перед записью доказываются:

- старый источник superseded, целевое продолжение active/expired, без отмены;
- точное совпадение user/profile/product/tariff с оплаченным заказом;
- предыдущая оплата подтверждена отдельным GET, её UID, сумма, валюта и
  paid_at совпадают с учётом, её provider tracking указывает на тот же заказ,
  что у новой успешной оплаты;
- триггер auto_superseded подтверждает создание данного продолжения в момент
  замены источника; нет refund/suppression или чужого активного права;
- GET подписки подтверждает именно новый UID и её активный оплаченный период.

Только затем CAS переносит ссылку provider snapshot на доказанное продолжение.
Существующий канонический механизм создаёт REBILL и payment и вызывает обычный
grant-access-for-order с точной существующей подпиской. История не удаляется,
счётчик прежних неудачных попыток сохраняется. Общий автоматический лимит
повторов не меняется; отменённые оператором события не переигрываются.

Новый REBILL имеет suppress_notifications=true (существующее правило
notify-order-purchased), grantGetcourse=false; Telegram-права восстанавливаются
через существующий grant с service-only notifyCustomer=false. Провайдеру
отправляются только GET: нет списания, отмены, возврата, писем и сообщений.
Дублирующие неоплаченные оформления автоматически не отменяются.

## Production gate

До execute требуется merged SHA и зелёные GitHub checks. Нет миграций.
Клиентские/финансовые ID остаются только в защищённом preflight и журнале БД.

1. Exact-SHA deploy: system-health-full-check, payments-reconcile,
   grant-access-for-order; неизменённые notify-order-purchased и
   telegram-grant-access для доказуемой поддержки suppression. Проверить
   capability exact_existing_access_v1 у grant-access-for-order.
2. Из-за изменения общего пакета обновить digest и развернуть marker-only
   sales-runtime-worker/control, telegram-webhook/media-worker, instagram-monitor.
   Эти функции не запускать на реальных очередях/сообщениях.
3. Read-only diagnose: подтверждённые overdue и unknown не маскируются.
4. Для **одного** согласованного оплаченного continuation: dry-run должен
   показать payments +1, orders +1, canonical grant 1, relink 1, sends 0.
   При расхождении идентичности, флагов, числа, срока или нового финансового
   факта остановиться; не ослаблять guard и не писать SQL в обход функции.
5. Execute только этого queue item с точными свежими CAS timestamps.
   Затем read-back: UID один, оплаченный REBILL один, достаточный срок доступа,
   canonical ledger, provider link на продолжение, очередь completed.
6. Повтор с актуальными timestamps — already_completed, записей +0.
7. Full check notify=false: только новый отчёт/служебный audit; никаких sends.
8. Publish только после PASS. Скриншоты опубликованной ручной проверки на ПК
   и mobile 390x844, с URL/SHA/версией и без персональных данных.

## Ограничения

Отказ банка не исправляется повторным списанием. Он остаётся на ручном
разборе. Неподтверждённый orphan partial-index finding, другие RLS policies,
реальные отмены/возвраты и массовые переобработки вне этого релиза.
Production-выполнение и Publish подтверждаются отдельным read-back;
данный файл сам по себе не является свидетельством публикации.
