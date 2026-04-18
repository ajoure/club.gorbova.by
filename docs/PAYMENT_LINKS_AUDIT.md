# Audit: пути создания ссылок на оплату

## Verdict
**Все каналы создания ссылок ведут в один canonical downstream-path.** Расхождений нет.
**Локализация UI новой вкладки «Ссылки» выполнена полностью** — все строки на русском.

## Mapping каналов

| Канал | Writer | Таблица | Materialize order | Webhook terminal | CRM | Access | Telegram |
|---|---|---|---|---|---|---|---|
| Admin direct checkout | `admin-create-payment-link` | `orders_v2` | сразу | `bepaid-webhook` | да | да | да |
| Public link writer | `admin-create-public-link` | `payment_links` | при `/pay/:token` | `bepaid-webhook` | да | да | да |
| Public `/pay/:token` POST | `public-checkout` | `orders_v2` | сразу | `bepaid-webhook` | да | да | да |
| Site CTA / тарифы | `_shared/create-payment-checkout.ts` | `orders_v2` | сразу | `bepaid-webhook` | да | да | да |
| Subscription checkout | bePaid subscription flow | `subscriptions_v2` + `orders_v2` | сразу | `bepaid-webhook` | да | да | да |

`current_uses` инкрементируется ТОЛЬКО в `bepaid-webhook` через `_shared/consume-payment-link.ts`. Идемпотентность через `orders_v2.meta.payment_link_counted=true`.

## Source of truth
Таблица `payment_links` (одна). Канонический enriched-резолвер: view `payment_links_enriched_v` (security_invoker=on, RLS по `payment_links`).

## Русские названия колонок и статусов

| Колонка UI | Источник |
|---|---|
| Создана | `created_at` |
| Статус | derived (Активна / Недействительна / Истекла / Исчерпана) |
| Тип | `payment_type` (Разовая / Подписка) |
| Продукт / тариф | join `products_v2.name` / `tariffs.name` |
| Сумма | `amount` + `currency` |
| Получатель | `user_id` → `profiles` (или «Любой плательщик») |
| Создал | `created_by` → `profiles` |
| Использовано | `current_uses` / `max_uses` |
| Оплат | derived `paid_orders_count` |
| Истекает | `expires_at` |

## Что переиспользовано
- `Table/*` shell, `Badge`, `DropdownMenu`, `Sheet`, `AlertDialog`, `Dialog` из `@/components/ui/*`.
- `useProductsV2`, `useTariffs`, `useTariffOffers` для CreatePublicLinkDialog.
- `copyToClipboard` из `@/utils/clipboardUtils`.
- Visual language тулбара/таблицы из вкладки «Платежи».

## Что НЕ создано
- Никакого нового payment-path.
- Никакого второго writer'а в `payment_links`.
- Никакого DELETE по `payment_links`.

## Изменённые / новые файлы
**Новые:**
- `supabase/functions/admin-invalidate-payment-link/index.ts`
- `supabase/functions/admin-update-payment-link/index.ts`
- `src/hooks/usePaymentLinks.ts`
- `src/components/admin/payments/links/LinksTabContent.tsx`
- `src/components/admin/payments/links/LinkStatusBadge.tsx`
- `src/components/admin/payments/links/LinkDetailsDrawer.tsx`
- `src/components/admin/payments/links/CreatePublicLinkDialog.tsx`
- `src/components/admin/payments/links/EditPaymentLinkDialog.tsx`
- migration: view `payment_links_enriched_v` + RPC `admin_list_payment_links_enriched`

**Add-only правки:**
- `src/pages/admin/AdminPaymentsHub.tsx` — добавлена вкладка «Ссылки».
- `src/App.tsx` — добавлен route `/admin/payments/links`.

## Локализация
- Все labels, заголовки, тултипы, кнопки, статусы, confirm-диалоги, toast-сообщения — на русском.
- Внутренние имена БД (`payment_type`, `current_uses` и т.п.) в UI не показываются. ID — только как вторичная справочная строка в footer drawer'а.
