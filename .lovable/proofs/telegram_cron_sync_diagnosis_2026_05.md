# telegram-cron-sync — диагностика и repair-план (2026-05-05)

## Отчет о выполнении (read-only diagnose)

Никаких write-операций не выполнялось: cron не пересоздавался, функция не деплоилась, `telegram_club_members` / `telegram_clubs` не менялись, invite/queue не создавались.

---

## 1. Cron job

`cron.job` jobid=5, jobname=`telegram-club-sync-hourly`:

- **schedule:** `0 * * * *` (каждый час в :00) — корректно;
- **active:** `true`;
- **command:**
  ```sql
  SELECT net.http_post(
    url := 'https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/telegram-cron-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <anon JWT>'
    ),
    body := jsonb_build_object('source', 'pg_cron', 'time', now())
  );
  ```
- URL верный, Authorization передаётся (anon JWT).

**`cron.job_run_details` за последние сутки:** все 24 запуска `succeeded`, `return_message='1 row'` — это значит **`net.http_post` поставил запрос в очередь**, не более. SUCCESS здесь = «pg_cron вызвал pg_net», а не «edge function отработала».

→ Сам cron-job работает штатно.

---

## 2. pg_net (`net._http_response`)

Снимок ответов в часовых границах (00:00–00:06 каждого часа за последние 6 часов):

| Время | status_code | Заметки |
|---|---|---|
| 09:00:00.49 | `null` | **Timeout 5000ms** — DNS/HTTP не уложился |
| 09:00:05.52 | `503` | `{"code":"BOOT_ERROR","message":"Function failed to start (please check logs)"}` |
| 08:00:00.45 | `null` | Timeout 5000ms |
| 08:00:03.29 | `503` | `BOOT_ERROR` |
| 07:00:00.49 | `null` | Timeout 5000ms |
| 07:00:03.77 | `503` | `BOOT_ERROR` |
| 06:00:05.48 | `503` | `BOOT_ERROR` |

**Два паттерна сразу:**

1. `pg_net` шлёт запрос → 5-секундный таймаут (default `net.http_post` timeout) → `status_code=null`. Cold start функции не укладывается.
2. Через ~3–5 секунд приходит `503 BOOT_ERROR` от edge runtime — функция фактически не стартует.

Прямой POST-пинг через `supabase--curl_edge_functions` подтверждает то же самое:

```
status: 503
body:   {"code":"BOOT_ERROR","message":"Function failed to start (please check logs)"}
```

→ **Edge runtime не может загрузить функцию.** Вызов до handler-а не доходит.

---

## 3. Edge Function logs

`supabase--edge_function_logs(telegram-cron-sync)` → **No logs found**.
Аналитический запрос по `function_edge_logs` с фильтром `request.url ilike '%telegram-cron-sync%'` → пусто.

Функция вообще не появляется в edge-runtime логах за 24/48 часов. Это согласуется с `BOOT_ERROR`: handler ни разу не запускался, поэтому ни `console.log("Starting Telegram cron sync...")`, ни catch-блок не пишут ничего.

---

## 4. Сама функция `telegram-cron-sync`

- 388 строк, импортирует `npm:@supabase/supabase-js@2` и shared `_shared/accessValidation.ts` (505 строк, тоже подтягивает `npm:@supabase/supabase-js@2` и `_shared/timezone.ts`).
- `deno check` локально проходит (типы валидны, синтаксис ок).
- BATCH_SIZE = 25, между батчами `setTimeout(1000)`, между членами `setTimeout(100)`.
- Курсора/возобновления нет: при таймауте всё начнётся с нуля.
- **Важный баг отдельно от boot-проблемы:** функция обновляет только `telegram_clubs.last_status_check_at`, поле `last_members_sync_at` — **не трогает вообще**. Поэтому даже когда функция работала (до 2026-04-13 для БкБ, до 2026-03-19 для Gorbova Club), `last_members_sync_at` оставалось из марта 2026. Это объясняет «стоит с марта» отдельно от текущего boot-падения.
- Сейчас же runtime падает на boot → ничего не апдейтится вообще, ни `last_status_check_at`, ни `last_telegram_check_at` у members.

Объём работы: ~1285 members в двух активных клубах с `auto_resync_enabled=true`. При 100ms задержки на member и 1000ms между батчами теоретическая длительность ~1285*0.1 + 51*1 ≈ 180 сек — это уже за пределами безопасного для одного edge-вызова, но это вторичная проблема, проявится только после того, как починим boot.

---

## 5. Данные

### Активные клубы (telegram_clubs, оба `is_active=true`, `auto_resync_enabled=true`)

| club_id | club_name | chat_id | channel_id | last_members_sync_at | last_status_check_at | members_chat | members_channel | violators |
|---|---|---|---|---|---|---|---|---|
| `fa547c41-3a84-4c4f-904a-427332a0506e` | **Gorbova Club** | `-1001686262735` | `-1001791889721` | **2026-03-13 21:09** | **2026-03-19 17:03** | 164 | 161 | 1 |
| `4f8f9d8f-07ce-4898-8012-39f1035c1456` | **Бухгалтерия как бизнес** | `-1003707939536` | — (нет канала) | **2026-03-13 20:34** | **2026-04-13 18:03** | 29 | 0 | 1 |

### `telegram_club_members.last_telegram_check_at`

| Метрика | Всего |
|---|---|
| total | 1285 |
| `IS NULL` | 0 |
| старше 24 часов | **1285 (100%)** |
| старше 7 дней | **1285 (100%)** |
| старше 30 дней | 420 |
| MAX (самая свежая запись) | **2026-04-13 18:03:20** |
| MIN | 2026-03-16 12:16:53 |

По клубам:
| club | total | older_24h | older_7d | max_check |
|---|---|---|---|---|
| Gorbova Club | 643 | 643 | 643 | 2026-04-13 18:03:20 |
| Бухгалтерия как бизнес | 642 | 642 | 642 | 2026-04-13 18:03:01 |

→ Последняя успешная проверка — **2026-04-13 18:03**. После этой даты функция не апдейтила ни одного member-а ни в одном клубе. Ровно ~22 дня простоя.

---

## Root cause

**Primary (актуальный, блокирующий):** `telegram-cron-sync` падает на старте edge runtime — `503 BOOT_ERROR`. Cron штатно стреляет каждый час, `pg_net` уходит в 5s timeout, затем приходит 503 от runtime. Ни одного `console.log` функции не зафиксировано в edge-логах за 24/48 часов.

`deno check` локально проходит → синтаксис/типы целы. BOOT_ERROR без логов в нашем edge runtime обычно означает один из:
  - проблема с подгрузкой `npm:` зависимостей (npm-specifier resolve / lockfile drift),
  - таймаут импорта shared-модулей,
  - устаревший deploy artefact (зависший после неудачного предыдущего деплоя).

Точную причину покажет рядовой redeploy + первый же успешный/падающий boot-лог. Проще всего — пересобрать функцию (тот же код, без изменений) и снять boot-ошибку из edge logs первой попытки.

**Secondary (исторический, не связан с boot):** функция никогда не обновляла `telegram_clubs.last_members_sync_at`. UI/диагностика смотрит на это поле, поэтому «sync стоит с марта» воспринимается как полный простой — на деле до 2026-04-13 функция работала и обновляла `last_status_check_at` + member-ы.

**Tertiary (потенциальный, после починки boot):** при ~1285 member-ах функция упрётся в edge timeout (нет cursor/resumability). До boot-фикса этот риск не материализуется, но в repair-плане учтён.

**Quaternary (UI):** карточка контакта показывает один «случайный» клуб вместо всех действующих (видно на скрине Королёвой — отображается только «Бухгалтерия как бизнес», хотя клубов 2). Это отдельный фикс на фронте, не зависит от cron.

---

## Patch-plan (отдельной задачей, ничего сейчас не выполняется)

### P1 — починить boot (приоритет максимальный)
1. Передеплоить `telegram-cron-sync` без изменений → снять первый boot-лог.
2. Если в логах увидим конкретный resolve-error (npm/shared) — точечно починить (зафиксировать `npm:@supabase/supabase-js@2.x.y`, проверить `_shared/accessValidation.ts` на наличие deno-runtime-only импортов).
3. Подтвердить: после деплоя `pg_net` начинает получать `200`, в edge-логах появляется `Starting Telegram cron sync...`.

### P2 — `last_members_sync_at` writeback
- В конце функции, после успешного прохода по клубу, обновлять `telegram_clubs.last_members_sync_at = now()` (сейчас обновляется только `last_status_check_at`).
- Без этого UI продолжит показывать «sync с марта» даже на работающей функции.

### P3 — cursor / батч-resume
- Перейти на partial-pass: в одном edge-вызове обрабатывать N member-ов (например, 200), сохранять `last_processed_member_id` в `telegram_clubs.meta` и завершаться задолго до edge-timeout (60–120 сек).
- Cron оставить ежечасным; функция будет делать 6–7 проходов в час, полный цикл по ~1285 member-ам пройдёт за <2 часов даже при текущих delay.
- Telegram rate limit (`getChatMember` ~30 r/s) текущими 100ms delay не нарушается — отдельный throttle не нужен.

### P4 — UI карточки контакта (отдельный фронтовый PR)
- В `Telegram`-секции карточки выводить **все** активные `telegram_clubs`, к которым у контакта есть `telegram_club_members`-запись, а не один.
- На каждый клуб: бейдж `В клубе / Не в клубе / Ошибка проверки / Требует проверки (last_telegram_check_at старше N часов)`, время последней проверки, ссылка на клуб.
- Никаких изменений серверной логики не требует.

### Что НЕ делаем в P1–P4
- Не отправляем invite, не создаём queue, не дёргаем `telegram-grant-access`.
- Не трогаем `subscription_grant_telegram` trigger (остаётся DISABLED, см. core memory).
- Не расширяем `telegram_access_queue` allowlist source-ов.

---

## Что было сделано в этой задаче

- ✅ read-only diagnose (cron, pg_net, edge logs, код функции, данные);
- ✅ proof сохранён по пути `.lovable/proofs/telegram_cron_sync_diagnosis_2026_05.md`;
- ❌ ничего не менялось в БД/функциях/cron/UI.

Жду approve по приоритету patch-plan: начинать с **P1 (redeploy + boot-лог)** или сразу комбо **P1 + P2 + P4 (UI всех клубов)**.
