# да, согласен, с учетом правок:

&nbsp;

1. **PATCH 3A — исправить создание live event в Kinescope**
  &nbsp;
  - Разобрать фактическую ошибку Ошибка: [object Object] и заменить на нормальный parse backend-error → user-friendly message.
  - В kinescope-api и AdminLiveEvents.tsx сделать нормализацию ответа Kinescope: показывать error.message, details, status, raw payload в console/log.
  - После нажатия **«Создать живой эфир в Kinescope»** сохранять:
    &nbsp;
    - kinescope_live_event_id
    - kinescope_project_id
    - provider status / provider payload в metadata
    &nbsp;
  - Добавить dry-run/proof:
    &nbsp;
    - реальный успешный create live event в Kinescope,
    - запись созданного kinescope_live_event_id в live_events,
    - скрин из UI без [object Object].
    &nbsp;
  &nbsp;
2. **PATCH 3B — не уводить ведущего в Kinescope, а дать управление у нас в админке**
  &nbsp;
  - Ничего не удалять из текущего recorded/autowebinar flow.
  - Для live_stream добавить в админке отдельный блок **«Управление трансляцией»**:
    &nbsp;
    - статус эфира,
    - кнопка Создать эфир в Kinescope,
    - кнопка Запустить эфир,
    - кнопка Завершить эфир,
    - кнопка Обновить статус,
    - блок настроек источника/RTMP/OBS, если Kinescope API возвращает эти данные; если API не возвращает — явно зафиксировать это как provider limitation и не прятать.
    &nbsp;
  - Под этим же блоком добавить живую правую колонку/вкладки:
    &nbsp;
    - комментарии,
    - вопросы,
    - список участников/кто вошёл,
    - basic moderation actions.
    &nbsp;
  - Цель: преподаватель работает из нашей админки, а не через отдельное окно Kinescope, насколько это позволяет API.
  &nbsp;
3. **PATCH 3C — разделить две сущности в UI и логике**
  &nbsp;
  - В админке и шаблонах явно разделить:
    &nbsp;
    - **Живой эфир**
    - **Эфир в записи / автовебинар**
    &nbsp;
  - Не смешивать их readiness.
  - Для live_stream обязательны:
    &nbsp;
    - title
    - slug
    - kinescope_live_event_id
    - scheduled_at
    - access rules
    &nbsp;
  - Для recorded_webinar обязательны:
    &nbsp;
    - title
    - slug
    - kinescope_video_id
    - access rules
    &nbsp;
  - Везде в UI показывать читаемые подписи, какой именно тип сейчас настраивается.
  &nbsp;
4. **PATCH 4A — вернуть sidebar на пользовательскую страницу /live**
  &nbsp;
  - LiveEvents.tsx обернуть в DashboardLayout, чтобы страница списка эфиров была полноценной частью пользовательского кабинета.
  - /live/:slug оставить без sidebar только если это осознанный full-screen player mode; если нет — сделать единое решение и зафиксировать его.
  - Нужен proof:
    &nbsp;
    - скрин /live с боковым меню,
    - переход из меню пользователя в раздел «Эфиры».
    &nbsp;
  &nbsp;
5. **PATCH 4B — пользовательский раздел “Эфиры” сделать полноценным**
  &nbsp;
  - В меню пользователя оставить пункт **«Эфиры»**.
  - Страница /live должна показывать:
    &nbsp;
    - только доступные пользователю эфиры,
    - тип эфира,
    - статус,
    - время в локальной зоне пользователя,
    - признак live/replay/scheduled.
    &nbsp;
  - Проверить secure filtering server-side через live-events-list, не client-side.
  &nbsp;
6. **PATCH 5A — исправить выбор эфира в BroadcastTemplateDialog**
  &nbsp;
  - Сейчас эфир виден, но **не выбирается**.
  - Проверить и исправить:
    &nbsp;
    - SelectItem disabled,
    - value/onValueChange,
    - readiness-блокировку,
    - pointer/focus issue внутри dialog.
    &nbsp;
  - Если эфир не готов к приглашениям — он должен быть либо:
    &nbsp;
    - явно disabled с понятной причиной,
    - либо selectable, но с предупреждением.
    &nbsp;
  - Нельзя оставлять состояние “видно, но выбрать невозможно без объяснения”.
  - В карточке/строке выбора показывать причину:
    &nbsp;
    - черновик,
    - не опубликован,
    - нет даты,
    - не создан источник Kinescope,
    - нет правил доступа.
    &nbsp;
  - Нужен proof:
    &nbsp;
    - минимум один live_stream selectable,
    - минимум один recorded_webinar selectable,
    - минимум один not-ready item с понятной причиной.
    &nbsp;
  &nbsp;
7. **PATCH 5B — readiness для приглашений сделать отдельным и прозрачным**
  &nbsp;
  - В BroadcastTemplateDialog readiness считать отдельно от publish/save.
  - Для live_stream:
    &nbsp;
    - published
    - есть дата/время
    - есть provider live source
    &nbsp;
  - Для recorded_webinar:
    &nbsp;
    - published
    - есть video source
    &nbsp;
  - В UI текстами, без технических фраз.
  &nbsp;
8. **PATCH 5C — после создания/сохранения эфира дать прямой CTA**
  &nbsp;
  - После save/create:
    &nbsp;
    - если ready → кнопка Создать приглашение
    - если not ready → список, что осталось доделать
    &nbsp;
  - Убрать “замкнутый круг”, когда эфир создан, но дальше непонятно, что мешает отправить приглашение.
  &nbsp;
9. **PATCH 6A — proof-пакет по PATCH 4–6 сделать полностью**
  &nbsp;
  - Обязательный runtime-proof:
    &nbsp;
    - /live с sidebar,
    - /live/:slug открывается,
    - comments работают,
    - questions работают,
    - live-events-list реально фильтрует по доступу,
    - BroadcastTemplateDialog реально позволяет выбрать готовый эфир,
    - recorded flow не сломан.
    &nbsp;
  - Для comments/questions:
    &nbsp;
    - insert под обычным пользователем,
    - delete/toggle answered под admin,
    - realtime update или минимум invalidate proof.
    &nbsp;
  - Для live_stream:
    &nbsp;
    - реальный create в Kinescope,
    - реальный ID сохранён,
    - эфир проходит readiness до состояния selectable в шаблоне.
    &nbsp;
  &nbsp;
10. **PATCH 6B — redesign ошибок и статусов**
  &nbsp;
  - Любая backend ошибка — не [object Object], а нормальный human-readable alert.
  - Для операций Kinescope показывать:
    &nbsp;
    - что делали,
    - что вернул provider,
    - что сохранить/исправить дальше.
    &nbsp;
  - Все блокеры readiness выделять списком прямо под действием, а не общим красным тостом.
  &nbsp;
11. **PATCH 6C — зафиксировать долгосрочную цель live admin console**
  &nbsp;
  - Текущий спринт: сделать рабочий live event lifecycle + шаблоны + user section + comments/questions.
  - Следующий слой в этом же направлении, без удаления текущего:
    &nbsp;
    - единая внутренняя консоль ведущего на нашей платформе,
    - управление эфиром,
    - просмотр комментариев/вопросов/участников,
    - продажи и аналитика по действиям участников.
    &nbsp;
  - Всё это add-only, recorded/autowebinar flow не ломать.
  &nbsp;
12. **DoD обновить**
  &nbsp;
  - live_stream реально создаётся в Kinescope из нашей админки.
  - Ошибка [object Object] устранена.
  - Эфир после создания проходит в состояние, где его можно выбрать в шаблоне приглашения.
  - /live имеет sidebar и виден в пользовательском меню.
  - BroadcastTemplateDialog позволяет выбрать готовый эфир.
  - Комментарии и вопросы работают с access-aware RLS.
  - Recorded flow не сломан.
  - Есть proof по каждому пункту, а не только описание кода.
  &nbsp;

&nbsp;

&nbsp;

План: Proof-пакет PATCH 4–6 + исправление отсутствующего sidebar

## Диагностика

### Найденные проблемы

1. **Нет sidebar на /live и /live/:slug** — Routes зарегистрированы напрямую без `DashboardLayout`. Все другие пользовательские страницы (`/dashboard`, `/knowledge`, `/money` и т.д.) оборачиваются в `DashboardLayout` внутри компонента страницы (например, `Dashboard.tsx` импортирует `DashboardLayout`). Страницы `LiveEvents.tsx` и `LiveEvent.tsx` этого не делают — отсюда отсутствие левого меню.
2. **Только 1 тестовый эфир** — `recorded_webinar`, не опубликован, без kinescope_video_id. Для proof нужен хотя бы один опубликованный эфир с доступом.
3. **RLS корректен** — comments/questions используют `user_has_live_event_access`, admin delete через `has_role_v2`.
4. **Realtime включён** — таблицы добавлены в `supabase_realtime`.

---

## Что нужно сделать

### 1. Обернуть LiveEvents.tsx в DashboardLayout

Импортировать `DashboardLayout` и обернуть контент — так же, как сделано в Dashboard, Knowledge и других user pages. Это вернёт sidebar.

### 2. LiveEvent.tsx — оставить без DashboardLayout (намеренно)

Страница просмотра эфира — full-screen player. Sidebar будет мешать просмотру. Это стандартное поведение для video player pages.

### 3. Runtime proof: secure filtering через live-events-list

- Вызвать edge function от имени текущего пользователя
- Проверить, что неопубликованные и недоступные эфиры не возвращаются
- Проверить ответ при отсутствии доступа

### 4. Runtime proof: comments/questions RLS

- Попробовать INSERT в comments через RLS (от текущего пользователя)
- Проверить SELECT/DELETE для admin

### 5. Runtime proof: BroadcastTemplateDialog

- Визуально проверить через browser, что dialog показывает эфиры с readiness badges

### 6. Runtime proof: recorded flow без регрессии

- Проверить, что live-resolve по существующему slug возвращает корректный ответ
- Проверить, что admin page загружается без ошибок

---

## Файлы


| Файл                       | Действие                                  |
| -------------------------- | ----------------------------------------- |
| `src/pages/LiveEvents.tsx` | Обернуть в DashboardLayout                |
| Runtime proofs             | curl edge functions + browser screenshots |


## DoD

- Sidebar виден на /live
- Все runtime proofs собраны и задокументированы
- Recorded flow не сломан