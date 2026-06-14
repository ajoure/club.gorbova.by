да, согласен, с учетом правок:

Утверждаю общий scope PATCH-CONTACT-CENTER-FIX-V1 при обязательном внесении следующих правок. Принцип add-only/no-loss: перечисленные изменения дополняют S0–S4 и не удаляют ранее заявленные этапы, DoD, proof и rollback.

1. Убрать обязательное ручное подтверждение между каждым S0–S4.

Выполнять PATCH как один основной спринт:

- S0 → S1 → S2 → S3 → S4;
- внутренние STOP-guards сохраняются;
- останавливаться и запрашивать решение только при фактическом blocker, риске данных, провале rollback или выходе за scope;
- некритичные proof gaps заносить в deferred list и не превращать спринт в пять отдельных циклов согласования.

2. Перед созданием `useInboxRealtimeInvalidation.ts` выполнить anti-duplication check:

- найти существующие realtime bus/hooks;
- проверить владельца текущих подписок;
- не создавать второй параллельный realtime-контур, если существующий можно расширить.

3. Определить единственного владельца общей realtime-подписки.

Не монтировать общий хук только внутри `InboxTabContent`, если счётчик непрочитанных используется глобально. Иначе вне вкладки Inbox обновления будут приходить лишь раз в пять минут.

Нужно:

- выбрать один always-mounted owner, вероятнее всего `AdminLayout`, `AdminCommunication` либо существующий глобальный hook;
- гарантировать один channel на вкладку браузера;
- исключить двойной mount при StrictMode;
- доказать cleanup после unmount;
- добавить фактически затронутый owner-файл в список файлов плана.

4. S1 должен быть event-aware, а не инвалидировать обе query на любое событие.

Матрица:

- incoming INSERT → inbox-dialogs + unread-count;
- outgoing INSERT → только inbox-dialogs;
- UPDATE `is_read` → inbox-dialogs + unread-count;
- UPDATE статуса/медиа, влияющего на превью → только inbox-dialogs;
- нерелевантный UPDATE → без invalidate;
- incoming INSERT → один звук только через `useIncomingMessageAlert`.

Нельзя реализовать единый callback, который на любой INSERT/UPDATE всегда инвалидирует обе query.

5. Уточнить DoD S1:

Под «1+1 refetch» понимать:

- не более одного запроса списка диалогов;
- не более одного запроса общего unread count;
- ноль дублирующих запросов каждого типа.

React Query invalidation и фактический HTTP-refetch считать отдельно:

- realtime callbacks;
- invalidate calls;
- реальные Network requests.

6. Debounce должен быть trailing и иметь flush/cleanup-контракт:

- один общий батч в окне 300 мс;
- последнее событие не теряется;
- таймер очищается при unmount;
- при размонтировании определить, нужен ли flush;
- повторный mount не оставляет старый timer/channel;
- query keys использовать через единые constants/factory, если они уже существуют.

7. Polling `unread-count` не удалять полностью.

Оставить safety polling 5 минут, но:

- только при `document.visibilityState === 'visible'`;
- без наложения на уже выполняющийся запрос;
- realtime остаётся основным механизмом.

8. S2: `SECURITY DEFINER + GRANT authenticated` без внутренней авторизации запрещён.

RPC обязана:

- проверять `auth.uid() IS NOT NULL`;
- проверять административное permission, соответствующее контакт-центру; использовать существующий permission code после discovery, не придумывать новый;
- запретить обычному authenticated-пользователю помечать чужие диалоги прочитанными;
- `REVOKE ALL ... FROM PUBLIC, anon`;
- `GRANT EXECUTE` только допустимой роли;
- иметь `SET search_path = public`;
- не принимать actor/user identity из клиента;
- учитывать workspace/tenant isolation, если она присутствует в текущей модели.

RLS policies не меняются, но в proof явно указать, что SECURITY DEFINER является отдельным привилегированным access path.

9. Не использовать `new Date().toISOString()` как boundary без проверки.

Клиентское время подвержено clock skew и может пометить прочитанным сообщение, которое оператор ещё не видел.

Перед реализацией S2 провести короткий sub-discovery и выбрать каноническую границу:

- timestamp последнего фактически загруженного входящего сообщения;
- либо Telegram `message_id`, если доказана его монотонность в нужном контексте;
- либо иной существующий серверный sequence/cursor.

RPC должна читать только сообщения, существовавшие в наблюдаемом оператором snapshot. Новое параллельное incoming не должно стать прочитанным.

10. RPC mark-as-read должна возвращать не только число обновлённых строк.

Предпочтительный контракт:

```text
{
  marked_count,
  remaining_unread_count,
  boundary,
  dialog_user_id
}
```

Это нужно, чтобы UI не показывал ложный `unread_count=0`, если после boundary уже существует новое входящее сообщение.

11. Исправить optimistic flow S2.

Безусловный `onMutate → unread_count=0` небезопасен.

Допустимые варианты:

- optimistic zero только если текущий client snapshot доказывает отсутствие более нового incoming;
- либо мгновенный patch после успешного RPC по возвращённому `remaining_unread_count`.

При ошибке:

- восстановить предыдущий cache snapshot;
- не менять вкладку «Новые»;
- показать понятную ошибку;
- не скрывать новое входящее сообщение.

12. Уточнить утверждение о fanout.

Один SQL `UPDATE` не превращает PostgreSQL Realtime в одно UPDATE-событие: realtime всё равно может отправить событие на каждую изменённую строку.

Цель S2:

- одна RPC-транзакция;
- несколько row events допустимы;
- S1 debounce сводит их максимум к одному запросу списка и одному запросу count.

Не заявлять, что RPC сама устраняет построчный realtime fanout.

13. После отправки сообщения mark-as-read выполнять только после подтверждённого бизнес-успеха.

Недостаточно проверить только HTTP 2xx.

Нужно проверить фактический контракт `telegram-admin-chat`:

- HTTP success;
- `ok/success` в response body;
- сообщение действительно принято Telegram или сохранено с успешным статусом;
- при частичной ошибке, timeout или `200` с error payload `onMessageSent` не вызывается.

Edge-функцию не менять, если существующий контракт достаточен.

14. Согласовать один источник финальной синхронизации после mark-as-read.

Текущая формулировка:

```text
invalidateQueries(..., refetchType:'none')
```

не гарантирует финальную серверную сверку при потере realtime event.

Нужно выбрать и доказать один вариант:

- RPC response → cache patch + один контролируемый refetch;
- либо RPC response → cache patch + realtime invalidate + safety fallback timeout.

Не допускать одновременно:

- mutation invalidate;
- realtime invalidate;
- дополнительный manual refetch,  
если это приводит к двум и более Network calls.

15. Добавить тесты S1/S2:

- debounce нескольких INSERT/UPDATE;
- StrictMode mount/unmount;
- один источник звука;
- permission denied для пользователя без административного права;
- RPC не читает сообщения после boundary;
- параллельный incoming остаётся unread;
- semantic send failure не запускает mark-as-read;
- optimistic rollback;
- repeated mark-as-read идемпотентен.

16. S3 не фиксировать заранее конкретный SQL rewrite как утверждённое решение.

Вариант `top-N user_id по created_at + LATERAL` остаётся кандидатом. Он обязан доказать:

- точную сортировку по последнему сообщению;
- отсутствие потери пользователей из-за повторяющихся сообщений одного активного диалога;
- правильную работу `p_search`;
- правильную работу `p_limit` и `p_offset`;
- идентичный состав и типы колонок;
- идентичные значения unread/media/status;
- отсутствие изменения SECURITY DEFINER/STABLE/GRANT-контракта.

До contract-parity proof новый вариант не выкатывать.

17. Synthetic scale proof S3 выполнять безопасно:

- только в изолированных временных таблицах или отдельном тестовом проекте;
- не создавать ×30 копии в production-таблицах;
- обязательный cleanup;
- `statement_timeout`;
- `lock_timeout`;
- ограниченное число прогонов;
- read-only transaction для текущего RPC;
- запуск вне пикового окна.

Создание временного custom test schema допустимо только как изолированный proof-артефакт с последующим полным удалением; системные schemas не трогать.

18. Для S3 разделить метрики:

- чистое время SQL;
- Supabase/PostgREST/RPC network latency;
- payload size;
- frontend time до первого отображения.

DoD:

- DB execution P50/P95;
- end-to-end RPC P50/P95;
- cold/warm UI отдельно.

Не смешивать P95 SQL `<200 ms` с полным временем пользовательского рендера.

19. Изменение `staleTime 30s → 60s` выполнять только при proof необходимости.

Сначала проверить фактические `staleTime`, `refetchInterval`, focus/reconnect settings. Увеличение staleTime не должно маскировать потерю realtime или ухудшать восстановление после reconnect.

Если точечная realtime invalidation уже решает нагрузку, staleTime можно оставить без изменения.

20. Aggregate-таблица `telegram_dialog_summary` остаётся условным fallback.

Перед её созданием потребуется отдельный уточнённый план внутри S3 с:

- source of truth;
- backfill;
- INSERT/UPDATE/DELETE maintenance;
- idempotency;
- reconciliation;
- rebuild;
- drift detection;
- rollback;
- write amplification;
- RLS/permissions;
- proof отсутствия расхождения.

Без отдельного плана aggregate-таблицу не создавать.

21. S4: не считать `interactive-widget=resizes-content` гарантированным iOS-решением.

Meta-параметр добавить можно, но основным proof остаётся реальное поведение `visualViewport`.

Нужно:

- проверить фактическую поддержку в Safari используемой версии;
- feature detection;
- no-op при отсутствии API;
- слушать `resize` и при необходимости `scroll`;
- удалить listeners при unmount;
- исключить отрицательные и чрезмерные offsets;
- проверить изменение ориентации.

22. Перед переиспользованием `useVisualViewportInset` подтвердить его контракт.

Если существующий hook:

- завязан на lesson-room;
- пишет только `--room-vv-bottom-offset`;
- предполагает конкретный DOM;
- содержит room-specific side effects,

не подключать его «как есть» слепо.

Предпочтение:

- безопасно обобщить существующий canonical hook без регрессии lesson-room;
- либо использовать его публичный return value;
- не создавать второй дублирующий hook.

В список затронутых файлов добавить существующий hook, если он изменяется.

23. Не выполнять безусловный `scrollIntoView` при каждом focus.

Это может выбросить оператора вниз, когда он читает старые сообщения.

Auto-scroll разрешён только если:

- пользователь уже находится возле нижней границы;
- либо открывается новый диалог;
- либо только что успешно отправлено сообщение.

Зафиксировать threshold «near bottom» и proof отсутствия прыжка при просмотре истории.

24. S4 runtime matrix расширить:

- iOS Safari;
- standalone PWA;
- portrait;
- landscape;
- textarea 1 строка;
- textarea несколько строк;
- QuickType включён;
- attachment preview;
- возврат приложения из background;
- Android Chrome;
- desktop.

25. S0 должен использовать строго определённый тестовый диалог:

- указать UUID тестового пользователя;
- подтвердить отсутствие реального клиента;
- не отправлять тестовые сообщения внешнему человеку;
- зафиксировать созданные тестовые строки;
- после proof выполнить безопасный cleanup либо явно оставить их с test metadata.

26. Сохранить исходные Verify/DoD требования через mapping add-only:

```text
Старое: Lighthouse mobile ≥80
→ Новое: остаётся финальным non-regression proof после S4.

Старое: первый рендер 500 диалогов <1.5s
→ Новое: измерить на реальном объёме и синтетической проекции; если UI сейчас ограничен 100, отдельно проверить виртуализированный набор/fixture 500 без изменения production данных.

Старое: карточка уходит из «Новые» ≤2s
→ Новое: целевой optimistic UI <500ms, серверная консистентность ≤2s.

Старое: 0 повторных realtime-refetch при одном сообщении
→ Новое: 0 дубликатов; допускается один intended inbox request и один intended unread-count request.
```

27. Поскольку исходный scope включал Telegram, техподдержку и `UnifiedCommunicationHistory`, в финальный Verify добавить smoke:

- Telegram;
- support tickets;
- `UnifiedCommunicationHistory`;
- email empty-state;
- Instagram tab navigation.

Код этих каналов не менять без finding, но доказать отсутствие регрессии.

28. Симптом медленной загрузки файлов не считать закрытым автоматически.

После S1 и S3 повторно измерить F11:

- время открытия чата с медиа;
- число signed URL calls;
- second round-trip;
- payload.

Если проблема сохраняется, F11 остаётся обязательным follow-up patch, а не считается выполненной частью PATCH-CONTACT-CENTER-FIX-V1.

29. Rollback для SQL оформлять не как `DROP RPC`, а как безопасную restore migration:

- сохранить точное предыдущее определение;
- при rollback восстановить старую функцию;
- не оставлять frontend, вызывающий отсутствующую RPC;
- порядок rollback: frontend compatibility → DB restore.

30. Финальный отчёт должен быть озаглавлен строго:

```text
Отчет о выполненной работе: PATCH-CONTACT-CENTER-FIX-V1
```

В финальном отчёте показать:

- S0–S4: выполнено / частично / не выполнено;
- before/after;
- SQL/RPC contract parity;
- runtime proof;
- rollback readiness;
- deferred list;
- отсутствие изменений в исключённых доменах;
- список всех реально изменённых файлов и миграций.

После внесения этих правок план считается утверждённым. Начинать с S0 и далее выполнять S1–S4 без дополнительных промежуточных согласований, кроме срабатывания критического STOP-guard.

&nbsp;

План: PATCH-CONTACT-CENTER-FIX-V1

Основание: Discovery `.lovable/discovery/contact_center_audit_2026-06-14.md` после корректировок (F1=CONFIRMED SCALING BOTTLENECK, F2=2 канала refetch + sound-only, F3 = до 28 сигналов, F4=PARTIALLY CONFIRMED / RACE HYPOTHESIS, §4.A baseline pre-execute).

Принципы:

- Этап 2 = подготовка + baseline proof + последовательное выполнение S0…S4 микро-патчами.
- Не трогаем: доступы (`grant-access-for-order`, `access_rules`, `entitlements`, `subscriptions_v2`), billing/payments (bePaid, Stripe, `orders_v2`), broadcasts (диспетчер, шаблоны, аудитории), CRM (pipelines, deals), документы, RLS, Storage, schemas `auth/storage/realtime/supabase_functions/vault`, авто-генерируемые файлы Supabase client.
- Все артефакты, планы, proof — на русском.
- Каждый sub-patch S0…S4 проходит цикл: Diagnose → Plan-of-subpatch → Dry run → Execute → Verify (before/after proof по §4.A). Между sub-patch'ами — STOP-guard и подтверждение.

---

S

1. Baseline pre-execute (ОБЯЗАТЕЛЬНО, до любого кода)

Файлы/действия:

- `.lovable/proofs/contact_center_baseline_2026-06-14.md` — снять метрики по §4.A discovery: cold/warm Network trace, число вызовов `get_inbox_dialogs_v1`, payload size, TTFP, открытие одного диалога, один INSERT, mark-as-read 5 непрочитанных в ТЕСТОВОМ диалоге.
- Зафиксировать численные значения «до». Без pgbench, без EXPLAIN ANALYZE в проде, без правок prod-данных вне тестового диалога.
- Воспроизвести F4 runtime: ответить из десктопа и из мобильной версии тестовому пользователю, зафиксировать, остаётся ли карточка в «Новые» после mark-as-read. Если runtime не воспроизводится — F4 остаётся PARTIALLY CONFIRMED и решается превентивно через S2.

DoD S0: proof-файл создан, цифры зафиксированы, F4-runtime либо воспроизведён (приложен лог), либо явно помечен «не воспроизведено».

---

S

1. F2 + F7 + F10 — единая модель realtime-инвалидации

Цель: один INSERT → ≤ 1 refetch RPC + ≤ 1 refetch count; один звук; убрать избыточный polling.

Файлы:

- `src/hooks/useInboxRealtimeInvalidation.ts` (новый) — единая точка подписки на `telegram_messages` (INSERT/UPDATE без фильтра) с debounce 300 мс и dedup. Внутри триггерит `invalidateQueries(["inbox-dialogs"])` и `invalidateQueries(["unread-messages-count"])` одним батчем.
- `src/components/admin/communication/InboxTabContent.tsx` — удалить локальную realtime-подписку `inbox-messages-realtime` и локальный `playNotificationSound`; подключить `useInboxRealtimeInvalidation()`.
- `src/hooks/useUnreadMessagesCount.tsx` — удалить отдельную realtime-подписку `unread-count` (теперь invalidate приходит из общего хука); `refetchInterval` уменьшить до 5 минут (safety net, не основная сигнализация).
- `src/hooks/useIncomingMessageAlert.ts` — без изменений (уже фильтрованный, sound-only — это единственный источник звука).

SQL/RPC: нет.

Branch matrix (realtime → действие):

- INSERT incoming → invalidate inbox-dialogs + unread-count (debounced); звук — из global-alert.
- INSERT outgoing → invalidate inbox-dialogs (debounced); без звука.
- UPDATE is_read → invalidate inbox-dialogs + unread-count (debounced).
- UPDATE other → invalidate inbox-dialogs (debounced).

STOP-guards: если после S1 в DevTools видно > 1 refetch на одиночный INSERT — STOP, разобрать причину перед S2.

Rollback: revert файлов; восстановить старые подписки из git.

DRY RUN: проверить, что хук монтируется один раз (StrictMode), cleanup срабатывает, debounce не теряет события (последний invalidate всегда выполняется).

Before/after proof: повторить §4.A замеры; ожидаемое — 1 INSERT даёт 1+1 refetch, mass mark-as-read 14 — 1+1 refetch вместо 28 callbacks → 2 запроса.

DoD S1: 1 звук, 1+1 refetch на INSERT, polling 5 мин, отчёт `.lovable/proofs/patch_contact_center_s1_<date>.md`.

---

S

2. F3 + F4 — атомарный mark-as-read + защищённый flow «ответ»

Цель: убрать построчный fanout UPDATE; гарантировать, что unread сбрасывается только при успешной отправке; защита от параллельного incoming во время отправки; один финальный refetch.

Файлы:

- Миграция Supabase: создать RPC `public.mark_dialog_read_atomic(p_user_id uuid, p_before_ts timestamptz)` — `SECURITY DEFINER`, `VOLATILE`, единым SQL: `UPDATE telegram_messages SET is_read = true WHERE user_id = p_user_id AND direction = 'incoming' AND is_read = false AND created_at <= p_before_ts RETURNING id`. GRANT EXECUTE на роль `authenticated`. RLS не меняем (RPC SECURITY DEFINER).
  - `p_before_ts` — timestamp boundary: фиксируется в клиенте в момент решения mark-as-read, чтобы параллельный новый incoming (created_at > p_before_ts) НЕ был ошибочно помечен прочитанным.
- `src/components/admin/communication/InboxTabContent.tsx` — заменить построчный UPDATE на вызов RPC. В `markAsRead.mutate`:
  - сохранить `beforeTs = new Date().toISOString()` ДО RPC;
  - вызвать `supabase.rpc('mark_dialog_read_atomic', { p_user_id, p_before_ts: beforeTs })`;
  - `onMutate`: optimistic `setQueryData(["inbox-dialogs"], …)` — unread_count=0 для user_id (НЕ затрагивая остальные карточки);
  - `onError`: откат optimistic patch; unread не сбрасывается;
  - `onSuccess`: один `invalidateQueries(["inbox-dialogs"], { refetchType: 'none' })` чтобы синхронизация прошла через debounced хук из S1, без двойного refetch.
- `src/components/admin/ContactTelegramChat.tsx` — `onMessageSent` вызывается ТОЛЬКО при подтверждении успешной отправки (HTTP 2xx от edge `telegram-admin-chat`). При FAIL — не вызывать.

Branch / state matrix unread:

```
event                            unread_count       inbox refetch
incoming INSERT                  ++ (realtime)      debounced
open dialog                      не трогать         —
manual ✓                         RPC + optimistic 0 1 (через S1)
outgoing send OK                 RPC + optimistic 0 1 (через S1)
outgoing send FAIL               без изменений      —
параллельный incoming during RPC оставлен unread    debounced
```

STOP-guards:

- если RPC возвращает 0 rows и при этом UI показал «прочитано» — STOP, разобрать перед прод-выкаткой;
- если `onError` не откатывает optimistic patch — STOP.

Rollback: drop RPC миграцией; revert файлов.

DRY RUN: на тестовом диалоге с 5 непрочитанных — RPC одной транзакцией помечает все 5; параллельный incoming во время RPC остаётся unread; FAIL отправки → unread не сброшен.

Before/after proof: mark-as-read 14 непрочитанных = 1 RPC + 1 inbox-refetch (вместо ≤28 callbacks). F4 runtime: после успешного ответа карточка теряет unread-badge < 500 мс (optimistic).

DoD S2: миграция применена, RPC работает, F3/F4 закрыты по state-matrix, proof-файл.

---

S

3. F1 — оптимизация `get_inbox_dialogs_v1`

Цель: уменьшить latency RPC на текущем объёме (9 334 строк) и сделать рост сублинейным. Сначала — переписать запрос; aggregate-таблицу заводим ТОЛЬКО если после rewrite + S1 baseline не достигает DoD.

Шаг S3.1 — Diagnose под нагрузкой (read-only):

- `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)` текущего RPC на тестовой нагрузке (НЕ в прайм-тайм, согласовать окно).
- Зафиксировать P50/P95/P99 на сегодняшнем объёме + 3 синтетических объёма (×3, ×10, ×30 через временный test-schema, не trogая prod).

Шаг S3.2 — Plan rewrite (HYPOTHESIS):

- Вариант A (предпочтительный): переписать через CTE с предварительным выбором top-N user_id по `idx_telegram_messages_created_at DESC` + LATERAL подзапросы для last-message и unread-count по `idx_telegram_messages_unread_v1`. Цель — Index Scan + Nested Loop вместо полного HashAgg.
- Снять `EXPLAIN ANALYZE` варианта A, сравнить.

Шаг S3.3 — Execute:

- Миграция: `CREATE OR REPLACE FUNCTION public.get_inbox_dialogs_v1(...)` с новым телом. Сигнатура и контракт результата НЕ меняются.
- GRANT EXECUTE остаётся прежним.
- Уменьшить частоту вызова: `staleTime` `["inbox-dialogs"]` поднять с 30s до 60s (после S1 invalidate приходит точечно по событию — частые автоматические refetch не нужны).

STOP-guards:

- если новый план хуже старого по P95 хоть на одной выборке — STOP, откат, не катить.
- если контракт колонок результата изменился — STOP.

Rollback: миграцией восстановить предыдущее тело функции (бэкап текста — в proof-файле).

Условие на S3.4 (aggregate-таблица): материализованная `telegram_dialog_summary` создаётся ТОЛЬКО если после S3.3 + S1 cold-открытие > 200 ms P95 на сегодняшнем объёме или ×10 проекции даёт > 800 ms. Не создаётся автоматически.

Before/after proof: EXPLAIN ANALYZE до/после; cold/warm Network trace по §4.A. Цель: P50 < 80 ms, P95 < 200 ms на текущем объёме.

DoD S3: RPC оптимизирован, контракт сохранён, proof-файл.

---

S

4. F5 — мобильный composer (единый патч)

Цель: composer виден при открытой клавиатуре и QuickType bar на iOS Safari и standalone PWA, на Android не регрессирует, на desktop без изменений. Все три элемента (meta viewport, safe-area, visualViewport) делаются совместно; одна строка `interactive-widget` сама по себе не закрывает фикс.

Файлы:

- `index.html` — meta viewport: `content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content"`.
- `src/hooks/useVisualViewportInset.ts` — УЖЕ существует (canonical, см. lesson-room). Подключить как есть, не дублировать.
- `src/components/admin/ContactTelegramChat.tsx` composer (`~line 1907`):
  - подключить `useVisualViewportInset()` (single-mount на странице чата);
  - обернуть composer в контейнер со `style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + var(--room-vv-bottom-offset, 0px))' }}`;
  - после `textarea.focus` — `scrollIntoView({ block: 'end', behavior: 'smooth' })` для последнего сообщения.
- Никаких изменений в desktop-ветке (хук no-op на desktop).

STOP-guards:

- runtime proof обязателен на реальном iPhone (iOS Safari + standalone PWA, iOS 16.4+);
- если на iPhone клавиатура всё ещё перекрывает composer — STOP, не закрывать;
- двойного учёта safe-area нет (только в `calc()`).

Rollback: revert файлов; meta viewport вернуть к исходному.

Before/after proof: видеозапись/скрин с iPhone — composer виден над клавиатурой и QuickType bar; на Android Chrome не сломалось; на desktop layout идентичен.

DoD S4: runtime PASS на iPhone + Android + desktop, proof-файл.

---

Follow-up / DEFERRED (не блокируют S0…S4)

- F9 — дубликат partial-индексов `idx_telegram_messages_unread` / `_unread_v1`: дроп ТОЛЬКО после `pg_stat_user_indexes` proof, что один из них не используется, и dependency-проверки. Отдельный микро-патч.
- F8 — partial-индекс для `telegram_logs.action NOT IN`: вне scope контакт-центра, в backlog.
- F11 — lazy signed URLs через intersection observer: пересмотреть после S1+S3.
- Memory growth UAT (20–30 последовательных открытий) — отдельная задача.
- F12 — email_inbox health-check после фактической настройки IMAP.

---

Технический раздел

SQL/RPC summary:

```text
+ CREATE FUNCTION public.mark_dialog_read_atomic(p_user_id uuid, p_before_ts timestamptz)
  RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public;
  GRANT EXECUTE ON FUNCTION public.mark_dialog_read_atomic TO authenticated;

~ CREATE OR REPLACE FUNCTION public.get_inbox_dialogs_v1(p_limit int, p_offset int, p_search text)
  -- rewrite: top-N user_id by idx_telegram_messages_created_at + LATERAL per-user
  -- контракт результата НЕ меняется
```

Список затрагиваемых файлов:

```text
S1: src/hooks/useInboxRealtimeInvalidation.ts (new)
    src/components/admin/communication/InboxTabContent.tsx
    src/hooks/useUnreadMessagesCount.tsx
S2: supabase/migrations/<ts>_mark_dialog_read_atomic.sql
    src/components/admin/communication/InboxTabContent.tsx
    src/components/admin/ContactTelegramChat.tsx
S3: supabase/migrations/<ts>_get_inbox_dialogs_v1_rewrite.sql
    src/components/admin/communication/InboxTabContent.tsx (staleTime)
S4: index.html
    src/components/admin/ContactTelegramChat.tsx
```

Безопасность и изоляция:

- доступы / billing / broadcasts / CRM / документы / Stripe / bePaid / RLS / Storage НЕ затрагиваются;
- edge-функции (telegram-admin-chat, telegram-webhook, grant-access-*) не меняются;
- контракт API (`get_inbox_dialogs_v1`) сохраняется по сигнатуре и колонкам результата;
- никаких миграций по `auth/storage/realtime/supabase_functions/vault`.

Артефакты на выходе Этапа 2:

- `.lovable/proofs/contact_center_baseline_2026-06-14.md` (S0)
- `.lovable/proofs/patch_contact_center_s1_<date>.md`
- `.lovable/proofs/patch_contact_center_s2_<date>.md`
- `.lovable/proofs/patch_contact_center_s3_<date>.md`
- `.lovable/proofs/patch_contact_center_s4_<date>.md`
- финальный отчёт `Отчет о выполнении: PATCH-CONTACT-CENTER-FIX-V1`

Ожидаемое подтверждение перед выполнением: «Утверждаю план PATCH-CONTACT-CENTER-FIX-V1, начинать с S0».