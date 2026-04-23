да, согласен, с учетом правок:

1. **K1 и K2 делать одним PATCH, но фиксировать отдельно в отчёте.**  
В отчёте должны быть отдельные статусы:  

  - K1 keyboard gap
  - K2 white tail / rounded bottom  
  Не смешивать их в один общий “mobile input fix”.
2. **По K1 сначала убрать двойной резерв, не трогая формулу useVisualViewportInset.**  
Приоритет такой:
  - убрать safe-area из внутреннего paddingBottom composer;
  - убрать vv-offset из padding-bottom у .room-messages-scroll;
  - только если после этого gap останется — уже пересматривать сам vv-offset baseline.  
  То есть useVisualViewportInset сейчас не переписывать первым действием.
3. **По K2 держать решение минимальным.**  
Сначала:
  - убрать белый хвост через корректный padding-bottom;
  - сделать видимые нижние скругления панели;
  - отделить конец panel от fixed composer визуально.  
  ::after/декоративные накладки добавлять только если без них нельзя получить чистый вид.
4. **По K3 в плане зафиксировать не только pointer-events, но и проверку состояний.**  
Нужно проверить отдельно:
  - state=live с реальным video source;
  - нет ли поверх player остаточного waiting/source overlay;
  - нет ли preventDefault / gesture interception на mobile ancestors;
  - controls/fullscreen/quality открываются именно по tap в Safari и в PWA standalone.  
  Если в каком-то состоянии source ещё не готов, это нужно явно отразить в proof, а не считать fail без разведения по state.
5. **По K4 добавить guard на восстановление caret.**  
В LiveAutoGrowTextarea восстанавливать selectionStart/selectionEnd только если:
  - textarea всё ещё в фокусе;
  - значение не изменилось гонкой;
  - браузер поддерживает selection API без exception.  
  Иначе можно получить новый iOS-баг.
6. **Proof-пакет сделать сразу в двух средах: Safari + PWA standalone.**  
Для каждой среды отдельно:
  - keyboard open;
  - bottom of chat;
  - tap on video / controls;
  - keyboard close after input.  
  Без этого PATCH не считать принятым.
7. **Wake Lock не смешивать с этим PATCH.**  
Его статус оставить как:
  - code patched
  - device-proof pending  
  И спринт не закрывать, пока нет:
  - K1 accepted
  - K2 accepted
  - K3 accepted
  - K4 accepted
  - Wake Lock device-proof
8. **T1 отдельно не трогать, но в финальном отчёте дать строку:**  
T1 checked / no code changes required.

&nbsp;

Если присылают уже обновлённый план на этот PATCH, следующий ответ должен идти только как сверка внесения этих правок.

&nbsp;

Правки подтверди сразу скринами  в режиме симуляции все сделай и исправь все баги сразу  

&nbsp;

# План: PATCH K1+K2+K3+K4 — финальное закрытие mobile спринта

## K1 — keyboard gap (двойной safe-area резерв)

**Root cause:** в `LiveEventComments.tsx:335` (и аналогично в `LiveEventQuestions.tsx`) внутренний div composer имеет `paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))'`. При открытой клавиатуре composer уже привязан к visualViewport через CSS `.room-composer { bottom: max(safe-area, vv-offset) }` — этот внешний bottom поднимает composer на высоту клавиатуры. Но внутренний `padding-bottom: env(safe-area-inset-bottom)` (~34px на iPhone X+) добавляется СВЕРХУ → визуальная высота composer растёт, между ним и клавиатурой образуется зазор ~34px (видно как чёрная полоса на IMG_3685).

**Fix:**

- В `LiveEventComments.tsx` и `LiveEventQuestions.tsx` заменить `paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))'` на `padding: 0.75rem` без safe-area. Safe-area уже учтён через `.room-composer { bottom: max(env(safe-area-inset-bottom), var(--room-vv-bottom-offset)) }` на внешнем wrapper'е.

## K2 — white tail после последнего сообщения

**Root cause:** `.room-messages-scroll` `padding-bottom = composer-h + safe-area + vv-offset + 32px`. При открытой клавиатуре vv-offset ≈ 340px → внутри scroll-area образуется белый хвост ~470px. После исчезновения клавиатуры он остаётся пока offset не вернётся в 0. Кроме того, при keyboard open scroll-area уже визуально не «дотягивает» до composer (он fixed по vv-offset), доп. резерв в высоту клавиатуры избыточен.

**Fix в `liveRoomTheme.css`:**

- Убрать `var(--room-vv-bottom-offset)` из `padding-bottom` `.room-messages-scroll`. Композер при keyboard open поднимается, scroll-area сама уже «уходит» под composer на ту же высоту — keyboard область не мешает доскроллу. Остаётся: `padding-bottom: calc(var(--room-composer-h, 64px) + env(safe-area-inset-bottom, 0px) + 24px)`.
- Добавить `.room-panel` (Card-обёртка): `border-radius: 0.5rem; overflow: hidden;` чтобы скругления видны и сверху и снизу. На mobile, где composer fixed (вне Card), нижняя граница панели визуально совпадает с верхним краем composer — добавить sentinel: `.room-panel::after` с тонкой нижней границей color-mix accent для визуальной завершённости панели.
- Альтернатива (надёжнее): на mobile дать `.room-panel` явный `margin-bottom: calc(var(--room-composer-h, 64px) + env(safe-area-inset-bottom, 0px))` чтобы Card физически заканчивался ВЫШЕ composer и его `rounded-lg` (нижние скругления) был виден.

## K3 — video surface не кликабелен

**Root cause (наиболее вероятный):** `data-mobile-sticky-main` имеет `max-lg:overflow-hidden` (строка 679). На iOS внутри `position: sticky; overflow: hidden` parent'а cross-origin iframe controls могут не получать первый tap из-за gesture interception. Дополнительно — `LiveRoomReactionsOverlay` имеет `z-20` поверх player, и хотя на root `pointer-events: none`, дочерний `<style>` блок и span'ы с `reaction-float` НЕ имеют явного `pointer-events: none` (наследуют, должно работать) — но Safari иногда нарушает наследование при `display: inline-flex` — добавить явно.

**Fix:**

- `LiveRoomReactionsOverlay.tsx`: добавить явное `pointer-events: none` на каждый `<span class="reaction-float">` через class или style.
- `LiveEvent.tsx:683` обёртка `<div className="relative">` — убедиться что НЕТ перекрытий. Если в state=live по факту overlay активен — добавить debug: проверить через `browser--observe` после деплоя.
- Если проблема не в overlay — на mobile у `data-video-shell` добавить `pointer-events: auto; touch-action: manipulation` для гарантии.

## K4 — caret теряется при вводе

**Root cause:** `recalc()` в `LiveAutoGrowTextarea.tsx:32` ставит `el.style.height = "auto"` потом `scrollHeight` → DOM перерисовка во время ввода. При перерасчёте высоты на iOS курсор может «прыгать» на начало или теряться, особенно когда composer одновременно репозиционируется visualViewport.

**Fix:**

- В `recalc()` сохранять `selectionStart/End` ДО ресайза и восстанавливать после.
- Добавить early-return если новая высота совпадает с текущей — не трогать `style.height` если не нужно.

## Файлы к изменению

1. `src/components/live/liveRoomTheme.css` — убрать vv-offset из messages-scroll padding, добавить .room-panel border-radius + margin-bottom mobile.
2. `src/components/live/LiveEventComments.tsx:335` — убрать дублирующий safe-area padding-bottom.
3. `src/components/live/LiveEventQuestions.tsx` — то же.
4. `src/components/live/LiveRoomReactionsOverlay.tsx` — явные pointer-events:none на детях.
5. `src/components/live/LiveAutoGrowTextarea.tsx` — сохранять caret position при recalc.

## Что НЕ трогаем

- `useVisualViewportInset.ts` — формула корректна, проблема была в потребителях.
- iOS standalone safe-area / notch fix в `index.css`.
- Wake Lock, M1.1, M1.2, M2, entry tracking, access logic, desktop layout.
- Submit-логика comments/questions.

## Acceptance criteria

A. Safari iPhone, keyboard open:

- Composer вплотную над клавиатурой (без чёрной полосы).
- После последнего сообщения нет белого хвоста.
- Каретка стабильна при вводе.
- Tap по video открывает Kinescope controls / fullscreen.

B. PWA standalone iPhone: те же 4 проверки + safe-area/notch fix не сломан.

C. Keyboard close: composer возвращается к нижнему краю с safe-area, white tail не появляется, layout стабилен.

D. Desktop: без регрессии (все правки scoped под `@media (max-width: 1023px)` или нейтральны).

## Proof-пакет (после execute)

- Safari: 3 скрина (keyboard open / chat bottom / video controls).
- PWA standalone: те же 3 скрина.
- Normal state after keyboard close.
- Финальный отчёт на русском: changed files, diff-summary, что подтверждено в Safari, что в standalone, что не тронуто.