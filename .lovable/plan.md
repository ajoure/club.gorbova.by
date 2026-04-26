да, согласен, с учетом правок:

1. **Не использовать request origin вообще для клиентских payment links**
  - Для ссылок, которые уходят клиенту, источник должен быть только:
  - req.headers.origin можно использовать только для internal return_url, но не для публичной ссылки /pay/:token.
2. **public_url в БД — правильный вариант**
  - Добавить payment_links.public_url.
  - Новые ссылки сохранять уже с каноническим URL.
  - Старые ссылки backfill:
3. **Обязательная валидация домена**  
Перед сохранением:
  - запретить [lovable.dev](http://lovable.dev);
  - запретить [lovable.app](http://lovable.app);
  - запретить [lovableproject.com](http://lovableproject.com);
  - запретить localhost;
  - запретить пустой/битый host;
  - нормализовать без trailing slash.
4. **primary_domain проверять строго**  
Если product.primary_domain есть, он должен быть валидным host, например:  
[club.gorbova.by](http://club.gorbova.by)
5. [gorbova.by](http://gorbova.by)  
Не принимать:
6. **Frontend больше не должен собирать /pay через window.location.origin**  
Заменить в активном коде:
  - LinksTabContent.tsx
  - LinkDetailsDrawer.tsx
  - clipboardUtils.ts
7. Архивный src/archive/... можно не трогать, но grep-proof должен исключать archive.
8. **AdminPaymentLinkDialog должен брать URL из ответа edge function**  
Не пересобирать URL на фронте после создания. Источник истины — public_url, возвращённый admin-create-public-link.
9. **Return URL для bePaid — отдельный subpatch**  
Можно включить превентивно, но не смешивать с public payment links:
  - public link: /pay/:token на canonical domain;
  - bePaid return_url: callback/return после оплаты, тоже не должен быть preview-domain.
10. **Audit**  
В audit_logs.meta добавить:
11. **STOP-guards**  
Остановиться, если:
  - новая ссылка содержит lovable;
  - public_url NULL после backfill;
  - frontend всё ещё использует window.location.origin + /pay;
  - edge function возвращает URL без https://;
  - product primary domain невалиден;
  - меняется логика public-checkout / оплаты / webhook.
12. **DoD дополнить**

- новая ссылка из preview-админки возвращает [https://club.gorbova.by/pay/](https://club.gorbova.by/pay/)...

- SQL: payment_links.public_url ILIKE '%lovable%' = 0

- SQL: payment_links.public_url IS NULL = 0

- grep: нет window.location.origin для /pay в активном коде

- drawer/table/copy используют public_url

- audit_logs содержит origin_source

- bePaid return_url не уходит на Lovable preview

Готовый блок для Lovable:

Дополни план следующими обязательными правками:

&nbsp;

1. Для публичных payment links запретить использование `window.location.origin`, `req.headers.origin` и любых preview/editor-доменов Lovable как источника публичного URL.

&nbsp;

2. Источник публичного URL:

   - `product.primary_domain`, если валиден;

   - иначе canonical fallback `https://club.gorbova.by`.

&nbsp;

3. Добавить колонку `payment_links.public_url text`.

&nbsp;

4. Новые payment links создавать и сохранять сразу с `public_url`.

&nbsp;

5. Сделать idempotent backfill:

   `public_url = 'https://club.gorbova.by/pay/' || url_token`

   для всех старых строк, где `public_url IS NULL`.

&nbsp;

6. Добавить строгую валидацию домена:

   - запретить `lovable.dev`;

   - запретить `lovable.app`;

   - запретить `lovableproject.com`;

   - запретить `localhost`;

   - запретить пустой/битый host;

   - нормализовать host без trailing slash.

&nbsp;

7. Обновить:

   - `supabase/functions/admin-create-public-link/index.ts`

   - `src/components/admin/payments/links/LinksTabContent.tsx`

   - `src/components/admin/payments/links/LinkDetailsDrawer.tsx`

   - `src/utils/clipboardUtils.ts`

   - `AdminPaymentLinkDialog`, если он пересобирает URL на фронте.

&nbsp;

8. Frontend должен показывать и копировать `payment_links.public_url`, а не собирать ссылку сам.

&nbsp;

9. В `audit_logs.meta` для создания ссылки добавить:

   - `public_url`;

   - `origin_source`;

   - `request_origin`;

   - `request_origin_ignored`.

&nbsp;

10. Отдельно проверить edge functions, где формируется bePaid `return_url`, и заблокировать Lovable preview-origin для return_url.

&nbsp;

11. STOP-guards:

   - не менять public-checkout бизнес-логику;

   - не менять webhook bePaid;

   - не менять платежные статусы;

   - не менять `/pay/:token` routing;

   - не трогать archive-код;

   - остановиться, если новая ссылка содержит Lovable-домен.

&nbsp;

12. DoD:

   - новая ссылка из preview-админки ведет на `https://club.gorbova.by/pay/...` или валидный `primary_domain`;

   - `SELECT count(*) FROM payment_links WHERE public_url ILIKE '%lovable%'` = 0;

   - `SELECT count(*) FROM payment_links WHERE public_url IS NULL` = 0;

   - grep не находит `window.location.origin` для `/pay` в активном коде;

   - table/drawer/copy используют `public_url`;

   - audit_logs содержит `origin_source`;

   - bePaid return_url не указывает на Lovable preview;

   - финальный отчет содержит diff-summary, SQL-proof и пример созданной ссылки.

&nbsp;

# План: канонический домен для платёжных ссылок

## Проблема

Клиент получил ссылку вида `https://lovable.dev/auth-bridge?project_id=...` → "Access denied". Причина: ссылка `/pay/:token` была сгенерирована из preview-окружения админки (`id-preview--*.lovable.app` или редактор `lovable.dev`), и URL сшивался от текущего origin.

### Корневые места (Diagnose)

1. **Edge `supabase/functions/admin-create-public-link/index.ts:165-168**` — единственный канонический writer публичных ссылок. Берёт `req.headers.get('origin')` → если админ работает из preview, `origin = https://id-preview--*.lovable.app` → возвращает ссылку на preview Lovable. Открытие preview-домена непавторизованным пользователем → редирект на `lovable.dev/auth-bridge` → Access denied (скрин клиента).
2. **Frontend `src/components/admin/payments/links/LinksTabContent.tsx:97**` и `**LinkDetailsDrawer.tsx:59**` — для отображения и копирования URL в админке используют `${window.location.origin}/pay/${token}`. Если ссылка была создана давно с правильным origin, но админ открывает её сейчас из preview — в UI отобразится preview-URL, и админ скопирует его клиенту.
3. `**src/utils/clipboardUtils.ts:38**` — функция копирования `/pay?product=...` тоже зависит от `window.location.origin`.

## Решение

Ввести единый канонический origin для всех публичных платёжных ссылок. Приоритет:

1. `product.primary_domain` (если у продукта задан домен — берём его, например `business-training.gorbova.by`).
2. Фолбэк-константа `https://club.gorbova.by`.

`window.location.origin` и `req.headers.origin` использовать **только** для случаев, когда хост гарантированно не Lovable preview (т.е. как дополнительный сигнал, но не как источник истины).

### Изменения

**1. `supabase/functions/admin-create-public-link/index.ts**`

- Добавить выборку `primary_domain` из `products_v2` по `product_id` (запрос уже идёт в этой функции для валидации продукта — расширить SELECT).
- Заменить блок выбора origin (строки 164-168):
  ```ts
  const PROD_FALLBACK = 'https://club.gorbova.by';
  const isLovablePreview = (host: string) =>
    host.includes('lovable.dev') ||
    host.includes('lovable.app') ||
    host.includes('lovableproject.com');

  let origin = product?.primary_domain
    ? `https://${product.primary_domain}`
    : PROD_FALLBACK;

  // Только если запрос пришёл с настоящего публичного домена клиента — уважим его.
  const reqOrigin = req.headers.get('origin');
  if (!product?.primary_domain && reqOrigin && !isLovablePreview(new URL(reqOrigin).hostname)) {
    origin = reqOrigin;
  }
  ```
- Добавить `origin_source` (`'product_primary_domain' | 'fallback' | 'request_origin'`) в `audit_logs.meta` для трассируемости.

**2. Новый утиль `src/utils/buildPublicPaymentUrl.ts**`

- Экспортирует:
  - `CANONICAL_PUBLIC_HOST = 'https://club.gorbova.by'`
  - `isLovablePreviewHost(host: string): boolean`
  - `buildPublicPayUrl(token: string, productPrimaryDomain?: string | null): string`
  - `buildProductPayUrl(productId: string, productPrimaryDomain?: string | null): string`
- Логика та же: primary_domain → preview-aware origin → fallback.

**3. `src/components/admin/payments/links/LinksTabContent.tsx**`

- `PaymentLinkRow` уже содержит `product_id`/`product_name`, но не `primary_domain`. Расширить RPC `get_admin_payment_links_v1` либо добавить join в селекторе. **Минимальный путь без миграции**: использовать сохранённый `public_url` из `audit_logs.meta` или просто хранить канонический URL непосредственно в `payment_links` (новая колонка `public_url text`).
- Принятый вариант: добавить колонку `payment_links.public_url text` (миграция), заполняемую writer'ом `admin-create-public-link` уже с правильным origin. Frontend показывает её как есть, не пересобирая.
- Backfill миграцией: для существующих строк `UPDATE payment_links SET public_url = 'https://club.gorbova.by/pay/' || url_token WHERE public_url IS NULL`.
- В `LinksTabContent.tsx` и `LinkDetailsDrawer.tsx` заменить `buildPublicUrl(token)` на `link.public_url ?? buildPublicPayUrl(token)` (фолбэк на утиль).

**4. `src/utils/clipboardUtils.ts**`

- `getProductLink(productId)`: использовать `buildProductPayUrl(productId)` (без primary_domain — простой путь `/pay?product=`). Клиент-сайд не имеет информации о домене конкретного продукта здесь, поэтому идёт на `CANONICAL_PUBLIC_HOST`.

**5. `src/archive/pages/AdminProducts.tsx:354**` — архивный код, не трогаем.

### Edge-функции, которые тоже строят URL для оплаты (вне scope, отдельно отмечу в отчёте)

`admin-manual-charge`, `public-checkout`, `direct-charge`, `bepaid-create-subscription` — все строят `return_url` для bePaid checkout, а не публичную ссылку, отправляемую клиенту в Telegram. Они уже имеют фолбэк `https://club.gorbova.by`, но в них тоже есть зависимость от `req.headers.origin`. Включаю в этот же патч превентивную защиту: если origin — Lovable preview, игнорируем и используем фолбэк. Это не источник текущего инцидента, но защитит `return_url` после оплаты от того же класса ошибок.

## Definition of Done

1. **Writer (edge `admin-create-public-link`)**: при любом origin запроса возвращает `public_url` на канонический домен (primary_domain продукта или `club.gorbova.by`). Никогда не возвращает `*.lovable.app` / `lovable.dev` / `*.lovableproject.com`.
2. **БД**: `payment_links.public_url` заполнено для всех существующих и новых строк, без preview-доменов.
3. **UI админки**: вкладка `/admin/payments/links` и drawer показывают `public_url` из БД (или фолбэк), копирование даёт канонический URL даже при работе из preview.
4. `**AdminPaymentLinkDialog**`: после создания ссылки `generatedUrl` = канонический URL.
5. **Edge `admin-manual-charge`, `public-checkout`, `direct-charge`, `bepaid-create-subscription**`: `return_url` никогда не указывает на Lovable preview — preview-origin отбрасывается, используется фолбэк/primary_domain.
6. **Audit**: в `audit_logs` для `payment_link.created` добавлено поле `meta.origin_source`.
7. **Proof**:
  - `grep` подтверждает: нет `${window.location.origin}/pay` в активном коде (кроме архива).
  - SQL-проверка: `SELECT count(*) FROM payment_links WHERE public_url ILIKE '%lovable%'` = 0.
  - Симуляция: создать ссылку из preview-окружения, проверить, что возвращённый `public_url` начинается с `https://club.gorbova.by/pay/` или primary_domain продукта.
  - Скрин админки с корректным URL в drawer/таблице.

## Что НЕ делаем (явные out-of-scope)

- Не меняем формат `/pay/:token` и логику public-checkout.
- Не меняем routing/SPA-fallback.
- Не трогаем archive/.
- Не запускаем cleanup/массовые операции, кроме backfill `public_url` (idempotent UPDATE).