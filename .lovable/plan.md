# да, согласен, с учетом правок:

&nbsp;

1. **Не создавать новый wrapper, если можно обойтись без лишней сущности.**
  Сначала проверить, можно ли вынести общий layout-switch в уже существующий pricing-layer без размножения компонентов. Новый TariffCarouselGrid.tsx допустим только если это реально самый чистый reuse-вариант и он будет использоваться **и в public, и в admin preview** без дублей.
2. **В admin preview и public должен быть один и тот же режим переключения.**
  Условие строго одинаковое:
  &nbsp;
  - <= 3 активных тарифов → grid
  - >= 4 активных тарифов → carousel
    Без расхождения логики между preview и боевым сайтом.
  &nbsp;
3. **Не оборачивать карточки по-разному в двух местах.**
  Один и тот же render-path для списка карточек:
  &nbsp;
  - одинаковый TariffCard
  - одинаковый расчет active tariffs
  - одинаковый layout decision
    Нельзя, чтобы admin preview был “похож”, а public рендерился иначе.
  &nbsp;
4. **Нужно явно зафиксировать equal-height поведение карточек.**
  В карусели карточки не должны прыгать по высоте так, чтобы CTA-кнопки оказывались на разном уровне и ломали визуальный ряд. Добавить guard на выравнивание карточек по высоте внутри carousel mode.
5. **Проверить стрелки на реальную видимость и кликабельность во всех viewport.**
  Особенно:
  &nbsp;
  - desktop
  - tablet
  - mobile
    На mobile допустимо скрыть стрелки и оставить swipe/snap, если так UX чище. Но это надо явно зафиксировать, а не оставлять случайно.
  &nbsp;
6. **Нужен guard на малое количество карточек в carousel mode.**
  При 4 карточках:
  &nbsp;
  - desktop не должен выглядеть “сломано” или пусто,
  - последняя прокрутка не должна оставлять странные обрезанные зоны,
  - scroll/align должен быть предсказуемым.
  &nbsp;
7. **AnimatedSection / анимации не должны ломать carousel.**
  Если сейчас grid использует анимационные обертки, нужно либо:
  &nbsp;
  - безопасно сохранить их в carousel,
  - либо отключить именно там, если они конфликтуют с Embla.
    Нельзя тянуть анимации ценой нестабильного скролла.
  &nbsp;
8. **Нужен DoD на keyboard / touch / mouse.**
  Минимально проверить:
  &nbsp;
  - swipe на mobile,
  - mouse drag / arrows на desktop,
  - отсутствие сломанного focus у CTA-кнопок внутри карточек.
  &nbsp;
9. **Нужен verify не только для admin preview, но и для реального public URL.**
  В отчете должны быть скрины:
  &nbsp;
  - admin preview: 3 тарифа → grid
  - admin preview: 4+ тарифа → carousel
  - public page: 3 тарифа → grid
  - public page: 4+ тарифа → carousel
  - mobile / tablet / desktop
  &nbsp;
10. **Не трогать TariffCard и pricing logic без необходимости.**
  Если реализация внезапно требует менять внутренности TariffCard, offers, checkout-flow или selection logic — остановиться и вернуться с explain/guard-report, а не расширять scope.

&nbsp;

&nbsp;

Plan: Pricing Section Carousel for 4+ Tariffs

## Scope

Two rendering points need the grid/carousel switch:

1. **Public**: `src/components/landing/UniversalPricingSection.tsx` (lines 117-132) — grid layout for tariff cards
2. **Admin preview**: `src/pages/admin/AdminProductDetailV2.tsx` (lines 1143-1160) — preview grid

Both use the same `TariffCard` component. No new card component needed.

## Approach

### New shared component: `TariffCarouselGrid`

Create `src/components/landing/TariffCarouselGrid.tsx` — a wrapper that:

- Accepts `children` (rendered TariffCard elements) and `count` (number of tariffs)
- If `count <= 3`: renders current grid layout (grid-cols-1/2/3 based on count)
- If `count >= 4`: renders Embla carousel using existing `Carousel`, `CarouselContent`, `CarouselItem`, `CarouselPrevious`, `CarouselNext` from `src/components/ui/carousel.tsx`

Carousel config for 4+:

- **Desktop** (≥1024px): `slidesToScroll: 1`, CSS `basis-1/3` per item → 3 visible cards + arrows
- **Tablet** (≥768px, <1024px): `basis-1/2` → 2 visible cards
- **Mobile** (<768px): `basis-full` → 1 card, swipe/snap native via Embla

The wrapper handles only layout. No pricing/offer/checkout logic inside.

### File changes


| File                                                 | Change                                                                 |
| ---------------------------------------------------- | ---------------------------------------------------------------------- |
| `src/components/landing/TariffCarouselGrid.tsx`      | **NEW** — shared grid/carousel wrapper                                 |
| `src/components/landing/UniversalPricingSection.tsx` | Replace grid div (lines 117-132) with `<TariffCarouselGrid>`           |
| `src/pages/admin/AdminProductDetailV2.tsx`           | Replace preview grid div (lines 1143-1160) with `<TariffCarouselGrid>` |


### Technical details

```tsx
// TariffCarouselGrid.tsx — pseudocode
function TariffCarouselGrid({ children, count }) {
  if (count <= 3) {
    return (
      <div className={gridClasses(count)}>
        {children mapped with AnimatedSection}
      </div>
    );
  }
  
  return (
    <Carousel opts={{ align: "start", loop: false }}>
      <CarouselContent className="-ml-4">
        {children mapped into CarouselItem with responsive basis classes}
      </CarouselContent>
      <CarouselPrevious />
      <CarouselNext />
    </Carousel>
  );
}
```

Responsive basis via Tailwind: `basis-full md:basis-1/2 lg:basis-1/3` on each `CarouselItem`.

Arrow positioning: override default `-left-12`/`-right-12` to be visible within container bounds (e.g., `-left-4 -right-4` or below the carousel on mobile).

### What is NOT changed

- `TariffCard` component — untouched
- `PaymentDialog` / offer selection / auth redirect — untouched
- Business logic in `handleSelectOffer` — untouched
- `usePublicProduct` / edge functions — untouched

### Stop-guard

If Embla carousel requires any changes to TariffCard internals or pricing logic, stop and reassess.

### Verification plan

After implementation: take screenshots at desktop/tablet/mobile for both 3-tariff (grid) and 4+ tariff (carousel) scenarios in admin preview.