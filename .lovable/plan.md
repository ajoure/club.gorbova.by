# да, согласен, с учетом правок:

&nbsp;

1. В [live-events-v2-architecture.md](http://live-events-v2-architecture.md) фиксируй только **фактически реализованное**. Не писать, что room blocks поддерживают form, если в текущем спринте реально доведены только button и banner. Если form есть только в схеме как future-ready — так и пометить: **schema-ready / deferred in UI**.
2. В разделе про cron разделить два job:
  &nbsp;
  - job #42 — live notifications cron, **deactivated**
  - job #43 — invoke-webinar-activity-consumer, **active**
    Это нужно указать явно, чтобы не смешать notification-инцидент и CRM consumer.
  &nbsp;
3. В разделе про live_event_notification_log и safeguards ничего не удалять. Даже если документ сейчас про stabilization sprint, нужно сохранить post-incident guardrails как часть текущей архитектуры live-domain.
4. В разделе “Триггеры” для emit_webinar_domain_event обязательно зафиксировать, что:
  &nbsp;
  - replies используют source_comment_id / source_question_id;
  - bug с неверными колонками был исправлен;
  - payload для reply отличается от comment/question.
    Иначе потом снова могут сломать trigger.
  &nbsp;
5. В разделе Access Logic добавь отдельным подпунктом:
  &nbsp;
  - moderation overlay enforced в:
    &nbsp;
    - user_has_live_event_access
    - live-resolve
    - RLS INSERT policies comments/questions
      Это нужно как явный security contract.
    &nbsp;
  &nbsp;
6. В разделе UI Structure укажи не только новые вкладки, но и что:
  &nbsp;
  - LiveEventComments.tsx, LiveEventQuestions.tsx, LiveEventModeration.tsx используют lookup профиля по profiles.user_id;
  - legacy fallback по [profiles.id](http://profiles.id) был багом и исправлен.
    Это важно как developer note.
  &nbsp;
7. В тест-гайде добавь отдельный негативный кейс:
  &nbsp;
  - удалить пользователя из комнаты;
  - проверить, что он не может:
    &nbsp;
    - открыть /live/:slug
    - отправить комментарий
    - отправить вопрос
      Потом restore и повторная проверка доступа.
    &nbsp;
  &nbsp;
8. В тест-гайде добавь отдельный кейс для legacy/fallback имени:
  &nbsp;
  - проверить новый комментарий с snapshot;
  - проверить старую запись/legacy fallback;
  - убедиться, что “Пользователь” не показывается там, где есть full_name.
  &nbsp;
9. В тест-гайде по CRM добавить обязательную проверку всей цепочки:
  &nbsp;
  - запись появилась в domain_events
  - consumer обработал её
  - запись появилась в domain_executions
  - запись появилась в crm_activity_log
  - повторный запуск consumer не создаёт дубль
    Это должен быть отдельный чек-блок, а не просто narrative.
  &nbsp;
10. В [webinar-stabilization-sprint-report.md](http://webinar-stabilization-sprint-report.md) добавь отдельную секцию:

&nbsp;

&nbsp;

&nbsp;

- **Что было реализовано в коде до proof**
- **Что оказалось сломанным на proof-аудите**
- **Что было исправлено fix-to-patch**
  Так отчёт будет отражать реальную историю, а не только финальное состояние.

&nbsp;

&nbsp;

&nbsp;

11. В отчёте о стабилизации отдельно зафиксируй 4 конкретных исправления:

&nbsp;

&nbsp;

&nbsp;

- trigger автора: [profiles.id](http://profiles.id) → profiles.user_id
- domain event triggers созданы
- reply trigger columns исправлены
- 3 UI lookup fixes (Comments, Questions, Moderation)

&nbsp;

&nbsp;

&nbsp;

12. В отчёте добавь machine-proof блок:

&nbsp;

&nbsp;

&nbsp;

- пример строки domain_events
- пример строки domain_executions
- пример строки crm_activity_log
- пример строки comments/questions с author_display_name
- подтверждение active cron job #43

&nbsp;

&nbsp;

&nbsp;

13. В архитектурном документе и в отчёте не формулировать “спринт закрыт полностью” без оговорки. Правильнее:

&nbsp;

&nbsp;

&nbsp;

- **core stabilization completed**
- **runtime room proof still required on real live stream**
  Потому что живой runtime proof по видео/комнате ещё нужен отдельно.

&nbsp;

&nbsp;

&nbsp;

14. В разделе “Что не затрагивается” добавь:

&nbsp;

&nbsp;

&nbsp;

- live-event-notifications-cron
- incident guardrails / kill-switch
- recorded_webinar и replay flow
  Чтобы документационное обновление не было интерпретировано как новый scope изменений.

&nbsp;

&nbsp;

В остальном структура правильная: сначала обновить tech-doc, затем testing guide, затем отдельный stabilization report.

&nbsp;

План: Обновление документации после стабилизационного спринта

---

## Что нужно сделать

Обновить 2 существующих документа и создать 1 новый:

1. `**docs/live-events-v2-architecture.md**` — дополнить техническую документацию новыми таблицами, триггерами, RPC, CRM pipeline
2. `**docs/live-events-v2-testing-guide.md**` — дополнить инструкцию тестировщика новыми шагами (replies, moderation, room blocks, scenario, CRM)
3. `**docs/audits/webinar-stabilization-sprint-report.md**` — создать итоговый отчёт о стабилизационном спринте (что исправлено, что усилено, какие proof получены)

---

## 1. Техническая документация (`live-events-v2-architecture.md`)

### Версию обновить на 2026-04-08, статус на "post-stabilization sprint"

### Добавить в раздел "1. Архитектура — Таблицы":

`**live_event_replies**` — ответы админа на комментарии/вопросы


| Поле               | Тип                                       | Описание                                            |
| ------------------ | ----------------------------------------- | --------------------------------------------------- |
| source_comment_id  | uuid FK → live_event_comments (nullable)  | &nbsp;                                              |
| source_question_id | uuid FK → live_event_questions (nullable) | &nbsp;                                              |
| target_user_id     | uuid (nullable)                           | Для приватных ответов                               |
| reply_text         | text                                      | &nbsp;                                              |
| visibility_scope   | text                                      | `public` / `private`                                |
| created_by         | uuid                                      | Автор (admin)                                       |
| CHECK              | &nbsp;                                    | exactly one of source_comment_id/source_question_id |


`**live_event_room_moderation**` — действия модерации в комнате


| Поле        | Тип                    | Описание                          |
| ----------- | ---------------------- | --------------------------------- |
| user_id     | uuid                   | Целевой пользователь              |
| action_type | text                   | `removed` / `banned` / `restored` |
| reason      | text (nullable)        | &nbsp;                            |
| expires_at  | timestamptz (nullable) | &nbsp;                            |
| created_by  | uuid                   | Модератор                         |


`**live_event_room_blocks**` — интерактивные блоки в комнате


| Поле          | Тип     | Описание                               |
| ------------- | ------- | -------------------------------------- |
| block_type    | text    | `button` / `banner`                    |
| display_scope | text    | `always` / `live_only` / `replay_only` |
| position      | text    | `under_video` / `sidebar`              |
| sort_order    | integer | &nbsp;                                 |
| is_active     | boolean | &nbsp;                                 |
| config        | jsonb   | Конфигурация блока                     |


`**crm_activity_log**` — лог активности для CRM


| Поле                        | Тип         | Описание          |
| --------------------------- | ----------- | ----------------- |
| idempotency_key             | text UNIQUE | Ключ дедупликации |
| + стандартные поля activity | &nbsp;      | &nbsp;            |


### Расширения существующих таблиц

- `live_event_comments` и `live_event_questions`: добавлены `author_display_name`, `author_avatar_url`, `metadata`

### Добавить в раздел "2. Edge Functions":

- `**webinar-activity-consumer**` — обрабатывает domain_events с source='webinar', пишет в crm_activity_log. Вызывается pg_cron каждую минуту (job #43).

### Добавить новый раздел "Триггеры":

- `trg_snapshot_comment_author` / `trg_snapshot_question_author` — snapshot автора при создании (функция `snapshot_author_display_name`, lookup по `profiles.user_id`)
- `trg_emit_domain_event_comment` / `question` / `reply` / `moderation` — запись в domain_events (функция `emit_webinar_domain_event`)

### Добавить в раздел "3. Access Logic":

- `is_user_removed_from_room(p_user_id, p_live_event_id)` — проверка модерации
- Moderation overlay enforced в 3 точках: RPC access, live-resolve, RLS INSERT policies
- `get_live_event_scenario(p_live_event_id, ...)` — unified timeline с фильтрами

### Добавить в раздел "7. UI Structure":

- Вкладки админки: Модерация, Сценарий, Блоки
- Комната (`/live/:slug`): replies, room blocks (under_video + sidebar)

### Обновить раздел "8. Runtime Dependencies":

- pg_cron job #43 (`invoke-webinar-activity-consumer`) — active, каждую минуту

### Обновить раздел "10. Что нельзя ломать":

- Добавить: snapshot trigger (`profiles.user_id`), domain event pipeline, CRM idempotency, moderation overlay в 3 точках

---

## 2. Инструкция тестировщика (`live-events-v2-testing-guide.md`)

### Версию обновить на 2026-04-08

### Добавить в "Разрешено":

- ✅ Отправлять ответы (replies) на тестовых эфирах
- ✅ Тестировать модерацию (удаление/восстановление) на тестовых аккаунтах
- ✅ Создавать room blocks на тестовых эфирах
- ✅ Просматривать сценарий (таймлайн) тестового эфира

### Новые шаги тестирования:

**Шаг 7a. Проверка ответов (replies)**

- Написать публичный reply на комментарий
- Написать приватный reply на вопрос
- Проверить: публичный виден всем, приватный — только автору вопроса и админу

**Шаг 7b. Проверка модерации**

- Удалить тестового пользователя из комнаты
- Проверить: пользователь не может открыть `/live/:slug`, писать комментарии/вопросы
- Восстановить пользователя
- Проверить: доступ восстановлен

**Шаг 7c. Проверка room blocks**

- Создать button-блок (live_only)
- Создать banner-блок (replay_only)
- Проверить: блоки видны/скрыты в соответствии с display_scope

**Шаг 7d. Проверка сценария**

- Открыть вкладку «Сценарий» в админке
- Проверить: таймлайн содержит комментарии, вопросы, ответы, модерацию
- Проверить: фильтры по типу работают

**Шаг 7e. Проверка имён авторов**

- Написать комментарий/вопрос
- Проверить: имя автора отображается корректно (не "Пользователь")

### Обновить шаблон отчёта:

Добавить чекбоксы: Ответы (replies), Модерация, Room blocks, Сценарий, Имена авторов

---

## 3. Отчёт о стабилизации (`docs/audits/webinar-stabilization-sprint-report.md`)

Итоговый отчёт с тремя секциями:

1. **Критически исправлено** — trigger автора, domain event pipeline, reply trigger columns, profile lookup в UI
2. **Усилено (hardening)** — explicit moderation check в INSERT policies
3. **Runtime proof получены** — domain_events, domain_executions, crm_activity_log, idempotency, cron job active

---

## Файлы изменений


| Файл                                                 | Действие |
| ---------------------------------------------------- | -------- |
| `docs/live-events-v2-architecture.md`                | Обновить |
| `docs/live-events-v2-testing-guide.md`               | Обновить |
| `docs/audits/webinar-stabilization-sprint-report.md` | Создать  |


## Что не затрагивается

- Код (src/) — без изменений
- SQL — без миграций
- Edge functions — без изменений
- ENGINEERING_RULES.md — без изменений