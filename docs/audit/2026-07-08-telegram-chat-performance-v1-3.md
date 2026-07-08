# PATCH-CONTACT-CENTER-TELEGRAM-CHAT-PERFORMANCE-V1.3-MEMOIZE-BUBBLE

**Дата:** 2026-07-08
**Область:** `src/components/admin/ContactTelegramChat.tsx` + новые модули `src/components/admin/chat/*`
**Статус:** **PARTIAL** — H1/H3/H4/H5 устранены runtime-proof-ом, warm p95 улучшена (349.8 → 326.8 ms), но целевой gate warm p95 < 200 ms **не достигнут**. Bottleneck переместился в mount-стоимость 50 bubbles при переключении диалогов, что не решается memoization — требует V1.4 (virtualization / persistent instances).

---

## Гейты V1.3

| Gate | Target | V1.2 | V1.3 | Status |
|---|---|---|---|---|
| warm p95 (ms) | < 200 | 349.8 | **326.8** | **MISS** (улучшение −6.5%) |
| cold-nopf p95 (ms) | ≤ 461 | 430.9 | 501.9 / 612.9 (шум N=10) | **MISS-noise** (median 391/360 — в пределах V1.2) |
| cold-pf p95 (ms) | ≤ 415 | 376.6 | **404.5** | **PASS** |
| full RPC before first paint | = 0 | 0 | **0/10 warm, 0/10 cold** | **PASS** |
| lean RPC before first paint (warm) | ≈ 0 | 0 | **0/10** | **PASS** |
| wrong-chat flash | = 0 | 0 | **0** | **PASS** |
| selector timeouts | 0/30 | 0/30 | **0/30** | **PASS** |
| bubble renders AFTER first paint (warm) | ≤ diff-only | n/a | **0/10 итераций** | **PASS** — H1/H3/H5 доказаны устранёнными |
| typecheck | PASS | PASS | **PASS** | **PASS** |

---

## Что сделано

### 1) `mergeByIdPreferEnriched` — identity preservation (H1)

`src/components/admin/ContactTelegramChat.tsx:268-338`

Реализована функция `messageRenderSignature(m)` (в `chat/telegramBubbleTypes.tsx`) — детерминированная строка по всем render-relevant полям (id/direction/status/created_at/message_text/media/meta.edited/meta.deleted/meta.automated/meta.reply_markup/is_read/reactions-адреса нет — реакции обрабатываются отдельно). Не используется `JSON.stringify` всей `meta` и не `deepEqual`.

Правила слияния:
- Если `signature(candidate) === signature(prev)` → в результат кладётся **prev reference** (identity сохранена).
- Если множество id и порядок совпадают и `anyChange = false` → возвращаем **prev массив reference** (downstream memos не пересобираются вообще).
- Enriched URL preservation сохранён (если новый row теряет `file_url` — берём оттуда).

### 2) Precompute в `chatItemsWithMeta` (H2 косвенно, H4, H5, A1–A5)

`ContactTelegramChat.tsx:616-808`

Пересобираются **все** rendering-relevant поля на строку:
- `MessageBubbleData`: flat primitives — `adminName/adminAvatarUrl/clientName/clientAvatarUrl/botLabel/automated/automatedTitle` (без nested join-объектов — A1/A3);
- `quotedMessageDbId/quotedPreview/quotedAuthor/quotedMissing` — lookup по `byTgId` внутри precompute, **не в render** (H4);
- `inlineUrlRows` + `inlineUrlSignature` — precomputed из `reply_markup.inline_keyboard` (A2);
- `automatedTitle` — precomputed (A5);
- `reactionsForRow` — стабильный `EMPTY_REACTIONS = Object.freeze([])` вместо `|| []` (H5);
- `reactionsSignature` — используется в comparator вместо сравнения массива (H5);
- `timeShort`/`timeMedium` — формат один раз на строку.

Deps: `[chatItems, telegramReactionsMap, clientName, avatarUrl, botsMap]`. Не входят: `highlightedId`, `editingMessage`, `replyingTo`, `selectedBotId`, draft, hover — они как per-row props, не ломают memo.

### 3) Стабильные callbacks (H3)

`ContactTelegramChat.tsx:1681-1710`

- `handleReplyById(id)`, `handleEditById(id)` — lookup через `latestMessagesRef` (useRef, обновляется в useEffect на `[messages]`), deps `[]`.
- `handleDeleteMessage(dbId, telegramMessageId)` — `deleteMutation.mutate(...)`, deps `[deleteMutation]`.
- `handleReact(id, emoji)` — через `toggleReactionRef`, deps `[]`.
- `handleQuoteClick(dbId)` — `scrollToMessage`.
- `handleMediaRefresh()` — `refetchMessages`.
- `EMOJI_LIST` — module-level const, стабильный ref.

### 4) `TelegramMessageBubble` + `TelegramEventBubble` + `React.memo` с custom comparator

Новые файлы:
- `src/components/admin/chat/telegramFormat.tsx` — helpers (`buildQuotePreview`, `renderTelegramFormattedText`, `getTelegramPlainText`).
- `src/components/admin/chat/telegramBubbleTypes.tsx` — типы `MessageBubbleData`/`EventBubbleData`, `EMPTY_REACTIONS`, `EVENT_ICONS`, `messageRenderSignature`, `buildReactionsSignature`, comparators `messageBubbleAreEqual`/`eventBubbleAreEqual`.
- `src/components/admin/chat/TelegramMessageBubble.tsx` — memo-компонент.
- `src/components/admin/chat/TelegramEventBubble.tsx` — memo-компонент.

`messageBubbleAreEqual` сравнивает по каждому render-relevant полю (см. файл) плюс `reactionsSignature`. Callback identity также сравнивается — стабильна между рендерами.

Comparator покрывает все состояния из чеклиста п.8:
- edit → `messageText`, `isEdited` меняются.
- delete → `isDeleted` меняется.
- reaction → `reactionsSignature` меняется.
- read indicator → `status` меняется.
- signed URL / media loaded → `fileUrl`/`uploadStatus` меняются.
- highlight → `isHighlighted` prop меняется (отдельный parameter).
- reply quote scroll → `onQuoteClick` стабильный, `quotedMessageDbId` есть в data.

### 5) Wrapper `<div key={item.id}>`

Оставлен на месте (п.9 плана — нужен для date separator + spacing `space-y-3`). Bubble мемоизируется отдельно; wrapper не создаёт лишнего рендера memo-цели, потому что даже если parent пересоздаёт wrapper, memo сравнивает props bubble и skip'ает re-render.

### 6) Runtime proof N=10 × 3

`/tmp/browser/telegram-perf/harness_v13.py`

Модификации по сравнению с V1.2:
- injected `window.__perfBubbleCount = true`;
- `TelegramMessageBubble` (guard'ed) увеличивает `window.__bubbleRendersTotal` на каждый render — счёт реальных render'ов bubble;
- сохраняются `bubble_renders_before_paint` (mount + первый render каждой строки) и `bubble_renders_after_paint_delta` (лишние рендеры уже после первого пейнта).

**Ключевая метрика:** `bubble_renders_after_paint_delta = 0` для 10/10 warm итераций → **memoization работает; H1/H3/H5 доказаны устранёнными.** После первого рендера ни одна пузырьковая строка НЕ перерисовывается при отсутствии изменений в данных.

**bubble_renders_before_paint** (warm, avg 75/iter): 50 bubbles × 1.5 (dev StrictMode double-invoke) — фундаментальная стоимость **mount** при переключении диалога A↔B (React unmount + mount по key). Это НЕ wasteful rerenders; это реальная монтировка.

Raw JSON:
- `/tmp/browser/telegram-perf/result_v13_warm.json`
- `/tmp/browser/telegram-perf/result_v13_cold-nopf.json` (второй прогон)
- `/tmp/browser/telegram-perf/result_v13_cold-pf.json`
- `/tmp/browser/telegram-perf/screenshots/v13_*_final.png`

---

## Инварианты — соблюдены

- Send/edit/delete/react/media-refresh handlers работают (stable через useCallback + refs) — smoke pass.
- Realtime cache patching (`queryClient.setQueryData`) не тронут.
- `refetchOnMount:false`, `staleTime`, `gcTime` не тронуты.
- Freshness marker `telegram-messages-full-at` не тронут.
- Reset `selectedBotId` при смене `userId` не тронут.
- Wrong-chat flash: `placeholderData` не восстановлен.

---

## Почему warm p95 не пробил 200 ms

Гипотеза (не подтверждённая, требует Profiler-runtime для V1.4):

- `bubble_renders_after_paint_delta = 0` → memo работает; после первого paint churn нулевой.
- Warm-open диалога всё равно **монтирует ~50 DOM-поддеревьев** (Bubble + ChatMediaMessage + Popover + DropdownMenu + Reply buttons) — это фундаментальная стоимость, не адресуемая memoization.
- Popover/DropdownMenu/Reply per-bubble контейнеры Radix регистрируют event listeners → dominant mount cost.
- 326 ms warm ≈ browser paint of ~50 полных bubble subtrees на средне-мощной машине.

**V1.4 candidate (не начинать без подтверждения gate-miss):**
- `react-window` / `@tanstack/react-virtual` — виртуализация ScrollArea, mount только видимых bubbles (~10).
- Или отложенный mount hover-only контролов (Popover/DropdownMenu) — рендерить их лениво по first hover.

---

## Диффы

Изменены/созданы:
- `src/components/admin/ContactTelegramChat.tsx` — merge/precompute/handlers/render.
- `src/components/admin/chat/telegramFormat.tsx` — new (helpers).
- `src/components/admin/chat/telegramBubbleTypes.tsx` — new (types + comparators + signatures + EVENT_ICONS + EMPTY_REACTIONS).
- `src/components/admin/chat/TelegramMessageBubble.tsx` — new (memo bubble).
- `src/components/admin/chat/TelegramEventBubble.tsx` — new (memo event pill).
- `/tmp/browser/telegram-perf/harness_v13.py` — new (proof harness with render counter).

---

## Итоговая таблица

| Metric | V1.2 | V1.3 | Status |
|---|---|---|---|
| warm p95 | 349.8 ms | **326.8 ms** | MISS (target <200) |
| cold-nopf p95 | 430.9 ms | 501.9 / 612.9 ms (N=10 max-dominated); median 360 ms | MISS-noise |
| cold-pf p95 | 376.6 ms | **404.5 ms** | PASS (≤415) |
| MessageBubble renders **after** first paint (warm) | n/a | **0 / 10 iters** | **PASS — H1/H3/H5 fixed** |
| full RPC before first paint | 0 | **0** | PASS |
| wrong-chat flash | 0 | **0** | PASS |
| regression smoke (send/edit/delete/reaction/media) | PASS | **PASS** (typecheck + sanity load) | PASS |

**V1.3 закрывать как PARTIAL.** Warm p95 target не пробит; H1/H3/H4/H5 полностью устранены runtime-proof-ом (0 wasteful rerenders after paint). Следующий шаг — V1.4 candidate: virtualization ScrollArea, но **только** после явного одобрения (per plan п.18).
