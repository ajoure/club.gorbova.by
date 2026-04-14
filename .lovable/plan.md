# PATCH F — Guest checkout flow + club CTA fix — CLOSED

## Статус PATCHей

| PATCH | Статус |
|-------|--------|
| A — suffix/config-driven | CLOSED |
| B — equal-height layout | PARTIALLY VERIFIED |
| C — carousel UX | OPEN |
| D — product↔page binding + anchors | CLOSED |
| E — pricing block detection + diagnostics | CLOSED |
| F — guest checkout flow + club CTA fix | **CLOSED** |

## Что сделано

### F1. Убран auth-redirect guard из pricing entrypoints

- `UniversalPricingSection.tsx` — убран `if (!user) navigate("/auth")`, убран `useEffect` restore offer, убраны неиспользуемые импорты
- `ProductLanding.tsx` — то же самое
- `TariffPricing.tsx` — то же самое

Теперь `PaymentDialog` всегда открывается напрямую. Диалог сам обрабатывает guest через inline auth flow (email → login/register → payment).

### F2. Фикс scroll к тарифам

- `LandingHero.tsx` — `getElementById("pricing")` → fallback `getElementById("tariffs") || getElementById("pricing")`
- `LandingCTA.tsx` — то же самое
- `UnifiedFooter.tsx` — `href="#pricing"` → `href="#tariffs"`

### Canonical owner

- `PaymentDialog` = canonical guest checkout flow
- Любые внешние guards `if (!user) navigate("/auth")` в pricing entrypoints — legacy/broken, удалены

## Файлы

| Файл | Изменение |
|------|-----------|
| `src/components/landing/UniversalPricingSection.tsx` | Убран auth guard + useEffect restore |
| `src/components/landing/ProductLanding.tsx` | Убран auth guard + useEffect restore |
| `src/pages/TariffPricing.tsx` | Убран auth guard + useEffect restore |
| `src/components/landing/LandingHero.tsx` | scroll anchor fix |
| `src/components/landing/LandingCTA.tsx` | scroll anchor fix |
| `src/components/layout/UnifiedFooter.tsx` | anchor `#pricing` → `#tariffs` |
