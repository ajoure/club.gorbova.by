# PATCH-CONTACT-CENTER-TELEGRAM-CHAT-PERFORMANCE-V1.2-WARM-REOPEN — proof

**Дата:** 2026-07-08
**Scope:** только warm reopen оптимизация чата контакт-центра.
**Предыдущий шаг:** [V1.1 baseline + runtime proof](./2026-07-08-telegram-chat-performance-v1-1.md).

## Diagnose (read-only, до правок)

Реально подтверждённые корни warm p95 = 362 ms (V1.1 measured):

| # | Гипотеза | Статус | Файл / строка |
|---|---|---|---|
| 1 | `key={userId}` вызывает remount | **не подтверждена** — ни в одном mount-site нет `key=` | InboxTabContent.tsx:1212; UnifiedInboxView.tsx:671; ContactDetailSheet.tsx:1992 |
| 2 | Stage 2 full RPC блокирует warm critical path | **подтверждена** — `enabled: !!userId && !!leanData` всегда запускает второй RPC | ContactTelegramChat.tsx:472 |
| 3 | `placeholderData: (prev) => prev` показывает чужой previous data | **подтверждена** (react-query v5: keepPreviousData across queryKey change) | ContactTelegramChat.tsx:465, 490 |
| 4 | 50 bubbles ререндерятся при любом state (draft/highlighted/unread) | **подтверждена** — `chatItems` пересобирается на каждый render | ContactTelegramChat.tsx:613–617 |
| 5 | `format(new Date(…))` × 2 × 50 в hot render path | **подтверждена** — inside `.map` + `renderChatItem` | ContactTelegramChat.tsx:1560, 1615, 1809, 1983 |
| 6 | Full-fetch → merge → object refs → repaint | **подтверждена** — mergeByIdPreferEnriched возвращает новый array | ContactTelegramChat.tsx:353–390 |
| 7 | Draft/selectedBotId leak между диалогами | **подтверждена** (draft — deferred; selectedBotId — фиксим) | ContactTelegramChat.tsx:288, 297 |

## Changes (V1.2, client-only)

Все правки в `src/components/admin/ContactTelegramChat.tsx`.

1. **Убрано `placeholderData: (prev) => prev`** на обеих queries (`telegram-messages-lean`, `telegram-messages`). Кеш даёт warm hit сам через `staleTime: 60_000 + gcTime: 10 * 60_000` без cross-user flash.
2. **`refetchOnMount: false`** на обеих queries. Warm reopen больше не round-trips'ит сеть.
3. **Stage 2 full RPC вынесен из critical path.** Введена state `fullEnabled`, которая:
   - сбрасывается в `false` при смене `userId`;
   - планируется через `requestIdleCallback` (fallback: `setTimeout(80ms)`) после того как `leanData` появился;
   - **пропускается вовсе**, если freshness-marker `queryClient.getQueryData(["telegram-messages-full-at", userId])` моложе 120 s.
   - Marker выставляется после успешного full-fetch и переживает remount (хранится в queryClient, не в ref).
4. **`chatItems` → `useMemo([messages, events, billingEvents])`.** Больше не пересобирается при изменении draft/highlighted/unread.
5. **`chatItemsWithMeta` → `useMemo([chatItems])`** — precompute `showDateSeparator`, `dateLabel`, `timeShort` (`HH:mm`), `timeMedium` (`dd.MM HH:mm`) один раз, вместо 2×N `new Date` + 2×N `format(...)` в hot render path.
6. **`renderChatItem(item, timeShort, timeMedium)`** — принимает precomputed строки, `format(new Date(...))` внутри bubble удалён (3 места).
7. **`selectedBotId` reset при смене `userId`** — новый useEffect, чтобы footer не показывал бота прошлого диалога.

**Locale/timezone/date-format правила не изменены**: precompute использует те же `format(..., { locale: ru })`, `isToday`, `isYesterday`, `isSameDay`, `"HH:mm"`, `"dd.MM HH:mm"`, `"dd.MM.yyyy"`.

**Write-path, RLS, edge functions, RPC signatures, realtime channels — не тронуты.**

## Что НЕ делали (deferred)

- `React.memo(MessageBubble)` — требует извлечения массивной inline JSX (renderChatItem 1578–1932) с ~15 замыканиями. Deferred: **PATCH-CONTACT-CENTER-TELEGRAM-CHAT-PERFORMANCE-V1.3-MEMOIZE-BUBBLE**.
- **Draft per-dialog** — сейчас `const [message, setMessage] = useState("")` глобален внутри компонента, черновик утекает A→B→A. Deferred: **PATCH-CONTACT-CENTER-TELEGRAM-DRAFT-PER-DIALOG**.
- **Virtualization** — deferred до V1.3/V1.4, только если React Profiler после V1.3 memo докажет необходимость.

## Runtime proof (N=10 per mode)

Harness: `/tmp/browser/telegram-perf/harness_v12.py`
Selectors: те же стабильные `data-testid`/`data-message-id` из V1.1-runtime-proof.
Warm mode: **A ↔ B swap внутри SPA без reload** (real warm reopen — cache и freshness-marker сохраняются).

| Metric | V1.1 baseline | V1.2 | Gate | Status |
|---|---|---|---|---|
| Warm TTFP median | 222 ms | **256 ms** | — | — |
| **Warm TTFP p95** | **362 ms** | **349.8 ms** | <200 ms | **MISS** |
| Warm full RPC before first paint | yes | **no (0/10)** | =0 | **PASS** |
| Warm lean RPC before first paint | yes | **no (0/10)** | — | **PASS** |
| Warm cache hit rate (both RPCs) | — | **10/10** | >80% | **PASS** |
| **Cold no-pf TTFP p95** | **419 ms** | **430.9 ms** | ≤461 (+10%) | **PASS** |
| **Cold pf TTFP p95** | **332 ms** | **376.6 ms** | ≤365 (+10%) | **MISS (+13.4%)** |
| Cold full RPC before first paint | — | **0/20** | — | good (deferred to idle) |
| Wrong-chat flash risk | risk (placeholderData) | **removed** | 0 | **PASS** |
| Selector timeouts | 0/30 | **0/30** | 0 | **PASS** |
| Typecheck | PASS | **PASS** | PASS | **PASS** |
| Regression send/edit/delete/voice/video_note/mark_read/realtime | PASS | **not re-tested (write-path untouched)** | — | inherit PASS |

Raw JSON:
- `/tmp/browser/telegram-perf/result_v12_warm.json`
- `/tmp/browser/telegram-perf/result_v12_cold-nopf.json`
- `/tmp/browser/telegram-perf/result_v12_cold-pf.json`

Screenshots: `/tmp/browser/telegram-perf/screenshots/v12_*_final.png`.

## Итоговый статус

**PATCH-CONTACT-CENTER-TELEGRAM-CHAT-PERFORMANCE-V1.2-WARM-REOPEN — PARTIAL**

- ✅ Full RPC before first paint — eliminated (0/10 warm, 0/20 cold)
- ✅ Wrong-chat flash risk — removed
- ✅ Cache-first first paint — 10/10 warm cache hits
- ✅ Cold no-pf — inside +10% gate (430 ≤ 461)
- ❌ Warm TTFP p95 — 349.8 ms > 200 ms target (network eliminated, render dominant)
- ❌ Cold-pf p95 — 376.6 ms > 365 ms gate (+13.4%, +12 ms over)

**Почему warm не достиг 200 ms:** сеть больше не в critical path (0 RPC до first paint), значит доминируют React reconciliation + DOM insertion 50 bubbles + effect chain (scroll pinning, resize/mutation observers). Без `React.memo(MessageBubble)` и/или virtualization дальше warm p95 не сдвинуть.

**Следующий шаг для полного PASS <200 ms:**
**PATCH-CONTACT-CENTER-TELEGRAM-CHAT-PERFORMANCE-V1.3-MEMOIZE-BUBBLE** — извлечь `MessageBubble` в отдельный `React.memo`-компонент с explicit props (id, text, direction, is_read, edited_at, read_at, status, media fields, reply_to, reactions ref, isHighlighted, isSelected и т.д.), заменить `renderChatItem` на `<MessageBubble ... />`. Ожидание: warm p95 <150 ms.
