# да, согласен, с учетом правок:

&nbsp;

1. **PATCH A править, PATCH B не трогать кодом.**
  Если по PATCH B код уже внедрен, не надо сейчас смешивать это с визуальной доработкой carousel. Для PATCH B нужен только verify с пруфами.
2. **items-center вместо items-stretch — спорное решение.**
  Это может убрать ощущение “сжатости”, но создаст новую проблему:
  &nbsp;
  - карточки станут разной высоты,
  - CTA поедут по вертикали,
  - визуальный ряд станет менее аккуратным.
    Я бы не согласовывал это как основной фикс без пруфа.
  &nbsp;
3. **Сначала смягчить визуальное сжатие без отказа от equal-height.**
  Более безопасный порядок:
  &nbsp;
  - увеличить vertical breathing room,
  - ослабить scale inactive cards,
  - увеличить gap,
  - проверить overflow/shadow/badge space,
  - и только если этого недостаточно — рассматривать отказ от items-stretch.
  &nbsp;
4. **Scale действительно нужно ослабить.**
  Это правильная правка. Слишком сильное уменьшение боковых карточек и создает ощущение, что их “сплющили”.
5. **py-6 и больший gap — да.**
  Это логично и безопасно для visual polish.
6. **Если оставляете equal-height, проверить реальный длинный контент.**
  Нужен кейс:
  &nbsp;
  - короткая карточка,
  - длинная карточка,
  - карточка с badge,
  - карточка с длинным списком/описанием.
    И только после этого решать, нужен ли items-center.
  &nbsp;
7. **PATCH B — только доказать.**
  Раз код уже есть, сейчас не нужен новый план на реализацию. Нужны только пруфы:
  &nbsp;
  - admin list с ↑/↓,
  - до/после reorder,
  - preview после reorder,
  - public после reorder,
  - подтверждение единого sort_order.
  &nbsp;
8. **Финальный статус не писать “code-complete”, пока нет verify.**
  До скринов и проверки это не закрытая задача.

&nbsp;

&nbsp;

Итого:

&nbsp;

- **PATCH A** — можно отправлять в работу, но с приоритетом на soft visual fix без потери equal-height.
- **PATCH B** — код не менять, только verify с доказательствами.

&nbsp;

&nbsp;

PATCH A Refinement + PATCH B Verification

## Current State

Both patches are **code-complete**:

- **PATCH A**: `TariffCarouselGrid.tsx` has coverflow effect, peek, dots, arrows, center alignment
- **PATCH B**: `useTariffs` sorts by `sort_order`, `useSwapTariffOrder` mutation exists, ↑/↓ buttons rendered in admin tariff list

The user's remaining concerns are **visual polish** (PATCH A) and **proof of functionality** (PATCH B).

---

## PATCH A — Remaining Visual Issues

### Problem: Cards feel "squeezed vertically"

Root cause: `items-stretch` on the Embla track forces all slides to the tallest card's height. Combined with `scale-[0.96]`/`scale-[0.92]` on inactive slides, the visual compression makes cards feel cramped. The `py-4` breathing room is insufficient for badge overflow (`absolute -top-3`) and card shadows.

### Fixes in `TariffCarouselGrid.tsx`

1. **Increase vertical breathing room**: Change `py-4` → `py-6` on `CarouselContent` to give badges and shadows more space
2. **Use `items-center` instead of `items-stretch**`: This lets each card size naturally by content rather than forcing all to tallest height. Cards still align visually because they're centered on the track. This eliminates the "squeezed" feeling while keeping CTA buttons at the natural bottom of each card (TariffCard already has `flex flex-col h-full` with `mt-auto` on the CTA section internally)
3. **Soften scale values**: Change adjacent from `scale-[0.96]` → `scale-[0.97]` and distant from `scale-[0.92]` → `scale-[0.95]` — less aggressive compression means less visual cramping
4. **Increase gap between slides**: Change `-ml-3 md:-ml-4` → `-ml-4 md:-ml-5` and matching `pl-` values for slightly more breathing room between cards

### Files


| File                                            | Change                                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| `src/components/landing/TariffCarouselGrid.tsx` | Adjust `items-stretch` → `items-center`, increase `py`, soften scale values, widen gaps |


No changes to TariffCard, UniversalPricingSection, business logic, or checkout.

---

## PATCH B — Already Implemented, Needs Verify Only

The code is fully in place:

- `useTariffs()` already sorts by `sort_order` (line 115 of `useProductsV2.tsx`)
- `useSwapTariffOrder()` mutation swaps `sort_order` between two tariffs (lines 126-138)
- Admin UI has ↑/↓ buttons per tariff (lines 769-784 of `AdminProductDetailV2.tsx`)

**No code changes needed for PATCH B.** Only verification is required.

---

## Verification Plan

After PATCH A visual fixes, browser testing will cover all 9 required screenshots across public desktop/tablet/mobile, admin preview, and PATCH B reorder functionality.