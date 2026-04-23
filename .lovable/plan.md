да, согласен, с учетом правок:

1. **Не использовать IntersectionObserver как основной путь.**  
Сначала сделать **CSS-only fix**:
  - убрать padding-top: env(safe-area-inset-top) с [data-mobile-sticky-main];
  - для standalone задать sticky-main:
    - top: env(safe-area-inset-top);
    - height: calc(100dvh - env(safe-area-inset-top)).
2. Это лучше, чем JS-класс header-collapsed: safe-area применяется только когда sticky-main реально прилипает, без двойного верхнего резерва в initial high-state.
3. **index.html не использовать как точку изменений, если meta уже приняты и дали device-proof.**  
viewport-fit=cover и текущий standalone meta уже были подтверждены.  
В этом PATCH их только **проверить**, но **не менять**.
4. **Header safe-area не трогать.**  
Принятый fix для [data-mobile-header] оставить как есть.  
Исправление должно касаться только [data-mobile-sticky-main], иначе есть риск сломать уже принятый notch-fix.
5. **Добавить проверку flex-chain, а не лечить проблему только padding-ом.**  
В plan явно включить:
  - проверить всех родителей .room-messages-scroll;
  - убедиться, что у нужных контейнеров есть min-h-0;
  - если после правки sticky-main чат всё ещё не дотягивается вниз, чинить именно height/min-height/flex budget, а не просто увеличивать padding-bottom.
6. **Жёстко ограничить scope только iOS standalone.**  
Правки:
  - @media (max-width: 1023px) and (display-mode: standalone);
  - fallback [html.is](http://html.is)-ios-standalone.
7. Обычный Safari browser mode не трогать вообще.
8. **JS fallback оставить только как запасной вариант.**  
Если после CSS-only варианта останется gap или chat reachability всё ещё сломана, тогда уже отдельным follow-up внутри этого PATCH разрешить вариант с классом header-collapsed. Но это не должно быть первым решением.
9. **Acceptance дополнить одним обязательным пунктом.**  
В iOS standalone initial high-state нужно проверить не только “нет gap”, но и:
  - video-shell полностью виден;
  - **последнее сообщение полностью открывается над composer**;
  - после collapsed-state **не появляется новый gap под status bar**.
10. **Что не трогать зафиксировать отдельно.**  
Не менять:
  - M1.1 / M1.2;
  - composer fixed behavior;
  - Wake Lock;
  - reactions overlay;
  - desktop layout;
  - entry tracking / token flow.

Итог: сам вектор плана правильный, но основной фикс лучше делать **через top + height calc на sticky-main в standalone**, а не через IntersectionObserver как первичный механизм.

&nbsp;

# План: PATCH — iOS standalone high-state top gap + chat reachability

## Проблема (точная локализация)

Файл `src/index.css` (строки 205-226) применяет `padding-top: env(safe-area-inset-top)` к `[data-mobile-sticky-main]` **безусловно** при `display-mode: standalone`. Аналогично fallback через `html.is-ios-standalone` (строки 231-235).

Но `[data-mobile-sticky-main]` — это **flow-элемент в начальном high-state** (до того как пользователь свернул header скроллом) и приклеивается к `top:0` только ПОСЛЕ ухода header за viewport. Поэтому в initial state получается:

1. Header (`pt-1.5` + safe-area-inset-top через `html.is-ios-standalone [data-mobile-header]`, строка 199-202) — уже учитывает notch.
2. Sticky main НИЖЕ header'а получает ЕЩЁ один `padding-top: env(safe-area-inset-top)` — создаёт **лишнюю пустую зону ~44-59px** между header и video-shell.
3. Из-за `h-[100dvh]` + двойной верхний резерв высоты не хватает контейнеру чата → последнее сообщение уходит под composer и недостижимо.

После ручного scroll-away header'а sticky main приклеивается к `top:0` под notch — и тогда этот же padding-top становится ЛЕГИТИМНЫМ (видео не под челкой). Это и объясняет, почему «после сдвига video вверх всё работает».

## Решение

Безусловный `padding-top` на sticky-main → условный, применяется **только** когда элемент реально приклеен (`position: sticky` активен в липком состоянии). Так как CSS не умеет детектировать «stuck-state», используем альтернативный подход:

**Перенести safe-area-inset-top с `[data-mobile-sticky-main]` на `[data-mobile-header]**` — header уже учитывает safe-area, sticky main НЕ должен дублировать. Когда header уезжает за viewport, его pull-up поведение естественно прячет padding под viewport, и sticky-main приклеивается к top:0 — но top:0 в iOS standalone уже за пределами status-bar (viewport начинается под notch в standalone-режиме при правильной настройке viewport-fit).

Однако `viewport-fit=cover` (если включён) делает viewport равным физическому экрану и тогда `top:0` = под notch. Нужно проверить `index.html` viewport meta. Если `viewport-fit=cover` НЕ задан — top:0 уже корректен и safe-area-inset-top не нужен на sticky-main вообще.

### Шаги

**1. `index.html**` — проверить viewport meta. Если `viewport-fit=cover` стоит — это и есть причина, почему `top:0` уходит под notch в standalone.

**2. `src/index.css**` (строки 205-235):

- УБРАТЬ `padding-top: env(safe-area-inset-top)` с `[data-mobile-sticky-main]` (и в `@media display-mode: standalone`, и в `html.is-ios-standalone` fallback).
- Вместо этого применить safe-area-inset-top к `[data-video-shell]` ТОЛЬКО когда родительский header УШЁЛ — что невозможно в чистом CSS. Поэтому используем правильное решение: оставляем `top:0` для sticky-main и компенсируем notch через **CSS scroll-margin / IntersectionObserver-driven класс**.

Финальный подход (минимально инвазивный):

- В `src/pages/LiveEvent.tsx` добавить `useEffect` с IntersectionObserver на `[data-mobile-header]`. Когда header выходит из viewport → ставим класс `header-collapsed` на sticky-main контейнер.
- В `src/index.css` правило `padding-top: env(safe-area-inset-top)` на `[data-mobile-sticky-main]` применять ТОЛЬКО при наличии класса `.header-collapsed`.

**3. `src/components/live/liveRoomTheme.css**` — перепроверить bottom padding `.room-messages-scroll` остаётся достаточным после освобождения верхнего резерва (возможно, +16-24px доп. под composer, если выяснится недостача).

## Acceptance criteria

A. iOS standalone initial high-state:

- Нет лишней пустой зоны между header и video-shell.
- Чат докручивается до последнего сообщения, последнее сообщение полностью видно над composer.

B. iOS standalone после scroll-away header:

- Status-bar не накладывается на video-shell (safe-area-inset-top активируется через `.header-collapsed`).
- Scroll isolation сохранён, composer на месте.

C. Safari mobile browser mode:

- Без регрессии (`html.is-ios-standalone` отсутствует, IntersectionObserver класс не влияет, ибо `padding-top` правило scoped под `display-mode: standalone`).

D. Desktop:

- Не затронут (всё под `@media (max-width: 1023px)`).

## Файлы к изменению

1. `src/pages/LiveEvent.tsx` — добавить IntersectionObserver хук на `[data-mobile-header]` для управления классом `.header-collapsed` на `[data-mobile-sticky-main]`.
2. `src/index.css` — переписать правило safe-area-inset-top: применять к `[data-mobile-sticky-main]` ТОЛЬКО при `.header-collapsed`.
3. `index.html` — verify viewport meta (без изменений, если уже корректно).

## Что НЕ трогаем

- Desktop layout, M1.1, M1.2, M2, composer behavior.
- Wake Lock hook.
- Reactions overlay.
- Token flow, access logic, entry tracking.
- liveRoomTheme.css `.room-composer` mobile fixed правила.

## Proof-пакет (после execute)

Только device-based на iPhone PWA + Safari:

1. iOS standalone initial high-state — нет gap сверху.
2. iOS standalone scroll до последнего сообщения чата.
3. iOS standalone после collapsed-state — video не под notch.
4. Safari browser mode — без регрессии.

После approve — переключаюсь в default mode и применяю PATCH.