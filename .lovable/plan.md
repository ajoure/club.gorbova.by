План: PR689 DRM-пилот — read-only сверка перед применением (STOP для Codex)

## Предусловия
- Рабочая копия чистая, HEAD = main `003e4d9da6f3…`. Чужих незавершённых изменений нет. Очередь независимо подтвердить не могу.
- PR689 open, не merged, head по GitHub API = `e08a27a0aa3a823017480ac0be785b41a57bf0f7`.
- Файлы прочитаны из raw точного head (diff: 23 файла).

| Файл | SHA256 | Сверка |
|---|---|---|
| video-pilot-token/core.ts | df5cf26d…2e365 | совпадает |
| video-pilot-token/runtime.ts | 97d94be5…0ae26ae | совпадает |
| migration 20261029095619 | 90243330…1790ecf | совпадает |
| video-pilot-token/index.ts | a3290743…f66 | эталона не было |
| video-pilot-drm-callback/index.ts | 7f3c7ace…6ea | эталона не было |

## Итог по 4 пунктам

| # | Пункт | Статус |
|---|---|---|
| 1 | Политика сессий Auth + схема/grants | **UNKNOWN** по политике; схема PASS с одним замечанием |
| 2 | Тестовый субъект | PASS; способ allowlist — PASS (через secret) |
| 3 | Kinescope синтетический проект | Видео/проект PASS; DRM auth **FAIL/не настроен**; player mapping UNKNOWN |
| 4 | Preview и готовность deploy | PASS (подготовка); исполнение заблокировано CI и п.1 |

### 1. Политика сессий Auth — UNKNOWN (STOP по этому пункту)
- Настройки inactivity timeout, timebox и single-session мне недоступны: project_info их не возвращает, а инструмента чтения настроек Auth нет. Значения я не подставлял.
- not_after = NULL у всех 4 сессий субъекта (это не доказывает, что политика выключена).
- Колонки, которые читает миграция, есть все. Типы: sessions.id/user_id uuid; created_at/not_after timestamptz; users.deleted_at/banned_until timestamptz; profiles.user_id uuid, status text, is_archived bool, merged_to_profile_id uuid.
- **Замечание:** `auth.sessions.refreshed_at` — **timestamp without time zone**. В функции он сравнивается с now() через неявное приведение по TimeZone сессии (search_path = pg_catalog). Это корректно только при TimeZone = UTC у роли service_role. Предлагаю Codex явно писать `refreshed_at AT TIME ZONE 'UTC'` либо задокументировать допущение.
- Функции `video_pilot_session_is_live` в базе пока нет (0). В миграции: SECURITY DEFINER, STABLE, только SELECT, REVOKE у PUBLIC/anon/authenticated, EXECUTE только service_role. PASS.
- Внутри миграции есть BEGIN/COMMIT. Managed-инструмент миграций управляет транзакцией сам, поэтому при применении это может помешать.
- У субъекта 4 сессии, поэтому при single_session=true пройдёт только самая новая.

### 2. Тестовый субъект — PASS
- Ровно 1 профиль: active, не archived, не merged. Email подтверждён, не banned и не deleted. 4 сессии, последнее обновление около 1 ч назад.
- Allowlist безопасно задаётся только внутри секрета `VIDEO_DRM_PILOT_CONFIG` (функция читает его через runtime.ts). Значение пользователь вводит сам в форме секрета, в чат оно не попадает. Сейчас секрет не создаётся.

### 3. Kinescope — частично
- Ключ подключения использован только внутри защищённого запуска. Ни он, ни сырые ответы не выводились.
- Проект: HTTP 200, имя «Codex DRM Pilot 2026-10-29», privacy = nowhere, доменов 0. Membership PASS.
- Видео: HTTP 200, status done, принадлежит этому проекту, 300 сек, субтитры en. PASS.
- Player: API вернул UUID плеера, а не строку `6Xp3rpTFuL8xMnKZs6YmqD`. Соответствие публичного id и UUID я не подтвердил: UNKNOWN.
- Флага DRM в ответе по видео нет, по API включение DRM не подтверждено.
- `GET /v1/drm/auth/{project}`: **404 not found**. Конфигурации DRM-авторизации нет, поэтому url/strict/auth сейчас отсутствуют. Перед пилотом нужна будущая настройка с strict:true. Никаких PUT не было.

### 4. Preview и готовность — PASS (подготовка)
- Preview origin отвечает (401 — закрытый предпросмотр, адрес жив).
- В main нет пилотных функций, в config.toml записей нет. PR добавляет обе функции с verify_jwt=false: проверку делают сами функции, без конфигурации они отвечают 404.
- Секреты VIDEO_DRM_PILOT_* не создавались и не менялись.

## Следующий разрешённый этап (после решения Codex)
1. Codex: получить значения политики Auth из надёжного источника либо явно принять их как известные. Без этого execute не начинаю.
2. Решить замечание по `refreshed_at` (timestamp без зоны) и по BEGIN/COMMIT в миграции.
3. Дождаться PASS нового CI на exact head и merge. Затем отдельной командой: сверка merged SHA → миграция → deploy 2 функций без секретов → smoke (404 disabled).
4. Только после этого отдельный этап с секретами и PUT DRM auth strict:true.

Ничего не изменено: нет записей, RPC, deploy, секретов, PUT и Publish. STOP.
