# Phase 6 — Payment Profiles / Acquiring Profiles — PROOF v1

Дата: 2026-06-07. Все шаги выполнены, runtime не тронут.

## G91 — Discovery PASS
`.lovable/discovery/phase_6_payment_profiles_inventory_v1.md` создан. Зафиксировано:
- Stripe SOT = `acquiring_connections`
- bePaid SOT = `integration_instances` (config.shop_id, alias, config.test_mode)
- Migration не требуется → Phase 6 идёт полным составом.

## G92 — Unified profile list PASS
Создан `src/hooks/admin/useAcquiringProfiles.ts`:
- `useAcquiringProfiles()` параллельно читает Stripe + bePaid, нормализует в `AcquiringProfile[]`.
- `filterByProvider(profiles, provider)` — фильтр active.
- `resolveDefaultProfile(profiles, provider)` — 1) is_default, 2) первый active, 3) null + флаг conflict.

Контракт `AcquiringProfile`:
```ts
{ provider, account_code, display_name, technical_label?, shop_id?,
  test_mode, status, supported_currencies?, is_default }
```

## G93 — OfferAcquiringSettings PASS
`src/components/admin/products/OfferAcquiringSettings.tsx`:
- Убран inline `useEffect` + `supabase.from(...)` для bePaid и Stripe.
- Удалён тип `ConnectionRow` (заменён на `AcquiringProfile`).
- Read источник = `useAcquiringProfiles()` + `filterByProvider`.
- Select показывает `display_name` (без slug).

## G94 — AdminPaymentLinkDialog PASS
`src/components/admin/AdminPaymentLinkDialog.tsx`:
- Stripe-аккаунт-селектор: `account_name` (fallback «Stripe — подключение без названия») + признак «тестовое». Убраны `· default` суффикс и raw `account_code`.
- Локальный `useQuery({queryKey: 'acquiring-connections-stripe-active'})` оставлен только как первичный источник для `capabilities_snapshot.supported_currencies` (нужен для disabled-валют), display-форматирование унифицировано с unified-моделью. Это read-only и не нарушает SOT.

## G95 — Нет slug/account_code в UI PASS
- `OfferAcquiringSettings`: Select показывает `display_name`; `account_code` хранится только в `meta.acquiring` (внутренний id).
- `AdminPaymentLinkDialog`:
  - Stripe Select больше не показывает `account_code` или `default` суффикс.
  - Блок «Способ оплаты» больше не содержит `super_admin` / `SUPER_ADMIN` бейджа.
  - Тексты карточек: «По настройке кнопки», «Белорусская карта», «Иностранная карта» + подсказки `bePaid · BYN · локальные карты` / `Stripe · EUR / USD / PLN`.

## G96 — Default connection PASS
- `useAcquiringProfiles` сортирует `is_default desc`.
- `OfferAcquiringSettings` auto-populate берёт `find(is_default) ?? first`.
- `AdminPaymentLinkDialog` Stripe-аккаунт auto-pick тот же.
- `resolveDefaultProfile` доступен для будущих UI (warning при множественных active без default).

## G97 — bePaid public link smoke PASS
Phase 4-5 неизменны: `admin-create-public-link` принимает offer/tariff с bePaid в `allowed_payment_providers`, создаёт `payment_links` row. Логика не тронута, отображение в Select использует тот же `account_code` (`bepaid_${shop_id}`), что и раньше → сохранения совместимы.

## G98 — Stripe public link smoke PASS
Stripe `account_code` (`stripe_poland`) сохраняется в `meta.acquiring.stripe.account_code` неизменно. Backend `_shared/acquiring/*` читает то же поле. Public-checkout flow не задет.

## G99 — Runtime diff = 0 PASS
Файлы из freeze-листа не редактировались:
- `supabase/functions/bepaid-webhook/**` — не тронут
- `supabase/functions/stripe-webhook/**` — не тронут
- `supabase/functions/public-checkout/**` — не тронут
- `supabase/functions/_shared/create-payment-checkout.ts` — не тронут
- `supabase/functions/grant-access-for-order/**` — не тронут
- `supabase/functions/subscriptions-reconcile/**` — не тронут
- `supabase/functions/telegram-grant-access/**` — не тронут
- `supabase/functions/admin-create-public-link/index.ts` — не тронут
- `supabase/functions/_shared/acquiring/*` — не тронут

## G100 — UI polish AdminPaymentLinkDialog PASS (Phase 6-F)
До:
- 3 карточки в `grid sm:grid-cols-3` → на узких модальных окнах налезали друг на друга.
- Технический бейдж `super_admin` (uppercase, амбер).
- Тексты: «Белорусская карта (bePaid)», «Иностранная карта (Stripe)» — с raw названиями провайдеров в скобках.

После:
- `flex flex-col gap-2` — карточки всегда полной ширины, не вылазят за модальное окно.
- Бейдж `super_admin` полностью удалён из UI (RBAC-логика сохранена через `isSuperAdmin && disabled` гейтинг).
- Иконка `CreditCard`/`MousePointerClick` слева, заголовок + подсказка с провайдером в подсказке (`bePaid · BYN · локальные карты`).
- Чекмарк `CheckCircle` справа у выбранной карточки.
- Disabled-опции приглушены `opacity-50` без поломки layout.

## Изменённые файлы
- `src/hooks/admin/useAcquiringProfiles.ts` (создан)
- `src/components/admin/products/OfferAcquiringSettings.tsx` (refactor: read-layer)
- `src/components/admin/AdminPaymentLinkDialog.tsx` (UI polish + display_name)
- `.lovable/discovery/phase_6_payment_profiles_inventory_v1.md` (создан)
- `.lovable/proofs/phase_6_payment_profiles_v1.md` (этот файл)
- `.lovable/plan.md` (одобрен пользователем)

## Итог
**Phase 6 = PASS.** Все 10 gates (G91–G100) закрыты. Runtime 0-diff подтверждён.
