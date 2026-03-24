# да, согласен, с учетом правок:

&nbsp;

1. INV-22 (ложные срабатывания) — уточнить правило RPC, чтобы не “замести” реальные кейсы

&nbsp;

&nbsp;

&nbsp;

- Да, inv22_subscription_desync должен игнорировать корректное состояние status='active' + auto_renew=false (доступ до access_end_at).
- Но делаем фильтр строже и безопаснее, чтобы не потерять реальные десинки:  

  - добавить AND [s.auto](http://s.auto)_renew = true
  - и добавить явный guard по s.access_end_at > now() (или >= now()), чтобы не считать уже истёкшие как “активные” (если статус не успели перевести).
- &nbsp;
- DoD: показать SQL “до/после” — количество строк в RPC уменьшается именно на те записи, где auto_renew=false, и остаются только реальные “сломанные” (если есть).

&nbsp;

&nbsp;

&nbsp;

2. nightly-system-health crash — сделать нормализацию + стоп-гард на неожиданный формат

&nbsp;

&nbsp;

&nbsp;

- В nightly-system-health/index.ts:  

  - если summary отсутствует — собрать summary = { total_checks: passed+failed, passed, failed }
  - если ответ вообще не JSON / ok=false / data пустой — не падать, а записать failed_check с причиной (parse_error / missing_fields).
- &nbsp;
- DoD: один прогон nightly-system-health с реальным ответом nightly-payments-invariants → без падения, в результирующем отчёте/аудите есть корректные totals.

&nbsp;

&nbsp;

&nbsp;

3. Add-only совместимость

&nbsp;

&nbsp;

&nbsp;

- Ничего не удалять/не менять в nightly-payments-invariants, но разрешено добавить (необязательно) поле summary в его ответ позже как backward-compatible улучшение. Сейчас достаточно нормализации в nightly-system-health.

&nbsp;

&nbsp;

&nbsp;

4. Формат сдачи (чтобы не было круга)

&nbsp;

&nbsp;

&nbsp;

- 1 PR/деплой с двумя изменениями + короткий финальный отчёт с 2 пруфами:  

  - SQL: результат обновлённого inv22_subscription_desync (top 10 строк) + count.
  - Лог/аудит: nightly-system-health завершился, total_checks присутствует и число = passed+failed.
- &nbsp;

&nbsp;

&nbsp;

Диагностика здоровья системы: 2 проблемы

## Проблема 1: INV-22 продолжает срабатывать (ложные срабатывания)

**Причина**: RPC `inv22_subscription_desync` проверяет `s.status = 'active'` + `ps.state IN ('expired', 'redirecting')`, но **не учитывает `auto_renew**`. Наш PATCH-1 корректно поставил `auto_renew = false` для 8 подписок, но `status` остался `active` (правильно — доступ до `access_end_at`). RPC не фильтрует по `auto_renew`, поэтому те же 8 подписок снова попадают в отчёт.

**Данные**: все 8 подписок имеют `auto_renew = false`, `status = active` — это корректное состояние ("доступ есть, автопродления нет"). INV-22 должен их игнорировать.

**Исправление**: Обновить RPC `inv22_subscription_desync` — добавить условие `AND s.auto_renew = true`. Подписки с `auto_renew = false` уже "подтверждены как терминальные" и не являются десинхронизацией.

---

## Проблема 2: `nightly-system-health` падает с ошибкой

**Ошибка из логов**: `TypeError: Cannot read properties of undefined (reading 'total_checks')` на строке 318.

**Причина**: `nightly-system-health` вызывает `nightly-payments-invariants` и ожидает ответ с полем `summary: { total_checks, passed, failed }`. Но `nightly-payments-invariants` возвращает `{ ok, passed, failed, invariants, duration_ms }` — без `summary`. Когда `data` не null (а это так — ответ приходит), fallback на строке 318 не срабатывает, и `invariantsResult.summary` = `undefined` → crash на строке 361: `invariantsResult.summary.total_checks += 1`.

**Исправление**: В `nightly-system-health` после получения ответа — нормализовать формат: если `summary` отсутствует, построить его из полей `passed`/`failed`.

---

## Файлы


| Действие  | Файл                                                | Что                                                         |
| --------- | --------------------------------------------------- | ----------------------------------------------------------- |
| Migration | RPC `inv22_subscription_desync`                     | Добавить `AND s.auto_renew = true` в WHERE                  |
| Edit      | `supabase/functions/nightly-system-health/index.ts` | Нормализация ответа от payments-invariants (строки 318-324) |


## Что НЕ меняется

- `nightly-payments-invariants` — логика корректна
- Webhook, backfill — без изменений
- Доступы, entitlements — без изменений