да, согласен, с учетом правок:

1. **Не хранить выбор имени/цвета/аватара только в live_active_sessions**
  - Это сломается при переподключении, обновлении страницы, истечении heartbeat-сессии.
  - Нужно добавить **персистентную per-event сущность** для предпочтений участника, например:
    - live_event_participant_prefs
    - ключ: (live_event_id, user_id) и fallback (live_event_id, viewer_proof_id) для случаев без user_id
    - поля: display_name, nickname_color, show_avatar, updated_at
  - live_active_sessions оставить только как runtime-присутствие.
  - При входе:
    - сначала читаем prefs,
    - если есть — предзаполняем dialog,
    - после подтверждения обновляем и prefs, и активную session.
  - Иначе сейчас пользователь введёт имя, а после reconnect всё потеряется.
2. **Публичное имя и аватар должны снапшотиться в сообщения в момент отправки**
  - Это критично для приватности.
  - Сейчас room UI не должен зависеть от текущего profiles.full_name или текущих prefs при рендере старых сообщений.
  - Для live_event_comments и live_event_questions нужно сделать так:
    - author_display_name = выбранный псевдоним
    - author_avatar_url = profiles.avatar_url только если show_avatar=true, иначе NULL
    - добавить снапшот цвета:
      - лучше add-only поле author_nickname_color text
      - либо metadata.nickname_color
  - Иначе:
    - старые сообщения могут внезапно менять имя/цвет,
    - либо обычным участникам утечёт реальное ФИО.
3. **Helper getRoomParticipantPresentation использовать не как единственный источник для истории сообщений, а как staff-augmentation**
  - Для списка участников helper — да.
  - Для чата/Q&A:
    - **student-view** должен брать публичный snapshot из самих сообщений,
    - **staff-view** может поверх этого показывать Real Name (alias).
  - То есть:
    - public render → snapshot-first,
    - staff render → snapshot + internal augmentation.
  - Это важнее, чем рендерить всё из live participants RPC.
4. **Нужен серверный guard для staff-only красного цвета**
  - Не только UI disable.
  - Добавить DB/RPC validation:
    - если viewer не staff и пытается сохранить nickname_color из staff-reserved palette → reject.
  - Иначе это легко обойти вручную запросом.
5. **RPC get_room_participants оставить только для текущих участников, но не использовать его как источник реальных имён в public-history**
  - RPC должен возвращать минимальный набор.
  - Для non-staff:
    - display_name
    - nickname_color
    - avatar_url только если show_avatar=true
    - role_in_room
  - Для staff:
    - real_name_for_staff
    - internal avatar
  - Никаких email, phone, contact_id, crm ids, profile ids в public payload.
6. **PHASE 1 перестроить по порядку**  
Сначала:  

  - миграция live_event_participant_prefs
  - серверные guards цвета/аватара
  - изменение snapshot-логики comments/questions
  - только потом get_room_participants
  - только потом reactions / blocks / UI  
  Иначе потом придётся переделывать чат и Q&A второй раз.
7. **PHASE 3 Entry Flow дополнить**
  - Если у пользователя уже есть prefs для этого эфира:
    - показывать их сразу в форме
    - allow edit before enter
  - Добавить подпись:
    - “Ваше настоящее имя администратор увидит отдельно, участники увидят только это имя”
  - Для аватара:
    - показывать preview из profiles.avatar_url
    - если аватар скрыт, сразу показывать будущий placeholder.
8. **PHASE 4 явно разделить 4 поверхности**  
Helper/правила должны быть проверены отдельно для:
  - список участников
  - чат
  - вопросы
  - реакции  
  Во всех 4 местах должны совпадать:
  - alias
  - цвет
  - видимость аватара  
  Нельзя допустить, чтобы, например, в чате аватар скрыт, а в реакциях или вопросах всё равно светился.
9. **Privacy QA усилить обязательными кейсами**  
Добавить в PHASE 5 ещё 4 обязательных проверки:
  - пользователь сменил alias после нескольких сообщений → старые сообщения остались со старым snapshot, новые с новым
  - пользователь выключил аватар после нескольких сообщений → старые публичные сообщения не начинают показывать скрытый аватар
  - staff видит Real Name (alias), student видит только alias
  - devtools/network у student не содержат full_name, email, phone, contact_id, profiles.avatar_url, если show_avatar=false
10. **Final DoD дополнить ещё 3 пунктами**

&nbsp;

- публичные сообщения и вопросы снапшотят alias/цвет/аватар в момент отправки
- reconnect/rejoin не сбрасывает alias/цвет/show_avatar в рамках конкретного эфира
- изменение alias/аватара не ломает приватность старой истории и не подменяет её задним числом

11. **Порядок запуска скорректировать**

- **Запуск 1:** PHASE 0 + PHASE 1, но обязательно с prefs + snapshot contract + server guards
- **Запуск 2:** PHASE 2 + PHASE 3
- **Запуск 3:** PHASE 4
- **Запуск 4:** PHASE 5
- Никаких переходов к reactions/sales, пока не закрыт identity/privacy foundation

12. **Жёсткий stop-guard**

- Если до конца PHASE 1 не доказано, что:
  - alias персистится,
  - цвет staff-only защищён сервером,
  - snapshot сообщений не тянет real name,
  - hidden avatar не течёт,
- дальше в PHASE 2/3/4 не идти.

Это сделает спринт завершённым по сути, а не только визуально.

&nbsp;

# План: Webinar Room Upgrade — P1 MVP (с правилами приватности имени и аватара)

Add-only спринт поверх текущей комнаты. Сохраняет всю логику `live_stream`/`recorded_webinar`/`autowebinar`. Добавляет privacy-инварианты как обязательную часть scope.

## PHASE 0 — Discovery + Scope Freeze

**Reuse map:**

- `live_events.metadata` — расширяем, не плодим таблицу настроек
- `live_event_room_blocks` + редактор — расширяем типы `text` и `product_choice`
- `live_active_sessions` + heartbeat — SoT участников, добавляем колонки идентичности
- `LiveEventComments`/`Questions` — render-only emoji-нормализация, SoT не трогаем
- `liveRoomTheme.css`, `parseRoomState`, `RoomLifecycleActions` — переиспользуем
- `LiveRoleBadge`, `liveRoomRoles.ts`, `useDisplayProfiles` — основа для name/avatar helper
- Realtime: comments/questions/blocks уже подключены; reactions = новый канал

**Не входит:** stickers, sticker packs, fake viewer count, scripted chat.

## PHASE 1 — Backend / Data Foundation

**1.1 — `live_events.metadata.room_settings` (без новой таблицы):**

```jsonc
room_settings: {
  prestart: { enabled, title, cover_url, timer_enabled, music_url, gallery: [{url,caption}] },
  participants: { visible_for_students },
  entry: { name_required, color_required, avatar_toggle_enabled,
           allowed_colors: ["#…"], staff_reserved_colors: ["#ef4444"] },
  chat: { emoji_normalization_enabled },
  reactions: { enabled, rate_limit_per_min }
}
```

**1.2 — Расширить `live_active_sessions` (add-only, nullable):**

- `display_name text` — публичное имя в комнате
- `nickname_color text` — выбранный цвет
- `show_avatar boolean default false` — публичная видимость аватара
- `display_avatar_url` — НЕ копируем; читаем `profiles.avatar_url` через RPC при `show_avatar=true`
- `real_contact_name_snapshot` — НЕ хранится; staff-label вычисляется на сервере в RPC

RLS: own-row UPDATE для authenticated; staff может читать всех в своём `live_event_id`.

**1.3 — RPC `get_room_participants(_event_id uuid)` (security definer, единственный канал чтения участников):**

- Принимает viewer JWT, определяет роль через `has_role`.
- Возвращает массив `{ user_id, display_name, nickname_color, role_in_room, avatar_url, real_name_for_staff }`.
- Для **student-view**: `avatar_url = show_avatar ? profiles.avatar_url : null`, `real_name_for_staff = null`.
- Для **staff-view**: `avatar_url = profiles.avatar_url` (внутренний), `real_name_for_staff = profiles.full_name | crm.contact_name`.
- Никогда не возвращает email/phone/contact_id обычным пользователям.

**1.4 — `live_event_reactions` (отдельная таблица, не в comments):**
`id, live_event_id, user_id, emoji, created_at` + index + RLS (own-INSERT, rate-limit DB-функция `can_send_reaction`) + Realtime publication.

**1.5 — `live_event_room_blocks**` — расширить supported `block_type` до `button|banner|text|product_choice`.

**1.6 — Storage:** bucket `webinar-prestart` (public read, admin write) для cover/music/gallery. Аватары НЕ копируем — только ссылка из profiles.

**Realtime contract:** postgres_changes на `room_blocks`/`reactions`/`live_active_sessions`; invalidate-query для `metadata` updates.

**Gate DoD:** schema готова, RLS изолирует приватные поля на сервере, autoweb/live_stream не сломаны.

## PHASE 2 — Admin UI Settings

Один компонент `WebinarRoomSettingsCard.tsx` в `AdminLiveEvents`, секции:

1. **Pre-start** — cover/title/timer/music/gallery (storage upload).
2. **Sales Blocks** — переиспользовать `LiveEventRoomBlocksEditor` + поддержка `text`/`product_choice` (tariff selector ID-first).
3. **Participants Visibility** — toggle.
4. **Entry Settings** — name/color toggles, color palette (red помечен «staff only»), `avatar_toggle_enabled` toggle.
5. **Chat & Reactions** — emoji normalization toggle + rate-limit input.

**Gate DoD:** настройки сохраняются/перезагружаются, sales-блоки CRUD работает.

## PHASE 3 — Room Entry Flow

`**RoomPreStartScreen.tsx**` — countdown к `scheduled_at`, cover, music (`<audio>` muted-by-default + unmute), gallery. Music `cleanup` при переходе в live.

`**RoomEntryDialog.tsx**` — единый шаг входа:

- Превью текущего аватара из `profiles.avatar_url` сверху
- Поле **«Как вас показывать в комнате»** + подсказка *«Другие участники увидят только это имя»*
  - Если `profiles.full_name` существует → подставляется как draft, пользователь может заменить на псевдоним
- Color palette grid (red disabled для не-staff с tooltip)
- Toggle **«Показывать мой аватар»** (default: false для приватности)
- Кнопка «Войти»

Сохранение: UPDATE `live_active_sessions` (own-row RLS) с `display_name`/`nickname_color`/`show_avatar`.

Логика gating в `LiveEventLegacy`:

- `prestart.enabled && now < scheduled_at + 5m` → `RoomPreStartScreen`.
- `entry.name_required && !session.display_name` → `RoomEntryDialog` блокирует контент.

**Gate DoD:** countdown/music/gallery работают; entry name+color+show_avatar сохраняются; red staff-only enforced; transition без reload.

## PHASE 4 — Core Room Runtime + Privacy Helper

**4.1 — Единый helper `src/lib/getRoomParticipantPresentation.ts`:**

```ts
getRoomParticipantPresentation(participant, viewerRole) → {
  label: string,        // student: display_name; staff: "Real Name (display_name)" или "Real Name" если совпадает/пусто
  color: string,        // nickname_color
  avatarUrl: string|null, // student: show_avatar ? profile.avatar : null; staff: всегда profile.avatar (internal)
  isAvatarPublic: boolean,
  role: AuthorRole,
}
```

Используется во ВСЕХ 4 местах: список участников, чат, Q&A, реакции. Никаких прямых обращений к `profiles.full_name` / `avatar_url` в public render.

**4.2 — `RoomParticipantsList.tsx**` — читает только через RPC `get_room_participants`. Render gated: `room_settings.participants.visible_for_students || isStaff`.

**4.3 — Chat emoji normalization** — `src/lib/normalizeEmoji.ts` (pure: `:) → 🙂` и т.д.). Применяется **render-time** в `LiveEventComments`. SoT (`live_event_comments.body`) НЕ трогаем.

**4.4 — Применить helper в:**

- `LiveEventComments` — заменить прямой рендер автора на `getRoomParticipantPresentation`
- `LiveEventQuestions` — то же
- `RoomReactionsLayer` — emoji + label по helper
- `RoomParticipantsList` — основной consumer

**4.5 — Sales block runtime** — расширить `LiveEventRoomBlocks.tsx`:

- `text` → markdown card
- `product_choice` → CTA → каноническая оплата (`createPaymentCheckout`, ID-first)
- Show/hide через `is_active` postgres_changes

**4.6 — Reactions runtime** — `RoomReactionsLayer.tsx`:

- Popover с 6 emoji (👍❤️🔥👏😂😮)
- INSERT в `live_event_reactions` + DB rate-limit
- Subscribe INSERT → CSS `@keyframes float-up` 3s, auto-cleanup
- НЕ попадают в `live_event_comments`

**Gate DoD:** все 4 пункта работают без reload; helper — единственный источник имени/аватара в public render; regression-set зелёный.

## PHASE 5 — Runtime QA + Fix-only

**Privacy-кейсы (обязательные):**

- User A входит как «Алекс» с `show_avatar=false`:
  - User B видит только «Алекс» + цвет + placeholder/инициалы
  - Admin видит «Иванов Иван (Алекс)» + реальный аватар (staff-view)
- User A входит как «Алекс» с `show_avatar=true`:
  - User B видит «Алекс» + цвет + аватар из profiles
- Поиск по DOM/network: ФИО/email/phone/contact_id НЕ присутствуют в payload для не-staff
- Чат / список / Q&A / реакции — единое имя по helper, нет расхождений

**Regression:** lifecycle, autoweb (scripted isolation), comments/questions, contact-card → webinars, admin live-events table.

**Gate DoD:** proof-pack полный; blocker/major закрыты; minor → backlog.

## STOP-Guards (privacy + общие)

**Privacy invariants:**

- Real name / email / phone / contact_id / internal_ids **никогда** не в public room payload.
- Student render **никогда** не обращается к `profiles.full_name` напрямую — только через helper с `viewerRole='student'`.
- Если `show_avatar=false` — `profiles.avatar_url` **не должен** появиться ни в одном из: чат, список участников, Q&A, реакции.
- Public room UI получает participant payload **только** через RPC `get_room_participants` (security definer), не через прямой `select profiles.*`.
- Staff-view (real name + alias) рендерится только если `isStaff(viewerRole)` подтверждён через `has_role`.

**Архитектура:**

- НЕ создавать вторую таблицу комнат / параллельный realtime.
- НЕ писать нормализованные emoji в `live_event_comments` (SoT immutable).
- НЕ смешивать reactions/sales/system с `live_event_comments`.
- НЕ трогать триггеры `enforce_autoweb_session_id_*`.
- НЕ копировать аватары в storage — только ссылка через RPC.
- НЕ ослаблять RLS `live_active_sessions` глобально.
- НЕ начинать stickers/fake-viewers/scripted в этом спринте.

## Final DoD (весь спринт)

1. Pre-start страница до старта (cover/timer/music/gallery).
2. Без пустого live-room экрана после старта.
3. Entry: имя + цвет + toggle аватара сохраняются per-event.
4. Red color = staff-only enforced UI + DB.
5. Toggle видимости списка участников работает realtime.
6. Emoji-нормализация render-time, SoT не изменён.
7. Sales blocks (4 типа) realtime show/hide.
8. Reactions sync, не попадают в чат.
9. **Privacy:** обычные пользователи видят только self-selected display_name + цвет + (опц.) аватар.
10. **Privacy:** staff видит «Real Name (alias)» + internal avatar отдельно.
11. **Privacy:** скрытый аватар (`show_avatar=false`) не светится нигде в public render.
12. **Privacy:** ФИО/email/phone/contact_id отсутствуют в DOM/network для не-staff.
13. Единый helper `getRoomParticipantPresentation` — единственный источник имени/аватара в public render.
14. `live_stream`/`recorded_webinar`/`autowebinar` не сломаны.
15. Финальный отчёт: changed-files / SQL proof / runtime proof / privacy-proof / blocker-major-minor / PATCH-лист.

## Порядок запуска

- **Запуск 1:** PHASE 0 + PHASE 1 (discovery + миграции + RPC `get_room_participants`).
- **Запуск 2:** PHASE 2 + PHASE 3 (admin UI + entry flow с avatar toggle).
- **Запуск 3:** PHASE 4 (helper + 4 consumer-точки + sales + reactions).
- **Запуск 4:** PHASE 5 (QA + privacy-proof + fix-only).

Каждая фаза — mini-report. Не закрытое → `Deferred` или `Next sprint backlog` с явной причиной.