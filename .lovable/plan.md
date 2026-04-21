# да, согласен, с учетом правок:

1. **PATCH A делать максимально узко и с обязательным regression-check не только на** `/admin/live-events`**, но и минимум на 2 донорских экрана общих таблиц.**  
Раз ты нашёл root cause в `src/components/ui/table.tsx`, это глобальный primitive. Значит после отката single-wrapper нужно обязательно показать proof не только на `/admin/live-events`, но ещё минимум на:
  &nbsp;
  &nbsp;
  - одну таблицу из Contacts/Forms,
  - одну таблицу из Payments/другого админ-раздела.  
  Иначе можно починить live-events и тихо сломать другие 60+ мест.
2. **В PATCH A не трогать** `LiveEventsTable.tsx`**, если после отката** `table.tsx` **таблица возвращается в норму.**  
Любые дополнительные правки в `LiveEventsTable.tsx` допустимы только если после отката остаётся доказуемый дефект.  
Сначала rollback primitive, потом повторная проверка. Не смешивать rollback и дополнительные локальные фиксы без необходимости.
3. **В PATCH A отдельно проверить именно канонический контракт:**
  - sticky header,
  - horizontal scroll,
  - vertical scroll,
  - colgroup widths,
  - lifecycle/actions columns,
  - column settings,
  - locked columns,
  - одинаковая ширина lifecycle-кнопок.  
  Это всё должно быть в одном proof-пакете, а не выборочно.
4. **PATCH B — dry-run обязательно оставить read-only.**  
Зафиксируй прямо в плане: preview не должен ничего писать в `live_event_sessions`.  
После фикса отдельно покажи proof, что dry-run не создаёт записей в БД.
5. **В PATCH B добавить явную проверку save/load для** `scheduled` **с несколькими слотами времени.**  
Не только preview, но и:
  - сохранить,
  - переоткрыть,
  - убедиться, что `schedule.rrules[]`, weekdays, times, blackout, timezone восстановились 1:1.
6. **Для** `one_time` **явно проверить legacy-мэппинг.**  
В отчёте показать, что:
  - UI режим = «Разовый показ»,
  - в БД сохраняется `event_type='recorded_webinar'`,
  - `autoweb_mode IS NULL`,
  - reopen корректно возвращает этот режим в UI.  
  Это важно, чтобы не сломать старую модель.
7. **В PATCH B fail-safe UI проверить не только на реальной ошибке, но и на повторном восстановлении.**  
Сценарий:
  - ошибка preview,
  - форма остаётся usable,
  - Retry,
  - preview восстановился,
  - данные формы не потерялись.  
  Это обязательный proof, иначе fail-safe неполный.
8. **Отчёты должны быть строго раздельными и с diff-summary по каждому патчу.**  
В каждом отчёте отдельно:
  - root cause,
  - какие файлы изменены,
  - что именно исправлено,
  - что не трогалось,
  - proof,
  - скриншоты,
  - regression-check.
9. **После PATCH A и PATCH B не переходить дальше в Sprint B/Sprint C, пока оба патча не будут доказуемо закрыты.**  
Сейчас задача — стабилизировать базу: таблицу и форму. Без продолжения новых фич.
10. **Финальный критерий по PATCH A:**  
таблица должна выглядеть **ровно как раньше**, а не “стало лучше”.  
То есть не новая трактовка дизайна, а восстановление канонического состояния.
11. **Финальный критерий по PATCH B:**  
форма автовеба должна быть не просто “без ошибки”, а реально пригодной к работе:
  - preview работает,
  - режимы сохраняются,
  - reopen корректен,
  - legacy не сломан,
  - dry-run read-only доказан.

&nbsp;

Приступай с PATCH A.

&nbsp;

План: PATCH A + PATCH B (раздельно)

Два независимых патча. Сначала полностью PATCH A, потом отдельно PATCH B. Никакого смешивания.

---

## PATCH A — Восстановление table-shell в /admin/live-events

### Root cause (точно)

Файл `src/components/ui/table.tsx` был изменён (commit `a970a3a9`): обёртка вокруг `<table>` стала **двойным div'ом** с `-mx-4 sm:mx-0` (отрицательный margin) и **внутренним `overflow-x-auto px-4**`.

Последствия для `LiveEventsTable`:

1. **Двойной scroll-контейнер.** Внешний `live-events-table-scroll` (с `overflow-x-auto` + `width: max-content`) теперь содержит ещё один `overflow-x-auto` от `ui/table`. Внутренний контейнер обрезает таблицу по своей ширине → горизонтальный scroll не активируется → ширины колонок «съезжают».
2. **Сдвиг на -16px.** `-mx-4` вытаскивает таблицу за границу `rounded-md border bg-card` → визуально таблица «уродская», накладывается на края карточки.
3. **Sticky header ломается.** Sticky опирается на ближайший scroll-ancestor. Двойная вложенность scroll-контейнеров делает sticky неработающим.
4. **Это глобально**: тот же баг во всех 60+ админских таблицах (contacts, forms, payments…), но визуально заметнее всего на live-events из-за `width: max-content` + множества колонок.

### Решение

**Откат `src/components/ui/table.tsx` к каноническому однослойному виду** (как было до `a970a3a9`):

```tsx
<div className="relative w-full overflow-auto">
  <table className="w-full caption-bottom text-sm" ... />
</div>
```

Это минимально-инвазивно: один файл, одна обёртка, никаких хаков ширины. Все админские таблицы возвращаются к каноническому состоянию одним патчем.

`LiveEventsTable.tsx` **не трогаем** — там всё канонически правильно (colgroup + tableLayout:fixed + width:max-content + sticky + DndContext). Бизнес-логику lifecycle/delete/select также не трогаем.

### Файлы

- `src/components/ui/table.tsx` — откат к single-div overflow-auto обёртке.

### DoD PATCH A

- Таблица /admin/live-events визуально восстановлена.
- Заголовки не налезают, ширины колонок ровные.
- Lifecycle и actions колонки видны корректно.
- Горизонтальный scroll работает (виден при сумме ширин > viewport).
- Sticky header работает при вертикальном scroll.
- Column settings + locked columns (checkbox, actions) не сломаны.
- Proof-pack: screenshot до/после на 1366px и 1102px.
- Regression-check: lifecycle proof из прошлых спринтов (open room / start live / complete / single delete / bulk delete) — переиграть.
- Никаких других файлов не тронуто. Никаких хаков ширины не добавлено.

---

## PATCH B — Починка preview формы автовебинара (scheduled mode)

### Root cause (точно)

В `src/components/admin/live/AutowebModeEditor.tsx:165`:

```ts
supabase.functions.invoke("autoweb-generate-occurrences?dry_run=true", { body: ... })
```

`supabase-js` v2 **не парсит query string из имени функции** — он URL-encodes всю строку как имя: запрос уходит на `/functions/v1/autoweb-generate-occurrences%3Fdry_run%3Dtrue` → 404 на gateway → клиент получает `FunctionsFetchError: Failed to send a request to the Edge Function`. Подтверждение: edge logs `autoweb-generate-occurrences` пусты — функция запросов не получает.

Edge function ожидает `dry_run` через `url.searchParams.get('dry_run')`, но клиент его никогда не передаёт. Если бы запрос доходил, он бы упал в EXECUTE-ветку (требующую service-role и записи в БД), что тоже неверно для preview.

### Решение

**Два минимальных фикса** (клиент + сервер) + fail-safe UI:

1. **Клиент** (`AutowebModeEditor.tsx`): убрать query string из имени функции. Передавать `dry_run` через body:
  ```ts
   supabase.functions.invoke("autoweb-generate-occurrences", {
     body: { dry_run: true, preview_rrules, preview_config, preview_limit }
   })
  ```
2. **Сервер** (`autoweb-generate-occurrences/index.ts`): принимать `dry_run` из body как fallback:
  ```ts
   const dryRun = url.searchParams.get('dry_run') === 'true' || body?.dry_run === true;
  ```
   (URL-вариант оставляем для обратной совместимости с cron, который может звать через прямой fetch.)
3. **Fail-safe UI** в preview-блоке:
  - Чёткое error-state сообщение (уже есть `previewError` + AlertCircle) → улучшить текст: «Не удалось загрузить превью. Попробуйте ещё раз.»
  - Кнопка **Retry** рядом с error (явная, не только «Обновить»).
  - При ошибке форма остаётся usable: переключение режимов, сохранение полей не блокируются.
  - Никакого красного шума — ошибка только внутри preview-блока, не на всю форму.
4. **Save/load contract verify** (без правок кода, только проверка):
  - scheduled с 2 weekdays + 2 times → save → reopen edit → значения те же → preview совпадает.
  - just_in_time с офсетами → save → reopen → офсеты на месте.
  - on_demand с delay → save → reopen → delay сохранён.
  - one_time → save как `recorded_webinar` (без `autoweb_mode`) → reopen → форма показывает «Разовый показ».
  - legacy live_stream / recorded_webinar (без режима автовеба) → save/reopen без ошибок.

### Файлы

- `src/components/admin/live/AutowebModeEditor.tsx` — fix invoke + fail-safe UI с Retry-кнопкой.
- `supabase/functions/autoweb-generate-occurrences/index.ts` — accept `dry_run` from body as fallback.

### DoD PATCH B

- Preview scheduled-режима работает без ошибки `Failed to send a request`.
- Multi-times RRULE: проверка с 2 weekdays + 2 times (например, ПН/СР × 09:15 + 10:30) → preview показывает ровно 4 occurrences в неделю (без декартова 09:30 / 10:15).
- Blackout dates: добавить дату в окне → исключённый occurrence не появляется.
- Timezone: сменить TZ с Europe/Minsk на Europe/London → preview-времена пересчитаны.
- Save → reopen edit dialog → все поля autoweb на месте (4 режима × все вариации).
- Legacy live_stream и recorded_webinar (one_time) сохраняются и открываются без регрессий.
- Fail-safe: при искусственной ошибке (выключенная сеть) preview-блок показывает понятный текст + Retry; форма остаётся usable.
- Proof-pack: screenshot scheduled с 2 weekdays + 2 times без ошибки + список occurrences.

---

## Порядок выполнения и формат отчёта

1. **Сначала PATCH A полностью** → отдельный отчёт `PATCH A REPORT` (root cause / файлы / что исправлено / proof / скриншоты 1366px+1102px / что не тронуто).
2. **Потом PATCH B полностью** → отдельный отчёт `PATCH B REPORT` (root cause / файлы / что исправлено / proof / скриншоты).

Никакого смешивания. Никаких «временных» хаков. После PATCH A — переигрываем lifecycle proof. После PATCH B — переигрываем save/load contract.

Подтверди — приступаю с PATCH A.