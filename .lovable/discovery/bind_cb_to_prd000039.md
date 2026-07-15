# Discovery: привязка gorbova.by/cb к PRD-000039

Дата: 2026-07-15
Задача: перепривязать публичную страницу `gorbova.by/cb` от старого продукта PRD-000003 к новому продукту PRD-000039 («Ценный бухгалтер. Первая ступень 2.0 | 20 поток») с сохранением текущего дизайна пиксель-в-пиксель.

## 1. Факты по продуктам

| Product | UUID | Public ID | Code | Name | is_active |
|---|---|---|---|---|---|
| OLD | `7101ed3c-7839-4a74-ad95-aa0660369b22` | PRD-000003 | `cb20` | Ценный бухгалтер \| 1 ступень 2.0 | true |
| NEW | `3e43fb28-8322-41bc-bfee-714731bdc630` | PRD-000039 | `prd_7222cb3152c3` | Ценный бухгалтер \| 1 ступень 2.0 \| 20 поток | true |

Требование пользователя: OLD остаётся `is_active=true`, но без публичной страницы. Никаких изменений его тарифов, offers, orders, subscriptions, entitlements.

## 2. Тарифы NEW и матчинг data-tariff-key

| tariff_key (в HTML) | Матчер (regex по name) | Тариф NEW | UUID |
|---|---|---|---|
| `buh` | `/^бухгалтер/i` | Бухгалтер | `38ee08c4-21db-4a97-86e6-303bd96c48db` |
| `gl_buh` | `/главн\S*\s+бухгалтер/i` | Главный бухгалтер | `a18df7a7-9c8b-4e63-9ea9-b6887c23927f` |
| `biz-l` | `/бизнес.?леди/i` | Бизнес-леди | `767bb895-30fa-49c9-8f31-d0794590020a` |

Три тарифа NEW полностью соответствуют матчерам, определённым в `src/pages/SitePageBySlug.tsx` (`TARIFF_KEY_NAME_MATCH`). Дополнительный код не требуется.

## 3. Активные offers NEW (сводка)

- **Бухгалтер**: `pay_now/full_payment` (Оплата картой, Оплатить от ЮЛ), `bank_installment` (Оплатить в рассрочку от банка). `lead` и `pay_now/internal_installment` — is_active=false (решение админа продукта, не задача миграции).
- **Главный бухгалтер**: `pay_now/full_payment` (Оплатить обучение, Оплатить от ЮЛ), `pay_now/internal_installment` (×2: Оплатить в два этапа, Рассрочка на 3 месяца), `bank_installment`, `lead` — все активны.
- **Бизнес-леди**: `pay_now/full_payment` (Оплатить обучение, Оплатить от ЮЛ), `pay_now/internal_installment`, `bank_installment`, `lead` — все активны.

Всего 16 offers у трёх тарифов, из них 14 активных. Реальные UUID приведены в отдельной выгрузке БД (см. отчёт).

## 4. Страница /cb

- `site_pages.id` = `d5a5c2e0-9e4c-4e6c-b9bc-1e4bd264d656`
- `slug` = `cb`, `status` = `published`
- `product_id` (до миграции) = `7101ed3c-7839-4a74-ad95-aa0660369b22` (OLD)
- `blocks_count` = 1
- `blocks_md5` (до миграции) = `25e8a317df176accd562f10e2f388b30`
- Дамп HTML: `/mnt/documents/bind_cb/cb_html_before.html`, размер 3 042 331 байт, md5 = `bd5e0e3213b3e55dcf8d023231ffc7f5`
- Тип единственного блока: `html` (Tilda-экспорт, ключ `content.code`)
- Domain binding: `da01e3d7-de03-4c81-89fb-ac6bd1de1e5c` → `gorbova.by`, is_primary=false, is_home=false

## 5. Ключевой архитектурный факт (снимает главный инвариант плана)

Проверено чтением `src/pages/SitePageBySlug.tsx` (строки 40–190) и `src/components/shared/HtmlIframePreview.tsx` (site-action bridge):

- HTML-блок `/cb` рендерится в изолированном iframe (`allow-scripts allow-forms`, БЕЗ `allow-same-origin`).
- Bridge внутри iframe уже перехватывает клики по элементам с `data-lovable-action="…"` и постит `site-action` в parent.
- В HTML `/cb` уже размечены три группы кнопок через `data-lovable-action` + `data-tariff-key="buh|gl_buh|biz-l"` и один из flow: `open-payment | open-installment | open-invoice | open-lead | open-bank-installment | open-preregistration`.
- Parent (`SitePageBySlug`) резолвит `tariff_key` по имени тарифов **linked product** (`page.product_id`) через `TARIFF_KEY_NAME_MATCH`, выбирает offer по flow через `pickOfferForFlow`, открывает канонический dialog (`PaymentDialog` / `InvoiceCheckoutDialog` / `LeadRequestDialog` / `PreregistrationDialog`).
- Никаких UUID продукта/тарифа/offer в HTML нет — HTML source-of-truth независим от продуктового контекста.

**Вывод:** для смены продуктового источника достаточно перепривязать `site_pages.product_id`. HTML не редактируется, checksum блока остаётся идентичен (`25e8a317df176accd562f10e2f388b30`). Дизайн, тексты, цены-подписи, блоки преимуществ, popup-формы Tilda — всё сохраняется без единого изменения.

## 6. Что становится динамическим после миграции

Кнопки на `/cb` начинают вести на канонический payment/lead/installment flow **нового продукта**:

- `product_id`, `tariff_id`, `offer_id` — вычисляются в parent из данных PRD-000039 через `usePublicProduct(page.product_id)` без релиза;
- цены, `internal_installment` условия, `bank_installment` метаданные, `invoice-only` признак — берутся из active offers PRD-000039;
- если админ отключит offer в PRD-000039 (`is_active=false`), при клике `pickOfferForFlow` вернёт `null`, warning в console, dialog не откроется (существующее поведение bridge);
- если админ включит offer обратно — кнопка снова работает без релиза.

## 7. Известные ограничения текущего HTML-блока (вне scope миграции)

Эти ограничения — **свойство HTML-блока Tilda**, а не задачи привязки:

1. Тексты кнопок в HTML статичны (Tilda-разметка). Изменение `button_label` в админке не подставляется автоматически в надпись Tilda-кнопки. Требует Phase B — server-side substitution в `HtmlSection` через слоты. Не блокирует канонический payment flow.
2. Кнопка отключённого offer визуально не исчезает — она остаётся в HTML. При клике корректно логируется warning и dialog не открывается. Полное скрытие требует Phase B.
3. Порядок кнопок фиксирован в HTML (Tilda layout). Изменение `sort_order` в админке не переупорядочивает существующие кнопки на /cb. Также Phase B.
4. Новый offer не появится в HTML автоматически — нужен новый слот. Также Phase B.

Эти пункты **явно исключены из текущей миграции** и остаются в backlog как отдельная задача «Phase B: слоты действий в HTML /cb».

## 8. Страница /cb20 (архивация)

- `site_pages.id` = `7209f904-fa33-46f2-bf58-48e30bf6535d`
- `slug` = `cb20`, `status` = `draft` (уже draft)
- `product_id` = NULL (уже не привязана)
- `blocks_count` = 11
- Domain binding: `5b77e817-86b6-4b70-b28e-182fe68c968e` → `gorbova.by`, is_primary=false, is_home=false

Действия по архивации:
- переименовать slug в `cb20-archive-YYYYMMDDHH24MISS`;
- удалить domain binding, чтобы `gorbova.by/cb20` перестал резолвиться;
- страница-запись сохраняется (audit trail) в статусе draft;
- физический DELETE страницы не выполняется.

Прочие страницы (`cb20predzapis`, `cb20versia`, `cbold`, `predzapiscb20`, `predzapiscb20anketa`) не затрагиваются.

## 9. Preflight/postflight инварианты миграции

Все проверки выполняются внутри одной транзакции, `search_path=public,pg_temp`, fail-closed через `RAISE EXCEPTION`:

**Preflight:**
1. Ровно одна `site_pages` со `slug='cb'`, `product_id='7101ed3c-...'` (OLD).
2. NEW product PRD-000039 существует, `is_active=true`.
3. Три тарифа NEW существуют, `is_active=true`, имена соответствуют матчерам.
4. Ноль страниц с `product_id='3e43fb28-...'` (уникальный индекс не будет нарушен).
5. Для `cb20`: `product_id IS NULL`, ровно одна строка со `slug='cb20'`, ровно один binding.

**Postflight:**
1. Ровно одна страница `slug='cb'` с `product_id='3e43fb28-...'`.
2. Ноль страниц с `product_id='7101ed3c-...'`.
3. OLD product `is_active=true` (не тронут).
4. Блок `/cb` не изменён: `md5(blocks::text) = '25e8a317df176accd562f10e2f388b30'`.
5. Резолв `gorbova.by/cb20` больше невозможен (нет binding с этим slug'ом + slug переименован).

## 10. Verify после миграции

- Загрузить `https://gorbova.by/cb` и убедиться, что secondary-скриншот совпадает с `cb_html_before.html`-рендером (визуал pixel-perfect — HTML не менялся).
- Проверить, что клики по трём кнопкам «Оплатить» открывают `PaymentDialog` с `productId=3e43fb28-...` и корректным `offerId` из PRD-000039.
- Проверить клик по кнопке рассрочки → `PaymentDialog` с `payment_method='internal_installment'`.
- Проверить клик по кнопке банковской рассрочки → `LeadRequestDialog` (`bank_installment`).
- Проверить `/cb20` → 404 (страница не резолвится).
- В админке PRD-000039 карточка страниц показывает `cb`.

## 11. Rollback

Одна обратная миграция (готова к применению при необходимости):

```sql
BEGIN;
UPDATE site_pages
   SET product_id = '7101ed3c-7839-4a74-ad95-aa0660369b22'
 WHERE id = 'd5a5c2e0-9e4c-4e6c-b9bc-1e4bd264d656';

UPDATE site_pages
   SET slug = 'cb20', status = 'draft'
 WHERE id = '7209f904-fa33-46f2-bf58-48e30bf6535d';

INSERT INTO site_domain_bindings (id, workspace_id, site_page_id, domain, is_primary, is_home, created_by)
VALUES ('5b77e817-86b6-4b70-b28e-182fe68c968e',
        '00000000-0000-0000-0000-000000000000',
        '7209f904-fa33-46f2-bf58-48e30bf6535d',
        'gorbova.by', false, false,
        (SELECT created_by FROM site_pages WHERE id='7209f904-fa33-46f2-bf58-48e30bf6535d'));
COMMIT;
```

Код `src/` не меняется — rollback не требует релиза.
