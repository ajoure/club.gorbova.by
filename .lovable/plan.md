# Read-only проверка возможностей: 7 функций, PR715 / PR711

Ничего не изменялось: функции не вызывались, deploy/restore/Publish, записи в базу и Auth не выполнялись. HEAD `36e2ec1e…`, рабочая копия чистая.

## 1. Журналы (один analytics_query, ваш запрос дословно, окно 24 ч)

| Функция | min / max | версий | последний вызов (UTC) |
|---|---|---|---|
| instagram-monitor | 88 / 88 | 1 | 16:49:31 |
| sales-runtime-control | 177 / 177 | 1 | 16:49:30 |
| sales-runtime-worker | 190 / 190 | 1 | 16:49:30 |
| telegram-admin-chat | 4537 / 4537 | 1 | 16:49:20 |
| telegram-media-worker | 3418 / 3418 | 1 | 16:51:02 |
| telegram-webhook | 4998 / 4998 | 1 | 16:49:29 |
| telegram-club-members | NO OBSERVATION | — | — |

Находка: прежние базовые номера были admin-chat 4536, webhook 4997, media-worker 3417. Сейчас в окне 24 ч у каждой из них виден ровно один номер, на 1 больше. Это значит, что смена номера произошла больше 24 ч назад, если только в журналах нет пропусков. Причина и связь с Git SHA неизвестны. Номер версии сам по себе не доказывает выпуск PR711.

## 2. Возможности текущего набора инструментов (проверено по tool_search `supabase`)

Инструменты только для чтения: `supabase--analytics_query {query}`, `supabase--edge_function_logs {function_name, search?}`, `supabase--read_query {query}`, `supabase--project_info` (без параметров), `supabase--test_edge_functions` (офлайн-тесты). Изменяющие инструменты (`deploy_edge_functions`, `delete_edge_functions`, `curl_edge_functions`) не вызывались.

- (a) Активный deployment и config, включая verify_jwt: **инструмента нет.** Журналы дают порядковый номер `version`, `function_id` и время. Они не дают verify_jwt, config, codehash и Git SHA. verify_jwt есть только в исходнике `supabase/config.toml`, это другой класс доказательств: webhook, sales-control, sales-worker и instagram-monitor = false; для admin-chat, media-worker и club-members записи нет (значит, действует значение по умолчанию).
- (b) Неизменяемая ссылка на прошлый deployment и restore именно по ней: **инструмента нет.** Restore/rollback по версии отсутствует. Есть только повторный deploy из текущего исходника.
- (c) Пакет, effective import map, транзитивные версии и integrity: **инструмента нет.** Журналы этого не содержат.

Что журналы могут установить: факт вызова, номер версии, время последнего вызова, коды ответов. Чего не могут: код, hash, SHA, config, зависимости, состояние невызванных функций.

## 3. PR715 (`telegram-club-members`): минимальный следующий шаг

1. Root проверяет, что `supabase/functions/telegram-club-members` и его `_shared`-импорты на текущем HEAD совпадают с merged `0e6e416d…` (по tree/hash).
2. `test_edge_functions {"functions":["telegram-club-members"]}`: офлайн-тесты, без kick и без provider.
3. Отдельным точным разрешением — один `deploy_edge_functions ["telegram-club-members"]`. Логика MAX/auth не меняется.
4. Проверка после выпуска: только журналы (номер версии, отсутствие ошибок запуска). Kick не выполняется. Функцию не вызывать, пока root отдельно не разрешит безопасный способ.

## 4. PR711 (шесть функций): оставшиеся gates

- Проверить, что tree шести папок и их общих модулей на HEAD совпадает с `f7ca6ea4…`.
- Решить, принимается ли новая версия webhook/admin-chat (+1) как неизвестный прежний выпуск. Нужен журнал выпусков root: на платформе чтения развёрнутого кода нет.
- Gates a/b/c инструментами не закрываются. Root должен принять это как известный предел. Recovery возможен только через повторный deploy исходника прежнего SHA.
- Webhook остаётся с `verify_jwt=false` и прежним публичным протоколом. Отдельно принять, что ответ 500 вызывает повторы Telegram.
- Выпуск — только тех же шести функций, одним вызовом, после отдельного точного разрешения.

## Следующее действие root

Сверить с журналом выпусков, откуда взялись номера 4537/4998/3418. Затем дать отдельное точное разрешение на шаги 3.1–3.3 для PR715. STOP.
