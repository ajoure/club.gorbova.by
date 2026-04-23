да, согласен, с учетом правок:

1. Не снимай безусловно guard (state === "room_open_waiting" || isWaiting) для боевого рендера всем пользователям.  
Правильнее разделить:  

  - **runtime pre-start для пользователей** — показывать только в ожидающем состоянии до старта;
  - **preview для админа** — отдельный явный режим предпросмотра в админке, который не зависит от scheduled_at и lifecycle state.  
  Иначе можно случайно показать pre-start там, где комната уже не должна его показывать.
2. В diagnose явно зафиксируй **главную причину бага** как комбинацию условий:
  - prestart.enabled === false по умолчанию;
  - пользователь загружает cover/music, но не включает toggle;
  - runtime-рендер ещё и зависит от scheduled_at > now() и waiting-state.  
  То есть баг не в upload bucket и не в live-resolve, а в **UX-контракте включения + слишком жёстком условии показа**.
3. Для музыки обязательно добавь отдельный пункт про **browser autoplay restrictions**.  
На iOS/Safari и части desktop-браузеров музыка без user gesture часто не стартует.  
Поэтому DoD должен быть таким:
  - музыка гарантированно **готова** и управляется;
  - автозапуск делать только если браузер разрешил;
  - если не разрешил — показать красивую кнопку Включить музыку, а не считать это багом.  
  Иначе подрядчик снова скажет «не работает», хотя это ограничение платформы.
4. В WebinarRoomSettingsCard.tsx не делай авто-включение слишком скрытым.  
Нужно:
  - либо **авто-включить и явно показать toast + визуально перевести toggle в on**;
  - либо при загрузке cover/music/title показать inline-warning:  
  Вы загрузили материалы pre-start, но экран ещё не включён.  
  Первый вариант ок, но UX-сигнал обязателен.
5. Preview в админке должен быть **на тех же данных и тем же компонентом**, но в отдельном admin-only режиме.  
Добавь явный contract:
  - preview не зависит от scheduled_at > now();
  - preview не пишет ничего в runtime state;
  - preview использует тот же RoomPreStartScreen, а не отдельную копию разметки.
6. В редизайне pre-start добавь отдельный fallback для случаев:
  - нет cover;
  - нет title;
  - нет music;
  - scheduled_at отсутствует.  
  Нельзя допускать пустой/сломанный экран.  
  Нужны безопасные значения:
  - дефолтный title;
  - скрытие countdown при отсутствии даты;
  - скрытие music pill при отсутствии audio.
7. В плане verify добавь **минимум 4 proof-сценария**:
  - cover + title + future scheduled_at + enabled=true → pre-start виден;
  - cover загружен, но enabled=false → в админке есть явный warning/auto-enable signal;
  - preview в админке работает независимо от времени;
  - музыка в Safari/iPhone: либо стартует по user gesture, либо корректно показывает кнопку запуска без ошибок.
8. Не пиши, что edge/functions не нужны, пока не проверен источник event_timezone и структура room_settings end-to-end на proof.  
Формулировка должна быть мягче:  
по текущему discovery миграции и edge-правки не требуются, если verify подтвердит, что room_settings/event_timezone уже проходят end-to-end без потерь.
9. В DoD добавь отдельный пункт про **обложку именно в runtime-комнате**, а не только в preview:
  - до старта эфира пользователь видит cover screen;
  - после старта pre-start исчезает и не перекрывает live player.
10. В финальном отчёте потребуй явное разделение:

&nbsp;

- что исправлено в логике включения;
- что исправлено в UX админки;
- что исправлено в runtime pre-start;
- что подтверждено только preview;
- что подтверждено в реальной комнате до старта.

Если хочешь, следующим сообщением я сожму это в готовый короткий блок для вставки в Lovable.

&nbsp;

# План: починить pre-start screen эфира (обложка + музыка + обратный отсчёт)

## Diagnose — что нашёл

**Файлы:**

- Админка: `src/components/admin/live/WebinarRoomSettingsCard.tsx` — корректно загружает файлы в bucket `webinar-prestart` и пишет URL в `metadata.room_settings.prestart.{cover_url, music_url, gallery}`.
- Хранилище: `live_events.metadata.room_settings.prestart` (SoT).
- Pass-through: `supabase/functions/live-resolve/index.ts` уже возвращает `room_settings` клиенту.
- Рендер: `src/components/live/RoomPreStartScreen.tsx` — корректно показывает обложку, таймер, музыку.
- Подключение: `src/pages/LiveEvent.tsx` стр. 686.

**Условие отображения сейчас:**

```ts
roomSettings.prestart.enabled
  && data?.scheduled_at
  && new Date(data.scheduled_at).getTime() > Date.now()
  && (state === "room_open_waiting" || isWaiting)
```

**Корневые причины бага «загрузил обложку — ничего не меняется»:**

1. **Главная.** Отображение завязано на `prestart.enabled === true`. В DEFAULT_ROOM_SETTINGS он `false`. Пользователь грузит cover/music/title, жмёт Save, но если не переключил «Включить pre-start» — экран не появляется. Нет визуальной связки в админке (нет hint/auto-enable).
2. **Вторая.** Условие требует `scheduled_at > now()`. Для уже идущего/прошедшего эфира pre-start screen не покажется в принципе — даже как preview, и для админа в режиме «room_open_waiting», если `scheduled_at` в прошлом.
3. **Третья.** В админке нет «Предпросмотра» — нельзя проверить, как выглядит итог, без открытия комнаты в правильном временном окне. Отсюда впечатление «не работает».
4. **Дизайн.** Текущий заголовок и таймер выглядят бедно: одинарный drop-shadow, нет градиента-вуали под текст, обратный отсчёт без явных «капсул» дн/ч/мин/сек, нет подписи даты/времени.

## Plan — что меняем

### 1. Auto-enable + явный UX-сигнал (админка)

`WebinarRoomSettingsCard.tsx`:

- При успешной загрузке cover/music ИЛИ при заполнении title — если `prestart.enabled === false`, авто-включить тогл и показать toast «Pre-start включён».
- Под тоглом «Включить pre-start» добавить hint: «Экран показывается до старта эфира (когда `scheduled_at` ещё не наступил)».
- Добавить кнопку **«Предпросмотр»** — открывает `Dialog` с `<RoomPreStartScreen prestart={settings.prestart} scheduledAt={...через 2 минуты...} />`, чтобы видеть результат сразу.

### 2. Условие показа в комнате

`src/pages/LiveEvent.tsx` стр. 686:

- Оставить требование `prestart.enabled` (это «вкл/выкл фичи»).
- Снять требование `state === "room_open_waiting" || isWaiting` для случая, когда `scheduled_at > now()` — pre-start логично показывать всегда до начала, независимо от внутреннего lifecycle-состояния (если фича включена и есть будущая дата старта).
- Если `scheduled_at` пуст или в прошлом — показ pre-start пропускается (нынешнее поведение остаётся).

### 3. Редизайн pre-start screen (дорого, аккуратно)

`src/components/live/RoomPreStartScreen.tsx`:

- Двойная вуаль: верхний `bg-gradient-to-b from-black/10 via-black/30 to-black/70` поверх обложки → читаемость текста на любом фоне.
- Заголовок: `text-3xl md:text-5xl font-semibold tracking-tight` + `text-shadow` через `[text-shadow:_0_2px_24px_rgba(0,0,0,0.5)]`.
- Под заголовком — строка «Старт: 24 апреля, 19:00 (Europe/Minsk)» (из `scheduledAt` + `event_timezone`).
- Обратный отсчёт — 4 «капсулы» (дни/часы/минуты/секунды) с `backdrop-blur-md bg-white/10 border border-white/15 rounded-2xl`, числа `text-4xl md:text-6xl font-semibold tabular-nums`, подписи мелким caps-стилем.
- Музыка: компактная пилюля внизу по центру (Play/Pause + mute), `backdrop-blur` + `rounded-full`, без визуального шума.
- Галерея: переехать внизу в карусель `flex gap-2 overflow-x-auto snap-x` с лёгким fade по краям.
- Если cover нет — мягкий брендовый градиент `from-primary/30 via-background to-primary/10` вместо плоского muted.

### 4. Передача timezone

`live-resolve/index.ts` уже возвращает `event_timezone` (использует `RoomWaitingState`). Передать его в `RoomPreStartScreen` как опциональный проп для красивой строки даты.

## Dry run / риски

- Auto-enable: меняет дефолтное поведение, но только при явных действиях пользователя (загрузка/ввод) → ожидаемое UX-улучшение, безопасно.
- Снятие условия `state/isWaiting`: возможен крайний случай, когда комната «closed» при будущем `scheduled_at` — pre-start всё равно покажется. Это и есть желаемое поведение (тизер до старта).
- Bucket `webinar-prestart` — публичный, существующая загрузка работает; миграции БД не требуются.
- Редизайн: чисто визуальный, контракты пропсов сохраняются.

## Execute → Verify → DoD

**Шаги execute (default mode):**

1. Патч `WebinarRoomSettingsCard.tsx` (auto-enable, hint, кнопка Preview через Dialog).
2. Патч `LiveEvent.tsx` стр. 686 (условие + проп `eventTimezone`).
3. Редизайн `RoomPreStartScreen.tsx` (вуаль, капсулы таймера, строка даты, музыкальная пилюля, галерея-карусель, fallback-градиент).
4. Smoke-тест: создать эфир с `scheduled_at = now()+10min`, загрузить cover + music + title, открыть страницу эфира → видим красивый pre-start с обратным отсчётом и воспроизведением музыки по клику.

**DoD:**

- Загрузка обложки/музыки в админке мгновенно включает pre-start (или явно сообщает об этом).
- В админке есть кнопка «Предпросмотр», открывающая модал с реальным компонентом.
- На странице эфира при `scheduled_at > now()` и `prestart.enabled` показан красивый экран с обложкой, заголовком, датой/временем старта, обратным отсчётом-капсулами, кнопкой музыки.
- Скриншоты приложены (desktop + mobile).
- Никаких изменений схемы БД и edge-функций (только client-side + UX).