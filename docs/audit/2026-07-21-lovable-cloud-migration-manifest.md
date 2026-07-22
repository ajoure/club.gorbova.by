# Манифест переноса Lovable Cloud → user-owned Supabase

## Контуры

| Роль | Проект |
| --- | --- |
| Источник (без записи во время подготовки) | Lovable Cloud, ref `hdjgkjceownmmnrqqtuz` |
| Целевой старый слепок | user-owned Supabase, ref `ypwsuumurrtkxatoyqhk` |
| Кодовая база для переноса | GitHub `main`, commit `675c2bf97e0b13ea050921b0d555f5256b867c50` |

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
2. Исторические коллизии номеров миграций устранены в актуальном GitHub
   `main`: проверка имён файлов не показывает повторяющихся timestamp. Это
   снимает прежний блокер, но не даёт права применять миграции к старому target
   без отдельного dry-run и сверки его фактической схемы.
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
