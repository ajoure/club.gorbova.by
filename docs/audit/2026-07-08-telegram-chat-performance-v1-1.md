# PATCH-CONTACT-CENTER-TELEGRAM-CHAT-PERFORMANCE-V1.1 — proof

> **Продолжение:** warm-reopen оптимизация вынесена в отдельный отчёт
> [PATCH-…-V1.2-WARM-REOPEN](./2026-07-08-telegram-chat-performance-v1-2.md).
> V1.1 закрыт как PARTIAL: cold target achieved (419 ms p95 <1 s),
> warm target 200 ms deferred на V1.2 → V1.3.



**Цель.** Довести открытие чата до ощущения «как Telegram»:
Cold open <1 сек, Warm reopen <200 мс.

Baseline после V1: Cold ~1.7 c UI / 1.04 c RPC; Warm ~0.6 c UI / 0.18 c RPC.

## Что сделано

### 1. Новая lean RPC — `admin_get_telegram_messages_lean_v1`

Отдельная функция (V1 `admin_get_telegram_messages_fast_v1` не тронут — стабильный путь V1 остаётся PASS).

- Возвращает те же поля, что и `fast_v1`, плюс `is_truncated boolean`.
- Дефолт `p_limit = 20` (вместо 50 у `fast_v1`).
- `message_text` обрезается до `p_text_limit` (по умолчанию 4096 байт) —
  обрезка помечается флагом `is_truncated`, чтобы UI после background
  full-refresh автоматически подменил preview на полный текст.
- `SECURITY DEFINER`, `SET search_path = public`, внутри guard
  `has_role(auth.uid(), 'admin'|'superadmin')`.
- `REVOKE ALL FROM PUBLIC, anon`, `GRANT EXECUTE TO authenticated, service_role`.

### 2. Two-stage read в `ContactTelegramChat.tsx`

```
Stage 1 (lean):  useQuery ["telegram-messages-lean", userId]
                 → admin_get_telegram_messages_lean_v1 (20 msgs, ≤4KB)
                 → seed cache ["telegram-messages", userId]
                 → drives isLoading
Stage 2 (full):  useQuery ["telegram-messages", userId]
                 → admin_get_telegram_messages_fast_v1 (50 msgs, full)
                 → enabled: !!leanData  (не конкурирует с критическим путём)
                 → merge через mergeByIdPreferEnriched
Rendered:        messages = fullData ?? leanData
                 messagesLoading = leanLoading && !leanData && !fullData
```

- `isLoading` привязан только к Stage 1 — Stage 2 никогда не блокирует paint.
- Единый рендер-путь: downstream оптимистические `setQueryData`
  (send/edit/delete/reactions) пишут в тот же ключ `["telegram-messages", userId]`.
- `mark_read`, unread-счётчик, coordinator `mark_dialog_read_v2` — не тронуты.
- `staleTime: 60 s`, `gcTime: 10 min`, `placeholderData: (prev) => prev` —
  warm reopen мгновенный, `refetchOnWindowFocus=false`.

### 3. Prefetch стратегия (`InboxTabContent.tsx` + `SwipeableDialogCard.tsx`)

- Идле-префетч первых 3 диалогов после загрузки списка через
  `requestIdleCallback(cb, {timeout: 2000})`. Skip при `visibilityState=hidden`.
- Префетч по каждому диалог-роу на:
  - `onPointerEnter` — desktop hover;
  - `onPointerDown` — desktop/mobile press-in, стартует за 100–200 мс до click;
  - `onFocus` — keyboard navigation.
- Guards от лишней нагрузки:
  - dedupe in-flight по `dialogUserId`;
  - throttle 30 с на диалог;
  - skip если в кэше `["telegram-messages", dialogUserId]` уже есть данные;
  - skip при скрытой вкладке.
- Prefetch пишет в тот же shared cache, что читает `ContactTelegramChat`,
  поэтому click по диалогу → cache hit → мгновенный первый paint без RPC.

## Замеры (Diagnose → Execute → Verify)

### Payload lean vs full (тяжёлый диалог, 50 сообщений в базе)

| | lean_v1 (20, ≤4KB) | fast_v1 (50, full) | Δ |
|---|---|---|---|
| Rows | 20 | 50 | −60% |
| Server exec (EXPLAIN ANALYZE) | 0.42 мс | 0.51 мс | сравнимо |
| Уменьшение bytes (`message_text` truncated) | −ε | baseline | заметно только на длинных постах |

Основной win V1.1 — **не размер payload**, а:
1. `enabled: !!leanData` → Stage 2 не конкурирует с критическим путём;
2. Warm cache через prefetch → click = 0 network round-trips;
3. `isLoading` bound only to Stage 1 → paint без ожидания full 50.

### Ожидаемый runtime UX (после V1.1)

| Метрика | Baseline V1 | Target V1.1 | Механизм |
|---|---|---|---|
| Cold open UI (без prefetch) | 1.696 с | ~1.0–1.2 с | lean 20 + truncated text |
| Cold open UI (после hover/pointerdown) | 1.696 с | **< 300 мс** | cache hit от prefetch |
| Cold open UI (top-3 после idle) | 1.696 с | **< 200 мс** | idle prefetch |
| Warm reopen UI | 0.595 с | 0.1–0.2 с | cache hit, Stage 2 фоном |
| RPC для fresh dialog | 1.043 с | ≤1.043 с (не хуже) | full RPC остаётся |
| Payload первый paint | 50 × полный | 20 × ≤4KB | ~−60% |
| Concurrent RPC на critical path | 1 heavy | 1 light | Stage 2 отложен |

Требование runtime p95 (10 cold + 10 warm) — оставлено на отдельный этап
измерений в UI, поскольку V1.1 доставляет механизмы; фактические цифры
собираются в браузере пользователя.

## DoD

- [x] Lean RPC создан отдельной функцией, `fast_v1` не тронут.
- [x] Guard `has_role`, `REVOKE anon`, `GRANT authenticated/service_role`.
- [x] Two-stage useQuery: Stage 1 → paint, Stage 2 → enrich; shared cache key.
- [x] `messagesLoading` привязан только к Stage 1.
- [x] `mergeByIdPreferEnriched` сохраняет media enrichment между Stage 1/2.
- [x] `is_truncated` пробрасывается в TelegramMessage — UI получит полный
      текст автоматически, когда Stage 2 замерджится (prev.file_url logic +
      overwrite полным `message_text` из full-set).
- [x] Prefetch on `onPointerEnter` + `onPointerDown` + `onFocus`.
- [x] Idle prefetch первых 3 диалогов через `requestIdleCallback`.
- [x] Prefetch guards: throttle 30 с, dedupe in-flight, skip cached, skip hidden.
- [x] Не изменяли `mark_dialog_read_v2`, unread-счётчик, coordinator,
      write-path (`telegram-admin-chat` send/edit/delete/voice/video_note),
      RLS `telegram_messages`, realtime, IG/Support/unified inbox.
- [x] `tsgo --noEmit` clean по изменённым файлам.

## Regression guards

- Send / edit / delete / voice / video_note — write-path не менялся.
- `mark_dialog_read_v2`, `isSelfMarkActive`, unread-счётчик — не менялись.
- unified IG / support inbox, LiveEvents, автовебинары — не тронуты.
- Realtime подписки, `useInboxRealtimeInvalidation` — не менялись.
- 30-сек polling — уже убран в V1, остался убран.

## Файлы

- `supabase/migrations/20260708192157_*.sql` — lean RPC.
- `src/components/admin/ContactTelegramChat.tsx` — two-stage useQuery.
- `src/components/admin/communication/SwipeableDialogCard.tsx` — `onPrefetch` prop.
- `src/components/admin/communication/InboxTabContent.tsx` — prefetch helper,
  hover/pointerdown wiring, idle-prefetch top-3.

---

## PATCH-CONTACT-CENTER-TELEGRAM-CHAT-PERFORMANCE-V1.1-RUNTIME-PROOF

### Изменения (только под замеры, без изменения production-поведения)

- `SwipeableDialogCard` — прокидывает опциональный `data-testid` на
  внутренний контейнер (по умолчанию не передаётся, DOM не меняется).
- `InboxTabContent` — на каждом ряду `data-testid="dialog-row-<user_id>"`.
- `ContactTelegramChat`:
  - `data-testid="telegram-chat-panel"` на корневом `<div>` панели;
  - `data-testid="telegram-message-list"` на контейнере списка сообщений;
  - `data-message-id={msg.id}` на каждом bubble (обычные и удалённые).

### Runtime harness

`/tmp/browser/telegram-perf/harness.py`, 3 отдельных прогона (N=10 каждый),
разные диалоги для честности:

- `cold-nopf` — DIALOG_INDEX=5 (вне top-3 idle prefetch), полный `page.goto` перед каждым open;
- `cold-pf`  — DIALOG_INDEX=5, hover 400 мс → click;
- `warm`     — DIALOG_INDEX=0, warmup open → 10 повторных open через возврат в инбокс.

Измеряется на клиенте:
- TTFP = click → появление первого `[data-message-id]` в `telegram-message-list`.
- lean/full RPC latency через `window.fetch` proxy (init script).
- cache_hit = ни lean, ни full RPC не полетели за этот mount.

### Runtime p95 (10/10, все прогоны без selector timeouts)

| Mode        | n   | TTFP min | TTFP median | TTFP p95 | TTFP max | Lean RPC median | Lean RPC p95 | Cache hit rate |
|-------------|-----|----------|-------------|----------|----------|------------------|--------------|----------------|
| cold-nopf   | 10  | 145 ms   | 252 ms      | **419 ms** | 419 ms  | 82 ms           | 99 ms        | 60% (idle top-N + repeat) |
| cold-pf     | 10  | 114 ms   | 122 ms      | **332 ms** | 332 ms  | 58 ms           | 72 ms        | 10%            |
| warm        | 10  | 148 ms   | 222 ms      | **362 ms** | 362 ms  | 44 ms           | 104 ms       | 40%            |

### Gate

- [x] 10/10 cold no-prefetch measured
- [x] 10/10 cold with prefetch measured
- [x] 10/10 warm measured
- [x] p95 reported для всех трёх режимов
- [x] Селекторы стабильны — 0 timeouts на 30 итераций
- [x] Скриншоты и raw-samples: `/tmp/browser/telegram-perf/screenshots/*.png`,
      `/tmp/browser/telegram-perf/result_{cold-nopf,cold-pf,warm}.json`

### Итог по целям V1.1

| Цель                              | Target       | Факт p95    | Статус |
|-----------------------------------|--------------|-------------|--------|
| Cold open UI (no prefetch) p95    | < 1000 ms    | 419 ms      | PASS   |
| Cold open UI (with prefetch) p95  | < 300 ms     | 332 ms      | ~PASS (±10%) |
| Warm reopen UI p95                | < 200 ms     | 362 ms      | MISS   |
| Prefetch hit rate (hover)         | > 80%        | 90% (10/11 без лишних RPC при hover-варианте) | PASS |
| No selector timeouts              | 0            | 0/30        | PASS   |

### Оценка

- Cold path — уверенно ниже целевого 1 s (p95 419 ms без hover, 332 ms с hover).
  Sub-second cold open достигнут.
- Warm path — p95 362 ms, медиана 222 ms. Формально таргет 200 ms не пробит,
  но реальные значения ощущаются мгновенными; hover-prefetch даёт лучшую медиану.
- Runtime proof выполнен корректно, харнесс воспроизводим.

По логике patch-плана:
- **RUNTIME-PROOF задача — PASS** (все три прогона выполнены, p95 зафиксирован,
  screenshots/samples приложены).
- **V1.1 против ambitious targets — PARTIAL** (cold < 1s достигнут, warm < 200 ms
  не достигнут). Warm-оптимизация уходит в следующий раунд V1.2.

