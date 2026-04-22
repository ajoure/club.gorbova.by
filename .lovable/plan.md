# да, согласен, с учетом правок:

1. В пункте 3.B для DOM-proof зафиксируй не только `top ≈ 0`, но и допуск, например `Math.abs(top_after) <= 2`. Иначе проверка будет хрупкой из-за mobile browser chrome/safe-area.
2. В пункте 3.B добавь ещё один обязательный замер:
  &nbsp;
  &nbsp;
  - `document.querySelector('[data-room-messages-scroll]').getBoundingClientRect()`
  - до и после body-scroll.  
  Это нужно, чтобы доказать, что после ухода header scroll-area остаётся в том же pinned-блоке под video, а не пересобирается.
3. В пункте 4 по M2 entry_path hint зафиксируй точный критерий accepted для второго heartbeat:
  - stale `'menu'` не должен повторно уходить;
  - допустимо либо отсутствие `entry_path` в body, либо явный `'direct'`;
  - но **недопустимо** повторное `'menu'`.  
  Это надо прописать явно.
4. В пункте 6 добавь ещё один технический маркер для proof:
  - на sticky main контейнер повесь `data-mobile-sticky-main`.  
  Тогда в DOM-proof можно надёжно проверить:
  - `getComputedStyle(...).position === 'sticky'`
  - `top === '0px'`  
  без двусмысленного поиска по классам.
5. В пункте 8.2 зафиксируй, что сначала снимаются mobile screenshots/DOM-proof по M1.2, и только потом M2 entry_path proof. Иначе navigation через список эфиров может сбить чистый scroll-proof по mobile layout.
6. В closing report добавь отдельную строку:
  - `proof artifacts saved = yes/no`  
  Если `no`, Этап 1 не закрывать.
7. В финальном статусе после proof используй только один из трёх вариантов:
  - `accepted`
  - `not accepted`
  - `deferred`  
  Не писать смешанные формулировки вроде `code complete, live-proof pending` в финальном closing report; это оставить только для текущего промежуточного состояния.
8. В pre-proof patch явно зафиксируй, что добавление `data-*` атрибутов — это единственная допустимая инструментальная правка перед proof. Никаких новых layout-изменений на этом шаге не делать.

&nbsp;

&nbsp;

План: Закрытие Этапа 1 — runtime live-proof M1.2 + M2 entry_path hint

## Принятые правки к плану

### 1. M1.2 — статус строго до proof

`**M1.2 — code patched, live-proof pending**`
`**Stage 1 — not closed**`
`**M3 — blocked until Stage 1 closing report**`

Code-review не засчитывается как доказательство. Принимается только runtime live-proof в реальном браузере на mobile 390×844.

### 2. Acceptance criteria M1.2 (жёсткие, все обязательны)

1. Header (`data-mobile-header`) полностью ушёл за верхний край viewport после body-scroll.
2. Верхний край экрана после scroll начинается с video-shell.
3. video-shell остаётся видимым и не уезжает дальше.
4. reactions bar и tabs остаются под video-shell, не двигаются.
5. composer остаётся `position: fixed` у нижнего края viewport.
6. После порога scroll body перестаёт двигаться; дальнейший scroll возможен только внутри `.room-messages-scroll`.
7. Desktop 1366×768: header виден, video и sidebar не развалились, чат работает как раньше — **0 регрессий**.

### 3. Runtime live-proof пакет — обязательный набор

#### A. Mobile 390×844 — screenshots (5 кадров)


| #   | Состояние                                                  | Что должно быть видно                                                |
| --- | ---------------------------------------------------------- | -------------------------------------------------------------------- |
| 1   | стартовый экран (без скролла)                              | header + compact video + reactions + tabs + composer                 |
| 2   | body-scroll до порога (≈50% пути)                          | header частично ушёл, video всё ещё с отступом сверху                |
| 3   | состояние после полного ухода header                       | верх экрана = video-shell, header невидим                            |
| 4   | scroll внутри `.room-messages-scroll` (после ухода header) | сообщения прокручиваются, video/reactions/tabs/composer не двигаются |
| 5   | focused composer (фокус в input)                           | composer над клавиатурой, video не двигается                         |


#### B. DOM-замеры (не только скрины — **обязательно числами**)

Через `browser--observe` / `browser--extract` снять и приложить в отчёт:

```js
// До body-scroll
document.querySelector('[data-mobile-header]').getBoundingClientRect()
// → ожидание: top ≥ 0, bottom > 0 (виден)

document.querySelector('[data-video-shell]').getBoundingClientRect()
// → запомнить top_before

window.scrollTo(0, 1000)

// После body-scroll
document.querySelector('[data-mobile-header]').getBoundingClientRect()
// → ожидание: bottom ≤ 0 (header ушёл выше viewport)

document.querySelector('[data-video-shell]').getBoundingClientRect()
// → ожидание: top ≈ 0 (video залип сверху), top_after < top_before
```

Computed-style проверки:

- `getComputedStyle(main).position === 'sticky'` и `top === '0px'`.
- `getComputedStyle(roomMessagesScroll).overflowY === 'auto'`.
- `getComputedStyle(composer).position === 'fixed'` (на mobile).

**Технический preрequisite:** добавить `data-video-shell` атрибут на корневой элемент колонки video в `LiveEvent.tsx` (уже есть `data-mobile-header` — добавить парный маркер для измерений). Это не меняет layout, только добавляет селектор для proof.

#### C. Desktop regression 1366×768 — screenshots (2 кадра)

1. desktop layout: video слева, sidebar справа, header виден всегда.
2. desktop scroll: header не двигается (нет sticky-механики), composer sticky внутри Card, чат скроллится внутри.

### 4. M2 entry_path hint — runtime live-proof в том же пакете

#### Сценарии (network + sessionStorage proof):


| #   | Шаг                                                 | Доказательство                                                                                   |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1   | Открыть `/live` (список эфиров), кликнуть карточку  | `sessionStorage.getItem('live_entry_${slug}')` === `'menu'`                                      |
| 2   | После navigate в `/live/:slug` — первый soft-join   | `live-session-heartbeat` request body содержит `entry_path: 'menu'`                              |
| 3   | После успешного ответа soft-join                    | `sessionStorage.getItem('live_entry_${slug}')` === `null`                                        |
| 4   | Следующий heartbeat (через ~30s или ручной trigger) | request body **не** содержит `entry_path` (или содержит fallback `'direct'`), без stale `'menu'` |


Network proof: capture через `browser--list_network_requests` + `browser--get_network_request_details` для `live-session-heartbeat`, приложить request body raw.

### 5. Структура closing report — жёсткое разведение статусов

Отчёт обязан содержать **четыре отдельных секции**:

1. **Что исправлено кодом** — список файлов + diff-summary (1–3 строки на файл).
2. **Что подтверждено live-proof** — таблица screenshots + ссылки.
3. **Что подтверждено только DOM/network/SQL** — getBoundingClientRect, computed style, network payloads (без UI-визуала).
4. **Что ещё не принято** — список open issues, partial states, deferred items (например, `entry_path='menu'` storage в `live_view_sessions` ждёт M3).

Запрещено смешивать «сделано в коде» и «доказано работой». Если нет runtime proof — в секцию 4.

### 6. Технические prerequisite-правки в коде (минимальные, для proof)

Перед запуском proof-сессии:

- `src/pages/LiveEvent.tsx`:
  - На корневой контейнер колонки video (mobile-обёртка над video-shell) добавить `data-video-shell` атрибут. Без изменений layout.
  - Убедиться, что header имеет `data-mobile-header` (если ещё нет — добавить).
- `src/components/live/LiveEventComments.tsx` / `LiveEventQuestions.tsx`:
  - Убедиться, что `.room-messages-scroll` контейнер имеет `data-room-messages-scroll` атрибут для надёжного селектора в proof.

### 7. Stop-rules (повторно зафиксированы)

- НЕ считать M1.2 закрытым по code-review.
- НЕ начинать M3 миграции до closing report Этапа 1.
- НЕ трогать desktop layout.
- НЕ трогать `.room-messages-scroll` / composer / M1.1, если sticky чинится одной правкой layout.
- НЕ реверсировать чат (правило закреплено в Этапе 1).
- НЕ удалять `entry_path` hint до успешного ответа soft-join.

### 8. Последовательность исполнения (после approval)

1. **Pre-proof patch**: добавить `data-video-shell`, `data-room-messages-scroll` атрибуты (если отсутствуют). Это не code-fix, это инструментирование.
2. **Runtime live-proof session** (browser tool, default mode):
  - Open `/live/test-sergey-2204-v-1540` в viewport 390×844.
  - Снять 5 mobile screenshots по таблице A.
  - Снять DOM-замеры по таблице B (до и после `window.scrollTo`).
  - Перейти в desktop 1366×768, снять 2 regression screenshots.
  - Воспроизвести 4 сценария M2 entry_path hint, capture network + sessionStorage.
3. **Closing report Этапа 1** по структуре из п.5.
4. **Только после этого** — старт Этапа 2 (M3 analytics) по уже утверждённому плану.

### 9. Финальный статус текущего состояния

```
M1.1                — code complete, live-proof pending
M2 entry_path hint  — code complete, live-proof pending
M1.2                — code patched, live-proof pending
Stage 1             — not closed
M3 analytics        — blocked until Stage 1 closing report
Follow-ups          — blocked until M3 done
```