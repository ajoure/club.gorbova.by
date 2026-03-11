

# Fix scroll clipping + Product dialog styling (Variant A)

## Approach
**Variant A (safe)**: Do NOT touch `dialog.tsx`. Instead, restructure each scrollable dialog to use `overflow-hidden` on DialogContent (clips to rounded corners) with an inner scrollable `div`.

## Changes

### 1. `src/pages/admin/AdminProductDetailV2.tsx` — 3 dialogs

**Tariff Dialog (line 792)**
- DialogContent: `max-w-2xl bg-background border-border/40 overflow-hidden` (remove `max-h-[90vh] overflow-y-auto scrollbar-none`)
- Wrap lines 793–928 (DialogHeader through DialogFooter) in `<div className="max-h-[90vh] overflow-y-auto scrollbar-none p-6 sm:p-6">`
- Remove the default padding from DialogContent by adding `p-0` (the inner wrapper provides it)

**Offer Dialog (line 934)**
- Same pattern: DialogContent gets `overflow-hidden p-0`, inner `div` gets `max-h-[90vh] overflow-y-auto scrollbar-none p-6`

**Flow Dialog (line 1703)**
- Flow is short and unlikely to scroll, but for consistency apply same pattern if it has potential overflow; otherwise just keep `bg-background overflow-hidden`

### 2. `src/pages/admin/AdminProductsV2.tsx` — Product create/edit dialog (line 582)

- DialogContent: `max-w-2xl bg-background overflow-hidden p-0`
- Wrap content (lines 583–648) in `<div className="max-h-[90vh] overflow-y-auto scrollbar-none p-6">`

### Why this works
- `overflow-hidden` on DialogContent clips content to rounded corners — no "rect inside rounded frame"
- `overflow-y-auto` moves to inner div — scrolling still works but stays within clipped boundary
- Select/Dropdown/DatePicker use Radix portals → render outside DialogContent → never clipped

### DoD
- Fast scroll: content does not peek outside rounded corners (all 4 dialogs)
- All Select/Dropdown inside dialogs open fully, not clipped
- Product dialog matches others: `bg-background`, scrollbar hidden
- No logic/field/layout changes

