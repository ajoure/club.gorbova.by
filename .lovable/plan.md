

# Fix: Tariff Dialog Visual Design

## Problem
The tariff edit dialog has an ugly, inconsistent appearance:
- Custom inline gradient `background` clashes with the light theme (white card with transparency = washed out)
- Sections (`bg-muted/30 border-border/20`) are barely visible, look like pale blobs
- Footer buttons have `bg-transparent backdrop-blur-sm` creating a disconnected white strip
- Overall: doesn't match the clean, crisp admin aesthetic

## Changes

### `src/pages/admin/AdminProductDetailV2.tsx` (lines 789-916)

**DialogContent (line 790-794):**
- Remove the inline `style` object entirely (gradient + backdrop-filter)
- Use standard DialogContent styling — clean `bg-card` with subtle border
- Keep `max-w-2xl max-h-[90vh] overflow-y-auto scrollbar-none`

**Sections A, B, C (lines 820, 863, 902):**
- Change from `rounded-xl bg-muted/30 border border-border/20` to `rounded-xl bg-muted/50 border border-border/40` — more visible, cleaner contrast

**DialogFooter (line 909):**
- Remove `bg-transparent backdrop-blur-sm`
- Use `bg-card` or just clean border-top without background tricks
- Ensure both buttons are properly sized/aligned

**Result:** Clean, solid dialog that matches the rest of the admin panel — no transparency gimmicks, proper section contrast, symmetrical footer buttons.

