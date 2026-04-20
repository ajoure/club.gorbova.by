# да, согласен, с учетом правок:

1. В `ContactArtifactsTab` не делать отдельный новый визуальный контейнер для вебинаров “рядом” с текущим списком. При `filter === 'webinars'` нужно использовать **тот же основной список-сценарий**, что и у остальных подвкладок: тот же контейнерный ритм, те же отступы, те же `Card/Collapsible`-паттерны, без второго параллельного layout.
2. В `ContactWebinarsTab.tsx` лучше не оставлять старое имя, если компонент теперь живёт как часть artifacts-view. Либо:
  &nbsp;
  &nbsp;
  - переименовать экспорт в `ContactWebinarsView`,
  - либо перенести его в `ContactArtifactsTab` как внутренний subview,  
  чтобы не осталось ложного ощущения, что это отдельная верхнеуровневая вкладка.
3. Для chip `Вебинары` нужно явно зафиксировать поведение count:
  - count считается только для staff;
  - для non-staff chip вообще не рендерится;
  - count должен быть **distinct live_event_id**, а не сумма комментариев и вопросов.
4. В `ContactArtifactsTab` нужно сохранить текущий UX для остальных фильтров без регрессий:
  - `all`,
  - `forms`,
  - `training`.  
  То есть добавление `webinars` не должно менять существующую группировку и рендер этих трёх режимов.
5. В `ContactWebinarsView` внутри раскрытого вебинара лучше сразу зафиксировать **единую timeline по времени**, а не отдельные блоки “сначала вопросы, потом комментарии”.  
Для каждой записи показывать:
  - тип (`Чат` / `Вопрос`);
  - timestamp;
  - текст.  
  Это удобнее и ближе к логике activity history.
6. В верхней строке вебинара добавить обязательную краткую сводку:
  - дата вебинара;
  - `comments_count`;
  - `questions_count`;
  - `last_activity_at`.  
  Без этого карточка будет слишком пустой.
7. Нужно явно удалить старый верхнеуровневый `TabsTrigger/TabsContent` для `webinars` полностью, чтобы не осталось второго входа в ту же сущность и мёртвых импортов/веток.
8. В verify добавить отдельную проверку:
  - chip `Вебинары` отсутствует у non-staff;
  - верхнеуровневого таба `Вебинары` больше нет;
  - внутри `Анкеты` визуально вебинары действительно не выбиваются из существующего дизайна.
9. В DoD добавить ещё один пункт:
  - данные по вебинарам показываются из SoT (`live_event_comments` + `live_event_questions`), а не из `crm_activity_log`.
10. После этого отдельного нового дизайна для вебинаров не должно остаться вообще: только artifacts-style внутри `Анкеты`.

&nbsp;

&nbsp;

План: перенести «Вебинары» внутрь «Анкеты» как подвкладку (фильтр-чип) в едином UI-контуре

## Контекст

Сейчас «Вебинары» — отдельный верхнеуровневый таб карточки контакта (`TabsTrigger value="webinars"` в `ContactDetailSheet.tsx` + локальный самодельный `Card/Accordion` в `ContactWebinarsTab.tsx`). Это нарушает дизайн-систему карточки.

Вкладка «Анкеты» (`ContactArtifactsTab.tsx`) уже использует свой внутренний паттерн подвкладок — **chip-фильтры**: «Все / Анкеты / Обучение» (через `Button variant=default|outline size=sm`), общий список карточек, сгруппированных через `groupByProduct`, раскрытие через `Collapsible` с одинаковыми бордерами/отступами/счётчиками.

Нужно встроить «Вебинары» в этот же паттерн как **четвёртый chip-фильтр** и переписать рендер активности под тот же визуальный контур (Card + Collapsible), а не свой Accordion.

## PATCH 1 — удалить верхнеуровневую вкладку «Вебинары»

**Файл:** `src/components/admin/ContactDetailSheet.tsx`

- Удалить `TabsTrigger value="webinars"` (строки 1611–1617).
- Удалить `TabsContent value="webinars"` (строки 3336–3341).
- Удалить импорт `ContactWebinarsTab` (строка 141).
- Импорт `Video` оставить только если используется в других местах (проверим, иначе убрать).

## PATCH 2 — добавить подвкладку «Вебинары» в `ContactArtifactsTab`

**Файл:** `src/components/admin/contact/ContactArtifactsTab.tsx`

1. Расширить тип фильтра:
  ```ts
   type FilterType = 'all' | 'forms' | 'training' | 'webinars';
  ```
2. Добавить четвёртую chip-кнопку в существующий блок фильтров (строки 205–216), визуально идентичную остальным:
  ```tsx
   <Button variant={filter === 'webinars' ? 'default' : 'outline'} size="sm"
     onClick={() => setFilter('webinars')} className="text-xs h-7"
     disabled={webinarCount === 0}>
     <Video className="w-3 h-3 mr-1" />
     Вебинары ({webinarCount})
   </Button>
  ```
3. **Только staff** видит этот chip (передать `isStaff` prop из `ContactDetailSheet`, который уже знает `isStaffRole(authRole)`).
4. Когда `filter === 'webinars'` — рендерить `<ContactWebinarsView userId={userId} />` (новый компонент в том же файле или соседний), полностью заменяющий список `groups.map(...)`.
5. Когда `filter !== 'webinars'` — текущая логика без изменений.

## PATCH 3 — переписать `ContactWebinarsTab` → `ContactWebinarsView` под artifacts-стиль

**Файл:** `src/components/admin/contact/ContactWebinarsTab.tsx` → переименовать содержимое export в `ContactWebinarsView`.

Сохраняем **полностью**:

- Запрос (read из `live_event_comments` + `live_event_questions`, group by `live_event_id`, lookup `live_events.title/scheduled_at`).
- SoT: ничего в backend не меняем.

Меняем **только presentation** под канон artifacts:

- Вместо `Card + CardHeader + Accordion` — рендер списка вебинаров как `Card + Collapsible` (один-в-один как product-group в artifacts: те же `border`, `rounded-lg`, `p-3`, `ChevronRight/ChevronDown`, шрифт заголовка, badge-счётчики).
- Каждый вебинар = один collapsible-row:
  - заголовок: иконка `Video` (как `Layers` у продуктов), `title`, дата `format(scheduled_at)`;
  - справа — badge-счётчики `comments_count` / `questions_count` в стиле artifacts-counters;
  - раскрытие — единый timeline (comments + questions, отсортирован по `created_at` ASC) с типом-бейджем `Чат`/`Вопрос` и timestamp (как `PayloadSection` в artifacts: `text-xs text-muted-foreground` для меты, `whitespace-pre-wrap` для контента).
- Empty state — в стиле artifacts (`text-sm text-muted-foreground p-8 text-center`).
- Loading — те же `Skeleton` шапки, что в artifacts.

Удалить из файла самодельный «белый» Card-обвес и Accordion shadcn-компонент — переходим на тот же `Collapsible`, что использует artifacts.

## PATCH 4 — посчитать `webinarCount` и пробросить `isStaff`

**Файл:** `src/components/admin/contact/ContactArtifactsTab.tsx`

- Добавить лёгкий `useQuery` для count'а вебинаров с активностью (`select count` из comments+questions where user_id, distinct live_event_id) — выполняется только при `enabled && isStaff`. Используется только для disabled/число-в-чипе. Если lazy слишком тяжело — сделать прозрачное число «—» до первого открытия chip.
- Принять prop `isStaff: boolean`.

**Файл:** `src/components/admin/ContactDetailSheet.tsx`

- В `<ContactArtifactsTab ... />` (строка 3576) передать `isStaff={isStaffRole(authRole)}`.

## PATCH 5 — verify

1. Открыть карточку контакта Сергея Федорчука → таб «Анкеты» → видны 4 chip'а: «Все / Анкеты / Обучение / Вебинары (N)» в одном ритме.
2. Клик «Вебинары» → визуально идентично соседним подвкладкам: те же бордеры, отступы, типографика, collapse-стрелки.
3. Раскрытие вебинара → timeline комментариев и вопросов с timestamps.
4. Залогиниться как обычный пользователь → chip «Вебинары» отсутствует.
5. Подтвердить, что верхней вкладки «Вебинары» больше нет в `TabsList`.
6. SoT-check: количество в chip == count в БД.

## Файлы

**Изменены:**

- `src/components/admin/ContactDetailSheet.tsx` — удаление верхнего таба, проброс `isStaff`.
- `src/components/admin/contact/ContactArtifactsTab.tsx` — четвёртый chip-фильтр, ветка рендера webinars.
- `src/components/admin/contact/ContactWebinarsTab.tsx` — переписать UI под artifacts-канон (Card+Collapsible вместо Accordion+самодельный Card).

**НЕ трогаем:** БД, RLS, edge functions, запросы (SoT остаётся `live_event_comments` + `live_event_questions`), `WebinarActivitySection` (краткое превью в «События»).

## DoD

- Верхней вкладки «Вебинары» в карточке контакта **нет**.
- Внутри вкладки «Анкеты» появилась подвкладка «Вебинары» как chip-фильтр в одном ряду с «Все / Анкеты / Обучение».
- Визуально неотличима от соседних подвкладок (одни и те же Card/Collapsible/типографика/бордеры).
- Данные комментариев и вопросов реально читаются и показываются.
- Самодельный «белый» блок Accordion удалён.
- Chip «Вебинары» виден только staff.