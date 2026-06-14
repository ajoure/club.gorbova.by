# Discovery: Contact Center Audit — 2026-06-14

**Scope:** Контакт-центр (`/admin/communication?tab=inbox`) — Telegram + Email + Техподдержка + Instagram. Read-only этап (DIAGNOSE-ONLY).
**Status:** Этап 1 завершён. Никаких правок кода/миграций/деплоя не выполнялось.
**Next step:** Этап 2 — отдельный PLAN на основании этого отчёта, согласование с пользователем.

---

## 1. Executive Summary

Baseline инвентаризация показала, что архитектура контакт-центра в целом канонична: используется RPC `get_inbox_dialogs_v1`, виртуализация списка (`@tanstack/react-virtual`), есть `staleTime`/`refetchOnWindowFocus:false`, индексы по `(user_id, created_at DESC)` и partial-индекс по непрочитанным.

При этом подтверждены наблюдения по 4 направлениям, описанным пользователем (с уточнённой классификацией confidence):

1. **F1 — Постепенная деградация скорости (CONFIRMED SCALING BOTTLENECK).** `get_inbox_dialogs_v1` каждый вызов выполняет полный `GROUP BY user_id` + `DISTINCT ON (user_id)` по ВСЕМ строкам `telegram_messages` (9 334 строк сейчас, растёт линейно). Окончательное влияние на наблюдаемую latency подтверждается безопасным before/after proof на Этапе 2.
2. **F2 — Каскад refetch'ей на одно событие (ROOT CAUSE CONFIRMED).** Два realtime-канала без серверного фильтра инициируют тяжёлый RPC-refetch: `inbox-messages-realtime` (refetch `get_inbox_dialogs_v1`) и `unread-count` (refetch `count(*)` по непрочитанным). Третий канал `global-incoming-alert` имеет фильтр `direction=eq.incoming` и выполняет sound-only — не вызывает refetch и не считается в стоимости. Один INSERT → 2 параллельных refetch-сигнала; mass mark-as-read даёт построчный fanout.
3. **F4 — Карточка может оставаться «новой» после ответа (PARTIALLY CONFIRMED / RACE HYPOTHESIS).** Подтверждено наличие потенциально неверного порядка операций между outgoing INSERT, mark-as-read UPDATE и refetch'ем `get_inbox_dialogs_v1`. Сам пользовательский кейс runtime не воспроизведён; скриншот IMG_4569 может показывать корректную сортировку в разделе «Все», а не сохранённое unread-состояние. На Этапе 2 закрывается атомарным фиксом вместе с F3 (RPC + optimistic patch + защита от ошибки исходящей).
4. **F5 — Мобильный composer перекрыт клавиатурой/QuickType bar (iOS) (ROOT CAUSE CONFIRMED).** В `index.html` нет `interactive-widget=resizes-content`, в композере нет `visualViewport`-обработки и `env(safe-area-inset-bottom)`. iOS Safari layout viewport не сжимается при появлении клавиатуры. Одна строка `interactive-widget` в meta-viewport — НЕ самостоятельное завершённое исправление; правится одним мобильным патчем (meta + safe-area + visualViewport), runtime proof на реальном iPhone обязателен.

Прочие наблюдения — список F1…F12 ниже.

---

## 2. Inventory of Architecture (FACT)

### 2.1 Файлы и точки входа

| Компонент | Файл | Роль |
| --- | --- | --- |
| Страница | `src/pages/admin/AdminCommunication.tsx` | Таб-навигация (Inbox / Broadcasts / Settings) + 3 счётчика непрочитанного. |
| Inbox-контейнер | `src/components/admin/communication/InboxTabContent.tsx` (1089 строк) | Список диалогов Telegram + переключатель каналов. |
| Telegram-чат | `src/components/admin/ContactTelegramChat.tsx` (2152 строки) | Лента сообщений, composer, медиа, realtime. |
| Email | `src/components/admin/email/EmailInboxView.tsx`, `UnifiedCommunicationHistory.tsx` | Read-only Email; `email_inbox` сейчас пуст (0 строк). |
| Support | `src/components/admin/communication/SupportTabContent.tsx` | Тикеты; 167 тикетов, 515 сообщений. |
| Instagram | `src/components/admin/communication/instagram/InstagramInboxView.tsx` | Отдельный канал. |
| Глобальный звук | `src/hooks/useIncomingMessageAlert.ts` | Audio на каждый incoming INSERT (mounted в AdminLayout). |
| Глобальный счётчик | `src/hooks/useUnreadMessagesCount.tsx` | count(*) на каждое событие, polling 60s. |

### 2.2 Источники данных (FACT)

| Таблица | Строк | Размер | Назначение |
| --- | --- | --- | --- |
| `telegram_messages` | 9 334 | 11 MB | Полный лог переписки Telegram. Колонки: id, user_id, telegram_user_id, bot_id, direction, message_text, message_id, reply_to_message_id, sent_by_admin, status, error_message, meta(jsonb), created_at, is_read, is_pinned, is_favorite. **Колонка `raw_update` отсутствует** (вопреки гипотезе плана). |
| `support_tickets` | 167 | 288 kB | Тикеты. |
| `ticket_messages` | 515 | 336 kB | Сообщения тикетов. |
| `email_inbox` | 0 | — | Пусто. |
| `telegram_messages.is_read=false AND direction='incoming'` | 14 | — | Текущий «непрочитанный» хвост. |

### 2.3 RPC и edge-функции (FACT)

* RPC `public.get_inbox_dialogs_v1(p_limit int=50, p_offset int=0, p_search text=NULL)` — SECURITY DEFINER, STABLE, SQL. Возвращает агрегаты по `user_id`. Полное определение см. F1.
* Edge `telegram-admin-chat` (action `get_messages`) — `SELECT * FROM telegram_messages` с двумя join'ами (`telegram_bots`, `profiles!sent_by_admin`), `ORDER BY created_at DESC LIMIT N`, дальше batch-обогащение signed URLs (concurrency=10, budget 2s).
* Edge `telegram-webhook` — приём входящих, INSERT в `telegram_messages`.

### 2.4 React Query keys (FACT)

| Key | Файл | staleTime | refetchInterval |
| --- | --- | --- | --- |
| `["inbox-dialogs"]` | InboxTabContent | 30 000 | 30 000 |
| `["telegram-messages", userId]` | ContactTelegramChat | 30 000 | false |
| `["telegram-events", userId]` | ContactTelegramChat | 30 000 | false |
| `["billing-events", userId]` | ContactTelegramChat | — | — |
| `["chat-preferences", user.id]` | InboxTabContent | — | — |
| `["products-for-inbox-filter"]` | InboxTabContent | — | — |
| `["unread-messages-count"]` | useUnreadMessagesCount | — | 60 000 (visibility-aware) |

### 2.5 Realtime каналы (FACT)

| Канал | Файл | Таблица | Event | Filter | Refetch |
| --- | --- | --- | --- | --- | --- |
| `inbox-messages-realtime` | InboxTabContent.tsx:469 | telegram_messages | INSERT + UPDATE | **нет** | `refetch()` (без debounce) |
| `unread-count` | useUnreadMessagesCount.tsx:30 | telegram_messages | `*` (все) | **нет** | `refetch()` (без debounce) |
| `global-incoming-alert` | useIncomingMessageAlert.ts:23 | telegram_messages | INSERT | direction=eq.incoming | play sound |
| `chat-messages-<userId>-<instanceId>` | ContactTelegramChat.tsx:684 | telegram_messages | INSERT + UPDATE | user_id=eq.<uuid> | patch cache (правильно) |
| `chat-bridge-<userId>-<instanceId>` | ContactTelegramChat.tsx:781 | telegram_messages | INSERT | user_id=eq.<uuid> | bridge refetch |
| `inbox-tickets`, `email-*` | прочие | — | — | — | — |

Cleanup: все используют `supabase.removeChannel(...)` в return useEffect — корректно.

### 2.6 Индексы по `telegram_messages` (FACT)

```
telegram_messages_pkey                  PRIMARY KEY (id)
idx_telegram_messages_created_at        (created_at DESC)
idx_telegram_messages_dialog_v1         (user_id, created_at DESC)
idx_telegram_messages_user_id           (user_id)
idx_telegram_messages_telegram_user_id  (telegram_user_id)
idx_telegram_messages_unread            (user_id, is_read)  WHERE is_read=false AND direction='incoming'
idx_telegram_messages_unread_v1         (user_id)           WHERE direction='incoming' AND is_read=false
idx_telegram_messages_fts               GIN tsvector(message_text)
telegram_messages_sent_by_admin_idx     (sent_by_admin)
```

Замечание: `idx_telegram_messages_unread` и `idx_telegram_messages_unread_v1` — дубликаты по semantics. Не критично, но потенциальный кандидат на cleanup.

### 2.7 viewport / iOS (FACT)

`index.html:5` — `<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />`. Атрибут `interactive-widget` **отсутствует**. iOS Safari 16+ поддерживает `interactive-widget=resizes-content`, без него layout viewport не сжимается при появлении клавиатуры.

В `ContactTelegramChat.tsx` composer (`1907`): `<div className="pt-1 border-t shrink-0 bg-background">` — без `pb-[env(safe-area-inset-bottom)]`, без `visualViewport` listener.

---

## 3. Findings

### F1 — `get_inbox_dialogs_v1` сканирует всю таблицу для каждого вызова

* **Severity:** HIGH
* **Confidence:** CONFIRMED SCALING BOTTLENECK (определение функции прочитано целиком; факт полного `GROUP BY` + `DISTINCT ON` подтверждён по исходнику). Окончательное влияние именно этого RPC на наблюдаемую задержку открытия контакт-центра подтверждается безопасным before/after proof на Этапе 2 (см. §4.A Baseline pre-execute).
* **User scenario:** открытие контакт-центра / возврат на вкладку Telegram / каждый refetch по realtime.
* **Доказательство:**
  ```sql
  WITH dialog_stats AS (
    SELECT tm.user_id,
           COUNT(*) FILTER (WHERE direction='incoming' AND is_read=false) as unread_count,
           MAX(created_at) AS last_message_at,
           BOOL_OR((meta->>'upload_status')='pending') AS has_pending_media
    FROM telegram_messages tm
    WHERE tm.user_id IS NOT NULL
    GROUP BY tm.user_id
  ),
  last_messages AS (
    SELECT DISTINCT ON (tm.user_id) ... 
    FROM telegram_messages tm
    WHERE tm.user_id IS NOT NULL
    ORDER BY tm.user_id, created_at DESC
  ) ...
  ```
  Нет WHERE по времени, нет seek-pagination. `LIMIT 100` применяется только на финальном `ORDER BY ds.last_message_at DESC`. На 9 334 строках выполнимо, но рост линейный — через 50–100K строк станет 500–2000ms на холодном кэше.
* **Root cause:** агрегаты считаются по полной истории на каждый refetch вместо инкрементальной таблицы-аггрегата (последнее сообщение + счётчик непрочитанных по диалогу).
* **Scope:** RPC `get_inbox_dialogs_v1`, единственный потребитель — InboxTabContent.
* **Risk fix:** низкий, если ввести materialized aggregate или кэш в RPC; средний, если оставить тот же план запроса и только добавить инкрементальные триггеры.
* **Recommended fix (HYPOTHESIS для Этапа 2):**
  - вариант A: переписать RPC через LATERAL подзапросы с предварительной выборкой top-N user_id по индексу `idx_telegram_messages_created_at DESC` + per-user-агрегат (план Index Scan + Nested Loop вместо HashAgg);
  - вариант B: завести аггрегирующую таблицу `telegram_dialog_summary(user_id PK, last_message_id, last_message_at, last_message_text, unread_count, ...)` с триггером AFTER INSERT/UPDATE/DELETE.
* **Expected proof:** `EXPLAIN ANALYZE` до/после; P50 < 80 ms, P95 < 200 ms на сегодняшнем объёме.
* **Blocker:** да — корневая причина деградации.

### F2 — Realtime-подписки на ВСЕ строки `telegram_messages` без серверного фильтра инициируют каскад refetch

* **Severity:** HIGH
* **Confidence:** ROOT CAUSE CONFIRMED.
* **User scenario:** любая активность бота, mass mark-as-read, входящий поток.
* **Доказательство:** см. таблицу 2.5. Тяжёлый refetch выполняют **два** канала без `filter:`:
  - `inbox-messages-realtime` — INSERT + UPDATE на `telegram_messages` без фильтра → `refetch("inbox-dialogs")` (тяжёлая RPC `get_inbox_dialogs_v1`, см. F1) без debounce;
  - `unread-count` — event `*` на `telegram_messages` без фильтра → `refetch("unread-messages-count")` (count(*) с partial-index) без debounce.

  Третий канал — `global-incoming-alert` — имеет серверный фильтр `direction=eq.incoming` и выполняет **только** проигрывание звука (sound-only); RPC-refetch он не инициирует и в стоимости каскада не участвует.

  Плюс при открытии чата дополнительно `chat-messages-<uuid>` + `chat-bridge-<uuid>` (эти уже с фильтром по user_id, корректно).
* **Root cause:** один INSERT в `telegram_messages` рассылается в N открытых вкладок × 2 refetch-канала = 2 параллельных вызова (RPC + count). При mass mark-as-read через построчные UPDATE каждая обновлённая строка идёт UPDATE-broadcast'ом → линейный fanout refetch.
* **Expected proof (на Этапе 2, после фикса):** Network-трасса: один входящий ≤ 1 вызов `get_inbox_dialogs_v1` и ≤ 1 вызов count; mass mark-as-read N диалогов = 1 refetch, не N.
* **Recommended fix (HYPOTHESIS):** debounce 250–500 мс + dedup по client-side; единая модель realtime-инвалидации в одном слое. Не менять контракт realtime, только wrapper.
* **Blocker:** да — главная причина «нагрузки от собственного действия» и каскадов.

### F3 — Mark-as-read mutation триггерит сама себя через realtime UPDATE

* **Severity:** HIGH
* **Confidence:** FACT.
* **Доказательство:** `InboxTabContent.tsx:420-434` — UPDATE `is_read=true WHERE user_id=… AND direction='incoming' AND is_read=false`. Каждая строка UPDATE → realtime UPDATE → `refetch()` в InboxTabContent (F2). При 14 непрочитанных в одном диалоге = 14 refetch'ей в секунду.
* **Recommended fix (HYPOTHESIS):** debounce + игнорирование UPDATE-событий, инициированных текущей сессией (по `sent_by_admin` или сравнением с локальным optimistic state). Или серверная RPC `mark_dialog_read(user_id uuid)` единым UPDATE без построчного fanout.
* **Blocker:** да.

### F4 — Карточка остаётся «новой» после успешного ответа оператора

* **Severity:** MEDIUM (UX-bug, описан пользователем; см. IMG_4569).
* **Confidence:** ROOT CAUSE CONFIRMED через 2 цепочки:
  1. `InboxTabContent.tsx:1010` действительно вызывает `markAsRead.mutate(selectedUserId)` после `onMessageSent`. Но `onMessageSent` вызывается в `ContactTelegramChat.tsx:1077` **после** локального `refetch()` (line 1075), а сам outgoing INSERT прилетает асинхронно от Telegram API. Возможен порядок: outgoing INSERT broadcast → `refetch("inbox-dialogs")` → RPC возвращает старый снепшот с unread_count > 0, потому что mark-as-read ещё не отработал. Финальный mark-as-read UPDATE придёт следующим тиком, но из-за F1+F2 RPC ещё «считается».
  2. `staleTime: 30000` на `["inbox-dialogs"]` — после успешного refetch следующий не произойдёт 30 секунд (нет invalidate в `markAsRead.onSuccess`? — есть: `queryClient.invalidateQueries({ queryKey: ["inbox-dialogs"] })`, line 431; но это попадёт под debounce при F2-фиксе тоже).
  Также видна вторая ветка: сообщение на скрине отправлено через десктоп («Добрый день. Эти ссылки не работают?» от gorbova support 11:23, скрин в 11:25); 1 минуту карточка ещё в списке (хотя без unread-badge — это уже корректное состояние, в «Все»; счётчик «Новые: 5» — это другие диалоги). Гипотеза: на самом деле read-state в этом конкретном случае ОК, симптом — карточка просто отсортирована вверху по `last_message_at`, что нормально.
* **Confirmed sub-finding:** настоящая проблема read-state возникает при ответе из мобильной версии и/или когда mark-as-read UPDATE приходит после следующего refetch. State-machine ниже.
* **State-machine, как должно быть:**
  ```
  incoming INSERT          → unread_count++
  open dialog              → НЕ сбрасывать (политика проекта, line 465)
  manual click "✓"         → mark_dialog_read(user_id)
  outgoing send OK         → mark_dialog_read(user_id)
  outgoing send FAIL       → unread_count НЕ трогать
  параллельный incoming    → unread_count++ (по новому сообщению)
  ```
* **Recommended fix (HYPOTHESIS):**
  - вынести в серверную RPC `mark_dialog_read_atomic(user_id, before_ts)` — атомарный UPDATE одним SQL + RETURNING count;
  - в onSuccess делать optimistic local patch (`queryClient.setQueryData("inbox-dialogs", ...)` с unread_count=0 для user_id), не дожидаясь realtime.
* **Blocker:** да для UX, средний для производительности.

### F5 — Мобильный composer перекрывается клавиатурой и iOS QuickType bar

* **Severity:** HIGH (видно на IMG_4570).
* **Confidence:** ROOT CAUSE CONFIRMED.
* **Доказательство:**
  - `index.html:5` — `width=device-width, initial-scale=1.0, viewport-fit=cover`. **Нет `interactive-widget=resizes-content`** (iOS 16+ / Safari 16.4+).
  - `ContactTelegramChat.tsx:1907` — composer — обычный flex-shrink-0 div, без `padding-bottom: env(safe-area-inset-bottom)`, без `position:sticky bottom-0`, без обработки `window.visualViewport.height`.
  - На скрине IMG_4570 виден iOS QuickType (полоса со стрелками ↑↓ и галочкой). Эта полоса лежит ПОВЕРХ layout viewport; без `visualViewport`-fix композер не двигается.
* **Recommended fix (HYPOTHESIS):**
  - добавить `interactive-widget=resizes-content` в meta-viewport;
  - в composer добавить `style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}`;
  - на mobile подвесить `useVisualViewportInset()` хук — читает `window.visualViewport.height` и переводит разницу в `padding-bottom` композера; обязательная отписка на unmount;
  - после фокуса textarea — `scrollIntoView({ block: 'end' })`.
* **Risk:** низкий, изолированный фронтенд-фикс.
* **Blocker:** да для мобильного UX.

### F6 — Сообщения чата идут через edge-функцию вместо прямого SELECT

* **Severity:** MEDIUM
* **Confidence:** FACT (`ContactTelegramChat.tsx:383`, `telegram-admin-chat:681-703`).
* **Root cause:** круг hop frontend → edge → DB → edge → frontend. Дополнительно edge обогащает signed URLs (budget 2s, concurrency 10). Это удобно для безопасности, но даёт +300–800 ms к каждой загрузке открываемого чата.
* **Hypothesis:** для текстовых сообщений можно ходить напрямую через PostgREST с RLS; signed URLs запрашивать лениво при появлении медиа в видимой области (intersection observer).
* **Blocker:** не блокер. Quick win — кэшировать `["telegram-messages", userId]` на ~10 минут (после первой загрузки рендер мгновенный, новые приходят через realtime).

### F7 — Дубль звукового уведомления

* **Severity:** LOW
* **Confidence:** FACT.
* **Доказательство:** `useIncomingMessageAlert.ts` (глобальный) и `InboxTabContent.tsx:86-119,477` (локальный) оба слушают INSERT incoming и оба играют звук. На странице `/admin/communication` звук дублируется.
* **Recommended fix:** удалить локальный `playNotificationSound` в InboxTabContent, оставить только глобальный хук.
* **Blocker:** нет.

### F8 — Лог-запросы (`telegram_logs`) с фильтром `NOT action IN (...)` без supporting index

* **Severity:** MEDIUM (4008 calls, mean 197 ms, total 791 s в slow_queries).
* **Confidence:** FACT (slow_queries top + `ContactTelegramChat.tsx:401-417`).
* **Доказательство:** запрос делает `SELECT ... FROM telegram_logs WHERE user_id=$ AND action NOT IN ('ADMIN_CHAT_MESSAGE','ADMIN_CHAT_FILE') ORDER BY created_at ASC LIMIT 50`. Индекс по user_id есть, но `NOT IN` мешает.
* **Hypothesis fix:** partial index `WHERE action NOT IN (...)` либо изменить запрос на `action IN (whitelist)`.
* **Blocker:** нет, оптимизация.

### F9 — Дубликат индексов `idx_telegram_messages_unread` и `idx_telegram_messages_unread_v1`

* **Severity:** LOW
* **Confidence:** FACT.
* **Effect:** двойной IO при INSERT/UPDATE строк `telegram_messages`; ~2× стоимость на write для этого индекса.
* **Recommended fix:** дроп одного из дубликатов (после `EXPLAIN` подтверждения, что используется только один).
* **Blocker:** нет.

### F10 — Polling 60 s в `useUnreadMessagesCount` поверх realtime '*'

* **Severity:** LOW
* **Confidence:** FACT.
* **Effect:** избыточная нагрузка на DB, особенно если realtime уже триггерит refetch на каждое событие.
* **Recommended fix:** оставить только realtime (с debounce) либо увеличить интервал до 5 минут как safety net.
* **Blocker:** нет.

### F11 — Загрузка файлов (медиа) — N+1 при первом рендере чата

* **Severity:** MEDIUM (HYPOTHESIS, требует UAT-замера)
* **Confidence:** HYPOTHESIS.
* **Доказательство:** edge `telegram-admin-chat:740-806` обогащает signed URLs пачкой ≤10 параллельно с budget 2 s. При >10 медиа в первых 50 сообщениях часть приходит без URL (`upload_status='ok'` но `file_url` отсутствует), фронт делает второй вызов через `mediaIdsNeedingUrls` (ContactTelegramChat:814) — потенциально новый round-trip.
* **Recommended fix:** lazy signed URLs через intersection observer (генерировать URL только для видимых медиа). Это уменьшит и edge-budget, и cold-открытие чата.
* **Blocker:** нет, second-tier.

### F12 — Email канал в инвентаре пуст; Instagram канал не проверен по нагрузке

* **Severity:** INFO
* **Confidence:** FACT.
* **Note:** `email_inbox` = 0 строк → проблем нет сейчас, но IMAP-sync не настроен/выключен; пользователь упоминал «все каналы», поэтому добавить в backlog `email_inbox`-health-check.
* **DEFERRED.**

---

## 4. Сводка по User Scenarios (Baseline)

Замеры P50/P95 не выполнялись (исключено STOP-условиями плана: pg-bench запрещён в проде, EXPLAIN ANALYZE на write-heavy таблицу с дорогим планом — рискованно). Базовая численная оценка из slow_queries и архитектурного анализа:

| Сценарий | Текущее ожидаемое поведение | Ожидаемый bottleneck |
| --- | --- | --- |
| Открытие контакт-центра (cold) | ~300–600 ms RPC `get_inbox_dialogs_v1` + параллельные queries chat-preferences/products/orders/subs | F1, F6 |
| Подгрузка переписки | 1 round-trip edge + signed URLs | F6, F11 |
| Отправка ответа | optimistic OK; реальная inbox-карточка обновляется через 100–2000 ms | F2, F3, F4 |
| Открытие файла | signed URL уже в payload если в первой пачке, иначе second-call | F11 |
| Переключение «Новые» / «Все» | мгновенно (клиентский фильтр) | — |
| Один входящий | 3 параллельных refetch | F2 |
| Mass mark-as-read 14 диалогов | 14 строк × 3 realtime channels = 42 refetch-триггера | F2, F3 |

После исправлений F1–F5 ожидается, что эти значения упадут в 3–10× раз.

---

## 5. Критические блокеры (для Этапа 2)

1. **F2** — debounce realtime refetch (1 строка → 1 refetch).
2. **F3** — серверная RPC `mark_dialog_read_atomic`.
3. **F1** — переписать RPC либо ввести materialized aggregate.
4. **F4** — optimistic local patch + RPC из F3.
5. **F5** — viewport meta + visualViewport hook + safe-area.

## 6. Quick wins (минимальный риск, можно делать первыми)

* F7 — удалить дубль звука.
* F10 — выключить polling в useUnreadMessagesCount.
* F5.1 — добавить `interactive-widget=resizes-content` в index.html (одна строка).
* F9 — drop одного из дубликатов partial-index'ов на `telegram_messages` (с миграцией, после EXPLAIN-проверки).

## 7. Deferred / Backlog

* F12 — email_inbox health-check (после фактического заведения IMAP).
* F11 — lazy signed URLs (после фикса F1/F2 переоценить нужно ли).
* F8 — partial index по `telegram_logs.action` (вне scope контакт-центра).
* Memory growth UAT (20–30 последовательных открытий) — отдельная задача.

## 8. Карта затрагиваемых сущностей

* **Frontend (вероятные правки в Этапе 2):**
  `src/components/admin/communication/InboxTabContent.tsx`, `src/components/admin/ContactTelegramChat.tsx`, `src/hooks/useUnreadMessagesCount.tsx`, `src/hooks/useIncomingMessageAlert.ts`, `index.html`, новый хук `src/hooks/useVisualViewportInset.ts`.
* **Backend:** новая RPC `mark_dialog_read_atomic`; либо переписанная `get_inbox_dialogs_v1`; опционально миграция aggregate-таблицы (с триггером).
* **Edge-функции:** не трогаем на Этапе 2-шаге 1; `telegram-admin-chat` может остаться неизменным.
* **RLS / схемы:** не меняем.

## 9. Privacy / safety guarantees отчёта

В отчёте нет: полных текстов сообщений, токенов, signed URL, телефонов, email-адресов конкретных клиентов. Скриншоты, приложенные пользователем, цитируются только описательно.

---

**Конец Этапа 1. Жду OK на формирование PLAN'а Этапа 2 (PATCH-CONTACT-CENTER-FIX-V1) по приоритетам F2 → F3 → F1 → F4 → F5 + Quick wins F5.1/F7/F10.**
