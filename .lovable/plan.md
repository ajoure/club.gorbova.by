## да, согласен, с учетом правок:

1. **Зафиксируй, что destructive-cases выполняются в самом конце и только после полного runtime-proof недеструктивных сценариев.**  
В текущем плане это есть общо, но нужно явно разделить:
  - сначала сценарии 1–23;
  - только потом 24 и destructive actions (`Пересоздать источник`, `Отвязать`, `Удалить эфир`);
  - перед каждым destructive действием — отдельный snapshot БД + UI proof.
2. **В шаге 1.1 добавь обязательную проверку всех фактических source-полей не только в** `live_events`**, но и в коде резолвера.**  
Нужно явно сопоставить:
  &nbsp;
  &nbsp;
  - что реально хранится в БД;
  - что реально читает `live-resolve`;
  - что реально рендерит `/live/:slug`.  
  И вывести mapping: `DB field -> live-resolve payload -> player prop -> фактический рендер`.
3. **В шаге 1.2 добавь обязательный поиск не только по строкам UI, но и по компонентам-обёрткам dialog/sheet/card.**  
Часто нужный JSX рендерится через вложенные секции.  
Нужно явно найти:
  - где собирается модалка редактирования;
  - где подключается блок источника;
  - нет ли отдельного дочернего компонента OBS/source card.
4. **В шаге 1.3 добавь проверку на StrictMode / двойной mount в dev-preview.**  
Для аудио и player duplication это критично.  
Нужно зафиксировать:
  - есть ли двойной mount в preview/dev;
  - воспроизводится ли проблема в production-like preview;
  - не является ли loop артефактом dev-режима.
5. **В шаге 2 (фикс карточки OBS) добавь отдельный DoD по контентной читаемости.**  
Не только “ничего не вылазит”, но и:
  - RTMP и ключ можно полностью скопировать;
  - длинные значения не ломают layout;
  - кнопки copy/open/recreate/detach не прыгают по высоте;
  - на mobile карточка остаётся читаемой без горизонтального скролла.
6. **В шаге 3 (forensic-аудит) добавь обязательный вывод “что пусто и почему это допустимо / недопустимо”.**  
Не просто перечень полей, а классификация:
  - обязательное и заполнено;
  - обязательное и пусто = баг;
  - допустимо пустое;
  - legacy / deprecated / не участвует в текущем flow.
7. **В шаге 4 (аудио) добавь обязательную проверку без автоплея/без второго открытого источника на клиенте.**  
Нужно исключить ложный loop из-за:
  - одновременно открытого Kinescope preview и нашей комнаты;
  - второго таба;
  - включённого мониторинга в OBS;
  - наложения room player + provider preview.
8. **В шаге 5 добавь отдельный блок “RBAC / staff / employee”.**  
Так как эфирная комната уже дорабатывалась по ролям, в regression нужно отдельно проверить:
  - employee видит только разрешённые действия;
  - employee не может управлять CTA/show-hide;
  - admin может remove/restore;
  - non-staff не может открыть карточку пользователя;
  - private reply/private activity не видны лишним ролям.
9. **В шаге 5 для room regression добавь отдельную проверку theme/CTA coexistence.**  
Сейчас это реальная зона риска.  
Нужно проверить:
  - theme применяется и не ломает читаемость;
  - product-linked CTA не дублируется с legacy CTA;
  - при наличии нового CTA legacy блок не рендерится в той же позиции;
  - CTA не ломает mobile input и chat layout.
10. **В шаге 5 для exports/scenario добавь проверку privacy.**  
Нужно явно проверить:
  - private replies не утекают в export для не-staff;
  - scenario/export содержит CTA events;
  - visibility_scope сохраняется корректно.
11. **Сценарий 24 “Удаление эфира → cascade” вынеси в отдельный optional destructive suite.**  
Для задачи “максимально протестировать эфир перед боевым запуском” это не ключевой блокер приёмки комнаты.  
Его лучше пометить как:
  - optional destructive;
  - выполнять только если отдельно нужен proof cascade.
12. **Добавь отдельный финальный вывод “Go / No-Go для живого эфира”.**  
После матрицы из 24 сценариев нужен короткий итог:
  - `GO` — можно выходить в живой эфир;
  - `GO WITH KNOWN LIMITATIONS`;
  - `NO-GO`.  
  С перечислением именно блокирующих пунктов.
13. **В участие Сергея добавь правило: сначала исполнитель готовит всё к тесту и только потом запрашивает короткое окно OBS.**  
Чтобы не тратить время на ожидание во время discovery.  
Последовательность:
  - discovery;
  - фиксы, которые можно сделать без OBS;
  - подготовка checklist;
  - потом короткое окно на OBS live-run.
14. **В финальный отчёт добавь отдельный раздел “root cause / fix / остаточный риск”.**  
Для каждого найденного бага:
  - root cause;
  - что исправлено;
  - как доказано;
  - есть ли остаточный риск.
15. **Итоговый DoD усили.**  
Добавь:
  - есть явный `Go / No-Go` verdict;
  - отдельно перечислены blocker-баги и неблокирующие замечания;
  - destructive suite отделён от основного regression;
  - все проверки RBAC/privacy/CTA/theme включены в итоговую матрицу.

&nbsp;

Если нужно, следующим сообщением я соберу это в **готовый копируемый блок для [Lovable.dev](http://Lovable.dev)** без комментариев.

&nbsp;

План v2: фикс карточки OBS + полный regression эфиров

### Hard-stop / safety

- Тестировать только на эфире **"Тестовый Сергей"**.
- Не трогать боевые эфиры, `live_event_access_rules`, notifications path, job #42, kill-switch, proof_mode.
- Ничего не публиковать наружу.
- Destructive actions (Пересоздать источник / Отвязать / Удалить) — только после полного snapshot proof и только в рамках отдельного тест-кейса.
- Consultation draft / footer / routing / domain bindings — не трогать.

### Шаг 1 — Discovery (full tech-аудит, без предположений)

**1.1. Схема БД (SOT-аудит):**

- `information_schema.columns` для `live_events` — реальный список колонок.
- Структура `metadata` jsonb по тестовому эфиру: `obs_data`, `provider_source_status`, `last_synced_at`, и любые `kinescope_*` ключи.
- Связанные таблицы: `live_event_runtime`, `live_event_sessions`, `live_event_access_rules`, `domain_events` (фильтр по `live_event_id`), audit logs.
- Запрет: не строить тест-план на полях, которых нет в схеме.

**1.2. UI-компоненты:**

- Поиск по строкам `"Настройки трансляции (OBS)"`, `"RTMP сервер"`, `"Ключ трансляции"`, `"Источник трансляции"`, `"Запустить эфир"`, `"Пересоздать источник"`, `"Отвязать"` в `*.tsx`.
- Найти точный компонент модалки `/admin/live-events` → "Редактировать эфир".
- Проверить condition branches / feature flags / alternate dialog bodies (не рендерится ли карточка из двух мест).
- Зафиксировать: имя файла + строки JSX, которые реально рендерят то, что на скриншоте.

**1.3. Room player:**

- Найти player-компонент комнаты `/live/:slug`, все места mount/unmount.
- Проверить: не создаются ли две инстансы плеера одновременно (legacy + new branch).
- Проверить realtime/subscription/useEffect на повторный mount.
- Проверить iframe duplication.

**1.4. Edge functions / logs:**

- `kinescope-*`, `live-resolve`, `live-events-*` — логи по `live_event_id` тестового эфира за окно теста.

### Шаг 2 — Фикс карточки OBS (visual patch + component proof)

После того как в 1.2 найден реальный компонент:

- Стандарт contact card: `bg-card border border-border rounded-lg shadow-sm`.
- Поля: read-only input + унифицированные icon-кнопки `variant="outline" size="icon" h-9 w-9`.
- `min-w-0`, `overflow-hidden`, `truncate`/`break-all` для RTMP/key — никакого вылета.
- Action-кнопки одинаковые `h-10`, `gap-2`, `flex-wrap`.

**DoD блока:**

- Имя файла + участок JSX в отчёте.
- Screenshot до/после на 1102px и 440px.
- Подтверждение, что изменён именно тот компонент, который рендерится в `/admin/live-events`.

### Шаг 3 — Forensic-аудит эфира "Тестовый Сергей"

Отчёт включает:

- Все source-поля (фактические значения, по реальной схеме из 1.1).
- `metadata.obs_data`, `provider_source_status`, `platform_status`, sync/update timestamps.
- Runtime/session записи.
- Domain events / audit logs по `live_event_id`.
- Релевантные edge-function логи.

### Шаг 4 — Локализация аудио-бага (3 точки)

Проверка по слою:

1. **OBS preview/monitoring** — есть ли loop уже в OBS.
2. **Kinescope preview/watch URL** — есть ли loop на стороне провайдера.
3. **Наша комната `/live/:slug**` — есть ли loop только у нас.

Правило:

- Loop уже в (1) или (2) → это **не** room-bug, оформляется ops-note (рекомендованные OBS-настройки: 48 kHz, stereo, 128–160 kbps, без monitoring loopback) + шаги воспроизведения.
- Loop только в (3) → ищем double mount / двойной audio source / iframe duplication, фиксим в коде.

### Шаг 5 — Тест-матрица (regression полный, не только видео)

**Среды:** desktop Chrome (обязательно) + mobile (preview viewport 390×844). Прочие — best-effort, явно пометить blocked/not tested.

**A. Source lifecycle:**

1. Эфир без источника → создать источник.
2. Автосоздание источника при создании эфира → поля сохранены.
3. `Обновить источник` → актуальный state.
4. `Пересоздать источник` → IDs и OBS data обновлены.
5. `Отвязать источник` → linkage очищен, эфир как сущность жив.
6. Source missing/broken → controlled UI, без чёрного блока.
7. Source exists, но `platform_status != live` → controlled UI.
8. Manual override IDs в карточке → не ломает источник.

**B. OBS / live-цикл:**
9. Скопировать RTMP+key → OBS connect → `Запустить эфир` → статус `live` в Kinescope и у нас.
10. Остановка эфира → запись доступна → `watch_url` рабочий.
11. live → replay переход без двойного источника.

**C. Room (single-player + audio duplication):**
12. В DOM ровно один player container, один iframe/instance.
13. Refresh / повторное открытие — нет дублирования звука.
14. Переключение Chat / Questions / CTA — player не remount без причины.

**D. Engagement & moderation:**
15. Comments, questions, replies (public/private).
16. Moderation: delete/hide message, mute/unmute.
17. Remove / restore from room (admin-only).
18. Open contact card (staff guard).

**E. Scenario / CTA / exports:**
19. Scenario timeline корректно фиксирует runtime events.
20. Sales blocks / product-linked CTA: show/hide, нет дублирования с legacy CTA.
21. Employee не управляет CTA (RBAC guard).
22. Export включает CTA events.

**F. Access:**
23. Эфир виден только тем, у кого `live_event_access_rules`.

**G. Cleanup:**
24. Удаление эфира → cascade корректный.

По каждому пункту: **подтверждено / не подтверждено / blocked / not tested**.

### Шаг 6 — Финальный отчёт (4 блока доказательств)

1. **UI proof** — скрины (карточка до/после, room, CTA, OBS-карточка на 1102 и 440).
2. **SQL proof** — реальные поля `live_events`, `metadata`, runtime/sessions, domain events.
3. **Edge/log proof** — relevant function logs за окно теста.
4. **Scenario result matrix** — таблица по 24 сценариям из Шага 5.

Плюс отдельный mini-блок:

- `live_event_id` тестового эфира,
- состояние source-полей до/после,
- `footer added = N/A` (не относится к этой задаче),
- список изменённых файлов.

### Участие Сергея (минимальное)

Исполнитель делает сам: discovery, SQL-аудит, фикс карточки, room regression, proof.
От Сергея требуется только короткое окно на:

- запуск OBS;
- старт/стоп тестовой трансляции;
- подтверждение, где именно слышен loop (OBS / Kinescope / room).

### DoD (итоговый)

- Подтверждена фактическая схема source-данных (не предположения).
- Найден точный компонент OBS-карточки, изменён именно он, есть proof.
- Карточка визуально соответствует contact card, ничего не вылазит на 1102 и 440.
- Forensic-отчёт по "Тестовый Сергей" со всеми реальными полями.
- Полный room regression (24 сценария), а не только видео.
- По каждому сценарию: подтверждено / не подтверждено / blocked / not tested.
- Аудио-баг: либо код-фикс, либо доказано, что root cause вне нашего UI + ops-note.
- Финальный отчёт = 4 блока доказательств (UI / SQL / Edge / Matrix).
- Hard-stop соблюдён: боевые эфиры не тронуты, ничего не опубликовано.