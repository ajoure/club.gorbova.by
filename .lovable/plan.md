Да. Это снова отчёт-аудит текущего состояния, и в этот раз он по сути выглядит корректно.

&nbsp;

&nbsp;

**Что он означает по факту**

&nbsp;

&nbsp;

Сейчас картина такая:

&nbsp;

&nbsp;

**Уже сделано и выглядит закрытым**

&nbsp;

&nbsp;

- video resolver и новый рендер источника;
- snapshot имени автора;
- moderation overlay в access logic;
- scenario RPC;
- room blocks;
- consumer + cron для CRM pipeline;
- hardening INSERT policies.

&nbsp;

&nbsp;

&nbsp;

**Реально осталось исправить**

&nbsp;

&nbsp;

Остались 3 конкретных бага, из них:

&nbsp;

&nbsp;

**1. Критический**

&nbsp;

Trigger emit_webinar_domain_event для replies

Если там действительно используются несуществующие поля [NEW.author](http://NEW.author)_display_name, NEW.comment_id, NEW.question_id, то это надо исправить обязательно.

&nbsp;

Правильно:

&nbsp;

- NEW.source_comment_id
- NEW.source_question_id
- author_display_name для replies либо не писать, либо резолвить отдельно

&nbsp;

&nbsp;

Это не “замечание к стилю”, а нормальный баг.

&nbsp;

&nbsp;

**2. Средний**

&nbsp;

Legacy fallback в LiveEventComments.tsx

&nbsp;

- .in("id", userIds) → должно быть .in("user_id", userIds)

&nbsp;

&nbsp;

&nbsp;

**3. Средний**

&nbsp;

Legacy fallback в LiveEventQuestions.tsx

&nbsp;

- .in("id", userIds) → .in("user_id", userIds)

&nbsp;

&nbsp;

&nbsp;

**4. Средний**

&nbsp;

Lookup в LiveEventModeration.tsx

&nbsp;

- .in("id", userIds) → .in("user_id", userIds)

&nbsp;

&nbsp;

Это по сути один класс ошибки, повторённый в трёх местах.

&nbsp;

&nbsp;

&nbsp;

&nbsp;

**Вывод по спринту**

&nbsp;

&nbsp;

Если этот аудит верный, то:

&nbsp;

- архитектурно спринт почти закрыт;
- функционально не принят, пока не исправлен reply-trigger;
- после этих фиксов останется в основном runtime proof на реальном live-stream и UI-проверки.

&nbsp;

&nbsp;

То есть вы были правы: сейчас это уже не “большая доработка спринта”, а добивка хвостов + проверка.

&nbsp;

&nbsp;

&nbsp;

&nbsp;

**Как бы я сформулировал итог подрядчику**

&nbsp;

&nbsp;

Можно дать так:

&nbsp;

&nbsp;

**Fix-to-patch**

&nbsp;

&nbsp;

1. Исправить emit_webinar_domain_event для live_event_replies:  

  - убрать ссылку на [NEW.author](http://NEW.author)_display_name;
  - заменить NEW.comment_id → NEW.source_comment_id;
  - заменить NEW.question_id → NEW.source_question_id.
2. &nbsp;
3. Исправить profile lookup:  

  - LiveEventComments.tsx
  - LiveEventQuestions.tsx
  - LiveEventModeration.tsx  
  Во всех местах:
  - .in("id", userIds) → .in("user_id", userIds)
4. &nbsp;
5. После этого дать proof:  

  - успешный insert reply;
  - domain_events для reply;
  - domain_executions для reply;
  - crm_activity_log для reply;
  - корректное имя в moderation;
  - корректный legacy fallback в comments/questions.
6. &nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

**Короткий итог**

&nbsp;

&nbsp;

Да, этот отчёт надо воспринимать как нормальный proof-аудит.

И из него следует, что не всё провалено — осталось не “полпереписать”, а закрыть 1 критический и 3 небольших бага, после чего переходить к runtime-тестам.

&nbsp;

# Отчёт: Аудит оставшихся функциональных блоков вебинарной комнаты

---

## Статус по каждому блоку

### ✅ Видео (PATCH 1) — реализовано корректно

- `live-resolve` возвращает `resolved_source` с полным контрактом
- `resolveVideoSource()` правильно приоритизирует: `kinescope_video_id` → `kinescope_live_event_id` → `none`
- `LiveEvent.tsx` рендерит по `resolved_source`, не по прямому `kinescope_video_id`
- Controlled state для `none` — есть
- Moderation overlay (`removed_from_room`) — проверяется серверно в live-resolve
- **Runtime proof нужен**: реальный live_stream с `kinescope_live_event_id` для проверки iframe

### ✅ Имена (PATCH 2) — trigger исправлен, repair выполнен

- `snapshot_author_display_name` ищет по `WHERE user_id = NEW.user_id` — **корректно**
- Приоритет: `full_name → first+last → masked email → Пользователь` — **корректно**
- One-shot repair выполнен: оба комментария в БД имеют заполненный `author_display_name`
- UI fallback цепочка в `resolveDisplayName()` — **корректна**

### 🔴 Имена — баг в legacy fallback (comments + questions)

- `LiveEventComments.tsx:62` и `LiveEventQuestions.tsx:61`: legacy-запрос профилей идёт `.in("id", userIds)`
- `userIds` содержит `user_id` из auth, а `profiles.id` — это собственный PK профиля
- **Та же самая ошибка**, что была в trigger до fix-to-patch
- **Fix**: заменить `.in("id", userIds)` на `.in("user_id", userIds)` в обоих файлах
- **Severity**: средняя — влияет только на legacy-записи без snapshot, которых после repair осталось 0. Но при следующем edge case (snapshot trigger fail) баг вернётся

### 🔴 Имена — баг в модерации

- `LiveEventModeration.tsx:46`: `.in("id", userIds)` — та же ошибка
- Модератор не увидит имена пользователей в списке модерации
- **Fix**: `.in("user_id", userIds)`

### ✅ Replies (PATCH 3) — реализовано

- Таблица `live_event_replies` с `source_comment_id`/`source_question_id` + CHECK — есть
- UI: `LiveEventReplyForm` + `LiveEventRepliesList` — есть
- Visibility scope: public/private — есть
- RLS: admin full + user (public + private where target) — есть

### 🔴 Domain event trigger для replies — баг

- `emit_webinar_domain_event` для `live_event_replies` ссылается на `NEW.author_display_name` — **такой колонки нет** в таблице
- Также ссылается на `NEW.comment_id` и `NEW.question_id` — **колонки называются** `source_comment_id` и `source_question_id`
- **Результат**: INSERT в `live_event_replies` вызовет ошибку trigger'а, что может заблокировать создание reply или записать NULL-поля
- **Fix**: в trigger заменить `NEW.author_display_name` на `NULL` (или resolve из profiles), `NEW.comment_id` → `NEW.source_comment_id`, `NEW.question_id` → `NEW.source_question_id`

### ✅ Moderation (PATCH 4) — реализовано корректно

- `is_user_removed_from_room` RPC — есть, логика корректна
- `user_has_live_event_access` содержит overlay — подтверждено
- `live-resolve` вызывает `is_user_removed_from_room` и возвращает `removed_from_room` — **подтверждено** (строки 256-271)
- INSERT policies comments/questions содержат explicit moderation check — **подтверждено**
- `LiveEvent.tsx` рендерит state `removed_from_room` — есть
- Server-enforced в 3/3 точках: RPC, live-resolve, RLS

### ✅ Scenario (PATCH 5) — реализовано

- RPC `get_live_event_scenario` с фильтрами — есть
- `LiveEventScenario.tsx` — есть, фильтры по типу работают
- Admin UI: вкладка "Сценарий" — есть

### ✅ CRM sync (PATCH 6) — pipeline работает

- Triggers на 4 таблицах — есть
- Consumer edge function — есть
- Cron job `invoke-webinar-activity-consumer` — active, каждую минуту
- Idempotency key — есть
- **Но**: trigger для replies сломан (баг выше), поэтому reply events не попадут в pipeline

### ✅ Room blocks (PATCH 7) — реализовано

- Таблица `live_event_room_blocks` — есть
- `LiveEventRoomBlocks.tsx` — рендерит button/banner по display_scope и position
- `LiveEventRoomBlocksEditor.tsx` — admin editor
- Встроено в `LiveEvent.tsx` в under_video и sidebar

### ✅ INSERT policies — hardening выполнен

- Обе INSERT policy для comments и questions содержат `AND NOT is_user_removed_from_room(...)` — **подтверждено SQL proof**

---

## Итого: 3 бага требуют исправления


| #   | Баг                                                                                                                              | Severity                                 | Fix                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------- |
| 1   | `emit_webinar_domain_event` для replies: `NEW.author_display_name`, `NEW.comment_id`, `NEW.question_id` — неверные имена колонок | 🔴 Критический (блокирует replies → CRM) | SQL migration: исправить trigger function |
| 2   | `LiveEventComments.tsx:62` + `LiveEventQuestions.tsx:61`: `.in("id", userIds)` → `.in("user_id", userIds)`                       | 🟡 Средний (legacy fallback)             | 2 строки в 2 файлах                       |
| 3   | `LiveEventModeration.tsx:46`: `.in("id", userIds)` → `.in("user_id", userIds)`                                                   | 🟡 Средний (admin UX)                    | 1 строка                                  |


---

## План исправления

### FIX A — SQL migration: исправить emit trigger для replies

Заменить в функции `emit_webinar_domain_event`:

- `NEW.author_display_name` → `NULL` (replies не имеют этой колонки; можно resolve из profiles, но NULL допустим т.к. consumer заполняет `author_snapshot` отдельно)
- `NEW.comment_id` → `NEW.source_comment_id`
- `NEW.question_id` → `NEW.source_question_id`

### FIX B — UI: исправить profile lookup в 3 файлах

- `LiveEventComments.tsx:62`: `.in("id", userIds)` → `.in("user_id", userIds)`
- `LiveEventQuestions.tsx:61`: `.in("id", userIds)` → `.in("user_id", userIds)`
- `LiveEventModeration.tsx:46`: `.in("id", userIds)` → `.in("user_id", userIds)`

### Что не затрагивается

- live-resolve — корректен
- LiveEvent.tsx — корректен
- RLS policies — корректны
- snapshot trigger — корректен
- consumer edge function — корректен
- cron job — активен и корректен

---

## Блоки, закрытые полностью после этих 3 фиксов

Все 9 PATCH-ей спринта будут функционально закрыты. Остаётся только runtime proof на реальном live_stream.