
# Отчёт read-only диагностики (source hdjgkjceownmmnrqqtuz)

Ничего не менялось: код, деплой, DDL/DML, secrets, webhooks — без изменений. Тестовый звонок не выполнялся.

## Корневая причина (подтверждена)

`vochi-call-initiate` **отсутствует в runtime Edge Functions**. Gateway возвращает **404** ещё на CORS-preflight (OPTIONS). Запрос **не достигает** runtime функции, поэтому кода функции, VOCHI API, `verify_jwt` gate и JWT здесь **не участвуют**. UI-сообщение «Не удалось связаться с VOCHI» — ложная атрибуция: связи с VOCHI провайдером не было даже попытки.

## Прямое доказательство (Supabase `function_edge_logs`)

Точный клик пользователя произошёл **~14:53–14:54 Europe/Warsaw** (не 14:35 — расхождение памяти пользователя ~18 мин; ближе к 14:35 CEST в логах vochi-call-initiate ничего нет). Оба обращения к `vochi-call-initiate` дали 404 на **OPTIONS** без последующих POST:

| UTC | Warsaw (CEST) | Method | URL | Status |
|---|---|---|---|---|
| 2026-07-22 12:53:55.657 | 14:53:55 | OPTIONS | `/functions/v1/vochi-call-initiate` | **404** |
| 2026-07-22 12:54:21.096 | 14:54:21 | OPTIONS | `/functions/v1/vochi-call-initiate` | **404** |

В том же окне соседняя функция `vochi-calls-poll` работает штатно (десятки `POST 200` каждые ~15 сек), т.е. это точечное отсутствие деплоя одной функции, а не общий сбой gateway/проекта.

Runtime-логи `vochi-call-initiate` за 12:00–13:00 UTC — **пусто** (`No logs found`). Это согласуется с 404 на gateway: boot не запускался, следовательно, 401/403/5xx/`NOT_FOUND_FUNCTION_BLOB` от runtime не наблюдаются, потому что runtime вообще не вызывался.

## Данные БД в окне 12:34–12:36 UTC (14:34–14:36 Warsaw)

- `public.calls`: **0 строк** с `+375447500084` и **0 строк** любой природы в окне. Последний исход. звонок на этот номер — **2026-07-21 08:12:20Z** (`status=failed`, `vochi_response.http_status=200`, `poll_result=no_match_yet`) — это прошлая история, не текущий инцидент.
- `public.call_events`: **0 строк** в окне.
- `public.audit_logs` в окне 12:30–12:40Z: только `live_access_granted` (Ирина Кацнельсон, эфир `raskhody-za-schyot-pribyli-…`), `bepaid.erip.reconcile_*`, `payments.receipt_url_backfilled`. **Нет** ни одной записи с `vochi`, `call`, `+447500084/+375447500084`.

Отсутствие записей в `calls/call_events` согласовано с 404 на gateway: клиентский `initiate` не создаёт запись до успешного ответа функции.

## Отделение от «чужих» JWT-ошибок

Никаких признаков связи текущего инцидента с фоновыми `AuthInvalidJwtError` не найдено. Атрибуции по времени/пути/user_id нет:
- runtime `vochi-call-initiate` не вызывался (0 логов) — JWT-валидации не было;
- gateway 404 возникает **до** JWT-проверки;
- в окне нет audit-записей звонка, к которым можно было бы прикрепить чужие JWT-события.

Смешивать фоновые `AuthInvalidJwtError` с этим кликом **нельзя** без request/user correlation, которого здесь нет.

## Deployment / конфиг функции

- Исходник `supabase/functions/vochi-call-initiate/` в репозитории присутствует.
- `edge_functions_registry` для `vochi-call-initiate`: запись **не найдена** (`SELECT * … WHERE name LIKE 'vochi%'` вернул 0 строк).
- Прямые обращения через `supabase--edge_function_logs('vochi-call-initiate', …)`: `No logs found` во всех попытках (в т.ч. без фильтра).
- Соседние `vochi-calls-poll` / `vochi-webhook` / `vochi-sync-worker` в этом же наборе — не проверял по факту деплоя, но `vochi-calls-poll` активно отвечает `200` в окне, что доказывает: сам блок VOCHI-функций не заблокирован платформой, отсутствует именно `vochi-call-initiate`.
- Конфигурация VOCHI (redacted, из прошлой истории `calls.metadata`): `base_url=https://bot.vochi.by`, `path=/api/makecallexternal`, `client_id_prefix=e37a***`, `client_id_len=32`, ключ `vchi_0d9fb25e…` (виден только в `metadata` старой записи от 2026-07-21). Ничего из этого не менялось в рамках диагностики.

## Честный gap

1. **Расхождение времени**: пользователь указал ~14:35 Warsaw, фактические 404-события — 14:53–14:54 Warsaw. В окне 14:34–14:36 Warsaw для `vochi-call-initiate` в `function_edge_logs` **записей нет**. Возможные интерпретации (не подтверждены): (a) пользователь ошибся во времени и реальный клик был в 14:53; (b) в 14:35 клик не долетел даже до gateway (сетевой сбой у клиента) и следа в платформенных логах не остаётся. Разрешить без клиентских логов/HAR браузера нельзя.
2. **Точный статус деплоя `vochi-call-initiate`** (когда пропал, каким деплоем) не восстановлен: `edge_functions_registry` не содержит записи, а платформенного endpoint для listing deployments в текущем toolset нет; вывод сделан по gateway-логам (404) и отсутствию runtime-логов.
3. **Причина отсутствия деплоя** (не деплоился, был удалён, регрессия per-function `verify_jwt`) — вне read-only scope; см. `.lovable/backlog/lovable_agent_deploy_verify_jwt_regression.md` как известный класс инцидентов, но прямой причинной связи с этим случаем в логах не видно.

## Вывод

- **Слой отказа**: Supabase Functions Gateway, ответ **404 NOT_FOUND** на OPTIONS `/functions/v1/vochi-call-initiate`. Запрос **не дошёл до runtime**, тем более до VOCHI.
- **Провайдер VOCHI и JWT в этом инциденте не при чём.** UI-текст «Не удалось связаться с VOCHI» — обобщённая ошибка клиентского fetch, не отражающая реальную причину.
- Устранение требует деплоя функции `vochi-call-initiate` (и, вероятно, проверки, почему её нет в реестре) — **действий не предпринято, согласно read-only режиму**.

## Рекомендованные следующие шаги (НЕ выполнены)

1. Отдельным approve — точечный deploy `vochi-call-initiate` из `main` (по прецеденту точечного восстановления `grant-access-for-order`).
2. После деплоя — внешний smoke: `OPTIONS` не 404; `POST` без JWT — 401 (при `verify_jwt=true`) или application-response (при `verify_jwt=false`, зависит от контракта функции).
3. UI-таск (низкий приоритет, вне текущего окна): различать 404 gateway от ошибок VOCHI провайдера в сообщении пользователю.
