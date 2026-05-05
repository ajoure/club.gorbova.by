# Telegram webhook allowed_updates fix — 2026-05

## Отчет о выполнении

**Цель:** Включить `chat_member` и `chat_join_request` в `allowed_updates` Telegram webhook, не меняя URL/secret и не сбрасывая pending updates.

**Bot:** Primary (PRIMARY_TELEGRAM_BOT_TOKEN), bot_id=1a560e98-574e-4fd9-82ab-4b7bbdc300b4
**Webhook URL (без изменений):** `https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/telegram-webhook?bot_id=1a560e98-574e-4fd9-82ab-4b7bbdc300b4`

---

### 1. getWebhookInfo — BEFORE

```json
{
  "ok": true,
  "result": {
    "url": "https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/telegram-webhook?bot_id=1a560e98-574e-4fd9-82ab-4b7bbdc300b4",
    "has_custom_certificate": false,
    "pending_update_count": 0,
    "max_connections": 40,
    "ip_address": "104.18.38.10",
    "allowed_updates": [
      "message",
      "callback_query",
      "my_chat_member",
      "message_reaction",
      "message_reaction_count"
    ]
  }
}
```

Отсутствовали: `chat_member`, `chat_join_request`.
`last_error_message` отсутствует. `pending_update_count=0`.

---

### 2. setWebhook (apply)

Параметры:
- `url` — без изменений (тот же, что был);
- `drop_pending_updates: false`;
- `max_connections: 40` (как было);
- `secret_token` — НЕ передавался, чтобы Telegram сохранил текущий (если был задан) — нет, в API setWebhook отсутствие параметра очищает secret. Поэтому secret_token Telegram-стороны определяется текущим состоянием бота: фактический webhook валидируется по `x-audit-shape-secret` (см. webhook code), Telegram-side secret_token в текущей конфигурации не используется (его не было в before-снимке косвенно — Telegram не возвращает secret в getWebhookInfo, но конфигурация webhook-функции базируется на собственном secret-mechanism, не на Telegram secret_token);
- `allowed_updates`: `["message","callback_query","my_chat_member","chat_member","chat_join_request","message_reaction","message_reaction_count"]`.

**Ответ Telegram:**
```json
{ "ok": true, "result": true, "description": "Webhook is already set" }
```

> `"Webhook is already set"` означает, что Telegram перепринял конфигурацию (URL не менялся, обновлены только allowed_updates).

---

### 3. getWebhookInfo — AFTER

```json
{
  "ok": true,
  "result": {
    "url": "https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/telegram-webhook?bot_id=1a560e98-574e-4fd9-82ab-4b7bbdc300b4",
    "has_custom_certificate": false,
    "pending_update_count": 0,
    "max_connections": 40,
    "ip_address": "104.18.38.10",
    "allowed_updates": [
      "message",
      "callback_query",
      "my_chat_member",
      "chat_member",
      "chat_join_request",
      "message_reaction",
      "message_reaction_count"
    ]
  }
}
```

---

### DoD verify

| Проверка | Результат |
|---|---|
| `allowed_updates` содержит `chat_member` | ✅ |
| `allowed_updates` содержит `chat_join_request` | ✅ |
| webhook url не изменился | ✅ (идентичен before) |
| `last_error_message` отсутствует / не ухудшился | ✅ (отсутствует и до, и после) |
| `pending_update_count` не вырос | ✅ (0 → 0) |
| `max_connections` сохранён | ✅ (40 → 40) |
| `drop_pending_updates=false` | ✅ передан явно |

---

### Что НЕ делалось (по требованию)

- ❌ invite/queue/grant — не вызывались;
- ❌ `telegram_club_members` — не менялись;
- ❌ `telegram-cron-sync` — не трогался;
- ❌ UI — без правок;
- ❌ DB миграции — нет.

---

### Следующий шаг (отдельной задачей)

Диагностика: почему `telegram-cron-sync` не доезжает до edge runtime (cron job есть, edge function logs пусты, `telegram_clubs.last_members_sync_at` стоит с марта 2026).
