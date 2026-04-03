# да, согласен, с учетом правок:

&nbsp;

1. Добавь обязательное сохранение в metadata не только provider_source_status, но и:
  &nbsp;
  - provider_error_message
  - provider_status_code
  - last_provider_sync_at
    Это нужно, чтобы после reload UI не терял причину поломки и мог правильно показывать блокеры.
  &nbsp;
2. При provider_source_status = "missing" или "broken" нужно не только блокировать выбор в BroadcastTemplateDialog, но и:
  &nbsp;
  - блокировать invite_ready
  - блокировать публикацию/пере-публикацию live_stream
  - показывать blocker в readiness panel админки:
    **«Источник трансляции недоступен»**
  &nbsp;
3. В LiveStreamControlPanel initial state нужно брать из БД, а не из локального useState по умолчанию.
  Сейчас после reload возможен ложный ok/draft.
  Источник истины:
  &nbsp;
  - metadata.provider_source_status
  - fallback только если поля нет
  &nbsp;
4. При missing:
  &nbsp;
  - сохранить provider_source_status: "missing"
  - сохранить provider_error_message
  - очистить provider.current
  - **не очищать** provider_history
  - kinescope_live_event_id оставить как есть до явного recreate/detach, чтобы была понятна привязка к удалённому источнику и был audit trail
  &nbsp;
5. При detach обязательно записывать в metadata:
  &nbsp;
  - provider_source_status: "draft"
  - provider_error_message: null
  - provider_status_code: null
    Иначе после ручного сброса могут остаться старые причины ошибки.
  &nbsp;
6. После recreate делать не просто auto-sync, а последовательность:
  &nbsp;
  - создать новый provider event
  - записать новые top-level id
  - записать provider.current
  - затем вызвать sync нового id
  - только после успешного sync ставить provider_source_status: "ok"
    Иначе можно получить ложный ok до фактической проверки.
  &nbsp;
7. Добавь отдельный guard для пользовательской части:
  &nbsp;
  - если live_stream опубликован, но provider_source_status in ("missing","broken")
  - live-resolve должен возвращать отдельный статус, например source_unavailable
  - на /live/:slug показывать понятный экран:
    **«Источник трансляции временно недоступен»**
    Иначе пользователь попадёт на мёртвую страницу.
  &nbsp;
8. Добавь badge статуса источника не только в таблицу эфиров, но и в:
  &nbsp;
  - карточку редактирования эфира
  - summary блока
  - selector в BroadcastTemplateDialog
    Чтобы статус был одинаково виден во всех ключевых точках.
  &nbsp;
9. Для BroadcastTemplateDialog.getEventReadiness() зафиксируй порядок проверки:
  &nbsp;
  - is_published
  - scheduled_at для live
  - kinescope_live_event_id
  - metadata.provider_source_status
  - fallback на provider.current
    То есть provider_source_status должен иметь приоритет над остаточными полями в provider.current.
  &nbsp;
10. Добавь proof в DoD:

&nbsp;

&nbsp;

&nbsp;

- sync существующего источника → ok
- sync удалённого источника → missing
- recreate после missing → новый provider id, old id ушёл в provider_history
- detach → provider cleared, slug/comments/questions сохранились
- BroadcastTemplateDialog не даёт выбрать missing/broken эфир
- /live/:slug для missing/broken live-stream показывает controlled error state, а не пустой player

&nbsp;

&nbsp;

&nbsp;

11. Recorded flow не трогать вообще:

&nbsp;

&nbsp;

&nbsp;

- все новые guards и badges применять только при event_type === "live_stream"
- для recorded_webinar не использовать provider_source_status как blocker, если есть валидный kinescope_video_id

&nbsp;

&nbsp;

&nbsp;

12. Если подрядчик будет менять provider.current, потребовать add-only структуру:

&nbsp;

&nbsp;

&nbsp;

- metadata.provider.current
- metadata.provider_history[]
- без удаления старых history entries
- без перезаписи истории одним объектом

&nbsp;

&nbsp;

План: PATCH F — Proof + Guard (исправление незакрытых дыр PATCH E)

## Диагностика

### Что реально работает (runtime-proof собран)

1. **sync_live_event edge function** — корректно возвращает:
  - `provider_source_status: "ok"`, `status_code: 200` для существующего события
  - `provider_source_status: "missing"`, `status_code: 404` для несуществующего
  - Все поля (play_link, rtmp_link, streamkey, stream.id, stream.status) приходят
2. **Recreate** — работает: в БД есть 2 записи в `provider_history[]`, каждая с `detached_at`, `reason`, `has_streamkey`. Audit event `live_provider_recreated` записывается корректно.
3. **Audit events** — реально пишутся в `domain_events`:
  - `live_provider_recreated` (2 записи)
  - `live_provider_missing` (1 запись)
4. **Control panel UI** — dual badges, OBS block, кнопки пересоздания/отвязки, confirm dialogs присутствуют.

### Что НЕ работает / не закрыто

**Баг 1: `provider_source_status` НЕ сохраняется в metadata при sync**

- `handleSyncProvider` при `missing` (строки 1390-1406) делает return early, НЕ записывая `provider_source_status` в metadata
- При `ok` (строки 1436-1450) тоже не пишет `provider_source_status` в merged metadata
- Следствие: `BroadcastTemplateDialog.getEventReadiness()` не может определить, что источник удалён

**Баг 2: `BroadcastTemplateDialog.getEventReadiness()` проверяет только stream/play_link, не проверяет `provider_source_status**`

- Строки 58-68: если `kinescope_live_event_id` есть и `provider.current` содержит старые данные (play_link, stream_id) — readiness пройдёт как "ok", даже если событие удалено в Kinescope
- Нужно явно проверять `metadata.provider_source_status`

**Баг 3: После `handleSyncProvider` при missing не обновляется metadata в БД**

- provider.current не очищается и не помечается
- Следствие: после перезагрузки страницы `providerSourceStatus` сбрасывается, т.к. оно только в React state

**Баг 4: После recreate не вызывается автоматический sync**

- `handleRecreateProvider` создаёт event и сохраняет provider.current, но не вызывает sync для проверки реального состояния

**Баг 5: В таблице эфиров нет badge статуса источника**

- Таблица показывает только platform status, не показывает source status

---

## Изменения

### 1. `handleSyncProvider` — всегда сохранять `provider_source_status` в metadata

При **missing**:

- Записать `provider_source_status: "missing"` в metadata
- Очистить `provider.current` (чтобы readiness корректно блокировал)

При **broken**:

- Записать `provider_source_status: "broken"` в metadata

При **ok**:

- Записать `provider_source_status: "ok"` в metadata

### 2. `BroadcastTemplateDialog.getEventReadiness()` — добавить явную проверку `provider_source_status`

```typescript
// После проверки kinescope_live_event_id:
const providerStatus = meta?.provider_source_status;
if (providerStatus === "missing") {
  reasons.push("Источник трансляции удалён в Kinescope");
} else if (providerStatus === "broken") {
  reasons.push("Источник трансляции повреждён");
} else if (!hasStream && !hasPlayLink) {
  reasons.push("Источник трансляции повреждён");
}
```

### 3. `handleRecreateProvider` — автоматический sync после создания

После успешного recreate → вызвать `handleSyncProvider()` для подтверждения состояния. Либо, если kinescope_live_event_id только что записан — делать sync на новый ID.

### 4. Таблица эфиров — добавить badge источника

В `TableRow` для `live_stream` показывать маленький badge:

- 🟢 Источник активен (есть kinescope_live_event_id + provider_source_status ok)
- 🔴 Источник удалён (provider_source_status = missing)
- 🟡 Источник повреждён (provider_source_status = broken)
- ⚪ Не создан (нет kinescope_live_event_id)

### 5. Detach — проверить сохранение платформенных данных

В `handleDetachProvider` уже корректно сохраняются slug/title/access_rules. Добавить явное сохранение `provider_source_status: "draft"` в metadata.

---

## Файлы


| Файл                                                             | Изменения                                                                                                                                    |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/pages/admin/AdminLiveEvents.tsx`                            | handleSyncProvider: сохранять provider_source_status в metadata при всех кейсах; handleRecreateProvider: авто-sync; таблица: badge источника |
| `src/components/admin/communication/BroadcastTemplateDialog.tsx` | getEventReadiness: проверять provider_source_status из metadata                                                                              |


## DoD

1. При sync missing — в metadata записан `provider_source_status: "missing"`, `provider.current` очищен
2. При sync ok — в metadata записан `provider_source_status: "ok"`
3. `BroadcastTemplateDialog` блокирует эфир с `provider_source_status: "missing"` или `"broken"` с понятной причиной
4. После recreate автоматически выполняется sync
5. В таблице эфиров виден badge статуса источника
6. После detach `provider_source_status: "draft"` записан в metadata
7. Recorded flow не затронут (изменения только для `event_type === "live_stream"`)