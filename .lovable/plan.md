да, согласен, с учетом правок:

1. **58svh из плана убери.**  
Это значение почти наверняка ничего не изменит: текущий video-shell на iPhone уже визуально ниже этого порога.  
В плане зафиксируй так:  
**«ограничить mobile top media stack более жёстко, стартовое значение подбирать в диапазоне 36–40svh, а не 58svh»**.
2. **Ограничение вешать не вслепую на data-video-shell, а на тот wrapper, который реально съедает высоту.**  
Если data-video-shell = только чёрное видео, а reactions bar идёт отдельным sibling, то budget надо считать **вместе с reactions bar**, иначе composer всё равно может не влезть.
3. **Acceptance дополни двумя обязательными пунктами:**
  - в initial high-state **полностью видны** composer и **нижние скругления** chat panel;
  - последнее сообщение **полностью читается над composer**, без ощущения, что низ панели “обрезан”.
4. **Proof-пакет зафиксируй отдельно для 4 состояний:**  

  - Safari initial high-state;
  - Safari after collapse header;
  - PWA standalone initial high-state;
  - PWA standalone after collapse header.  
  Плюс один desktop regression screenshot.
5. **Stop-guard явно допиши:**
  - не трогать текущую логику composer;
  - не откатывать 100svh;
  - не возвращать fixed-gap хаки;
  - менять только высотный budget верхнего media stack.

&nbsp;

Итог: сам подход верный, но **ключевая правка — убрать 58svh и заменить на реальный рабочий cap для mobile top stack**. Без этого план может пройти, а визуально не поменяется вообще.

&nbsp;

# План: PATCH K2.1 — chat panel reachability в initial high-state

## Проблема (точная локализация)

`src/pages/LiveEvent.tsx:679` — `data-mobile-sticky-main` на mobile имеет `max-lg:h-[100svh]`. В initial high-state ВНУТРИ этой sticky-области последовательно расположены flex-column'ом:

1. Header-spacer (`Тест Сергей … LIVE … Эфир …`)
2. `data-video-shell` (video + reactions bar) — `shrink-0`, занимает ~50–55% высоты
3. Card chat-panel (`flex-1`)

При `100svh` суммарной высоты не хватает: video + reactions + tabs + ~5 сообщений + composer не помещаются. Card получает `flex-1` от остатка → его нижняя часть (composer) уезжает за нижний край viewport. Видны только верхние скругления input — это и есть симптом со скрина IMG_3691.

После collapse header'а sticky-main приклеивается к `top:0` под notch — высоты становится достаточно, всё видно (IMG_3692).

## Решение

Card chat-panel должна иметь **гарантированный нижний край внутри viewport** даже в initial high-state. Два варианта:

**Вариант A (минимальный, рекомендуемый):** ограничить высоту video-shell на mobile через `max-height`, чтобы Card chat-panel всегда получала минимум ~40% viewport под себя.

- В `LiveEvent.tsx:681` добавить mobile-only style для `data-video-shell`: `max-h-[55svh]` или `max-h-[50svh]`. Видео сжимается пропорционально (aspect-video сохраняется через player), reactions bar остаётся, Card получает оставшуюся высоту — composer виден без скролла.

**Вариант B:** дать Card явный `min-height` на mobile, чтобы flex выжимал из video-shell остаток.

- `min-h-[40svh]` на Card (`LiveEvent.tsx:736`). Менее предсказуемо при разных aspect ratios видео.

Выбираю **Вариант A** — он управляет именно той частью, которая «съедает» высоту (video + reactions), и не ломает desktop (правило scoped через `max-lg:`).

## Изменения

`**src/pages/LiveEvent.tsx:681**` — добавить `max-lg:max-h-[58svh]` к `data-video-shell` className. 58svh = video (aspect-video на 518px ширине ≈ 290px) + reactions bar (50px) + room blocks (если есть). Card получит ≥42svh — этого хватает на tabs + 3-4 сообщения + composer.

## Acceptance criteria

A. iPhone Safari, initial high-state (header виден):

- Card chat-panel полностью в viewport: видны tabs, последние сообщения, composer и нижние скругления панели.
- Без скролла страницы.

B. iPhone Safari, после collapse header:

- Layout не «прыгает», video не растягивается сверх 58svh, Card получает чуть больше высоты — нормально.

C. PWA standalone iPhone: то же поведение, safe-area/notch fix не сломан.

D. Desktop: без изменений (`max-lg:` префикс).

## Что НЕ трогаем

- `useVisualViewportInset`, K1/K2/K3/K4 fixes уже применены.
- iOS standalone safe-area / notch (`index.css`).
- Wake Lock, M1.1, M1.2, M2, entry tracking, access logic.
- Composer flex behavior, `100svh` на sticky-main.

## Файлы к изменению

1. `src/pages/LiveEvent.tsx` — одна строка (681): добавить `max-lg:max-h-[58svh]` к `data-video-shell`.

## Proof-пакет (после execute)

iPhone Safari + PWA standalone:

1. Initial high-state — chat panel целиком в viewport, нижние скругления видны.
2. После collapse header — layout стабилен.
3. Desktop — без регрессии.