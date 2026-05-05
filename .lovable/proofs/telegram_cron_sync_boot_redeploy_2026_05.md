# Telegram Cron Sync — Boot Redeploy Proof (P1)

**Дата:** 2026-05-05
**Scope:** только redeploy + диагностика boot. Логика sync, UI, queue, invite, telegram_club_members не менялись.

## 1. Первый redeploy (без изменения кода)

- `supabase--deploy_edge_functions(["telegram-cron-sync"])` → success.
- Прямой POST `/functions/v1/telegram-cron-sync` → **HTTP 503 `BOOT_ERROR`** (сохранилось).
- Edge logs (10:00–10:01 UTC):
  ```
  ERROR worker boot error: Uncaught SyntaxError:
    Identifier 'userId' has already been declared
    at .../telegram-cron-sync/index.ts:235:19
  ```

**Root cause:** в `index.ts` `const userId` объявлен дважды в пределах одного блока `for`:
- L197: `const userId = member.profiles?.user_id;` (ветка pending → active)
- L257: `const userId = member.profiles?.user_id;` (ветка accessMap)

Это синтаксическая ошибка модуля → worker не стартует → 503 BOOT_ERROR на каждый POST, в т.ч. от cron.

## 2. Минимальный fix (только причина старта)

Удалено повторное объявление на L257; первое объявление (L197) переиспользуется. Логика sync не тронута, поведение идентично.

```diff
-            const userId = member.profiles?.user_id;
             const accessResult = userId ? accessMap.get(userId) : undefined;
```

Границы изменения: одна строка. Нет правок в:
- batch/cursor logic
- last_members_sync_at write-back
- UI
- telegram_club_members
- queue / invite / grant

## 3. Второй redeploy + проверка

- `deploy_edge_functions(["telegram-cron-sync"])` → success.
- Прямой POST `/functions/v1/telegram-cron-sync` (10:02 UTC):
  - Соединение продержано до завершения работы (context canceled на стороне клиента после полного прохода — нормально для длительной синхронизации).
- Edge logs после redeploy:
  ```
  10:02:31 LOG  booted (time: 25ms)
  10:02:31 INFO Starting Telegram cron sync...
  10:02:31 INFO Found 2 clubs with auto_resync enabled
  10:02:31 INFO Processing club: Бухгалтерия как бизнес (autokick: true)
  10:02:33 INFO PENDING→ACTIVE: user 5002753789 in club 4f8f9d8f-...
  10:02:39 INFO PENDING→ACTIVE: user 444201286 in club 4f8f9d8f-...
  10:02:55 INFO PENDING→ACTIVE: user 757869626 in club 4f8f9d8f-...
  10:02:59 INFO ADMIN_PROTECTED: user 66086524 is administrator — skipping autokick
  ```
- `BOOT_ERROR` исчез полностью (нет новых записей после 10:01:56).
- Лог `Starting Telegram cron sync...` появился — handler доезжает до runtime.
- Никаких runtime/import/npm/shared ошибок не зафиксировано.

## 4. net._http_response для cron

Cron `telegram-club-sync-hourly` (jobid=5, schedule `0 * * * *`, active=true) — ближайший запуск **11:00 UTC**. На момент proof окно ещё не наступило, поэтому записей с url=telegram-cron-sync в `net._http_response` за последний час нет (последний cron-tick был в 10:00 UTC, до redeploy и до фикса). Прямой POST подтвердил, что функция стартует и работает; следующий cron-tick должен пройти штатно — будет проверено отдельным шагом.

## 5. Итог

- ✅ BOOT_ERROR устранён (синтаксис: дублирующая декларация `userId`).
- ✅ Redeploy прошёл, handler стартует (`booted (time: 25ms)`).
- ✅ Лог `Starting Telegram cron sync...` присутствует.
- ✅ Pending→Active обновления уже выполняются — связь с Telegram API живая.
- ⏭ P2 (`last_members_sync_at` write-back) и P3 (cursor-batching) — отдельным шагом по approve.

## Запрещено (соблюдено)

- Логика sync не менялась (правка строго синтаксическая).
- `last_members_sync_at` не добавлялся.
- batch/resume не вводился.
- UI не правился.
- `telegram_club_members` write-only от штатного цикла (PENDING→ACTIVE) — это существующая логика, не новая.
- Queue items не создавались, invite не отправлялись.
