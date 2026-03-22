## Now I see the key issue. In `/ai`, the `StructuredAddressBlock` is rendered inside `EntityRecordSheet` → `SheetContent` (Radix Dialog portal) → scrollable `div.overflow-y-auto` (line 558). The dropdown is portaled to `document.body`. The Radix Sheet overlay intercepts pointer events.

Let me check the `/settings/legal-details` path for comparison.

Now I have the full picture. The critical difference:

- `/settings/legal-details`: `OrganizationDetailsForm` rendered directly in the page (no Sheet/Dialog portal overlay)

- `/ai`: `OrganizationDetailsForm` rendered inside `EntityRecordSheet` → `Sheet` (Radix Dialog) → `SheetContent` (portal with `z-50` overlay + `overflow-y-auto` scrollable body)

The Radix Dialog overlay at `z-50` intercepts pointer events. The dropdown portal at `z-index: 9999` should be above it visually, but Radix Dialog's `pointer-events` management on the overlay can still capture events.

Now I see the highlight color issue: `--accent: 240 80% 65%` is a very saturated blue-purple, and with `--accent-foreground: 0 0% 100%` (white text), the selected row becomes hard to read. The screenshot confirms this — the highlighted suggestion has white text on saturated blue background.

## PATCH 5R++ HOTFIX — mouse-path fix + highlight readability

### Root cause analysis

**Why mouse select fails**: Two separate issues depending on consumer path.

#### Consumer-path diff table

| Consumer | Wrapper | Portal context | Scroll close-handler | Mouse select | Keyboard select |

|---|---|---|---|---|---|

| `/settings/legal-details` | Page-level (no overlay) | None | `window.scroll` capture | **Needs verification** | ✅ works |

| `/ai` (EntityRecordSheet) | Radix Sheet (z-50 overlay + SheetPortal) | Sheet portal overlays body | `window.scroll` capture + Sheet scroll container `overflow-y-auto` | ❌ broken | ✅ works |

| AdminExecutors | Dialog (Radix AlertDialog) | Dialog portal | `window.scroll` capture | Needs verification | Needs verification |

| LegalEntityDetailsForm | Page-level | None | `window.scroll` capture | Needs verification | Needs verification |

| EntrepreneurDetailsForm | Page-level | None | `window.scroll` capture | Needs verification | Needs verification |

| IndividualDetailsForm | Page-level | None | `window.scroll` capture | Needs verification | Needs verification |

#### Root cause diff: `/settings` vs `/ai`

The critical difference:

1. *`/settings/legal-details`**: `OrganizationDetailsForm` rendered directly in a page ``, no portal overlay. The dropdown portal `z-index: 9999`) is on top of everything. No Radix overlay intercepting events.

2. *`/ai`**: `OrganizationDetailsForm` rendered inside `EntityRecordSheet` → `Sheet` (Radix Dialog) → `SheetContent`. Key details:

   - `SheetOverlay`: `fixed inset-0 z-50 bg-black/80` — full-screen overlay with pointer events

   - `SheetContent`: `fixed z-50` — the content panel

   - Scrollable body: `div.flex-1.overflow-y-auto` (line 558)

   - The dropdown portal is attached to `document.body` at `z-index: 9999`

   **The Radix Dialog overlay `z-50`) captures `pointerdown` events.** Even though dropdown has higher visual z-index, Radix's internal event handling on the overlay can:

   - Trigger focus management that steals focus from the dropdown

   - Intercept pointer events before they reach the dropdown `` elements

   - The Sheet's internal scroll container fires `scroll` events which trigger `clearPredictions()` before `handleSelect` completes

3. **Specific interaction chain in `/ai`**:

   - User clicks suggestion → `pointerdown` fires on ``

   - But Radix Sheet overlay also captures the event

   - Sheet's scroll container emits scroll → `window.scroll` close-handler fires → `clearPredictions()` → dropdown unmounts

   - `handleSelect` either never starts or gets interrupted

### Two-level fix

#### Level 1: Fix mouse-path interaction in StructuredAddressBlock

**File**: `src/components/shared/StructuredAddressBlock.tsx`

Changes:

1. **Move selection to `onPointerDown` as sole trigger** (already done) — verify it calls `handleSelect` directly

2. **Guard `clearPredictions` in scroll/resize handler**: check `isSelectingRef.current` before clearing

3. **Guard document mousedown close-handler**: check `isSelectingRef.current` before closing

4. **Ensure `handleSelect` sets `isSelectingRef = true` before any async work** and resets in `finally`

The current scroll handler (line 119) already checks `isSelectingRef`:

```

const close = () => { if (!isSelectingRef.current) clearPredictions(); };

```

But the problem is **timing**: `onPointerDown` on `` sets `isSelectingRef = true`, but scroll events from the Sheet's internal container fire on the *same* event loop tick, potentially before `isSelectingRef` is set.

**Fix**: On the dropdown container's `onMouseDownonPointerDown`, already set `isSelectingRef = true` (currently done at line 256). The issue is that Radix Sheet's overlay intercepts the pointer event first, preventing it from reaching the dropdown container.

**Real fix for `/ai`**: The dropdown must be rendered inside the Sheet portal context, not `document.body`, OR the Sheet overlay must not block pointer events for the dropdown.

**Approach**: Conditionally portal the dropdown to the nearest Radix portal container instead of `document.body`. Practically:

- Change `createPortal(..., document.body)` to `createPortal(..., document.body)` but add `pointer-events: auto` and ensure the dropdown's z-index is above Radix's `z-50` (which it already is at 9999)

- Add `onPointerDown` with `stopPropagation` on the dropdown container to prevent Radix overlay from handling it (already done)

**Most likely the real issue**: The `onPointerDown` on `` calls `handleSelect(p)` which is async. During the async `fetchPlaceDetails`, the Sheet's scroll container fires scroll, and even though `isSelectingRef` is true, something else clears the dropdown.

**Revised approach**: Make dropdown not close during active selection by:

1. `onPointerDown` on ``: set `isSelectingRef = true`, call `handleSelect`

2. In `handleSelect`: do NOT call `clearPredictions()` until after `onChange(merged)` succeeds

3. In scroll/resize close handler: already guards on `isSelectingRef` — verify this guard is actually working

4. In document mousedown close handler (line 97-104): add `isSelectingRef` guard

**Line 97-104 is the likely culprit** — document mousedown handler does NOT check `isSelectingRef`:

```js

const handler = (e: MouseEvent) => {

  const target = [e.target](http://e.target) as Node;

  if (!containerRef.current?.contains(target) && !dropdownRef.current?.contains(target)) {

    setIsOpen(false);

  }

};

```

When Radix overlay intercepts the event, `dropdownRef.current?.contains(target)` returns false (target is the overlay, not the dropdown), so `setIsOpen(false)` fires → dropdown closes → `handleSelect` either can't complete or `clearPredictions` already ran.

**Fix**: Add `isSelectingRef.current` guard to the document mousedown handler:

```js

if (isSelectingRef.current) return;

```

#### Level 2: Fix highlight readability (global)

**File**: `src/index.css`

Current `--accent: 240 80% 65%` is too saturated. With `--accent-foreground: 0 0% 100%` (white), the selected row text becomes hard to read against the bright blue.

**Fix**: Change accent to a softer value that keeps text readable:

- Light theme: `--accent: 240 40% 94%` (very light blue-gray) with `--accent-foreground: 240 10% 10%` (near-black text)

- This matches the standard shadcn/ui default accent pattern

- All components using `bg-accent text-accent-foreground` will automatically update

**Audit of affected components** (all using `bg-accent` via Tailwind):

- `StructuredAddressBlock` dropdown suggestions (highlight)

- `src/components/ui/command.tsx` — command palette items

- `src/components/ui/select.tsx` — select items

- `src/components/ui/context-menu.tsx` — context menu items

- `src/components/shared/EntityCustomFields.tsx` — custom field dropdowns

- Various admin components with `hover:bg-accent`

All share the same CSS variable, so fixing `--accent` in `src/index.css` is the single source of truth.

### Execution order

#### Этап A — fix document mousedown handler + verify scroll guard

1. In `StructuredAddressBlock.tsx` line 97-104: add `if (isSelectingRef.current) return;` before the contains check

2. Verify scroll/resize handler guard (line 119) works correctly

3. Verify `onPointerDown` on dropdown container (line 252-257) sets `isSelectingRef = true`

#### Этап B — fix accent color globally

1. In `src/index.css`: change `--accent` and `--accent-foreground` to readable values in both light and dark themes

2. All dropdowns, selects, command items automatically inherit

#### Этап C — proof package

1. *`/settings/legal-details`**: mouse select ✅, keyboard select ✅

2. *`/ai`**: mouse select ✅, keyboard select ✅ — explicitly separate proof

3. **Highlight readability**: screenshots of address dropdown, select, and command palette showing readable text on hover/selected

4. **Root cause explanation**: document mousedown handler closed dropdown because Radix overlay intercepted the click, making `dropdownRef.contains(target)` fail

5. **Regression**: manual address input, UNP lookup, Minsk/non-Minsk preview

### Files to modify

- `src/components/shared/StructuredAddressBlock.tsx` — add `isSelectingRef` guard to document mousedown handler

- `src/index.css` — fix `--accent` and `--accent-foreground` values

### DoD

- `/settings/legal-details`: mouse select works, keyboard select works

- `/ai`: mouse select works, keyboard select works

- Root cause diff between `/settings` and `/ai` explained and fixed

- Toast "ID скопирован" does not appear on suggestion selection

- All address fields populate after selection

- Highlight row in all shared dropdown/list patterns is readable (text contrasts with background)

- Same highlight style verified in: address dropdown, form select, any other list/menu

- Save writes correct `address_structured` and legacy fields

- Preview after save remains correct

- UNP lookup not regressed

- PATCH 6 not started until this is closed

&nbsp;

PATCH 5R++ HOTFIX — mouse-path fix + highlight readability

### Root cause analysis

**Why mouse select fails**: Two separate issues depending on consumer path.

#### Consumer-path diff table


| Consumer                  | Wrapper                                  | Portal context             | Scroll close-handler                                               | Mouse select           | Keyboard select    |
| ------------------------- | ---------------------------------------- | -------------------------- | ------------------------------------------------------------------ | ---------------------- | ------------------ |
| `/settings/legal-details` | Page-level (no overlay)                  | None                       | `window.scroll` capture                                            | **Needs verification** | ✅ works            |
| `/ai` (EntityRecordSheet) | Radix Sheet (z-50 overlay + SheetPortal) | Sheet portal overlays body | `window.scroll` capture + Sheet scroll container `overflow-y-auto` | ❌ broken               | ✅ works            |
| AdminExecutors            | Dialog (Radix AlertDialog)               | Dialog portal              | `window.scroll` capture                                            | Needs verification     | Needs verification |
| LegalEntityDetailsForm    | Page-level                               | None                       | `window.scroll` capture                                            | Needs verification     | Needs verification |
| EntrepreneurDetailsForm   | Page-level                               | None                       | `window.scroll` capture                                            | Needs verification     | Needs verification |
| IndividualDetailsForm     | Page-level                               | None                       | `window.scroll` capture                                            | Needs verification     | Needs verification |


#### Root cause diff: `/settings` vs `/ai`

The critical difference:

1. `**/settings/legal-details**`: `OrganizationDetailsForm` rendered directly in a page `<div>`, no portal overlay. The dropdown portal (`z-index: 9999`) is on top of everything. No Radix overlay intercepting events.
2. `**/ai**`: `OrganizationDetailsForm` rendered inside `EntityRecordSheet` → `Sheet` (Radix Dialog) → `SheetContent`. Key details:
  - `SheetOverlay`: `fixed inset-0 z-50 bg-black/80` — full-screen overlay with pointer events
  - `SheetContent`: `fixed z-50` — the content panel
  - Scrollable body: `div.flex-1.overflow-y-auto` (line 558)
  - The dropdown portal is attached to `document.body` at `z-index: 9999`
   **The Radix Dialog overlay (`z-50`) captures `pointerdown` events.** Even though dropdown has higher visual z-index, Radix's internal event handling on the overlay can:
  - Trigger focus management that steals focus from the dropdown
  - Intercept pointer events before they reach the dropdown `<li>` elements
  - The Sheet's internal scroll container fires `scroll` events which trigger `clearPredictions()` before `handleSelect` completes
3. **Specific interaction chain in `/ai**`:
  - User clicks suggestion → `pointerdown` fires on `<li>`
  - But Radix Sheet overlay also captures the event
  - Sheet's scroll container emits scroll → `window.scroll` close-handler fires → `clearPredictions()` → dropdown unmounts
  - `handleSelect` either never starts or gets interrupted

### Two-level fix

#### Level 1: Fix mouse-path interaction in StructuredAddressBlock

**File**: `src/components/shared/StructuredAddressBlock.tsx`

Changes:

1. **Move selection to `onPointerDown` as sole trigger** (already done) — verify it calls `handleSelect` directly
2. **Guard `clearPredictions` in scroll/resize handler**: check `isSelectingRef.current` before clearing
3. **Guard document mousedown close-handler**: check `isSelectingRef.current` before closing
4. **Ensure `handleSelect` sets `isSelectingRef = true` before any async work** and resets in `finally`

The current scroll handler (line 119) already checks `isSelectingRef`:

```
const close = () => { if (!isSelectingRef.current) clearPredictions(); };
```

But the problem is **timing**: `onPointerDown` on `<li>` sets `isSelectingRef = true`, but scroll events from the Sheet's internal container fire on the *same* event loop tick, potentially before `isSelectingRef` is set.

**Fix**: On the dropdown container's `onMouseDown`/`onPointerDown`, already set `isSelectingRef = true` (currently done at line 256). The issue is that Radix Sheet's overlay intercepts the pointer event first, preventing it from reaching the dropdown container.

**Real fix for `/ai**`: The dropdown must be rendered inside the Sheet portal context, not `document.body`, OR the Sheet overlay must not block pointer events for the dropdown.

**Approach**: Conditionally portal the dropdown to the nearest Radix portal container instead of `document.body`. Practically:

- Change `createPortal(..., document.body)` to `createPortal(..., document.body)` but add `pointer-events: auto` and ensure the dropdown's z-index is above Radix's `z-50` (which it already is at 9999)
- Add `onPointerDown` with `stopPropagation` on the dropdown container to prevent Radix overlay from handling it (already done)

**Most likely the real issue**: The `onPointerDown` on `<li>` calls `handleSelect(p)` which is async. During the async `fetchPlaceDetails`, the Sheet's scroll container fires scroll, and even though `isSelectingRef` is true, something else clears the dropdown.

**Revised approach**: Make dropdown not close during active selection by:

1. `onPointerDown` on `<li>`: set `isSelectingRef = true`, call `handleSelect`
2. In `handleSelect`: do NOT call `clearPredictions()` until after `onChange(merged)` succeeds
3. In scroll/resize close handler: already guards on `isSelectingRef` — verify this guard is actually working
4. In document mousedown close handler (line 97-104): add `isSelectingRef` guard

**Line 97-104 is the likely culprit** — document mousedown handler does NOT check `isSelectingRef`:

```js
const handler = (e: MouseEvent) => {
  const target = e.target as Node;
  if (!containerRef.current?.contains(target) && !dropdownRef.current?.contains(target)) {
    setIsOpen(false);
  }
};
```

When Radix overlay intercepts the event, `dropdownRef.current?.contains(target)` returns false (target is the overlay, not the dropdown), so `setIsOpen(false)` fires → dropdown closes → `handleSelect` either can't complete or `clearPredictions` already ran.

**Fix**: Add `isSelectingRef.current` guard to the document mousedown handler:

```js
if (isSelectingRef.current) return;
```

#### Level 2: Fix highlight readability (global)

**File**: `src/index.css`

Current `--accent: 240 80% 65%` is too saturated. With `--accent-foreground: 0 0% 100%` (white), the selected row text becomes hard to read against the bright blue.

**Fix**: Change accent to a softer value that keeps text readable:

- Light theme: `--accent: 240 40% 94%` (very light blue-gray) with `--accent-foreground: 240 10% 10%` (near-black text)
- This matches the standard shadcn/ui default accent pattern
- All components using `bg-accent text-accent-foreground` will automatically update

**Audit of affected components** (all using `bg-accent` via Tailwind):

- `StructuredAddressBlock` dropdown suggestions (highlight)
- `src/components/ui/command.tsx` — command palette items
- `src/components/ui/select.tsx` — select items
- `src/components/ui/context-menu.tsx` — context menu items
- `src/components/shared/EntityCustomFields.tsx` — custom field dropdowns
- Various admin components with `hover:bg-accent`

All share the same CSS variable, so fixing `--accent` in `src/index.css` is the single source of truth.

### Execution order

#### Этап A — fix document mousedown handler + verify scroll guard

1. In `StructuredAddressBlock.tsx` line 97-104: add `if (isSelectingRef.current) return;` before the contains check
2. Verify scroll/resize handler guard (line 119) works correctly
3. Verify `onPointerDown` on dropdown container (line 252-257) sets `isSelectingRef = true`

#### Этап B — fix accent color globally

1. In `src/index.css`: change `--accent` and `--accent-foreground` to readable values in both light and dark themes
2. All dropdowns, selects, command items automatically inherit

#### Этап C — proof package

1. `**/settings/legal-details**`: mouse select ✅, keyboard select ✅
2. `**/ai**`: mouse select ✅, keyboard select ✅ — explicitly separate proof
3. **Highlight readability**: screenshots of address dropdown, select, and command palette showing readable text on hover/selected
4. **Root cause explanation**: document mousedown handler closed dropdown because Radix overlay intercepted the click, making `dropdownRef.contains(target)` fail
5. **Regression**: manual address input, UNP lookup, Minsk/non-Minsk preview

### Files to modify

- `src/components/shared/StructuredAddressBlock.tsx` — add `isSelectingRef` guard to document mousedown handler
- `src/index.css` — fix `--accent` and `--accent-foreground` values

### DoD

- `/settings/legal-details`: mouse select works, keyboard select works
- `/ai`: mouse select works, keyboard select works
- Root cause diff between `/settings` and `/ai` explained and fixed
- Toast "ID скопирован" does not appear on suggestion selection
- All address fields populate after selection
- Highlight row in all shared dropdown/list patterns is readable (text contrasts with background)
- Same highlight style verified in: address dropdown, form select, any other list/menu
- Save writes correct `address_structured` and legacy fields
- Preview after save remains correct
- UNP lookup not regressed
- PATCH 6 not started until this is closed