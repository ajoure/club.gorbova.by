# да, согласен, с учетом правок:

1. **PATCH F1 / порядок работ**  
Единый runtime regression лучше запускать **после** F2–F7, а не параллельно им. Иначе proof будет собран на старой неканоничной админке эфиров и часть сценариев придется перепроходить повторно. Зафиксируй это прямо в плане:
  - сначала F2–F7;
  - потом один финальный regression F1;
  - потом F8 verdict.
2. **PATCH F2 / sticky header**  
`sticky top-0 z-10 bg-card` для `TableHeader` допустим только если таблица будет внутри правильного scroll-контейнера. Нужно явно указать:
  - sticky работает относительно `ScrollArea` / table wrapper;
  - проверить, что header не конфликтует с верхней toolbar/filter bar;
  - не допустить двойного sticky.
3. **PATCH F3 / “каноническая таблица как Контакты”**  
Нужно прямо зафиксировать, что мы переиспользуем **тот же table-shell/pattern**, что и в `AdminContacts`, а не просто “делаем похоже”.  
То есть:
  &nbsp;
  &nbsp;
  - reuse `ScrollArea`;
  - reuse selection pattern;
  - reuse row density / header style / hover behavior;
  - reuse dropdown-actions pattern.  
  Иначе подрядчик снова может собрать “почти таблицу”.
4. **PATCH F3 / колонка Lifecycle actions**  
Отдельная колонка под `RoomLifecycleActions` правильная, но нужно ограничить ее по ширине и привести к компактному виду.  
Прямо добавь:
  - lifecycle-actions должны быть compact;
  - без многострочного вертикального стека;
  - без раздувания строки по высоте;
  - при узком viewport действия могут сворачиваться в компактный action-group, но без потери доступности.
5. **PATCH F4 / select-all semantics**  
Нужно явно определить, что именно значит master checkbox:
  - select all **на текущей загруженной странице/выборке**, а не “во всей БД”.  
  И это должно быть показано в UI текстом/поведением, чтобы не было ложного ожидания массового удаления всех записей за пределами текущего списка.
6. **PATCH F5 / delete dialog summary**  
В summary нужно добавить не только Kinescope linkage, но и:
  - сколько выбранных эфиров сейчас `completed`;
  - сколько `opened`;
  - сколько `closed`;
  - сколько удаление заблокировано из-за `live`.  
  Это важно для bulk UX и понимания, почему часть набора может не пройти.
7. **PATCH F6 / provider delete strategy**  
Нужно заранее зафиксировать порядок:
  - сначала provider delete attempts;
  - потом local delete;
  - partial provider failure не блокирует local delete, но явно помечается как degraded.  
  Это у тебя описано, но нужно дополнительно потребовать **понятный summary в UI**, а не только audit/log.
8. **PATCH F6 / 404 from Kinescope**  
Зафиксируй отдельно:
  - provider 404 трактуется как success/already absent;
  - это не считается failed delete.  
  Это надо написать явно в DoD/контракте, чтобы потом не спорить по summary.
9. **PATCH F6 / live guard**  
Запрет удаления `room_state='live'` правильный, но надо явно указать поведение для bulk:
  - либо весь bulk reject целиком, если внутри есть live-эфир;
  - либо live-эфиры исключаются, а остальные удаляются.  
  Это нужно определить сейчас. Рекомендую второй вариант: частичное выполнение с явным summary, какие id пропущены из-за `cannot_delete_live`.
10. **PATCH F6 / каскады FK**  
Отлично, что предусмотрен discovery на `ON DELETE CASCADE`. Но в плане надо добавить правило:
  - сначала discovery всех связанных таблиц;
  - только потом add-only миграция, если реально не хватает каскада;
  - не менять FK массово без точного списка затронутых таблиц и доказательства, что это безопасно.
11. **PATCH F7 / orphan-check**  
Помимо `live_active_sessions`, `comments`, `questions`, `access_rules`, нужно явно проверить:
  - reply/thread tables, если они отдельные;
  - moderation-related tables;
  - audit/proof tables, если они должны сохраняться отдельно и не каскадиться.  
  То есть не все связи обязаны удаляться каскадом — часть может быть исторической. Это надо разделить:
  - operational children → delete/cascade;
  - audit/history → сохранить, но без битых ссылок либо через snapshot/meta.
12. **PATCH F8 / финальный verdict**  
Добавь правило, что после F1–F7 нельзя запускать новый цикл мелких правок без новых фактов.  
Итог должен быть:
  - либо модуль принят;
  - либо один consolidated финальный список remaining defects.  
  Без ещё одного “мини-спринта на 5 мелочей”.

&nbsp;

В остальном план сильный: scope удержан, reuse найден, delete contour собран правильно, и новый комментарий про scroll/table/bulk/delete не потерян.

&nbsp;

План: Финальный добивающий sprint — regression + каноническая таблица эфиров + delete-flow

## Discovery

**Текущее состояние `/admin/live-events`:**

- Это **уже `<Table>**`, не карточки (lines 865–876). Но обёрнут в `<Card><CardContent p-0>` без `ScrollArea`, без sticky header, **без чекбоксов**, **без bulk-toolbar**, без scroll-контейнера. Колонка actions содержит вертикальный стек `RoomLifecycleActions` + ряд иконок c `min-w-[280px]` (line 928) — это и есть «ощущение карточек» и horizontal overflow без скролла. Нет колонки «Активные участники» (компонент `RoomStateCell` есть, но без отдельной колонки count). Нет single-row delete.
- Query: `["admin-live-events"]`, `select("*")` без пагинации (все эфиры разом).
- **Удаление эфиров вообще отсутствует** в коде — ни single, ни bulk.

**Эталоны из проекта (reuse, не плодим новое):**

- `AdminContacts.tsx` — sticky header, `<Checkbox>` selection, `ScrollArea`, AlertDialog для delete.
- `src/components/admin/BulkActionsBar.tsx` — готовый sticky-bar с props `onBulkDelete`, `onSelectAll`, `selectedCount`, `totalCount`, `entityName`. Используется уже в `AdminTrainingModules`, `Forms`, `Preregistrations`.
- `src/components/admin/forms/FormsBulkActionsBar.tsx` + `useFormsBulkDelete` — готовый паттерн: `BulkActionsBar` + AlertDialog с summary. Скопируем подход.

**Kinescope API (`supabase/functions/kinescope-api/index.ts`):**

- Поддерживает: `create_live_event`, `enable/complete/get/list/sync_live_event`, `get_video`, `list_videos`. **Нет `delete_live_event` и `delete_video**` — добавим в add-only режиме (REST: `DELETE /v2/live/events/{id}` и `DELETE /v1/videos/{id}`).

**Lifecycle / SoT — не трогаем.** `room_state`, `live-event-lifecycle`, `liveRoomLifecycle.ts`, тема, waiting-state, participant count — всё остаётся как есть. Только presentation-layer таблицы + delete contour + regression run.

---

## PATCH F1 — единый runtime regression Sprint 1+2+3

Прогон чек-листа `docs/SPRINT_FINAL_REGRESSION.md` (39 пунктов) в формате двух сессий (admin / user) на тестовом эфире `testovyy-vebinar-200416` с QA-аккаунтами.

**Формат отчёта:** для каждого пункта — `passed / failed / partial` + ссылка на скрин/SQL-proof для критичных (lifecycle transitions, moderation 2 окна, waiting→live без сброса scroll, degraded provider).

**Не блокирует код-патчи F2–F7** — выполняется после них на готовой админке, чтобы regression сразу включал и новый delete-flow.

---

## PATCH F2 — scroll-фикс на `/admin/live-events`

Один атомарный фикс презентации (lines 862–950 `AdminLiveEvents.tsx`):

- Заменить `<Card><CardContent p-0><Table>` на `<div className="rounded-md border bg-card"><div className="overflow-x-auto"><Table>` — горизонтальный скролл при узком viewport.
- `TableHeader` → `sticky top-0 z-10 bg-card` для удержания заголовка при вертикальном скролле страницы.
- Убрать `min-w-[280px]` с ячейки actions → ввести фиксированную узкую колонку «Действия» (icon-only Edit/Open/Delete) **+ отдельную колонку «Lifecycle»** для `RoomLifecycleActions` (она и так логически отдельная).
- Для длинных значений в ячейках — `truncate max-w-[XXXpx]` + tooltip на title.

DoD: на 1102px viewport нет обрезанных колонок; sticky header работает; нет вложенных мёртвых scroll-зон.

---

## PATCH F3 — каноническая табличная раскладка

Привести колонки и стиль строго к эталону `AdminContacts`:


| #   | Колонка             | Источник                                                                                             | Ширина |
| --- | ------------------- | ---------------------------------------------------------------------------------------------------- | ------ |
| 1   | ☑ checkbox          | local selection                                                                                      | `w-10` |
| 2   | Название            | `event.title` + slug под ним муtedmuted                                                              | flex   |
| 3   | Тип                 | `event_type` badge (Radio/Video)                                                                     | `w-32` |
| 4   | Lifecycle (комната) | `getRoomStateBadgeVM(room_state)` через `liveRoomLifecycle.ts`                                       | `w-32` |
| 5   | Источник            | provider_source_status badge с tooltip «Источник видео» (PATCH 3.7 уже сделан, добиваем consistency) | `w-32` |
| 6   | Опубликован         | `is_published`                                                                                       | `w-24` |
| 7   | Дата                | `scheduled_at` formatted                                                                             | `w-40` |
| 8   | Активные            | `useActiveParticipants(event.id)` → число + tooltip «Активные за 2 мин»                              | `w-20` |
| 9   | Запись              | `replay_enabled` ? «Доступна» : «—»                                                                  | `w-24` |
| 10  | Lifecycle actions   | `RoomLifecycleActions layout="admin"` (компактный)                                                   | `w-44` |
| 11  | Действия            | DropdownMenu: Редактировать / Открыть страницу / **Удалить…**                                        | `w-12` |


- `<TableRow>` — `hover:bg-muted/50 cursor-default`, double-click на строку → открыть редактор (как в Contacts).
- Старый карточный «хаос» (вертикальный стек кнопок в одной ячейке) → разнесён по колонкам Lifecycle (отдельная) и Действия (DropdownMenu).
- Никакой логики данных не меняем — только presentation. Все query/mutation остаются.

DoD: визуально и поведенчески таблица как `/admin/contacts`; одна терминология lifecycle через `liveRoomLifecycle.ts` (PATCH 3.7 reuse).

---

## PATCH F4 — row selection + select-all + BulkActionsBar

- `selectedIds: Set<string>` в state `AdminLiveEvents`.
- Чекбокс в каждой строке + master-checkbox в `TableHead` с tri-state (`checked` / `indeterminate` / `unchecked`) — `<Checkbox>` уже поддерживает indeterminate (`src/components/ui/checkbox.tsx`).
- При смене query-key (фильтры/refetch) — `setSelectedIds(new Set())`.
- Reuse существующего `BulkActionsBar` (`src/components/admin/BulkActionsBar.tsx`) с `entityName="эфиров"`, `onBulkDelete`, `onSelectAll`, `onClearSelection`. Не плодим новый.
- Новых bulk actions кроме delete сейчас не добавляем (по жёсткому правилу «не плодить лишнее без необходимости»).

DoD: можно выбрать N эфиров, видна плавающая bulk-bar с count, кнопка `Удалить…` открывает delete-dialog (PATCH F5).

---

## PATCH F5 — delete-flow (single + bulk) с двумя режимами

**Новый компонент** `src/components/admin/live/LiveEventDeleteDialog.tsx` (один — для single и bulk):

Props: `eventIds: string[]`, `onClose`, `onSuccess`.

Внутри:

1. **Загрузка summary** при открытии — клиентский `select id, title, kinescope_live_event_id, kinescope_video_id, room_state, replay_enabled from live_events where id in (...)`.
2. **Preview-блок:**
  - Всего выбрано: N
  - С привязкой к Kinescope live: M
  - С привязкой к Kinescope video: K
  - В состоянии `live`: L (warning если >0 — предлагаем сначала завершить)
3. **RadioGroup — выбор режима:**
  - `platform_only` — «Удалить только в платформе. Сущности в Kinescope сохранятся.»
  - `platform_and_provider` — «Удалить в платформе **и** связанные сущности в Kinescope (live events + видео-записи).»
4. Type-to-confirm: `confirmText === "УДАЛИТЬ"` для активации кнопки (как в опасных delete у нас в `useFormsBulkDelete`).
5. Submit → новая edge function `live-events-delete` (PATCH F6).
6. После успеха — `invalidateQueries(["admin-live-events"])` + clear selection + toast с summary `{ deleted, provider_deleted, provider_failed }`.

**Single delete** — та же кнопка `Удалить…` в DropdownMenu строки → открывает тот же диалог с одним id.

DoD: оба режима видны, явный confirm, summary до выполнения, нет silent destructive action.

---

## PATCH F6 — edge function `live-events-delete` (новая)

`supabase/functions/live-events-delete/index.ts` + добавление в `kinescope-api` двух actions: `delete_live_event`, `delete_video`.

**Контракт `live-events-delete`:**

```
POST { event_ids: string[], mode: 'platform_only' | 'platform_and_provider' }
→ { success, summary: { total, deleted, provider_attempted, provider_deleted, provider_failed: [{event_id, reason}] }, audit_id }
```

Логика:

1. Auth: JWT, проверка `has_role_v2(user, 'admin' | 'superadmin')` через `_shared/auth-guards.ts`.
2. Загрузка эфиров (`id, kinescope_live_event_id, kinescope_video_id, room_state`).
3. Guard: если есть эфир в `room_state = 'live'` — отказ 409 `cannot_delete_live` (нужно сначала завершить через lifecycle).
4. Если `mode = platform_and_provider`:
  - Для каждого эфира с `kinescope_live_event_id` — `kinescope-api delete_live_event`.
  - Для каждого с `kinescope_video_id` (replay) — `kinescope-api delete_video`.
  - Failures **не блокируют** локальный delete, но фиксируются в `summary.provider_failed[]` и в audit с `degraded:true`.
5. Локальный delete через `service_role`: `DELETE FROM live_events WHERE id = ANY($1)`. Связанные строки (`live_event_comments`, `live_event_questions`, `live_event_access_rules`, `live_active_sessions`, и т.д.) удалятся каскадом по существующим FK `ON DELETE CASCADE` — **проверим в discovery перед миграцией; если каких-то FK нет каскадом, добавим миграцией add-only `ALTER TABLE ... ON DELETE CASCADE**`.
6. Audit: `DomainEventService.emitEvent("live_event_deleted", actor, ...)` для каждого удалённого + сводный `live_events_bulk_deleted` со счётчиками.

**Kinescope-api добавление:**

```ts
case "delete_live_event": result = await makeV2Request(`/live/events/${live_event_id}`, apiToken, "DELETE"); break;
case "delete_video":      result = await makeV1Request(`/videos/${video_id}`, apiToken, "DELETE"); break;
```

- корректная обработка 404 (уже удалён) как успеха.

DoD: edge function отвечает 200 со summary; partial-failure прозрачен; single и bulk идут через один путь; audit пишется.

---

## PATCH F7 — consistency после delete

В UI после успеха:

- `queryClient.invalidateQueries({ queryKey: ["admin-live-events"] })` — рефетч списка.
- `setSelectedIds(new Set())` — clear selection.
- Если открыт edit-dialog для удалённого id → закрыть + toast «Эфир удалён».
- `queryClient.invalidateQueries({ queryKey: ["live-active-participants"] })` — убрать battle-counter удалённых из кэша.

В edge function:

- Перед локальным delete — `check_orphans` секция: убедиться, что нет висящих `live_access_proofs`, `live_event_audit_logs` без CASCADE → discovery sql покажет, нужна ли add-only миграция CASCADE.
- В отчёте F8 — orphan/guard-check ровно по этим таблицам.

DoD: после delete нет UI-мусора, нет 404 от висящих компонентов, orphan-check passed.

---

## PATCH F8 — финальная приёмка live-модуля

После F1–F7 — единый сводный отчёт:

1. Sprint 1/2/3 deferred runtime points — passed/failed по 39-пунктовому checklist (F1).
2. F2–F7 — diff-summary, изменённые файлы, новые edge functions.
3. Orphan/guard-check после delete — список таблиц + результат.
4. Финальный verdict: **принят** / **возвращён с consolidated patch list** (без новых дроблений).

---

## Изменяемые файлы (add-only, без удаления существующих веток)

**Новые:**

- `src/components/admin/live/LiveEventDeleteDialog.tsx` (PATCH F5)
- `supabase/functions/live-events-delete/index.ts` (PATCH F6)
- `supabase/migrations/<ts>_live_events_cascade_safety.sql` — **только если discovery покажет**, что какие-то связанные таблицы не имеют `ON DELETE CASCADE` к `live_events.id` (PATCH F6/F7)

**Изменяемые:**

- `src/pages/admin/AdminLiveEvents.tsx` (PATCH F2/F3/F4/F5/F7 — scroll wrap, sticky header, новые колонки, checkbox selection, BulkActionsBar wiring, delete dialog hookup)
- `supabase/functions/kinescope-api/index.ts` (PATCH F6 — два новых action: `delete_live_event`, `delete_video`)

**Не трогаем:** `liveRoomLifecycle.ts`, `live-event-lifecycle/`, `live-resolve/`, `RoomLifecycleActions.tsx`, тема, waiting-state, participant hook, role badges, moderation.

---

## DoD финального sprint

- `/admin/live-events` визуально и поведенчески = `/admin/contacts` (sticky header, scroll-обёртка, чекбоксы, selection, bulk-bar).
- Single и bulk delete работают через единый dialog с двумя режимами и type-to-confirm.
- Kinescope delete: success / partial-failure / silent-failure-нет (всё в summary + audit).
- Удалить `live`-эфир напрямую нельзя — guard 409.
- Sprint 1+2+3 не сломаны: `room_state`, lifecycle actions, waiting-state, participant count, тема, role badges.
- Полный regression checklist (39 пунктов) пройден и зафиксирован.
- Финальный verdict по live-модулю выдан.