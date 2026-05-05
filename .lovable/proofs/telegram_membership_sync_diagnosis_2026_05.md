# Telegram membership sync — read-only diagnosis (2026-05-05)

Scope: только read-only. Никаких write, setWebhook, миграций, queue items, изменений `telegram_club_members` не выполнялось.

Bot: `@gorbovabybot` (id `8145684416`, uuid `1a560e98-574e-4fd9-82ab-4b7bbdc300b4`).
Token: `PRIMARY_TELEGRAM_BOT_TOKEN`.

## 1. Active clubs

| club_id | club_name | chat_id | channel_id | bot |
|---|---|---|---|---|
| `4f8f9d8f-07ce-4898-8012-39f1035c1456` | Бухгалтерия как бизнес | `-1003707939536` | (нет) | gorbovabybot |
| `fa547c41-3a84-4c4f-904a-427332a0506e` | Gorbova Club | `-1001686262735` | `-1001791889721` | gorbovabybot |

`telegram_clubs.last_members_sync_at` для обоих = **2026-03-13** — не двигался ~2 месяца.

## 2. Bot rights (`getChatMember(chat_id, bot_id)`)

| Клуб / ресурс | Status | can_invite_users | can_restrict_members | can_manage_chat |
|---|---|---|---|---|
| Бухгалтерия / chat | **administrator** | ✅ | ✅ | ✅ |
| Gorbova Club / chat | **administrator** | ✅ | ✅ | ✅ |
| Gorbova Club / channel | **administrator** | ✅ | ✅ | ✅ |

Бот — admin везде. `chat_member` события *могут* приходить, но это требует включения в `allowed_updates` (см. п.3).

## 3. `getWebhookInfo`

```json
{
  "url": "https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/telegram-webhook?bot_id=1a560e98-574e-4fd9-82ab-4b7bbdc300b4",
  "has_custom_certificate": false,
  "pending_update_count": 0,
  "max_connections": 40,
  "ip_address": "104.18.38.10",
  "allowed_updates": ["message","callback_query","my_chat_member","message_reaction","message_reaction_count"],
  "last_error_message": null,
  "last_error_date": null
}
```

Критично:
- `chat_member` **отсутствует** в `allowed_updates` → Telegram **не шлёт** событие при join/leave обычного пользователя в чат/канал. Это значит, что обработчик `update.chat_member` в `telegram-webhook/index.ts` (строки 1426–1593), который ставит `in_chat=true / verified_in_chat_at`, **никогда не срабатывает**.
- `chat_join_request` **отсутствует** → join-request flow тоже не приходит. У клубов `join_request_mode` стоит — но фактически Telegram события не шлёт.
- `pending_update_count=0`, `last_error_message=null` — webhook здоров, но «слепой» к нужным событиям.

## 4. Cron status (read-only, без изменений)

Активные cron-jobs (`cron.job`):

| jobid | jobname | schedule | active |
|---|---|---|---|
| 5 | telegram-club-sync-hourly | `0 * * * *` | ✅ |
| 3 | telegram-check-expired-hourly | `0 * * * *` | ✅ |
| 6 | telegram-kick-violators-hourly | `0 * * * *` | ✅ |
| 31 | telegram-access-queue-processor | `* * * * *` | ✅ |
| 34 | telegram-reinvite-ghosts | `0 */6 * * *` | ✅ |

`cron.job_run_details` (последние 24ч, jobid=5): **все runs `succeeded` за 13–121 ms**. Это длительность `pg_net.http_post` fire-and-forget, не самой edge function. Реального ответа от `telegram-cron-sync` cron не ждёт.

`function_edge_logs` за последние 30 telegram-* вызовов: вызовов `telegram-cron-sync` **нет ни одного**. Видны только `telegram-process-access-queue`, `telegram-media-worker-cron` (401), `telegram-admin-chat`. Это значит: либо cron-вызов до edge function не доходит, либо ответ функции не доезжает до log-сборщика (вероятнее — функция падает в холодном старте/просто не запускается).

Cron job-5 `command`:
```sql
SELECT net.http_post(
  url := 'https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/telegram-cron-sync',
  headers := jsonb_build_object(
    'Content-Type','application/json',
    'Authorization','Bearer eyJ...anon...'
  ),
  body := jsonb_build_object('source','pg_cron','time', now())
);
```
Использует **anon JWT**, а функция в `supabase/config.toml` указана с `verify_jwt = false`, так что 401 не ожидается. Тем не менее — в edge logs запросов нет. Требует отдельного диагностического запуска (вне scope).

## 5. Membership sample (10 пользователей)

Выборка: `in_chat=false AND invite_status='sent' AND access_status='ok' AND telegram_user_id IS NOT NULL AND profile_id IS NOT NULL` (top-10 по `invite_sent_at desc`).

| # | profile_id | tg username | tg_user_id | club | db_in_chat | api_chat_status | db_in_channel | api_channel_status | db_invite_status | conclusion |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `4e8834a5…d6e9` | (нет) | 1337365629 | Gorbova Club | false | **member** | false | **member** | sent | **SYNC_BUG** |
| 2 | `c35b7eec…b16b` | YuliyaYarmots | 572606900 | Gorbova Club | false | **member** | false | left | sent | **SYNC_BUG (chat)** |
| 3 | `f75edd5b…f80` | julia19870524 | 1312198533 | Gorbova Club | false | **member** | false | **member** | sent | **SYNC_BUG** |
| 4 | `a61b9879…be5` | Iris_Fess | 455888549 | Бухгалтерия | false | left | true | n/a | sent | real_not_member (но `db_in_channel=true` — призрачный, у клуба нет channel) |
| 5 | `cb49e9db…ed8a` | sarotnik1985 | 1306295892 | Gorbova Club | false | **member** | false | **member** | sent | **SYNC_BUG** |
| 6 | `6f388484…c98f` | anastasiya_hzarko | 1187092793 | Gorbova Club | false | **member** | false | **member** | sent | **SYNC_BUG** |
| 7 | `50e7ce85…a2ac` | svdeschenya | 527926320 | Gorbova Club | false | **member** | false | left | sent | **SYNC_BUG (chat)** |
| 8 | `e3a2744b…8971` | iryna_troinich | 1006808188 | Бухгалтерия | false | **member** | true | n/a | sent | **SYNC_BUG** |
| 9 | `a42ac6b9…24e9` | Natallia_VN | 587978075 | Gorbova Club | false | **member** | false | **member** | sent | **SYNC_BUG** |
| 10 | `5269631e…d43b7e` | ShuS22131 | 784608431 | Gorbova Club | false | **member** | false | **member** | sent | **SYNC_BUG** |

Сводка:
- `mismatch_chat`: **9 / 10**
- `mismatch_channel` (где есть channel_id): **6 / 8**
- Реально в чате по Telegram API: **9 / 10**
- Реально не в чате: 1 (Iris_Fess) — `real_not_member`, но при этом `db_in_channel=true`, хотя у клуба «Бухгалтерия» channel_id отсутствует → ещё один артефакт старой синхронизации.

## 6. invite_status — допустимые значения

`telegram_club_members.invite_status` — `text`, **CHECK-констрейнтов нет** (`pg_constraint` на этой таблице — только PK/FK/UNIQUE). Текущие значения в БД: `sent` (231) и `NULL` (1054). Перевод в `'member'` после фактического подтверждения membership возможен без миграции.

## 7. Root causes

A. **Webhook слеп к `chat_member` / `chat_join_request`** — `allowed_updates` не содержит этих типов. Обработчики в коде есть и работают корректно, но Telegram их не присылает. Это объясняет, почему `verified_in_chat_at`/`last_verified_at` у большинства = NULL.

B. **`telegram-cron-sync` фактически не выполняется** — `last_members_sync_at` обоих клубов застрял на 2026-03-13; в edge logs за свежий период нет ни одного вызова функции; cron триггерит pg_net fire-and-forget, ответ не проверяется. Нужна отдельная диагностика (ручной curl, проверка cold-start ошибок) — вне scope этого read-only шага.

C. **Анти-инварианты данных**: у Iris_Fess (Бухгалтерия) стоит `db_in_channel=true`, хотя у клуба channel_id = NULL. Это указывает на то, что в прошлом данные обновлялись скриптом, не учитывающим конфигурацию клуба.

D. (производное) `invite_status='sent'` залипает у пользователей, которые фактически вошли — потому что оба источника обновления статуса (A и B) сейчас не работают.

## 8. DoD

- [x] 10 пользователей сравнены, mismatch найден у 9 из 10.
- [x] `getWebhookInfo` снят, `allowed_updates` зафиксированы.
- [x] Права бота проверены — admin во всех чатах/канале.
- [x] cron-jobs перечислены, `last_members_sync_at` зафиксирован.
- [x] Никаких write-операций, queue items, setWebhook, миграций, UI-правок не выполнялось.

## 9. Что НЕ делалось (явный whitelist запретов)

- bulk re-invite — не выполнялся;
- queue items — не создавались;
- `setWebhook` — не вызывался;
- cron — не менялся;
- ALTER TABLE / миграции — не выполнялись;
- UI карточки контакта — не правилась;
- `telegram_club_members` — не менялась.

## 10. Рекомендации к следующему шагу (на отдельный approve)

Ничего не выполнять без отдельного approve по каждому пункту:

1. Добавить `chat_member` и `chat_join_request` в `allowed_updates` через `setWebhook` (write).
2. Отдельно отдиагностировать, почему `telegram-cron-sync` не виден в edge logs (ручной curl, проверка ответа функции, cold-start).
3. После того как webhook+cron будут двигать поля, повторить выборку из п.5 и убедиться, что mismatch ушёл.
4. UI карточки контакта показывать статус по **всем** активным клубам (а не по одному), как просил пользователь — отдельным UI-патчем после стабилизации данных.
5. Перевод `invite_status → 'member'` при подтверждённом membership — допустим без миграции (text без CHECK).
