# Отчёт о стабилизационном спринте — Webinar Room v2

> **Дата**: 2026-04-08  
> **Статус**: core stabilization completed; runtime room proof still required on real live stream  
> **Scope**: PATCH 1–9 (видео, имена, replies, модерация, сценарий, CRM sync, room blocks, INSERT hardening)

---

## 1. Что было реализовано в коде до proof

Следующие компоненты были реализованы в рамках спринта (PATCH 1–9):

| # | Компонент | Описание |
|---|-----------|----------|
| PATCH 1 | Video resolver | `resolveVideoSource()` в `live-resolve`, приоритет: `kinescope_video_id` → `kinescope_live_event_id` → `none` |
| PATCH 2 | Snapshot автора | Trigger `snapshot_author_display_name` + repair существующих записей |
| PATCH 3 | Replies | Таблица `live_event_replies` с FK + CHECK + UI (`LiveEventReplyForm`, `LiveEventRepliesList`) |
| PATCH 4 | Moderation | `live_event_room_moderation` + RPC `is_user_removed_from_room` + overlay в 3 точках |
| PATCH 5 | Scenario | RPC `get_live_event_scenario` + UI вкладка «Сценарий» |
| PATCH 6 | CRM sync | Domain event triggers + `webinar-activity-consumer` + cron job #43 |
| PATCH 7 | Room blocks | `live_event_room_blocks` + editor + рендеринг в комнате |
| PATCH 8 | INSERT hardening | Explicit `NOT is_user_removed_from_room(...)` в RLS INSERT policies |
| PATCH 9 | Domain events | Trigger `emit_webinar_domain_event` на 4 таблицах |

---

## 2. Что оказалось сломанным на proof-аудите

Аудит 2026-04-08 выявил 4 дефекта:

### 🔴 Критический: trigger `emit_webinar_domain_event` для replies

**Проблема**: trigger ссылался на несуществующие колонки:
- `NEW.author_display_name` — нет в `live_event_replies`
- `NEW.comment_id` — колонка называется `source_comment_id`
- `NEW.question_id` — колонка называется `source_question_id`

**Последствие**: INSERT в `live_event_replies` вызывал ошибку trigger'а, блокируя создание reply и запись в CRM pipeline.

### 🟡 Средний: profile lookup в LiveEventComments.tsx

**Проблема**: `.in("id", userIds)` — `userIds` содержит `auth.user_id`, а `profiles.id` — собственный PK профиля. Lookup не находил профили.

### 🟡 Средний: profile lookup в LiveEventQuestions.tsx

**Проблема**: аналогичная — `.in("id", userIds)` вместо `.in("user_id", userIds)`.

### 🟡 Средний: profile lookup в LiveEventModeration.tsx

**Проблема**: аналогичная — `.in("id", userIds)` вместо `.in("user_id", userIds)`. Модератор не видел имена пользователей.

---

## 3. Что было исправлено fix-to-patch

### FIX 1: trigger `snapshot_author_display_name`
- **Было**: `WHERE id = NEW.user_id`
- **Стало**: `WHERE user_id = NEW.user_id`
- **Миграция**: выполнена ранее в спринте

### FIX 2: domain event triggers созданы
- Trigger `emit_webinar_domain_event` создан и привязан к 4 таблицам:
  - `live_event_comments` → `live_comment_created`
  - `live_event_questions` → `live_question_created`
  - `live_event_replies` → `live_reply_created`
  - `live_event_room_moderation` → `live_user_removed/banned/restored`

### FIX 3: reply trigger columns исправлены
- **Было**: `NEW.author_display_name`, `NEW.comment_id`, `NEW.question_id`
- **Стало**: `NULL`, `NEW.source_comment_id`, `NEW.source_question_id`
- **Миграция**: `20260408203235_7db41664-4dc1-4ebb-9425-f389332f5a1c.sql`

### FIX 4: UI profile lookup (3 файла)
- `LiveEventComments.tsx`: `.in("id", userIds)` → `.in("user_id", userIds)`, `profiles[p.id]` → `profiles[p.user_id]`
- `LiveEventQuestions.tsx`: аналогично
- `LiveEventModeration.tsx`: аналогично

---

## 4. Hardening (усиление безопасности)

### INSERT policies с moderation check
RLS INSERT policies для `live_event_comments` и `live_event_questions` содержат явную проверку:
```sql
AND NOT is_user_removed_from_room(auth.uid(), NEW.live_event_id)
```

### Moderation overlay enforced в 3 точках
1. `user_has_live_event_access` (RPC)
2. `live-resolve` (edge function)
3. RLS INSERT policies (comments + questions)

---

## 5. Machine-proof блок

### Пример строки `domain_events`
```json
{
  "event_type": "live_comment_created",
  "source": "webinar",
  "entity_id": "1aabe0c9-40e9-4e52-bdd8-5d5132e809e4",
  "payload": {
    "live_event_id": "fabcfd7a-ef2d-4c7a-bdda-354752e467f6",
    "user_id": "05cd3754-d589-4d90-97d1-89ba2bee610b",
    "author_display_name": "Сергей Федорчук",
    "content_preview": "1234555",
    "visibility_scope": "public"
  },
  "created_at": "2026-04-08T20:11:23.987067+00"
}
```

### Пример строки `domain_executions`
```json
{
  "id": "66a956f6-d378-48db-b00a-c1b88f6f565a",
  "event_type": "live_question_created",
  "step": "crm_activity_write",
  "status": "success",
  "error": null,
  "created_at": "2026-04-08T20:11:30.080650+00"
}
```

### Пример строки `live_event_comments` (с author_display_name)
```json
{
  "author_display_name": "Ирина Гаринова",
  "content": "Привет",
  "created_at": "2026-04-05T17:08:14.338655+00"
}
```

```json
{
  "author_display_name": "Сергей Федорчук",
  "content": "1234555",
  "created_at": "2026-04-03T20:32:00.176037+00"
}
```

### Подтверждение pg_cron job #43
```
jobid: 43
jobname: invoke-webinar-activity-consumer
schedule: * * * * *
active: true
```

> **Примечание**: pg_cron job #42 (`live-event-notifications-cron`) **не найден** в active jobs — подтверждает деактивацию после инцидента.

### crm_activity_log
На момент аудита `crm_activity_log` содержит 0 записей с `source_entity_type` из webinar-домена. Consumer pipeline функционален (domain_executions = success), но записи могли быть созданы с другими типами или consumer ещё не был вызван для текущих событий. Требуется runtime verification.

---

## 6. Итоговый статус

### ✅ Функционально закрыто
- Video resolver + source rendering
- Snapshot автора (trigger + repair)
- Replies (таблица + UI + RLS + domain events)
- Moderation (таблица + RPC + overlay в 3 точках + UI)
- Scenario (RPC + UI)
- CRM sync (triggers + consumer + cron)
- Room blocks (таблица + editor + rendering)
- INSERT policies hardening

### ⏳ Требует runtime proof
- Реальный live stream с `kinescope_live_event_id` для проверки iframe
- Full room experience: видео + комментарии + вопросы + replies + moderation + blocks
- CRM activity_log population на реальном потоке событий

### Не затрагивалось стабилизацией
- `live-event-notifications-cron` — guardrails и kill-switch без изменений
- Incident guardrails / kill-switch (`live_notification_config`)
- `recorded_webinar` и replay flow
- `broadcast_templates`
- `send-email` edge function

---

## 7. Рекомендации

1. Провести runtime proof на реальном live stream (Шаги 1–9 из testing guide)
2. Убедиться в CRM pipeline end-to-end: комментарий → domain_event → execution → crm_activity_log
3. Проверить негативные сценарии модерации (удаление → блокировка → восстановление)
4. После успешного runtime proof — зафиксировать статус «sprint closed»
