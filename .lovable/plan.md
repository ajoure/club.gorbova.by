да, согласен, с учетом правок:

1. **Базой для визуала сделать именно карточку контакта.**  
Не копировать её стили вручную в новую локальную константу. Использовать тот же паттерн/те же классы как основу и только **увеличить размер** карточки эфира поверх этого референса.
2. **Это только UI-переупаковка существующей карточки эфира.**  
Никаких новых функций, новых сущностей, новых сценариев работы, новых полей form state, новых payload, новых save-path. Только другое отображение уже существующих секций.
3. **Не уводить задачу в отдельную новую реализацию.**  
По возможности делать в **том же AdminLiveEvents.tsx**, без вынесения новой бизнес-логики и без “новой карточки эфира”.  
Допускается только минимальный локальный UI-рефакторинг, если он не меняет поведение.
4. **Контейнер менять только если это безопасно.**  
Цель — визуально и по UX как карточка контакта, но если для этого не нужно переводить всё на новый Sheet, то лучше оставить текущий open/close-контур и просто привести внешний вид к тому же паттерну.  
Нельзя ломать:
  - open create / open edit,
  - Esc,
  - клик по overlay,
  - cancel,
  - delete,
  - reset формы.
5. **Под-вкладки реально перенести внутрь “Дополнительно”.**  
Блоки:  

  - Комната
  - Комментарии
  - Вопросы
  - Модерация
  - Сценарий
  - Блоки
  - CTA
  - Тема  
  должны быть внутри карточки эфира, а старый внешний блок под формой нужно **убрать полностью**, чтобы не было дубля.
6. **Горизонтальный scroll вкладок обязателен.**  
И для верхнего уровня, и для второго уровня внутри “Дополнительно”.  
flex-wrap не использовать. Нужен UX **один в один как в карточке контакта**.
7. **AutowebModeEditor не выносить в отдельную новую логику.**  
Оставить его в той же бизнес-зоне, где он уже есть, просто визуально поместить в нужную вкладку. Саму логику не менять.
8. **Gate после первого сохранения сохранить 1:1.**  
До первого save во вкладке “Дополнительно” показывать только empty-state / подсказку.  
После первого save — появляются существующие под-вкладки.  
Это поведение не менять.
9. **Dropdown / Select / Popover привести к удобному scroll-поведению**, но только визуально:
  - длинные списки должны скроллиться;
  - никаких изменений данных, query, handlers.
10. **DoD усилить регрессионной проверкой:**

&nbsp;

- create работает;
- edit работает;
- save работает;
- delete работает;
- cancel работает;
- Esc работает;
- overlay-close работает;
- повторное открытие формы не ломает state;
- payload и validation не изменены.

11. **Proof-пакет обязателен:**

- create mode;
- edit mode;
- “Дополнительно” до первого save;
- “Дополнительно” после save с под-вкладками;
- длинный Select со scroll;
- успешный save без регрессий.

Главный смысл: **не создавать ничего нового, не дублировать карточку, не трогать логику эфиров, а только переупаковать существующую карточку в tabs-UX по образцу карточки контакта, но крупнее и удобнее.**

&nbsp;

# План: рефакторинг карточки эфира во вкладки по образцу карточки контакта

## Цель

Только UI/UX-патч существующего диалога создания/редактирования эфира в `src/pages/admin/AdminLiveEvents.tsx`. Никакой бизнес-логики, миграций, новых полей, edge-функций, replay/publish/folder/lesson, изменений payload/validation/handlers. Визуал и поведение вкладок — один в один как в `ContactDetailSheet`, но больше по размеру.

## Канонический референс: `ContactDetailSheet`

Что копируем 1:1 (структура, не данные):

```
Sheet (right-side) → SheetContent (SHEET_SHELL_CLASS, flex flex-col overflow-hidden)
├── SheetHeader  (flex-shrink-0, p-4 sm:p-6)
├── Tabs (flex-1 flex flex-col min-h-0 overflow-hidden, value/onValueChange controlled)
│   ├── div.flex-shrink-0.overflow-x-auto.scrollbar-none   ← горизонтальный скролл вкладок РАЗРЕШЁН
│   │   └── TabsList.inline-flex.w-auto.whitespace-nowrap.bg-transparent.h-auto
│   │       └── TabsTrigger.text-xs sm:text-sm.px-2.5 sm:px-3   (по 5 шт.)
│   ├── Separator
│   └── div[ref=scrollContainerRef].flex-1.overflow-y-auto   ← вертикальный скролл ТОЛЬКО внутри активной вкладки
│       └── div.px-4 sm:px-6.py-4.pb-24
│           └── TabsContent (m-0 space-y-4)
└── (футер действий — внизу, sticky)
```

Этот же паттерн применяем к карточке эфира.

## Что меняем в `src/pages/admin/AdminLiveEvents.tsx`

### 1. Шелл диалога

Заменить текущий `<Dialog>/<DialogContent>` (lines 1035-1652) на `<Sheet>/<SheetContent>` с собственным шеллом-классом, аналогичным `SHEET_SHELL_CLASS`, но **больше** по размеру:

- Создать локальную константу `LIVE_EVENT_SHEET_SHELL_CLASS` рядом с компонентом (не трогаем общий `sheetShell.ts`):
  - ширина: `w-[calc(100%-1rem)] sm:w-[calc(100%-2rem)] sm:max-w-5xl` (vs `max-w-3xl` у контактов);
  - высота: `!h-[calc(100dvh-1rem)] sm:!h-[calc(100dvh-2rem)] !max-h-[calc(100dvh-2rem)]`;
  - позиция/радиусы/safe-area — идентично `SHEET_SHELL_CLASS`;
  - `flex flex-col overflow-hidden p-0`.

Альтернатива (если решим оставить Dialog для минимального дифа): `DialogContent` с `max-w-5xl`, `h-[min(900px,90vh)]`, `flex flex-col overflow-hidden p-0`. Финальный выбор — Sheet, чтобы UX был **полностью** тождественен карточке контакта (правый sheet, не модал по центру).

### 2. Структура вкладок

Внутри `<Sheet>` — один controlled `<Tabs value=... onValueChange=...>` с `useState("basic")`. Сброс на `"basic"` при открытии диалога (`useEffect` по `dialogOpen`/`editingId`).

**Уровень 1 (5 вкладок):**


| value           | label         | содержимое (переносим как есть)                                                                                                                                                                                 |
| --------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `basic`         | Основное      | селектор event_type (если !editingId) + бейдж типа + AutowebModeEditor (для recorded_webinar/autowebinar) + FormSection «Основное» (название/slug/описание/дата/время/TZ) + Summary block + Readiness checklist |
| `source`        | Источник      | FormSection «Живой эфир Kinescope» / «Источник видео» (lines 1147-1314) + Source Debug Block (lines 1517-1579) + Collapsible «Расширенные настройки» (lines 1582-1609)                                          |
| `access`        | Доступ        | FormSection с `LiveEventAccessRulesEditor` (lines 1319-1324) + FormSection «Приглашения» (lines 1329-1355) + блок «Публикация» (lines 1463-1495)                                                                |
| `notifications` | Уведомления   | FormSection «Уведомления» (lines 1361-1456). Для не-`live_stream` — info-empty-state «Доступно для живых эфиров»                                                                                                |
| `extras`        | Дополнительно | (уровень 2, см. ниже). Если `!editingId` — info-empty-state: «Доступно после первого сохранения» — это сохраняет текущее правило `editingId`-gate.                                                              |


**Уровень 2 (внутри `extras`, только при `editingId`):**

Переносим существующий `<Tabs defaultValue="comments">` блок (lines 2440-2506) — целиком, без изменения внутренних компонентов, **из тела страницы внутрь TabsContent value="extras"**. Состав 8 под-вкладок и порядок — как просил пользователь:

1. `room` — Комната (`WebinarRoomSettingsCard`)
2. `comments` — Комментарии (`LiveEventComments`)
3. `questions` — Вопросы (`LiveEventQuestions`)
4. `moderation` — Модерация (`LiveEventModerationPanel`)
5. `scenario` — Сценарий (`LiveEventScenario`)
6. `blocks` — Блоки (`LiveEventRoomBlocksEditor`)
7. `cta` — CTA (`LiveEventProductCtaBindings` + `LiveEventCtaRuntimePanel`)
8. `theme` — Тема (`LiveEventThemeEditor`)

Под-вкладки тоже стилизуем по паттерну контакта: горизонтальный скролл-контейнер + `TabsList` `inline-flex w-auto whitespace-nowrap bg-transparent h-auto`. **Заменяем** текущий `flex flex-wrap` на горизонтальный скролл — это согласовано пользователем.

Кнопка «Экспорт данных» (lines 2444-2447) — оставить шапкой над под-вкладками внутри `extras` (логика не трогается).

### 3. Скроллы — финальные правила

- **Внешний контейнер** (`SheetContent`): `overflow-hidden`, скролла нет.
- **Tabs bar (level-1)**: обёртка `overflow-x-auto scrollbar-none` → горизонтальный скролл вкладок разрешён (как в контакте).
- **Tabs bar (level-2 внутри `extras`)**: то же самое — горизонтальный скролл разрешён.
- **Контент активной вкладки**: единственный вертикальный скролл — `div.flex-1.overflow-y-auto` под Tabs (один на весь Sheet, как в контакте). Внутри `TabsContent` — `m-0 space-y-4`.
- **Под-вкладки `comments/questions/moderation**`: оставить текущее `h-[500px] overflow-hidden` (внутренние блоки с собственным скроллом — это уже существующая логика).
- **Длинной single-page формы больше нет** — секции живут только внутри своих вкладок.

### 4. Dropdown / Select / Popover внутри карточки

Привести к единому стандарту, как в админских карточках (без изменения данных и обработчиков):

- Все `<SelectContent>` внутри диалога эфира — добавить `className="max-h-[60vh] overflow-y-auto"`.
- Все `<PopoverContent>` (если используются для Kinescope project/video pickers, продуктовых селектов в `LiveEventAccessRulesEditor`) — `max-h-[60vh] overflow-y-auto`.
- Затронутые места: Kinescope project select (line 1255), Kinescope video select (line 1278), invite_mode Select (line 1330), notification-related селекты, продуктовые селекты внутри `LiveEventAccessRulesEditor` (правка минимальная и только если там сейчас нет max-h — иначе не трогаем).

### 5. Футер действий

В шелле Sheet — sticky-нижний `div.flex-shrink-0.border-t.p-4` с двумя кнопками («Отмена», «Сохранить/Создать»), идентичными текущим (lines 1641-1650). Логика и `disabled`-условия — без изменений.

## Что НЕ трогаем

- `saveMutation`, `form`-state, `handleTitleChange`, `slugExists`, `canPublish`, `blockers`, `isInviteReady`, `publishAttempted`.
- `AutowebModeEditor`, `LiveEventAccessRulesEditor`, `LiveEventComments`, `LiveEventQuestions`, `LiveEventModerationPanel`, `LiveEventScenario`, `LiveEventRoomBlocksEditor`, `LiveEventProductCtaBindings`, `LiveEventCtaRuntimePanel`, `LiveEventThemeEditor`, `WebinarRoomSettingsCard`, `LiveEventExportButtons` — переиспользуем как есть.
- Backend, миграции, edge functions, схему `live_events`, RLS, `metadata`, validation, payload, AlertDialog'и (Recreate/Detach), таблицу со списком эфиров.
- Правило `editingId`-gate для блоков второго уровня (Comments/Room/...): они продолжают появляться только после первого сохранения — теперь как пустое состояние во вкладке «Дополнительно» до сохранения, и наполненный level-2 Tabs после.

## Файлы

- `src/pages/admin/AdminLiveEvents.tsx` — единственный изменяемый файл.
  - Заменить `<Dialog>` диалог lines 1035-1652 на `<Sheet>` с tabs-структурой.
  - Перенести блок lines 2440-2506 внутрь TabsContent `extras`. Удалить его из тела страницы.
  - Добавить локальный `LIVE_EVENT_SHEET_SHELL_CLASS`.
  - Добавить `useState` для `activeTab` и `extrasTab` + `useEffect` сброса при открытии.

Никаких других файлов.

## STOP-guards

- Не редактируем `src/lib/sheetShell.ts` (общий шелл).
- Не меняем internals под-компонентов.
- Не меняем `saveMutation.mutate(form)` payload.
- Не уменьшаем `sm:max-w-5xl` ниже `4xl` и не превышаем `6xl` (разумный предел — больше карточки контакта `3xl`, но не во весь экран).
- Не запрещаем горизонтальный скролл вкладок — он обязателен по обновлённому правилу.
- Не убираем `editingId`-gate для второго уровня вкладок.
- Не используем `flex-wrap` для TabsList — только горизонтальный скролл.

## Diagnose / Dry run

Compile-чек после правки (`npm run build`), визуальный просмотр в preview:

- открыть `/admin/live-events` (логин dev `123456`),
- «Создать эфир» → должно открыться правым sheet'ом, видны 5 вкладок level-1, во вкладке «Дополнительно» — empty-state «Доступно после первого сохранения»,
- сохранить минимальный draft → переоткрыть → во вкладке «Дополнительно» появились 8 под-вкладок с горизонтальным скроллом,
- проверить, что вертикальный скролл есть только внутри активной вкладки, а не у всего sheet,
- открыть Select продукта в «Доступ» → list скроллится в пределах `max-h-[60vh]`,
- сохранить изменения → save mutation отрабатывает как раньше,
- AutowebModeEditor виден во вкладке «Основное» при выборе «Видео / Автовебинар».

## DoD

- Карточка эфира — правый Sheet, шелл идентичен карточке контакта, но шире (`sm:max-w-5xl`) и выше (`100dvh-2rem`).
- 5 верхних вкладок: Основное / Источник / Доступ / Уведомления / Дополнительно — горизонтальный скролл tabs-bar работает.
- Внутри «Дополнительно» — 8 существующих под-вкладок (Комната / Комментарии / Вопросы / Модерация / Сценарий / Блоки / CTA / Тема), горизонтальный скролл — есть.
- Длинной одностраничной формы больше нет; вертикальный скролл — только внутри активной вкладки.
- Все Select/Popover внутри диалога — `max-h-[60vh] overflow-y-auto`.
- create / edit / cancel / delete / autowebinar / access rules / room/comments/.../theme работают как раньше — payload и handlers не изменены.
- Под-вкладки доступны только после первого сохранения (правило сохранено).
- Скрин-proof в preview: открытие Create → 5 вкладок → empty-state «Дополнительно»; открытие Edit существующего → все 8 под-вкладок видны и работают; раскрытый Select продукта со скроллом; успешный Save без ошибок.