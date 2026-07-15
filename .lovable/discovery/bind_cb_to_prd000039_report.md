# Отчёт о выполнении: привязка gorbova.by/cb к PRD-000039

Дата: 2026-07-15
Discovery: `.lovable/discovery/bind_cb_to_prd000039.md`

## Что сделано

Одна транзакционная миграция (без изменений схемы, без изменений кода):

1. **Preflight (fail-closed)** — проверил все 7 инвариантов из discovery: состояние /cb, /cb20, продуктов, тарифов, уникального индекса, checksum блока.
2. **Заблокировал строки** `site_pages` через `FOR UPDATE` от параллельных изменений.
3. **Rebind /cb**: `site_pages.product_id` для `d5a5c2e0-9e4c-4e6c-b9bc-1e4bd264d656` изменён с `7101ed3c-…` (OLD, PRD-000003) на `3e43fb28-…` (NEW, PRD-000039).
4. **Архивация /cb20**: slug переименован в `cb20-archive-20260715140921`, статус остался `draft`, `product_id` был и остался `NULL`.
5. **Удалён domain binding /cb20** (id `5b77e817-…`) — `gorbova.by/cb20` больше не резолвится.
6. **Postflight (fail-closed)** — 5 инвариантов подтверждены внутри той же транзакции.

## Postflight — фактические значения

| Инвариант | Ожидание | Факт |
|---|---|---|
| `/cb` → NEW product_id | 1 строка | ✅ 1 |
| Ноль страниц с OLD product_id | 0 | ✅ 0 |
| OLD product `is_active` | true | ✅ true |
| md5 блока /cb до/после | `25e8a317df176accd562f10e2f388b30` | ✅ идентичен |
| slug `cb20` не резолвится | 0 | ✅ 0 (переименован в `cb20-archive-20260715140921`) |
| Binding `cb20` удалён | 0 | ✅ 0 |

## Что не менялось (гарантии)

- HTML содержимое `/cb` — checksum блока `25e8a317df176accd562f10e2f388b30` идентичен pre/post.
- Код `src/` — 0 файлов изменено.
- Продукт PRD-000003: `is_active=true`, все тарифы, offers, orders, subscriptions, entitlements, документы, `access_grant_ledger` — не затронуты.
- `payment_reconcile_queue`, `payments_v2`, `orders_v2` — не затронуты.
- Никаких изменений в `site_pages.blocks`, `theme_settings`, `seo_settings`, `metadata`.

## Как теперь работает /cb

`gorbova.by/cb` рендерит тот же Tilda-HTML, что и раньше (pixel-perfect). Существующая инфраструктура `SitePageBySlug` + iframe site-action bridge теперь резолвит `data-tariff-key="buh|gl_buh|biz-l"` против тарифов **PRD-000039**:

- `buh` → тариф «Бухгалтер» (`38ee08c4-...`)
- `gl_buh` → «Главный бухгалтер» (`a18df7a7-...`)
- `biz-l` → «Бизнес-леди» (`767bb895-...`)

Клик по кнопкам открывает канонический dialog с реальным `productId`/`offerId` PRD-000039:
- «Оплатить обучение / Оплата картой» → `PaymentDialog` (offer_type=pay_now, full_payment).
- «Оплатить в рассрочку / Рассрочка на 3 месяца / Оплатить в два этапа» → `PaymentDialog` (internal_installment).
- «Оплатить от ЮЛ» → `InvoiceCheckoutDialog`.
- «Оставить заявку» → `LeadRequestDialog` (offer_type=lead).
- «Заявка на рассрочку / Оплатить в рассрочку от банка» → `LeadRequestDialog` (bank_installment).

Все три тарифа PRD-000039 имеют полный набор активных offers для этих flow (Бухгалтер: без активного lead и internal_installment — это решение админа продукта, не миграции).

## Что осталось за scope (Phase B, backlog)

Свойство существующего HTML-блока Tilda, не задача текущей миграции:

1. Тексты кнопок в HTML статичны — изменение `button_label` в админке не подставляется в надпись Tilda-кнопки автоматически.
2. Отключённый offer не скрывает кнопку визуально — кнопка остаётся, при клике логируется warning в console, dialog не открывается.
3. `sort_order` в админке не переупорядочивает существующие кнопки на /cb.
4. Новый offer не появляется автоматически как новая кнопка на странице.

Решение — Phase B: server-side substitution через слоты в `HtmlSection`. Не блокирует канонический payment flow, вынесено в backlog.

## Rollback (готов к применению)

Одна обратная миграция (см. discovery §11): вернуть `/cb.product_id` на OLD, переименовать архивный slug обратно в `cb20`, восстановить binding. Код не меняется, релиз не требуется.

## Артефакты

- `/mnt/documents/bind_cb/cb_html_before.html` — дамп HTML /cb (3 042 331 B, md5 `bd5e0e3213b3e55dcf8d023231ffc7f5`).
- `.lovable/discovery/bind_cb_to_prd000039.md` — discovery.
- Эта запись — отчёт.

## Статус

**PASS.** Миграция выполнена атомарно, все инварианты подтверждены. Публичная страница `gorbova.by/cb` теперь ведёт на PRD-000039 без изменения дизайна.
