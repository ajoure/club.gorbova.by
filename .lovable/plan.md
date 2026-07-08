## да, согласен, с учетом правок:

## **1. V1.1 нельзя начинать с реализации, сначала короткий perf-diagnose**

План правильно выделяет проблему, но перед Step 1 нужно зафиксировать обязательный mini-diagnose:

```text
PATCH-CONTACT-CENTER-TELEGRAM-CHAT-PERFORMANCE-V1.1-DIAGNOSE
```

Без этого есть риск оптимизировать не тот слой.

Нужно сначала получить:

```text
browser timing:
- blocked / DNS / TLS
- TTFB
- download
- JSON parse
- React render до first visible message

RPC:
- EXPLAIN ANALYZE под authenticated
- payload size current
- row count current
- fields current
```

Если окажется, что 1.04 сек — это сеть/Auth/PostgREST, а не payload, то split fast/full может дать меньше эффекта, чем prefetch/cache.

## **2. Не менять текущий RPC несовместимо**

Не перегружать текущий RPC так, чтобы случайно поменять поведение V1.

Вместо:

```text
admin_get_telegram_messages_fast_v1(p_user_id, p_limit, p_fast boolean)
```

лучше создать отдельную функцию:

```text
admin_get_telegram_messages_lean_v1
```

Текущий `admin_get_telegram_messages_fast_v1` оставить как есть.

Причина: V1 уже прошёл PASS, не нужно ломать стабильный путь.

## **3. Fast payload 20 сообщений — да, но нужен fallback на полный текст**

Обрезка `message_text` до 4 КБ допустима только если в UI есть:

```text
“Показать полностью”
```

или автоматическая замена текста после прихода full-query.

Иначе можно получить баг: оператор открыл чат и видит обрезанное сообщение, не понимая, что оно неполное.

Для V1.1:

```text
lean query:
- message_text_preview <= 4 KB
- is_truncated boolean
full query:
- заменяет preview полным message_text
```

## **4. Не убирать все join из fast, если они нужны для первого paint**

Убрать `bot_*` и `admin_*` join можно только если UI не зависит от них для первого отображения.

Если без них появляются пустые аватары/имена/лейблы, лучше:

```text
header/bot/admin metadata брать из выбранного dialog row
```

а не из messages RPC.

То есть first paint должен получать:

```text
messages lean + already-known dialog metadata
```

## **5. Prefetch первых 3 диалогов — осторожно**

Prefetch первых 3 диалогов после загрузки списка может ускорить UX, но может создать лишнюю нагрузку, если список часто инвалидируется realtime.

Добавить ограничения:

```text
- prefetch только при idle/requestIdleCallback
- только если вкладка активна
- только если диалог ещё не в cache
- throttle/debounce после realtime invalidation
- не prefetch при включённых тяжёлых фильтрах/поиске
```

Иначе после каждого входящего сообщения можно получить скрытую волну RPC.

## **6. Hover/pointer prefetch — да, но только для desktop**

Для mobile hover не работает. Использовать:

```text
onPointerEnter — desktop
onPointerDown — desktop/mobile
onFocus — keyboard navigation
```

`onPointerDown` особенно полезен: запрос стартует на 100–200 мс раньше click.

## **7. Warm reopen <100–200 мс лучше решать cache-only first**

Если warm reopen сейчас делает RPC 176 мс, значит при выборе уже cached диалога не нужно блокироваться на refetch.

Для warm open:

```text
- показывать cache immediately
- background refetch через staleTime
- selected dialog не должен remount full tree, если key тот же тип
```

Проверить настройки:

```text
staleTime: 60–120 сек
gcTime: 10 мин
refetchOnMount: false или controlled background refetch
placeholderData: previous
```

## **8. React.memo недостаточно — нужна виртуализация или сохранение mounted state**

Если warm reopen 0.6 сек из-за remount дерева, `React.memo` может помочь частично, но надо проверить:

```text
- не пересоздаётся ли весь список сообщений из-за reverse/map
- не меняется ли key родительского компонента
- не пересоздаётся ли Supabase/query client context
- не пересчитываются ли grouped rows всего inbox
```

Для V1.1 не вводить тяжёлую виртуализацию, если её нет. Но добавить proof React Profiler.

Если сообщений всего 50, проблема скорее не в VirtualList, а в remount/parsing/components.





## **9. Markdown/emoji через**

`startTransition` **— только если реально есть bottleneck**

Не добавлять преждевременно.

Сначала React Profiler должен показать, что Markdown/emoji/formatting съедают заметное время. Если нет — не трогать.

## **10. Signed URL map memo — обязательно**

После V1 lazy media уже вне critical path, но warm render может тормозить из-за пересчёта карт.

Добавить:

```text
useMemo по stable message ids/storage_paths
dedupe in-flight signed-url requests
cache by storage_path + expires_at
```

## **11. Messages cache key должен быть единым и предсказуемым**

Для lean/full нельзя устроить ситуацию, где UI скачет между двумя query keys.

Рекомендация:

```text
telegramMessagesLeanQK(dialogKey, limit=20)
telegramMessagesFullQK(dialogKey, limit=50)
```

Мержить в derived view:

```text
displayMessages = merge(full ?? lean)
```

Не пытаться вручную писать full в lean cache без строгого adapter-а.

## **12. Full-query не должен блокировать actions**

Пока пришёл только lean:

- send работает;
- reply preview работает, если reply_to есть;
- mark read работает;
- scroll bottom работает;
- media placeholders работают.

Full-query только обогащает данные.

## **13. Mark read timing не менять**

Нельзя из-за fast-paint раньше/позже ломать unread.

Зафиксировать:

```text
mark-read вызывается по тем же условиям, что V1
```

Не привязывать mark-read к full-query.

## **14. Нужно проверить PostgreSQL/Auth overhead именно под тем же JWT**

`EXPLAIN authenticated` сделать не абстрактно, а максимально близко к UI:

```text
same admin user
same p_user_id / telegram_user_id
same bot id
same limit
same selected heavy dialog
```

Иначе сравнение снова будет некорректным.

## **15. Payload proof обязателен**

В audit добавить таблицу:

```text
V1 full response:
- bytes compressed
- bytes uncompressed
- rows
- fields

V1.1 lean response:
- bytes compressed
- bytes uncompressed
- rows
- fields

Reduction %
```

Без этого нельзя понять, дал ли lean RPC эффект.

## **16. Network proof обязателен**

В audit добавить:

```text
Request start
TTFB
Content download
JSON parse
React first visible message
Total UI ready
```

Скрин или exported performance trace.

## **17. Цель <1 сек cold open должна быть “first visible messages”, не “всё готово”**

Иначе медиа/full/pills могут мешать.

Формулировка DoD:

```text
Cold open first visible message < 1 сек p95
Full enrichment may finish later
```

## **18. p95 нельзя доказать одним открытием**

Минимально:

```text
10 cold opens на тяжёлом диалоге
10 warm reopens
median + p95
```

Если Lovable не может стабильно гонять 10 раз, статус только `PARTIAL`.

## **19. Не трогать IG/Support/unified — согласен**

Но proof regression всё равно нужен:

```text
unified inbox opens
IG row opens
Support row opens
mono Telegram opens
```

Без глубокой проверки, просто smoke.

## **20. Итоговый proof-файл**

```text
docs/audit/2026-07-08-telegram-chat-performance-v1-1.md
```

## **21. Финальный отчёт**

```text
Отчет о выполненной работе: PATCH-CONTACT-CENTER-TELEGRAM-CHAT-PERFORMANCE-V1.1
```

Финальный статус:

```text
Telegram chat V1.1 first-paint optimization — PASS / PARTIAL
Cold first visible message p95 — <1s / not reached
Warm reopen p95 — <200ms / not reached
Lean payload reduction — % 
Prefetch hit rate — %
Realtime/send/read/media regression — PASS
```

## **Утверждение**

План утверждён после этих правок.

Ключевой принцип V1.1:

```text
Сначала показываем lean последние 20 сообщений из cache/prefetch.
Потом фоном догружаем full 50 и медиа.
Ни один enrichment-запрос не блокирует первый видимый чат.

PATCH-CONTACT-CENTER-TELEGRAM-CHAT-PERFORMANCE-V1.1
```

**Цель:** довести открытие чата до ощущения «как Telegram».

- Cold open < 1 сек стабильно (сейчас ~1.7 с UI / 1.04 с RPC)
- Warm reopen < 100–200 мс (сейчас ~0.6 с UI / 0.18 с RPC)

---

### Diagnose (перед реализацией)

1. **Почему RPC 1043 мс в UI против 0.5 мс в DB.**
  - Замерить в браузере: DNS/TLS, TTFB, download, JSON parse отдельно.
  - Проверить размер payload (Content-Length, gzip on/off).
  - Проверить, не идёт ли auth refresh перед первым запросом (частая причина +300–500 мс).
  - `EXPLAIN (ANALYZE, BUFFERS)` того же RPC под ролью `authenticated` (не только под service_role) — RLS/guard overhead.
  - Посмотреть, не тянет ли RPC лишние поля (`meta` jsonb, `reply_markup`, длинные тексты у старых сообщений).
2. **Warm reopen 0.6 с при cache hit 0.18 мс RPC.**
  - Значит время съедает не сеть, а re-mount дерева (VirtualList, аватарки, парсинг Markdown, i18n).
  - Профайл React DevTools: сколько ms на render `ContactTelegramChat` + список сообщений.

---

### Plan

#### Step 1. Split payload: fast-paint 20 + background 50

- RPC `admin_get_telegram_messages_fast_v1` → добавить перегрузку/параметр `p_fast_limit` (по умолчанию 20).
- Новый lean-вариант возвращает только поля для первого paint:
`id, direction, message_text, message_type, created_at, is_read, sent_by_admin, telegram_message_id`
без `meta`, `reply_markup`, без `bot_*` / `admin_*` join (их отдаёт вторым RPC).
- Клиент: два `useQuery`:
  - `messages-fast` (limit 20, lean) — критический путь;
  - `messages-full` (limit 50, полный) — фоновая догрузка, мерджится в тот же кэш.
- `isLoading` привязан только к `messages-fast`.

#### Step 2. Prefetch стратегия

- После загрузки списка диалогов — `queryClient.prefetchQuery` для первых 3 диалогов (lean-вариант, 20 сообщений).
- На `onMouseEnter` / `onPointerDown` строки диалога — prefetch того же lean-запроса (Telegram/Slack паттерн).
- Prefetch кладём с тем же query key, чтобы клик по диалогу мгновенно взял cache hit.

#### Step 3. RPC round-trip diagnostics

- Добавить `console.time`/Performance API вокруг RPC: `network`, `parse`, `render`.
- Если TTFB > 300 мс — проверить, не идёт ли параллельный `auth.getSession()` перед fetch (пересобрать supabase client init, чтобы session уже был hydrated к моменту клика).
- Если parse тяжёлый — вынести `meta` из fast-варианта (Step 1 это уже решает).

#### Step 4. Render-cost на warm reopen

- `React.memo` на `MessageBubble`, стабильные ключи, `useMemo` для отформатированных дат.
- Не пересчитывать signed URL map на каждый render (мемо по `message.id`).
- Отложить mount тяжёлых плагинов (Markdown/emoji) через `startTransition` — текст появляется, форматирование через кадр.

#### Step 5. Payload size

- gzip/br проверить на ответе Postgres (RPC через PostgREST должен уже сжимать).
- Обрезать `message_text` до 4 КБ на fast-варианте (полный текст приходит во втором запросе).

---

### Dry run / замеры до

- Performance timeline на cold open: TTFB, response, parse, first paint.
- Warm reopen: React Profiler flamegraph.
- `EXPLAIN ANALYZE` под `authenticated`.

### Execute

- Миграция: перегрузка RPC `admin_get_telegram_messages_fast_v1(p_user_id, p_limit, p_fast boolean default true)` либо новая `admin_get_telegram_messages_lean_v1`.
- Клиент: `ContactTelegramChat.tsx` — двухступенчатый useQuery + мердж; prefetch в `InboxTabContent.tsx` / row hover.
- Мемоизация в `MessageBubble` и производных компонентах.

### Verify (DoD)

Приложить фактические цифры before/after:


| Метрика                             | Baseline (V1) | Target (V1.1)                    |
| ----------------------------------- | ------------- | -------------------------------- |
| Cold open UI                        | 1.696 с       | < 1.0 с                          |
| Cold open RPC network               | 1.043 с       | < 400 мс                         |
| Warm reopen UI                      | 0.595 с       | < 200 мс                         |
| Warm reopen RPC                     | 0.176 с       | < 50 мс (или 0, если cache-only) |
| Prefetch hit rate первых 3 диалогов | 0%            | > 80%                            |
| Payload fast-варианта               | текущий       | −60% (без meta/join)             |


Regression pass: send/edit/delete/voice/video_note, mark_read, unread counter, realtime, IG/Support/mono inbox — не тронуты.

---

### Что НЕ делаем в V1.1

- Не меняем write-path (`telegram-admin-chat` send/edit/delete).
- Не трогаем RLS `telegram_messages`.
- Не трогаем coordinator `mark_dialog_read_v2`, unread-счётчик.
- Не переносим realtime подписки.
- Unified inbox / IG / Support — вне scope.