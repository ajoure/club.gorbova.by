# да, согласен, с учетом правок:

1. Сначала зафиксируй **PATCH B как отдельный патч без смешивания с PATCH A**. В отчёте явно укажи: PATCH A не трогаем, таблицу не меняем, только preview scheduled mode.
2. В `autoweb-generate-occurrences` сделай **жёсткий early-return для dry_run до любых чтений/записей execute-ветки**. Нужно исключить даже теоретическую запись в `live_event_sessions` при preview.
3. В proof по dry-run добавь не только `count(*) за последнюю минуту = 0`, но и **двойную проверку**:
  &nbsp;
  &nbsp;
  - до preview,
  - после 2–3 повторных preview-вызовов,
  - diff = 0.  
  Это будет доказуемее, чем одиночный count.
4. В fail-safe UI не показывай технический текст `Failed to send a request to the Edge Function`. Пользователю нужен нормальный текст:
  - «Не удалось загрузить превью. Попробуйте ещё раз.»
  - отдельная кнопка **«Повторить»**
  - техническую причину можно оставить только в console / logs, не в основном UI.
5. В save/load proof по `scheduled` обязательно проверь **именно 2 weekday × 2 times**, а не более простой кейс. Это главный regression-risk после фикса `rrules[]`.
6. Для `one_time` в отчёте покажи не только UI reopen, но и **SQL-proof**:
  - `event_type='recorded_webinar'`
  - `autoweb_mode IS NULL`
  - `autoweb_config` не содержит scheduled/jit/on_demand мусора.
7. Для `just_in_time` и `on_demand` в save/load proof проверь, что после reopen **не появляются лишние scheduled-поля** и не остаются старые `rrules[]` от предыдущего режима. Нужна проверка очистки несовместимых полей при смене режима.
8. Для blackout proof возьми дату, которая точно попадает в одно из preview-occurrences, и покажи:
  - preview до blackout,
  - добавление blackout,
  - preview после blackout,
  - нужный слот исчез.  
  Просто “добавили дату” без сравнения недостаточно.
9. Для timezone proof зафиксируй ожидаемое поведение явно:
  - меняется именно **локальное время occurrences в preview**,
  - порядок и количество запусков не ломаются,
  - blackout продолжает работать в новой TZ.
10. В отчёте по PATCH B дай отдельный раздел **«Что не трогалось»** и там явно перечисли:

&nbsp;

- lifecycle,
- delete-flow,
- table-shell,
- live room runtime,
- execute-ветка cron кроме fallback чтения `dry_run` из body.

11. Итоговый `PATCH B REPORT` должен закончиться только одним из двух статусов:

- `PATCH B accepted`
- `PATCH B not accepted`  
Без промежуточных формулировок.

12. После принятия PATCH B сразу приложи **короткий список residual risks**, если они останутся:

- только preview fixed,
- execute-ветка cron не прогонялась runtime,
- room runtime не затрагивался.
- &nbsp;
- План: PATCH B — починка preview ближайших запусков (scheduled mode)

## Root cause

В `src/components/admin/live/AutowebModeEditor.tsx` (строка ~165):

```ts
supabase.functions.invoke("autoweb-generate-occurrences?dry_run=true", { body: ... })
```

`supabase-js` v2 **не парсит query string из имени функции** — он URL-encode-ит всю строку как имя функции. Запрос уходит на `/functions/v1/autoweb-generate-occurrences%3Fdry_run%3Dtrue` → 404 на gateway → клиент получает `FunctionsFetchError: Failed to send a request to the Edge Function`.

Подтверждение: edge logs `autoweb-generate-occurrences` пусты при попытке preview — функция вообще не получает запрос.

Edge function ожидает `dry_run` через `url.searchParams.get('dry_run')`, но клиент его никогда туда не передаст. Если бы запрос даже дошёл — он бы попал в EXECUTE-ветку (требует service-role и пишет в `live_event_sessions`), что **категорически неверно** для preview.

## Решение (минимально-инвазивное)

### 1. Клиент — `src/components/admin/live/AutowebModeEditor.tsx`

Убрать query string из имени функции. Передавать `dry_run` через body:

```ts
const { data, error } = await supabase.functions.invoke("autoweb-generate-occurrences", {
  body: {
    dry_run: true,
    preview_rrules: schedule.rrules,
    preview_config: { timezone: schedule.timezone, blackout_dates: schedule.blackout_dates },
    preview_limit: 5,
  },
});
```

### 2. Сервер — `supabase/functions/autoweb-generate-occurrences/index.ts`

Принимать `dry_run` из body как fallback (URL-вариант оставляем для обратной совместимости с cron):

```ts
const body = await req.json().catch(() => ({}));
const dryRun = url.searchParams.get('dry_run') === 'true' || body?.dry_run === true;
```

**Гарантия read-only:** dry-run ветка возвращает массив occurrences **без единой записи** в `live_event_sessions`. Зафиксировать это явным early-return до любого `supabase.from(...).insert(...)`.

### 3. Fail-safe UI в preview-блоке

В `AutowebModeEditor.tsx` улучшить error-state:

- Текст: «Не удалось загрузить превью. Попробуйте ещё раз.»
- Кнопка **«Повторить»** (Retry) явно рядом с ошибкой.
- Форма остаётся usable: переключение режимов, ввод полей, сохранение не блокируются.
- Ошибка локализована **только внутри preview-блока**, не на всю форму.
- Сценарий восстановления: ошибка → Retry → preview восстанавливается → данные формы (weekdays, times, blackout, timezone) **не потеряны**.

## Файлы


| Файл                                                       | Изменение                                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------------ |
| `src/components/admin/live/AutowebModeEditor.tsx`          | invoke без query string, dry_run в body, fail-safe UI с Retry      |
| `supabase/functions/autoweb-generate-occurrences/index.ts` | accept `dry_run` from body, гарантированный read-only early-return |


## Что не трогаем

- `LiveEventsTable.tsx` и table layout (PATCH A закрыт).
- `src/components/ui/table.tsx` (PATCH A закрыт).
- Бизнес-логика lifecycle / delete / select / cron-вызовы execute-ветки.
- Структуру `autoweb_config`, `autoweb_mode`, RRULE формат.
- Save/load контракт формы (только верифицируем).

## DoD PATCH B

1. Preview scheduled-режима работает без ошибки `Failed to send a request`.
2. **Dry-run read-only proof**: SQL-проверка `SELECT count(*) FROM live_event_sessions WHERE created_at > now() - interval '1 minute'` после нескольких preview-запросов = 0.
3. Multi-times RRULE: ПН/СР × 09:15 + 10:30 → preview показывает ровно 4 occurrences/неделю (без декартова произведения 09:30/10:15).
4. Blackout dates: добавить дату в окне → исключённый occurrence не появляется в preview.
5. Timezone: смена с Europe/Minsk на Europe/London → preview-времена пересчитаны.
6. **Save/load contract** для всех 4 режимов:
  - `scheduled` (multi-weekday + multi-time) → save → reopen → `schedule.rrules[]`, weekdays, times, blackout, timezone восстановлены 1:1.
  - `just_in_time` с офсетами → save → reopen → офсеты на месте.
  - `on_demand` с delay → save → reopen → delay сохранён.
  - `one_time`: UI «Разовый показ» → в БД `event_type='recorded_webinar'`, `autoweb_mode IS NULL` → reopen возвращает «Разовый показ».
7. Legacy `live_stream` и `recorded_webinar` (без autoweb) — save/reopen без регрессий.
8. **Fail-safe end-to-end**: искусственно симулировать ошибку (выключить сеть) → preview-блок показывает понятный текст + кнопку Retry → форма usable → восстановить сеть → Retry → preview восстановлен → введённые данные не потеряны.

## Формат отчёта

`PATCH B REPORT`:

- root cause
- diff-summary (2 файла)
- что не трогалось
- proof: скриншот scheduled с 2 weekdays + 2 times без ошибки + список occurrences
- dry-run read-only SQL proof
- save/load proof по всем 4 режимам + legacy
- fail-safe + recovery proof
- итог: PATCH B accepted / not accepted