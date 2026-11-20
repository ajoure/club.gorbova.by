# Границы очистки target для копии gorbova.by

10.11.2026. Этап 1: identity и reset preflight. Удаления не выполнялись. Пользователь прямо поручил очистить существующий собственный Supabase без архива и выполнять перенос поэтапно. Повторное согласование того же удаления не требуется.

## Окружения

- Единственная разрешённая цель очистки: Supabase ref `ypwsuumurrtkxatoyqhk`, name `club.gorbova.by`, organization `xyqkgjxwwcyvdsdrqbht`, region `eu-central-1`, ACTIVE_HEALTHY.
- Запрещено очищать: текущий Cloud ref `hdjgkjceownmmnrqqtuz`, Lovable project `796a93b9-74cc-403c-8ec5-cafdb2a5beaa`, workspace `EaRBlfb9sRGL5FIEuz9b`. Официальный get_project подтвердил проект; текущий reported SHA `e84a25c9bd60e02d0c0618fc9d95f721409a92ca`, agentFinished=true. Это не заменяет проверку очереди перед будущей командой Lovable.
- Сохраняется само Supabase project/ref. Не использовать projects delete и не создавать вместо него другой проект.

## Свежие счётчики

Read-only preflight 10.11.2026 12:33 UTC: public tables100, точные строки3071, public SQL functions10, Auth users1/sessions2, old migrations28. Bucket/object/cron/Vault counts0. API и штатный CLI с существующей авторизацией независимо вернули100 Edge Functions. Public relations260 включают100 таблиц и160 индексов; это не260 таблиц.

Внешний пользовательский trigger `auth.users.on_auth_user_created` ссылается на `public.handle_new_user`. При reset учитывать его отдельно: managed Auth schema не удалять целиком. Прикладных нестандартных схем по фильтру preflight не обнаружено; типы, grants и зависимости проверяются перед точным DDL.

CLI secret names: SUPABASE_ANON_KEY, SUPABASE_DB_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL. Это системные credentials. Значения не читались и не сохранялись; custom secret names0.

## Следующие ограниченные проходы

1. Этап 2a: удалить первую именованную партию до10 старых Edge Functions через штатный CLI с явным --project-ref. Не вызывать handlers и не обращаться к bePaid/Telegram/прочим провайдерам. Список брать из зафиксированного metadata manifest и сверять с живым list. Отдельный read-back каждого результата и общего inventory; checkpoint с deleted/failed/uncertain. Следующие партии — отдельные проходы, без автоматического расширения партии. Не повторять неопределённый delete.
2. После отсутствия всех старых Functions: подготовить и проверить атомарный DDL для ровно перечисленных прикладных objects/routines/types и связанного custom Auth trigger. До mutation проверить dependency closure, system/extension-owned objects и исходные counts. Не DROP auth/storage/realtime целиком, не DROP DATABASE/PROJECT, не бесконтрольный CASCADE.
3. Удалить единственного старого Auth пользователя и его сессии штатным Admin-маршрутом, предварительно обеспечив отсутствие старых runtime consumers/открытых прав. Старый JWT не становится недействительным лишь от удаления пользователя: проверить session/token policy и не оставлять доступ к импортируемым данным. Не затрагивать source Auth.
4. Удалить оставшееся прикладное состояние/старую migration history, если подтверждено в фактическом manifest, сохранив managed services. Не создавать фиктивную историю миграций. Встроенные секреты и системные migration tables сохранять как структуру.
5. Независимый итоговый read-back: public old tables/routines0, old Edge Functions0, Auth users/sessions0, storage objects/buckets0, cron0, custom secrets0. Проверить health проекта и отсутствие воздействия на source. Только тогда этап reset завершён.

## Доступный маршрут

Установленный Supabase CLI 2.115.0. functions list с явным target ref и существующим login реально сработал. Help подтверждает functions delete --project-ref <ref> <name>. Удаление не запускалось.

db reset --linked повторно применяет локальные миграции: в текущем репозитории это не эквивалент чистого target. Не запускать его из рабочего проекта с1405 миграциями и seed. Нельзя выдавать удаление таблиц за полную очистку, пока100 старых runtime functions и Auth остаются.

Архив старых target данных не создавать по прямому выбору пользователя. Существующие обезличенные inventory/counts/операционный audit сохраняются для проверки, но не являются копией удаляемых данных.

## Материалы и критерий этого прохода

Приватная папка /Users/fs/CodexWorkspace/Artifacts/gorbova-supabase-migration-plan-2026-11-09: target-reset-preflight-2026-11-10.json, target-edge-preflight-2026-11-10.json, target-secret-names-2026-11-10.json. Только метаданные; без клиентских строк, секретов и auth hashes.

Критерий этапа1: цель создана; имя «копия gorbova.by»; новый no-archive reset выбор отражён в плане; target identity и состав подтверждены; маршрут первой именованной партии доступен; текущий source защищён; checkpoint сохранён. Статус: PASS. Полная очистка и перенос: НЕ ВЫПОЛНЕНЫ.
