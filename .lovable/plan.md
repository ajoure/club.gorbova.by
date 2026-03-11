

# Fix mobile dialog styling — add rounded corners on all screen sizes

## Problem
The base `DialogContent` in `dialog.tsx` uses `sm:rounded-lg` — rounded corners only appear at 640px+. On mobile, dialogs render as flat rectangles with no border radius, which looks outdated.

## Solution
One change in `src/components/ui/dialog.tsx` (line 44):

Replace `sm:rounded-lg sm:p-6` with `rounded-2xl sm:p-6`

This gives all dialogs consistent rounded corners (`1rem`) on every screen size, matching the modern iOS/Android aesthetic visible in the desktop version. The `p-4` base padding already handles mobile spacing; `sm:p-6` adds more on desktop.

Additionally, add a small margin on mobile so the dialog doesn't touch screen edges:

Add `mx-3 sm:mx-0` to the base className (line 42), so the dialog has breathing room on small screens.

**Final className:**
```
"fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-4 shadow-lg duration-200"
+ "rounded-2xl mx-3 sm:mx-0"
```

No logic changes. Affects all dialogs globally — consistent rounded corners everywhere.

