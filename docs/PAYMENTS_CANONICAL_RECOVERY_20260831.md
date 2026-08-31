# Восстановление канонической платёжной цепочки

Продолжение INV-25 / INV-P0-1 после PR #386, #402 и #403. Это backend-патч;
скрытые тарифы и кнопки оплаты — отдельная следующая задача.

## Изменения

- `payments-reconcile` получает exact `queueItemId`, `expectedUpdatedAt`,
  `dryRun` / `dry_run`. Exact-ветка не запускает уровни 1/2 и уведомление о
  массовой сверке. Dry-run не пишет даже audit/lease.
- Платёж подтверждается только GET bePaid по UID: статус, тип, сумма,
  валюта, `paid_at`; recurring дополнительно проверяет active SBS и last UID.
- Identity: существующий payment → его фактический order; иначе точный
  provider link → subscription → canonical parent order → profile/current
  auth user. Никакого поиска по email/сумме, legacy `orders`, новых контактов.
- Для нового recurring cycle переиспользуется общий REBILL engine. Его три
  модуля перенесены в `_shared/rebill`; старые импорты сохранены wrappers.
  Существующий платёж не перепривязывается к другому заказу.
- Повторное восстановление использует сохранённое окно доступа в meta
  REBILL, а не текущую дату или уже продлённую подписку. Выдача доступа идёт
  только через `grant-access-for-order` с последующим read-back.
- Идемпотентность grant использует ту же подтверждённую дату платежа, что и
  основная выдача; `orders_v2.paid_at` не существует и NOW не является её
  заменой. Отсутствующая дата не создаёт новое окно.
- Единственный владелец CAS/двухчасового lease — canonical worker.
  `bepaid-queue-cron` только передаёт snapshot; recurring auto-process
  делегирует до legacy/fuzzy matching. Terminal/import/cancelled не replay.
- Миграция `20260831073813_extend_payments_reconcile_timeout.sql` меняет
  только HTTP timeout двух существующих cron jobs на 120000 мс. Сохраняются
  URL, расписания, headers и body. Secret не читается наружу, job не запускается.

## Проверки до production

- Полный Vitest, build, tsc, Edge Function contract check.
- Deno check всех шести изменяемых функций; transitive package isolation.
- Offline recovery: provider mismatches, refund/foreign/user/cancel guards,
  повтор после частичного grant, no-op replay, CAS conflict и zero-write dry-run.
- Миграция выполнена дважды в изолированном PostgreSQL/PGlite: идемпотентность,
  ровно две прежние команды, прежние headers/body/schedule, шесть STOP/rollback
  сценариев. Никакого обращения к production из локальных тестов.

## Managed rollout и границы

1. Зелёный PR, точный merged SHA, plan-only ревизия Lovable Cloud.
2. Managed migration после проверки текущих двух cron-команд. При несовпадении
   формы, расписания, URL, scoped-auth или существующего timeout — STOP.
3. Точные deploy targets: `grant-access-for-order`, `payments-reconcile`,
   `bepaid-queue-cron`, `bepaid-auto-process`, `bepaid-webhook`,
   `admin-materialize-post-cancel-charge`. `bepaid-readonly-pull` уже развёрнут
   из #403 и не изменяется.
4. OPTIONS/отрицательная авторизация до любых бизнес-вызовов. Развёртывание
   новых workers включает следующий scheduled run, поэтому оно подчиняется
   тем же границам согласования, что и восстановление доступа.
5. Свежий exact dry-run проблемной строки; ожидаются одна REBILL-сделка,
   один payment и продление прежней subscription/entitlement, без списания.
   Любая новая identity/refund/cancel/rowcount проблема останавливает execute.
6. Отдельные metadata repairs: только заранее разрешённые точные строки,
   snapshot/CAS и rowcounts; состояния клиентов/доступов не подменять SQL.
7. После execute: payment → paid order → subscription/entitlement/ledger →
   фактический Telegram delivery-state, INV-25 и INV-P0-1 SELECT read-back.
   Активная привязка Telegram не равна членству в чате/канале.
8. Publish только после PASS. До managed evidence этот документ и зелёный
   GitHub не являются доказательством исправленного production.

Не выполняются тестовые списания, отмены, возвраты, сообщения, создание
пользователей/контактов. Не сбрасывается историческая очередь. Стандартные
уведомления реального восстановления требуют согласования перед исполнением.
