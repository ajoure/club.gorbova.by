# да, согласен, с учетом правок:

&nbsp;

1. **Сначала исправить источник проблемы Kinescope, а не только UI.**
  В плане правильно указано, что нужно проверить integration_instances, но это надо сделать как отдельный обязательный шаг discovery/proof:
  &nbsp;
  - есть ли реально provider='kinescope' и status='connected';
  - какой instance_id выбран;
  - что возвращает kinescope-api на list_projects;
  - что возвращает list_videos по конкретному project_id.
    Без этого можно красиво перерисовать модалку, но оставить поломанный data flow.
  &nbsp;
2. **Не завязывать весь UX только на provider='kinescope', если в проекте уже использовалось integration_type.**
  В плане нужно явно зафиксировать:
  &nbsp;
  - какой именно столбец является каноническим для поиска инстанса (provider или integration_type);
  - если в проекте есть смешение старой и новой схемы, сделать tolerant lookup, а не один жёсткий фильтр.
  &nbsp;
3. **slugify нужно вынести в общий util без потери текущих кейсов кириллицы/спецсимволов.**
  При переносе в src/utils/slugify.ts нужно не просто копировать функцию, а:
  &nbsp;
  - проверить существующее поведение;
  - не сломать уже используемые места;
  - зафиксировать reuse во всех новых формах, где нужен slug.
  &nbsp;
4. **Для slug нужен guard от дублей, не только автогенерация.**
  В плане добавь:
  &nbsp;
  - проверку уникальности перед сохранением;
  - понятную ошибку, если такой slug уже есть;
  - при автогенерации можно предлагать safe suffix, если адрес занят.
  &nbsp;
5. **Kinescope секция должна иметь 3 состояния, а не 2.**
  Сейчас описаны “нет интеграции” и “есть интеграция”. Нужен ещё третий:
  &nbsp;
  - интеграция есть, но API вернул ошибку / токен невалиден / проекты не загрузились.
    Это должен быть отдельный error-state с понятным текстом, а не маскироваться под empty-state.
  &nbsp;
6. **Список видео Kinescope нужно показывать только если продуктовый сценарий реально “привязать существующее видео”.**
  Добавь в UI-текст явное объяснение:
  &nbsp;
  - “На текущем этапе система привязывает уже существующее видео/эфир Kinescope”
  - либо “Автоматическое создание эфира в Kinescope пока не поддерживается”.
    Иначе пользователь всё равно будет ожидать, что эфир создаётся автоматически прямо здесь.
  &nbsp;
7. **DateTimePicker использовать как единый стандарт, но сначала проверить, что он подходит для admin modal по UX и z-index.**
  Это особенно важно внутри Dialog:
  &nbsp;
  - popup не должен обрезаться;
  - не должен конфликтовать со скроллом модалки;
  - должен нормально работать в overlay.
    Добавь это в DoD и proof.
  &nbsp;
8. **Запрет на input type="datetime-local" зафиксировать как общее правило для проекта.**
  Не только заменить в Live Events, но и записать:
  &nbsp;
  - новые date/time поля создаются только через существующие DatePicker / DateTimePicker;
  - нативный datetime-local больше не использовать.
  &nbsp;
9. **Убрать toast при publish-block не просто в одном месте, а заменить его на inline validation state у switch/action.**
  То есть:
  &nbsp;
  - publish toggle не спамит toast;
  - рядом/ниже видно, что именно блокирует публикацию;
  - blocked items в readiness panel выделены явно.
    Это лучше, чем просто “не показывать toast”.
  &nbsp;
10. **Readiness panel должна разделять ошибки и предупреждения.**
  Не всё одинаково критично.
  Нужно:

&nbsp;

&nbsp;

&nbsp;

- blockers: без этого нельзя публиковать;
- warnings: полезно знать, но публикацию не блокирует.
  Например, отсутствие Kinescope ID — blocker; отсутствие записи — не blocker.

&nbsp;

&nbsp;

&nbsp;

11. **Блок “Как это работает для пользователя” надо сделать действительно human-readable, без технички вроде Kinescope Video ID.**
  Он должен отвечать на 4 вопроса:

&nbsp;

&nbsp;

&nbsp;

- кто войдёт;
- нужен ли invite;
- будет ли запись;
- готов ли эфир к публикации.
  Технические детали туда не тянуть.

&nbsp;

&nbsp;

&nbsp;

12. **Визуальную унификацию нужно привязывать не просто к “как контакты”, а к конкретным existing components/tokens.**
  В плане лучше зафиксировать:

&nbsp;

&nbsp;

&nbsp;

- использовать те же DialogContent / section cards / spacing tokens / text styles, что в contact detail/admin sheets;
- не изобретать новый visual dialect.

&nbsp;

&nbsp;

&nbsp;

13. **Для Kinescope video select нужны loading, empty и error states внутри самого dropdown, а не только снаружи.**
  Иначе снова получится белая пустота.
  Нужно явно прописать:

&nbsp;

&nbsp;

&nbsp;

- loading item;
- empty item;
- error item;
- disable select when instance/project not ready.

&nbsp;

&nbsp;

&nbsp;

14. **Нужен proof, что instance_id реально прокинут и shape response обработан правильно.**
  Добавь в DoD:

&nbsp;

&nbsp;

&nbsp;

- list_projects реально возвращает список;
- после выбора проекта list_videos реально возвращает видео;
- UI отображает их без белой полосы;
- если список пуст — показывает понятный текст.

&nbsp;

&nbsp;

&nbsp;

15. **Если интеграция Kinescope не настроена, publish logic должна учитывать это честно.**
  То есть:

&nbsp;

&nbsp;

&nbsp;

- либо publish blocked без kinescope_video_id;
- либо разрешён draft без публикации;
- но интерфейс должен ясно говорить, что сначала нужно привязать источник трансляции/записи.

&nbsp;

&nbsp;

&nbsp;

16. **Добавь отдельный proof по модалке в финальном виде, а не только по коду.**
  Обязательно:

&nbsp;

&nbsp;

&nbsp;

- скрин/видео slug auto-fill;
- скрин стандартного DateTimePicker;
- скрин Kinescope error/empty state;
- скрин нормального layout switches/help-text/readiness;
- proof, что текст и controls не наезжают друг на друга.

&nbsp;

&nbsp;

В остальном план правильный: сначала привести модалку к стандартному UX, убрать ложные/ломаные состояния Kinescope, заменить календарь на существующий стандарт и сделать slug человеческим.

&nbsp;

План: UX-переработка модалки Live Events

## Диагностика

### Kinescope videos не загружаются

Edge function возвращает 400 `API токен не найден` — значит `instance_id` не передаётся или не найден. Нужно проверить, есть ли реально `integration_instances` с `provider=kinescope` и `status=connected`. Если нет — picker бессмысленен, нужен empty state. Если есть — нужно передавать корректный `instance_id`.

### Пустая белая полоса вместо списка видео

`SelectContent` рендерит пустой список без empty state. Нет обработки ошибок и loading states для video select.

### Slug ручной без автогенерации

Нет связи между title и slug. Существующая `slugify` функция есть в `EntityCustomFields.tsx` — можно переиспользовать.

### Календарь

Используется `<Input type="datetime-local">` — это не кастомный календарь, а нативный. Существующие стандартные компоненты: `DatePicker` (date-only) и `DateTimePicker` (date+time с wheel). `DateTimePicker` из `datetime-picker.tsx` — правильный выбор для scheduled_at.

### Дизайн модалки

Текущая модалка не соответствует стилю платформы (ContactDetailSheet). Нужно привести к единому стандарту: белый фон секций, чёткие отступы, разделители, компактные help-text.

---

## Изменения

### 1. Slug автогенерация

Добавить в `AdminLiveEvents.tsx`:

- Извлечь `slugify` в `src/utils/slugify.ts` (реюз из `EntityCustomFields.tsx`)
- State `slugManuallyEdited: boolean` (default false)
- При изменении `title`: если `!slugManuallyEdited` → автозаполнять slug
- При ручном изменении slug → `slugManuallyEdited = true`
- Help-text под полем: "Короткий адрес эфира в ссылке. Заполняется автоматически из названия."

### 2. Kinescope секция — переработка

**Если `kinescopeInstance` не найден:**

```
Интеграция с Kinescope не настроена.
Используйте ручной ввод Kinescope Video ID в расширенных настройках.
```

**Если найден, picker mode:**

- Проект select с пояснением: "Проект — папка в Kinescope, где хранятся видео"
- Видео select:
  - Loading: `<Loader2>` + "Загрузка видео..."
  - Пусто: "В этом проекте нет видео"
  - Ошибка: "Не удалось загрузить видео"
- Под секцией: "Выберите существующее видео или эфир из аккаунта Kinescope"
- Ссылка "Ввести Video ID вручную" → переключает на manual mode

**Manual mode:**

- Input + пояснение: "Вставьте ID видео или эфира из консоли Kinescope"
- Ссылка "Выбрать из списка" → назад

### 3. Дата/время — заменить на DateTimePicker

Заменить `<Input type="datetime-local">` на существующий `DateTimePicker` из `src/components/ui/datetime-picker.tsx`. Адаптировать: `form.scheduled_at` (ISO string) ↔ `DateTimePicker` (Date + time string).

### 4. Видео select empty/error states

В `AdminLiveEvents.tsx` — после `SelectContent` для видео:

- Если `kinescopeVideosLoading` → показать loading внутри SelectContent
- Если `!kinescopeVideosLoading && kinescopeVideos?.length === 0` → "В этом проекте нет видео"
- Обернуть fetch в try/catch с error state

### 5. Визуальная унификация модалки

- `DialogContent`: убрать лишние отступы, единый `space-y-6`
- Секции: `<div className="space-y-3">` с `<h3 className="text-sm font-semibold">` заголовком
- Help-text: `<p className="text-xs text-muted-foreground">` строго под контролом, не рядом
- Switches "Опубликован" / "Разрешить запись": вертикально (не горизонтально), каждый с help-text под ним
- Readiness checklist: компактный `rounded-lg border p-3 bg-muted/20` блок
- Summary "Как это работает": аккуратная карточка с иконками

### 6. Публикация / Запись — layout fix

Текущий горизонтальный flex с tooltip ломает layout. Заменить на:

```
[ ] Опубликован
    Эфир виден системе и доступен по ссылке

[ ] Разрешить доступ к записи после завершения
    Запись станет доступна пользователям после завершения эфира
```

Каждый switch в отдельном блоке с help-text снизу. Tooltip убрать (заменить на inline text).

### 7. Readiness panel — cleanup

Убрать toast при попытке публикации. Вместо этого:

- Чек-лист всегда виден
- Невыполненные условия — серые с `AlertCircle`
- При попытке включить switch "Опубликован" без readiness — подсветить красным невыполненные пункты, не закрывать dialog

---

## Файлы


| Файл                                  | Действие                                                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/utils/slugify.ts`                | Новый: извлечь slugify из EntityCustomFields                                                               |
| `src/pages/admin/AdminLiveEvents.tsx` | Полная переработка модалки: slug auto, DateTimePicker, Kinescope empty states, layout fix, readiness panel |


## Аудит календарей


| Компонент                              | Используется                     | Стандарт                         |
| -------------------------------------- | -------------------------------- | -------------------------------- |
| `DatePicker` (date-picker.tsx)         | Payments, Filters, Legal forms   | Да — стандарт для дат            |
| `DateTimePicker` (datetime-picker.tsx) | Eisenhower tasks                 | Да — стандарт для дата+время     |
| `Calendar` (calendar.tsx)              | Внутри DatePicker/DateTimePicker | Base component                   |
| `<Input type="datetime-local">`        | AdminLiveEvents                  | Нет — заменить на DateTimePicker |


Правило: новые date/time поля используют только `DatePicker` или `DateTimePicker`. Нативный `<input type="datetime-local">` запрещён.

## DoD

1. Slug автогенерируется из названия, ручная правка останавливает автообновление
2. Kinescope: empty state при отсутствии интеграции, видео, или ошибке
3. Дата/время через стандартный DateTimePicker
4. Switches вертикально с inline help-text, без tooltip overlap
5. Readiness panel — компактный, без toast spam
6. Модалка визуально соответствует стилю платформы