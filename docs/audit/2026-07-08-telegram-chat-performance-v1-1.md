# PATCH-CONTACT-CENTER-TELEGRAM-CHAT-PERFORMANCE-V1.1 — proof

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
