да, согласен, с учетом правок:

1. **Scope нужно изменить: не только ЦБ, а единый canonical payment domain для всех public payment links.**  
Требование: все ссылки оплаты должны формироваться только на домене:
  &nbsp;
  ```text
  https://gorbova.by/pay/:token
  ```
  Не выбирать домен по продукту. Не использовать `products_v2.primary_domain` как origin для payment links.
2. **Не делать миграцию только по продуктам ЦБ как финальное решение.**  
Текущий план чинит симптом через `products_v2.primary_domain`, но оставляет архитектурную проблему: завтра другой продукт с `primary_domain` снова начнет генерировать оплату с другого домена.  
Нужно исправить builder:
  &nbsp;
  ```ts
  resolveCanonicalPaymentOrigin(...) → всегда https://gorbova.by
  ```
  или отдельная функция:
3. `products_v2.primary_domain` **не удалять и не ломать.**  
Он может оставаться для лендингов/роутинга/legacy, но **не должен управлять payment origin**.  
Связи и логика должны быть ID-driven, а не завязаны на домен/slug/название продукта. Это соответствует базовому правилу платформы: внутренние связи через UUID, а не через текстовые признаки.  
4. **Обязательно исправить обе реализации builder’а.**  
В плане явно указать:
  &nbsp;
  ```text
  src/utils/buildPublicPaymentUrl.ts
  supabase/functions/_shared/buildPublicPaymentUrl.ts
  ```
  Обе должны давать одинаковый результат:
5. **Backfill** `payment_links.public_url` **нужен глобальный, не только** `cb.gorbova.by`**.**  
Сделать dry-run:
  &nbsp;
  ```sql
  SELECT public_url, count(*)
  FROM payment_links
  WHERE public_url IS NOT NULL
  GROUP BY public_url;
  ```
  Затем обновлять все старые payment links с любым старым origin:
  ```sql
  UPDATE public.payment_links
     SET public_url = 'https://gorbova.by/pay/' || token,
         updated_at = now()
   WHERE token IS NOT NULL
     AND public_url IS DISTINCT FROM ('https://gorbova.by/pay/' || token);
  ```
  Перед Execute — показать количество затронутых строк.
6. **Добавить guard: path должен остаться** `/pay/:token`**.**  
Не делать `/cb/pay/:token`, `/club/pay/:token`, `/product/pay/:token`.  
Только:
7. **Проверить Stripe отдельно.**  
В DoD добавить обязательные проверки:
  - Stripe public link создается с `https://gorbova.by/pay/:token`;
  - переход на `/pay/:token` корректно открывает оплату;
  - Stripe Checkout создается успешно;
  - `success_url` / `cancel_url` тоже используют `gorbova.by`, если они генерируются из payment link origin;
  - webhook Stripe после оплаты корректно обновляет `orders_v2`, `payments_v2`, доступы и не зависит от старого домена.
8. **Проверить bePaid отдельно.**  
В DoD добавить:
  - bePaid public link создается с `https://gorbova.by/pay/:token`;
  - успешная оплата возвращает пользователя на корректный URL;
  - webhook bePaid не ломается;
  - `grant-access-for-order` вызывается как раньше.
9. **Старые домены оставить как safety-net, но не как canonical.**  
`DomainRouter.tsx`, CORS для `cb.gorbova.by`, legacy routing можно не трогать в этом патче.  
Но в плане явно написать:
10. **Цены ЦБ не включать в этот патч.**  
Верификация цен может быть отдельной диагностикой, но не смешивать с задачей canonical payment domain. Сейчас цель — единый домен оплаты и проверка Stripe/bePaid.
11. **Документацию обновить шире.**  
В `docs/PAYMENT_LINKS_AUDIT.md` добавить раздел:

```text
Canonical payment URL policy:
- all public payment links use https://gorbova.by/pay/:token
- product.primary_domain is not used for payment origin
- legacy domains are accepted only as compatibility routes
- Stripe/bePaid success/cancel/payment flows verified
```

12. **Финальный DoD заменить на системный:**

```text
1. Любая новая public payment link для любого продукта → https://gorbova.by/pay/:token.
2. В коде нет зависимости payment origin от products_v2.primary_domain.
3. payment_links.public_url после backfill не содержит cb.gorbova.by / club.gorbova.by / других origins.
4. Stripe payment link flow PASS.
5. bePaid payment link flow PASS.
6. Старые ссылки на старых доменах продолжают открываться как compatibility route.
7. Webhook/payment/access цепочка не изменилась.
8. UI-кнопки, admin-create-public-link, public checkout, subscription/installment flows не сломаны.
```

Итоговая формулировка для подрядчика: **не чинить отдельный продукт через** `primary_domain`**, а сделать единое правило — все payment links всегда** `https://gorbova.by/pay/:token`**, при сохранении legacy-доменов только как fallback.**

&nbsp;

План:

## Проблема

Публичные ссылки на оплату для продукта «Ценный бухгалтер | 1 ступень 2.0» генерируются с доменом `https://cb.gorbova.by/pay/:token`, хотя лендинг курса переехан на `https://gorbova.by/cb` (Site Builder). Причина: в `products_v2.primary_domain` у продукта (id `7101ed3c-…`) стоит `cb.gorbova.by`. Билдер ссылок (`src/utils/buildPublicPaymentUrl.ts` + одноимённая утилита в edge functions) берёт `product.primary_domain` как канонический origin.

## Diagnose

- SoT origin для `/pay/:token` — `resolveCanonicalPaymentOrigin(product.primary_domain)`; при валидном `primary_domain` возвращает `https://<primary_domain>`, иначе `https://club.gorbova.by`.
- Продукт `Ценный бухгалтер | 1 ступень 2.0` (`7101ed3c-7839-4a74-ad95-aa0660369b22`) имеет `primary_domain = 'cb.gorbova.by'` → все новые ссылки идут туда.
- Уже созданные ссылки лежат в `payment_links.public_url` со значением `https://cb.gorbova.by/pay/<token>` (writer записывает готовый URL).
- Модули «Ценный бухгалтер 2.0» (Учет у ИП, ПВТ, Маркетплейсы, Общепит, Производство, Розничная торговля, Строительство, Грузо-/пассажироперевозки, Предзапись) имеют `primary_domain = NULL` → они уже уходят на fallback `club.gorbova.by`. По логике их тоже нужно привязать к `gorbova.by` (иначе клиент попадёт на клубный лендинг вместо ЦБ).
- `DomainRouter.tsx` содержит хардкод `hostname === "cb.gorbova.by" → <CourseAccountant/>`. Домен физически может ещё резолвиться, но канонический лендинг теперь `gorbova.by/cb` (Site Builder). Правку роутера НЕ трогаем в этом патче — оставляем как safety-net, чтобы старые ссылки, разосланные ранее, продолжали открываться (см. DoD).

## План правок

### 1. Migration — перепривязать домен продуктов ЦБ на `gorbova.by`

Файл: `supabase/migrations/<ts>_cb_primary_domain_to_gorbova.sql`

```sql
-- Ценный бухгалтер 1 ступень 2.0 (основной продукт + модули) → gorbova.by
UPDATE public.products_v2
   SET primary_domain = 'gorbova.by',
       updated_at = now()
 WHERE id IN (
   '7101ed3c-7839-4a74-ad95-aa0660369b22', -- Ценный бухгалтер | 1 ступень 2.0
   'ea98d043-e852-443f-8807-6e77de6a5e1f', -- Модуль: Учет у ИП
   '99f1f156-f384-417e-bdf8-9203eb3c9d42', -- Модуль: ПВТ
   'd7effaf4-9be0-4ce2-971b-e02fe2a85a9a', -- Модуль: Маркетплейсы
   '9187db54-8f57-42eb-bbcb-d7103d2459a9', -- Модуль: Общепит
   '064dd768-de8b-40db-89bc-f8d4a7e442ba', -- Модуль: Производство
   'abee24cd-5c8b-4111-a6cb-7dee7acf168c', -- Модуль: Розничная торговля
   'f833c846-a78d-4096-9dac-b8417d588371', -- Модуль: Строительство
   '64d9f812-617c-41a8-b3dc-bb113156d6f3', -- Модуль: Грузо- и пассажироперевозки
   '11309c6a-6617-4c7f-8e92-df6a342ea6eb'  -- Модуль: Предзапись
 );

-- Backfill уже созданных публичных ссылок: cb.gorbova.by → gorbova.by
UPDATE public.payment_links
   SET public_url = REPLACE(public_url, 'https://cb.gorbova.by/', 'https://gorbova.by/'),
       updated_at = now()
 WHERE public_url LIKE 'https://cb.gorbova.by/%';
```

Продукты «Бухгалтерия как бизнес» и «ЦБ 2 ступень» не трогаем (у первого `primary_domain=NULL`, второй — отдельный лендинг). Если нужно — уточним отдельно.

### 2. Верификация цен (без правок кода)

- Сверить в БД `tariffs`/`tariff_prices`/`pricing_stages` для продукта `7101ed3c-…` с тем, что показано на `https://gorbova.by/cb` (1650 / 1950 / 2650 BYN при 100% оплате; рассрочка «от 138 / 163 / 221 BYN/мес × 12 мес»).
- Если расхождение — вынесу отдельным патчем с точечным UPDATE тарифов/цен (не делаю в текущем плане, чтобы не менять цены без явного подтверждения).

### 3. Ничего не меняем в других местах

- `buildPublicPaymentUrl.ts` и его edge-двойник не трогаем — они корректно берут `primary_domain` из БД.
- `DomainRouter.tsx` оставляем: `cb.gorbova.by` продолжит открывать `CourseAccountant` как fallback для уже разосланных писем/сообщений.
- `submit-lead-request/index.ts` (CORS allowlist `https://cb.gorbova.by`) оставляем — старый домен ещё может использоваться.

## DoD

1. `SELECT primary_domain FROM products_v2 WHERE id='7101ed3c-…'` → `gorbova.by`.
2. `SELECT count(*) FROM payment_links WHERE public_url LIKE 'https://cb.gorbova.by/%'` → `0`.
3. Создание новой public ссылки для любого тарифа ЦБ (через `admin-create-public-link` из `/admin/payments`) возвращает `public_url` вида `https://gorbova.by/pay/<token>`.
4. Открытие такой ссылки ведёт на страницу `/pay/:token` на `gorbova.by`, сумма и название тарифа совпадают с тем, что видно на `https://gorbova.by/cb`.
5. Старые ссылки на `cb.gorbova.by/pay/<token>` (уже отправленные клиентам, если такие есть) продолжают работать — домен `cb.gorbova.by` продолжает резолвиться и `DomainRouter` роутит `/pay/:token` в тот же `PublicPayPage`.

## Открытый вопрос

Подтвердить, что перепривязка модулей ЦБ (Учет у ИП, ПВТ, Маркетплейсы, Общепит, Производство, Розничная торговля, Строительство, Грузо-/пассажироперевозки, Предзапись) на `gorbova.by` — то, что нужно. Если модули продаются отдельными лендингами, назови какие исключить.