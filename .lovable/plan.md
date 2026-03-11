

# Fix dialog overflow on mobile

## Problem
On mobile, the dialog content with cards overflows the screen — the footer buttons and bottom content get cut off. The `max-h-[90vh]` on the inner scroller doesn't account for the dialog being centered with `top-[50%] translate-y-[-50%]` plus browser chrome and safe areas.

## Solution

Two changes:

### 1. `src/components/ui/dialog.tsx` — constrain the dialog itself on mobile

Add `max-h-[calc(100vh-2rem)]` (or `max-h-[95dvh]` using dynamic viewport height) to the base `DialogContent` so the dialog container itself never exceeds the screen. Using `dvh` accounts for mobile browser chrome (address bar, toolbar).

Update line 42-44:
```
"fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-4 shadow-lg duration-200",
"...",
"rounded-2xl mx-3 sm:mx-0 sm:p-6 max-h-[calc(100dvh-2rem)]"
```

### 2. `src/pages/admin/AdminProductDetailV2.tsx` — inner scroller adapts

Change the inner wrapper from `max-h-[90vh]` to `max-h-full overflow-y-auto` so it fills the constrained dialog container rather than fighting with its own viewport calc.

Apply to all 3 dialogs (Tariff line 793, Offer line 937, Flow ~1703).

### 3. `src/pages/admin/AdminProductsV2.tsx` — same inner scroller fix

Same `max-h-full` change for the Product dialog.

No logic changes. Pure layout fix for mobile.

