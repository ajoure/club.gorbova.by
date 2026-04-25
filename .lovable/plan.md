да, согласен, с учетом правок:

Добавить в Sprint B rev3 следующие обязательные правки:

&nbsp;

1. Multi-channel должен быть проверен на backend/disptacher уровне.

&nbsp;

Проблема:

В composer теперь можно включить Telegram + Email одной рассылкой. Но нужно доказать, что backend реально обработает `channels[]`, а не только legacy-поле `channel`.

&nbsp;

Добавить в Discovery:

- проверить `process-scheduled-broadcasts`;

- проверить, как он читает `broadcast_templates.channel` и `broadcast_templates.channels`;

- проверить, создаёт ли он `broadcast_runs` по каждому каналу;

- проверить, не отправит ли только первый канал из `channels[]`.

&nbsp;

Правило:

- `channels[]` = source of truth;

- legacy `channel` оставить только для обратной совместимости;

- если включены TG+Email, dispatcher должен отправить оба канала;

- не должно быть дублей отправки.

&nbsp;

Если текущий dispatcher не поддерживает `channels[]`, добавить минимальный backend patch:

- iterate по `channels[]`;

- для каждого канала создать отдельный `broadcast_runs` или корректную run-запись с channel;

- сохранить совместимость с legacy `channel`.

&nbsp;

DoD:

- scheduled TG-only отправляется в TG;

- scheduled Email-only отправляется в Email;

- scheduled TG+Email создаёт/обрабатывает оба канала;

- recurring TG+Email тоже корректно рассчитывается и отправляется.

&nbsp;

2. Для `channel = первый из channels[]` добавить комментарий как legacy fallback.

&nbsp;

В INSERT/UPDATE:

- `channels[]` — основной источник истины;

- `channel` — legacy NOT NULL fallback;

- если выбраны TG+Email, `channel` не должен ограничивать отправку только первым каналом.

&nbsp;

3. Audit нельзя писать напрямую в `audit_logs`, пока не проверена RLS/контракт.

&nbsp;

Добавить в Discovery:

- найти существующий способ записи audit_logs в проекте;

- использовать существующий audit helper/RPC/service pattern;

- если прямой INSERT из frontend запрещён RLS — не делать direct insert.

&nbsp;

Audit bulk actions должен быть реализован через существующий канонический механизм платформы.

&nbsp;

DoD:

- bulk enable/disable/unschedule/archive создаёт audit_logs;

- actor_type соответствует существующему формату проекта;

- actor_user_id заполнен;

- meta содержит ids, count, before/after.

&nbsp;

4. `actor_type='admin'` не хардкодить без проверки допустимых значений.

&nbsp;

Добавить:

- проверить фактические значения actor_type в audit_logs;

- использовать существующий стандарт платформы;

- если в проекте используется `user`, `admin`, `system` — применять корректно;

- для системных действий dispatcher оставить `system`;

- для действий из UI использовать текущий admin/user actor pattern.

&nbsp;

5. Миграцию `metadata jsonb` оставить, но сделать безопасно.

&nbsp;

Перед миграцией:

- проверить, нет ли уже `metadata`;

- проверить CHECK constraint по `status`;

- проверить, какие статусы реально используются.

&nbsp;

Миграция:

- `ALTER TABLE broadcast_templates ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}';`

- если есть CHECK по status — расширить аккуратно, добавив `paused` и `archived`;

- не ломать существующие значения `draft`, `scheduled`, `recurring`, `sent`.

&nbsp;

6. Soft-delete должен скрывать archived по умолчанию.

&nbsp;

В таблице «Запланированные»:

- по умолчанию не показывать `archived`;

- добавить опциональный фильтр/checkbox «Показать архив», только если это быстро и не ломает UI;

- dispatcher обязан игнорировать `archived`.

&nbsp;

7. Canonical table должна повторять не только TableHead, но и UX таблицы контактов.

&nbsp;

В Discovery явно выписать из AdminContacts:

- toolbar layout;

- checkbox selection;

- bulk toolbar;

- row actions;

- loading skeleton;

- empty state;

- pagination/limit;

- resize/sort pattern, если используется.

&nbsp;

Таблица «Запланированные» должна быть визуально и логически максимально такой же.

&nbsp;

8. Client limit 100 — допустимо только как временно, но добавить guard.

&nbsp;

Если записей больше 100:

- показать предупреждение/пагинацию;

- не делать bulk action по всей базе, если выбраны только строки текущей страницы;

- header checkbox = выбрать все на текущей странице, не все записи в базе.

&nbsp;

9. Quick-send now для TG+Email должен иметь понятную error-логику.

&nbsp;

Если включены оба канала и пользователь нажимает «Отправить»:

- отправить Telegram и Email последовательно или через Promise.allSettled;

- если один канал упал, второй не должен считаться неотправленным автоматически;

- показать результат по каждому каналу:

  - Telegram: отправлено / ошибка;

  - Email: отправлено / ошибка.

- не переписывать существующие mutations, а обернуть их в общий handler.

&nbsp;

10. Test-send сохранить отдельно.

&nbsp;

Кнопка «Тест себе» должна:

- учитывать включённые toggles TG/Email;

- либо явно тестировать активный канал, если текущая логика так устроена;

- не исчезнуть после добавления режимов scheduled/recurring.

&nbsp;

11. Delivery Ledger оставить строго в Sprint C.

&nbsp;

В этом Sprint не создавать `broadcast_deliveries`.

Но обязательно:

- не удалять физически шаблоны с `broadcast_runs`;

- сохранить ссылочную историю;

- в финальном отчете отдельной строкой указать: `broadcast_deliveries` отсутствует, Sprint C PATCH зафиксирован.

&nbsp;

12. В DoD добавить proof по multi-channel.

&nbsp;

Добавить SQL/runtime proof:

- создана scheduled TG-only;

- создана scheduled Email-only;

- создана scheduled TG+Email;

- создана recurring TG+Email;

- dispatcher/dry-run видит оба канала;

- `broadcast_runs` показывает обработку каналов без дублей.

&nbsp;

13. В DoD добавить proof по отсутствию лишнего UI.

&nbsp;

Кроме `rg` по удалённым компонентам, добавить скрин:

- во вкладке «Запланированные» нет кнопки «Создать запланированную»;

- нет DispatcherStatusPanel;

- нет Production approve;

- нет cron/system audit UI.

&nbsp;

14. В финальном отчете отдельно указать, что создание и редактирование остались только в «Быстрой рассылке».

&nbsp;

Формула:

- «Быстрая рассылка» = создать / отправить сейчас / запланировать / повторять / редактировать.

- «Запланированные» = таблица управления, массовые действия, история запусков.

После этих правок план можно выполнять.

&nbsp;

План: Sprint B rev3 — Unified Composer + Canonical Table

Ключевая формула: **Создание/редактирование — в «Быстрой рассылке». Управление — в «Запланированных».**

Discovery (выполнено):

- Каноничный паттерн таблиц админки = `src/components/admin/table/SortableResizableTableHead.tsx` + `@/components/ui/table` (используется в `AdminContacts.tsx`). Переиспользуем shell.
- `broadcast_templates`: уже есть `send_mode`, `status`, `channels[]`, `next_run_at`, `recurrence_rule`, `audience_filters`, `media_*`, `last_run_at`, `total_runs`. Новых колонок не нужно.
- `broadcast_runs`: агрегатный (audience/sent/failed/skipped). **Per-recipient delivery таблицы нет.** → выносится в отдельный PATCH (Sprint C: delivery ledger).

---

## 1. «Быстрая рассылка» — единый composer Telegram + Email

### 1.1. Убрать «канал = active tab» как source of truth

Текущие табы Telegram/Email в quick-send остаются как UI-навигация (показать/скрыть соответствующий редактор), но **source of truth каналов** — два независимых toggle:

- `telegramEnabled: boolean` (default: true)
- `emailEnabled: boolean` (default: false)

Toggle отображается в шапке каждого подблока:

- «Отправлять в Telegram» (рядом с TG-табом и в TG-карточке).
- «Отправлять Email» (рядом с Email-табом и в Email-карточке).

Итоговый `channels[]` строится из включённых toggle-ов. Если оба выключены — кнопка отправки/планирования `disabled`, инлайн-ошибка «Выберите хотя бы один канал отправки».

### 1.2. Блок «Режим отправки» (новый, над кнопкой действия)

`sendMode: "now" | "scheduled" | "recurring"` (default: `"now"`). Радио-группа из 3 опций.

### 1.3. Режим `"now"` — quick-send, без регрессий

- Если `telegramEnabled` и есть текст/медиа → `sendTelegramMutation`.
- Если `emailEnabled` и есть subject+body → `sendEmailMutation`.
- Если оба → запускаем последовательно обе мутации, сводный toast.
- Кнопка «🧪 Тест себе» (Telegram) — сохраняется 1:1.
- Кнопка действия: **«Отправить»** (одна, вместо текущих «Отправить в Telegram/Email»).

### 1.4. Режим `"scheduled"` — раскрывается:

- Date picker (Shadcn `Calendar` в `Popover`, `pointer-events-auto`).
- Time picker (`<Input type="time">`).
- Кнопка: **«Запланировать»**.
- INSERT в `broadcast_templates`:
  - `name` = автогенерация `"Запланировано {dd.MM.yyyy HH:mm}"` (можно потом переименовать).
  - `channel` = первый из `channels[]` (NOT NULL legacy-поле).
  - `channels` = построенный массив.
  - `message_text/button_text/button_url` — если TG enabled.
  - `email_subject/email_body_html` — если Email enabled.
  - `media_*` — если есть вложение (загрузка в bucket `telegram-media` reused).
  - `audience_filters` = текущий `filters`.
  - `send_mode='scheduled'`, `status='scheduled'`, `next_run_at = ISO(date+time)`.
- Успех: toast «Рассылка запланирована», переключение на под-вкладку «Запланированные», invalidate query.

### 1.5. Режим `"recurring"` — раскрывается:

- `freq` (daily/weekly/monthly), `time`, `byweekday` (multi для weekly), `bymonthday` (для monthly), `ends_at` (опц.).
- Кнопка: **«Создать повторяющуюся рассылку»**.
- INSERT с `send_mode='recurring'`, `status='recurring'`, `recurrence_rule={...}`, `next_run_at` через RPC `compute_next_broadcast_run`. Если RPC error — не сохраняем, показываем ошибку.

### 1.6. Edit-mode (предзаполнение из таблицы)

- URL-параметр `?tab=broadcasts&sub=quick&edit=<id>` либо сигнал через query state.
- При наличии `edit` — загрузить шаблон, гидратировать composer:
  - `telegramEnabled = channels.includes('telegram')`, аналогично email;
  - заполнить тексты/медиа/фильтры;
  - выставить `sendMode` из `send_mode`;
  - заполнить date/time из `next_run_at` или `recurrence_rule`.
- Шапка composer: бейдж **«Редактирование запланированной рассылки»** + кнопка «Отменить редактирование» (сбрасывает edit + чистит форму).
- Кнопка действия: **«Сохранить изменения»** → UPDATE существующей записи (без дубля).

---

## 2. Вкладка «Запланированные» — каноническая таблица

Полностью переписать `ScheduledBroadcastsSection.tsx`:

### 2.1. Убрать

- ❌ `<DispatcherStatusPanel />`
- ❌ Кнопку «Создать запланированную»
- ❌ Открытие `<ScheduledBroadcastWizard />`
- ❌ Tabs scheduled/recurring/sent
- ❌ Карточный layout

### 2.2. Структура

- **Toolbar сверху:**
  - Поиск по `name` (debounce 300ms).
  - Select «Тип»: все / однократные / повторяющиеся.
  - Select «Статус»: все / активные / выключенные / завершённые / ошибка.
  - Select «Канал»: все / Telegram / Email.
- **Bulk action bar** (появляется при `selected.size > 0`): Включить · Выключить · Снять с расписания · Удалить/архивировать. Все деструктивные — через `AlertDialog`.
- **Таблица** через `@/components/ui/table` + `SortableResizableTableHead`:


| Колонка                         | Источник                                              |
| ------------------------------- | ----------------------------------------------------- |
| ☐ (header «select all on page») | local Set                                             |
| Название                        | `name` (clickable → edit в quick)                     |
| Тип                             | `send_mode` → «Однократная» / «Повторяющаяся» (Badge) |
| Каналы                          | `channels[]` → бейджи TG/Email                        |
| Следующая                       | `next_run_at` (formatted)                             |
| Последняя                       | `last_run_at`                                         |
| Статус                          | derive (см. 2.4), Badge с цветом                      |
| Создано                         | `created_at`                                          |
| Действия                        | DropdownMenu                                          |


- **Empty state**: «Запланированных рассылок нет. Создайте новую через «Быстрая рассылка» → «Запланировать»».
- **Loading**: skeleton rows.
- Pagination: на этом этапе клиентский limit 100; если потребуется — добавим server-side в будущем PATCH.

### 2.3. Row actions (dropdown)

- Изменить → `setMainTab('quick')` + `setEditId(id)`.
- Включить / Выключить (см. 2.4).
- Снять с расписания.
- Дублировать (INSERT копия `name + " (копия)"`, `status='draft'`, `send_mode='manual'`, `next_run_at=null`).
- История запусков → `Sheet` со списком `broadcast_runs` (read-only, без admin-only данных).
- Удалить/архивировать (см. 2.5).

### 2.4. Active/Inactive logic

- **Pause** (выключить):
  - `status = 'paused'`
  - сохранить исходный режим в `audience_filters._paused_from = <prev_status>` (или отдельное jsonb-поле; колонки `metadata` нет, но `audience_filters` jsonb доступен — добавить служебный ключ под префиксом `_meta`). Альтернатива — отдельная миграция на `metadata jsonb`. **Решение:** мини-миграция: `ALTER TABLE broadcast_templates ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'`. Это безопасно и явно. Использовать `metadata.paused_from_status`.
  - **НЕ обнулять** `next_run_at` и `recurrence_rule`.
  - Dispatcher в edge-функции уже фильтрует по `status IN ('scheduled','recurring')` — `paused` он не подберёт.
- **Resume** (включить):
  - Восстановить `status` из `metadata.paused_from_status` (fallback: `recurring` если есть `recurrence_rule`, иначе `scheduled`).
  - Если `scheduled` и `next_run_at` в прошлом → toast-ошибка «Дата уже прошла. Откройте «Изменить» и выберите новую».
  - Если `recurring` → пересчитать `next_run_at` через `compute_next_broadcast_run`.
- **Снять с расписания**: `status='draft'`, `send_mode='manual'`, `next_run_at=null` (recurrence_rule очищаем).

### 2.5. Удаление / архивирование (safe)

- Если у шаблона есть `broadcast_runs` → **soft-delete**: `status='archived'`, `metadata.deleted_at`, `metadata.deleted_by`. Dispatcher в `process-scheduled-broadcasts` уже не подберёт `archived`. Шаблон скрывается из таблицы (фильтр `status != 'archived'` по умолчанию, опц. чек «Показать архив»).
- Если runs нет → разрешить hard DELETE.
- Bulk delete делает то же самое per-row с правильным выбором стратегии.
- Перед массовым деструктивом — confirm modal с числом затронутых.

### 2.6. Audit для bulk

Каждое массовое действие → INSERT в `audit_logs`:

```
action: 'broadcast_bulk_enable' | 'broadcast_bulk_disable' | 'broadcast_bulk_unschedule' | 'broadcast_bulk_delete'
actor_type: 'admin'
actor_user_id: auth.uid()
meta: { ids: [...], count: N, before_status: {...}, after_status: '...' }
```

---

## 3. Cleanup

После реализации, dependency check, затем удалить:

- `src/components/admin/communication/scheduled/ScheduledBroadcastWizard.tsx` — удалить.
- `src/components/admin/communication/scheduled/DispatcherStatusPanel.tsx` — удалить.
- `src/components/admin/communication/scheduled/BroadcastDryRunModal.tsx` — переиспользуем как опциональный «Предпросмотр получателей» в quick-composer (кнопка «Предпросмотреть аудиторию»). Если не приживётся — удалим.

---

## 4. Backend

### 4.1. Миграции

1. `ALTER TABLE broadcast_templates ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}';`
2. (Опц.) расширить допустимые `status` чтобы включать `'archived','paused'` — проверить, есть ли CHECK constraint. Если есть — заменить через миграцию, без триггеров на reserved-схемы.
3. Обновить `process-scheduled-broadcasts`: явно `WHERE status IN ('scheduled','recurring') AND next_run_at <= now()`. Проверить — возможно уже так.

### 4.2. Без новых таблиц/RPC/edge-функций.

Используем `broadcast_templates`, `broadcast_runs`, `compute_next_broadcast_run`, `resolve_broadcast_audience`, `process-scheduled-broadcasts`, `telegram-mass-broadcast`, `email-mass-broadcast`, bucket `telegram-media`.

### 4.3. Dispatcher остаётся внутренним

Никакого UI для `enabled`, `production_approved`, cron, system audit.

---

## 5. Backlog (отдельный PATCH, **не в этом Sprint**)

**Sprint C — Delivery Ledger & Statistics.** Discovery подтвердило: per-recipient delivery таблицы нет. Предлагается отдельный PATCH:

- Новая таблица `broadcast_deliveries` (run_id, template_id, user_id, channel, recipient_address, status, provider_message_id, sent_at, delivered_at, opened_at, clicked_at, error, payload_snapshot, metadata).
- INSERT'ы из `telegram-mass-broadcast` / `email-mass-broadcast` / `process-scheduled-broadcasts`.
- View для агрегации статистики.
- UI «История запусков» расширяется per-recipient drill-down.

В **этом** Sprint:

- Гарантируем, что `broadcast_runs` пишутся (уже работает).
- НЕ удаляем шаблоны с историей физически (см. 2.5).
- Архивные шаблоны сохраняют ссылочную целостность с `broadcast_runs.template_id`.

---

## 6. DoD

- 3 под-вкладки: Шаблоны / Быстрая рассылка / Запланированные.
- В «Быстрой рассылке» два независимых toggle каналов (TG / Email).
- Можно отправить только TG, только Email, или оба одной рассылкой.
- Радио «Режим отправки»: now / scheduled / recurring.
- Quick-send (now) работает 1:1 как раньше + «🧪 Тест себе».
- Scheduled и recurring сохраняются в `broadcast_templates`, появляются в таблице.
- Edit открывает «Быструю рассылку» с предзаполнением, обновляет существующую запись.
- Вкладка «Запланированные» — каноническая таблица (shell как у контактов), без формы создания, без wizard, без DispatcherStatusPanel.
- Toolbar: поиск + 3 фильтра (тип/статус/канал).
- Bulk: select-one/many/page-all + enable/disable/unschedule/delete-or-archive с confirm.
- Row actions: Изменить / Включить / Выключить / Снять / Дублировать / История / Удалить.
- Pause не теряет режим и `next_run_at` (хранится в `metadata.paused_from_status`).
- Шаблоны с `broadcast_runs` → soft-delete (`archived`), без runs → hard delete.
- Bulk-actions пишут `audit_logs` с `actor_type='admin'`.
- Удалены `ScheduledBroadcastWizard.tsx` и `DispatcherStatusPanel.tsx` после dependency check; typecheck зелёный.
- Production approval / cron / system audit UI отсутствует.
- Зафиксирован отдельный PATCH Sprint C на per-recipient delivery ledger.

Финальный отчёт на русском с diff-summary и скринами:

1. Composer с toggles TG/Email.
2. Радио режима отправки.
3. Date+time для однократной.
4. Recurrence для повторяющейся.
5. Каноническая таблица «Запланированные».
6. Bulk selection + confirm modal.
7. Edit через «Быструю рассылку» (бейдж + предзаполнение).
8. SQL-proof: созданная scheduled, recurring, paused, restored, archived; audit_logs bulk action; импорты удалённых компонентов отсутствуют (`rg` пустой).