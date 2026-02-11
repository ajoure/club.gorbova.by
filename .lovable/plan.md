
# Remove iOS Preview Blocker from App.tsx

## Problem
When opening the Lovable preview on iOS Safari, a blocker screen "Мобильный режим" is shown instead of the actual app. This was added as a performance guard but is now unwanted.

## Changes

### File: `src/App.tsx`

1. **Remove** the `isIOSSafariInPreview()` function (lines 1-19)
2. **Remove** the `IOSPreviewMessage` component (lines 21-66)
3. **Remove** the early return check inside the `App` component (lines 204-207):
   ```
   if (isIOSSafariInPreview()) {
     return <IOSPreviewMessage />;
   }
   ```

This will allow the normal app to render on iOS Safari in the preview, just like on desktop.

Note: The `IOSAdminGuard` (line 215) and `useLastRoute` heavy-route guards remain intact as separate safety mechanisms for admin routes specifically.
