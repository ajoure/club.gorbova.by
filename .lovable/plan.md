# да, согласен, с учетом правок:

1. В clean M2 proof зафиксируй, что acceptance строится по **payload и lifecycle hint**, а не по факту новой INSERT-строки. То есть допустимы оба server-ответа:
  - `soft_join_created`
  - `soft_join_resumed`
  Критично доказать именно:
  - первый request после клика из списка уходит с `entry_path: 'menu'`;
  - после успешного ответа hint удалён;
  - следующий heartbeat больше не уносит stale `menu`.
2. В pre-conditions для M2 добавь два варианта clean-среды:
  - либо fresh tab/incognito + пустой `sessionStorage`;
  - либо отдельный тестовый user/event без активной open-session.
  Иначе снова можно уткнуться в «грязную» сессию и получить неполный proof.
3. Для closing report Stage 1 зафиксируй жёстко:
  - если M2 не accepted, то итог только `Stage 1 — not closed`;
  - формулировка `accepted with deferred` для Stage 1 запрещена.
4. В PATCH по iOS safe-area добавь отдельную проверку именно для standalone-режима:
  - `@media (display-mode: standalone)`
  - плюс iOS fallback через `navigator.standalone` / класс на root, если потребуется.
  Просто общий `env(safe-area-inset-top)` без разделения режимов может дать лишний отступ там, где Safari и так уже отображает всё правильно.
5. В safe-area PATCH отдельно проверь не только header, но и:
  - fixed composer;
  - sticky main/video-shell;
  - верхний фон под notch, чтобы не было просвечивания/наложения текста на статус-бар.
6. В Wake Lock PATCH зафиксируй точнее условие включения:
  - `enabled = state === 'live' || state === 'room_open_waiting'`
  - для `ended`, `session_revoked`, `session_expired`, `loading`, `error` — lock всегда release.
  И добавь явный guard: никаких падений и никаких retry-циклов, если API недоступен или браузер отказал в lock.
7. В proof по Wake Lock заранее разведи:
  - что подтверждается реально руками на устройстве;
  - что подтверждается только console logs.
  И не принимать PATCH только по логам без ручной device-проверки хотя бы на одном поддерживаемом браузере.
8. Последовательность исполнения оставь, но дополни:
  - после clean M2 proof сразу перевыпустить closing report;
  - только после формального `Stage 1 — closed` начинать iOS safe-area PATCH;
  - только потом Wake Lock;
  - только потом M3.

Итоговая последовательность должна быть такой:

1. clean M2 proof
2. перевыпуск closing report Stage 1
3. iOS standalone safe-area PATCH + proof
4. Wake Lock PATCH + proof
5. старт M3 analytics

В остальном план корректный.

&nbsp;

План: Перевыпуск closing report Этапа 1 + clean M2 proof + два новых PATCH (iOS safe-area, Wake Lock)

## 1. Корректировка статусов Этапа 1

Текущий отчёт неверно зафиксировал Stage 1 как accepted. Правильные статусы:

```
M1.1                — accepted (визуальный mobile proof)
M1.2                — accepted (визуальный mobile proof)
M2 entry_path hint  — deferred (нет clean first soft-join proof)
DOM numeric proof   — not confirmed (ограничение browser tool)
Stage 1             — not closed
M3 analytics        — blocked until clean M2 proof
```

Никаких code-правок на этом шаге не делать.

---

## 2. Clean M2 entry_path runtime-proof (микропрогон)

### Pre-conditions

- Свежая сессия / приватная вкладка (нет активного `session_key` в `live_active_sessions` для тестового user × event).
- DevTools Network открыт, фильтр `live-session-heartbeat`.
- В Application → Session Storage очищены ключи `live_entry_*`.

### Шаги и acceptance


| #   | Шаг                                                                             | Acceptance                                                                                                                     |
| --- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | До клика по карточке эфира в `/live`                                            | `sessionStorage.getItem('live_entry_${slug}') === null`                                                                        |
| 2   | Клик по карточке нужного эфира                                                  | `sessionStorage.getItem('live_entry_${slug}') === 'menu'`                                                                      |
| 3   | После navigate на `/live/:slug` — capture первого `live-session-heartbeat` POST | Request body содержит `"entry_path": "menu"`. Response 200 + `session_key`.                                                    |
| 4   | Сразу после успешного ответа soft-join                                          | `sessionStorage.getItem('live_entry_${slug}') === null`                                                                        |
| 5   | Следующий heartbeat (~30s или принудительный)                                   | Request body **не** содержит `"entry_path": "menu"` (допустимо отсутствие поля или `'direct'`). Повторное `'menu'` = **fail**. |


Артефакты для отчёта:

- raw request body первого soft-join (через `browser--get_network_request_details`);
- raw request body второго heartbeat;
- скрин Application → Session Storage до/после;
- скрин Network panel с двумя запросами.

Если все 5 пунктов зелёные → M2 переводится из `deferred` в `accepted`.

---

## 3. Перевыпуск closing report Этапа 1

После clean M2 proof выпустить новый отчёт со строгой структурой (4 секции, без смешения):

1. **Что подтверждено живыми скриншотами/UI**
  - M1.1 (5 mobile screenshots).
  - M1.2 (sticky video после scroll-away header).
  - Desktop regression (2 screenshots).
2. **Что подтверждено только кодом / network**
  - M2 entry_path hint (raw network bodies + sessionStorage скрин).
  - removeItem после успешного soft-join.
3. **Что не подтверждено**
  - DOM numeric proof (`getBoundingClientRect`, computed styles) — ограничение browser tool. Помечается как `not confirmed by tooling`, а не `accepted`.
4. **Что отложено в follow-up**
  - iOS standalone safe-area / notch fix (см. секцию 4).
  - Screen Wake Lock во время видео (см. секцию 5).
  - M3 analytics (`live_view_sessions`, sweeper, admin-вкладка).

Финальная строка статуса (один из трёх): `accepted` / `not accepted` / `deferred`.
`proof artifacts saved = yes/no`.

---

## 4. PATCH: iOS standalone safe-area / notch fix (отдельный)

### Проблема

В режиме PWA / "Add to Home Screen" на iOS контент уезжает под notch и верхний safe-area. В обычном Safari отображается корректно.

### Изменения

- `index.html`: проверить `<meta name="viewport" content="..., viewport-fit=cover">`. Если `viewport-fit=cover` отсутствует — добавить.
- `index.html`: убедиться, что есть `<meta name="apple-mobile-web-app-capable" content="yes">` и `apple-mobile-web-app-status-bar-style` (например, `black-translucent`).
- `src/index.css` (или `src/components/live/liveRoomTheme.css`): для mobile header (`[data-mobile-header]`) и sticky main (`[data-mobile-sticky-main]`) добавить:
  - `padding-top: env(safe-area-inset-top)` — header.
  - `padding-bottom: env(safe-area-inset-bottom)` — composer (`.room-composer`), чтобы home indicator не перекрывал input.
- Использовать `100dvh` (уже применено) — проверить корректность с safe-area в standalone.

### DoD

- В PWA standalone режиме на iOS header не уезжает под notch.
- Composer не перекрывается home indicator.
- В обычном Safari (`display-mode: browser`) — без регрессии: header/composer на тех же позициях, что сейчас.
- Desktop — без изменений.

### Proof

- Скриншоты iOS standalone (после Add to Home Screen) до/после фикса.
- Скриншоты Safari mobile до/после (доказать отсутствие регрессии).

---

## 5. PATCH: Screen Wake Lock во время вебинара (отдельный)

### Проблема

Во время просмотра live-эфира экран телефона гаснет / устройство блокируется по таймауту, что прерывает просмотр.

### Изменения

- Создать новый хук `src/hooks/useScreenWakeLock.ts`:
  - Проверка `'wakeLock' in navigator` — если нет, тихий no-op (no throw).
  - `navigator.wakeLock.request('screen')` при `enabled === true`.
  - Re-acquire на `document.visibilitychange` (когда вкладка снова видима) — Wake Lock автоматически освобождается при backgrounding.
  - Release при `enabled === false`, при unmount, и при уходе со страницы.
  - Все ошибки логировать в console, не падать.
- Подключение в `src/pages/LiveEvent.tsx`:
  - Активировать `useScreenWakeLock(enabled)` где `enabled = isLive || isWaitingRoomOpen` (только когда есть смысл смотреть).
  - НЕ активировать в `ended` / `replay` состояниях — пользователь сам решает, когда уйти.

### DoD

- Во время просмотра видео экран не гаснет на поддерживаемых браузерах (Chrome Android, Safari iOS 16.4+).
- При уходе со страницы / закрытии вкладки lock освобождается.
- В неподдерживающих браузерах функциональность отсутствует, но ошибок в console нет.
- Вкладка в фоне → возврат → wake lock переактивируется.

### Proof

- Console log: `[wake-lock] acquired` при входе в эфир, `[wake-lock] released` при уходе.
- Тест на Android Chrome / iOS Safari (manual, описать в отчёте по PATCH).
- Скриншот network/console без ошибок в Firefox или старом Safari (fallback).

---

## 6. Последовательность исполнения

1. **Сейчас (default mode):** clean M2 proof-прогон в свежей сессии (только browser tool, без code-правок).
2. **После M2 proof:** перевыпуск closing report Этапа 1 с правильными статусами.
3. **После closing report:**
  - PATCH iOS safe-area (отдельный план + execute + proof).
  - PATCH Wake Lock (отдельный план + execute + proof).
4. **Только после двух PATCH** — старт Этапа 2 (M3 analytics).

## 7. Stop-rules

- НЕ закрывать Stage 1 пока M2 не `accepted`.
- НЕ начинать M3 до closing report Stage 1.
- НЕ объединять iOS safe-area и Wake Lock в один PATCH — это разные домены.
- НЕ смешивать в отчёте «подтверждено UI» и «подтверждено только кодом».
- НЕ трогать desktop layout, M1.1, composer, `.room-messages-scroll`.