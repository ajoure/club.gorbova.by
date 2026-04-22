да, согласен, с учетом правок:

1. **Не создавать новый route-файл src/pages/LiveEventLegacy.tsx**, если его сейчас нет как отдельной страницы.  
В этом запуске сохранить текущий вход через LiveEvent.tsx и встроить gating туда add-only:
  - либо через уже существующий внутренний LiveEventLegacy
  - либо через отдельный room-компонент, но **без смены маршрута и без ломки текущего entry-point**.
2. **Шаг 1 — Admin UI**: зафиксируй, что Entry Settings и Pre-start сохраняются в один и тот же [metadata.room](http://metadata.room)_settings без перетирания соседних веток.  
Нужен merge-safe update:
  - не терять prestart, если меняем entry
  - не терять participants/chat/reactions, если меняем prestart
  - не ломать существующие metadata ветки автоспринтов и live-модуля.
3. **Шаг 2 — Entry Flow**: добавь явную клиентскую валидацию перед submit:
  - если name_required=true → пустое имя запрещено
  - если color_required=true → цвет обязателен
  - если выбран red non-staff → блокируем submit ещё до запроса
  - trim имени, запрет строки из одних пробелов
  - лимит длины display name, чтобы не ломать чат и список участников.
4. **Reconnect contract** надо зафиксировать жёстче:  
если prefs уже есть, room не должен снова спрашивать имя, но **обязан** сделать silent-resync в live_active_sessions:  

  - display_name
  - nickname_color
  - show_avatar  
  И только после успешного mirror-sync пускать дальше. Иначе будут расхождения между prefs и runtime-списком участников.
5. **RoomEntryDialog self-preview**: прямое чтение profiles.avatar_url допустимо только для self-preview, но:
  - не прокидывать этот payload дальше в room state
  - не сохранять avatar url в prefs
  - не дублировать avatar в metadata/comments/questions  
  Это надо явно указать в DoD и proof.
6. **Pre-start audio UX**: добавь в план обязательную проверку двух сценариев:
  - браузер заблокировал autoplay → экран остаётся рабочим, показывается понятная кнопка запуска музыки
  - переход prestart → live действительно останавливает звук и очищает источник  
  Нужен proof не только визуальный, но и через cleanup-факт.
7. **Sales Blocks**: в этом запуске достаточно расширить editor и сохранение типов text / product_choice, но **runtime-полный показ этих новых типов не считать закрытым**, если он не входит в шаги запуска 2.  
То есть:
  - admin CRUD новых типов — в этом запуске
  - room-runtime новых типов — в следующем запуске вместе с PHASE 4  
  Иначе scope расползётся.
8. **Mini-proof 6 фактов** дополни ещё двумя обязательными privacy-check:
  - в network/DOM для non-staff нет full_name, email, phone, contact_id
  - при show_avatar=false в room payload и в snapshot новых сообщений avatar остаётся NULL
9. **Автотесты / mini-proof**: минимально добавить хотя бы:
  - unit на merge room_settings
  - unit на entry validation
  - unit/integration на reconnect decision: prefs exist -> dialog skipped -> session mirror update called  
  Это нужно сейчас, чтобы потом не возвращаться.
10. **Stop-gate** уточнить:

&nbsp;

- если silent-resync в live_active_sessions не работает стабильно
- или privacy-check по network/DOM не пройден
- или hidden avatar попадает в snapshot комментария  
тогда запуск 2 не закрывать и к PHASE 4 не переходить.

После этих правок запуск 2 можно брать в работу без риска снова потерять privacy-контракт и без расползания scope.

&nbsp;

# Запуск 2: PHASE 2 (Admin UI) + PHASE 3 (Entry Flow + Pre-start)

Add-only поверх текущей комнаты. Privacy-инварианты из Запуска 1.1 уже в БД (snapshot prefs-first, hard NULL для hidden avatar, staff-checks с super_admin).

## Порядок внутри запуска 2 (строгий)

1. **Admin UI settings** (расширение `WebinarRoomSettingsCard.tsx` в `AdminLiveEvents`)
2. **Entry Flow** (`RoomEntryDialog.tsx` + интеграция в `LiveEventLegacy`)
3. **Pre-start screen** (`RoomPreStartScreen.tsx`)
4. **mini-proof** по 6 фактам перед закрытием

Не смешивать. Каждый шаг проверяется до следующего.

---

## Шаг 1 — Admin UI settings

Расширить **существующий** `WebinarRoomSettingsCard.tsx` (или создать, если ещё нет — проверю на месте) внутри `AdminLiveEvents`. Один проход, все секции:

### Секция «Pre-start»

- cover_url (storage upload в `webinar-prestart`)
- title, timer_enabled
- music_url (upload или url)
- gallery: array `{url, caption}` (add/remove items)

### Секция «Sales Blocks»

- **Только расширение** существующего `LiveEventRoomBlocksEditor` — добавить типы `text` и `product_choice` (tariff/product selector ID-first). Никакого нового редактора.

### Секция «Participants Visibility»

- toggle `participants.visible_for_students`

### Секция «Entry Settings» (полный блок, без откладывания)

- `entry.name_required` toggle
- `entry.color_required` toggle
- `entry.avatar_toggle_enabled` toggle
- `entry.allowed_colors`: multi-color picker (палитра 8 цветов, включая `#ef4444`)
- `entry.staff_reserved_colors`: подсветка red как «Только для staff»
- privacy-copy preview блок (что увидит пользователь в RoomEntryDialog)

### Секция «Chat & Reactions»

- `chat.emoji_normalization_enabled` toggle
- `reactions.enabled` toggle
- `reactions.rate_limit_per_min` number

### Сохранение

Один UPDATE `live_events.metadata.room_settings = jsonb_set(...)`. Используется существующий useLiveEvent / mutation.

**Step DoD:** настройки сохраняются и переоткрываются ровно в том же виде; sales-блоки `text`/`product_choice` создаются.

---

## Шаг 2 — Entry Flow

### `RoomEntryDialog.tsx` — финальный контракт сразу

Структура:

1. **Avatar preview** сверху — `profiles.avatar_url` текущего пользователя (рендерится **только в этом dialog**, не утекает в room payload).
2. **Поле «Как вас показывать в комнате»** — текстовый input.
  - Draft из `prefs.display_name` если есть → fallback `profiles.full_name` → пусто.
3. **Палитра цветов** — grid из `entry.allowed_colors`.
  - Red (`#ef4444`) для non-staff: `disabled` + tooltip «Этот цвет доступен только сотрудникам».
  - Серверный guard уже включён (триггер `validate_nickname_color`) — клиент не может обойти.
4. **Toggle «Показывать мой аватар»** (default: `false` для приватности).
5. **Privacy-copy** (3 строки видимы):
  - «Другие участники увидят только это имя»
  - «Аватар будет показан только если вы включите эту опцию»
  - «Администратор видит ваши контактные данные отдельно»
6. **Кнопка «Войти»**.

### Save-flow (атомарный)

1. UPSERT `live_event_participant_prefs (live_event_id, user_id)` с `display_name`, `nickname_color`, `show_avatar`.
2. UPDATE `live_active_sessions` (own row) — синхронный runtime mirror.
3. invalidate query → диалог закрывается.

### Reconnect / повторный вход

В `LiveEventLegacy` чтение prefs до показа dialog:

- если `prefs.display_name` существует → диалог НЕ показывается, сразу runtime mirror в session и вход.
- gating: `entry.name_required && !prefs.display_name` → блокируем диалогом.

**Step DoD:** prefs сохраняются 1:1; reconnect не показывает диалог повторно; red недоступен non-staff (UI + DB); hidden avatar нигде не светится в payload.

---

## Шаг 3 — Pre-start screen

### `RoomPreStartScreen.tsx`

Render:

- Cover image (full-width)
- Title
- Countdown к `live_event.scheduled_at` (если `timer_enabled`)
- Music control:
  - `**<audio>` muted-by-default** (browser autoplay policy)
  - Кнопка play/pause/mute (в одном control)
  - **При unmount гарантированный cleanup** (`useEffect` return → `audio.pause(); audio.src = ''`)
- Gallery grid (если есть items)

### Gating в `LiveEventLegacy`

- `room_settings.prestart.enabled && roomState in ('closed','opened') && now < scheduled_at` → `RoomPreStartScreen`
- При переходе room → `live` → размонтировать pre-start (cleanup останавливает музыку)
- При переходе → entry dialog (если nameless)

**Step DoD:**

- Cover/timer/music/gallery рендерятся
- Музыка НЕ автоиграет со звуком (mute по умолчанию)
- Есть кнопка включить звук
- При live transition музыка остановлена (network-tab proof)

---

## Шаг 4 — mini-proof перед закрытием

6 обязательных фактов:

1. Entry settings в админке сохраняются и переоткрываются
2. Entry dialog показывает аватар
3. `show_avatar=false` сохраняется в prefs (DB read)
4. Reconnect (logout/login или refresh) подтягивает prefs, диалог не показывается повторно
5. Non-staff не может выбрать red (UI disabled + DB triggered reject)
6. Pre-start cover/timer/music/gallery реально рендерятся

---

## Privacy guards (жёстко в этом запуске)

- **PHASE 2/3 НЕ выводят `profiles.full_name` в room payload**. Avatar preview в `RoomEntryDialog` — единственное место чтения `profiles.avatar_url` напрямую (для self-preview перед входом). В сам room это не утекает.
- Все room-side компоненты в этом запуске работают только с `prefs` / snapshot полями.
- Никаких новых SELECT из `profiles` в `LiveEventComments`/`LiveEventQuestions`/`LiveEventLegacy`.

## Stop-gate Запуска 2

PHASE 4 не начинать, если:

- entry dialog не сохраняет prefs 1:1
- hidden avatar где-то светится
- pre-start не переключается в комнату корректно

В этом случае — закрыть в рамках текущего запуска перед переходом.

## Файлы (ожидаемые)

**Frontend admin:**

- `src/components/admin/live-events/WebinarRoomSettingsCard.tsx` (создать или расширить)
- `src/components/admin/live-events/LiveEventRoomBlocksEditor.tsx` (расширить: типы `text`, `product_choice`)

**Frontend room:**

- `src/components/live-event/RoomEntryDialog.tsx` (создать)
- `src/components/live-event/RoomPreStartScreen.tsx` (создать)
- `src/pages/LiveEventLegacy.tsx` (интеграция gating + reconnect)

**Hooks:**

- `src/hooks/useRoomEntryPrefs.ts` (создать: read/upsert prefs + sync session)

Backend в этом запуске не трогаем — фундамент готов.