да, согласен

Можно выполнять **PATCH-LANDING-PRICING-RESILIENCE**.

**Контрольный scope**

1. src/components/landing/LandingPricing.tsx

2. src/hooks/usePublicProduct.tsx

**Не трогать**

- PaymentDialog.tsx

- PublicPayPage.tsx

- public-charge-saved-card

- public-checkout

- bepaid-* edge functions

- bepaid-webhook

- grant-access

- public-product backend

- UniversalPricingSection props/contract

**Ключевое требование**

Секция тарифов не должна молча исчезать.

Состояния:

loading → skeleton / loading-state

error → error-state + “Повторить загрузку”

empty success → “Тарифы временно недоступны.”

success with data → текущий UniversalPricingSection

**Важно**

Оборачивать все состояния в тот же section с id="tariffs", чтобы CTA «Выбрать тариф» продолжал скроллить к секции даже при ошибке.

**DoD**

1. public-product 200 + tariffs → тарифы видны.

2. public-product error → виден error-state, не пустое место.

3. Retry вызывает refetch.

4. #tariffs работает.

5. PAY-патчи не затронуты.

6. tsc clean.

&nbsp;

План: PATCH-LANDING-PRICING-RESILIENCE

## Диагноз

Блок тарифов пропал **не из-за PAY-G/H/E-LITE напрямую**.

Последние PAY-патчи трогали только:

- `src/pages/PublicPayPage.tsx`
- `src/components/payment/PaymentDialog.tsx`
- `supabase/functions/public-charge-saved-card/index.ts`

Блок тарифов зависит от другой ветки кода:

- `src/pages/Landing.tsx`
- `src/components/landing/LandingPricing.tsx`
- `src/hooks/usePublicProduct.tsx`
- `src/components/landing/UniversalPricingSection.tsx`
- `supabase/functions/public-product/index.ts`

Эти файлы **не менялись** за последние 3 дня (подтверждено `git log`).

## Первопричина

`LandingPricing.tsx` молча скрывает секцию при любом отсутствии данных:

```tsx
if (!productData?.product || !productData.tariffs?.length) return null;
```

То есть любая ошибка fetch / CORS / транзиентный сетевой сбой / 500 → блок просто исчезает. Пользователь видит лендинг без тарифов и не понимает, что произошло.

Сейчас (в свежих network-логах) `public-product` отвечает **200 OK** и возвращает 3 тарифа корректно — значит блок снова виден. Но архитектурная уязвимость остаётся: при любом следующем сбое блок снова исчезнет.

## Scope патча

- `src/components/landing/LandingPricing.tsx`
- `src/hooks/usePublicProduct.tsx`

Никаких других файлов.

## Что сделать

### 1. `usePublicProduct.tsx`

- Включить `retry: 2` (вместо текущего `retry: false`) для устойчивости к транзиентным сетевым ошибкам.
- При ошибке fetch писать `console.error('[usePublicProduct] public-product fetch failed', { url, status, error })` — для диагностики в превью.
- Контракт хука и `queryKey` не меняются, чтобы не сломать остальных потребителей.

### 2. `LandingPricing.tsx`

Получить из хука `error` и `refetch`. Заменить `return null` при ошибке/пустых данных на видимые состояния:

- **loading** → существующий `UniversalPricingSkeleton` (без изменений).
- **error** → секция-заглушка с текстом:
  > «Не удалось загрузить тарифы. Обновите страницу или попробуйте позже.»
  - кнопка «Повторить загрузку» → вызывает `refetch()`.
- **success, но пусто** (нет product или tariffs пустой) → секция-заглушка с текстом:
  > «Тарифы временно недоступны.»
- **success с данными** → текущий рендер `UniversalPricingSection` (без изменений).

Заглушки оборачиваем в тот же `<section id="tariffs">`, чтобы якорь `#tariffs` (на который ведёт CTA «Выбрать тариф» из Hero) продолжал работать в любом состоянии.

## STOP-guards

- STOP, если патч трогает `PaymentDialog.tsx`.
- STOP, если патч трогает `PublicPayPage.tsx`.
- STOP, если патч трогает любые payment edge-функции (`bepaid-*`, `public-charge-saved-card`, `public-checkout`, webhook, grant-access).
- STOP, если патч меняет backend `public-product` (контракт, payload, CORS) — это отдельная диагностика.
- STOP, если меняется контракт `usePublicProduct` или `UniversalPricingSection` (props, типы).
- Не вводить новый источник данных тарифов — единый путь `usePublicProduct → public-product EF`.

## DoD

1. Успешный ответ `public-product` → тарифы отображаются как сейчас.
2. Ошибка `public-product` (network/CORS/500) → виден error-state с кнопкой повтора, а не пустое место.
3. Кнопка «Повторить загрузку» вызывает `refetch` и при успехе блок переключается на нормальный рендер.
4. Якорь `#tariffs` продолжает работать (Hero CTA «Выбрать тариф» скроллит на секцию в любом состоянии).
5. PAY-патчи (G/H/E-LITE) и связанные с ними flow не затронуты.
6. `tsc --noEmit` clean.
7. Архитектурная гарантия: единая логика «fetch продукта → render тарифов» сохраняется для всех потребителей `usePublicProduct` (Landing, ProductPricing, site-renderer PricingSection — они автоматически выигрывают от retry+console.error в хуке).

## Что НЕ входит в этот патч (отдельные планы при необходимости)

- Усиление `PricingSection.tsx` в site-renderer и `ProductPricing.tsx` тем же error-state — сделать отдельным патчем `PATCH-PUBLIC-PRICING-RESILIENCE`, если потребуется единообразие UI на всех страницах.
- Диагностика и расширение CORS у `public-product` — отдельный патч при появлении воспроизводимой ошибки сети.

После одобрения плана я перейду в default mode и применю патч строго в указанном scope.