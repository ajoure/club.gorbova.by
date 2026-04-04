# да, согласен, с учетом правок:

&nbsp;

1. **Не переносить выбор эфира из шаблона в отдельный будущий flow без add-only mapping.**
  Текущий сломанный picker надо починить сейчас, но архитектурно шаблон действительно должен быть **переиспользуемым**.
  Поэтому делаем add-only в 2 шага:
  &nbsp;
  - **Шаг A:** срочно чинить текущий выбор эфира, чтобы функционал заработал без регресса.
  - **Шаг B:** добавить новую правильную модель: шаблон webinar_invite может существовать **без live_event_id**, а привязка эфира происходит при запуске конкретной рассылки.
    Ничего не ломать в текущих данных. Старый режим с live_event_id не удалять сразу, а пометить как legacy-compatible.
  &nbsp;
2. **OBS-данные — подтвердить и исправить source of truth.**
  Внести явный PATCH:
  &nbsp;
  - при create live event всегда сохранять provider-данные в **едином каноническом формате**:
    metadata.provider.current
  - больше нигде не писать напрямую в metadata.provider без current
  - reader и writer должны читать/писать одинаковую структуру
  - после create делать **auto-sync** и только потом показывать control panel как “источник готов”
    DoD:
  - после создания эфира сразу видны play_link, rtmp_link, streamkey
  - provider_source_status = "ok"
  - last_provider_sync_at заполнен
  &nbsp;
3. **Починить [ внутри Dialog не кастомной логикой “примерно”, а через reuse рабочего решения из быстрых рассылок.**
  Не изобретать новый blur/focus hack, пока не сделан diff-discovery:
  &nbsp;
  - сравнить **рабочий** сценарий из “Быстрая рассылка”
  - сравнить **нерабочий** сценарий из BroadcastTemplateDialog
  - зафиксировать точную разницу по:
    &nbsp;
    - portal/container
    - focus trap
    - blur timeout
    - z-index
    - event listeners
    - mount timing
      Затем перенести **тот же рабочий паттерн**, а не частичную имитацию.
      DoD:
    &nbsp;
  - в BroadcastTemplateDialog по [ picker открывается
  - поиск работает
  - выбор мышкой работает
  - модалка не закрывается
  - textarea сохраняет фокус корректно после вставки
  &nbsp;
4. **По шаблонам приглашений — зафиксировать правильную доменную модель.**
  Да, логика должна быть такой:
  &nbsp;
  - **шаблон** = постоянный сценарий приглашения
  - **эфир** = конкретное событие
  - **рассылка** = применение шаблона к конкретному эфиру и аудитории
    Значит нужно добавить сущностное правило:
  - broadcast_templates.webinar_invite не обязан иметь live_event_id
  - live_event_id выбирается на этапе **создания/запуска рассылки**, а не на этапе создания шаблона
    Но это делать add-only, без немедленного удаления текущего поля.
  &nbsp;
5. **Сейчас не убирать picker эфира из BroadcastTemplateDialog, пока не добавлен новый экран/шаг применения шаблона.**
  Иначе получится провал по UX.
  Нужно явно сделать transitional model:
  &nbsp;
  - текущий picker эфира — починить
  - добавить новый preferred flow “создать рассылку из шаблона → выбрать эфир”
  - только после runtime-proof нового flow можно переводить старый режим в deprecated
  &nbsp;
6. **Нужен отдельный PATCH на “Применить шаблон к эфиру”.**
  Добавить в раздел рассылок:
  &nbsp;
  - выбор шаблона
  - если template_type = webinar_invite → обязательный шаг выбора эфира
  - после выбора эфира автоматически подставляются:
    &nbsp;
    - platform URL
    - дата/время эфира
    - timezone-переменные
    &nbsp;
  - затем выбор аудитории / запуск / планирование
    Это и есть правильное место привязки эфира.
  &nbsp;
7. **Readiness переносим с уровня шаблона на уровень рассылки.**
  В шаблоне проверять только валидность самого шаблона:
  &nbsp;
  - name
  - channel
  - текст / subject / body
    А readiness конкретного эфира проверять уже в момент применения шаблона:
  - опубликован ли эфир
  - есть ли источник
  - не broken/missing ли provider
  - задана ли дата, если нужна
  &nbsp;
8. **Для live_stream добавить guard: нельзя строить приглашение на эфир с неготовым источником.**
  Даже если шаблон создан, при выборе эфира в flow создания рассылки система должна блокировать эфир с:
  &nbsp;
  - provider_source_status = missing
  - provider_source_status = broken
  - kinescope_live_event_id IS NULL
    И показывать конкретную причину, а не общий disabled.
  &nbsp;
9. **По OBS и преподавателю — добавить явный режим использования.**
  В админке для live event должен быть отдельный блок:
  &nbsp;
  - “Для ведущего”
  - copy-friendly OBS данные
  - кнопка копирования stream key
  - статус источника
  - дата/время эфира
  - ссылка на платформенный /live/:slug для проверки viewer-side
    Не требовать от преподавателя идти в Kinescope, если все необходимые данные уже есть в админке.
  &nbsp;
10. **Нужен proof именно по двум сценариям после фикса.**
  Сценарий 1 — live source:
  &nbsp;
  - создать live event
  - увидеть OBS данные
  - выполнить auto-sync
  - source status = ok
  &nbsp;
  Сценарий 2 — webinar invite template:
  &nbsp;
  - открыть BroadcastTemplateDialog
  - по [ открыть picker переменных
  - ввести текст
  - сохранить шаблон без привязки к конкретному эфиру
  - затем в flow создания рассылки выбрать этот шаблон
  - выбрать эфир
  - увидеть пересчитанный URL и readiness
  &nbsp;
11. **Не принимать PATCH, если сделан только перенос логики без работающего UX.**
  Критерий приёмки:

&nbsp;

&nbsp;

&nbsp;

- OBS данные появляются сразу после create
- [ работает в модалке
- шаблон приглашения можно создать без цирка с публикацией/эфиром
- конкретный эфир выбирается уже при создании рассылки
- пользовательский путь стал проще, а не сложнее

&nbsp;

&nbsp;

&nbsp;

12. **Сохранить совместимость со старыми шаблонами.**
  Если в БД уже есть webinar_invite с live_event_id, новый flow обязан их читать и использовать как legacy-case, без потери данных.

&nbsp;

&nbsp;

План: Исправление трёх багов — OBS данные, token picker `[`, логика шаблонов

## Диагностика

### Баг 1: OBS данные не появляются для "живой тест"

**Root cause**: При создании live event в Kinescope (строки 404-428) provider-данные сохраняются в `metadata.provider` напрямую (без `.current`):

```
provider: { live_event_id, stream_id, play_link, rtmp_link, streamkey, ... }
```

Но при чтении (строка 1374) код ищет `metadata.provider.current` первым:

```
const providerCurrent = metadata?.provider?.current || metadata?.provider || {};
```

Для эфира "живой тест" в БД metadata содержит ТОЛЬКО `kinescope_folder_id` и `kinescope_project_id` — блока `provider` нет вообще. Это значит, что при создании эфира данные не сохранились (возможно, `editingId` был пуст в момент создания — создание шло до первого save).

**Дополнительно**: После PATCH E/F `handleRecreateProvider` пишет в `provider.current`, но `handleCreateLiveEvent` (строка 411) пишет напрямую в `provider` без `.current`. Несогласованность.

### Баг 2: Token picker `[` не работает в BroadcastTemplateDialog

**Root cause**: TokenizedRichInput использует `createPortal(document.body)` для dropdown (строка 912). Bracket plugin (строка 129) перехватывает `[` и через 300ms вызывает `onOpen`. Guard в `dialog.tsx` (строки 40-52) защищает от закрытия при клике на `[data-token-picker]` / `[cmdk-item]`.

Проблема: при открытии picker внутри Dialog, фокус уходит из TipTap editor → срабатывает `blur` handler (строки 597-610), который через 150ms закрывает picker. В быстрых рассылках (BroadcastsTabContent) TokenizedRichInput НЕ внутри Dialog — нет focus trap, поэтому работает.

**Решение**: В blur handler нужно проверять, попал ли фокус в dropdown ИЛИ в searchInput внутри dropdown. Сейчас проверка `dropdownRef.current?.contains(active)` может не срабатывать, если `searchInputRef` ещё не смонтирован к моменту blur check (300ms delay от `[` + 150ms blur timeout = гонка).

### Баг 3: Неправильная логика шаблонов приглашений

**Суть жалобы пользователя**: Сейчас шаблон привязывается к конкретному эфиру при создании. Пользователь хочет наоборот: шаблон — это переиспользуемый паттерн ("Эфиры по четвергам"), а привязка к конкретному эфиру происходит при ИСПОЛЬЗОВАНИИ шаблона (создании рассылки). Тогда один шаблон можно применять к разным эфирам.

---

## Изменения

### 1. Исправить сохранение provider-данных при создании (`AdminLiveEvents.tsx`)

В `handleCreateLiveEvent` (строки 411-419) писать в `metadata.provider.current`, а не в `metadata.provider`:

```typescript
provider: {
  ...(existingMeta.provider || {}),
  current: {
    live_event_id: eventId,
    stream_id: streamId,
    play_link: playLink,
    rtmp_link: rtmpLink,
    streamkey: streamkey,
    stream_status: streamStatus,
  },
},
provider_source_status: "ok",
last_provider_sync_at: new Date().toISOString(),
```

Также добавить авто-sync после создания для подтверждения.

### 2. Исправить token picker внутри Dialog (`TokenizedRichInput.tsx`)

В blur handler (строки 597-610) увеличить таймаут и добавить проверку на `searchInputRef`:

```typescript
const handler = () => {
  setTimeout(() => {
    const active = document.activeElement;
    if (dropdownRef.current?.contains(active)) return;
    // Also check if focus went to search input (may mount after blur fires)
    if (searchInputRef.current?.contains(active as Node)) return;
    // Check data-token-picker attribute on active element or its parents
    if ((active as HTMLElement)?.closest?.('[data-token-picker]')) return;
    if (!editor.isFocused && pickerOpenRef.current) {
      setPickerOpen(false);
    }
  }, 250); // increase from 150 to 250 to allow portal mount
};
```

### 3. Переделать логику шаблонов: отвязать эфир от шаблона (`BroadcastTemplateDialog.tsx`)

**Новая концепция**:

- Шаблон типа `webinar_invite` больше НЕ привязывается к конкретному эфиру при создании
- `live_event_id` убирается из шаблона
- Вместо этого при ИСПОЛЬЗОВАНИИ шаблона (создание рассылки из шаблона) пользователь выбирает эфир
- Popover + Command picker эфира переносится из BroadcastTemplateDialog в экран создания рассылки из шаблона

**В BroadcastTemplateDialog**:

- Убрать весь блок выбора эфира (строки 250-378)
- Убрать `liveEventId`, `eventPickerOpen`, `eventSearch`, `filteredEvents`, `selectedEvent`, `selectedReadiness`, `computedButtonUrl`
- Убрать `getEventReadiness`, `getEventTypeLabel`, query `broadcast-live-events-all`
- `isValid` упрощается: `name.trim() && (telegram text || email fields)`
- Шаблон хранит только: name, channel, template_type, message_text, button_text (без URL для webinar_invite — URL вычисляется при использовании)

**В BroadcastsTabContent** (или новом flow "Использовать шаблон"):

- При выборе шаблона типа `webinar_invite` для рассылки → показать picker эфира
- URL кнопки вычисляется из выбранного эфира
- Readiness проверяется здесь, а не в шаблоне

---

## Файлы


| Файл                                                             | Изменения                                                                         |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `src/pages/admin/AdminLiveEvents.tsx`                            | handleCreateLiveEvent: писать в provider.current, добавить provider_source_status |
| `src/components/admin/TokenizedRichInput.tsx`                    | blur handler: расширить проверки, увеличить таймаут                               |
| `src/components/admin/communication/BroadcastTemplateDialog.tsx` | Убрать привязку эфира, упростить до шаблона-паттерна                              |
| `src/components/admin/communication/BroadcastsTabContent.tsx`    | Добавить выбор эфира при использовании шаблона webinar_invite                     |


## DoD

1. После создания live event в Kinescope OBS-данные (play_link, rtmp, streamkey) видны в control panel
2. Token picker `[` работает внутри Dialog (BroadcastTemplateDialog)
3. Шаблон webinar_invite создаётся без привязки к конкретному эфиру
4. При использовании шаблона для рассылки — выбор эфира происходит на этапе создания рассылки
5. Recorded flow не затронут