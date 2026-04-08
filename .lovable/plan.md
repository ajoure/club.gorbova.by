да, согласен, с учетом правок:

&nbsp;

1. В PATCH A добавь one-shot repair для уже существующих live_event_comments и live_event_questions, где author_display_name IS NULL, иначе старые записи так и останутся с fallback “Пользователь”. Делать только для пустых snapshot-полей, без перезаписи уже заполненных значений.
2. В PATCH B зафиксируй явно, что emit_webinar_domain_event() пишет в domain_events поля в формате, совместимом с уже существующим consumer:  

  - source = 'webinar'
  - event_type строго из согласованного списка
  - entity_id = UUID исходной записи
  - payload содержит live_event_id, user_id/created_by, author_display_name, content_preview/reply_preview, visibility_scope, action_type
3. &nbsp;
4. В PATCH B добавь idempotent scheduling:  

  - если cron job для webinar-activity-consumer уже существует, не создавать дубль;
  - если не существует — создать один job;
  - в proof показать jobid, schedule, active.
5. &nbsp;
6. В PATCH B добавь machine-proof по pipeline целиком, а не только domain_events и crm_activity_log:  

  - есть запись в domain_events
  - есть запись в domain_executions
  - есть запись в crm_activity_log
  - idempotency_key не даёт дубль при повторном запуске consumer
7. &nbsp;
8. В PATCH C правильно пометь как hardening, а не как критический дефект. Функционально moderation уже работает через user_has_live_event_access, здесь цель — сделать защиту явной и не зависящей только от внутренней логики RPC.
9. В PATCH D добавь две проверки имени автора:  

  - новый комментарий создаётся сразу с заполненным author_display_name
  - repaired старая запись тоже получает имя после one-shot repair
10. &nbsp;
11. В финальном отчёте раздели результат на 3 части:  

  - что исправлено критически;
  - что усилено как hardening;
  - какие runtime-proof получены.
12. &nbsp;

&nbsp;

&nbsp;

В остальном патч правильный:

сначала repair trigger + event pipeline, затем hardening policy, затем proof по всей цепочке.

&nbsp;

# План: Fix-to-Patch — исправление 2 критических дефектов + hardening + runtime proof

---

## Подтверждённые дефекты (SQL proof выполнен)

### 🔴 Критический 1: Trigger `snapshot_author_display_name` — неверный lookup

- **Proof:** `WHERE id = NEW.user_id` → всегда 0 строк, потому что `profiles.id` ≠ `profiles.user_id`
- **Результат:** `author_display_name` = NULL для всех новых записей → fallback "Пользователь"

### 🔴 Критический 2: CRM sync pipeline не работает

- **Proof:** 0 triggers на webinar-таблицах для emit в `domain_events`; 0 записей в `domain_events WHERE source='webinar'`
- **Результат:** вся цепочка `comment → domain_events → consumer → crm_activity_log` мёртвая
- Consumer edge function написана корректно, но нечего обрабатывать и никто его не вызывает

### 🟡 Hardening: INSERT policies comments/questions

- **Proof:** `user_has_live_event_access` уже содержит `AND NOT is_user_removed_from_room(...)` → функционально работает
- **Действие:** добавить explicit check для архитектурной ясности (не blocker)

---

## PATCH A — Исправить trigger snapshot автора

**Миграция:** заменить функцию `snapshot_author_display_name`:

```sql
WHERE id = NEW.user_id  →  WHERE user_id = NEW.user_id
```

Одна строка в `CREATE OR REPLACE FUNCTION`.

---

## PATCH B — Создать domain event triggers + scheduling consumer

**Миграция:** создать функцию `emit_webinar_domain_event()` и привязать AFTER INSERT triggers к:

- `live_event_comments` → `live_comment_created`
- `live_event_questions` → `live_question_created`
- `live_event_replies` → `live_reply_created`
- `live_event_room_moderation` → event_type по `action_type` (removed/banned/restored)

Payload включает: `live_event_id`, `user_id`/`created_by`, `content_preview` (первые 200 символов), `visibility_scope`, `author_display_name`, `action_type`.

**Scheduling:** pg_cron job каждые 60 секунд вызывает `webinar-activity-consumer` через `pg_net.http_post`. Использовать существующий паттерн из проекта.

---

## PATCH C — Explicit moderation в INSERT policies

**Миграция:** DROP + CREATE policies для comments и questions INSERT:

```sql
WITH CHECK (
  auth.uid() = user_id
  AND user_has_live_event_access(auth.uid(), live_event_id)
  AND NOT is_user_removed_from_room(auth.uid(), live_event_id)
)
```

Функционально дублирует overlay из `user_has_live_event_access`, но делает intent явным.

---

## PATCH D — Runtime proof

После применения PATCH A–C:

1. Вызвать `webinar-activity-consumer` через curl и показать response
2. SQL proof: `domain_events WHERE source='webinar'` (после тестового комментария)
3. SQL proof: `crm_activity_log` записи
4. SQL proof: `author_display_name` в новых comments

---

## Файлы и объекты изменений


| Что                              | Тип                                   |
| -------------------------------- | ------------------------------------- |
| 1 SQL миграция (PATCH A + B + C) | DB migration                          |
| 1 SQL insert (pg_cron schedule)  | Data insert                           |
| 0 файлов кода                    | Без изменений frontend/edge functions |


## Что не затрагивается

- `live-resolve`, `LiveEvent.tsx`, replay, recorded_webinar, notification guardrails — без изменений
- `webinar-activity-consumer` edge function — уже корректна, не трогаем
- `user_has_live_event_access` — уже содержит overlay, не трогаем