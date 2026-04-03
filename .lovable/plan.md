# да, согласен, с учетом правок:

&nbsp;

1. **sync_live_event должен возвращать не только status_code, но и нормализованный provider-state**
  &nbsp;
  - Добавить в response поля:
    &nbsp;
    - provider_source_status: ok | missing | broken | draft
    - provider_error_message
    - provider_stream_status
    &nbsp;
  - UI не должен сам догадываться по комбинации 404 / нет stream / нет play_link.
  &nbsp;
2. **Ввести два отдельных статуса**
  &nbsp;
  - Не смешивать состояние источника и состояние последней синхронизации.
  - Нужны:
    &nbsp;
    - provider_source_status: draft | ok | missing | broken
    - provider_sync_status: idle | syncing | success | error
    &nbsp;
  - Это уберёт путаницу в control panel и readiness.
  &nbsp;
3. **Пересоздание разрешать только при наличии обязательных идентификаторов**
  &nbsp;
  - Для recreate проверить:
    &nbsp;
    - kinescope_folder_id
    - kinescope_project_id
    &nbsp;
  - Если чего-то нет, кнопка неактивна, под ней явный blocker:
    &nbsp;
    - «Не выбрана папка live-эфиров»
    - «Не выбран проект для записи»
    &nbsp;
  &nbsp;
4. **provider_history[] сохранить в полной, но безопасной структуре**
  &nbsp;
  - Для history хранить:
    &nbsp;
    - live_event_id
    - stream_id
    - play_link
    - rtmp_link
    - streamkey_masked или has_streamkey=true
    - provider_stream_status
    - detached_at
    - reason
    &nbsp;
  - Полный streamkey в history не дублировать без необходимости.
  &nbsp;
5. **Сделать каноническую структуру metadata**
  &nbsp;
  - Использовать:
    &nbsp;
    - metadata.provider.current
    - metadata.provider_history[]
    &nbsp;
  - Не хранить дубли provider-данных в нескольких разных ветках metadata без явной причины.
  &nbsp;
6. **Top-level поля всегда синхронизировать с provider.current**
  &nbsp;
  - При recreate:
    &nbsp;
    - обновлять kinescope_live_event_id
    - обновлять kinescope_stream_id
    &nbsp;
  - При detach:
    &nbsp;
    - очищать kinescope_live_event_id
    - очищать kinescope_stream_id
    &nbsp;
  - При обнаружении replay:
    &nbsp;
    - обновлять kinescope_video_id
    - переводить platform_status в replay_available
    &nbsp;
  &nbsp;
7. **detach и recreate вынести в отдельные обработчики**
  &nbsp;
  - Не держать эту логику прямо внутри JSX/control panel.
  - Нужны отдельные методы:
    &nbsp;
    - handleSyncProvider
    - handleRecreateProvider
    - handleDetachProvider
    &nbsp;
  - Это уменьшит риск дальнейшей поломки перегруженного AdminLiveEvents.tsx.
  &nbsp;
8. **После sync/recreate/detach обязательно пересчитывать readiness и доступность кнопок**
  &nbsp;
  - Не ограничиваться только invalidateQueries.
  - Если editor открыт, локальный state тоже должен обновляться сразу, чтобы badge/кнопки/блокеры менялись без перезахода.
  &nbsp;
9. **В BroadcastTemplateDialog показывать точную причину именно для live-stream**
  &nbsp;
  - Отдельные причины:
    &nbsp;
    - «Источник трансляции не создан»
    - «Источник трансляции удалён в Kinescope»
    - «Источник трансляции повреждён»
    &nbsp;
  - Не сводить всё к общему “Не готов”.
  &nbsp;
10. **Confirm dialog усилить**
  &nbsp;
  - Для recreate и detach явно показать:
    &nbsp;
    - ссылка /live/:slug сохранится
    - комментарии и вопросы сохранятся
    - меняется только provider-source
    - приглашения начнут работать только после повторной readiness-проверки
    &nbsp;
  &nbsp;
11. **Audit meta сделать доказуемым**
  &nbsp;
  - Для событий
    &nbsp;
    - live_provider_synced
    - live_provider_missing
    - live_provider_recreated
    - live_provider_detached
    &nbsp;
  - записывать в meta:
    &nbsp;
    - platform_live_event_id
    - old_provider_live_event_id
    - new_provider_live_event_id
    - old_stream_id
    - new_stream_id
    - reason
    - provider_source_status_before
    - provider_source_status_after
    &nbsp;
  &nbsp;
12. **DoD усилить runtime-proof**
  &nbsp;
  - Обязательно показать отдельно:
    &nbsp;
    1. sync_live_event вернул 404 → UI показывает missing
    2. recreate создал новый provider-event и обновил top-level поля + metadata
    3. detach очистил provider-связку, но slug/comments/questions/access rules сохранены
    4. После recreate эфир снова становится selectable в BroadcastTemplateDialog
    &nbsp;
  &nbsp;
13. **Ничего не менять в recorded flow**
  &nbsp;
  - PATCH E применять только к event_type='live_stream'.
  - Для recorded_webinar новые provider-source проверки не должны блокировать существующий сценарий.
  &nbsp;

&nbsp;

&nbsp;

План: PATCH E — Пересоздание / перепривязка live event + provider status management

## Что есть сейчас

- `LiveStreamControlPanel` показывает данные провайдера и кнопки (Запустить / Завершить / Обновить статус)
- `handleSync` делает sync но не обрабатывает 404 (удалённый event в Kinescope)
- `sync_live_event` в edge function не возвращает `status_code` — нельзя отличить 404 от других ошибок
- Нет механизма пересоздания или отвязки провайдера
- Metadata перезаписывается без истории

---

## Изменения

### 1. Edge function: kinescope-api/index.ts

**sync_live_event** — добавить `status_code` в ответ:

```
result = {
  success: eventResult.success,
  status_code: eventResult.status_code,
  data: { event, videos, error }
}
```

Это позволит UI отличить 404 (deleted) от других ошибок.

### 2. LiveStreamControlPanel — полная переработка

Разбить на 3 визуальных блока:

**Блок A: Источник трансляции Kinescope**

- Dual badge: Платформа (scheduled/live/ended) + Kinescope (ok/missing/broken/draft)
- Provider source status определяется при sync:
  - `ok` — sync вернул 200 и есть stream
  - `missing` — sync вернул 404
  - `broken` — sync вернул 200, но нет stream/play_link
  - `draft` — kinescope_live_event_id пустой
- ID и время последней синхронизации

**Блок B: Настройки трансляции (OBS)** — без изменений (play_link, rtmp, streamkey)

**Блок C: Действия**

- **Обновить источник** — вызов sync_live_event (уже есть)
- **Пересоздать эфир** — новая кнопка с confirm dialog
- **Отвязать источник** — новая кнопка с confirm dialog
- **Запустить / Завершить** — существующие кнопки, но disabled если source status = missing/broken

### 3. Логика «Пересоздать эфир»

1. Сохранить текущие provider данные в `metadata.provider_history[]`
2. Вызвать `create_live_event` с текущими title, folder_id, project_id
3. Записать новые kinescope_live_event_id, stream_id, play_link, rtmp_link, streamkey в `metadata.provider.current`
4. Обновить top-level поля: kinescope_live_event_id, kinescope_stream_id
5. Записать audit event `live_provider_recreated`

Provider history entry:

```json
{
  "live_event_id": "old-id",
  "stream_id": "old-stream",
  "detached_at": "ISO",
  "reason": "recreated"
}
```

### 4. Логика «Отвязать источник»

1. Сохранить текущие provider данные в `metadata.provider_history[]` с reason = `manual_reset`
2. Очистить: kinescope_live_event_id, kinescope_stream_id
3. Очистить metadata.provider.current (но сохранить folder_id, project_id)
4. НЕ трогать: slug, title, access_rules, comments, questions
5. Записать audit event `live_provider_detached`

### 5. Авто-детект 404

В `handleSync`:

- Если `status_code === 404` → обновить provider source status на `missing`
- Показать badge "Источник удалён в Kinescope"
- Кнопки: Пересоздать / Отвязать доступны, Запустить — disabled
- Записать audit event `live_provider_missing`

### 6. Confirm dialogs

Для «Пересоздать эфир» и «Отвязать источник» — AlertDialog с текстом:

- Платформенная ссылка /live/:slug сохранится
- Комментарии и вопросы не потеряются
- Будет заменён/удалён только источник трансляции

### 7. Readiness update

В `validationItems` и в `BroadcastTemplateDialog.getEventReadiness`:

- Если kinescope_live_event_id есть, но provider source status = `missing` или `broken`:
  - Blocker: "Источник трансляции отсутствует или недоступен"
  - Эфир не selectable в шаблоне

### 8. Audit events

В handleSync (при 404), handleRecreate, handleDetach — вызывать `DomainEventService.emitEvent()` с event_type:

- `live_provider_synced`
- `live_provider_missing`
- `live_provider_recreated`
- `live_provider_detached`

---

## Файлы


| Файл                                                             | Действие                                                                                                   |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `supabase/functions/kinescope-api/index.ts`                      | sync_live_event: добавить status_code в response                                                           |
| `src/pages/admin/AdminLiveEvents.tsx`                            | LiveStreamControlPanel: добавить source status, recreate, detach, confirm dialogs, audit, provider_history |
| `src/components/admin/communication/BroadcastTemplateDialog.tsx` | getEventReadiness: учитывать provider source broken/missing                                                |


## DoD

1. sync_live_event при 404 показывает «Источник удалён в Kinescope» вместо общей ошибки
2. Кнопка «Пересоздать эфир» создает новый event и перепривязывает
3. Кнопка «Отвязать источник» очищает provider-связку без удаления платформенного эфира
4. Старые provider-данные сохраняются в metadata.provider_history[]
5. Confirm dialog предупреждает о последствиях
6. Dual badge показывает статус платформы и статус источника
7. BroadcastTemplateDialog не позволяет выбрать эфир с missing/broken source
8. Audit events записываются
9. Recorded flow не затронут