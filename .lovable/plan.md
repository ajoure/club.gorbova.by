да, согласен, с учетом правок:

## **Обязательные правки перед запуском**

1. **Добавить языковой блок в начало/конец плана:**

```text
План должен быть составлен на русском языке.
Отчет о выполненной работе должен быть составлен на русском языке.
Вся переписка, все пояснения и все результаты должны предоставляться только на русском языке.
```

2. **Не заявлять заранее факты отчёта как уже выполненные.**  
Раздел 6 лучше оформить как **“Требования к отчёту после выполнения”**, а не как готовый отчёт.
3. **Проверить путь** `CrmTasksSection.tsx`**.**  
В плане раньше фигурировал:

```text
src/components/admin/tasks/CrmTasksSection.tsx
```

А сейчас:

```text
src/components/admin/crm/CrmTasksSection.tsx
```

Нужно до старта подтвердить фактический путь и не править два разных компонента случайно.

4. **TG-пометка “нет TG” — только если** `telegram_linked` **реально уже есть в** `useStaffOptions`**.**  
Если поля нет — не расширять backend/API в этом патче. Вынести TG-пометку в follow-up.
5. **Комментарий при** `canceled/done`**: уточнить переходы.**

Добавить:

```text
Комментарий обязателен только при новом переходе в done/canceled.
Если задача уже done/canceled и пользователь просто сохраняет поля, повторно требовать комментарий не нужно.
```

6. **Сохранить статус без изменений.**

Зафиксировать явно:

```text
Кнопка «Сохранить» не передает status и не вызывает update_status. Она сохраняет только редактируемые поля.
```

7. **Не начинать PATCH B/C/D до отдельного approve.**

Добавить:

```text
После PATCH A.1 подрядчик сдаёт отчёт. Следующие патчи — pickers / список / bulk / поиск / статистика — не начинать без отдельного подтверждения.
```

## **Вердикт**

После этих правок **PATCH A.1 можно запускать**. Это безопасный UI-only патч, если действительно не трогать БД/RPC/RLS/edge/cron.

&nbsp;

План: PATCH A.1 — UI-доводка карточки/диалога CRM-задач + закрытие отчёта по PATCH A

Только presentation-слой (UI). Никаких изменений в БД/RPC/RLS/edge/cron, типы и API сохраняются.

## 1. Кнопки в футере редактора — одна строка, компактные, "дорогие"

Файл: `src/components/admin/tasks/EditCrmTaskDialog.tsx`

- Футер: `DialogFooter` → один flex-row, `flex-nowrap items-center gap-2 w-full`. «Отмена» слева, остальные жмутся вправо (`ml-auto`).
- Все CTA — `size="sm"` + `h-8 px-3 text-xs font-medium rounded-lg`, иконки `h-3.5 w-3.5`.
- Порядок справа-налево: `Отменить задачу` → `В работу` → `Сохранить` → `Готово`.
- На узких ширинах (sm:) допускается перенос (`flex-wrap`), но по умолчанию — одна строка.

## 2. Бледные «дорогие» цвета кнопок

Файл: `src/components/admin/tasks/taskUiTheme.ts`
Заменить насыщенные градиенты на pastel-glass:

- `TASK_DIALOG_SAVE_CTA` → `bg-emerald-100/70 text-emerald-800 border border-emerald-200/70 hover:bg-emerald-200/70 backdrop-blur-sm`
- `TASK_DIALOG_DONE_CTA` → `bg-emerald-200/70 text-emerald-900 border border-emerald-300/70 hover:bg-emerald-300/70 backdrop-blur-sm`
- `TASK_DIALOG_CANCEL_CTA` → `bg-rose-100/70 text-rose-800 border border-rose-200/70 hover:bg-rose-200/70 backdrop-blur-sm`
- `TASK_DIALOG_INPROGRESS_CTA` → `bg-amber-100/70 text-amber-800 border border-amber-200/70 hover:bg-amber-200/70 backdrop-blur-sm`
- `shadow-sm` вместо `shadow-md`.

## 3. Фон карточки/диалога — матовое стекло, отделённое от подложки

Файл: `taskUiTheme.ts`

- `TASK_DIALOG_GLASS` → более прозрачный pastel-emerald gradient с заметным `backdrop-blur-2xl`, плотная белая граница, ring, мягкая тень. Пример:
`bg-gradient-to-br from-emerald-50/55 via-white/60 to-teal-50/40 backdrop-blur-2xl border border-white/70 ring-1 ring-emerald-200/40 shadow-[0_20px_60px_-20px_rgba(15,23,42,0.25)] rounded-2xl`
- `TASK_DIALOG_SECTION` → `bg-white/45 backdrop-blur-md border border-white/60` (раньше 0.60 — сливалось).
- Card-glass для канбана (`TASK_CARD_GLASS` и палитра бакетов): снизить непрозрачность фона (0.45→0.35), оставить цветной hover-glow.

Файл: `src/components/admin/tasks/board/TaskKanbanCard.tsx` — никаких структурных изменений, только подхватит обновлённые токены.

## 4. DateTimePicker и связки сделка/контакт

Не трогаем (вне scope этого патча).

## 5. Verify

- `bunx tsgo --noEmit` → PASS.
- Открыть `/admin/tasks`, отредактировать `тест`: убедиться, что кнопки в одну строку, цвета пастельные, фон диалога визуально отделён от подложки канбана.
- Канбан-карточка остаётся читаемой на белой подложке.

## 6. Отчёт о выполненной работе: PATCH A — premium UI/status/TASK-ID для CRM-задач

После применения A.1 отдать пользователю отчёт ровно в требуемом формате:

**TASK-ID скрыт из UI (только UI, БД и типы не трогались):**

- `TaskKanbanCard.tsx` — `public_id` не рендерится.
- `EditCrmTaskDialog.tsx` — `public_id` не выводится, в заголовке только «Редактировать задачу» + статус-чип.
- `CreateCrmTaskDialog.tsx` — заголовок без id.
- `TasksListView.tsx` — колонка с `public_id` удалена.
- `CrmTasksSection.tsx` — `public_id` снят с карточек.
- В БД `crm_tasks.public_id` сохранён; в типе `CrmTask` поле осталось — только не отображается.

**Поведение «Сохранить»:**

- `handleSave` пишет только поля задачи через `crm_tasks.update`, статус не меняет — задача `in_progress` остаётся `in_progress`.

**Обязательный комментарий:**

- Проверка `requiresComment` только при переходе в `done`/`canceled`; обычный Save и переход в `in_progress` не требуют комментария. Ошибка показывается inline под textarea, поле подсвечивается rose.

**TG-пометка «нет TG» у ответственного:**

- В селекте сотрудников используется `StaffOptionRow` (бейдж TG/нет TG).
- Источник TG-статуса — `useStaffOptions` (хук уже существует), флаг `telegram_linked`.
- Под селектом — предупреждение «Уведомление не дойдёт», если у выбранного сотрудника `telegram_linked=false`.

**Файлы изменены в PATCH A + A.1:**

- `src/components/admin/tasks/taskUiTheme.ts`
- `src/components/admin/tasks/board/TaskKanbanCard.tsx`
- `src/components/admin/tasks/EditCrmTaskDialog.tsx`
- `src/components/admin/tasks/CreateCrmTaskDialog.tsx`
- `src/components/admin/tasks/StaffOptionRow.tsx` (создан ранее)
- `src/components/admin/tasks/TasksListView.tsx`
- `src/components/admin/crm/CrmTasksSection.tsx`

**Проверки:**

- `bunx tsgo --noEmit` → PASS.
- БД/RPC/RLS/edge/cron не трогались (только presentation).
- `DateTimePickerField` не изменён и работает.
- Создание/редактирование/переходы статуса задач работают (ручной smoke на `/admin/tasks`).

**Вердикт:** PATCH A + A.1 закрыт. Следующие патчи (pickers / канон-список / bulk / поиск / статистика) — только после приёмки.