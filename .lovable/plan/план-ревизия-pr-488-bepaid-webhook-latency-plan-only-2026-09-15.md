# План: ревизия PR #488 (bePaid webhook latency) — PLAN-ONLY

Режим строго read-only. Код, коммиты, миграции, деплой, Publish, записи данных,
сообщения, доступы, платежи и обработка очереди не выполнялись.

## 1. Что проверено в production (факты)

- Расширения: `pg_cron 1.6.4`, `pg_net 0.19.5`, `supabase_vault 0.3.1` — предпосылки миграции выполнены.
- Коллизий имён cron нет: заданий с `bepaid-queue*` / `*realtime*` не существует.
  Каждые 5 минут уже работают `erip-reconcile-pending-5min` (jobid 40) и
  `bepaid-receipts-2026-backfill-cron` (jobid 50); `verify-recurring-cards` (21) выключен.
  Сверка платежей — только `payments-reconcile-morning` (8, 06:00) и `-evening` (9, 18:00).
- `payments-reconcile` принимает service-role apikey либо заголовок
  `x-payments-reconcile-cron-secret`, сверяемый через RPC `payments_reconcile_cron_secret`
  (RPC существует, соответствующий Vault-секрет присутствует). Точечный режим
  `queueItemId` + `expectedUpdatedAt` + `dryRun` уже поддержан — вызов из вебхука совместим.
- `bepaid-queue-cron` сейчас авторизуется только env-секретом `CRON_SECRET` или
  service-role ключом; Vault в его `auth.ts` не используется.
- `bepaid-webhook` (7202 строки) уже создаёт и закрывает строки `payment_reconcile_queue`;
  собственного вызова `payments-reconcile` в нём нет.
- Очередь сейчас: pending 1602 (из них source=webhook 729, за последний час 0),
  processing 0, error 470. То есть исторический бэклог большой — фильтр обязателен.

## 2. Блокеры и дрейф (до execute)

1. **BLOCKER — источник не сверяем.** Head SHA `f7bb8b33…` в рабочем дереве отсутствует
   (текущий HEAD `89a249e94`), файла `supabase/migrations/20260915110000_bepaid_webhook_realtime_queue_fallback.sql`
   нет. Байтовую сверку diff и SHA256 миграции сделать нельзя — execute невозможен,
   пока не синхронизирован точный merged SHA.
2. **DRIFT — «Vault-authenticated cron».** Требование PR предполагает изолированный
   Vault-секрет, а текущая функция принимает env `CRON_SECRET`. Нужно либо новый
   отдельный секрет + его приём в `bepaid-queue-cron/auth.ts`, либо явное
   решение использовать существующий канал. Иначе cron либо не пройдёт авторизацию,
   либо получит не изолированный доступ.
3. **RISK — бэклог.** `normalizeQueueRunOptions` не знает про `webhookRealtime`,
   а `batchSize` по умолчанию 20 (до 50). Фильтр «source=webhook, created_at > now()-1h,
   batch<=5» должен быть жёстко зашит на сервере, а не только в теле cron-запроса,
   иначе 729 исторических webhook-строк попадут в обработку.
4. **RISK — повторные алерты.** В realtime-режиме отправка алертов о «залипших»
   элементах должна быть подавлена; текущая логика stale-recovery шлёт уведомления.
5. **PROCESS — деплой вебхука.** `bepaid-webhook` входит в список production webhooks:
   допускается только одиночный деплой по протоколу
   `.lovable/architecture/public_webhook_controlled_redeploy_protocol_v1.md`
   (проверка блока `verify_jwt = false`, снапшот источника, внешний pre-smoke,
   деплой одной функции, post-smoke t=0/30s/2m, регрессия подписи). В `config.toml`
   `verify_jwt = false` для `bepaid-webhook`, `bepaid-queue-cron`, `payments-reconcile` уже есть.

## 3. Предлагаемый execute-план (не выполнен)

Шаг 0 — синхронизация: подтвердить merged SHA, чистое дерево, SHA256 миграции и
байтовую идентичность двух функций. При расхождении — стоп без записей.

Шаг 1 — миграция `20260915110000_bepaid_webhook_realtime_queue_fallback.sql`.
Предусловия: расширения из §1 присутствуют; `cron.job` не содержит имени нового задания;
задания 8/9 остаются активными; секрет читается через Vault-RPC. Применять без правок.
Read-back: ровно одно новое задание с расписанием `*/5 * * * *`, active=true, тело
содержит `webhookRealtime:true`, `source:"webhook"`, `batchSize<=5`, окно 1 час;
число прочих заданий не изменилось; заголовок не содержит открытых секретов.

Шаг 2 — деплой ровно `bepaid-webhook`, затем отдельно `bepaid-queue-cron`
(две одиночные операции, не пакетом), по протоколу controlled redeploy.
Read-back: внешний неавторизованный probe даёт ошибку проверки подписи приложения,
а не платформенный `UNAUTHORIZED_NO_AUTH_HEADER`; probe на t=0/30s/2m.

Шаг 3 — функциональные read-back (без создания платежей):
- следующий реальный успешный webhook: строка очереди переходит в completed за секунды,
  `payments-reconcile` вызван ровно один раз и только с её `queueItemId`;
- cron-прогоны за час: обработаны только строки `source=webhook`, созданные < 1 ч,
  не более 5 за прогон; счётчик pending по историческим строкам не изменился
  (эталон: pending 1602, webhook 729, error 470);
- алертов о «залипших» элементах в realtime-прогонах нет;
- нулевые дельты по деньгам, доступам, документам, подпискам, автоматизациям.

Откат: деактивировать новое cron-задание и вернуть предыдущий источник функций
(редеплой снапшота), без изменения данных.

## 4. Read-only агрегатный план запросов (разрывы провайдер → канонические записи)

Только чтение, без ремедиации, без PII и без полных ID (везде `left(id::text,8)`).

1. База провайдера: успешные строки `bepaid_statement_rows` (status успешный,
   transaction_type платёж) по месяцам — всего/сумма.
2. Нет платежа: `left join payments_v2` по uid/tracking_id, где платёж отсутствует →
   счётчик, диапазон дат, суммы по валютам.
3. Есть платёж, нет заказа: `payments_v2.status='succeeded' and order_id is null` →
   счётчик по месяцам и по сумме.
4. Есть заказ, нет доступа: оплаченные `orders_v2` без `entitlements` и без записей
   `access_grant_ledger` → счётчик по продукту и месяцу.
5. Очередь: разрез `payment_reconcile_queue` по status × source × возрасту
   (<1 ч, 1–24 ч, >24 ч) и по `attempts`.
6. Пересечение: строки провайдера за 7 дней без `provider_events` — счётчик и
   максимальный возраст, чтобы отделить дыру в импорте от дыры в обработке.

Вывод только агрегаты + до 20 анонимизированных префиксов ID на категорию.
