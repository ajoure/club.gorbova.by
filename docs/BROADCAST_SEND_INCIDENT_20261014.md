# Ручная рассылка — 14.10.2026

Подтверждены два независимых сбоя: Telegram `analytics_delivery_read_failed`
из-за длинного PostgREST GET с 205 ключами; email — HTTP 504 во время
последовательной SMTP-отправки и временный отказ 450. Отдельная отмена
`window.prompt` давала ошибку подтверждения в браузере.

Исправление:

- GET аналитики ограничены 50 значениями и 3000 символами после URL encoding.
- Одно обычное окно сайта подтверждает полную аудиторию обоих каналов;
  выбранный продукт/клуб сохраняет прежнюю сегментацию. Backend guard не меняется.
- Новые ручные email-рассылки атомарно сохраняют персонализированные payloads
  в технической очереди. Источником статусов остаётся `broadcast_deliveries`.
- Существующий одобренный минутный cron обрабатывает до 10 email за проход.
  Только обычный cron, после прежних enabled/production_approved/auth guards;
  dry-run и force-template не обрабатывают очередь.
- SMTP 4xx: пауза 15 минут, до 8 попыток. Неизвестный SMTP-результат не
  повторяется. Подтверждённая приёмка записывается перед следующим получателем.
- Новая очередь пустая после миграции: исторические 100 accepted и 119 queued
  не переносить, старые Telegram-кампании не повторять и не закрывать.

## Выпуск через Lovable Cloud

1. Сверить точный merged SHA, чистое дерево и одобренный diff.
2. До применения снять только агрегаты старых трёх кампаний: TG queued=615,
   TG отправлено=0; email accepted=100, queued=119. Учесть естественный drift,
   остановиться при новых отправках и заново сверить факты.
3. Применить только `20261014162634_manual_email_broadcast_queue.sql`.
   Проверить: обе новые таблицы пустые, RLS включён; anon/authenticated/PUBLIC
   не имеют доступа к таблицам или двум RPC, execute только service_role.
4. Развернуть ровно `telegram-mass-broadcast`, `email-mass-broadcast`,
   `process-scheduled-broadcasts`. Вместе с email включить local helper
   `manualEmailQueue.ts`, с обоими senders — локальный `boundedAnalytics.ts`. Общий `_shared` и
   release-маркеры ботов не меняются.
5. Не запускать senders, dry_run, worker или dispatcher. Проверить source
   fingerprint, managed deployment confirmations; безопасно проверить OPTIONS
   и 401 без авторизации. Обычный cron увидит пустую новую очередь.
6. После всех PASS — frontend Publish. Проверить новую форму подтверждения
   и отмену без backend invoke на ПК и мобильном. Не нажимать финальную
   кнопку отправки. Убедиться, что native prompt больше не вызывается.
7. Read-back старых агрегатов без изменений, очередь пустая, ошибок нового
   worker в естественных cron-логах нет. Реальная отправка/досылка требует
   отдельного разрешения пользователя с точной кампанией/аудиторией.

Проверки без сети: UI cancel/wrong phrase/both channels/double-click, 205/1001
получатель; SMTP acceptance, 450, unknown outcome, journal failure, wall time;
SQL queue claim/unique retry/accepted and historic exclusion/grants в PGlite.

Rollback: вернуть три functions и frontend предыдущего merged SHA. Таблицы
не удалять: если новые рассылки уже поставлены в очередь, сначала остановить
обработку и выполнить проверяемую сверку статусов. Никаких автоматических
повторных отправок исторических кампаний.
