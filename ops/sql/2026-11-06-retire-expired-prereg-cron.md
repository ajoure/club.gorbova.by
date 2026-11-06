# Retirement двух истёкших preregistration cron jobs

Это операционный скрипт для одной проверенной конфигурации Lovable Cloud.
Он **не применяется при merge, build или Publish**, не является миграцией и
не должен попадать в Supabase/Drizzle migration journals. Наличие скрипта не
означает, что jobs уже отключены.

Историческое окно работы закончилось 4 февраля 2026 года, но два задания
остались активны с ежемесячными расписаниями. Проверенная очередь не содержит
`pending_charge` или stored payment token. Скрипт повторяет эти проверки перед
изменением и после него; новую очередь не обрабатывает.

| Job | Имя | Расписание | Единственное изменение |
| --- | --- | --- | --- |
| 23 | `preregistration-charge-morning` | `0 6 1-4 * *` | `active=false` |
| 24 | `preregistration-charge-evening` | `0 18 1-4 * *` | `active=false` |

IDs, имена, расписания, команды, owner, database и прочие поля сохраняются.
Другие jobs, банковские подписки, платежи, формы, предзаписи, функции, Auth/RLS
и UI скрипт не меняет. Worker, provider preflight и реальные платежи не
вызываются. Уже отправленные запросы операция не отменяет.

## Подготовка и отдельное исполнение

1. Координатор проверяет очередь/lease, официальный Lovable actor, проект и
   workspace. SQL fingerprints являются проверкой состояния, не заменяют
   проверку подключения и не дают бизнес-полномочий. Нужны terminal plan-only
   review, отдельный PR, независимый review и required GitHub checks.
2. Получить **точные байты этого SQL из merged SHA**, вычислить SHA256 и
   сохранить его вместе с SHA/PR в приватном журнале. Не переписывать SQL
   вручную или через модель. Не подставлять hash самого файла внутрь него.
3. Через разрешённые read-only SELECT проверить все guards: наблюдаемые
   owner/роль/видимость, pg_cron 1.6.4, native C API OID/signature/defaults/
   EXECUTE, ключ jobid и стандартный invalidation trigger, два полных
   non-active fingerprints, очередь и снимок других jobs. Отличие — STOP,
   а не автоматическое обновление ожидаемых hashes. Этот этап не вызывает
   `alter_job`, даже с прежним значением флага.
4. Только отдельно назначенный координатор может передать один точный DO
   через официальный Lovable. Не использовать прямой Supabase/CLI, `UPDATE
   cron.job`, `SET ROLE`, новые GRANT, unschedule/recreate или lock probes.
   Скрипт отказывается работать 1–4 числа UTC целиком и использует
   transaction-local `lock_timeout=5s`.
5. При uncertain receipt — читать тот же исход, без повторного исполнения.
   Ошибка не перехватывается: обе наши правки откатываются. Ниже описана
   отдельная проверка, без которой результат не принят.

## Контракт конечного состояния

Один DO вызывает только granted owner API с `job_id` и `active=false`.
Переданные NULL-default поля не перезаписываются. Штатная C-реализация
проверяет владельца, использует внутреннюю медиацию extension и native UPDATE
locks; caller не становится superuser и не получает table UPDATE.

- Изначально обе active: два API-обновления в одной транзакции. После них
  обе inactive и все non-active fingerprints совпадают, иначе uncaught RAISE.
- Конкурентное отключение того же target допустимо. Отчёт говорит
  `api_processed_jobs=2`, **не** «два наших эффективных перехода true→false».
- Изначально обе inactive: ноль API-вызовов, повторная проверка внутри DO и
  затем независимый read-back. Это no-op без row locks, не strict CAS.
- Initial mixed/missing/owner/hash/queue drift останавливает операцию до API.
  Изменение non-active поля или ошибка второго API откатывает обе наши правки;
  независимо committed изменения другого actor не откатываются.

Очередь и digest остальных jobs проверяются как **снимки**. Видимость
проверяется отдельно: в этой конфигурации actor имеет BYPASSRLS, а row security
не применяется. Это не универсальная гарантия для всех non-superuser ролей.
Наблюдаемый конфликт останавливает нашу транзакцию; отсутствие изменений между
снимками не доказывает global freeze до физического commit или в будущем.

## Независимая приёмка

После результата DO координатор отдельно читает metadata двух jobs и
подтверждает `active=false`, прежние IDs/names/schedules/command hashes,
database/username hashes и полные non-active fingerprints. Повторно сверяет
queue/token counts, наличие другого target job и count/digest остальных jobs,
указав actor visibility и время снимка. Не выводить raw commands, URL, headers,
токены, клиентские строки или provider response.

Сохранить actual receipt, exact merged SHA, SHA256 SQL и независимый read-back.
NOTICE `*_PENDING_INDEPENDENT_READBACK` не означает принятого результата.
Плагин может вернуть `rows=[]` и не передать NOTICE. Тогда режим и число
вызовов не установлены по receipt: итог описывается как
`APPLIED_OR_VERIFIED_NOOP`, calls — `0 or 2`, без вывода из внешнего preflight.
Не добавлять таблицы, функции, уведомления или GUC для извлечения outcome.
Главное доказательство — независимый read-back конечного состояния.
Reenable, field drift, observed queue/other-job conflict либо неизвестность
дают HOLD для выяснения владельца, без автоматической перезаписи или повтора.
При совпадении результат — verified **as-of** read-back, не вечная гарантия
против будущего изменения другим actor.

Флаги конфигурационно обратимы, но автоматического reenabling в этом scope
нет: оно возобновило бы истёкший payment worker. Функция и её OPTIONS health
consumer сохраняются. Deployed bundle, история запусков и native ChatGPT
schedule этим не доказываются и не изменяются. UI proof здесь не применим.

## Проверки исходника и ограничения

Нужны независимый review точного SQL, read-only dry-run guards, required repo
checks, atomic postcheck и actual independent read-back. Не создавать mock
pg_cron, не устанавливать зависимости и не объявлять отсутствующий локальный
SQL runtime PASS. Required repo CI не исполняет этот операционный SQL.

Первичные источники: [pg_cron 1.6.4 C owner API](https://github.com/citusdata/pg_cron/blob/v1.6.4/src/job_metadata.c#L1166),
[NULL defaults и управляемый EXECUTE](https://github.com/citusdata/pg_cron/blob/v1.6.4/pg_cron--1.3--1.4.sql#L12),
[native cache invalidation trigger](https://github.com/citusdata/pg_cron/blob/v1.6.4/pg_cron.sql#L40),
[PostgreSQL row locks](https://www.postgresql.org/docs/17/explicit-locking.html#LOCKING-ROWS).
