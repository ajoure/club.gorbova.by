да, согласен, с учетом правок:

## **1. Шаг diagnose обязателен перед правками**

Начинать только с read-only diagnose H1–H5. После него прислать короткий отчёт:

```text
H1 merge identity — confirmed / not confirmed
H2 chatItemsWithMeta deps — confirmed / not confirmed
H3 unstable callbacks/maps — confirmed / not confirmed
H4 quote lookup hot path — confirmed / not confirmed
H5 reactions lookup hot path — confirmed / not confirmed
```

Правки делать только после подтверждения реального bottleneck.





## **2.**

`React.memo` **не должен быть “магическим” ускорением**

Если props всё равно пересоздаются на каждый render, memo не даст эффекта. Поэтому порядок работ правильный, но зафиксировать жёстко:

```text
Сначала стабилизировать input props / callbacks / item identity.
Потом memoize bubbles.
```

Иначе получится новый компонент, который всё равно ререндерится 50 раз.

## **3. Comparator должен быть безопасным, не минимальным**

В список render-relevant полей добавить:

```text
is_read
is_deleted
deleted_at
error
upload_status
upload_progress
media_load_state
signed_url
signed_url_error
file_name
file_size
mime_type
duration
thumbnail_url
reply_preview
reply_author
isHighlighted
isEditing
isReplyTarget
isOptimistic
```

Если хоть одно из этих полей влияет на UI, comparator обязан его учитывать.





## **4. Не передавать**

`admin_profile ref`**, если ref нестабилен**

В плане есть:

```text
admin_profile ref
```

Лучше не передавать объектом. Передавать плоско:

```ts
adminName: string | null
adminAvatarUrl: string | null
```

Иначе новая ссылка на объект сломает memo.

То же самое для `bot metadata`:

```ts
botName: string | null
botUsername: string | null
botAvatarUrl?: string | null
```

## **5. Reactions тоже лучше стабилизировать**

Если `reactionsForRow` — массив, он должен быть stable:

```text
same reaction payload → same array reference
```

Иначе comparator будет видеть новый массив каждый раз.

Варианты:

- передавать `reactionsVersion`;
- или memoized `reactionsForRow`;
- или comparator сравнивает короткий stable signature.

Не делать глубокий compare большого массива на каждый bubble render.

## **6. Quote preview вынести из hot path — согласен**

`messagesByTgId.get(...)` в render path убрать.

В `chatItemsWithMeta` заранее подготовить:

```ts
quotedPreview
quotedAuthor
quotedMessageId
quotedMissing
```

В bubble не должно быть lookup по общей map.





## **7.**

`chatItemsWithMeta` **dependencies проверить особо**

Этот memo не должен зависеть от:

```text
draft message
selectedBotId
footer state
hover state
context menu state
temporary input state
```

Он может зависеть от:

```text
messages
events
billingEvents
telegramReactionsMap / reactionsVersion
highlightedId
locale/timezone если реально используется
```

Но `highlightedId` будет менять props максимум у двух bubbles, если comparator правильный.

## **8. Callback dependencies должны быть стабильными**

`useCallback` должен зависеть не от больших объектов, а от стабильных функций/mutations.

Проверить, чтобы не было:

```ts
useCallback(..., [messages, chatItems, telegramReactionsMap])
```

Иначе каждый render будет пересоздавать callbacks и ломать memo.





## **9.**

`mergeByIdPreferEnriched` **— без тяжёлого deepEqual**

Согласен с identity preservation, но нельзя делать deepEqual по всему `meta`.

Сравнивать только render-relevant fields.

Формат:

```ts
hasRenderRelevantChanges(prev, next): boolean
```

Если `false`:

```ts
return prev
```

Если `true`:

```ts
return next
```

## **10. EventBubble тоже memoize, но не смешивать с message comparator**

Системные события/пилюли имеют другой набор props. Для них отдельный comparator:

```text
id
type
label
created_at/time label
status
amount/currency если billing
isHighlighted если есть
```

Не использовать один общий comparator для message/event.

## **11. Hover controls внутри bubble — принять, но проверить initial paint**

Если hover controls монтируют тяжёлые dropdown/menu компоненты сразу, это может съесть initial paint.

Для V1.3 проверить:

```text
Dropdown/Menu content mounted only on open/hover?
Emoji picker not mounted until needed?
```

Если они монтируются сразу для 50 bubbles — вынести lazy/deferred, но только если diagnose подтвердит.

## **12. Runtime proof должен включать render count**

Гейт `MessageBubble render count ≤ diff-only` правильный, но надо формализовать:

```text
Warm A→B→A:
- при возврате к A не должно быть 50 render сообщений A;
- допускаются рендеры changed/highlighted/new messages;
- target: <= 5–10 bubble renders на warm reopen, если данных не изменилось.
```

Если render count всё ещё 50, V1.3 не PASS даже если p95 случайно прошёл.

## **13. Cold gates принять**

Использовать именно текущие V1.2 baseline:

```text
cold-nopf p95 <= 461 ms
cold-pf p95 <= 415 ms
```

Если cold ухудшился — это regression.

## **14. Proof по media/reactions/reply обязателен**

Так как comparator легко ломает обновления, smoke должен включать:

```text
- отправка реакции обновляет bubble;
- edit обновляет текст;
- delete меняет состояние сообщения;
- mark_read/read indicator обновляется;
- media signed URL после загрузки обновляет bubble;
- reply quote scroll работает;
- highlighted bubble появляется и снимается.
```

Без этого memo-патч опасен.

## **15. Не трогать Stage-2 / prefetch V1.2**

Согласен. V1.3 должен работать поверх V1.2:

```text
full RPC before first paint = 0
wrong-chat flash = 0
```

Эти два инварианта нельзя сломать.

## **16. Отдельный audit-файл**

Да:

```text
docs/audit/2026-07-08-telegram-chat-performance-v1-3.md
```

В V1.2 добавить только ссылку на V1.3, если нужно.

## **17. Итоговый статус**

Финальный отчёт должен завершаться одним из вариантов:

```text
PATCH-CONTACT-CENTER-TELEGRAM-CHAT-PERFORMANCE-V1.3-MEMOIZE-BUBBLE — PASS
```

или:

```text
PATCH-CONTACT-CENTER-TELEGRAM-CHAT-PERFORMANCE-V1.3-MEMOIZE-BUBBLE — PARTIAL
```

`PASS` только если:

```text
warm p95 < 200 ms
cold gates pass
render count diff-only
full RPC before first paint = 0
wrong-chat flash = 0
regression smoke pass
typecheck pass
```

## **18. Virtualization не начинать автоматически**

Если V1.3 не даст `<200 ms`, следующий вывод не “сразу делаем virtualization”, а:

```text
V1.4 candidate only after Profiler proof
```

Для 50 сообщений virtualization может быть лишней.

---

План утверждён. Начинать с **read-only diagnose H1–H5**, затем прислать мини-отчёт перед клиентскими правками.

&nbsp;

План: PATCH-CONTACT-CENTER-TELEGRAM-CHAT-PERFORMANCE-V1.3-MEMOIZE-BUBBLE

Цель: warm p95 first visible message <200 ms (желательно <150 ms) при переключении A↔B, без регрессий cold/write-path. Bottleneck по V1.2 proof — не сеть, а render/DOM 50 bubbles.

## Scope V1.3

Только client-side render-оптимизация:

1. Извлечь `MessageBubble` (сообщения) и `EventBubble` (события/системные пиллы) как отдельные top-level компоненты в `src/components/admin/chat/`.
2. Обернуть оба в `React.memo` с explicit props (никаких больших `msg`/`event` объектов целиком — только render-relevant поля).
3. Custom comparator: только render-relevant поля (id, direction, message_text, status, edited, deleted, timeShort, highlighted, reactions ref, media поля, reply_to_message_id, bot metadata, admin_profile ref).
4. Стабилизировать identity: `mergeByIdPreferEnriched` при равных полезных полях должен возвращать **ту же ссылку** на существующий item (`===`), чтобы memo реально не перерисовывал ряды после fetch.
5. Проброс всех обработчиков (`onReply`, `onReact`, `onEdit`, `onDelete`, `onScrollToQuote`, `onRefreshMedia`) через `useCallback` со стабильными зависимостями.
6. Мапы (`messagesByTgId`, `botsMap`, `telegramReactionsMap`) — пробрасывать не целиком, а через селектор конкретной строки: комбинируем в `chatItemsWithMeta` (уже memoized) заранее рассчитанные `quotedPreview`, `botLabel`, `reactionsForRow`. Тогда `<MessageBubble>` получает готовые примитивы + один reactions-массив.
7. Стабилизировать `avatarUrl`, `clientName` — уже строки, ок; убедиться, что props не перекладываются в новые объекты каждый рендер.
8. Раздел «Reply/Emoji hover controls» и dropdown «Редактировать/Удалить» оставить внутри `<MessageBubble>` — они висят на hover, не влияют на initial paint.
9. НЕ трогать: RPC, RLS, edge functions, realtime, write-path (`sendMessage/edit/delete/reactions/read`), Stage-2 idle-fetch, prefetch механику, freshness marker, ScrollArea/pinning.
10. НЕ смешивать с `DRAFT-PER-DIALOG` — отдельный будущий патч.

## Гипотезы, которые обязан подтвердить/опровергнуть diagnose (Шаг 2 перед правкой)


| Гипотеза                                                                                   | Как проверить                                  |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| H1: `mergeByIdPreferEnriched` возвращает новые item-ссылки при equal payload               | reader на функцию 353–390, сравнить с equality |
| H2: `chatItemsWithMeta` пересобирается на каждый setState (draft/editing/highlightedId)    | grep зависимостей useMemo 671                  |
| H3: `renderChatItem` замыкается на нестабильные callbacks/maps → все ряды перерисовываются | React DevTools Profiler (2 warm sample)        |
| H4: quote lookup (`messagesByTgId.get`) в hot render path                                  | line 1767                                      |
| H5: reactions map read (`telegramReactionsMap?.[msg.id]`) в hot render path                | line 1705                                      |


Diagnose read-only без правок, потом мини-отчёт с таблицей → согласование → правки.

## Технические шаги (build phase, после согласования)

Шаг A (файлы, создание):

- `src/components/admin/chat/TelegramMessageBubble.tsx` — memo, explicit props.
- `src/components/admin/chat/TelegramEventBubble.tsx` — memo, explicit props.
- `src/components/admin/chat/telegramBubbleTypes.ts` — тип props (плоский), чтобы TS следил за explicit polями.

Шаг B (изменения `ContactTelegramChat.tsx`):

- `mergeByIdPreferEnriched`: shallow-equal по render-relevant fields → return `prev[i]` при совпадении (identity preserved).
- `chatItemsWithMeta` расширить: добавить precomputed `quotedPreview`, `quotedAuthor`, `botLabel`, `reactionsForRow`.
- Заменить inline `renderChatItem` на `<TelegramMessageBubble ... />` / `<TelegramEventBubble ... />` в map (2060–2073).
- Все callbacks через `useCallback` (с корректными deps: mutations, setters, scrollToMessage).
- `renderChatItem` удалить.

Шаг C (проверка):

- typecheck.
- Runtime proof harness V1.3 (тот же что V1.2, стабильные selectors `data-testid="telegram-message-list"` + `data-message-id`): N=10 warm, N=10 cold-nopf, N=10 cold-pf.
- React DevTools Profiler: reopen A→B → «render committed» count по `<TelegramMessageBubble>` должен быть = только новые/изменённые ряды (не 50).
- Регрессия smoke: send / edit / delete / voice / video_note / mark_read / реакция / reply-quote scroll / realtime новое входящее.

## Гейты (Definition of Done)


| Метрика                             | Гейт                   | Действие при miss                                    |
| ----------------------------------- | ---------------------- | ---------------------------------------------------- |
| Warm TTFP p95                       | <200 ms (stretch <150) | PARTIAL, но проверить нужна ли virtualization (V1.4) |
| Warm render count MessageBubble     | ≤ diff-only            | Иначе H3 не решена, править comparator               |
| Cold no-pf p95                      | ≤ 461 ms (V1.2 +10%)   | fail → откат                                         |
| Cold pf p95                         | ≤ 415 ms (V1.2 +10%)   | fail → откат                                         |
| Full RPC before first paint         | 0/N                    | не должно измениться                                 |
| Wrong-chat flash                    | 0                      | не должно измениться                                 |
| Selector timeouts                   | 0/30                   | иначе proof не принимается                           |
| Typecheck                           | PASS                   | обязателен                                           |
| Регрессия write-path/realtime/media | нет                    | обязателен                                           |


## Файлы (ожидаемое)

- new: `src/components/admin/chat/TelegramMessageBubble.tsx`
- new: `src/components/admin/chat/TelegramEventBubble.tsx`
- new: `src/components/admin/chat/telegramBubbleTypes.ts`
- edit: `src/components/admin/ContactTelegramChat.tsx` (merge identity, chatItemsWithMeta расширение, замена renderChatItem, useCallback)
- new: `docs/audit/2026-07-08-telegram-chat-performance-v1-3.md` (diagnose + proof + итог)
- edit: `.lovable/plan.md`

## Не в scope

- DRAFT-PER-DIALOG (отдельный bugfix patch).
- Virtualization (только если H3+memo не даст <200 ms).
- Любые изменения RPC/RLS/edge functions/realtime.
- Изменения в prefetch/idle Stage-2 механике V1.2.

## Отчёт по завершении

Обязательная итоговая таблица:


| Metric                                                          | V1.2     | V1.3 | Status    |
| --------------------------------------------------------------- | -------- | ---- | --------- |
| warm p95                                                        | 349.8 ms | ...  | PASS/MISS |
| cold-nopf p95                                                   | 430.9 ms | ...  | PASS/MISS |
| cold-pf p95                                                     | 376.6 ms | ...  | PASS/MISS |
| MessageBubble render count on reopen                            | ~50      | ...  | PASS/MISS |
| full RPC before first paint                                     | 0        | 0    | PASS      |
| wrong-chat flash                                                | 0        | 0    | PASS      |
| regression send/edit/delete/voice/video_note/mark_read/realtime | PASS     | ...  | PASS/FAIL |


Начать с Шага 2 — read-only diagnose с подтверждением H1–H5 и коротким отчётом, только потом клиентские правки.