Да, согласен, с учетом правок:

&nbsp;

1. В начало плана добавь отдельный блок «Актуальная база проекта / что уже существует», чтобы подрядчик не начал дублировать уже реализованное. Явно перечислить:  

  - уже есть live_event_replies
  - уже есть live_event_room_moderation
  - уже есть live_event_room_blocks
  - уже есть crm_activity_log
  - уже есть domain_events / domain_executions
  - уже есть webinar-activity-consumer
  - уже есть get_live_event_scenario
  - уже есть live-resolve с unified source resolver
  - уже есть notification guardrails  
  Отдельно указать: не создавать эти сущности заново, только расширять/reuse.
2. &nbsp;
3. В блоке техдокументации обнови опорную версию с устаревшей на актуальную: ориентироваться не на старую редакцию 2026-04-05, а на post-stabilization состояние 2026-04-08, где уже зафиксированы:  

  - replies
  - moderation overlay
  - room blocks
  - crm pipeline
  - snapshot trigger
  - fixes lookup по profiles.user_id
  - исправление trigger для replies.
4. &nbsp;
5. В план обязательно добавь раздел «Обязательный discovery перед execute» с запросом окружения и документации. Подрядчик перед началом должен подтвердить:  

  - актуальные env для Kinescope
  - доступность kinescope-api
  - текущие route/components для ContactDetailSheet
  - reusable export infrastructure
  - reusable form pipeline site-form-submit
  - текущий статус cron job #42 и #43
  - актуальные RLS / triggers / RPC по live domain
  - наличие тестового live_stream и тестовых аккаунтов для runtime proof.
6. &nbsp;
7. Зафиксируй, что PATCH 1 = blocker всего спринта.  
Пока не доказано реальным runtime proof, что live-видео видно в комнате на live_stream, подрядчик не переходит к следующей волне.
8. В Wave 1 объедини layout и mobile fix в один patch не только логически, но и по DoD.  
Там должен быть один единый критерий приемки:  

  - большой player на desktop
  - full-height chat/questions
  - sticky input на mobile
  - sticky tabs на mobile
  - room blocks не ломают room layout.
9. &nbsp;
10. В PATCH 3 явно укажи, что нужны два независимых механизма имени автора:  

  - server snapshot при insert
  - UI fallback для legacy  
  И прямо пропиши: lookup только через profiles.user_id, не через [profiles.id](http://profiles.id).
11. &nbsp;
12. Для PATCH 3 добавь обязательный подпункт role snapshot / role badge contract:  

  - author_role сохраняется на момент создания
  - отображение admin/employee не должно зависеть только от текущего клиента
  - единый mapping бейджей: admin, employee, user
  - сообщения admin/employee выделяются красным через единый helper, а не разной логикой в каждом компоненте.
13. &nbsp;
14. В PATCH 4 зафиксируй: reply-модель уже существует.  
Подрядчик не создаёт новую таблицу reply и не перепридумывает contract. Он только:  

  - расширяет UI
  - доводит threaded rendering
  - доводит visibility
  - доводит in-room controls.
15. &nbsp;
16. В PATCH 5 раздели moderation на remove/banned и mute как разные серверные состояния.  
Нужно явно дописать:  

  - is_user_removed_from_room(...)
  - is_user_muted_in_room(...)
  - remove/banned блокирует вход
  - muted не блокирует просмотр, но блокирует комментарии/вопросы.
17. &nbsp;
18. В PATCH 5 отдельно зафиксируй, что inline moderation в комнате не заменяет admin moderation panel.  
Оба интерфейса должны жить одновременно:  

  - inline controls — быстрые действия
  - admin panel — история, причина, restore, фильтры.
19. &nbsp;
20. В PATCH 6 пропиши, что карточка пользователя открывается только через existing profile/contact flow, без нового drawer/route.  
Нужно reuse существующего ContactDetailSheet или его канонического аналога.
21. В PATCH 7 прямо запиши: новый consumer не создавать.  
Нужно расширять уже работающий pipeline:  

  - existing triggers/domain_events
  - existing webinar-activity-consumer
  - existing crm_activity_log
  - existing idempotency.
22. &nbsp;
23. В PATCH 7 добавь privacy contract:  

  - private reply/private activity не должны утекать в профиль для ролей без доступа
  - export тоже обязан учитывать visibility_scope.
24. &nbsp;
25. В PATCH 8 зафиксируй двухфазность сценариев:  

  - Phase A: projection-only, read-only, отдельная вкладка
  - Phase B: editable scenario layer  
  Нельзя в одной волне обещать и read-only projection, и полноценный editor/import/export, если модель еще не отделена.
26. &nbsp;
27. В PATCH 9 явно ограничь scope:  
в этой волне только export, без import.  
Import Excel вывести в deferred/follow-up после discovery reusable import-механики.
28. PATCH 10, 11 и 12 сведи в один архитектурный блок Sales Blocks Platform:  

  - reusable catalog
  - event bindings
  - runtime show state / show log
  - manual show
  - scheduled show  
  Отдельно потребуй migration plan для уже существующего live_event_room_blocks, чтобы не получить параллельные модели.
29. &nbsp;
30. Для sales blocks жёстко зафиксируй:  

  - форма только через site-form-submit
  - никаких новых параллельных таблиц сабмитов без доказанной необходимости
  - timer/text/button/banner/form — это не пять отдельных подсистем, а единый config-driven block model.
31. &nbsp;
32. PATCH 13 по теме комнаты делать add-only через live_[events.metadata.room](http://events.metadata.room)_theme, если discovery не докажет необходимость отдельной таблицы.  
Это важно явно прописать.
33. PATCH 14 по unified timeline делай только после разделения:  

  - facts
  - editable scenario items
  - sales block runtime events  
  Иначе подрядчик снова смешает raw chat log и редактируемый сценарий.
34. &nbsp;
35. В PATCH 16 зафиксируй два разных контура:  

  - audit_logs
  - domain_events / domain_executions  
  Они не взаимозаменяемы. Для критических действий нужны оба следа.
36. &nbsp;
37. Добавь отдельный технический patch: декомпозиция AdminLiveEvents.tsx.  
Не позволять дальше расширять монолит. Минимально вынести:  

  - room layout settings
  - source/debug panel
  - moderation panel
  - scenario panel
  - block binding editor
  - theme editor.
38. &nbsp;
39. В блоке «Что нельзя ломать» дополни:  

  - snapshot trigger lookup по profiles.user_id
  - domain event pipeline webinar → CRM
  - idempotency в crm_activity_log
  - moderation overlay в 3 точках
  - notification job #42 / guardrails / kill-switch.
40. &nbsp;
41. Добавь отдельный раздел «Notifications Safety»:  

  - job #42 не трогать
  - live_notification_config не менять
  - proof_mode / approval gate / kill-switch не менять
  - никакие новые runtime hooks этого спринта не должны запускать notifications path.
42. &nbsp;
43. Финальный proof разбей не общим списком, а 4 обязательными пакетами:  

  - SQL proof
  - Runtime room proof
  - Events / CRM proof
  - Regression + notifications safety proof
44. &nbsp;
45. Итоговую очередность закрепи так:  

  - Wave 1 / P0: PATCH 1, PATCH 2+15, PATCH 3, PATCH 4, PATCH 5, PATCH 6
  - Wave 2 / P1: PATCH 7, PATCH 8 Phase A, PATCH 9 export-only
  - Wave 3 / P2: PATCH 10, PATCH 11, PATCH 12, PATCH 13, PATCH 14, PATCH 16, PATCH 17 + декомпозиция AdminLiveEvents.tsx  
  Переход между волнами — только после полного proof предыдущей.
46. &nbsp;

&nbsp;

&nbsp;

Ниже готовый блок, который можно вставить подрядчику как правки к плану:

Дополни план следующей информацией:

&nbsp;

1. В начало плана добавь блок «Актуальная база проекта / что уже существует». Зафиксируй, что уже реализованы и не должны создаваться заново:

- live_event_replies

- live_event_room_moderation

- live_event_room_blocks

- crm_activity_log

- domain_events / domain_executions

- webinar-activity-consumer

- get_live_event_scenario

- live-resolve с unified source resolver

- notification guardrails

&nbsp;

2. Актуальную техническую базу брать не из ранней версии документации, а из post-stabilization состояния 2026-04-08, где уже есть:

- replies

- moderation overlay

- room blocks

- crm pipeline

- snapshot trigger

- fixes lookup по profiles.user_id

- fix trigger для replies

&nbsp;

3. Добавь обязательный раздел «Discovery перед execute / запрос окружения и документации». До начала работ подрядчик обязан подтвердить:

- env и доступы для Kinescope

- текущий status edge functions: kinescope-api, live-resolve, webinar-activity-consumer

- reusable ContactDetailSheet/profile flow

- reusable export infrastructure

- reusable form pipeline site-form-submit

- статус cron job #42 и #43

- актуальные RLS / triggers / RPC live domain

- тестовый live_stream и тестовые аккаунты для runtime proof

&nbsp;

4. PATCH 1 (video) — blocker всего спринта. Пока нет runtime proof на реальном live_stream с kinescope_live_event_id, переход к следующим волнам запрещён.

&nbsp;

5. PATCH 2 и PATCH 15 объединить в один patch Room Layout:

- large player desktop

- full-height chat/questions

- sticky mobile input

- sticky mobile tabs

- room blocks не ломают layout

Единый DoD и единый runtime proof.

&nbsp;

6. В PATCH 3 явно зафиксировать 2 слоя:

- server snapshot автора

- UI fallback для legacy

И отдельно прописать: lookup только через profiles.user_id, не через [profiles.id](http://profiles.id).

&nbsp;

7. В PATCH 3 добавить role snapshot / role badge contract:

- author_role сохраняется на момент insert

- admin/employee messages выделяются красным через единый helper

- единый mapping бейджей: admin / employee / user

&nbsp;

8. В PATCH 4 зафиксировать, что reply-модель уже существует. Новую таблицу reply не создавать. Только доработка UI / rendering / visibility / in-room controls.

&nbsp;

9. В PATCH 5 разделить состояния:

- removed / banned → не входит в room

- muted → может смотреть, но не может писать

Добавить отдельный server-side check is_user_muted_in_room(...).

&nbsp;

10. В PATCH 5 сохранить оба интерфейса:

- inline moderation в room

- отдельная admin moderation panel

Одно не заменяет другое.

&nbsp;

11. В PATCH 6 открытие карточки пользователя делать только через existing ContactDetailSheet/profile flow. Новый drawer/route не создавать.

&nbsp;

12. В PATCH 7 не создавать новый consumer. Расширять existing:

- triggers/domain_events

- webinar-activity-consumer

- crm_activity_log

- idempotency_key

&nbsp;

13. В PATCH 7 добавить privacy contract:

- private replies/private activity не раскрывать ролям без доступа

- export должен учитывать visibility_scope

&nbsp;

14. В PATCH 8 зафиксировать двухфазность:

- Phase A: projection-only, read-only

- Phase B: editable scenario layer

Нельзя смешивать их в одном этапе.

&nbsp;

15. В PATCH 9 ограничить scope: только export. Import Excel вывести в deferred.

&nbsp;

16. PATCH 10 + 11 + 12 объединить в единый архитектурный блок Sales Blocks Platform:

- centralized catalog

- event bindings

- runtime show state / show log

- manual show / scheduled show

Обязательно добавить migration/compat plan для existing live_event_room_blocks.

&nbsp;

17. Для sales blocks форма допускается только через existing site-form-submit. Новые параллельные form-submission таблицы запрещены без отдельного approve.

&nbsp;

18. PATCH 13 (theme) реализовывать add-only через live_[events.metadata.room](http://events.metadata.room)_theme, если discovery не докажет необходимость отдельной таблицы.

&nbsp;

19. PATCH 14 (unified timeline) делать только после разделения:

- facts

- editable scenario items

- sales block runtime events

&nbsp;

20. В PATCH 16 явно разделить:

- audit_logs

- domain_events / domain_executions

Они не взаимозаменяемы.

&nbsp;

21. Добавить отдельный технический patch: декомпозиция AdminLiveEvents.tsx. Дальше не расширять монолит. Вынести:

- source/debug panel

- moderation panel

- scenario panel

- block binding editor

- theme editor

- room settings

&nbsp;

22. В раздел «Что нельзя ломать» дополнительно внести:

- lookup snapshot trigger по profiles.user_id

- webinar CRM pipeline

- idempotency в crm_activity_log

- moderation overlay в 3 точках

- notification job #42 / kill-switch / proof_mode / approval gate

&nbsp;

23. Добавить отдельный раздел Notifications Safety:

- job #42 не трогать

- live_notification_config не менять

- proof_mode / approval gate / kill-switch не менять

- любые новые runtime hooks спринта не должны запускать notifications path

&nbsp;

24. Финальный proof разбить на 4 пакета:

- SQL proof

- Runtime room proof

- Events / CRM proof

- Regression + notifications safety proof

&nbsp;

25. Итоговая очередность работ:

Wave 1 / P0:

- PATCH 1

- PATCH 2+15

- PATCH 3

- PATCH 4

- PATCH 5

- PATCH 6

- Regression Block

&nbsp;

Wave 2 / P1:

- PATCH 7

- PATCH 8 Phase A

- PATCH 9 export-only

- Regression Block

&nbsp;

Wave 3 / P2:

- PATCH 10

- PATCH 11

- PATCH 12

- PATCH 13

- PATCH 14

- PATCH 16

- PATCH 17

- декомпозиция AdminLiveEvents.tsx

- Full Regression + Notifications Safety

&nbsp;

Переход между волнами разрешён только после полного proof предыдущей волны.

&nbsp;

# План: Webinar Room 2.0 — финальное ТЗ в 3 волны

## Текущее состояние (discovery confirmed)

**Существующие сущности:**

- `live_events`, `live_event_access_rules`, `live_event_comments`, `live_event_questions`
- `live_event_replies` (FK на comment/question, CHECK, public/private visibility)
- `live_event_room_moderation` (removed/banned/restored; muted отсутствует)
- `live_event_room_blocks` (button/banner, position, display_scope)
- `domain_events` + `domain_executions` + triggers на comments/questions/replies/moderation
- `webinar-activity-consumer` edge function + `crm_activity_log`
- `live-resolve` (unified server resolver), `kinescope-api`, `live-session-heartbeat`
- RPC: `get_live_event_scenario`, `is_user_removed_from_room`
- UI: `LiveEvent.tsx` (461 строк), `AdminLiveEvents.tsx` (2269 строк — монолит)
- 6 компонентов в `src/components/live/`
- `LiveEventScenario.tsx` — read-only projection через RPC
- `exportToExcel()` в `src/utils/exportTableData.ts`
- `ContactDetailSheet` + `openContactSheet` pattern

**Чего нет:**

- `live_sales_blocks` (centralized catalog) + `live_event_sales_block_bindings`
- `live_event_scenarios` + `live_event_scenario_items` (editable layer)
- muted/unmuted в moderation
- In-room inline moderation controls
- Role badges / red highlight в room
- Sticky mobile input / tabs
- Reply UI в user-facing room
- Room theme settings

---

## Жёсткие правила исполнения

1. Ничего не ломать без dependency audit. Add-only подход.
2. Все связи только UUID. Запрещены slug, title, email, имена в бизнес-логике.
3. Cross-domain → только `domain_events` → `domain_executions`. Прямые записи из webinar в CRM запрещены.
4. Бизнес-логика в service/resolver layer, не в UI.
5. Критические действия → `audit_logs` (actor_type, actor_user_id, actor_label) + `domain_events`.
6. DIAGNOSE → PLAN → DRY RUN → EXECUTE → VERIFY. Пропуск запрещён.
7. Reuse existing before create new.
8. Форма внутри продающего блока — только через existing `site-form-submit`. Никаких параллельных form storage.
9. `onConflict: 'user_id,product_code'` — legacy risk, зафиксирован как follow-up.

---

## Roles / Permissions Matrix


| Действие                    | super_admin | admin | employee | attendee          | muted             | removed |
| --------------------------- | ----------- | ----- | -------- | ----------------- | ----------------- | ------- |
| Писать комментарий/вопрос   | ✅           | ✅     | ✅        | ✅                 | ❌                 | ❌       |
| Reply public                | ✅           | ✅     | ✅        | ❌                 | ❌                 | ❌       |
| Reply private               | ✅           | ✅     | ✅        | ❌                 | ❌                 | ❌       |
| Видеть private reply (свой) | ✅           | ✅     | ✅        | ✅ (только target) | ✅ (только target) | ❌       |
| Delete/hide message         | ✅           | ✅     | ✅        | ❌                 | ❌                 | ❌       |
| Remove from room            | ✅           | ✅     | ❌        | ❌                 | ❌                 | ❌       |
| Restore to room             | ✅           | ✅     | ❌        | ❌                 | ❌                 | ❌       |
| Mute/unmute                 | ✅           | ✅     | ✅        | ❌                 | ❌                 | ❌       |
| Open user card              | ✅           | ✅     | ✅        | ❌                 | ❌                 | ❌       |
| Show/hide sales block       | ✅           | ✅     | ❌        | ❌                 | ❌                 | ❌       |
| Edit scenario               | ✅           | ✅     | ✅        | ❌                 | ❌                 | ❌       |
| Export Excel                | ✅           | ✅     | ✅        | ❌                 | ❌                 | ❌       |


---

## Privacy Contract

- Private reply: видят только `target_user_id` + admin/employee с ролью.
- Private webinar activity в CRM profile: не раскрывается ролям без доступа.
- Export comments/questions/scenario: учитывает `visibility_scope` и права экспортирующего. Private replies включаются в export только для admin/employee.

---

## Wave 1 / P0 — Боевая комната (блокер приёмки)

### PATCH 1 — Video fix (БЛОКЕР, идёт первым)

Не создавать новую video-архитектуру. Доработка текущего `live-resolve` + room player.

**Задачи:**

- Проверить `resolveVideoSource()` в `live-resolve`: 3 ветки (kinescope_video / kinescope_live_embed / none)
- Проверить iframe embed mode + container/overlay collisions
- Добавить в админку source debug block: `provider_source_status`, `actual_render_source`, `play_link`, `embed_link`, `last_sync_at`
- Sync after «Запустить эфир»

**DoD:**

- Runtime-proof на реальном `kinescope_live_event_id` — видео видно
- Отдельный proof: `recorded_webinar` работает
- Отдельный proof: `replay` работает
- При broken source — controlled state, не чёрный блок
- Админ видит debug source block

**Файлы:** `LiveEvent.tsx`, `AdminLiveEvents.tsx`, `live-resolve` (если нужно)

---

### PATCH 2 — Room layout desktop + mobile (объединяет бывшие PATCH 2+15)

**Desktop:**

- Video area заметно больше (lg:col-span-2 → увеличить)
- Chat/questions column: `h-[500px]` → `h-[calc(100vh-200px)]`, убрать `max-h-[400px]` из scroll containers
- Input фиксирован внизу колонки

**Mobile:**

- Sticky/fixed input в safe-area bottom
- Sticky tabs «Чат / Вопросы»
- Compact spacing, убрать лишние vertical gaps
- Sales blocks не ломают mobile layout

**DoD (единый):**

- Desktop: player визуально больше, chat занимает почти всю вертикаль
- Mobile: комментарий можно писать сразу без прокрутки
- Shown sales blocks не ломают ни desktop, ни mobile
- Runtime screenshot proof: desktop + mobile

**Файлы:** `LiveEvent.tsx`, `LiveEventComments.tsx`, `LiveEventQuestions.tsx`

---

### PATCH 3 — Author identity + role badges

**2 слоя:**

1. **Server snapshot** (уже частично есть — triggers на `author_display_name`, `author_avatar_url`):
  - Проверить trigger: lookup по `profiles.user_id` (НЕ по `profiles.id`)
  - Priority: `full_name` → `first_name + last_name` → masked email → «Пользователь»
  - Snapshot role при insert: `author_role` field (admin/employee/user)
2. **UI fallback** для legacy-записей без snapshot:
  - Текущий profile lookup сохраняется как fallback
  - Role lookup для legacy через `user_roles_v2`

**Цветовое выделение:**

- admin/employee → red background highlight
- Определение роли через snapshot field `author_role`, НЕ через клиентский `useAuth().role`
- Единый role-badge mapping (не дублировать в Comments и Questions)

**DoD:**

- Новые записи всегда с именем и ролью
- admin/employee визуально выделены красным
- Бейджи «Админ» / «Сотрудник» — единый mapping
- «Пользователь» только как крайний fallback

**Файлы:** `LiveEventComments.tsx`, `LiveEventQuestions.tsx`, migration (add `author_role`), trigger update

---

### PATCH 4 — Reply в user-facing room

Не создавать новую модель. `live_event_replies` уже существует (FK, CHECK, public/private).

**Задачи:**

- Интегрировать reply button в каждый comment/question row
- Показывать threaded replies inline под сообщением
- Reuse `LiveEventReplyForm` (уже работает)
- Private/public visibility через существующие RLS + `visibility_scope`
- Private reply видны только target + admin/employee

**DoD:**

- Reply создаётся из конкретного comment/question
- Рендерится как threaded reply
- Private reply скрыт от посторонних через RLS

**Файлы:** `LiveEventComments.tsx`, `LiveEventQuestions.tsx`

---

### PATCH 5 — In-room moderation

**2 типа moderation state:**

- `removed` / `banned` → пользователь не входит в room → `is_user_removed_from_room(...)`
- `muted` → может смотреть, не может писать → `is_user_muted_in_room(...)` (новый RPC)

**DB migration:**

- Добавить `'muted'` / `'unmuted'` в CHECK constraint `live_event_room_moderation.action_type`
- Новый RPC: `is_user_muted_in_room(event_id, user_id)`

**2 интерфейса одного домена:**

1. **Inline controls в room** (быстрая реакция): delete, hide, reply, remove, mute — в каждом message row
2. **Admin moderation panel** (НЕ убирать): журнал, причины, restore, история, фильтры — `LiveEventModerationPanel` остаётся

**Модерация event-scoped:** remove/mute действует только на конкретный `live_event_id`, не на product access.

**DoD:**

- Inline moderation в room работает
- Admin panel сохранена для журнала/истории
- Muted user видит чат, но не может писать
- Removed user не входит в room

**Файлы:** `LiveEventComments.tsx`, `LiveEventQuestions.tsx`, `LiveEventModeration.tsx`, migration, новый RPC

---

### PATCH 6 — Open user card from room

Reuse existing `ContactDetailSheet` / `openContactSheet` pattern.

**Единый resolver:** `user_id` → profile/contact:

- Click на avatar/name → fetch profile by `user_id`
- Open `ContactDetailSheet`
- Fallback если contact не найден, но profile существует
- Одинаковый способ из comments и questions

**Нельзя:** создавать отдельный «вебинарный» профильный drawer.

**DoD:**

- Переход работает из comments и questions одинаково
- Используется existing `ContactDetailSheet`

**Файлы:** `LiveEventComments.tsx`, `LiveEventQuestions.tsx`

---

### Wave 1 Regression Block

После завершения Wave 1 обязательный proof:

- `recorded_webinar` не сломан
- `replay` не сломан
- `/live/:slug` единый маршрут работает
- `access-core` (`user_has_live_event_access`) не затронут
- `notification guardrails` не затронуты (job #42 не тронут, kill-switch/proof_mode/approval gate не менялись)
- Existing comments/questions data читаются корректно

---

## Wave 2 / P1 — CRM + Сценарии + Export

### PATCH 7 — Webinar activity → profile (расширение existing pipeline)

**Не создавать новый consumer.** Расширить existing:

- `domain_events` triggers уже пишут events на comments/questions/replies/moderation
- `webinar-activity-consumer` уже работает
- `crm_activity_log` с `idempotency_key` — обязательный контракт

**Добавить:**

- Новые event types в consumer если отсутствуют
- UI-отображение webinar activity в `ContactDetailSheet`
- Privacy: private activity не раскрывается ролям без доступа

**DoD:**

- В карточке профиля видно webinar activity
- Видно на каком вебинаре было действие
- Private reply/moderation скрыты от неавторизованных ролей

---

### PATCH 8 — Вкладка «Сценарии» (2-фазная модель)

**Phase A (в этом спринте):**

- Отдельная вкладка «Сценарии» в разделе «Эфиры»
- Server-side projection через existing RPC `get_live_event_scenario`
- Фильтрация по `entry_type`, `user_id`, `visibility_scope`
- Read-only timeline view

**Phase B (follow-up):**

- DB: `live_event_scenarios` + `live_event_scenario_items`
- Editable layer: ручные заметки, reorder, import/export, editor flags

**DoD Phase A:**

- Есть отдельная вкладка «Сценарии»
- Показывает timeline из projection
- Фильтры работают

---

### PATCH 9 — Excel export (только export, без import)

Reuse `exportToExcel()` из `src/utils/exportTableData.ts`.

**3 экспорта:**

- comments → Excel
- questions → Excel
- scenario (projection) → Excel

**Privacy:** export учитывает `visibility_scope` и права экспортирующего.

**Import Excel → deferred** (после discovery existing import pipeline).

**DoD:**

- 3 отдельных экспорта доступны
- Private replies включены только для admin/employee export

---

### Wave 2 Regression Block

Тот же набор проверок что в Wave 1 + CRM activity не дублирует записи.

---

## Wave 3 / P2 — Sales blocks + Theme + Timeline expansion

### PATCH 10 — Единая sales block architecture (объединяет бывшие 10+11+12)

**3 слоя:**

1. **Catalog** — `live_sales_blocks` (centralized reusable):
  - block_type: text/button/banner/form/timer
  - config, is_active, created_by, updated_by
2. **Bindings** — `live_event_sales_block_bindings`:
  - live_event_id, sales_block_id, display_mode, show_after_minutes, show_at, position, is_enabled
3. **Runtime state** — show events:
  - block_shown, block_hidden, block_replaced
  - shown_at, shown_by, show_mode (manual/scheduled)
  - Нужны для: сценария, аналитики, истории показа

**Миграция existing `live_event_room_blocks`:**

- Либо превратить в bindings layer
- Либо оставить как legacy с migration/compat adapter
- Решение принять на этапе dry-run, не допустить дублирования

**Form внутри block:** только через `site-form-submit` (canonical CRM flow). Сначала discovery existing form pipeline → adapter/reuse.

**Admin in-room overlay:** manual show/hide/replace/preview + scheduled auto-show.

**DoD:**

- Blocks централизованы в каталоге
- В event — только binding + show settings
- Manual show/hide работает
- Scheduled show работает
- Participants видят block в room
- Runtime show events записываются

---

### PATCH 11 — Room theme

Add-only в `live_events.metadata.room_theme`. Отдельную theme-table создавать только если discovery докажет, что metadata недостаточно.

**Настройки:** room bg, primary/secondary text, panel color, tabs/accent, badge colors.

**DoD:**

- У вебинара есть своя тема
- Тема применяется в room UI

---

### PATCH 12 — Unified timeline (требует архитектурного разделения)

**3 слоя (не смешивать):**

1. **Timeline facts:** comments/questions/replies/moderation/form submits/shown blocks
2. **Editable scenario items:** manual/editorial layer (из Phase B PATCH 8)
3. **Block events:** отдельный runtime source (из PATCH 10)

**DoD:**

- Blocks и room actions становятся timeline items
- Сценарий редактируемый (Phase B)
- Связь с `live_event_id` и reusable block IDs сохранена

---

### PATCH 13 — Audit + Events (2 независимых контура)

1. **audit_logs** — кто/что/когда (actor_type, actor_user_id, actor_label)
2. **domain_events / domain_executions** — междоменный бизнес-поток

Одно действие порождает оба следа. Нельзя подменять audit domain-event'ом или наоборот.

**Новые события:** sales_block_shown/hidden, form_submitted, scenario_edited.

---

### PATCH 14 — Декомпозиция AdminLiveEvents.tsx

Текущий монолит (2269 строк) → отдельные компоненты:

- Room settings
- Source/debug panel
- Moderation panel (уже есть частично)
- Scenario panel
- Block binding editor
- Theme editor

---

### PATCH 15 — UI-структура раздела «Эфиры» (финальная)

3 верхнеуровневые вкладки:

1. **Эфиры** — list, event card, room settings, access, notifications, theme, block bindings, source/debug
2. **Сценарии** — scenario list, filters, editor, Excel export
3. **Продающие блоки** — catalog, editor, preview, reuse

Делать только после закрытия Wave 1 и Wave 2.

---

### Wave 3 Regression Block

Полный regression + notifications safety proof.

---

## Safety — Notifications

- Любые изменения room/CRM/scenario/blocks НЕ должны реактивировать notification production path
- Job #42 не трогать
- kill-switch / proof_mode / approval gate не менять без отдельного approve

---

## Что нельзя ломать

- `recorded_webinar` flow
- `/live/:slug` единый маршрут
- `replay` logic
- `access-core` (`user_has_live_event_access`, `live-resolve`)
- `notification guardrails`
- Existing CRM flow
- Existing comments/questions data
- Existing domain_events triggers

---

## Финальный Proof (4 части)

### 1. SQL Proof

- DDL новых/изменённых таблиц
- Policies diff
- RPC/functions diff
- domain_events examples
- audit_logs examples

### 2. Runtime Room Proof

- Реальный live video в room
- Desktop large player
- Mobile sticky input
- Real names + badges
- Public/private replies
- Inline moderation
- Recorded webinar + replay

### 3. Events / CRM Proof

- domain_events записаны
- domain_executions обработаны
- crm_activity_log корректен
- Private activity скрыта
- Idempotency key работает

### 4. Regression Proof

- recorded_webinar не сломан
- replay не сломан
- /live/:slug работает
- access-core не затронут
- notifications не реактивированы
- existing data читается корректно

---

## Deferred (follow-up sprint)

- Complex Excel import
- Advanced analytics
- Rich timer presets
- Form builder (beyond site-form-submit reuse)
- Extra UI polish
- `onConflict: 'user_id,product_code'` migration to ID-first
- `UserSubscriptions.tsx` parity check

---

## Порядок исполнения

```text
Wave 1 / P0 (блокер):
  PATCH 1 (video) → PATCH 2 (layout) → PATCH 3 (names) →
  PATCH 4 (reply) → PATCH 5 (moderation) → PATCH 6 (profile)
  → Regression Block

Wave 2 / P1:
  PATCH 7 (CRM activity) → PATCH 8 Phase A (scenarios projection) →
  PATCH 9 (export)
  → Regression Block

Wave 3 / P2:
  PATCH 10 (sales blocks) → PATCH 11 (theme) → PATCH 12 (timeline) →
  PATCH 13 (audit+events) → PATCH 14 (decomposition) → PATCH 15 (UI structure)
  → Full Regression + Notifications Safety
```

Gate между волнами: переход к следующей волне только после полного regression proof предыдущей.