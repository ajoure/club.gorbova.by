План: read-only ревизия переноса backend gorbova.by (Lovable Cloud → существующий Supabase club.gorbova.by)

Статус: PLAN-ONLY. Не execute, не разрешение на переключение. Ничего не менялось.

## 0. Preflight (проверено в этом ходе)
- HEAD `fc5e20daa4ccb673c7012fe69ebb7fd6f164f537` = origin/main из команды; рабочая копия чистая (0 изменений).
- Конкурирующий execute: в этом чате не виден; общую очередь Lovable/других агентов этим инструментом не прочитать — UNKNOWN, root сверяет до любого шага.
- В репозитории 103 каталога `supabase/functions`, 373 файла migrations (из них часть с cron/schedule).
- Регламент проекта прямо называет `ypwsuumurrtkxatoyqhk` legacy, не source of truth. Эта задача — явно названная задача по переносу, но сама её постановка требует отдельного решения владельца: обновить регламент (AGENTS/KB) до любого execute.

## 1. Managed boundary и официальный путь экспорта
Факты/правила платформы:
- На Lovable Cloud недоступны service_role key, пароль БД и dashboard; модель не должна их получать. Поэтому `pg_dump`, `supabase db dump`, Auth dump через CLI со стороны модели — недоступны и запрещены.
- Официальный путь полной копии: **More → Database → Manage → Settings → Export project data → Database → Export** (пользователь в UI). Включает полную схему+данные, включая auth с UUID и password hashes. Лимиты: БД ≤15 GB (у нас ~7.4 GB — проходит), файл ≤5 GB (UNKNOWN, может не пройти — blocker-кандидат), 1 экспорт/24ч, backend должен быть запущен.
- Экспорт НЕ включает: файлы Storage (3262 объекта, ~4.6 GB), код Edge Functions (он есть в GitHub), значения secrets, настройки Auth providers/SMTP/redirects/API keys.
- Storage: только выгрузка пользователем через More → Storage; скриптов service-role копирования не писать.
- Daily backups (~14 дней) — только in-place restore того же проекта, не перенос.
- Через плагин/модель можно: read-only каталоги SQL, список secret NAMES, analytics logs, исходники. Нельзя считать доказанным: содержимое/целостность экспорта, совместимость дампа с целевыми ролями, наличие всех auth.identities/MFA/sessions, перенос Vault-секретов.
- Подтвердить формат экспорта (plain SQL vs custom, с владельцами/GRANT или без) — UNKNOWN до первого тестового экспорта.

## 2. Inventory для сбора (read-only, на этапе execute-подготовки)
Собрать только метаданные:
- Edge Functions: список из репо (103) vs deployed — authoritative deployed inventory/hash инструментом недоступен (ранее подтверждено); logs дают лишь вызванные имена/версии. Target уже имеет 100 функций неизвестного происхождения — их нельзя считать текущими.
- Auth: только безопасные флаги (email confirm, providers on/off, site URL/redirect список без токенов, JWT expiry). Signing keys/JWT secret не переносимы: на новом проекте все сессии станут недействительны → обязательный повторный вход пользователей; anon/service keys в клиенте и вебхуках меняются.
- Secrets: только имена через secrets tool (если разрешено root). Значения пользователь вводит вручную в target у провайдеров (bePaid, Telegram боты, Resend/SMTP, Kinescope, AmoCRM, GetCourse, Instagram, AI keys). LOVABLE_API_KEY/Lovable AI Gateway на чужом Supabase не работает — нужна замена провайдера AI или отказ.
- Расширения/инфраструктура: pg_cron jobs (SQL `cron.job` — содержит URL проекта и часто ключи в теле → переписывать), pg_net, pgmq очереди, Vault записи (не экспортируются как значения переносимо, ключ шифрования pgsodium другой), realtime publications, внешние connectors (Lovable connectors не переносятся).
- Вебхуки провайдеров, указывающие на `hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/...`: bePaid, Telegram setWebhook для каждого бота, email inbound, Instagram — список составить из кода и app_settings.

## 3. Ловушки текущих скриптов
`scripts/export-data.ts`:
- Требует service key — на Cloud недоступен; путь непригоден.
- Только 29 таблиц из 398 (комментарий "Add more tables").
- `.limit(10000)` без пагинации — тихая потеря строк в больших таблицах.
- REST/PostgREST: колонки берутся из первой строки, типы теряются (jsonb для массивов, timestamp/numeric/bytea как строки, enum/arrays ломаются).
- `TRUNCATE ... CASCADE` на target — уничтожит существующие финансовые/клиентские данные target и каскадно связанные таблицы. Критично.
- Не трогает auth, storage, sequences, triggers (вставка запустит триггеры → дубли событий/рассылок/attribution).
- При ошибке пишет комментарий и продолжает — неполный файл выглядит успешным.

`scripts/migrate-to-new-supabase.md`:
- `supabase db dump` к источнику невозможен без пароля Cloud.
- `INSERT INTO storage.buckets` — запрещённый способ, бакеты создаются API/tooling.
- Перечень secrets неполный; нет cron/pgmq/Vault, нет смены вебхуков, нет freeze writers, нет reconciliation и rollback, нет учёта непустого target.

## 4. План (фазы, каждая — отдельное разрешение)
A. Решение по target (blocker). Target содержит 3071 строку в 100 таблицах, 1 auth user, 98 общих таблиц с совпадающими именами. Варианты:
  1) сохранить target-данные в отдельной схеме/архивном проекте и разворачивать source целиком (рекомендовано: без конфликтов UUID/PK);
  2) merge — требует построчного анализа конфликтов PK/unique по 98 таблицам, semantics финансов, дублей профилей/email; высокий риск.
  Сначала полный backup target (его dashboard, pg_dump владельцем) + проверка restore в третьем проекте.
B. Репетиция в отдельном пустом Supabase (не target): импорт Cloud export → проверить ошибки ролей/расширений; восстановить Storage; deploy функций из exact SHA; secrets-заглушки без реальных провайдеров; сверка counts по 398 таблицам, sums финансов (payments/orders по статусам), auth users 513 с hashes (тестовый вход синтетическим аккаунтом), storage objects 3262/байты, 728 functions, 975 policies, 330 triggers, cron jobs выключены. Все cron/webhooks отключены, исходящие сообщения/платежи заблокированы.
C. Подготовка cutover: runbook смены URL/keys во фронте (env, Publish), список вебхуков, перерегистрация Telegram webhooks, bePaid notification URL, DNS/CORS/redirect URLs, OAuth callbacks.
D. Финальная остановка writers: maintenance-режим фронта; выключить cron на source; провайдерские вебхуки — не теряют события только если провайдер ретраит (bePaid/Telegram — ретраи ограничены; Telegram хранит updates ~24ч без webhook). Durable вариант: временный приёмник-буфер или окно с отключённым setWebhook и последующим getUpdates — проверить отдельно. Зафиксировать watermark (max created_at/id по ключевым таблицам, pgmq depth=0, queue pending=0).
E. Финальный экспорт (один в 24ч — планировать заранее) + Storage delta → импорт в target по выбранному варианту A → верификация как в B + сравнение watermark.
F. Переключение: secrets, functions deploy, cron включить по одному, вебхуки перенаправить, фронт Publish, smoke без реальных платежей/сообщений, повторный вход пользователей.
G. Rollback:
  - до записи на target: вернуть фронт/вебхуки на Cloud, включить cron — без потерь.
  - после новых записей на target: обратного автоматического пути нет; нужен delta-replay target→source по watermark (платежи, заказы, auth signups, storage uploads) с dry-run/counts. Поэтому окно go/no-go короткое, с заранее определёнными критериями и сохранением source в read-only (не удалять Cloud минимум N недель).

## Blockers
1. Регламент: target объявлен legacy — нужно явное решение владельца и правка регламента.
2. Стратегия для непустого target (A) не выбрана.
3. Размер файла экспорта ≤5 GB — UNKNOWN; при превышении нужен вариант через поддержку.
4. Lovable AI Gateway, connectors и Lovable-managed email вне Cloud не работают — нужна замена.
5. JWT/signing keys непереносимы → все сессии сброшены, ключи в клиентах/вебхуках меняются.
6. Vault/pgsodium-зашифрованные значения и cron с ключами в теле — переписывать вручную.
7. Durable приём вебхуков во время freeze не спроектирован.
8. Нет authoritative inventory deployed functions и их конфигов (verify_jwt) на source.
9. Очередь других execute — UNKNOWN.

## Непроверено
Формат/полнота Cloud export, auth.identities/MFA, конфиги Auth на source, точный список secrets, cron/pgmq/Vault содержимое, происхождение 100 функций target, совместимость расширений и версий Postgres.

STOP.
