Да, согласен, с учетом правок:

&nbsp;

1. Серверный conflict-guard в public-product всё равно нужен.  
Нельзя убирать его только потому, что хук “передаёт один параметр”.  
Edge Function должна сама валидировать:  

  - передан только один lookup-ключ, или
  - если передано несколько — они должны резолвиться в один и тот же продукт, иначе controlled error 409/400.
2. &nbsp;
3. Не ограничивай anti-regression только usePublicProduct.  
Добавь в discovery отдельную проверку:  

  - все места, где pricing/CTA/checkout используют [product.id](http://product.id), product.code, domain, slug;
  - особенно подтвердить, что после перевода страниц CTA и checkout берут тот же resolved product, а не резолвят продукт повторно по другому признаку.
4. &nbsp;
5. ProductPricing.tsx не просто “не трогать”, а явно классифицировать.  
Раз он использует usePublicProductBySlug(slug), в плане нужно зафиксировать:  

  - это отдельный intentional resolver-path;
  - он не конфликтует с новым canonical explicit binding для page-based лендингов;
  - slug здесь не используется как замена code для остальных страниц.  
  Иначе потом снова начнут смешивать slug, domain, code.
6. &nbsp;
7. Для public-product добавь proof-ответ, по какому ключу продукт был найден.  
Например, в ответе EF вернуть мета-поле:  

  - resolved_by: 'product_id' | 'product_code' | 'domain'
  - resolved_value: ...  
  Это сильно упростит forensic и regression-proof.
8. &nbsp;
9. В productPages.ts лучше хранить не только code, но и комментарий/назначение страницы.  
Минимум:  

  - consultation
  - club
  - buh_business  
  И прямо зафиксировать, что это page-binding config, а не source of truth продукта. Source of truth по-прежнему БД.
10. &nbsp;
11. PATCH B (исправление primary_domain) не должен блокировать PATCH A.  
Это у тебя уже разделено, но добавь жёстко:  

  - даже если DB config-fix не применён,
  - explicit binding по code уже должен полностью чинить preview и production page rendering.
12. &nbsp;
13. Нужен один дополнительный negative-proof на mismatch.  
Проверить кейс:  

  - product_code=consultation
  - domain=[club.gorbova.by](http://club.gorbova.by)  
  EF должна вернуть controlled conflict error, а не молча консультацию или клуб.
14. &nbsp;
15. Уточни, что slug у buh_business сейчас нестабилен для routing-proof.  
У тебя в таблице видно, что slug там фактически URL-подобный. Значит, в плане нужно прямо написать:  

  - slug не использовать как canonical explicit key для page-binding этого продукта.
16. &nbsp;
17. Уточни финальный список entrypoints как closed scope текущего PATCH.  
Напиши явно:  

  - scope текущего патча ограничен найденными файлами из grep;
  - если в реализации обнаружатся дополнительные public pricing/product entrypoints, они добавляются add-only в этот же PATCH.
18. &nbsp;
19. DoD усили.  
Добавь два пункта:

&nbsp;

&nbsp;

&nbsp;

- public-product корректно резолвит продукт по code и возвращает resolved_by=product_code;
- на страницах консультации / клуба / бизнес-тренинга тарифы и checkout используют один и тот же [product.id](http://product.id) без повторного альтернативного резолва.

&nbsp;

&nbsp;

В остальном направление правильное:

расширять существующий usePublicProduct, использовать уникальный products_v2.code, вынести page-binding в единый config и оставить DomainRouter только как legacy fallback.

&nbsp;

# План: Единый canonical resolver для публичного продукта

## Discovery: DB-proof по `code` в `products_v2`

### Колонка `code` существует и имеет UNIQUE constraint

```
INDEX: products_v2_code_key — CREATE UNIQUE INDEX products_v2_code_key ON public.products_v2 USING btree (code)
```

### Реальные значения трёх ключевых продуктов


| Продукт                | UUID           | `code` (unique) | `slug`                                      | `primary_domain`                 |
| ---------------------- | -------------- | --------------- | ------------------------------------------- | -------------------------------- |
| Gorbova Club           | `11c9f1b8-...` | `club`          | `club.gorbova.by`                           | `club.gorbova.by`                |
| Платная консультация   | `9d0d6de8-...` | `consultation`  | `consultation.gorbova.by`                   | `cons.gorbova.by` (**mismatch**) |
| Бухгалтерия как бизнес | `85046734-...` | `buh_business`  | `https://club.gorbova.by/business-training` | `business-training.gorbova.by`   |


**Вывод:** `products_v2.code` — стабильный, уникальный, с constraint. Подходит как explicit binding key.

---

## Полный grep: все usage points


| Файл                                        | Что использует                                     | Классификация                                 |
| ------------------------------------------- | -------------------------------------------------- | --------------------------------------------- |
| `src/pages/Consultation.tsx`                | `getCurrentDomain()` → `usePublicProduct(domain)`  | **BROKEN** — перевести на explicit `code`     |
| `src/components/landing/LandingPricing.tsx` | `usePublicProduct("club.gorbova.by")`              | Хардкод домена — перевести на explicit `code` |
| `src/pages/BusinessTraining.tsx`            | `usePublicProduct("business-training.gorbova.by")` | Хардкод домена — перевести на explicit `code` |
| `src/pages/BusinessTrainingContent.tsx`     | `usePublicProduct("business-training.gorbova.by")` | Хардкод домена — перевести на explicit `code` |
| `src/components/layout/DomainRouter.tsx`    | `getCurrentDomain()` → `usePublicProduct(domain)`  | **Legacy fallback** — оставить как есть       |
| `src/hooks/useSitePricingData.ts`           | `product_id` напрямую в URL                        | **Уже правильно** — не трогать                |
| `src/pages/ProductPricing.tsx`              | `usePublicProductBySlug(slug)`                     | Slug-based — не трогать                       |


---

## Архитектура решения

### Принцип: расширить существующий `usePublicProduct`, не плодить новый хук

Текущая сигнатура: `usePublicProduct(domain, userId)`.

Новая сигнатура: `usePublicProduct(lookup, userId)`, где `lookup` — объект:

```typescript
type ProductLookup = 
  | { productId: string }      // приоритет 1
  | { productCode: string }    // приоритет 2
  | { domain: string }         // приоритет 3 (legacy)
  | string                     // backward compat: трактуется как domain
  | null;                      // disabled
```

Backward compatibility: если передана строка — это domain (все старые вызовы работают без изменений).

### EF `public-product`: добавить `product_code` param

Текущий EF уже принимает `domain` и `product_id`. Добавить третий param `product_code` — lookup по `products_v2.code`.

Приоритет в EF: `product_id` → `product_code` → `domain`.

**Conflict guard:** Если передано несколько параметров — использовать по приоритету, без конфликтной проверки (один param на вызов из хука). Хук всегда передаёт ровно один param.

### Единая page-config map (constants)

Вместо разбрасывания строк по компонентам — единый файл констант:

```typescript
// src/config/productPages.ts
export const PRODUCT_PAGES = {
  club: { code: "club" },
  consultation: { code: "consultation" },
  businessTraining: { code: "buh_business" },
} as const;
```

Страницы импортируют из одного места. Добавление нового продукта = одна строка в конфиге.

---

## Два патча

### PATCH A — Canonical resolver + перевод страниц

1. `**supabase/functions/public-product/index.ts**` — добавить `product_code` param с lookup по `code`
2. `**src/hooks/usePublicProduct.tsx**` — расширить `usePublicProduct` для приёма `ProductLookup | string | null`
3. `**src/config/productPages.ts**` — новый файл с константами продуктов
4. `**src/pages/Consultation.tsx**` — `usePublicProduct({ productCode: PRODUCT_PAGES.consultation.code }, user?.id)`
5. `**src/components/landing/LandingPricing.tsx**` — `usePublicProduct({ productCode: PRODUCT_PAGES.club.code }, user?.id)`
6. `**src/pages/BusinessTraining.tsx**` — `usePublicProduct({ productCode: PRODUCT_PAGES.businessTraining.code }, user?.id)`
7. `**src/pages/BusinessTrainingContent.tsx**` — `usePublicProduct({ productCode: PRODUCT_PAGES.businessTraining.code }, user?.id)`

`DomainRouter.tsx` — **не трогаем**, остаётся legacy domain fallback.

### PATCH B — DB config correction

Отдельным шагом: обновить `primary_domain` для «Платная консультация» с `cons.gorbova.by` → `consultation.gorbova.by`, чтобы legacy domain fallback тоже работал.

---

## Правила (зафиксировать)

1. `DomainRouter` — **только legacy fallback** для продуктовых поддоменов. НЕ source of truth для тарифного блока.
2. Source of truth для pricing block = explicit `productCode` или `productId`, переданный в компонент.
3. Checkout/CTA получают `product.id` из того же resolved