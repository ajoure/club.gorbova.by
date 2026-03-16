# да, согласен, с учетом правок:

&nbsp;

1. **basis-[38%] на desktop слишком агрессивно.**
  Зафиксируй не “магическое число”, а целевой UX:
  &nbsp;
  - desktop: видно **2 полных + peek следующей**
  - tablet: видно **1–2 + peek**
  - mobile: **1 + peek**
    И проверь, чтобы CTA и длинные тексты не начинали визуально ломать карточки. Иначе лучше чуть консервативнее, чем 38%.
  &nbsp;
2. **Нужен guard на ultra-wide desktop.**
  Ты правильно убираешь max-w, но зафиксируй:
  &nbsp;
  - carousel не должен растягиваться в бесконечную ленту на широких экранах,
  - нужен разумный container width / padding strategy,
  - peek должен оставаться читаемым и красивым, а не исчезать из-за слишком широкого viewport.
  &nbsp;
3. **Dots должны быть не “просто активными”, а реально привязаны к Embla API.**
  Добавь в план явно:
  &nbsp;
  - cleanup listeners,
  - reInit handling,
  - корректное обновление selectedIndex при resize / reflow.
    Иначе dots часто ломаются после изменения viewport.
  &nbsp;
4. **Стрелки — только если реально есть куда листать.**
  Не просто “hidden on mobile”, а:
  &nbsp;
  - на desktop/tablet скрывать disabled state полностью или делать неактивными явно,
  - не допускать наложения стрелок на карточки и CTA,
  - проверить кликабельность поверх контента.
  &nbsp;
5. **Нужен явный визуальный affordance, но без мусора.**
  Peek — да.
  Но добавь правило:
  &nbsp;
  - не использовать слишком сильные тени/градиенты/оверлеи, которые спорят с самими карточками.
    Главный акцент должен оставаться на тарифах, а не на chrome карусели.
  &nbsp;
6. **Equal-height guard оставить, но проверить не только wrapper, а и сам track.**
  Нужно явно проверить:
  &nbsp;
  - карточки одинаковой высоты,
  - CTA по нижней линии не скачут,
  - при длинном описании carousel не начинает “ломать” высоту соседних слайдов.
  &nbsp;
7. **Нужен verify и для public, и для admin preview.**
  Поскольку меняется shared wrapper, надо прислать:
  &nbsp;
  - public desktop/tablet/mobile,
  - admin preview desktop/mobile,
  - dots + arrows,
  - peek effect,
  - 3 тарифа = grid,
  - 4+ тарифа = carousel.
  &nbsp;
8. **Не трогать TariffCard и бизнес-логику — оставить как жесткий stop-guard.**
  Если вдруг для visual fix потребуется менять внутренности карточки, checkout flow или pricing logic — остановиться и не расширять scope.
9. **Добавь отдельный DoD на “carousel unmistakably readable”.**
  То есть после правки должно быть сразу понятно, что это листаемая секция, без объяснений. Сейчас это главная цель патча.

&nbsp;

&nbsp;

В целом направление правильное. Этот PATCH уже можно отдавать в работу.

&nbsp;

PATCH: Carousel Visual Quality Upgrade

## Problem

Current carousel is technically working (Embla mounts, slides exist) but visually indistinguishable from a grid:

- No peek/overflow hint showing next slide exists
- Arrows are tiny (h-8 w-8) and buried at edges
- No active dot indicators tracking position
- `max-w-5xl` constrains the viewport so all 4 cards fit without scrolling on wide screens
- No visual cue that the section is scrollable

## Fix — Single file change: `TariffCarouselGrid.tsx`

All changes are in the shared wrapper. No changes to TariffCard, UniversalPricingSection, AdminProductDetailV2, or any business logic.

### 1. Peek effect (visible overflow hint)

Use Embla's `containScroll: "trimSnaps"` + adjust slide basis so the next card peeks ~15% on desktop:

```
Desktop: basis-[38%] (≈2.6 visible → 3rd card peeks)
Tablet: basis-[48%] (2 visible + peek)  
Mobile: basis-[85%] (1 visible + peek of next)
```

This immediately communicates "there's more to scroll."

### 2. Better arrows

- Larger: `h-10 w-10` with proper shadow
- Positioned just inside the container edges with semi-transparent background
- Hidden when can't scroll in that direction (already handled by Embla)
- Hidden on mobile (swipe is primary UX)

### 3. Active dot indicators

Replace static dots with Embla-connected active dots:

- Use `api.on('select')` to track `selectedScrollSnap()`
- Active dot gets `bg-primary` + scale, others get `bg-muted-foreground/30`
- Visible on all viewports, primary navigation on mobile

### 4. Remove max-w constraint in carousel mode

Switch from `max-w-5xl` to full container width with horizontal padding, so Embla actually has room to create a scrolling viewport instead of fitting everything in view.

### 5. Equal-height guard preserved

Keep existing `[&>*]:h-full [&>*]:flex [&>*]:flex-col` on slide wrappers.

## Files


| File                                            | Change                                                      |
| ----------------------------------------------- | ----------------------------------------------------------- |
| `src/components/landing/TariffCarouselGrid.tsx` | Rewrite carousel mode with peek, better arrows, active dots |


No other files change. Both `UniversalPricingSection` and `AdminProductDetailV2` consume `TariffCarouselGrid` unchanged.