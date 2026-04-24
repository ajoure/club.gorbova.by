
# План: расширенный discovery — ночные проверки, инварианты, каналы уведомлений

## Режим

Только read-only. Никаких write-операций, миграций, запусков `admin-bepaid-backfill` / `admin-repair-missing-payments` / repair-функций. Никаких новых edge-функций, новых INV, новых таблиц. Никакой UI-разработки. Карточка эфира — отдельный, незакрытый трек, его не трогаем.

## Цель

Дать единую доказательную картину «что реально проверяется ночью и какое состояние системы», по которой можно построить отдельный fix-plan. Каждое утверждение — с SQL/файл-пруфом. Никаких выводов «по подмножеству».

## Scope (что входит)

1. Карта ночного чека (cron → edge → инварианты → отчёт пользователю).
2. Источник числа `172/172 OK` — полная цепочка.
3. 4 текущие ошибки: INV-19B, INV-20, INV-22, INV-SITE-1 — данные + семантика правила.
4. Канал Telegram-уведомлений: оплаты, public payment_links, напоминания о списании.
5. Канал Email-уведомлений: транзакционные / auth / reminder / system.
6. Ночное обновление документации.
7. Кандидаты на новые ночные INV (только список, без реализации).

Out of scope: правки кода/данных, карточка эфира, новые проверки/feature.

---

## Этапы discovery

### Этап 1. Карта ночного чека (трек A)

Подпункт «карта ночного чека» — таблица:

| cron job | расписание | какую edge-функцию вызывает | какие INV реально исполняются | какие INV только отображаются | где хранится результат прогона | как формируется текст отчёта пользователю |
|---|---|---|---|---|---|---|

Источники discovery:
- `SELECT jobname, schedule, command FROM cron.job` — все jobs.
- `supabase/functions/nightly-system-health/`, `supabase/functions/nightly-payments-invariants/`, `supabase/functions/system-health-full-check/` — индексы и `index.ts` (read).
- `system_health_runs` / любые таблицы с историей прогонов — `information_schema.tables LIKE '%health%' OR LIKE '%invariant%'`.
- Telegram-сообщение «🚨 НОЧНАЯ ПРОВЕРКА» — поиск шаблона `НОЧНАЯ ПРОВЕРКА` / `Найдено:` / `INV-` по `supabase/functions/**/index.ts`.

Вывод этапа 1: схема pipeline + явное расхождение «реально проверено» vs «показано в отчёте» (если есть).

### Этап 2. Источник числа «172/172 OK» (расширено)

Полная цепочка, не только «где рендерится»:

| звено | что искать | где искать |
|---|---|---|
| константа в коде | `172`, `TOTAL_FUNCTIONS`, `EXPECTED_FUNCTIONS_COUNT` | grep по `src/**`, `supabase/functions/**` |
| env / config | `EDGE_FUNCTIONS_TOTAL` и т.п. | `compgen -e`, `supabase/config.toml`, `secrets--fetch_secrets` |
| registry | `supabase/functions.registry.txt`, любые JSON-реестры | wc -l реестра, сверка с runtime |
| SQL / RPC | view вроде `edge_functions_health_v` | `information_schema.views` |
| edge response | какой JSON отдаёт `system-health-full-check`/`nightly-system-health` | прочитать функции |
| UI formatter | `src/components/admin/system-health/EdgeFunctionsHealth.tsx`, `useEdgeFunctionsHealth` | прочитать |
| runtime-подсчёт | есть ли `supabase.functions.list()` или динамический probe | grep |

Вывод этапа 2:
- захардкожено / реестр / runtime;
- кто кому передаёт значение;
- одно «единственное» число или их несколько и они расходятся;
- реальное число функций (`wc -l functions.registry.txt`, минус комментарии) vs то, что показывается.

### Этап 3. INV-20 — полная типизация 288 записей (трек B, расширено)

Не «10 примеров и вывод», а:

A. **10 примеров** — для ручного разбора (id, created_at, provider, status, reconcile_source, order_source, meta-префиксы).

B. **Полная агрегация** по 288 — каждая по отдельности, без LIMIT:
   - `GROUP BY provider`;
   - `GROUP BY reconcile_source`;
   - `GROUP BY order_source`;
   - `GROUP BY status`;
   - `GROUP BY left(id, 4)` или `meta->>'origin'` для префиксного анализа;
   - `GROUP BY meta->>'payment_flow'`;
   - распределение по дате (по месяцам — отделить исторический хвост от текущих).

C. **Классификация всех 288** по корзинам:
   - `real_paid` — реальный платёж, нужен `payments_v2`;
   - `migration_backfill` — историческая миграция, `payments_v2` не нужен;
   - `manual_admin` — ручная выдача (`admin-create-public-link` / `manual_charge`);
   - `synthetic_rule_engine` — `reconcile_source='rule_engine'` (по memory должен быть исключён);
   - `test_or_demo` — sandbox/test users.

   На выходе — таблица `bucket → count → recommended_action (fix data / fix invariant / add exclusion / accepted)`.

D. **Семантика самого INV-20**: прочитать SQL правила в `nightly-payments-invariants` — учитывает ли оно `reconcile_source IN ('rule_engine','migration')`, `provider='manual'`, `meta->>'no_payment_required'=true`. Зафиксировать: проблема в данных или в правиле.

### Этап 4. INV-19B и INV-22 — семантика правила (расширено)

Для каждой записи (1+4=5 строк) — три измерения:
1. **Что в строке** (SQL-выгрузка `subscriptions_v2` + `provider_subscriptions` + `meta`).
2. **Является ли это data error / rule error / accepted transitional state** (например, `redirecting`, `pending_first_charge`, `cooling_off` после `cancel-trial`).
3. **Корректность самого инварианта** — учитывает ли он окно «после cancel/replace в течение N часов» (по memory `safe-replacement-flow` / `revoke-race-condition-guard`).

Вывод: для каждой записи — одно из {`data_fix_required`, `invariant_logic_fix_required`, `acceptable_transitional`}.

### Этап 5. INV-SITE-1 — страница 969210bb

- `SELECT id, slug, status, blocks FROM site_pages WHERE id LIKE '969210bb%'` — разобрать какие именно блоки невалидны (нет `id`/`type`/`version`).
- Зафиксировать: проблема в данных конкретной страницы vs валидаторе (он может быть слишком жёстким для legacy-блоков).

### Этап 6. Telegram — карта канала доставки (расширено)

Полная карта доставки для трёх сценариев: оплата, создание public payment_link, напоминание о списании по подписке. Для каждого — таблица:

| звено | что фиксируем |
|---|---|
| trigger | webhook `bepaid-webhook` / cron / `admin-create-public-link` / `subscription-renewal-reminders` |
| очередь / outbox | есть ли `notification_queue`/`telegram_outbox`/прямой вызов |
| функция-отправитель | `telegram-send-notification`, `telegram-notify-admins`, `telegram-mass-broadcast` |
| provider / bot | какой `TELEGRAM_BOT_TOKEN`-secret, какой бот, какой `chat_id` (env vs БД) |
| последний success | logs за 7 дней — `function_edge_logs` + `telegram_logs` |
| последний fail | classification: 401/403/timeout/no-chat/secret-missing |
| pipeline-точка fail | где именно цепочка ломается |

SQL-источники:
- `telegram_logs`, `telegram_audit`, `domain_events WHERE event_type LIKE 'telegram.%'`;
- edge-логи `telegram-send-notification` / `telegram-notify-admins` / `bepaid-webhook` за 7 дней;
- `secrets--fetch_secrets` — наличие `TELEGRAM_BOT_TOKEN`/`TELEGRAM_ADMIN_CHAT_ID`.

### Этап 7. Email — расширенный канал (расширено)

Не только `email_send_log`. Добавить:

A. **email_send_log за 7 дней** — DISTINCT ON (`message_id`), разбивка `template_name × status`. Итог:
   - `transactional` (контакт/заказ/booking),
   - `auth` (`auth_emails`),
   - `reminder` (renewal/grace),
   - `system` (admin/health).

B. **Backlog очереди**: `pgmq.queue_length('auth_emails')`, `pgmq.queue_length('transactional_emails')`; есть ли `cron.job` `process-email-queue`, дата последнего успешного прогона.

C. **Последние ошибки провайдера**: `email_send_log` `WHERE status IN ('dlq','failed','bounced')` за 7 дней + `error_message` агрегация.

D. **Конфиг**: `email_domain--check_email_domain_status`, наличие `email_queue_service_role_key` в Vault.

E. **Sender-конфиг**: `SENDER_DOMAIN`/`FROM_DOMAIN` в `send-transactional-email`/`auth-email-hook`.

Вывод: «не отправляется вообще» vs «не отправляется только часть шаблонов» vs «отправляется, но не доходит».

### Этап 8. Ночное обновление документации (расширено)

- Найти cron / edge / job, которые пишут changelog за прошлый день: grep по `docs/`, `nightly-docs`, `daily-summary`, `documentation-snapshot`.
- Зафиксировать:
  - **куда** пишется (БД-таблица `docs_*`, файл в репо, edge-логи?);
  - **кто** пишет (jobname/edge);
  - **что** считается успешным обновлением (наличие записи за date=yesterday?);
  - **след последнего успеха** и **след последней неудачи** (timestamp + причина);
- Если такого job нет — явно зафиксировать «отсутствует», не «сломано».

### Этап 9. Кандидаты на новые ночные INV

Только список, без кода:
- `INV-NOTIF-TG`: 0 fail-доставок Telegram за 24ч.
- `INV-NOTIF-EMAIL`: `email_send_log` не пуст и доля dlq < X%.
- `INV-CRON-HEALTH`: все ожидаемые `cron.job` отработали за 24ч.
- `INV-DOCS-DAILY`: документация обновилась за 24ч.
- `INV-EDGE-COUNT-DRIFT`: реальное число edge-функций равно прошлому ночному прогону (без хардкода).
- `INV-EMAIL-QUEUE-DEPTH`: backlog очередей < threshold.

---

## Deliverable (форма отчёта)

### Раздел 1. Карта ночного чека
Схема pipeline + расхождение «выполнено» vs «показано».

### Раздел 2. Источник «172/172»
Файл, строка, тип источника (hardcoded/registry/runtime), реальное число функций.

### Раздел 3. По каждому из 4 INV — root vs symptom
Обязательный раздел: для каждого INV явно разделить:
- симптом (что показано пользователю);
- корневая причина — одна из категорий: **data issue / config issue / invariant logic issue / missing monitoring**;
- доказательство (ссылка на SQL-выгрузку или файл).

### Раздел 4. INV-20 — типизация 288 записей
Полная таблица bucket→count→action. Без LIMIT.

### Раздел 5. Telegram — карта доставки
3 pipeline (оплата / public link / renewal reminder) с пометками success/fail-точки.

### Раздел 6. Email — карта доставки
4 категории шаблонов + backlog + sender-конфиг + конкретные ошибки.

### Раздел 7. Документация — pipeline или его отсутствие

### Раздел 8. Кандидаты на новые INV
Список, без кода.

### Раздел 9. Единая таблица «finding → root → fix-type»

| объект проверки | ожидаемое поведение | фактическое поведение | источник доказательства | класс проблемы | рекомендуемый тип фикса |
|---|---|---|---|---|---|

Класс проблемы ∈ {data, config, invariant_logic, missing_monitoring, false_positive}.
Тип фикса ∈ {data_repair, invariant_patch, exclusion_rule, new_monitoring, accepted_no_action}.

### Раздел 10. Deferred / backlog
Все некритичные находки, всплывшие по ходу discovery, складываются сюда списком и НЕ становятся scope текущей или следующей задачи без отдельного approve. Никакой незапрошенной разработки.

### Раздел 11. Mapping для следующего fix-plan (add-only)
Явное правило: следующий fix-plan **не удаляет и не заменяет** discovery-результаты. Он ссылается 1:1:
```
finding_id → root_cause_id → proposed_fix_id → proof / DoD
```
Любая правка должна быть привязана к конкретному `finding_id` из раздела 9.

---

## STOP-guards

- Никаких write-операций в БД и storage.
- Никаких запусков repair/backfill/grant/revoke.
- Никаких изменений в edge-функциях, миграциях, RLS, cron.
- Не «чинить» страницу 969210bb молча.
- Не плодить новые edge или INV — только список-кандидат.
- Не трогать карточку эфира.
- Никаких выводов «по подмножеству» — INV-20 закрывается только полной агрегацией по всем 288.
- Не смешивать классы проблем (data ≠ invariant_logic ≠ missing_monitoring).

---

## DoD discovery-этапа

- ✅ Карта ночного чека (раздел 1) с явным расхождением «реально/показано», если есть.
- ✅ Полная цепочка источника `172/172` с указанием файла и строки.
- ✅ Для каждого из 4 INV: симптом / корневая причина / доказательство / класс проблемы.
- ✅ INV-20: **полная типизация всех 288 записей** по корзинам с recommended_action на каждую корзину. Не подмножество.
- ✅ Telegram: 3 pipeline закрыты — где работает, где ломается, на каком звене.
- ✅ Email: разбивка по 4 категориям + backlog + ошибки провайдера + sender-конфиг.
- ✅ Документация: цепочка кто→чем→куда→с каким результатом, либо явная фиксация отсутствия job.
- ✅ Список кандидатов на новые INV.
- ✅ Сводная таблица finding→root→fix-type (раздел 9).
- ✅ Deferred-блок (раздел 10) и mapping-блок (раздел 11) присутствуют.
- ❌ Никаких изменений в коде/БД на этом этапе.
- 📌 Следующим сообщением — отдельный fix-plan, построенный поверх этого discovery по mapping-правилу из раздела 11.

---

## Формат вывода

Один отчёт. Все SQL-выгрузки в виде таблиц прямо в сообщении. Длинные перечисления — свернуть в агрегаты + 10 примеров. Каждое утверждение — с пруфом (файл:строка / SQL + count).
