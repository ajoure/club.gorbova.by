# да, согласен, с учетом правок:

&nbsp;

1. **PATCH A расширить до proof-first, а не только fix поля record**
  &nbsp;
  - Перед финальным фиксированием payload обязателен один прямой runtime-proof через edge function:
    &nbsp;
    - сохранить в логах и/или в admin debug-block полный request payload;
    - сохранить полный raw response от Kinescope при create_live_event;
    - отдельно зафиксировать, какие поля реально обязательны для create: parent_id, record.parent_id, name, возможно type.
    &nbsp;
  - В DoD добавить не только 200, но и факт, что в ответе реально пришли:
    &nbsp;
    - id,
    - play_link,
    - [stream.id](http://stream.id),
    - rtmp_link,
    - streamkey.
    &nbsp;
  - Если какое-то из этих полей не приходит на create, делать обязательный follow-up get_live_event / sync_live_event сразу после create и уже оттуда добирать данные.
  &nbsp;
2. **Не затирать существующий metadata, а делать merge**
  &nbsp;
  - В AdminLiveEvents.tsx при сохранении live-stream нельзя перезаписывать metadata целиком.
  - Нужно merge:
    &nbsp;
    - старый metadata
    - kinescope_project_id
    - [provider.live](http://provider.live)_event
    - [provider.stream](http://provider.stream)
    - [provider.play](http://provider.play)_link
    - provider.rtmp_link
    - provider.streamkey
    - provider_status
    - last_provider_sync_at
    &nbsp;
  - Это обязательный add-only принцип для уже накопленных данных.
  &nbsp;
3. **Control Panel вынести в отдельную секцию только после успешного create**
  &nbsp;
  - До создания эфира:
    &nbsp;
    - выбор проекта,
    - кнопка создания,
    - понятный readiness.
    &nbsp;
  - После создания:
    &nbsp;
    - отдельный блок **«Управление трансляцией»**.
    &nbsp;
  - В этом блоке показать:
    &nbsp;
    - статус провайдера,
    - kinescope_live_event_id,
    - kinescope_stream_id,
    - play_link,
    - rtmp_link,
    - streamkey,
    - время последней синхронизации.
    &nbsp;
  - streamkey по умолчанию скрыт, с кнопкой показать/скрыть и копировать.
  &nbsp;
4. **Инструкцию ведущему заменить на рабочий операторский блок**
  &nbsp;
  - Не писать общий текст “идите в Kinescope”.
  - Сделать блок:
    &nbsp;
    - “Ссылка для просмотра”
    - “RTMP сервер”
    - “Ключ трансляции”
    - “Статус трансляции”
    - “Запустить эфир”
    - “Завершить эфир”
    - “Обновить статус”
    &nbsp;
  - Если для полного управления всё же нужен переход в Kinescope, оставить его как вторичную ссылку “Открыть в Kinescope”, а не как основной сценарий.
  &nbsp;
5. **PATCH C дополнить явным автопереходом readiness-состояний**
  &nbsp;
  - После успешного create live event:
    &nbsp;
    - снимать blocker “нет источника Kinescope”;
    - автоматически пересчитывать publish_ready;
    - если scheduled_at и access rules уже заполнены, показывать CTA:
      &nbsp;
      - “Опубликовать эфир”
      - после публикации — “Создать приглашение”.
      &nbsp;
    &nbsp;
  - В BroadcastTemplateDialog причина disabled должна быть не только “Черновик”, а конкретная:
    &nbsp;
    - “Не опубликован”
    - “Не задана дата”
    - “Не создан источник трансляции”
    - “Не заданы правила доступа”.
    &nbsp;
  &nbsp;
6. **Добавить обязательный PATCH D — sync provider → platform status**
  &nbsp;
  - При sync_live_event должен выполняться mapping статусов провайдера в platform lifecycle:
    &nbsp;
    - provider pending → scheduled
    - provider active/live → live
    - provider completed/finished → ended
    - если найдена запись и replay_enabled=true → replay_available
    &nbsp;
  - Сохранять в БД:
    &nbsp;
    - platform_status
    - provider raw status
    - last_provider_sync_at
    - найденный replay source.
    &nbsp;
  - Без этого control panel будет неполной.
  &nbsp;
7. **Добавить обязательный PATCH E — replay binding после завершения**
  &nbsp;
  - После complete_live_event или sync_live_event нужно:
    &nbsp;
    - вызвать get_live_event_videos;
    - если запись появилась, сохранить источник записи в kinescope_video_id или отдельный replay-source в metadata;
    - перевести эфир в replay_available, если это разрешено.
    &nbsp;
  - Это критично, чтобы одна и та же ссылка /live/:slug после живого эфира открывала запись, а не ломалась.
  &nbsp;
8. **Комментарии и вопросы встроить в admin control panel и в live page с одним источником данных**
  &nbsp;
  - Не дублировать модели.
  - Использовать уже созданные LiveEventComments и LiveEventQuestions, но:
    &nbsp;
    - на странице эфира для пользователя;
    - в админке в control panel для модерации.
    &nbsp;
  - Для admin view добавить:
    &nbsp;
    - счётчик комментариев,
    - счётчик вопросов,
    - быстрый фильтр “без ответа”.
    &nbsp;
  &nbsp;
9. **Сделать нормальный текст ошибок вместо raw API-сообщений**
  &nbsp;
  - Если create не удался:
    &nbsp;
    - не показывать только provider raw error;
    - показывать человекочитаемый текст + кнопку “Показать технические детали”.
    &nbsp;
  - Формат:
    &nbsp;
    - основной текст для пользователя,
    - код,
    - raw JSON в collapsible debug block.
    &nbsp;
  &nbsp;
10. **DoD усилить**

&nbsp;

&nbsp;

&nbsp;

- Недостаточно “вернул 200”.
- Финальный DoD по PATCH A–E:
  &nbsp;
  1. Create live event из админки успешен.
  2. В БД сохранены kinescope_live_event_id, kinescope_stream_id, provider metadata.
  3. В админке видны play_link, rtmp_link, streamkey.
  4. enable_live_event меняет статус на live.
  5. complete_live_event меняет статус на ended.
  6. sync_live_event подтягивает provider status и запись.
  7. После публикации эфир становится выбираемым в BroadcastTemplateDialog.
  8. После завершения и появления записи тот же /live/:slug работает как replay.
  9. Recorded flow не сломан.
  10. Все изменения подтверждены runtime-proof, а не только кодом.
  &nbsp;

&nbsp;

&nbsp;

&nbsp;

11. **Ничего из текущего recorded flow не удалять**

&nbsp;

&nbsp;

&nbsp;

- Обязательно зафиксировать в плане отдельно:
  &nbsp;
  - текущий выбор видео из Kinescope v1,
  - manual kinescope_video_id,
  - текущие access rules,
  - session/heartbeat/invite flow
    остаются без удаления и без деградации.
  &nbsp;
- Live-stream добавляется как второй параллельный режим.

&nbsp;

&nbsp;

&nbsp;

12. **Нужен один consolidated финальный proof-пакет**

&nbsp;

&nbsp;

&nbsp;

- После выполнения не отдельные словесные отчёты, а единый proof:
  &nbsp;
  - request/response create,
  - состояние записи в БД,
  - скрин control panel,
  - скрин selectable эфира в BroadcastTemplateDialog,
  - скрин /live/:slug,
  - proof replay после завершения.
  &nbsp;

&nbsp;

&nbsp;

План: Исправление создания live event в Kinescope + Admin Control Panel

## Диагностика

### Корневая причина ошибки 400

Лог edge function:

```
json: cannot unmarshal bool into Go struct field CreateForm.record of type meta.Record
```

Код отправляет `record: true` (boolean), но Kinescope API v2 ожидает **объект**:

```json
{ "record": { "parent_id": "project_uuid" } }
```

Это подтверждено реальным ответом API — существующие live events в Kinescope содержат:

```json
"record": { "parent_id": "14a07c2e-c2e8-4d50-930c-cf15151f08ea" }
```

### Что API реально возвращает (доказано вызовом list_live_events)

```text
id:            "019d4f81-75e7-..."          ← kinescope_live_event_id
play_link:     "https://kinescope.io/..."   ← embed/player URL
rtmp_link:     "rtmp://rtmp.kinescope.io/live"
streamkey:     "a147f216f410..."             ← OBS stream key
stream.id:     "2dda40d6-..."               ← kinescope_stream_id
stream.status: "pending"                    ← provider status
poster.*:      poster URLs
```

---

## PATCH A — Исправить create_live_event (blocker)

### Файл: `supabase/functions/kinescope-api/index.ts`

Строка 230-235 — заменить:

```typescript
// БЫЛО:
record: request.record !== false, // boolean — ОШИБКА

// СТАЛО:
record: { parent_id: project_id },  // объект с parent_id проекта
```

Также убрать `type: request.type || "webinar"` — по умолчанию Kinescope использует `"one-time"`, что корректно.

Итоговый body для create:

```typescript
const body = {
  name: request.name || "Новый эфир",
  parent_id: project_id,   // проект Kinescope
  record: { parent_id: project_id },
};
```

### Файл: `src/pages/admin/AdminLiveEvents.tsx`

Строки 323-331 — убрать `record: true`, добавить логирование полного response:

```typescript
body: {
  action: "create_live_event",
  instance_id: kinescopeInstanceId,
  project_id: form.kinescope_project_id,
  name: form.title || "Новый эфир",
}
```

После успешного создания — сохранять дополнительные поля из ответа API:

- `kinescope_live_event_id` = `eventData.id`
- `kinescope_stream_id` = `eventData.stream?.id`
- provider metadata: `rtmp_link`, `streamkey`, `play_link`, `stream.status`

Обновлять запись в БД сразу после создания (update live_events с новыми ID).

### Proof после деплоя

Вызвать `create_live_event` через curl edge function и проверить успешный 200.

---

## PATCH B — Admin Control Panel для live_stream

### Файл: `src/pages/admin/AdminLiveEvents.tsx`

В форме редактирования live_stream (после создания в Kinescope) добавить блок **«Управление трансляцией»**:

1. **Статус эфира**: badge с текущим provider status (`pending` / `active` / `completed`)
2. **RTMP / Stream Key**: показать rtmp_link и streamkey из metadata (для OBS)
3. **Player link**: play_link из Kinescope
4. **Кнопки управления**:
  - Запустить эфир (enable)
  - Завершить эфир (complete)
  - Обновить статус (sync)
5. **Вкладки**: Комментарии / Вопросы (LiveEventComments, LiveEventQuestions — уже есть компоненты)

Metadata сохранять в поле `metadata` jsonb при create и при sync.

---

## PATCH C — Readiness auto-recalculate + selectable invite flow

После успешного create_live_event:

- `kinescope_live_event_id` заполнен → readiness blocker «Нет источника Kinescope» снимается
- Если published + scheduled_at заполнен + access rules есть → эфир становится invite_ready
- В BroadcastTemplateDialog readiness пересчитывается по тем же полям — уже работает, нужно только убедиться, что данные сохранены

---

## Файлы


| Файл                                        | Действие                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| `supabase/functions/kinescope-api/index.ts` | Исправить `record` field + deploy                                        |
| `src/pages/admin/AdminLiveEvents.tsx`       | Убрать `record: true`, сохранять stream metadata, добавить control panel |


## DoD

1. `create_live_event` возвращает 200 с event ID
2. `kinescope_live_event_id` и `kinescope_stream_id` сохраняются в БД
3. RTMP link и stream key видны в админке
4. Кнопки управления (запуск/завершение/обновление) работают
5. Комментарии и вопросы доступны в блоке управления
6. Эфир после создания + публикации становится selectable в BroadcastTemplateDialog
7. Recorded flow не затронут