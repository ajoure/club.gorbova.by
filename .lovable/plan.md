

# Fix: Site pages accessible by slug URL

## DRY RUN — Single-segment route audit

All existing single-segment routes in App.tsx:

```text
/auth, /pricing, /order-payment, /offer, /pay, /privacy, /consent,
/contacts, /help, /consultation, /course-accountant, /close-year,
/business-training, /club, /banned, /products, /dashboard, /money,
/ai, /knowledge, /purchases, /accountant, /business, /audits,
/self-development, /support, /docs, /library, /settings, /admin
```

All static. React Router v6 ranks static segments higher than dynamic `:slug`, so no collisions.

## Compatibility rules

1. **Explicit routes keep priority** — `/:slug` never shadows existing static routes
2. **`*` remains last fallback** — `/:slug` placed before `*`, after all explicit routes
3. **Legacy DomainRouter untouched** — host-based resolution on `/` path unaffected
4. **ID-driven invariant** — slug is only for public URL resolution; all internal refs use UUID
5. **Future-proof constraint** — `/:slug` is strictly a public resolution layer, not a default routing mechanism. New system/utility pages must be added as explicit static routes, never rely on slug resolution

## Changes

### 1. New file: `src/pages/SitePageBySlug.tsx`

Thin resolution layer — component only extracts slug from params and delegates to service. No route-level business logic.

- `useParams` → slug
- `SiteRenderService.resolveBySlug(slug)` (filters `status = 'published'`)
- Found → `SitePageRenderer` in `<div className="site-public-layout">`
- Not found → `NotFound`
- Loading → spinner

### 2. File: `src/App.tsx`

Add lazy import:
```tsx
const SitePageBySlug = lazy(() => import("./pages/SitePageBySlug"));
```

Add route before `*` catch-all:
```tsx
<Route path="/:slug" element={<LazyRoute><SitePageBySlug /></LazyRoute>} />
```

## Verify checklist

1. Existing explicit routes (`/auth`, `/dashboard`, `/admin/sites`, etc.) open normally
2. Non-existent slug → NotFound
3. Unpublished page by slug → NotFound
4. Published page by slug → renders with full-width layout
5. Legacy DomainRouter host-based rendering — no regression
6. Slug used only as public resolution attribute; all internal navigation/linking remains UUID-driven

