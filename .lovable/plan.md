да, согласен, с учетом правок:

1. **Разделить на 2 фазы.**  
**Фаза 1 — обязательно:** refactor диалога во вкладки, вкладка **«Запись»** уже в create-mode, выбор раздела/папки, **ручная кнопка** Опубликовать запись, preview будущего урока, sync access, фиксы dropdown-scroll.  
**Фаза 2 — только после proof:** автоматическая публикация после завершения эфира. Причина: room_state='completed' не гарантирует, что kinescope_video_id уже появился в тот же момент.
2. **Не придумывать новый формат урока.**  
Перед реализацией обязательно найти **канонический** способ создания Kinescope-видео-урока в тренингах и использовать **тот же путь и те же поля**.  
Нельзя хардкодить новый контракт вида video_url = [https://kinescope.io/](https://kinescope.io/)..., пока не подтверждено, что именно так уроки уже создаются в текущей системе.
3. **Ручная публикация — обязательна, не optional.**  
В карточке эфира после появления записи должны быть:  

  - Опубликовать запись
  - Переопубликовать / пересоздать урок
  - Синхронизировать доступ
  - Открыть урок  
  Это нужно даже если позже будет автоматизация.
4. **Добавить preview перед публикацией.**  
Во вкладке **«Запись»** показать read-only preview:
  - куда будет опубликовано;
  - название урока;
  - slug;
  - тип урока / provider;
  - какие правила доступа будут перенесены;
  - статус: не опубликовано / опубликовано / ошибка.  
  Пользователь должен видеть результат до нажатия кнопки.
5. **Поддержать root раздела, не только модуль.**  
Если ModuleTreeSelector уже умеет root, не запрещать его искусственно.  
Нельзя заранее зафиксировать «модуль обязателен», пока не доказано, что lesson-модель реально запрещает root.
6. **Доступ — нужен не только copy, но и audit/resync.**  
Добавить dry-run проверку:
  - сравнить live_event_access_rules vs access rules созданного урока;
  - показать diff;
  - кнопка Синхронизировать доступ.  
  Это закрывает кейс, когда правила эфира изменили уже после первой публикации записи.
7. **Вкладки без горизонтального скролла вообще.**  
Не просто скрыть scrollbar. Нужно реальное перестроение layout:
  - TabsList с wrap/grid;
  - без overflow-x-auto;
  - без индикатора скролла;
  - на 1102 px и 1280 px все level-1 вкладки читаемы сразу;
  - level-2 для автовебинара тоже без горизонтального скролла.  
  Если где-то места не хватает, уменьшать лейблы/иконки и переносить в 2 строки, но не возвращать горизонтальный скролл.
8. **Фикс dropdown-скролла включить в scope явно.**  
Для всех popover/select внутри карточки эфира:
  - Kinescope projects
  - Kinescope videos
  - products/access
  - replay target section/module  
  Везде единый контракт: max-h-[60vh] overflow-y-auto.
9. **Idempotency и статус публикации.**  
Хранить в live_events.metadata:
  - replay_target
  - replay_lesson_id
  - replay_publish_status
  - replay_publish_error  
  Нужен явный статус, а не только replay_lesson_id, чтобы видеть, что произошло при ручной/автоматической публикации.
10. **Автоматизация только если есть доказанный серверный паттерн.**  
Если в проекте нет уже работающего и доказанного вызова edge из trigger/pg_net для таких операций, не внедрять это сейчас.  
В таком случае Фаза 2 остаётся отдельным follow-up, а спринт закрывается на ручной публикации + preview + sync access.
11. **Proof-пакет расширить.**  
Помимо предложенных скринов добавить:
  - create-mode: вкладка **«Запись»** доступна до первого сохранения;
  - preview будущего урока;
  - manual publish success;
  - re-publish / sync access dry-run;
  - список эфиров/карточка эфира после публикации;
  - SQL-proof: metadata.replay_target, metadata.replay_lesson_id, replay_publish_status;
  - proof двумя пользователями: запись в /library видна пользователю с доступом и не видна без доступа.
12. **Жёсткий stop-guard по scope.**  
Не делать:
  - новую таблицу recordings;
  - новый selector папок;
  - новый отдельный контур прав доступа;
  - изменения в live-resolve ради этого спринта;
  - автопубликацию без подтверждённого timing kinescope_video_id.

&nbsp;

Если хочешь, следующим сообщением соберу это в уже готовый короткий копируемый PATCH-блок для [lovable.dev](http://lovable.dev).

&nbsp;

&nbsp;

# План: запись эфира → урок-видео в базе знаний + рефакторинг карточки эфира во вкладки

## Цель

1. После завершения эфира с включённой «Запись» автоматически создавать **видео-урок** в выбранной заранее папке базы знаний/вебинаров — переиспользуя существующий механизм `ContentSectionSelector` + `ModuleTreeSelector` (как в «Мастере добавления контента»). Доступ к записи определяется теми же `live_event_access_rules`, что и к самому эфиру (single SoT).
2. Привести диалог «Создать/редактировать эфир» к UX карточки контакта: одно окно без вертикального скролла, навигация по вкладкам (level-1) и подвкладкам (level-2).
3. Починить скролл выпадающих списков (Kinescope videos / projects / products) на узких viewport'ах.
4. Всё реализовать в режиме симуляции (preview), приложить скрины каждого экрана.

## Discovery (done)

**Что переиспользуем (без дублирования):**

- `src/components/admin/trainings/ContentSectionSelector.tsx` — выбор раздела меню (База знаний / Вебинары / …).
- `src/components/admin/trainings/ModuleTreeSelector.tsx` — выбор модуля-родителя (mode `select-parent`, поддерживает «Корень раздела»).
- Edge `training-copy-move` (или прямой insert в `training_lessons` через сервис) — уже умеет создавать урок в выбранном модуле/секции.
- `LiveEventAccessRulesEditor` + таблица `live_event_access_rules` — SoT доступа к эфиру/записи.
- `live_resolve` уже умеет отдавать replay при `replay_enabled` и `kinescope_video_id` — поэтому **запись остаётся доступна и по `/live/<slug>**`, а урок-видео в базе знаний добавляется как **второй удобный путь входа** (с теми же правилами доступа).

**Что НЕ создаём заново:**

- Никаких новых таблиц rec­ord­ings.
- Никаких новых RLS-моделей. Урок-видео отрисовывается стандартным `LibraryLesson`, его видимость уже регулируется `useTrainingContent` через `access_rules`/`granular content access`, выровненными с правилами эфира.
- Никаких новых селекторов папок.

**Как сейчас:**

- `live_events` уже хранит `kinescope_video_id` (после завершения live-стрима Kinescope сохраняет VOD сюда — это уже работает, поле используется в `live-resolve` как replay).
- Поля для целевой папки записи в `live_events` нет → добавляем 2 поля в `metadata.replay_target` (без миграции схемы): `{ menu_section_key, parent_module_id }`. Хранить в `metadata` корректно — там уже сидит `notification_settings`, `kinescope_folder_id` и пр.

## Изменения

### 1. Backend (минимум)

**1.1. Edge функция `live-event-publish-replay` (новая, маленькая, idempotent):**

- Триггерится из БД-триггера `AFTER UPDATE ON live_events` когда `room_state` переходит в `completed` И `replay_enabled=true` И `kinescope_video_id IS NOT NULL` И `metadata->'replay_target'->>'menu_section_key' IS NOT NULL` И `metadata->>'replay_lesson_id' IS NULL`.
- Создаёт `training_lessons` row:
  - `title` = title эфира,
  - `slug` = `replay-${live_event.slug}`,
  - `module_id` = `metadata.replay_target.parent_module_id` (или `NULL` для root, но в БЗ урок всегда лежит в модуле — поэтому в UI на step 2 «куда сохранить» обязательный выбор модуля, как для уроков в `ContentCreationWizard`),
  - `video_url` = `https://kinescope.io/${kinescope_video_id}`,
  - `menu_section_key` = из метадаты,
  - `is_published` = `true`.
- Записывает обратно `live_events.metadata.replay_lesson_id = <new id>` для идемпотентности.
- Зеркалит `live_event_access_rules` в `access_rules` для `resource_type='training_content'` с тем же `product_id`/`tariff_id` (используем уже существующую функцию выдачи `training_content` правил — найти и переиспользовать; не создавать новую).

**1.2. Триггер `trg_live_events_publish_replay`:**

- `AFTER UPDATE ON public.live_events` `WHEN (NEW.room_state = 'completed' AND OLD.room_state IS DISTINCT FROM 'completed')` → вызывает edge через `pg_net` (паттерн уже используется в проекте, например для notification queue).

Если `pg_net`-вызов из БД сочтём избыточным — fallback: ручная кнопка «Опубликовать запись в базу знаний» в карточке эфира после `completed`. **STOP-guard:** если в проекте нет существующего паттерна вызова edge из триггера, делаем только ручную кнопку — без новых инфраструктурных контуров.

### 2. UI карточки эфира — рефакторинг во вкладки

`src/pages/admin/AdminLiveEvents.tsx`, диалог lines 1035-1652. Заменяем единое скролл-окно на структуру по образцу `ContactDetailSheet`:

```
DialogContent: max-w-4xl, h-[min(900px,90vh)], flex flex-col, overflow-hidden, p-0
├─ DialogHeader (фикс)
├─ Tabs (level-1, flex-1, min-h-0)
│   TabsList (sticky top, scroll-x для мобильных)
│   ├─ "Основное"          — тип эфира + название/slug/описание + дата/время/TZ
│   ├─ "Источник"          — Kinescope project/video или live event + advanced override
│   ├─ "Доступ"            — LiveEventAccessRulesEditor + invite_mode + direct_access
│   ├─ "Уведомления"       — все поля notification_*
│   ├─ "Запись"            — replay_enabled + ContentSectionSelector + ModuleTreeSelector (новое)
│   ├─ "Публикация"        — is_published + readiness checklist + summary + diagnostics
│   └─ (only for autoweb) "Автовебинар" с подвкладками (level-2): "Режим", "JIT", "On-Demand"
└─ DialogFooter (фикс)
```

- Внутри каждой вкладки `<TabsContent>` использует `overflow-y-auto` только при крайней необходимости; основная цель — поместить блок без скролла на 900-1200px высоту.
- Подвкладки реализуем вторым `<Tabs>` внутри `<TabsContent>` (как в `ContactDetailSheet` для разделов с большим объёмом).
- Существующие компоненты (`AutowebModeEditor`, `LiveEventAccessRulesEditor`, секции notifications, summary, diagnostics) **переносим без изменения логики** — только перекладываем по табам.
- `FormSection` (локальный, lines 1660+) сохраняем для группировки внутри вкладки.

### 3. Вкладка «Запись» — новые поля (UI)

```tsx
<TabsContent value="recording">
  <FormSection title="Запись после эфира">
    <SwitchRow
      checked={form.replay_enabled}
      onCheckedChange={...}
      label="Разрешить доступ к записи после завершения"
    />
    {form.replay_enabled && (
      <>
        <ContentSectionSelector
          value={form.replay_menu_section_key}
          onChange={(v) => setForm({...form, replay_menu_section_key: v, replay_parent_module_id: null})}
        />
        <ModuleTreeSelector
          sectionKey={form.replay_menu_section_key}
          selectedId={form.replay_parent_module_id}
          onSelect={(id) => setForm({...form, replay_parent_module_id: id})}
          mode="select-parent"
        />
        <p className="text-xs text-muted-foreground">
          После завершения эфира запись автоматически появится в выбранной папке как видео-урок.
          Доступ к записи наследует правила эфира из вкладки «Доступ».
        </p>
        {form.replay_lesson_id && (
          <Badge>Запись опубликована: <Link>{form.replay_lesson_title}</Link></Badge>
        )}
      </>
    )}
  </FormSection>
</TabsContent>
```

В `LiveEventForm` добавляем поля: `replay_menu_section_key: string`, `replay_parent_module_id: string | null`, `replay_lesson_id: string | null`. Сохраняем в `metadata.replay_target` и `metadata.replay_lesson_id` — без изменения схемы.

### 4. Фикс скролла выпадающих списков

В `Select`/`Command`/`Popover` для:

- Kinescope projects (lines ~1255),
- Kinescope videos (lines ~1278),
- продукты в `LiveEventAccessRulesEditor`,
- `ModuleTreeSelector` (внутри новой вкладки).

Применяем стандарт: `<SelectContent className="max-h-[60vh] overflow-y-auto">` и `<PopoverContent className="max-h-[60vh] overflow-y-auto">`. Это уже используется в проекте — приводим все 4 места к единому правилу.

## Итоговые файлы

**Меняем:**

- `src/pages/admin/AdminLiveEvents.tsx` — рефакторинг диалога во вкладки + новая вкладка «Запись» + фиксы Select max-height + поля формы и сериализация в/из `metadata.replay_target`.
- `src/components/admin/live/LiveEventAccessRulesEditor.tsx` — только если там есть Select без `max-h` для продуктов.
- `supabase/functions/live-event-publish-replay/index.ts` — новая edge (создание lesson + зеркалирование access_rules). `verify_jwt = false` (триггер) + ручной вызов из админки с JWT.
- `supabase/migrations/<ts>_replay_publish_trigger.sql` — триггер на `live_events.room_state='completed'`. Только если в проекте уже есть pg_net-паттерн; иначе пропускаем и оставляем ручную кнопку.

**Не меняем:**

- `ContentSectionSelector`, `ModuleTreeSelector`, `LibraryLesson`, `live-resolve`, схема `live_events`, RLS.

## Verify (симуляция в preview)

После внедрения:

1. Открываю `/admin/live-events` в preview (логин dev `123456`).
2. «Создать эфир» → скрин 1: вкладка «Основное», скролла нет.
3. Переключаюсь по всем вкладкам → скрины 2-7: каждая помещается без скролла на 1280×720 и на iPhone-вьюпорт.
4. Вкладка «Доступ»: открываю Select продукта → скрин с раскрытым списком, scroll работает.
5. Вкладка «Запись»: включаю switch, выбираю «База знаний / Вебинары», выбираю модуль «Вебинары» → скрин выбора.
6. Сохраняю эфир, проверяю в БД через `psql`: `metadata.replay_target` записан корректно.
7. Эмулирую `room_state='completed'` (через ручную кнопку или dev-update) → проверяю, что в `training_lessons` появился урок с `video_url=https://kinescope.io/<id>`, `module_id` правильный, `access_rules` для него зеркалят правила эфира.
8. Открываю `/library/...` под обычным юзером с доступом → запись видна; без доступа → не видна.
9. Прикладываю все скрины и SQL-proof в финальный отчёт.

## DoD

- В карточке эфира 6-7 вкладок (+ автовеб подвкладки), вертикального скролла внутри активной вкладки нет на 1280×800.
- Все Select/Popover в карточке имеют `max-h-[60vh] overflow-y-auto`, подтверждено runtime-скрином открытого списка.
- Switch «Запись» + выбор раздела + выбор модуля сохраняются в `metadata.replay_target` (proof: `select metadata->'replay_target' from live_events where id=…`).
- После `completed` (триггер или кнопка) в `training_lessons` создаётся ровно один урок (идемпотентно по `metadata.replay_lesson_id`), `access_rules` для нового lesson зеркалят `live_event_access_rules`.
- Запись доступна по двум путям: `/live/<slug>` (как сейчас) и `/library/<section>/<module>/<lesson>` (новый), с одинаковыми правилами доступа.
- Скрины каждого шага приложены в отчёте.

## STOP-guards

- Не создаём новую таблицу для записей. SoT — `live_events` + `training_lessons` + `live_event_access_rules`/`access_rules`.
- Не создаём отдельный селектор папок. Только `ContentSectionSelector` + `ModuleTreeSelector`.
- Не меняем RLS и не расширяем доступ. Зеркалирование правил — 1:1 с эфиром.
- Если в проекте нет рабочего pg_net-паттерна для вызова edge из триггера — отказываемся от автоматизации и оставляем только ручную кнопку «Опубликовать запись», без новых инфраструктурных контуров.
- Никаких изменений в `live-resolve` — replay по `/live/<slug>` продолжает работать как раньше.
- Не уменьшаем `max-w` диалога ниже `max-w-4xl` на десктопе и не увеличиваем выше `max-w-5xl` (разумный предел).