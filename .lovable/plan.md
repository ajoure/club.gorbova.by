

# Plan: 12 New Block Types + Universal Block Settings (Final)

## Reused Existing Solutions (Duplication Prevention Registry)

| Existing | Decision |
|---|---|
| `UniversalPricingSection` (`src/components/landing/UniversalPricingSection.tsx`) | **Reused.** PricingSection wraps it, passing pre-fetched `product` + `tariffs` props |
| `DOMPurify.sanitize()` inline in `SitePageRenderer.tsx:45` | **Extracted** into shared `SanitizationAdapter`. TextSection refactored to use it |
| `getEmbedUrl()` in lesson `VideoBlock`/`VideoUnskippableBlock` | **Not reused.** Lesson-domain-specific (Kinescope, timecodes). Different provider set |
| AmoCRM edge functions (`amocrm-sync`, `amocrm-webhook`) | **Not reused.** CRM-specific, not applicable to form MVP placeholder |
| `usePublicProduct` hook | **Not reused directly** in renderer. Container/page level fetches data and passes down |

## Architectural Constraints

- **All `*Section.tsx` renderers**: presentation logic only (layout, styling, conditional rendering). Zero data access, zero domain logic, zero provider-specific parsing
- **Adapters**: all normalization, validation, provider-specific logic lives here
- **Data flow for pricing**: container/page layer fetches product+tariffs via service → passes as props to `SitePageRenderer` → passes to `PricingSection` → wraps `UniversalPricingSection`. Pricing links are **UUID-driven only** (`product_id`), never title/slug/text
- **Form block**: visual placeholder only. Zero backend calls, zero table writes, zero events, zero cross-domain side effects
- **Video raw URL**: stored as user input only, serves exclusively as input to `VideoEmbedAdapter`. Not used for internal relationships or domain logic. Provider-specific parsing lives only in adapter layer
- **BlockWrapper compatibility invariant**: old blocks with `settings: {}` parse via defaults → zero padding, no background, `maxWidth: "lg"`, visibility flags false → **identical visual output guaranteed**. No visual diff on existing production pages

## Files to Create (28)

**Adapters (3):**
- `src/services/sitePages/adapters/VideoEmbedAdapter.ts` — URL → `{ provider, videoId, embedUrl }`, whitelist YouTube/Vimeo/RuTube only
- `src/services/sitePages/adapters/SanitizationAdapter.ts` — shared DOMPurify config (`<style>` and `style=""` allowed, `<iframe>/<script>/<embed>/<object>/event handlers` stripped)
- `src/services/sitePages/adapters/TimerAdapter.ts` — `normalizeToISO()`, `parseTargetDate()`, `isExpired()`

**Block Editors (13):**
- `BlockSettingsEditor.tsx` — universal settings panel
- 12 type-specific: Video, Button, Columns, Timer, Html, Gallery, Testimonials, Pricing (product selector by UUID), Social (enum dropdown), Logos, Spacer, Form (visual config only)

**Block Renderers (12) + wrapper (1) in `src/components/site-renderer/blocks/`:**
- `BlockWrapper.tsx` — applies universal settings as styles/classes
- Video, Button, Columns, Timer, Html, Gallery, Testimonials, Pricing (wraps `UniversalPricingSection`), Social, Logos, Spacer, Form (disabled submit, no backend)

## Files to Modify (3)

| File | Change |
|---|---|
| `src/services/sitePages/types.ts` | 12 content schemas, typed `blockSettingsSchema` (with `hideOnMobile`/`hideOnDesktop` in Tier 1), `SOCIAL_PLATFORMS` enum |
| `src/components/admin/site-builder/SiteBlockEditor.tsx` | 12 new imports, BLOCK_TYPES entries, getDefaultContent cases, BlockEditorComponent cases |
| `src/components/site-renderer/SitePageRenderer.tsx` | Import BlockWrapper + 12 renderers, wrap all blocks, refactor TextSection to use SanitizationAdapter. Pricing data passed via props from parent, NOT fetched here |

## Key Schemas

**blockSettingsSchema** (replaces line 5 `z.record(z.unknown())`):
```typescript
z.object({
  paddingTop: z.number().default(0),
  paddingBottom: z.number().default(0),
  backgroundColor: z.string().default(""),
  backgroundImage: z.string().default(""),
  textColor: z.string().default(""),
  fullWidth: z.boolean().default(false),
  maxWidth: z.enum(["sm", "md", "lg", "xl", "full"]).default("lg"),
  hideOnMobile: z.boolean().default(false),
  hideOnDesktop: z.boolean().default(false),
}).default({})
```

**Pricing** (product-driven, UUID only): `{ product_id: string, title: string, subtitle: string }`
**Social**: `SOCIAL_PLATFORMS = ["telegram", "instagram", "vk", "youtube", "tiktok", "facebook", "whatsapp", "x"] as const`
**Timer**: `targetDate` as ISO 8601 with timezone, normalized via `TimerAdapter.normalizeToISO()` in editor before save
**Form**: visual placeholder, disabled submit, zero side effects

## PricingSection Data Flow

```text
Container/Page (e.g. SitePage route)
  → fetches product + tariffs via SiteRenderService / usePublicProduct
  → passes pricingData map to SitePageRenderer as prop
SitePageRenderer
  → for pricing blocks, looks up pricingData[product_id]
  → passes product + tariffs to PricingSection
PricingSection
  → wraps UniversalPricingSection (existing component)
  → zero data access in renderer
```

## Implementation Order

1. Adapters (3)
2. Schemas in `types.ts`
3. `BlockSettingsEditor`
4. 12 block editors
5. `BlockWrapper` + 12 renderers
6. Wire into `SiteBlockEditor.tsx` and `SitePageRenderer.tsx`
7. Refactor TextSection to use SanitizationAdapter

## VERIFY

- [ ] Existing 8 blocks render unchanged
- [ ] **BlockWrapper with empty `settings: {}` produces zero visual diff on old blocks**
- [ ] Each new block creates with valid defaults
- [ ] No domain/business logic in any `*Section.tsx`
- [ ] Video: URL parsing only in VideoEmbedAdapter; raw URL not used for internal relations
- [ ] HTML: same sanitization policy as Text via shared SanitizationAdapter
- [ ] Timer: `normalizeToISO()` in editor before save; renderer uses adapter for parse only
- [ ] Pricing: data fetched in container/page layer, not in renderer; links are UUID-driven only
- [ ] Social: platform is enum, not free string
- [ ] **Form: zero backend calls, zero table writes, zero events, zero cross-domain side effects, disabled submit**
- [ ] Empty galleries/logos/testimonials/social render as `null`
- [ ] Columns: `items.length >= columns` enforced in editor
- [ ] Block settings backward compatible (`{}` → defaults → no visual change)

