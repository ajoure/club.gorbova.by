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
Кнопка ручной проверки передаёт notify=false: результат отображается в админке.
Плановые проверки сохраняют прежние Telegram-уведомления.
Вызов требует точного runtime service/cron credential либо проверенного
пользователя с ролью admin/super_admin. Произвольного заголовка недостаточно.

## Узкое восстановление оплаченного продолжения

В существующий payments-reconcile добавлен явный параметр
`paidContinuation` исключительно с `queueItemId`, `expectedUpdatedAt` и
`providerSubscriptionId`. По умолчанию этот режим — dry-run.

Общий обработчик и автоматическая очередь остаются service/cron-only.
Для ручной операции существующий администратор может передать
`manualPaidContinuation=true`: его JWT и текущая роль admin/super_admin
проверяются каноническим resolveGrantAccessCaller. Принимается только POST с
семью разрешёнными полями и точной вложенной схемой; неизвестные поля,
строковые boolean, aliases, batch и recordPreflightFailure=true запрещены.
Actor берётся только из проверенной сессии и фиксируется в существующих
receipt/audit. Нет новых ключей, чтения Vault из операторских инструментов,
новых ролей или автоматического перехода в общий sweep. Dry-run не пишет аудит.
Канонический resolver находится в `_shared/verified-financial-caller.ts`;
старый `grant-access-for-order/caller_auth.ts` сохраняет прежние exports и
матрицу веток. Это позволяет собирать функции из своего каталога и `_shared`,
не создавая межфункциональной зависимости или копии логики авторизации.

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
- другие связанные provider streams того же продукта/тарифа проверены GET,
  даже если их сохранённый снимок уже считает expired; живой или неизвестный
  конкурирующий stream блокирует восстановление;
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

Runtime-проверка выявила историческое сохранение paid_at с точностью до секунды.
Сравнение допускает только отсечение дробной части provider-времени внутри той
же секунды, если в БД дробная часть нулевая. Другая секунда, расхождение двух
дробных времён, UID, суммы или tracking по-прежнему блокируют действие. Сам
исторический платёж не изменяется. Перед каждым явным continuation dry-run и
execute серверный клиент выполняет существующий authenticated GET capability
канонического grant: ошибка авторизации или старый deployment блокируют план
до любых изменений очереди, платежей или доступов.

## Сохранение согласия при завершении уже восстановленного платежа

Runtime выявил запись с `auto_renew=false`: оплата и доступ уже подтверждены,
но прежняя проверка ошибочно требовала true после grant. Это не основание
включать продление. Новый preflight проверяет тип/флаг/связь billing и будущую
дату провайдера до любых бизнес-записей. После grant CAS проверяет сохранение
этих полей и отсутствие отмены; синхронизирует только billing_type,
next_charge_at и metadata provider ID. Флаг auto_renew, paid-окно и status
этот шаг не пишет. Политика соответствует существующему webhook STEP C:
provider-managed metadata не заменяет явный false новым согласием.

Для false в receipt сохраняется billing_review_required. Инвариант проверяет
такую запись и при будущей дате, подтверждает её GET и сохраняет ручную
проверку, пока provider/local state расходятся. Даты в mirror остаются
правдивыми; проблема не удерживается искусственно старой датой.

Уже восстановленная операция планирует payments/orders/grants/relinks +0.
Завершение оставляет один billing-аудит и историю попыток; replay не пишет
данные повторно. Реальные конфликты snapshot возвращают 409; это не обещание
отсутствия transport retries — бизнес-идемпотентность по-прежнему защищают CAS
и проверка материализованного платежа. Exact paid-window grant также исключён
из cleanup других подписок: он владеет только своим подтверждённым target.

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
4. Для **одного** согласованного оплаченного continuation: первый dry-run
   показывает payments +1, orders +1, canonical grant 1, relink 1, sends 0.
   Если оплата и доступ уже материализованы, все эти действия +0; отдельно
   проверить запланированные billing metadata/provider snapshot изменения.
   При расхождении идентичности, флагов, числа, срока или нового финансового
   факта остановиться; не ослаблять guard и не писать SQL в обход функции.
5. Execute только этого queue item с точными свежими CAS timestamps.
   Затем read-back: UID один, оплаченный REBILL один, достаточный срок доступа,
   canonical ledger, provider link на продолжение, очередь completed.
6. Повтор с актуальными timestamps — already_completed, записей +0.
7. Full check notify=false: только новый отчёт/служебный audit; никаких sends.
8. Publish только после PASS. Скриншоты опубликованной ручной проверки на ПК
   и mobile 390x844, с URL/SHA/версией и без персональных данных.

## Триггер графика provider-managed и completed-коррекция

Фактический `ensure_billing_alignment` перезаписывал provider next_charge_at
концом обучения. Миграция `20261020202000_preserve_provider_billing_schedule`
добавляет ранний RETURN только для provider_managed, после прежнего клубного
фильтра, до обеих правил. NULL финального provider-цикла также не заменяется
выдуманной датой. MIT/legacy/прочие типы сохраняют прежние правила. CREATE OR
REPLACE сохраняет owner, SECURITY DEFINER, search_path, ACL и привязку триггера;
данные и состояния других триггеров миграция не меняет. Канонический recovery
после billing CAS теперь читает сохранённую дату/флаги/окно и не завершает
очередь при расхождении с подтверждённым provider schedule.

Уже completed/7 операция не переоткрывается. Вместо нового режима API/RPC
используется отдельный проверяемый операторский SQL
`scripts/bepaid/correct-completed-provider-schedule.sql` через Lovable Cloud.
Он не входит в миграцию и не доступен клиентскому приложению.

Перед ним обязательны свежий exact dry-run канонического payments-reconcile
(включая прежний payment GET, refund/cancel/suppression и competing streams)
и свежий GET provider schedule. Только одна ранее согласованная операция A;
никаких групповых исправлений по snapshot-кандидатам.

Контракт run_sql разрешает только DML. Используется один INSERT с CTE,
содержащим условный UPDATE: без DO/BEGIN/GUC, новых RPC и schema changes. Это
одна атомарная PostgreSQL-транзакция. Заменить только литерал
`'__REVIEWED_INPUT_JSON__'::jsonb`: JSON.stringify(input), удвоить все одинарные
кавычки, заключить результат в SQL-кавычки и оставить ::jsonb. Сам запрос и
guards не переписывать. Вход не сохранять в Git/отчёте:

- target_id, source_id, provider_row_id, queue_id, payment_uid,
  previous_payment_uid — точные защищённые значения одобренного preflight;
- target_updated_at, source_updated_at, provider_updated_at, queue_updated_at —
  PostgreSQL timestamps как строки с полной точностью, без округления JS;
- protected_target_md5 — md5((to_jsonb(target)-'next_charge_at'-'updated_at')::text);
- before_next_charge_at — одобренная прежняя дата конца доступа;
- verified_next_charge_at и verified_at — только свежий GET, не ввод клиента.

DML проверяет whitelist 14 ключей, свежесть proof до 5 минут, блокирует точные
строки, подтверждает связи/receipt/оператора/оплаты/старые заказы и доступ,
сохраняет false и все защищённые поля. Он меняет только next_charge_at;
Запреты parent/source-заказов проверяются непосредственно у заблокированных
алиасов, чтобы READ COMMITTED повторно проверил их после ожидания блокировки.
CI проверяет это двумя сеансами PostgreSQL, включая отрицательный контроль
со старым snapshot-подзапросом.
существующий updated_at trigger срабатывает штатно. Списки status/auto_renew
не входят в UPDATE, поэтому supersede cleanup не вызывается. RETURNING
содержит фактический результат BEFORE-триггеров. При расхождении даты или
защищённого хеша обязательный readback_pass в INSERT вызывает ошибку и
откатывает весь statement, включая UPDATE и trigger audit.

Первый вызов обязан вернуть одну строку provider_schedule_corrected: это
доказывает UPDATE1/audit1. Guard/CAS mismatch возвращает 0 без записей; это
STOP и read-only проверка, не успех и не повод повторять. Ноль допустим
только для заранее запланированного replay после read-back уже исправленной
даты, прежних защищённых полей и ровно одного подходящего correction audit.

Ожидание: target update 1, audit schedule_corrected 1; остальные таблицы +0.
Повтор со свежими CAS и тем же подтверждённым schedule: update0/audit0;
completed/7, прежние billing/relink audits и receipt остаются прежними.
После коррекции выполнить ранее запланированный canonical completed replay,
полный health notify=false и шесть безопасных runtime probes нового digest.
Publish и оба опубликованных viewport-пруфа — только после всех PASS.

Исторические расхождения снимков — кандидаты отдельного аудита, не доказанные
ошибки и не разрешение на массовый UPDATE. Trial-ветка scheduler, способная
менять provider schedule, отмечена как отдельный follow-up; её в этом релизе
не запускать и не менять.

## Ограничения

Отказ банка не исправляется повторным списанием. Он остаётся на ручном
разборе. Неподтверждённый orphan partial-index finding, другие RLS policies,
реальные отмены/возвраты и массовые переобработки вне этого релиза.
Production-выполнение и Publish подтверждаются отдельным read-back;
данный файл сам по себе не является свидетельством публикации.
