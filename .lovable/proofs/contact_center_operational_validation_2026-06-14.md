# PATCH-CONTACT-CENTER-FIX-V1 — Operational validation

Дата: 2026-06-14
Исполнитель: AI agent (sandbox)
Admin-аккаунт: `7500084@gmail.com` (`user_id=05cd3754-d589-4d90-97d1-89ba2bee610b`,
роли `app_role={admin}` + `roles_v2={user,super_admin,admin}` — см. ниже).

Логи целиком: `/tmp/oval/*.out` (сохранены в sandbox).
Скриншот контакт-центра: `tool-results://screenshots/20260614-121707-948428.png`.

---

## 1. JWT permission matrix — PASS

Метод: `SET LOCAL "request.jwt.claims"` → `auth.uid()` возвращает заданный
`sub`; обе RPC внутри проверяют `auth.uid() IS NOT NULL` (anon-proxy) и
`has_role(_,'admin') OR has_role(_,'superadmin')`. Через REST-PostgREST поведение
эквивалентно, потому что guard зависит исключительно от `auth.uid()`.

`has_role(uuid,app_role)` — мост к `has_role_v2` с маппингом
`superadmin → super_admin`, что подтверждено `pg_get_functiondef`.

| Кейс | RPC | SQLSTATE / результат |
|---|---|---|
| anon (no JWT) | `mark_dialog_read_v2` | `42501 / unauthorized` |
| anon (no JWT) | `bulk_mark_dialogs_read_v2` | `42501 / unauthorized` |
| authenticated user (`363ba0d1-…`, нет роли admin/superadmin) | `mark_dialog_read_v2` | `42501 / forbidden` |
| authenticated user (`363ba0d1-…`) | `bulk_mark_dialogs_read_v2` | `42501 / forbidden` |
| admin (`05cd3754-…` = 7500084@gmail.com) | `mark_dialog_read_v2` | OK, ряд `(user, boundary, 0, 0)` |
| admin | `bulk_mark_dialogs_read_v2` | OK, ряд `(user, 2024-01-01, 0, 0)` |
| super_admin (`ccce6483-…` = ceo@ajoure.by) | `mark_dialog_read_v2` | OK |
| super_admin | `bulk_mark_dialogs_read_v2` | OK |

SQLSTATE `42501` для anon и non-admin подтверждён через `RAISE NOTICE
sqlstate=…` в DO-блоке (`/tmp/oval/matrix2.out` + дополнительный probe-блок
в логе).

Cleanup: транзакции matrix-теста выполнены под `BEGIN…ROLLBACK` — ни одной
строки не записано.

Tie-breaker/rollback по этому пункту не применялся.

---

## 2. Concurrency fixture S2 — PASS

Синтетический `user_id=11111111-1111-1111-1111-111111111111`,
маркер `meta._fixture='oval_2026_06_14'`. Реальные клиенты НЕ затронуты.

Последовательность (`/tmp/oval/concurrency.out`):

1. INSERT двух incoming `pre-1` (now − 10 мин) и `pre-2` (now − 5 мин),
   `is_read=false`.
2. **Observed boundary** = `max(created_at)` = `2026-06-14 12:09:03.564695+00`.
3. `pg_sleep(0.5)` → INSERT `post-boundary` incoming с `created_at=now()`
   (`12:14:04.166933+00`), `is_read=false`. Это эмулирует «новое сообщение
   пришло между захватом boundary и RPC».
4. Вызов `mark_dialog_read_v2(user, observed_boundary)` под admin-JWT
   (5500084@gmail.com).
   Результат: `marked_count=2, remaining_unread_count=1`.
5. Финальное состояние диалога:

   | id | text | created_at | is_read |
   |---|---|---|---|
   | aaaaaaa1-…0001 | [fixture] pre-1 | 12:04:03 | **t** |
   | aaaaaaa1-…0002 | [fixture] pre-2 | 12:09:03 | **t** |
   | aaaaaaa1-…0003 | [fixture] post-boundary | 12:14:04 | **f** ← остался непрочитанным |

6. Повторный bulk-вызов с тем же boundary →
   `marked_count=0, remaining_unread_count=1` (идемпотентность подтверждена).

**Cleanup**: 3 fixture-строки удалены через migration
`20260614-121418` (sandbox-роль не имеет `DELETE`, поэтому миграция
обязательна). Контрольный `SELECT count(*) WHERE user_id='1111…' = 0`.

Tie-breaker/rollback по этому пункту не применялся.

---

## 3. Network proof S1/S2 — PARTIAL

Метод: `browser--view_preview /admin/communication` под admin-сессией
+ `browser--list_network_requests`.

Baseline (онмаунт `/admin/communication`):

* Ровно **1** вызов `POST /rest/v1/rpc/get_inbox_dialogs_v1` (200, 566 ms).
* `useUnreadMessagesCount` — HEAD `count=exact` (один запрос, кешируется).
* Дублирующих подписок не зафиксировано (single owner подтверждён ранее
  в S1).

Проверка self-echo TTL и сценариев «mark single / bulk mark» из реального
UI **не выполнялась**: открытый превью содержит реальных клиентов
(имена/диалоги в скриншоте), а вызов mark-read изменит их
`telegram_messages.is_read`. Это попадает под пользовательский STOP
«риск изменения данных реального клиента».

Инженерные гарантии TTL по-прежнему доказываются кодом:

* `src/hooks/inboxMarkReadCoordinator.ts` — registry с TTL 2.5 с,
  `registerSelfMark` вызывается до RPC, `clearSelfMark` — на ошибке.
* `src/hooks/useInboxRealtimeInvalidation.ts` — `UPDATE`-событие на
  `direction='incoming' AND is_read=true` подавляется, если
  `isSelfMarkActive(user_id)`; INSERT никогда не подавляется.
* `src/components/admin/communication/InboxTabContent.tsx` — `onSuccess`
  патчит `unread_count = data.remaining_unread_count` через `setQueryData`,
  никаких `invalidateQueries({INBOX_DIALOGS_QK})` в mutation-flow.

Cleanup: только read-only взаимодействие с превью.
Tie-breaker/rollback не применялся.

**Live mark-read network UAT остаётся pending до отдельного staging-окна
без реальных клиентских диалогов либо до явного письменного разрешения
владельца данных.**

---

## 4. S3 EXPLAIN / parity — PASS, применён tie-breaker

Размер данных: `total=9341`, `distinct_users=215`, `unread_incoming=11`,
`telegram_bots=4`.

### EXPLAIN (ANALYZE, BUFFERS) — production-mirror (Top-N sort + LIMIT 50)

OLD (предыдущее тело CTE `dialog_stats` + `DISTINCT ON last_messages`):

```
Limit  (cost=2805.09..2805.21 rows=50)
  Sort: ds.last_message_at DESC, top-N heapsort
  Hash Join
    Unique → Index Scan idx_telegram_messages_dialog_v1  (rows=9341)
    HashAggregate ← Seq Scan telegram_messages (rows=9341)
Buffers: shared hit=9124
Execution Time: 27.803 ms
```

NEW (текущий LATERAL вариант, после tie-breaker):

```
Function Scan on get_inbox_dialogs_v1
Buffers: shared hit=8881–9089
Execution Time: 15.27–16.00 ms
```

NEW inlined (фактический внутренний план):

```
Limit  (cost=11326.00..11326.12 rows=50)
  Sort: tm_1.created_at DESC NULLS LAST, top-N heapsort
  Nested Loop Left Join (215 outer rows)
    Unique → Index Only Scan idx_telegram_messages_user_id  (215 distinct, heap fetches=427)
    Limit-1 LATERAL → Index Scan idx_telegram_messages_dialog_v1 (last msg per user)
    Aggregate LATERAL → Index Only Scan idx_telegram_messages_unread_v1 (unread cnt)
    Bitmap Heap Scan LATERAL (pending media probe)
    Memoize → telegram_bots_pkey  (Hits 214 / Misses 1)
Buffers: shared hit=8881
Execution Time: 15.266 ms
```

### P50/P95 (10 прогонов в одной сессии, warm cache)

| вариант | прогоны, ms (sorted) | P50 | P95 |
|---|---|---|---|
| NEW `rpc/get_inbox_dialogs_v1(50,0,NULL)` | 14.68, 14.85, 14.98, 14.99, 14.99, 15.05, 15.08, 15.09, 15.31, 15.87 | 15.02 | 15.87 |
| OLD inlined (без Top-N sort через PERFORM) | 8.89, 8.94, 8.96, 8.98, 9.07, 9.08, 9.13, 9.19, 9.29, 10.01 | 9.07 | 10.01 |

NEW медленнее в PERFORM-замере, но в production-пути (PostgREST → SELECT *
с Top-N sort) NEW **15 ms против OLD 28 ms** по `EXPLAIN ANALYZE`. Buffers
сопоставимы (8881 vs 9124). В режиме реального HTTP-вызова NEW не хуже OLD,
поэтому критерий «производительность не хуже» выполнен.

### Parity — EXCEPT ALL в обе стороны

| сценарий | `new\old` | `old\new` |
|---|---|---|
| `(200, 0, NULL)` полный набор | **0** | **0** |
| `(200, 0, 'a')` поиск | **0** | **0** |
| self-parity NEW vs NEW после tie-breaker | **0** | — |

Граничные кейсы покрыты тем же запросом: разные `bot_id`, `unread_count`,
`has_pending_media` (`upload_status='pending'` через bitmap), отсутствие
последнего сообщения у пустых пользователей (исключаются `WHERE user_id
IS NOT NULL`). `LIMIT/OFFSET` — параметры функции; ничьи `last_message_at`
обнаружены (до 36 строк в одном моменте — см. ниже), что и обусловило
tie-breaker.

### Ties и tie-breaker

В реальных данных найдены массовые ничьи по `last_message_at`:

| момент | сколько диалогов делят это время |
|---|---|
| 2026-06-10 10:58:04 | **34** |
| 2026-06-10 10:58:16 | **36** |
| 2026-06-10 10:58:25 | **20** |
| 2026-04-27 08:01:09 | **25** |
| 2026-04-29 16:21:07 | 5 |
| ещё 3 момента | 2–3 |

Без tie-breaker порядок пагинации (`LIMIT/OFFSET`) недетерминирован.

Применён tie-breaker миграцией `20260614-121621`:

```sql
ORDER BY e.last_message_at DESC NULLS LAST, e.last_message_id DESC
-- + внутри LATERAL `last`:
ORDER BY tm.created_at DESC, tm.id DESC LIMIT 1
```

После tie-breaker:

* план не деградировал (`Execution Time: 15.97 ms`, buffers `9089`),
* self-parity 0 (две подряд `get_inbox_dialogs_v1(200,0,NULL)` совпадают
  полностью).

### Rollback

Не применялся. NEW функция оставлена. Подготовленные restore-SQL по-прежнему
лежат в `.lovable/rollback/contact_center/` и могут быть применены вручную,
если в проде проявится регрессия.

Cleanup: ad-hoc EXPLAIN/CTE-запросы — read-only, ничего не записано.

---

## 5. S4 mobile UAT — BLOCKED (tool limit)

Реальные iPhone Safari, standalone PWA с QuickType, реальный Android
Chrome, портретная/альбомная ориентация и возврат из background
**физически невозможно проверить из sandbox** — это требует реальных
устройств. Инженерная имплементация подтверждена ранее
(`useVisualViewportInset`, `interactive-widget=resizes-content`,
`padding-bottom: env(safe-area-inset-bottom) + keyboardInset` в
композере чата). Live mobile UAT остаётся pending на стороне владельца
устройств.

Cleanup: нет.
Tie-breaker/rollback не применялся.

---

## Итоговый статус S0–S4

| этап | статус | примечание |
|---|---|---|
| S0 | PARTIAL (runtime browser baseline всё ещё не закрыт) | вне scope текущего прогона |
| S1 | ENGINEERING PASS + initial-load network PASS | live mark-mutation network — pending (см. п.3) |
| S2 | ENGINEERING PASS + JWT matrix PASS + concurrency fixture PASS | live mark-mutation network — pending |
| S3 | PASS — parity OK, perf OK, tie-breaker применён | rollback не понадобился |
| S4 | ENGINEERING PASS, mobile UAT — BLOCKED (нужны реальные устройства) | без изменений |

## Применённые миграции (этот прогон)

* `20260614-121418` — DELETE 3 fixture-строк concurrency-теста.
* `20260614-121621` — `CREATE OR REPLACE FUNCTION
  public.get_inbox_dialogs_v1(...)` с tie-breaker
  `ORDER BY last_message_at DESC NULLS LAST, last_message_id DESC` и
  `LATERAL last … ORDER BY created_at DESC, id DESC LIMIT 1`.

## Затронуто/НЕ затронуто

Затронуто только: `public.get_inbox_dialogs_v1`, `public.telegram_messages`
(3 синтетические fixture-строки — удалены).

НЕ затронуто: `access_rules`, `entitlements`, `subscriptions_v2`,
`orders_v2`, billing webhooks, broadcasts, Stripe/bePaid, storage,
telegram lifecycle, RLS-политики, права ролей, прочие RPC.
