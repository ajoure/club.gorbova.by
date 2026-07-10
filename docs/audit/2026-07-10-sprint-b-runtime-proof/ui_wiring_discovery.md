# UI-wiring discovery: gorbova.by/cb → RR installment initiate

Дата: 2026-07-10
Gate: A (только discovery; изменения UI — отдельным mini-планом в Gate B)

## 1. Маршрут `gorbova.by/cb`

- Домен `gorbova.by` разрешается в `DomainRouter` (`src/components/layout/DomainRouter.tsx`).
- `gorbova.by` квалифицируется как **main domain** (`isMainDomain=true`) → рендерится `<Landing />`, а НЕ Site Builder resolver. Для не-корневых путей на main-домене (`/cb`, `/cons`, `/consultation`, ...) роутинг определяется React Router в `src/App.tsx` / `src/pages/`.
- Slug `cb` присутствует в `site_pages` как страница `d5a5c2e0-9e4c-4e6c-b9bc-1e4bd264d656` («ЦБ 2.0 2026»), привязанная к `site_domain_bindings.domain='gorbova.by'` (`is_primary=false, is_home=false`).
- Публичный рендер site_page по slug выполняет `src/pages/SitePageBySlug.tsx`.

**Итог маршрута:** `https://gorbova.by/cb` → React Router → `SitePageBySlug` (slug=`cb`) → `SiteRenderService.resolveByDomainAndPathSafe('gorbova.by','/cb')` → рендер блоков страницы `d5a5c2e0-...`.

## 2. Оффер и продукт

- Продукт: `7101ed3c-7839-4a74-ad95-aa0660369b22` — «Ценный бухгалтер | 1 ступень 2.0», `primary_domain='cb.gorbova.by'` (это отдельный legacy домен, НЕ путь `/cb`).
- Тарифы продукта содержат **15 офферов**. Bank-installment RR-enabled — ровно один:
  - `15ce91ec-5dc1-4abf-9fab-9c97dc1e6b74` — «Оплатить в рассрочку от банка», 1650 BYN, `meta.bank_installment.rr_runtime = { enabled: true, mode: 'initiate_only', provider: 'rr' }`.
- Legacy bank_installment (external_link) офферы того же продукта:
  - `2a07af43-710a-4f8c-8211-0eea6ae2cf27` — «Заявка на рассрочку», amount=0, без rr_runtime.
  - `4f64def7-d465-47ef-b747-594a8829b0df` — «Заявка на рассрочку», amount=0, без rr_runtime.

## 3. Точка входа в `LeadRequestDialog`

Компоненты, которые уже умеют открывать `LeadRequestDialog` для `offer_type='bank_installment'`:

- `src/components/landing/ProductLanding.tsx` — legacy landing (по `primary_domain`).
- `src/components/landing/UniversalPricingSection.tsx` — универсальная секция для site-builder блоков (проверить, что рендерится в блоках страницы `d5a5c2e0`).
- `src/pages/TariffPricing.tsx` — публичная одиночная страница тарифа `/t/:publicId`.
- `src/pages/SitePageBySlug.tsx` — тонкая обёртка над Site Builder rendering.
- `src/components/site-renderer/blocks/ButtonSection.tsx` — CTA-кнопка в блоках.

Внутри `LeadRequestDialog` submit для оффера с `rr_runtime.enabled=true` вызывает `startBankInstallment` (`src/lib/startBankInstallment.ts`), который делает `supabase.functions.invoke('public-rr-installment-initiate', {...})` и редиректит на `payment_url`.

## 4. GAP: почему на живом сайте вызов не срабатывает

По снимку от 2026-07-10 09:00Z:

- Открытие `https://cb.gorbova.by` (легаси домен продукта) показывает preregistration overlay (`PreregistrationDialog`), а не `LeadRequestDialog`.
- Открытие `https://gorbova.by/cb` не проверялось Playwright в предыдущем прогоне.
- Цена в UI (1490/1690 BYN) не совпадает с БД (1650 BYN) — вероятно, блок страницы использует **захардкоженные значения** в `blocks.pricing`, а не источник из `tariff_offers`. Это требует проверки контента блоков `d5a5c2e0-...`.

## 5. Что должен подтвердить Gate B mini-plan

1. Какой конкретный блок на странице `cb` рендерит секцию тарифов и какой компонент отвечает за CTA (`UniversalPricingSection`, `ButtonSection` или кастомная секция).
2. Передаётся ли `tariff_offer_id = 15ce91ec-...` в этот блок как data reference на реальный оффер, или сумма/кнопка захардкожены в JSON блока.
3. Требуется ли: (а) обновить настройку блока в `site_pages.blocks`, чтобы CTA рендерил `LeadRequestDialog` для RR-оффера; (б) или подменить binding блока с preregistration на bank_installment offer.
4. Проверить два legacy bank_installment оффера (`2a07af43`, `4f64def7`) — по-прежнему ли они не имеют rr_runtime и открывают старый external_link/legacy lead flow.

Только после этого — mini-план UI patch + deploy + E2E.

## 6. Инструментарий для E2E (Gate B)

- Playwright headless, viewport 1280×1800.
- Прогон против preview URL с host-override невалиден (см. п. 13 согласованного плана): TLS/DNS/redirect на боевом domain могут отличаться.
- Финальный proof — после deploy, против фактического `https://gorbova.by/cb`.
- Если единственный доступный вариант — прогон на боевом `15ce91ec-...` (не test fixture), запросить у пользователя отдельное разрешение и заранее подготовить cleanup для одной строки orders_v2.
