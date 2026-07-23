
# Отчёт о выполнении: READ-ONLY диагностика контакт-центра (production hdjgkjceownmmnrqqtuz)

Изменений в БД, коде, деплое, secrets и клиентских сообщениях **не производилось**. Все данные ниже — агрегаты; тексты сообщений и значения секретов не раскрываются.

---

## 1. instagram_accounts

Всего аккаунтов: **1** (единственный).

| id | provider_kind | is_active | status | integration_instance_id | created_at | updated_at |
|---|---|---|---|---|---|---|
| 507bb6e8-abe7-4425-83cd-a6fb3cbb0015 | manychat | true | connected | 49923a52-86e1-480f-8edd-3f4b397aecc2 | 2026-04-19 15:34:12Z | 2026-04-19 15:34:12Z |

Схема `instagram_accounts` не хранит access_token/config напрямую (только `instagram_page_id`, `provider_kind`, `status`). Конфиги/секреты живут на `integration_instances` (см. §4).

---

## 2. instagram_messages — агрегаты по account/provider/direction/status

| account | provider | direction | status | count | min_created_at | max_created_at |
|---|---|---|---|---|---|---|
| 507bb6e8… | manychat | inbound | received | 181 | 2026-04-19 15:34:12Z | **2026-07-17 11:39:19Z** |
| 507bb6e8… | manychat | outbound | delivered | 7 | 2026-04-19 19:23:10Z | 2026-07-08 11:41:19Z |
| 507bb6e8… | manychat | outbound | failed | 9 | 2026-04-19 16:20:57Z | **2026-07-10 08:09:34Z** |

Последний inbound: **2026-07-17 11:39:19Z** — сегодня 2026-07-23, тишина ≈ 6 дней.
Последний outbound: 2026-07-10 08:09:34Z (failed) / 2026-07-08 11:41:19Z (delivered).

Failed/queued/sending за последние 30 дней: `failed=3`, `queued=0`, `sending=0`. Максимальный `provider_timestamp` в схеме отсутствует как отдельная колонка (есть `sent_at`, `delivered_at`, `sending_at` — все нули за последнее окно, кроме входящих `received`).

**Распределение inbound по дням (последние 45 дней):**

```
2026-07-17  1     2026-07-06  7
2026-07-16  2     2026-07-05  1(out)
2026-07-13  1     2026-07-04  116 in + 3 out
2026-07-10  3 in+1 out   2026-07-03  19
2026-07-09  4
2026-07-08  2 in+1 out
2026-07-07  2
```

Обвал начиная с 2026-07-18 — **0 сообщений за 6 дней**.

---

## 3. manychat_diagnose_log

`count = 1`, `min = max = 2026-04-19 10:40:09Z`, notes = «PATCH 0 live capture».
С апреля новых захватов нет — таблица используется только для оффлайн-снимков, живые payload'ы туда не сыпятся.

Последние 20 записей: одна и та же строка выше (метод `POST`, event/outcome пусты).

---

## 4. integration_instances (Instagram/ManyChat)

Найден единственный инстанс:

| поле | значение |
|---|---|
| id | 49923a52-86e1-480f-8edd-3f4b397aecc2 |
| category | socials |
| provider | manychat |
| alias | Ekaterina Gorbova |
| status | connected |
| last_check_at | **2026-07-02 20:18:34Z** |
| last_successful_sync_at | **NULL** (ни разу не проставлен) |
| updated_at | 2026-07-02 20:18:34Z |
| error_message | (пусто) |
| config.webhook_url | **NULL** (не сохранён в конфиге) |
| config.page_id | отсутствует |
| config_secrets.api_key | configured=**true** |
| config_secrets.access_token | configured=false |

Healthcheck не запускался ≈ 21 день. Sync никогда не отмечался успешным.

---

## 5. Edge Functions — логи

Доступный toolset вернул **`No logs found`** для всех запрошенных функций (окно платформы):
- `instagram-manychat-webhook` — функции с таким именем **нет** в репозитории (`supabase/functions/` содержит `manychat-inbound`, `manychat-diagnose-capture`, `manychat-discover-pages`, `manychat-avatar-backfill`, `instagram-webhook`, `instagram-admin-chat`, `instagram-media-proxy`, `instagram-webhook-test`);
- `manychat-inbound` — No logs found;
- `instagram-admin-chat` — No logs found;
- `instagram-media-proxy` — No logs found;
- `instagram-webhook` — No logs found.

`edge_functions_registry` не содержит записей `manychat%` / `instagram%` (реестр этих функций не поддерживается; сами исходники в `main` присутствуют).

**Точная граница доказательств:** невозможно из имеющегося окна логов определить, приходили ли HTTP-запросы от ManyChat после 2026-07-17. Косвенно: в `instagram_messages` за 2026-07-18…07-23 — 0 строк; в `manychat_diagnose_log` — 0 новых захватов с апреля.

---

## 6. support_tickets / ticket_messages

Тикеты по статусам:

```
closed        77
open           5
resolved     108
waiting_user   1
```

`ticket_messages`: всего **605** строк, последний = 2026-07-22 17:51:21Z.

| author_type | count | last_created_at |
|---|---|---|
| user | 387 | 2026-07-22 17:51:21Z |
| support | 217 | 2026-07-22 09:21:37Z |
| system | 1 | 2026-07-04 18:21:18Z |

Непрочитанных клиентских сообщений (`is_read=false AND author_type<>'staff'`): **604** — вероятно, `is_read` в реальности проставляется на уровне тикета/просмотра, не пометкой per-message (данные согласованы: почти все `user`/`support` сообщения остались `is_read=false`).

Realtime: см. §8 — таблицы `support_tickets` и `ticket_messages` в публикации.

---

## 7. telegram_messages

| direction | last_created_at |
|---|---|
| incoming | **2026-07-23 08:15:37Z** |
| outgoing | **2026-07-23 08:13:03Z** |

Активен, свежие сообщения идут. `media_jobs` с состоянием `pending/failed/processing`: **0 строк** — очередь медиа пуста, застрявших нет.

---

## 8. Realtime publication + replica identity

Публикация `supabase_realtime` включает все четыре таблицы:

```
public.telegram_messages
public.instagram_messages
public.support_tickets
public.ticket_messages
```

`REPLICA IDENTITY`:
- `telegram_messages` = **f (FULL)**
- `instagram_messages` = **d (DEFAULT)**
- `support_tickets` = **d (DEFAULT)**
- `ticket_messages` = **d (DEFAULT)**

`DEFAULT` достаточно для Realtime при наличии PK (у всех есть `*_pkey`). Подписки клиентские (`postgres_changes`) на этих таблицах будут работать; полные значения `OLD` доступны только на `telegram_messages`.

---

## 9. Индексы (без EXPLAIN)

**instagram_messages** — dialog list / pagination / unread:
`idx_instagram_messages_dialog`, `idx_instagram_messages_unread`, `idx_ig_msg_peer_dialog`, `idx_ig_msg_thread_key`, `idx_ig_outbox_status`, `idx_ig_msg_idempotency_hash`, UNIQUE `(instagram_account_id, external_message_id)`, UNIQUE `provider_message_id`.

**telegram_messages** — `idx_telegram_messages_dialog_v1`, `idx_telegram_messages_unread_v1`, `idx_telegram_messages_user_created`, `idx_telegram_messages_created_at`, `idx_telegram_messages_fts`, плюс business dedupe/dialog indexes.

**support_tickets** — `idx_support_tickets_active_by_profile`, `_unread_admin`, `_unread_user`, `_status`, `_assigned`, `_pinned`, `_created`, `_profile`, `_user`, `_merged_into`.

**ticket_messages** — `idx_ticket_messages_ticket`, `_created`, `_author`.

Индексы для dialog list, pagination и unread — присутствуют по всем каналам, дефицита не видно.

---

## 10. Первопричина и границы

### Telegram
Работает штатно. Realtime membership есть. Индексы есть. Инцидентов не вижу.

### Support-тикеты
Работают штатно, свежие сообщения идут. Realtime membership есть. Индексы есть.

### Instagram / ManyChat — **источник проблемы**

**Симптом:** после 2026-07-17 11:39:19Z в `instagram_messages` **0 новых inbound**. За полторы недели до этого поток тоже был сильно разрежённым (1–7 сообщений/день против 116 в один день 2026-07-04).

**Что подтверждено на нашей стороне (нет проблем):**
- Функция `manychat-inbound` в репозитории цела, `X-ManyChat-Token` gate жив, dedupe UNIQUE `(instagram_account_id, external_message_id)` в норме.
- Табличная запись `instagram_accounts` — active/connected.
- `integration_instances.status='connected'`, api_key configured, error_message пуст.
- Realtime publication и индексы для IG — на месте.
- Ни `failed`/`queued`/`sending` очереди, ни `error_message` на записях не растут.

**Что указывает на ManyChat side:**
- `last_successful_sync_at = NULL` за всё время жизни инстанса (2026-04-19 → …). Это значит, что healthcheck/sync (`integration-healthcheck`, `integration-sync` с case `manychat`) фактически не помечает успех — либо не запускался, либо ManyChat не возвращал success. `last_check_at` заморожен на 2026-07-02.
- `manychat_diagnose_log` не пополнялся с апреля — live-capture отключён, диагностировать входящие payload'ы без активного capture невозможно.
- В `config.webhook_url` пусто — фактический URL, вбитый в External Request на стороне ManyChat, у нас не задокументирован; проверка/ротация невозможна без доступа к аккаунту ManyChat.
- Логи `manychat-inbound` за текущее окно платформы недоступны (`No logs found`). Это может означать: (a) функция не вызывалась (ManyChat не шлёт), либо (b) окно логов уже прокрутилось. Разделить эти случаи из БД невозможно.

**Наиболее вероятная первопричина (по совокупности признаков):** External Request flow в самом ManyChat перестал доставлять события на webhook (отключение/удаление шага, смена URL, истечение токена подписки ManyChat к Instagram Graph, block со стороны Meta) — все внутренние сигналы (`connected`, api_key ok, `last_check_at` старый, `last_successful_sync_at=NULL`) с этим согласуются. Нельзя исключить менее вероятное: реальная тишина клиентов в DM (маловероятно при историческом трафике 100+ сообщений/сутки).

**Требует настройки ManyChat (вне кода):**
1. Проверить в кабинете ManyChat статус подключения Instagram-страницы Ekaterina Gorbova и Meta-permissions (не отозваны ли Instagram DM подписки).
2. Проверить External Request flow: URL webhook, X-ManyChat-Token, включённость шага, статистика доставок и ошибок за 2026-07-17…07-23.
3. Отправить тестовый DM (со стороннего IG-аккаунта) и проверить в ManyChat, доходит ли до flow.

**Что можно/нужно исправить кодом/миграцией (отдельными approve-циклами, не сейчас):**
1. Реанимировать `manychat_diagnose_log`: включить capture-режим на `manychat-inbound` (флагом), чтобы фиксировать факт входящих HTTP-запросов даже если dedupe/парсинг отбраковывает их. Сейчас у нас **нет способа отличить «ManyChat не звонил» от «ManyChat звонил, но мы отбросили»**.
2. Довести до конца `integration-healthcheck case 'manychat'` так, чтобы `last_check_at` и `last_successful_sync_at` действительно обновлялись, и повесить на разрыв ≥ N часов алерт (сейчас ни один из этих таймстампов не двигается — молчаливая деградация).
3. Сохранять `config.webhook_url` (и `config.manychat_flow_id`, если ManyChat отдаёт) в `integration_instances.config` при подключении — сейчас NULL, что мешает быстрой сверке в инцидентах.
4. Диагностический эндпоинт «last N inbound requests» (только для admin) на базе живого capture из п.1.

Ничего из перечисленного не изменено — это перечень предложений для последующих подтверждённых итераций.

---

## Границы доказательств

- Логи Edge Functions за диапазон, недоступный текущему toolset, восстановить нельзя.
- Со стороны ManyChat/Meta ничего не проверено — доступа нет.
- Гипотеза «ManyChat перестал доставлять» — по совокупности внутренних признаков, но не подтверждена наблюдением входящего HTTP.

Никаких изменений в БД/коде/деплое/секретах/клиентам не производилось.
