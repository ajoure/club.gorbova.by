# Манифест переноса Lovable Cloud → user-owned Supabase

## Контуры

| Роль | Проект |
| --- | --- |
| Источник (без записи во время подготовки) | Lovable Cloud, ref `hdjgkjceownmmnrqqtuz` |
| Целевой старый слепок | user-owned Supabase, ref `ypwsuumurrtkxatoyqhk` |
| Кодовая база для переноса | GitHub `main`, commit `f17bc23242925ea0e8c87ac27351b28b414c998b` |

Проекты `ajoure.by_SOURCE` и `ajoure.by_TARGET` находятся вне границ работ.

## Факты, проверенные в Lovable Cloud

- База содержит 307 таблиц и 7 views.
- Storage содержит 14 buckets.
- В интерфейсе Lovable доступны экспорт данных таблиц в CSV и скачивание файлов
  Storage.
- Конфигурация исходного кода использует source project ref; перед финальным
  переключением URL и publishable key будут изменены только в отдельном
  протестированном коммите.

## Предварительные блокеры

1. Целевой старый проект не является готовой копией (на предыдущей проверке:
   27 совпавших миграций, 100 Edge Functions, около 10 Auth users и отсутствие
   buckets/custom secrets).
2. В GitHub `main` есть повторяющиеся номера миграций. Пары конфликтов:
   `20260720140000_autoweb_real_viewer_count.sql` /
   `20260720140000_crm_company_external_ids.sql` и
   `20260721120000_crm_bulk_deals_and_feed_context.sql` /
   `20260721120000_crm_company_sync_health_metrics.sql`. Массовый
   `supabase db push` запрещён, пока не будет создана воспроизводимая цепочка
   миграций для нового target.
3. CSV-экспорт не переносит пароли Auth, секреты Edge Functions, OAuth
   credentials, cron/vault configuration и storage files автоматически.

## Порядок исполнения

1. Снять неизменяемый экспорт-слепок Cloud: таблицы, Storage, Auth inventory,
   функции, секреты по именам, providers, cron/vault/webhook inventory.
2. Подготовить чистый target и применить проверенную схему в отдельном
   миграционном контуре.
3. Импортировать CSV в зависимом порядке и сверить количество строк; отдельно
   импортировать Storage с сохранением путей/metadata.
4. Задать секреты и внешние интеграции вручную в user-owned Supabase.
5. Выполнить QA на изолированном frontend: anonymous, login/reset-password,
   storage, webhook, платежи в sandbox и ключевые роли.
6. Провести финальный короткий freeze записи, снять delta, переключить один
   набор frontend environment variables, проверить production и оставить
   Lovable Cloud доступным только для rollback.
