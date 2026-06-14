# Отчет о выполненной работе: PATCH-CONTACT-CENTER-FIX-V1 — корректирующий проход S2/S3

Дата: 2026-06-14
Тип: corrective patch (без нового discovery)
Ветка изменений: contact center — список диалогов и mark-as-read

---

## Сводка статусов

| Этап | До | После |
|------|----|-------|
| S0 | PARTIAL (документ есть, runtime baseline нет) | PARTIAL — без изменений, deferred operational UAT |
| S1 | ENGINEERING PASS / LIVE UAT PENDING | без изменений |
| S2 | **FAIL** (boundary = now(), integer return, optimistic-zero, двойная invalidation) | **ENGINEERING PASS** (observed boundary, V2-контракт, no optimistic-zero, coordinator-suppression) — LIVE UAT PENDING |
| S3 | PARTIAL (без EXPLAIN/parity proof) | **PARTIAL — без runtime EXPLAIN/parity** (см. ограничение ниже). Rollback готов. |
| S4 | ENGINEERING PARTIAL | ENGINEERING IMPLEMENTED / LIVE MOBILE UAT PENDING — без изменений кода |

Главный блокер устранён: incoming, пришедший после observed snapshot, более не может быть помечен прочитанным.

---

## S2 — Корректирующий проход (FAIL → ENGINEERING PASS)

### V2 RPC контракт

Миграция `20260614111948_*_mark_dialog_read_v2_contract.sql` создаёт две новые функции **без удаления старых** (compatibility layer сохранён):

```sql
mark_dialog_read_v2(p_user_id uuid, p_boundary timestamptz)
  RETURNS TABLE(dialog_user_id, boundary, marked_count, remaining_unread_count)

bulk_mark_dialogs_read_v2(p_items jsonb)
  RETURNS TABLE(dialog_user_id, boundary, marked_count, remaining_unread_count)
```

Серверная валидация:

- `auth.uid() IS NULL` → `42501 unauthorized`.
- `NOT (admin OR superadmin)` → `42501 forbidden`.
- `p_user_id IS NULL` → `22023 user_id_required` (не silent no-op).
- `p_boundary IS NULL` → `22023 boundary_required` (никакого fallback на `now()`).
- `p_boundary > now() + 60s` → `22023 boundary_in_future` (защита от clock skew/спуфинга).
- bulk: `jsonb_typeof <> 'array'` → `items_must_be_array`; пустой массив → пустой результат (legal); `> 500` элементов → `batch_too_large`; любая невалидная позиция → `invalid_item_shape` / `invalid_item_value`; **никакой частичной обработки** при невалидном входе.
- bulk: дубли `user_id` детерминированно дедуплицируются через `DISTINCT ON (user_id) ORDER BY user_id, boundary DESC` (последняя/максимальная boundary побеждает).

В одной транзакции на каждый user_id:

```sql
UPDATE ... WHERE created_at <= boundary -> marked_count
SELECT COUNT(*) WHERE is_read = false   -> remaining_unread_count
```

Любое incoming в окне `(T_boundary, T_RPC]` попадает в remaining → остаётся unread.

### Permission-denied proof (фактический)

Запросы из аналитического runner-окружения (роль без явного `GRANT EXECUTE`):

```
SELECT * FROM bulk_mark_dialogs_read_v2('[]'::jsonb);
-> ERROR: 42501: permission denied for function bulk_mark_dialogs_read_v2

SELECT * FROM get_inbox_dialogs_v1(50, 0, NULL);
-> ERROR: 42501: permission denied for function get_inbox_dialogs_v1
```

Это доказывает, что `REVOKE ALL ... FROM PUBLIC` сработал и вызывать функции могут только явно перечисленные `authenticated` и `service_role`. AuthN/AuthZ внутри тела (проверка `has_role(admin|superadmin)`) проверяется на live UAT с реальным JWT (anon → 42501, authenticated без admin → 42501, admin → ok, superadmin → ok) — отнесено в LIVE UAT PENDING.

### Frontend — observed boundary

`src/components/admin/communication/InboxTabContent.tsx`:

`resolveBoundary(userId)`:
1. `MAX(created_at)` среди `direction='incoming'` из кэша `["telegram-messages", userId]` (точный snapshot, если чат открывался);
2. fallback: `last_message_at` строки `INBOX_DIALOGS_QK` (серверная отметка, не больше реально показанного preview);
3. иначе → ranged toast «Откройте чат и попробуйте снова», RPC **не вызывается**.

`new Date()` / `now()` для boundary не используется нигде в пользовательском flow.

### Frontend — capture BEFORE send

`src/components/admin/ContactTelegramChat.tsx`:

- В `sendMutation.onMutate` ДО фактической отправки фиксируется `pendingBoundaryRef.current = max(created_at)` incoming из снапшота кэша.
- На `onSuccess` это значение передаётся в `onMessageSent(boundary)`.
- На `onError` ref очищается, callback не вызывается.
- Сигнатура `onMessageSent` расширена: `(boundary?: string | null) => void`.

В `InboxTabContent` callback вызывает `markAsRead.mutate({ userId, boundary })`. Если по любой причине `boundary` пришёл null — повторно резолвится через `resolveBoundary`; если и тогда нет — no-op без RPC.

### Frontend — no optimistic-zero + точечный patch

- В `markAsRead.onMutate` больше нет безусловного `unread_count = 0`. UI оставляет текущее значение до ответа сервера.
- В `onSuccess` строка диалога патчится через `setQueriesData` ровно тем, что вернул сервер: `unread_count = result.remaining_unread_count`. Любое incoming, пришедшее в окне `(boundary, RPC]`, попадает в `remaining_unread_count` и UI его НЕ скрывает.
- В `onError` показывается тост (нет «ложного нуля», так как optimistic-zero не выставлялся вовсе → ничего восстанавливать не нужно).
- Вкладка «Новые» использует `unread_count > 0` из того же значения, поэтому при наличии нового incoming диалог в ней не пропадает.

`bulkMarkAsRead` собирает `Array<{user_id, boundary}>` из кэша. Если у любого выбранного диалога нет observed boundary → mutation отклоняется целиком с понятной ошибкой («Нет observed boundary для N диалога(ов)…»); никакого «частичного» bulk.

### Удаление двойной invalidation

`src/hooks/inboxMarkReadCoordinator.ts` — shared module-level registry `Map<userId, expiresAt>`:

- `registerSelfMark(userId, 2500ms)` — вызывается в `mutationFn` ДО `supabase.rpc(...)` (а также для каждого user_id bulk-операции);
- `clearSelfMark(userId)` — вызывается на ошибке RPC, чтобы реальное чужое событие не было проглочено;
- `isSelfMarkActive(userId)` — читается из realtime bus.

`src/hooks/useInboxRealtimeInvalidation.ts`:

```ts
// UPDATE telegram_messages
if (row.direction === "incoming" && row.is_read === true && isSelfMarkActive(row.user_id)) {
  return; // подавляем эхо собственной mutation
}
```

Гарантии:

- INSERT-события (новое incoming/outgoing/чужие) **никогда** не подавляются — счётчик и список обновляются как обычно.
- UPDATE чужого оператора (тот же user_id, но другой клиент) не подавляется: coordinator существует только в памяти этого таба.
- При ошибке RPC регистрация снимается немедленно, эхо-событие, если и придёт, будет нормально обработано.
- Один источник invalidate на наш собственный mark-as-read = mutation (точечный `setQueryData` + один лёгкий `invalidateQueries(UNREAD_MESSAGES_COUNT_QK)` для глобального счётчика). Realtime-эхо в окне TTL не вызывает ни refetch списка, ни refetch счётчика.
- `commit_timestamp` НЕ используется как доказательство ownership — только координатор по user_id + TTL.

### Concurrency proof (контракт)

Сценарий, который проверяет live UAT (admin JWT, тестовый диалог):

```sql
-- T1
SELECT MAX(created_at) FROM telegram_messages
 WHERE user_id = $dialog AND direction = 'incoming'; -- => B

-- T2: симулируем новое incoming
INSERT INTO telegram_messages (..., created_at = now()) ...;

-- T3
SELECT * FROM mark_dialog_read_v2($dialog, B);
-- => marked_count = N, remaining_unread_count >= 1, boundary = B

-- T4: проверка
SELECT COUNT(*) FROM telegram_messages
 WHERE user_id = $dialog AND direction = 'incoming' AND is_read = false;
-- => = remaining_unread_count (новое incoming остаётся unread)
```

Контрактно гарантировано телом RPC: `UPDATE ... WHERE created_at <= p_boundary` физически не затрагивает строки с `created_at > p_boundary`. Тестовые данные **обязательно** создаются на отдельном технологическом диалоге (помеченном `meta.test_fixture = true`) и удаляются после прогона; см. RUN-BOOK ниже.

### Reconciliation safety

Основной flow на mark-as-read:

1. RPC response;
2. `setQueryData INBOX_DIALOGS_QK` ровно по `remaining_unread_count`;
3. одиночный `invalidateQueries UNREAD_MESSAGES_COUNT_QK` (счётчик в сайдбаре).

Дополнительный safety reconciliation не нужен и **запрещён**: трейлинговый debounce 300 мс в `useInboxRealtimeInvalidation` уже коалесцирует все события чужих изменений. На собственную mutation поступит ровно 1 запрос UNREAD_MESSAGES_COUNT_QK и ноль запросов INBOX_DIALOGS_QK (благодаря coordinator-guard).

---

## S3 — Статус: PARTIAL

### Признанное ограничение

Текущее тело `get_inbox_dialogs_v1` (LATERAL-rewrite, миграция `20260614105742`) НЕ устраняет полный обход `telegram_messages`: `WITH users AS (SELECT DISTINCT tm.user_id ...)` всё ещё требует пройти индекс по `user_id`. Корректное описание: устранён двойной агрегирующий проход (`GROUP BY` + `DISTINCT ON`); per-user работа сведена к index-seek по `idx_telegram_messages_dialog_v1` и `idx_telegram_messages_unread_v1`. Формулировка «full scan устранён» **снимается**.

### Что не выполнено в этом проходе

- `EXPLAIN (ANALYZE, BUFFERS)` старого и нового тела — недоступен из аналитического runner-окружения (`permission denied`), требует прямого DB-доступа с правами на shadow-функции.
- P50/P95 за 20 повторов.
- Двусторонний `EXCEPT ALL` diff parity по матрице (`p_search=NULL/''/име/email/нет`, `limit=1/50/200`, разные offset, unread=0 и >0, has_pending media, несколько ботов, equal `created_at`).
- Tie-breaker `ORDER BY created_at DESC, id DESC` в LATERAL last-message — не применён; при двух incoming с идентичным `created_at` выбор non-deterministic. Это материал для следующего sub-патча.

### Решение

S3 остаётся в статусе **PARTIAL**. Rollback подготовлен и хранится **вне `supabase/migrations/`**:

```
.lovable/rollback/contact_center/
  README.md
  restore_get_inbox_dialogs_v1.sql   ← полный SQL из миграции 20260222213936
  drop_v2_rpcs.sql                   ← cleanup V2-функций
```

Применять только вручную в порядке, описанном в `README.md`.

---

## S4 — без изменений кода

### Статус

`ENGINEERING IMPLEMENTED, LIVE MOBILE UAT PENDING`.

### Anti-duplication proof

```
$ rg -n "visualViewport|useVisualViewportInset" src
src/hooks/useVisualViewportInset.ts:1: ...        ← единственная реализация
src/components/admin/ContactTelegramChat.tsx:81: import { useVisualViewportInset } ...
src/components/admin/ContactTelegramChat.tsx:293:  const keyboardInset = useVisualViewportInset();
src/components/live/LiveAutoGrowTextarea.tsx: ...  ← инлайн `window.visualViewport.addEventListener`, отдельная live-фича, не overlap
src/components/admin/TokenizedRichInput.tsx: ...   ← инлайн обращение, не дублирует hook
src/components/shared/StructuredAddressBlock.tsx: ← обращение к API напрямую для другой цели
```

Других реализаций hook'а `useVisualViewportInset` нет. Контакт-центр использует ровно одну канон-точку. LIVE / TokenizedRichInput / StructuredAddressBlock — отдельные UX-сценарии вне scope патча.

LIVE MOBILE UAT (iPhone Safari, standalone PWA, QuickType, landscape, Android Chrome, отсутствие двойного inset, возврат из background) — отнесён в operational UAT, в коде не меняется.

---

## Rollback (порядок)

1. Frontend → откатить файлы:
   - `src/components/admin/communication/InboxTabContent.tsx` (markAsRead/bulkMarkAsRead → старый `mark_dialog_read_atomic`/`bulk_mark_dialogs_read_atomic`, integer-return);
   - `src/components/admin/ContactTelegramChat.tsx` (signature `onMessageSent: () => void`, без capture);
   - `src/hooks/useInboxRealtimeInvalidation.ts` (убрать coordinator-import и guard);
   - `src/hooks/inboxMarkReadCoordinator.ts` — удалить файл.
2. Деплой, дождаться отсутствия вызовов V2 RPC (PostgREST/Edge logs).
3. Применить `.lovable/rollback/contact_center/restore_get_inbox_dialogs_v1.sql` через `supabase--migration` (вручную).
4. Smoke контакт-центра.
5. Применить `.lovable/rollback/contact_center/drop_v2_rpcs.sql`.
6. Старые `mark_dialog_read_atomic` / `bulk_mark_dialogs_read_atomic` оставлены в базе и продолжат работать — удаление только отдельным cleanup-патчем после подтверждённого отсутствия их вызовов.

---

## RUN-BOOK для LIVE UAT (admin JWT)

1. **Permission matrix** (sql, под разными JWT):
   ```
   anon                 -> 42501 unauthorized
   authenticated (user) -> 42501 forbidden
   admin                -> ok (рассчитанная строка)
   superadmin           -> ok
   ```
2. **Concurrency fixture** — на технологическом диалоге c `meta.test_fixture=true`:
   - снять `B = MAX(created_at)` incoming;
   - вставить `incoming` с `created_at = now()`;
   - `SELECT * FROM mark_dialog_read_v2($dialog, B)`;
   - проверить `remaining_unread_count >= 1`;
   - cleanup: `DELETE FROM telegram_messages WHERE meta->>'test_fixture' = 'true' AND created_at >= T0`.
3. **EXPLAIN parity** (S3, deferred):
   - в shadow-схеме создать копию старого и нового тел под временными именами;
   - `EXPLAIN (ANALYZE, BUFFERS)` × 20, P50/P95;
   - `(old EXCEPT ALL new) UNION ALL (new EXCEPT ALL old)` — 0 строк по матрице search/limit/offset/unread/pending/bot/equal-timestamp;
   - если parity = 100% и P95 не хуже → S3 PASS; иначе → применить restore SQL.
4. **Network proof** (browser DevTools):
   - открыть `/admin/communication`;
   - отметить диалог прочитанным;
   - ожидание: 1 запрос `rpc/mark_dialog_read_v2` + 1 запрос `unread-messages-count`; **0** запросов `rpc/get_inbox_dialogs_v1` в окне 1.5 с после mutation.
5. **Mobile UAT (S4)**: iPhone Safari, standalone PWA, QuickType, landscape, Android Chrome, background return → composer не перекрывается.

---

## Файлы и миграции

### Миграции
- `supabase/migrations/20260614111948_…_mark_dialog_read_v2_contract.sql` — V2-функции, GRANT/REVOKE.

### Код
- `src/hooks/inboxMarkReadCoordinator.ts` — новый shared registry.
- `src/hooks/useInboxRealtimeInvalidation.ts` — coordinator-guard в UPDATE-ветке.
- `src/components/admin/communication/InboxTabContent.tsx` — `resolveBoundary`, V2-mutations, no optimistic-zero, точечный setQueryData, capture-aware onMessageSent.
- `src/components/admin/ContactTelegramChat.tsx` — `pendingBoundaryRef`, capture-before-send, расширенный contract `onMessageSent`.

### Rollback (вне migrations)
- `.lovable/rollback/contact_center/README.md`
- `.lovable/rollback/contact_center/restore_get_inbox_dialogs_v1.sql`
- `.lovable/rollback/contact_center/drop_v2_rpcs.sql`

### Не изменялось
- `src/hooks/useVisualViewportInset.ts` — anti-duplication подтверждён.
- `src/constants/inboxQueryKeys.ts` — без изменений.
- `supabase/functions/**` — без изменений.

---

## Отсутствие изменений в исключённых доменах

Grep по критическим путям подтверждает: ни одна правка не затрагивает `access_rules`, `entitlements`, `subscriptions_v2`, `orders_v2`, billing-webhooks (Stripe/bePaid), broadcasts, storage policy, telegram grant/queue/lifecycle, RLS чужих таблиц.

## Definition of Done — checklist

| # | Требование | Статус |
|---|------------|--------|
| 1 | RPC требует `p_boundary`, возвращает structured row | ✅ |
| 2 | bulk: per-dialog jsonb, per-dialog результат, batch ≤ 500, no silent drop | ✅ |
| 3 | Frontend не использует `new Date()` для boundary | ✅ |
| 4 | Нет optimistic unread_count=0 до ответа RPC | ✅ |
| 5 | Mutation НЕ вызывает invalidate INBOX_DIALOGS_QK (точечный setQueryData) | ✅ |
| 6 | Realtime-эхо собственной mutation подавлено shared coordinator | ✅ |
| 7 | Capture observed boundary ДО отправки сообщения | ✅ |
| 8 | Permission-denied proof (fact, runner role) | ✅ |
| 9 | Concurrency proof (контракт RPC, live fixture deferred) | ⏳ runtime UAT |
| 10 | EXPLAIN/parity proof S3 | ⏳ runtime UAT |
| 11 | Durable rollback вне `supabase/migrations/` | ✅ |
| 12 | Rollback процедура: frontend → wait → restore → drop | ✅ |
| 13 | S4 статус ENGINEERING IMPLEMENTED / LIVE MOBILE UAT PENDING | ✅ |
| 14 | Anti-duplication `useVisualViewportInset` | ✅ |
| 15 | Без изменений в исключённых доменах | ✅ |
