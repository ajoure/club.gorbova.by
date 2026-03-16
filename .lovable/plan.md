

# План: Исправление критической ошибки `column v.last_telegram_check_result does not exist`

## Проблема

Последняя миграция `20260316134817` сломала RPC `get_club_member_summary`. В LATERAL JOIN используется `v.last_telegram_check_result`, но колонка `last_telegram_check_result` отсутствует в view `v_club_members_enriched`. Предыдущая рабочая версия (миграция `20260316090338`) корректно джойнила базовую таблицу `telegram_club_members AS tcm2` и обращалась к `tcm2.last_telegram_check_result`.

Результат: весь экран клуба сломан — все метрики показывают 0, ошибка 400.

## Исправление

Одна SQL-миграция: пересоздать `get_club_member_summary` с правильной структурой JOIN:

1. Восстановить `LEFT JOIN telegram_club_members tcm2 ON tcm2.id = v.id` для доступа к `last_telegram_check_result`
2. В LATERAL использовать `tcm2.last_telegram_check_result` вместо `v.last_telegram_check_result`
3. Восстановить `FROM v_club_members_enriched v JOIN telegram_clubs tc ON tc.id = v.club_id` вместо `FROM telegram_clubs tc LEFT JOIN v_club_members_enriched v`
4. Восстановить фильтр `WHERE ... AND NOT COALESCE(v.is_orphaned, false) AND (v.in_any OR v.access_status = 'removed' OR ...)` и `GROUP BY`
5. Сохранить все PATCH-B изменения (with_access исключает removed)

Scope: одна SQL-миграция. Никаких изменений UI-файлов.

