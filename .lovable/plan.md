# да, согласен, с учетом правок:

&nbsp;

1. Главная правка: **не оставляй два owner-а расчёта suffix**.
  Сейчас у тебя TariffCard.tsx и tariffCardViewModel.ts оба считают suffix. Это риск расхождения.
  Нужно сделать **один shared resolver**:
  &nbsp;
  - например src/lib/resolveTariffDisplayConfig.ts
  - он считает price_suffix, old_price, badge, cta_text
  - public runtime и admin preview используют **одну и ту же функцию**
  &nbsp;
2. В план обязательно добавь, что **public EF должен отдавать meta из tariffs**, иначе card_config на публичном runtime по-прежнему не существует.
  Это сейчас не просто улучшение, а **обязательное условие**, иначе баг с suffix полностью не закрывается.
3. Зафиксируй окончательный приоритет так:
  &nbsp;
  - tariff.meta.card_config.price_suffix
  - tariff.period_label
  - product.landing_config.price_suffix
  - "BYN"
    И отдельно укажи:
    **никакой логики по offer_type, slug, code, названию продукта или тарифа для suffix не допускается.**
  &nbsp;
4. Добавь отдельный discovery/proof по полям, которые должны быть **строго config-driven**:
  &nbsp;
  - price_suffix
  - price_display
  - old_price
  - badge_text
  - cta_text
  - period_label
  - offer_type
  - button_label
    Нужен список: **откуда каждое поле приходит в preview / public / embed**.
  &nbsp;
5. По консультации у тебя важное открытие: один тариф pay_now уже хранится с period_label = "BYN/мес".
  Это не только runtime bug, но и **data/config inconsistency**.
  Поэтому план надо разделить на:
  &nbsp;
  - **PATCH A** — код, чтобы public начал уважать tariff-level config
  - **PATCH B** — equal-height + carousel UX
  - **PATCH C** — **one-off config correction** для уже битых тарифов, которые сейчас сохранены неверно
    И отдельно: future validation в admin UI — backlog, не в этом патче.
  &nbsp;
6. Добавь обязательный **config-audit report по всем активным тарифам**:
  таблица:
  &nbsp;
  - product
  - tariff
  - offer_type
  - card_config.price_suffix
  - period_label
  - landing_config.price_suffix
  - итоговый rendered suffix
  - verdict: OK / CONFLICT
    Без этого нельзя утверждать, что решение не локально под консультацию.
  &nbsp;
7. По EF fallback "BYN" — зафиксируй, что это **только fallback при полном отсутствии настроек**.
  Нужен отдельный proof в плане:
  &nbsp;
  - если card_config.price_suffix задан, fallback не участвует
  - если period_label задан, fallback не участвует
  - если задан product-level suffix, fallback не участвует
  &nbsp;
8. По карусели: не ограничивайся loop: true и dragFree: true.
  Добавь обязательную проверку:
  &nbsp;
  - desktop mouse drag
  - trackpad horizontal scroll
  - mobile swipe
  - click по CTA внутри карточки
  - keyboard arrows
  - отсутствие визуального дёргания при loop
    И зафиксируй fallback: если dragFree ухудшает UX, оставить обычный drag, но **loop оставить обязательно**.
  &nbsp;
9. По equal-height: добавь в DoD визуальные кейсы:
  &nbsp;
  - badge / no badge
  - long title
  - long description
  - old price / no old price
  - разная длина CTA
    И требуй **before/after screenshots**, а не только проверку классов.
  &nbsp;
10. Обязательный smoke-test:
  создать **новый тестовый продукт с нуля** и доказать:
  &nbsp;
  - preview читает настройки корректно
  - public читает те же настройки
  - embed читает те же настройки
  - suffix/цены/CTA меняются без ручной правки кода
    Это должно быть частью DoD, а не пожеланием.
  &nbsp;
11. primary_domain для консультации вынеси отдельно как **config/data fix**, но не смешивай с основным pricing patch.
  Иначе подрядчик может сослаться на домен и не закрыть главный баг с tariff config.
12. В итоговый отчёт обязательно включить:
  &nbsp;
  - changed files list
  - discovery-table по всем активным тарифам
  - before/after screenshots
  - proof одинакового результата в preview / public / embed
  - список конфликтных тарифов в БД, которые требуют ручной коррекции настроек
  &nbsp;

&nbsp;

&nbsp;

Текст для подрядчика:

```
Дополни план правками:

1. Не оставляй два owner-а расчёта suffix. Сделай один shared resolver для display-config тарифной карточки и используй его и в public runtime, и в admin preview.

2. Зафиксируй как обязательное изменение: все public EF должны отдавать `tariffs.meta`, иначе `card_config` на публичном runtime недоступен и баг не закрывается.

3. Окончательный приоритет suffix:
`tariff.meta.card_config.price_suffix` → `tariff.period_label` → `product.landing_config.price_suffix` → `"BYN"`.
Запретить любую логику по product code / slug / name / offer_type для suffix.

4. Дай карту источников данных для preview / public / embed:
откуда приходят `card_config`, `period_label`, `landing_config`, `offer_type`, `button_label`.

5. Раздели работу на:
- PATCH A — public runtime уважает tariff-level config
- PATCH B — equal-height + carousel UX
- PATCH C — one-off correction конфликтных тарифных настроек в БД
Отдельно зафиксируй backlog на admin validation `offer_type ↔ period_label`.

6. Добавь config-audit по всем активным тарифам:
product / tariff / offer_type / card_config.price_suffix / period_label / landing_config.price_suffix / rendered suffix / verdict.

7. Для EF fallback `"BYN"` дай negative-proof, что fallback не перебивает реально заданные поля.

8. По карусели проверь:
mouse drag, trackpad, mobile swipe, CTA click, keyboard, loop without jitter.
Если `dragFree` ухудшает UX — откати только его, но не loop.

9. Equal-height проверить на 5 визуальных кейсах:
badge/no badge, long title, long description, old price/no old price, different CTA length.
Нужны before/after screenshots.

10. Обязательный smoke-test:
создать новый тестовый продукт с нуля и доказать, что preview/public/embed одинаково читают config без ручных правок кода.

11. `primary_domain` для consultation вынеси отдельным config/data fix и не подменяй им основной pricing patch.

12. В финальный отчёт включи:
- changed files list
- discovery-table по всем активным тарифам
- before/after screenshots
- proof одинакового результата в preview/public/embed
- список конфликтных тарифов, требующих ручной коррекции в БД/админке

Нужен обновлённый consolidated plan без дублирующей логики расчёта suffix и без локальных хаков под consultation.

План: Config-driven тарифные карточки + карусель
```

## Критическое открытие: `card_config` НЕ доступен на public runtime

**Root cause бага с "BYN/мес":**

Все три публичные EF (`public-product`, `public-product-by-slug`, `public-tariff-by-public-id`) НЕ включают `meta` в SELECT из таблицы `tariffs`. Значит `tariffs.meta.card_config` никогда не попадает на клиент в публичном runtime.

В `TariffCard.tsx` строка 103:

```typescript
const resolvedSuffix = priceSuffix !== "BYN" ? priceSuffix : (cc?.price_suffix || "BYN");
```

`cc` (card_config) всегда `undefined` на public pages → единственный источник suffix — `priceSuffix` prop из `UniversalPricingSection`, который берёт `product.landing_config.price_suffix` = `"BYN/мес"` для всех продуктов.

В admin preview `buildTariffCardViewModel` получает tariff с `meta` напрямую из БД → `cc?.price_suffix` работает → показывает правильно.

**Это объясняет расхождение preview vs public.**

---

## Карта источников данных

```text
┌─────────────────────┬──────────────────────────────────┬───────────────────────┐
│ Путь                │ SoT продукта                     │ SoT тарифа            │
├─────────────────────┼──────────────────────────────────┼───────────────────────┤
│ Public runtime      │ EF public-product →              │ EF → tariffs          │
│ (Consultation,      │ products_v2 (landing_config)      │ (NO meta, NO         │
│  LandingPricing,    │                                  │  card_config!)         │
│  BusinessTraining)  │                                  │ + tariff_offers        │
│                     │                                  │ + tariff_features      │
├─────────────────────┼──────────────────────────────────┼───────────────────────┤
│ Admin preview       │ products_v2 direct DB read        │ tariffs direct DB     │
│ (AdminProductDetail │ (ALL columns incl. meta)          │ read (ALL columns     │
│  V2.tsx)            │                                  │ incl. meta.card_config)│
├─────────────────────┼──────────────────────────────────┼───────────────────────┤
│ Embed/site-builder  │ EF public-product via             │ Same as public        │
│ (PricingSection,    │ useSitePricingData (product_id)   │ runtime               │
│  useSitePricingData)│                                  │                       │
├─────────────────────┼──────────────────────────────────┼───────────────────────┤
│ Slug-based          │ EF public-product-by-slug         │ Same fields, no meta  │
│ (ProductPricing)    │                                  │                       │
└─────────────────────┴──────────────────────────────────┴───────────────────────┘
```

**Где читается каждое поле:**


| Поле                          | Public runtime                                                                   | Admin preview                                        |
| ----------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `landing_config.price_suffix` | EF → `product.landing_config` → `UniversalPricingSection` → `priceSuffix` prop   | Direct DB → `buildTariffCardViewModel` override      |
| `tariff.period_label`         | EF SELECT включает → приходит на клиент, но **нигде не используется для suffix** | Direct DB → `buildTariffCardViewModel` не использует |
| `tariff.meta.card_config`     | **НЕ передаётся** (meta не в SELECT)                                             | Direct DB → полный доступ                            |
| `offer.offer_type`            | EF → `tariff_offers` → приходит корректно                                        | Direct DB                                            |


---

## Config-driven vs marketing-copy

### Обязаны быть config-driven (из настроек тарифа/оффера):

- **price** — `offer.amount` > `card_config.price_display` > `tariff.current_price`
- **old_price** — `card_config.old_price` > `tariff.base_price`
- **price_suffix** — `card_config.price_suffix` > `tariff.period_label` > `product.landing_config.price_suffix` > `"BYN"`
- **CTA text** — `card_config.cta_text` > `offer.button_label` > `"Оплатить"`
- **badge** — `card_config.badge_text` > `tariff.badge`
- **offer_type** — `offer.offer_type` (только из оффера, никогда не вычисляется)

### Допустим статичный marketing-copy (не баг):

- Текст "Безопасная оплата через bePaid..." в `UniversalPricingSection`
- Хардкод "BYN" в `PaymentDialog` summary (это валюта платежа, не suffix)
- Страничные marketing-тексты в `Products.tsx`, `Learning.tsx`, `Money.tsx`

---

## Canonical owner расчёта price_suffix

**Решение: один owner — Edge Function.** EF собирает финальный suffix и отдаёт его в tariff object. Клиент только отображает.

Сейчас suffix считается в 3 местах независимо:

1. `tariffCardViewModel.ts` L90 — для admin preview
2. `TariffCard.tsx` L103 — для рендера
3. `UniversalPricingSection.tsx` L49 — prop extraction

**После фикса:**

- EF `public-product` включает `meta` в SELECT → возвращает `resolved_price_suffix` на каждом тарифе
- `TariffCard` использует `tariff.period_label` как resolved suffix (EF пишет туда финальное значение)
- `tariffCardViewModel.ts` — единственный нормализатор для admin preview, тоже считает suffix один раз
- `TariffCard.tsx` — только consume, не пересчитывает

**Или проще (меньше изменений):** EF начинает отдавать `meta` → клиент использует `card_config.price_suffix` → один расчёт в `TariffCard` с правильным приоритетом.

Выбираю вариант 2 (меньше рисков): **добавить `meta` в SELECT всех 3 EF** + **исправить приоритет в одном месте — `TariffCard.tsx**`.

`tariffCardViewModel.ts` остаётся canonical owner только для admin preview path. Приоритет идентичен.

**Запрет:** `TariffCard` и `buildTariffCardViewModel` НЕ должны оба вычислять suffix при совместном использовании. В admin preview `buildTariffCardViewModel` вычисляет → записывает в `card_config.price_suffix` → `TariffCard` берёт из `cc.price_suffix` (consume). В public runtime `TariffCard` вычисляет сам (потому что `buildTariffCardViewModel` не используется).

---

## Discovery: offer_type vs period_label конфликты


| product_code | tariff                        | offer_type | period_label | Конфликт?                               |
| ------------ | ----------------------------- | ---------- | ------------ | --------------------------------------- |
| consultation | Несрочная консультация        | pay_now    | BYN          | ✓ OK                                    |
| consultation | Срочная консультация          | pay_now    | BYN          | ✓ OK                                    |
| consultation | **Помощь при проверке**       | pay_now    | **BYN/мес**  | **⚠ КОНФЛИКТ** — pay_now + "/мес"       |
| consultation | Стратегия защиты              | pay_now    | BYN          | ✓ OK                                    |
| club         | FULL/BUSINESS/CHAT            | pay_now    | BYN/мес      | ✓ OK (клуб = подписка)                  |
| buh_business | Ежемесячный                   | pay_now    | BYN/мес      | ✓ OK (подписка)                         |
| cb20         | Бухгалтер/Главный/Бизнес-леди | pay_now    | **дней**     | **⚠ Нестандартный** — "дней" как suffix |


**Verdict:** "Помощь при проверке" (consultation) — pay_now с "BYN/мес" — конфликт. Но это data issue, не code issue. После фикса приоритета admin может исправить `period_label` → "BYN" в настройках.

**По UI подсказке:** Сейчас admin UI не валидирует связку offer_type↔period_label. Это отдельная задача за рамками текущего патча, но зафиксировано как known gap.

---

## Два PATCHа

### PATCH A — Исправить public runtime: добавить `meta` в EF + исправить приоритет suffix

**1. EF `public-product/index.ts**` (L152-156): добавить `meta` в SELECT tariffs

```
id, code, name, description, badge, subtitle,
price_monthly, period_label, access_days, features, is_popular,
discount_enabled, discount_percent, original_price,
trial_enabled, trial_days, trial_price, trial_auto_charge, sort_order, meta
```

**2. EF `public-product-by-slug/index.ts**` (L86-90): аналогично добавить `meta`

**3. EF `public-tariff-by-public-id/index.ts**` (L36-42): аналогично

**4. EF fallback default** — все 3 EF: `price_suffix: "BYN/мес"` → `price_suffix: "BYN"` (true fallback только когда `landing_config = null`)

**5. `src/components/landing/TariffCard.tsx**` L103: исправить приоритет suffix

```typescript
// БЫЛО: product-level побеждал
const resolvedSuffix = priceSuffix !== "BYN" ? priceSuffix : (cc?.price_suffix || "BYN");
// СТАЛО: tariff-level побеждает, product — fallback
const resolvedSuffix = cc?.price_suffix || tariff.period_label || priceSuffix || "BYN";
```

**6. `src/lib/tariffCardViewModel.ts**` L90: идентичный приоритет для admin preview

```typescript
// БЫЛО
price_suffix: overridePriceSuffix || cc?.price_suffix || "BYN",
// СТАЛО
price_suffix: cc?.price_suffix || tariff.period_label || overridePriceSuffix || "BYN",
```

**7. `src/hooks/usePublicProduct.tsx**`: добавить `meta` в тип `PublicTariff`

**8. `src/pages/admin/AdminProductDetailV2.tsx**` L268: default `period_label` при создании тарифа: `"BYN/мес"` → `"BYN"`

**Proof что EF fallback не перебивает:** fallback `price_suffix: "BYN"` применяется только при `landing_config || { ... }` — т.е. когда у продукта вообще нет `landing_config`. У всех активных продуктов `landing_config` заполнен → fallback не применяется.

### PATCH B — Equal-height карточки + карусель UX

**9. `src/components/landing/TariffCarouselGrid.tsx**`:

- `CarouselItem`: класс `h-full`
- Внутренний `div` (L131): `h-full`
- Carousel opts: `loop: true`, `dragFree: true`, `containScroll: false`
- `TariffCard` уже имеет `h-full` на GlassCard и `mt-auto` на CTA — проверить визуально

**Visual DoD кейсы:**

- Карточка с badge / без badge
- Длинный title
- Длинное description
- С old_price / без
- Разная длина CTA
- Desktop drag / trackpad / wheel
- Mobile swipe
- Click по CTA не перехватывается drag
- Loop без визуальных скачков
- Keyboard ← → навигация

**STOP-guard:** если `dragFree` ломает snap/click — откатить на обычный drag, но `loop: true` обязателен.

### PATCH C — DB config correction (отдельно)

Обновить `primary_domain` для консультации: `cons.gorbova.by` → `consultation.gorbova.by`

---

## Запреты

1. Нельзя делать `if consultation` / `if pay_now && product_id === ...`
2. Нельзя патчить руками конкретный продукт в БД как основное решение
3. Нельзя вычислять "/мес" по названию тарифа/продукта
4. Нельзя hardcode по slug/code/id
5. Только config-driven rendering

---

## Anti-regression


| Проверка                                             | Метод                                                 |
| ---------------------------------------------------- | ----------------------------------------------------- |
| Консультация — preview                               | Browser screenshot                                    |
| Консультация — правильный suffix ("BYN" для разовых) | Network proof: `card_config.price_suffix` в ответе EF |
| Клуб — suffix "BYN/мес"                              | EF curl                                               |
| CB20 — suffix "дней"                                 | EF curl                                               |
| Неверный product_code → 404                          | EF curl                                               |
| Legacy domain → работает                             | EF curl                                               |
| Payment dialog / CTA — тот же product.id             | Code audit (уже подтверждено)                         |
| Admin preview = public                               | Визуальное сравнение                                  |
| Embed = public                                       | Через useSitePricingData (тот же EF)                  |
| Carousel: drag, loop, click, mobile                  | Browser test                                          |
| Equal-height: разные кейсы                           | Browser screenshot                                    |


### Negative proof:

- `product_code=consultation` + `domain=club.gorbova.by` → 409
- `product_code=nonexistent` → 404
- EF fallback "BYN" не перебивает реально заданные значения

---

## Config-proof формат (для каждого тест-кейса)


| Продукт      | Тариф     | offer_type | card_config.price_suffix | period_label | landing_config.price_suffix | Rendered suffix              |
| ------------ | --------- | ---------- | ------------------------ | ------------ | --------------------------- | ---------------------------- |
| consultation | Несрочная | pay_now    | "BYN"                    | "BYN"        | "BYN/мес"                   | **"BYN"** ← card_config      |
| consultation | Срочная   | pay_now    | null                     | "BYN"        | "BYN/мес"                   | **"BYN"** ← period_label     |
| club         | FULL      | pay_now    | null                     | "BYN/мес"    | "BYN/мес"                   | **"BYN/мес"** ← period_label |
| cb20         | Бухгалтер | pay_now    | null                     | "дней"       | "BYN/мес"                   | **"дней"** ← period_label    |


---

## Итого файлов


| Файл                                                     | Изменение                          |
| -------------------------------------------------------- | ---------------------------------- |
| `supabase/functions/public-product/index.ts`             | +`meta` в SELECT, fallback → "BYN" |
| `supabase/functions/public-product-by-slug/index.ts`     | +`meta` в SELECT, fallback → "BYN" |
| `supabase/functions/public-tariff-by-public-id/index.ts` | +`meta` в SELECT, fallback → "BYN" |
| `src/hooks/usePublicProduct.tsx`                         | +`meta` в тип `PublicTariff`       |
| `src/components/landing/TariffCard.tsx`                  | Исправить suffix priority          |
| `src/lib/tariffCardViewModel.ts`                         | Исправить suffix priority          |
| `src/components/landing/TariffCarouselGrid.tsx`          | Equal-height + carousel UX         |
| `src/pages/admin/AdminProductDetailV2.tsx`               | Default period_label → "BYN"       |
| БД: products_v2                                          | primary_domain fix (PATCH C)       |


**Scope closure:** Если в процессе реализации grep обнаружит дополнительные entrypoints — они добавляются add-only в этот же PATCH.

## DoD

1. Один canonical приоритет suffix реализован в двух owner-точках: `TariffCard` (public) и `tariffCardViewModel` (admin preview) с идентичной логикой
2. `TariffCard` и `buildTariffCardViewModel` не вычисляют suffix параллельно при совместном использовании
3. EF отдаёт `meta` → `card_config` доступен на public runtime
4. Preview / public / embed показывают одинаковый результат
5. Config-proof для каждого продукта подтверждён
6. Carousel: loop, drag, click по CTA, mobile swipe, keyboard
7. Equal-height визуально подтверждён на разных кейсах
8. Нет special-case по consultation/club/business
9. Legacy domain fallback работает
10. EF fallback "BYN" не перебивает реально заданные значения