да, согласен, с учетом правок:

&nbsp;

1. **Исправить не только Dialog, но и сам TokenizedRichInput add-only.**
  В dialog.tsx действительно нужен guard на:
  &nbsp;
  - onFocusOutside
  - onInteractOutside
  - оставить и текущий onPointerDownOutside
    Но этого недостаточно как единственного фикса. В TokenizedRichInput тоже нужно усилить устойчивость:
  - blur-close не должен срабатывать, если фокус ушёл в [data-token-picker] / cmdk-*
  - таймаут закрытия увеличить и синхронизировать с portal mount
  - проверять document.activeElement?.closest(...), а не только dropdownRef.contains(...)
    Иначе будет полупочинка: меню визуально оживёт, но может снова схлопываться при выборе.
  &nbsp;
2. **В AdminLiveEvents.tsx нельзя ограничиться записью только live_event_id в metadata при insert.**
  Нужно прямо сохранить **весь provider.current** для нового эфира:
  &nbsp;
  - live_event_id
  - stream_id
  - play_link
  - rtmp_link
  - streamkey
  - stream_status
  - raw_create_response
    И сразу:
  - provider_source_status = "ok"
  - provider_error_message = null
  - provider_status_code = 200
  - last_provider_sync_at = now()
    Иначе OBS снова будет неполным или broken после первого сохранения.
  &nbsp;
3. **Provider-данные после create надо хранить не “где-то в ref”, а в форме как first-class transient state до save.**
  Добавь в LiveEventForm временный объект, например:
  &nbsp;
  - provider_preview / providerDraft
    Тогда:
  - create → кладёт данные в state
  - save new event → переносит их в metadata.provider.current
    Это надёжнее, чем рассчитывать на замыкания/локальные переменные и не потеряется при повторном рендере.
  &nbsp;
4. **Auto-heal нельзя запускать без guard от циклов.**
  В useEffect для control panel, если просто вызывать handleSyncProvider() при пустом provider.current, можно получить:
  &nbsp;
  - повторные sync
  - гонки
  - лишние audit events
    Нужен guard:
  - только если editingId есть
  - только если kinescope_live_event_id есть
  - только если ещё не было auto-heal в этой сессии открытия
  - не запускать, если уже идёт sync
    Лучше отдельный autoHealAttemptedRef.
  &nbsp;
5. **Auto-heal должен писать результат в БД только один раз и только после фактического ответа провайдера.**
  Нельзя просто ставить ok по наличию kinescope_live_event_id.
  Источник истины:
  &nbsp;
  - create response для нового эфира
  - sync response для legacy/repair
    Только после этого обновлять provider_source_status.
  &nbsp;
6. **В BroadcastSendDialog soft-block текст хороший, но нужна ещё action-логика.**
  Просто написать “обновите источник” недостаточно.
  Нужно:
  &nbsp;
  - показывать эту причину как отдельный readiness-state
  - не давать выбрать эфир, если источник реально не подтверждён
  - но текст причины делать не “повреждён”, а “источник ещё не подтверждён” / “требуется синхронизация”
    Иначе пользователь снова увидит нерабочий выбор без понятного следующего шага.
  &nbsp;
7. **Нужен отдельный backfill/repair для уже существующих live events без provider.current.**
  Не только auto-heal при открытии UI.
  Добавь mini-repair patch:
  &nbsp;
  - найти live_stream, где kinescope_live_event_id is not null
  - и metadata.provider.current пустой
  - и provider_source_status пустой/unknown
    Для них выполнить controlled repair через sync.
    Иначе проблема останется на старых записях, если их не открыть вручную.
  &nbsp;
8. **BroadcastSendDialog и BroadcastTemplateDialog не смешивать в формулировках патча.**
  Сейчас у тебя в DoD фигурирует BroadcastTemplateDialog, а в логике выбора эфира уже используется другой flow.
  Нужно явно зафиксировать:
  &nbsp;
  - где именно сейчас выбирается эфир
  - где именно должен работать [
    Чтобы подрядчик не “починил” не тот dialog.
  &nbsp;
9. **После фикса нужен обязательный runtime-proof именно по трём проблемам пользователя.**
  Не общий build-proof, а конкретно:
  &nbsp;
  - в dialog нажать [ → поиск работает → токен вставился
  - создать новый live event → сохранить → открыть снова → OBS данные на месте без ручного sync
  - открыть legacy эфир без provider.current → auto-heal/sync восстановил источник → эфир стал selectable в отправке
  &nbsp;
10. **Recorded flow не трогать, но это нужно прямо зафиксировать в кодовых guard-ах.**
  Все новые auto-heal / provider guards / readiness-ветки — только для:

&nbsp;

&nbsp;

&nbsp;

- event_type === "live_stream"
  Чтобы не зацепить выбор обычных видео и автовебинаров.

&nbsp;

&nbsp;

&nbsp;

11. **Добавить один UX-fix в сообщения ошибок.**
  Убрать формулировки вроде:

&nbsp;

&nbsp;

&nbsp;

- “Источник повреждён” по умолчанию
  Разделить на:
- “Источник ещё не подтверждён”
- “Источник удалён в Kinescope”
- “Не удалось получить данные OBS”
- “Источник не создан”
  Это критично, потому что сейчас именно плохой текст путает и выглядит как случайная поломка.

&nbsp;

&nbsp;

&nbsp;

12. **Финальный DoD переписать жёстко.**
  Патч считается закрытым только если одновременно:

&nbsp;

&nbsp;

&nbsp;

- [ в нужном dialog работает полноценно
- новый live event после save сразу показывает OBS
- legacy live event auto-heal-ится или repair-ится
- эфир реально можно выбрать в отправке
- recorded flow не имеет регрессии

&nbsp;

&nbsp;

# План: Починка token picker `[` в Dialog + auto-save OBS данных + repair legacy events

## Диагностика

### 1. Token picker `[` мёртвый внутри Dialog

**Root cause**: Radix Dialog (modal=true) использует FocusScope, который перехватывает `focusout` и возвращает фокус обратно в DialogContent. Token picker рендерится через `createPortal(document.body)` — вне DialogContent. Когда пользователь кликает в CommandInput внутри picker, FocusScope перехватывает фокус и не отдаёт его.

Текущий guard в `dialog.tsx` обрабатывает только `onPointerDownOutside` (предотвращает закрытие), но **не обрабатывает `onFocusOutside**` — именно это не даёт фокусу уйти в picker.

В быстрых рассылках TokenizedRichInput работает вне Dialog — нет FocusScope, нет проблемы.

**Фикс**: Добавить `onFocusOutside` guard в `dialog.tsx` с теми же селекторами.

### 2. OBS данные не сохраняются для новых эфиров

**Root cause**: В `handleCreateKinescopeLiveEvent` (строка 404) provider данные пишутся в БД только `if (editingId)`. Для нового эфира (ещё без ID) данные остаются только в state. При сохранении через `saveMutation` (строка 498-510) `mergedMetadata` создаётся заново с нуля (`kinescope_project_id` + `kinescope_folder_id`) — **provider блок теряется**.

Текущее состояние "живой тест" в БД: `metadata = { kinescope_folder_id, kinescope_project_id }` — **нет provider блока вообще**.

**Фикс**: В `saveMutation` при insert нового эфира включать provider данные из state в metadata.

### 3. Legacy эфиры без provider.current

"живой тест" имеет `kinescope_live_event_id`, но пустой provider. `getEventReadiness` в BroadcastSendDialog (строка 90-97) видит пустой provider.current и ставит "Источник повреждён" — ложная блокировка.

**Фикс**: `handleSyncProvider` уже корректно восстанавливает provider.current. Нужно добавить auto-heal: при открытии control panel, если есть `kinescope_live_event_id` но нет `provider.current`, автоматически запускать sync.

---

## Изменения

### Файл 1: `src/components/ui/dialog.tsx`

Добавить `onFocusOutside` guard на `DialogPrimitive.Content` (рядом с существующим `onPointerDownOutside`):

```tsx
onFocusOutside={(e) => {
  const target = e.target as HTMLElement | null;
  const isTokenPicker = target?.closest?.('[data-token-picker]') ||
    target?.closest?.('[cmdk-item]') ||
    target?.closest?.('[cmdk-list]') ||
    target?.closest?.('[cmdk-input]') ||
    target?.closest?.('[cmdk-root]');
  if (isTokenPicker) {
    e.preventDefault();
  }
  props.onFocusOutside?.(e);
}}
```

Также добавить `onInteractOutside` с аналогичным guard — это покрывает и pointer, и focus в одном обработчике (belt-and-suspenders):

```tsx
onInteractOutside={(e) => {
  const target = e.target as HTMLElement | null;
  const isCmdk = target?.closest?.('[data-token-picker]') ||
    target?.closest?.('[cmdk-item]') ||
    target?.closest?.('[cmdk-list]') ||
    target?.closest?.('[cmdk-input]') ||
    target?.closest?.('[cmdk-root]');
  if (isCmdk) {
    e.preventDefault();
  }
  props.onInteractOutside?.(e);
}}
```

### Файл 2: `src/pages/admin/AdminLiveEvents.tsx`

**A. Исправить saveMutation (строки 498-510)**

При создании нового эфира (не editing), включить provider данные из state:

```tsx
let mergedMetadata: Record<string, any> = {
  kinescope_project_id: data.kinescope_project_id || null,
  kinescope_folder_id: data.kinescope_folder_id || null,
};

if (editingId) {
  // existing merge logic...
} else if (data.kinescope_live_event_id) {
  // New event with already-created Kinescope source — include provider from state
  mergedMetadata.provider = {
    current: {
      live_event_id: data.kinescope_live_event_id,
      // Provider data from handleCreateKinescopeLiveEvent is in form state
    },
  };
  mergedMetadata.provider_source_status = "ok";
  mergedMetadata.last_provider_sync_at = new Date().toISOString();
}
```

Дополнительно: сохранить provider raw data (play_link, rtmp_link, streamkey) в form state при create, чтобы они были доступны при save. Добавить поля в LiveEventForm или хранить в ref.

**B. Auto-heal при открытии control panel**

В `useEffect` для определения `providerSourceStatus` (строки 1386-1398), добавить auto-sync trigger:

```tsx
useEffect(() => {
  if (!kinescopeLiveEventId) {
    setProviderSourceStatus("draft");
    return;
  }
  const meta = eventData?.metadata as any;
  const metaStatus = meta?.provider_source_status;
  const hasProviderCurrent = !!meta?.provider?.current?.play_link || !!meta?.provider?.current?.stream_id;
  
  if (metaStatus && ["ok", "missing", "broken", "draft"].includes(metaStatus)) {
    setProviderSourceStatus(metaStatus);
  } else if (!hasProviderCurrent && kinescopeInstanceId) {
    // Auto-heal: kinescope_live_event_id exists but no provider.current → auto-sync
    handleSyncProvider();
  } else {
    setProviderSourceStatus("ok");
  }
}, [kinescopeLiveEventId, eventData]);
```

### Файл 3: `src/components/admin/communication/BroadcastSendDialog.tsx`

**Readiness auto-heal**: В `getEventReadiness` (строки 90-96), если `providerStatus` не задан и нет `provider.current`, вместо сразу "повреждён" — считать как "Требуется синхронизация" (soft-block с действием "Обновить"):

```tsx
if (!providerStatus || providerStatus === "ok") {
  const providerCurrent = meta?.provider?.current || meta?.provider || {};
  const hasStream = !!providerCurrent.stream_id || !!providerCurrent.stream_status;
  const hasPlayLink = !!providerCurrent.play_link;
  if (!hasStream && !hasPlayLink) {
    // Differentiate: if kinescope_live_event_id exists, it's likely a sync issue
    if (event.kinescope_live_event_id) {
      reasons.push("Не удалось получить данные OBS — обновите источник");
    } else {
      reasons.push("Не создан источник трансляции");
    }
  }
}
```

---

## Файлы


| Файл                                                         | Изменение                                                                               |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `src/components/ui/dialog.tsx`                               | Добавить `onFocusOutside` + `onInteractOutside` guard для cmdk/token-picker             |
| `src/pages/admin/AdminLiveEvents.tsx`                        | Включить provider в metadata при insert нового эфира; auto-heal sync при открытии panel |
| `src/components/admin/communication/BroadcastSendDialog.tsx` | Улучшить readiness сообщения, отличать "нет данных" от "повреждён"                      |


## DoD

1. `[` в BroadcastTemplateDialog: меню открывается, поиск работает, выбор мышкой/клавиатурой работает, токен вставляется, диалог не закрывается
2. После create live event OBS данные сохраняются в DB без ручного sync
3. Для legacy эфиров (kinescope_live_event_id есть, provider.current пуст) — auto-sync при открытии panel
4. В picker рассылки: "живой тест" доступен для выбора после auto-heal
5. Быстрые рассылки — регресса нет