

# Fix: Kinescope video player broken — SDK URL returns 404

## Problem

User reports video in lesson "Формирование и анализ портфеля клиентов" shows as static image instead of playing.

**Root cause:** The Kinescope IFrame Player SDK URL `https://player.kinescope.io/v1.0/iframe.player.js` returns **404 Not Found**. Kinescope deprecated/removed this versioned URL. The correct URL is `https://player.kinescope.io/latest/iframe.player.js` (confirmed working).

**Impact chain:**
1. Script load fails → `scriptLoadPromise` rejects
2. `onError` fires in VideoBlock → sets `apiError=true`, `useApiPlayer=false`
3. Falls back to iframe embed with URL `https://kinescope.io/embed/{videoId}`
4. If Kinescope also changed embed behavior, the fallback iframe may show a static preview/thumbnail instead of a playable video

## Fix

**File:** `src/hooks/useKinescopePlayer.ts`, line 58

Change:
```typescript
script.src = "https://player.kinescope.io/v1.0/iframe.player.js";
```
To:
```typescript
script.src = "https://player.kinescope.io/latest/iframe.player.js";
```

One line change. No other files affected.

## Technical details

- The comment on line 57 says "Фиксированная версия SDK вместо /latest/ для стабильности" — this was an intentional pinning that backfired when Kinescope removed v1.0.
- Using `/latest/` is the officially documented approach per Kinescope docs.
- The fallback iframe path still works as a safety net if the API player fails for other reasons.

