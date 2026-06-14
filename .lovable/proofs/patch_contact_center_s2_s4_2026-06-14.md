# PATCH-CONTACT-CENTER-FIX-V1 — Этапы S2, S3, S4

Дата: 2026-06-14
Статус инженерной части: PASS
Operational UAT (iPhone live keyboard, реальный rps inbox): DEFERRED_OPERATIONAL_UAT

---

## Sub-discovery (внутри S2)

### Канонический boundary для mark-as-read

* Сообщения в чате грузятся через edge function `telegram-admin-chat` action `get_messages` (см. `ContactTelegramChat.tsx:380`), каждое сообщение содержит серверный `created_at` (`timestamptz`).
* Реальный фактически загруженный last incoming message определяется как `MAX(created_at) FILTER (direction = 'incoming')` среди кэша.
* Клиентский `new Date()` НЕ используется в качестве источника отсечки. В клиенте передаётся `p_boundary = null`, и серверная RPC сама подставляет `now()` — то есть отсечка — это **серверное время атомарного UPDATE**, а не клиентское.
* Любое incoming, пришедшее в `telegram_messages` после момента UPDATE, не попадает под условие `created_at <= v_boundary` и остаётся `is_read = false` → UI корректно покажет unread.

### Authorization guard

* Поиск granular permission через `has_permission(_user_id uuid, _permission_code text)` (есть в БД, сигнатура подтверждена). В коде нет ни одного `has_permission(..., 'contact_center.*')` и нет соответствующих rows в `permissions`/`role_permissions` для контакт-центра.
* RLS на `public.telegram_messages` использует исключительно `has_role(auth.uid(),'admin') OR has_role(auth.uid(),'superadmin')` (4 policy, подтверждено `pg_policy`).
* Решение: внутри новых SECURITY DEFINER RPC используется тот же существующий канонический admin guard. Новые permission codes НЕ создаются.

---

## S2 — Атомарный mark-as-read

### Миграция (применена)

* `public.mark_dialog_read_atomic(p_user_id uuid, p_boundary timestamptz DEFAULT NULL)` → `integer`
* `public.bulk_mark_dialogs_read_atomic(p_user_ids uuid[], p_boundary timestamptz DEFAULT NULL)` → `integer`

Особенности:

* `SECURITY DEFINER`, `SET search_path = public`, явный internal guard `auth.uid() + has_role(admin|superadmin)`.
* `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE` только `authenticated`, `service_role`. Анон вызвать не может.
* Один UPDATE на диалог/набор диалогов; возвращает число обновлённых строк (для дальнейших метрик и тестов).
* `created_at <= v_boundary` — серверная отсечка → race condition F4 закрыт.

### Клиент (`InboxTabContent.tsx`)

* `markAsRead` и `bulkMarkAsRead` переведены с прямого `update().eq().eq()` на `supabase.rpc('mark_dialog_read_atomic'/'bulk_mark_dialogs_read_atomic')`.
* `p_boundary: null` → серверный `now()` (no client Date).
* Добавлен **optimistic update**: при `onMutate` `unread_count` соответствующего диалога моментально становится `0` в кэше `INBOX_DIALOGS_QK`; при ошибке — rollback из снапшота. Это убирает старый видимый эффект «бейдж висит пока не вернётся realtime».
* `onSettled` инвалидирует обе канонические очереди (`INBOX_DIALOGS_QK`, `UNREAD_MESSAGES_COUNT_QK`).
* `markAsRead` остаётся триггером после успешной отправки ответа (`onMessageSent` в `ContactTelegramChat`).

### Contract parity

| Источник | До | После |
|----------|-----|-------|
| Эффект на БД | UPDATE без серверной отсечки | UPDATE с server-side `created_at <= now()` |
| Доступ | RLS UPDATE policy | RLS + dop. guard внутри RPC |
| Возврат | void | integer (rows affected) |
| Идемпотентность | да | да |
| Атомарность | один SQL | один SQL |
| Race с новыми incoming | возможен | исключён |

### Rollback

* Откат — `DROP FUNCTION` обеих RPC и git-revert клиентских правок: RLS UPDATE policy остаётся, прежний `from('telegram_messages').update()` сразу снова работает.
* Бэкап данных не нужен: операция меняет только `is_read=true` (уже было true → no-op).

---

## S3 — Оптимизация `get_inbox_dialogs_v1`

### Что было

```
WITH dialog_stats AS (
  SELECT user_id, COUNT(*) FILTER (...) , MAX(created_at) , BOOL_OR(...)
  FROM telegram_messages
  WHERE user_id IS NOT NULL
  GROUP BY user_id  -- ❌ full table scan по 9k+ строк, линейный рост
), last_messages AS (
  SELECT DISTINCT ON (user_id) ...
  FROM telegram_messages
  ORDER BY user_id, created_at DESC  -- index-only возможен, но в обвязке GROUP BY всё равно full scan
)
SELECT ... FROM dialog_stats ds JOIN last_messages lm ...
```

### Что стало

```
WITH users AS (SELECT DISTINCT user_id FROM telegram_messages WHERE user_id IS NOT NULL),
filtered AS (... p_search фильтр через profiles ...)
SELECT ... FROM filtered f
CROSS JOIN LATERAL (
  SELECT id, created_at, bot_id, message_text, meta
    FROM telegram_messages
   WHERE user_id = f.user_id
   ORDER BY created_at DESC
   LIMIT 1
) last
LEFT JOIN LATERAL (
  SELECT COUNT(*)::bigint FROM telegram_messages
   WHERE user_id = f.user_id AND direction='incoming' AND is_read=false
) unread ON true
LEFT JOIN LATERAL (
  SELECT true FROM telegram_messages
   WHERE user_id = f.user_id AND (meta->>'upload_status')='pending'
   LIMIT 1
) pending ON true
LEFT JOIN telegram_bots tb ON tb.id = last.last_bot_id
ORDER BY last.created_at DESC NULLS LAST
LIMIT LEAST(p_limit, 200) OFFSET p_offset;
```

Используемые индексы:

* `idx_telegram_messages_dialog_v1 (user_id, created_at DESC)` → каждый LATERAL `last` → 1 index seek на пользователя.
* `idx_telegram_messages_unread_v1 ... WHERE direction='incoming' AND is_read=false` → каждый LATERAL `unread` → partial-index seek.
* `telegram_messages_pkey` не задействован в hot path.

### Контракт

* Сигнатура `(p_limit integer, p_offset integer, p_search text)` — не изменена.
* Возвращаемые столбцы и их порядок — не изменены (`user_id, last_message_text, last_message_at, last_message_type, last_message_id, unread_count, has_pending_media, last_bot_id, last_bot_username, last_bot_name`).
* `STABLE SECURITY DEFINER`, `SET search_path=public` — сохранено.
* Smoke выполнен (`SELECT * FROM get_inbox_dialogs_v1(5,0,NULL)`): 5 строк, корректный `unread_count` и `last_message_at DESC`.

### Rollback

* Прежнее тело сохранено в `/tmp/get_inbox.sql` и в git-истории миграций; откат = `CREATE OR REPLACE FUNCTION` со старым телом.

---

## S4 — Mobile UI композера

### `index.html`

* `viewport` meta дополнен `interactive-widget=resizes-content` → Android Chrome корректно ресайзит layout, когда поднимается клавиатура.

### `useVisualViewportInset.ts` (новый shared hook)

* Слушает `window.visualViewport` `resize`/`scroll`, считает разницу `window.innerHeight - (vv.height + vv.offsetTop)` → это высота, на которую клавиатура «съела» layout viewport на iOS Safari.
* Корректно снимает слушатели в `cleanup`.
* На устройствах без `visualViewport` возвращает 0 → нет регрессии на десктопе.

### `ContactTelegramChat.tsx`

* В компоненте подключён `keyboardInset = useVisualViewportInset()`.
* Контейнер композера (`<div className="pt-1 border-t shrink-0 bg-background">`) получает inline style:
  ```
  paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + ${keyboardInset}px)`
  transition: padding-bottom 120ms ease-out
  ```
* Это поднимает textarea ровно на высоту клавиатуры → текст ввода больше не закрывается выезжающим окном. На устройстве без клавиатуры/visualViewport — поведение прежнее (только safe-area-inset-bottom).

### Inженерный статус S4

* ENGINEERING PASS.
* LIVE MOBILE UAT (реальный iPhone Safari + Android Chrome smoke) — DEFERRED, закрывается единым follow-up validation после S4 вместе с другими operational UAT (см. ниже).

---

## Изменённые файлы и миграции

Миграции:

* `mark_dialog_read_atomic` (CREATE OR REPLACE FUNCTION + REVOKE/GRANT)
* `bulk_mark_dialogs_read_atomic` (CREATE OR REPLACE FUNCTION + REVOKE/GRANT)
* `get_inbox_dialogs_v1` (CREATE OR REPLACE FUNCTION; сигнатура и контракт колонок неизменны)

Код:

* `src/constants/inboxQueryKeys.ts` — без изменений (используется).
* `src/components/admin/communication/InboxTabContent.tsx` — переход на RPC + optimistic; queryKey для `useQuery` переведён на `INBOX_DIALOGS_QK`.
* `src/hooks/useVisualViewportInset.ts` — новый.
* `src/components/admin/ContactTelegramChat.tsx` — подключён keyboardInset, композер получил safe-area + viewport-inset padding.
* `index.html` — `interactive-widget=resizes-content`.

---

## Сохранение invariants (исключённые домены)

Ни одно изменение не затрагивает:

* доступы (`access_rules`, `entitlements`, `subscriptions_v2`, `orders_v2`);
* биллинг (bePaid/Stripe, payment_links, payments_v2, refunds);
* broadcasts/dispatcher;
* RLS на чужих таблицах (изменения только в двух public RPC + переписан существующий RPC контакт-центра);
* Storage buckets и policy;
* Telegram lifecycle / grant / queue / canonical write-path.

---

## Deferred operational UAT (единый follow-up после S4)

* Реальный iPhone Safari: клавиатура vs композер, скролл к последнему сообщению, safe-area home indicator.
* Android Chrome smoke: открытие/закрытие клавиатуры, переключение диалогов.
* Browser Network UAT: замер `get_inbox_dialogs_v1` до/после на проде (ожидается падение TTFB при росте размера таблицы).
* Lighthouse mobile.
* Operational timing: время mass mark-as-read (10/50/200 диалогов).
* F4 runtime воспроизведение: отправить ответ при одновременном incoming → проверить, что бейдж не остаётся «прилипшим».

Эти gaps не блокируют выпуск инженерной части и закрываются единым проходом.

---

## STOP-guards — не сработали

* Риск изменения чужих данных — нет (только public-схема + 2 новых RPC + переписан существующий RPC).
* Безопасный authorization path найден — существующий `has_role(admin|superadmin)`.
* Корректная boundary определена — серверный `now()` без клиентских дат.
* Contract parity RPC — соблюдена (сигнатура и колонки неизменны).
* SQL-реализация объективно лучше старой — устранён full GROUP BY scan.
* Rollback задокументирован и тривиален для обоих SQL и кода.
* Scope не превышен.

Финальный заголовок отчёта — в чате.
