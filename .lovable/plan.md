# да, согласен, с учетом правок:

&nbsp;

1. **PATCH A и PATCH B выполнять раздельно.**
  Не смешивать visual carousel upgrade и порядок тарифов в один execute. По регламенту изменения идут по этапам diagnose → plan → dry-run → execute → verify, а production-логику ломать нельзя
2. **PATCH A — только shared UI/layout слой.**
  Не трогать TariffCard, checkout, offers, pricing/business logic. UI не должен содержать бизнес-логику 
3. **Carousel делать не “псевдо-3D”, а modern coverflow-like.**
  Разрешено:
  &nbsp;
  - active center
  - соседние карточки чуть слабее/меньше
  - peek next/prev
  - smooth scale/opacity
    Не делать тяжелые transform-хакы, которые ломают клики, высоту или адаптив.
  &nbsp;
4. **Убрать вертикальный clipping полностью.**
  В DoD PATCH A добавить:
  &nbsp;
  - карточки не режутся по высоте,
  - CTA не прыгают,
  - track/container не режет badge/shadow/низ карточек,
  - equal-height только без принудительного clipping.
  &nbsp;
5. **Public и admin preview обязаны использовать один и тот же shared path.**
  Логика строго одинаковая:
  &nbsp;
  - <= 3 активных тарифов → grid
  - >= 4 → carousel
    Без расхождения между preview и сайтом. Система должна переиспользовать существующие решения и не плодить дубли 
  &nbsp;
6. **PATCH B — унифицировать источник порядка на одном поле.**
  Если public уже использует sort_order, то admin preview и admin list тоже должны перейти на sort_order. Не оставлять split между display_order и sort_order, иначе будет parity gap.
7. **Порядок менять через детерминированное поле, не через визуальный эффект.**
  Up/down допустимо. Drag-and-drop не обязателен. Главное:
  &nbsp;
  - меняется только sort_order
  - preview читает sort_order
  - public читает sort_order
  - без влияния на offers / access / pricing.
  &nbsp;
8. **Не вводить новые лишние сущности, если не нужно.**
  Новый shared wrapper допустим только если он реально переиспользуется в public и admin и не создает второй параллельный render-path 
9. **Обязательный VERIFY по обоим PATCH.**
  Для PATCH A:
  &nbsp;
  - public desktop/tablet/mobile
  - admin preview desktop/mobile
  - 3 тарифа = grid
  - 4+ тарифа = carousel
  - отдельный скрин, что карточки не режутся
    Для PATCH B:
  - изменение порядка в admin
  - сохранение
  - preview после сохранения
  - public после сохранения
  &nbsp;
10. **Если при реализации нужно лезть в unrelated business domains — STOP.**
  Домены не должны напрямую ломать соседние части системы, а legacy-логика должна мигрировать постепенно через compatibility layer

&nbsp;

PATCH A + PATCH B: Carousel Visual Upgrade + Tariff Display Order

---

## PATCH A — Carousel Visual Upgrade

### Problem

Current carousel at 1000px viewport shows all 3 cards fitting without scrolling — no visual affordance that it's a carousel. Cards clip vertically. No coverflow-like modern feel.

### Solution — Single file: `TariffCarouselGrid.tsx`

**1. Fix clipping**: Remove `h-full` constraint forcing equal height via overflow hidden. Instead use `items-stretch` on the flex track and let cards grow naturally. The `[&>*]:h-full` wrapper is causing clipping — replace with `min-h-0` + natural sizing.

**2. Modern coverflow-like effect**: Add CSS transition on each slide based on whether it's the active/selected snap:

- Active slide: `scale-100 opacity-100`
- Adjacent slides: `scale-[0.95] opacity-70`
- This is pure CSS via Tailwind classes toggled by `selectedIndex` — no 3D transforms, no absolute positioning hacks.

**3. Better basis values for peek**:

- Desktop (lg): `basis-[36%]` — shows ~2.5 cards, clear peek
- Tablet (md): `basis-[52%]` — shows ~1.8 cards
- Mobile: `basis-[88%]` — 1 card + visible peek

**4. Embla align center**: Switch from `align: "start"` to `align: "center"` so the active card is visually centered, reinforcing the coverflow feel.

**5. Remove overflow clipping**: The Embla container's `overflow-hidden` is needed for the track, but the outer wrapper needs `overflow-visible` or adequate padding so card shadows/badges aren't cut.

**6. Arrows**: Keep current styling but add `opacity-0` → `opacity-100` transition when `disabled`, fully hide on mobile (already done).

**7. No changes to**: TariffCard, UniversalPricingSection, AdminProductDetailV2, pricing logic, checkout flow.

### Files changed


| File                                            | Change                                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `src/components/landing/TariffCarouselGrid.tsx` | Rewrite `CarouselView`: fix clipping, add scale/opacity transitions per slide, adjust basis, center alignment |


---

## PATCH B — Tariff Display Order from Admin

### Current state

- `tariffs` table has **both** `sort_order` (used by public edge functions) and `display_order` (used by admin `useTariffs` hook).
- Public edge functions (`public-product`, `public-product-by-slug`) already sort by `sort_order ASC`.
- Admin `useTariffs()` sorts by `display_order ASC`.
- No admin UI exists to reorder tariffs.
- Admin preview (line 1148) renders `tariffs?.filter(t => t.is_active)` without explicit sort — inherits `useTariffs` order (`display_order`).

### Problem

Two separate order columns create a parity gap between admin preview and public. Public uses `sort_order`, admin uses `display_order`.

### Solution

**1. Unify on `sort_order**`:

- Change `useTariffs()` hook to `order("sort_order")` instead of `display_order`.
- This ensures admin preview and public use the same ordering field.

**2. Add reorder UI in admin tariff list**:

- Add up/down arrow buttons next to each tariff card in the tariff tab list (lines 750-779).
- On click: swap `sort_order` values between adjacent tariffs, save to DB via a mutation.
- Simple, deterministic, no drag-and-drop complexity needed.

**3. Mutation**: Add `useUpdateTariffOrder` mutation that updates `sort_order` for affected tariffs and invalidates the `["tariffs"]` query.

**4. Edge functions**: Already sort by `sort_order` — no changes needed.

**5. No changes to**: TariffCard, offers, checkout, payment logic, entitlements.

### Files changed


| File                                       | Change                                                                            |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| `src/hooks/useProductsV2.tsx`              | Change `useTariffs` to sort by `sort_order`. Add `useUpdateTariffOrder` mutation. |
| `src/pages/admin/AdminProductDetailV2.tsx` | Add up/down reorder buttons to tariff list items.                                 |


---

## Verification plan

After implementation, screenshots needed for all 9 items listed in the requirements.