# да, согласен, с учетом правок:

1. В Этапе 2.2 отдельно зафиксируй, что после каждого lifecycle-перехода нужно проверить **не только badge/state**, но и:
  - доступность правильных следующих кнопок;
  - disabled-state недопустимых действий;
  - отсутствие рассинхрона между `room_state` и `platform_status`.
2. В Этапе 2.3 для второго пользователя не ограничиваться только opened/live/completed. Добавь явную проверку:
  - в `opened` плеера нет, чат/вопросы есть;
  - в `live` плеер появляется без потери чата;
  - в `completed` корректно отрабатывает ветка `replay` / `без replay`.
3. В Этапе 4 для delete-flow зафиксируй, что mixed bulk-selection должен включать:
  &nbsp;
  &nbsp;
  - обычный эфир;
  - эфир с provider-linkage;
  - `live`-эфир, который должен быть пропущен.  
  В summary обязательно показать `deleted / skipped_live / provider_attempted / provider_deleted / provider_failed`.
4. В Этапе 5.2 добавь явный security-check:
  - у non-staff во вкладке комнаты имя/аватар **не кликабельны**;
  - в DOM нет `onClick`/pointer-affordance на чужих профилях;
  - в participant UI не утекли email/phone/internal data.
5. В Этапе 5.3 зафиксируй, что SoT-проверка должна показать не только counts, но и **совпадение конкретных новых сообщений**:
  - текст комментария;
  - текст вопроса;
  - timestamps;
  - правильный `live_event_id`.
6. В Этапе 6.1 если participant count считается по heartbeat/session-модели, в отчёте обязательно указать:
  - формулу;
  - окно активности;
  - distinct по чему именно считается (`user_id`, `session_id` и т.д.);
  - это realtime или approximation.
7. В Этапе 6.3 если лимит по зрителям не подтверждается ни кодом, ни конфигом, ни provider payload, статус должен быть не “confirmed”, а `unknown / requires provider confirmation`. Не делать выводов по предположению.
8. В Этапе 7 добавь отдельный раздел:
  - **Blockers fixed during test pass**  
  с точным списком файлов и минимальным diff-summary, если в ходе теста всё же пришлось чинить blocker.

&nbsp;

В остальном план сильный: он покрывает весь модуль эфиров целиком, а не только последний патч, и подходит для одного финального полного тест-прохода.

&nbsp;

План: финальное полное тестирование блока «Эфиры» (Sprint 1 + 2 + 3 + follow-ups)

## Принципы

- Это **тест-проход**, не новый код-спринт. Код меняем только если найден blocker — точечно, с фиксацией в отчёте.
- Один consolidated отчёт в конце, без дробления на микро-циклы.
- Две роли: **admin** (Сергей Федорчук, уже залогинен в preview) и **обычный пользователь** (тест-аккаунт).
- Где можно — runtime через preview-браузер; где нельзя (БД, provider) — read-only SQL и edge-function logs.
- Каждый блок: **passed / failed / partial** + скриншот-proof.

---

## Этап 1 — Discovery тестовых данных (read-only, без UI)

Цель: подготовить почву, не создавая мусор.

1. SQL-discovery:
  - найти 1–2 эфира в каждом lifecycle-state (`closed`, `opened`, `live`, `completed`) для готовых сценариев;
  - подтвердить, что для test-user (`010e895e-...`, есть активность) уже есть `live_event_comments` + `live_event_questions`;
  - подтвердить mapping `contact -> profile -> user_id` для двух контактов с активностью.
2. Если нужного state нет — создаём минимальный тестовый эфир из admin UI на этапе 2.1.
3. Подтянуть `provider_account` / `live_events.provider` поля для этапа 6 (есть ли у Kinescope/CDN limit-метрика).

Артефакт: список ID эфиров + пользователей, который используется во всех последующих этапах (фиксируем в отчёте).

---

## Этап 2 — Проведение эфира E2E (admin runtime)

Через preview-браузер (admin сессия уже активна):

### 2.1 Создание

- `/admin/live-events` → «Создать эфир» → форма → save → запись появилась в таблице.
- Проверить: glass/tint кнопки, ширина lifecycle-кнопок в строке (`w-[184px]` × 3, h-9), стиль «Создать эфир» / «Справка» / «Пересоздать».

### 2.2 Lifecycle (closed → opened → live → completed)

Нажать последовательно три кнопки в строке таблицы. После каждого перехода:

- проверить badge state в **трёх местах**: list / edit dialog / room (`/live/<slug>` в новом таб-режиме);
- подтвердить отсутствие сброса формы / темы / CTA;
- замерить, что save формы НЕ меняет lifecycle-state.

### 2.3 Waiting / Live / Completed runtime

- В opened: зайти как **второй пользователь** (logout/login via preview password `123456`) → видны чат + вопросы + CTA, плеера нет.
- В live: admin отправляет комментарий, user отправляет комментарий и вопрос, появляется replay timeline.
- Complete → confirm dialog → проверить replay-state / «эфир завершён» branch.

---

## Этап 3 — Room UI/UX regression

Прогон viewport-ов через `set_viewport_size`: **1920×1080**, **1366×768**, **1102×893** (current), **mobile 390×844**.

В каждом виде проверить:

1. **Layout**: top видео == top Card-чата (pixel-screenshot proof); CTA сайдбара под чатом, не выше.
2. **Theme**: фон / панели / textarea / табы / badges / waiting / replay — все из CSS-переменных, не «протекает» за `.live-room-themed`.
3. **Roles/colors**: 5 типов сообщений (user, own, admin, employee, presenter), reply-quote.
4. **Mobile**: sticky input, auto-grow, safe-area, длинные сообщения, CTA не перекрывает input.
5. **Stability**: back/forward, reload, отсутствие remount плеера/чата.

---

## Этап 4 — Таблица `/admin/live-events`

Проверить:

- **Table-shell**: sticky header, horizontal/vertical scroll, resize/reorder/hide columns, locked checkbox + actions.
- **Buttons**: единый glass контракт (Создать / Открыть / Начать / Завершить / Пересоздать / Отвязать / Справка) — высота h-9, lifecycle-3 ровно `w-[184px]`, остальные `min-w-[148px]`, icon-only `w-9`.
- **Delete-flow**:
  - single delete (platform-only) — runtime;
  - bulk delete (mixed selection с одним live-эфиром) — пропуск live, summary, selection reset, refetch;
  - delete with Kinescope — **dry-run** через подтверждение, запись + provider-side вызов проверяем по edge-function logs, не по фактическому удалению prod-эфира.

---

## Этап 5 — Карточка контакта → Анкеты → Вебинары

### 5.1 Security

- Logout → войти как обычный user → открыть свой кабинет → подтвердить: нет ContactDetailSheet, нет email/phone других участников в комнате, имена кликабельны только у staff.
- Logout → войти admin → подтвердить наличие chip «Вебинары» в `Анкеты`.

### 5.2 Activity E2E

1. Admin отправляет в комнате тестового эфира **новый** комментарий и вопрос (через runtime browser).
2. SQL-snapshot до/после: count в `live_event_comments` / `live_event_questions` для admin-user `+1/+1`.
3. `/admin/contacts` → карточка Сергея Федорчука → таб «Анкеты» → chip «Вебинары» (N).
4. Кликнуть chip → раскрыть нужный вебинар → **timeline**: новые записи видны, timestamp ≈ now, тип-бейдж `Чат`/`Вопрос`.
5. Подтвердить: визуально chip и список используют **тот же Card+Collapsible** паттерн, что соседние подвкладки.

### 5.3 SoT

- SQL-сверка counts из chip vs реальные `count(distinct live_event_id)`.
- Подтвердить, что данные читаются из `live_event_comments` + `live_event_questions`, **не** из `crm_activity_log`.

---

## Этап 6 — Participant count и provider limits

### 6.1 Алгоритм count в системе

- Read-only: посмотреть `live_event_sessions` / `live_event_participants` / RPC `get_active_participants` (или эквивалент) — зафиксировать **формулу** (heartbeat window, distinct user_id, и т.д.).
- Сверить отображаемый badge participant count в room-header с реальным значением через SQL.

### 6.2 Provider-side

- Посмотреть `live_events.provider` / `provider_account` / metadata.
- Edge-function logs `live-resolve` / Kinescope/Bunny integration: есть ли в payload поле viewers/concurrent.
- Если provider не отдаёт current-viewers — зафиксировать честно: «count считается только серверной session-моделью».

### 6.3 Limits / concurrency

- Проверить: есть ли в БД таблица plans/limits, в metadata эфира `max_viewers`, в provider config concurrent_limit.
- Если нет ни одного источника — отчёт пишет «лимит на стороне платформы Lovable не задан; provider-лимит требует проверки в Kinescope dashboard и не может быть подтверждён из кода».

---

## Этап 7 — Финальный consolidated отчёт

Структура (на русском, один документ):

1. Создание и проведение эфира — passed / failed / partial.
2. Lifecycle — passed / failed / partial.
3. Комната / UI / mobile / replay — passed / failed / partial.
4. Таблица эфиров — passed / failed / partial.
5. Delete-flow — passed / failed / partial.
6. Карточка контакта / Анкеты → Вебинары — passed / failed / partial.
7. Participant count / provider limits — confirmed / partial / unknown (с цитатой источника).
8. Скриншоты-proof: создание, opened, live, completed/replay, admin-table с lifecycle-кнопками одной ширины, comments/questions в комнате, Анкеты→Вебинары в карточке, delete dialog, bulk delete summary, participant count badge.
9. Если фиксились blocker'ы — список файлов + diff-summary.
10. **Финальный verdict**:
  - модуль принят, **или**
    - consolidated список дефектов по приоритету: **blocker / major / minor**.

---

## Что НЕ делаем

- Не создаём новые таблицы / RPC / edge-functions.
- Не трогаем БД (write).
- Не удаляем prod-эфиры с Kinescope-source без явного подтверждения пользователя.
- Не правим стили/UI «попутно» — только если найден blocker, и фиксируем его в отчёте.

## DoD

- Все 7 этапов пройдены, по каждому — статус и proof.
- Найденные дефекты классифицированы и собраны в один список.
- Ответ по participant count и provider limits — с источником, без догадок.
- Один финальный consolidated verdict.