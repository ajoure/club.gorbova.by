# да, согласен, с учетом правок:

&nbsp;

1. **PATCH B нужно сформулировать как один owner-layout для preview и public.**
  Явно запиши: проблема не только в scale, а в **разной DOM-цепочке**.
  Обязательное требование: TariffCarouselGrid должен рендерить одинаковую layout-цепочку в обоих режимах. AnimatedSection в public — structural mismatch, его нужно либо довести до полного h-full flex-совместимого состояния, либо убрать из цепочки карточки, если он продолжает ломать equal-height.
2. **useEqualHeight не объявлять сразу основным решением.**
  Сначала обязателен dry-run:
  &nbsp;
  - убрать scale;
  - выровнять opacity;
  - добавить h-full на public wrapper;
  - проверить consultation/preview/public.
    Только если после этого карточки реально остаются разной высоты — подключать useEqualHeight как fallback.
  &nbsp;
3. **Если будет useEqualHeight, нужен точный технический контракт.**
  Добавь в план:
  &nbsp;
  - какой DOM-узел измеряется;
  - на какой DOM-узел ставится minHeight;
  - как фильтруются Embla clones при loop;
  - когда идёт пересчёт: initial render, resize, breakpoint change, data change, font load.
    Без этого подрядчик снова сделает “плавающее” решение.
  &nbsp;
4. **STOP-guards по active card должны быть жёстче.**
  Запрещено любое геометрическое отличие активной карточки:
  &nbsp;
  - scale
  - translateY
  - иной padding
  - иной font-size
  - иной border-width
  - иной min/max-height
  - любые vertical offsets
    Допустимы только мягкие визуальные отличия без изменения геометрии: opacity, ring, shadow.
  &nbsp;
5. **Добавь обязательную ревизию внутренних зон TariffCard.**
  Недостаточно написать “там всё ок”.
  Подрядчик должен отдельно проверить:
  &nbsp;
  - title zone
  - price zone
  - description zone
  - features zone
  - CTA zone
    И подтвердить, что ни одна зона не даёт скрытого расхождения по высоте.
  &nbsp;
6. **Нужен отдельный decision по line-clamp.**
  Сейчас в плане выбран вариант “не использовать”, но это надо оформить как решение с проверкой.
  Добавь:
  &nbsp;
  - line-clamp по умолчанию не используется;
  - если visual proof покажет, что отдельные title/description ломают карточку, допускается точечный clamp как follow-up, но не молча в этом патче.
  &nbsp;
7. **duration не фиксируй заранее.**
  Правильно, что ты написал tuning-pass.
  Но укажи финально: подрядчик обязан протестировать минимум 2–3 близких значения и зафиксировать итоговое только после visual proof. Не просто поставить 20.
8. **Нужен отдельный acceptance-блок по click-vs-drag.**
  Не просто упоминание, а обязательный DoD:
  &nbsp;
  - CTA кликается стабильно;
  - drag не вызывает ложный click;
  - стрелки быстро работают подряд;
  - dots корректны после drag и arrows;
  - mobile swipe не ломает CTA.
  &nbsp;
9. **Прямо зафиксируй, что сейчас сломаны и preview, и public, и чинятся они одним патчем.**
  Это уже у тебя есть по смыслу, но добавь как явное требование в scope и DoD:
  preview/public parity по layout обязательна в этом PATCH B/C, не отдельным follow-up.
10. **Добавь negative/regression proof по режимам 4 / 3 / 1 карточка.**
  Сейчас это есть, но нужно жёстче:
  &nbsp;
  - consultation (4 карточки) — основной carousel-case;
  - 3 карточки — grid regression;
  - 1 карточка — single-card regression.
    Без этих трёх proof-case патч не считается закрытым.
  &nbsp;
11. **PATCH A зафиксируй как frozen ещё жёстче.**
  Напиши прямо:
  &nbsp;
  - запрещено менять suffix resolver;
  - запрещено менять EF response shape;
  - запрещено менять config-driven pricing logic;
  - запрещено ломать preview/public parity по suffix.
    Любые такие изменения только при новом отдельном баге с доказательством.
  &nbsp;
12. **Wheel/trackpad plugin — только отдельный enhancement, не часть обязательного deliverable.**
  В текущем PATCH базовый UX должен стать хорошим без него.
  Если после этого останется явный UX-gap — вынести в follow-up PATCH, не смешивать сейчас.
13. **Нужен итоговый формат плана ровно в 3 блоках:**
  &nbsp;
  - **A — frozen suffix/config-driven rendering**
  - **B — equal-height layout fix**
  - **C — carousel interaction UX**
    И явно написать, что **закрыт только A**, а **B и C остаются открытыми до visual proof**.
  &nbsp;

&nbsp;

&nbsp;

Копируемый блок для Lovable:

```
Дополни план правками:

1. Зафиксируй root cause жёстче: проблема не только в `scale`, а в structural mismatch между preview и public. `AnimatedSection` в public — обязательная причина, которую нужно устранить, чтобы DOM-цепочка layout была одинаковой.

2. `useEqualHeight` не считать базовым решением по умолчанию. Сначала обязательный dry-run:
- убрать `scale`
- выровнять opacity
- добавить `h-full` в public wrapper
- проверить consultation/preview/public
Только если после этого equal-height не достигнут чистым CSS/flex-stretch — подключать `useEqualHeight` как fallback.

3. Если `useEqualHeight` всё же нужен, пропиши технический контракт:
- какой DOM-узел измеряется
- на какой узел ставится `minHeight`
- как исключаются Embla clones при `loop`
- когда идёт пересчёт: initial render, resize, breakpoint change, data change, font load

4. Добавь жёсткий STOP-guard: active card не может отличаться геометрией.
Запрещено:
- scale
- translateY
- другой padding
- другой font-size
- другой border-width
- другой min/max-height
- любые vertical offsets

5. Добавь обязательную ревизию внутренних зон `TariffCard`:
- title
- price
- description
- features
- CTA
Нужно подтвердить, что ни одна зона не создаёт скрытое различие высот.

6. Стратегию line-clamp зафиксируй явно:
- по умолчанию line-clamp не используется;
- если visual proof покажет, что конкретный title/description ломает layout, это отдельное точечное решение или follow-up, а не молчаливое изменение.

7. `duration` не фиксировать заранее. Добавь tuning-pass:
- проверить минимум 2–3 близких значения;
- выбрать финальное по фактическому UX;
- зафиксировать итог только после visual proof.

8. Добавь отдельный DoD-блок click-vs-drag:
- CTA кликается стабильно
- drag не вызывает ложный click
- стрелки быстро работают подряд
- dots корректны после drag и after arrows
- mobile swipe не ломает CTA

9. Явно зафиксируй: сейчас сломаны и preview, и public. Они чинятся одним PATCH B/C, не отдельными follow-up.

10. Обязательные proof-cases:
- consultation (4 карточки) — основной carousel-case
- 3 карточки — regression для grid
- 1 карточка — regression для single-card layout

11. PATCH A считать frozen:
- не трогать suffix resolver
- не трогать EF response shape
- не трогать config-driven pricing logic
- не ломать preview/public parity по suffix
Любые такие правки только при новом отдельном баге с доказательством.

12. Wheel/trackpad plugin не считать обязательным deliverable текущего PATCH.
Базовый UX должен стать хорошим без него.
Если останется явный UX-gap — вынести wheel/trackpad в отдельный enhancement PATCH.

13. Верни обновлённый consolidated plan в формате:
A) frozen suffix/config-driven rendering
B) equal-height layout fix
C) carousel interaction UX
И явно укажи, что сейчас закрыт только A, а B и C остаются открытыми до visual proof.

План: Equal-height layout + Carousel UX (PATCH B + C)
```

## Статус трёх PATCHей


| PATCH                              | Статус     | Правило                                                                                                                 |
| ---------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| A — suffix/config-driven rendering | **FROZEN** | Запрещено трогать resolver, EF response shape, config-driven pricing logic без нового отдельного бага с доказательством |
| B — equal-height layout            | **ОТКРЫТ** | Текущая реализация сломана                                                                                              |
| C — carousel interaction UX        | **ОТКРЫТ** | `dragFree: true` дал плохой результат                                                                                   |


---

## Root cause (жёсткая формулировка)

Две обязательные причины визуального развала:

### Причина 1: CSS `scale` transform на inner wrapper

`TariffCarouselGrid.tsx` L134-138: `scale-[0.97]` / `scale-[0.95]` уменьшают визуальный размер неактивных карточек, но НЕ layout-размер. Центральная карточка выглядит крупнее при одинаковом DOM-размере.

### Причина 2: Structural mismatch DOM-дерева preview vs public

Это не побочная причина, а **обязательная для устранения**:

- **Public runtime** (`UniversalPricingSection.tsx` L120): `TariffCard` обёрнут в `AnimatedSection` — дополнительный `div` без `h-full`, с `translate-y-8` до анимации. Этот div **разрывает** цепочку flex-stretch от `CarouselItem` до `TariffCard`.
- **Admin preview** (`AdminProductDetailV2.tsx` L1200): `TariffCard` вставлен напрямую в `TariffCarouselGrid` без промежуточного wrapper.

**Вывод:** `TariffCarouselGrid` не должен иметь разные визуальные правила для preview/public. DOM-цепочка layout обязана быть одинаковой в обоих режимах. `AnimatedSection` в public — structural mismatch, который обязан быть устранён добавлением `className="h-full"`.

### Полный root-cause стек по уровням


| Уровень                         | Элемент                               | Проблема                                                  |
| ------------------------------- | ------------------------------------- | --------------------------------------------------------- |
| CarouselContent                 | `div.flex.items-stretch`              | OK, stretch передаётся                                    |
| CarouselItem                    | `div.flex.h-full.basis-[36%]`         | OK                                                        |
| Inner wrapper (L131-139)        | `div.scale-[0.97].opacity-80`         | **ПРОБЛЕМА**: `scale` меняет визуальную высоту            |
| AnimatedSection (только public) | `div` без `h-full`, с `translate-y-8` | **ПРОБЛЕМА**: разрывает flex-stretch, structural mismatch |
| TariffCard → GlassCard          | `div.p-6.flex.flex-col.h-full`        | OK, padding одинаковый                                    |


---

## PATCH B — Equal-height layout

### Порядок работы (dry-run first)

**Шаг 1 — Минимальный CSS-фикс (без JS):**

1. Убрать `scale-[0.97]`, `scale-[0.95]` из inner wrapper (L134-138)
2. Заменить opacity: active `opacity-100`, adjacent `opacity-[0.92]`, rest `opacity-[0.85]`
3. Добавить `className="h-full"` на `AnimatedSection` в `UniversalPricingSection.tsx` L120
4. Визуально сверить результат preview vs public

**Шаг 2 — Проверка: достаточно ли CSS/flex-stretch?**

- Если `items-stretch` + `h-full` на всех уровнях дают одинаковую высоту — задача закрыта без JS
- Проверить на consultation (4 карточки) + club (3, grid) + single-card

**Шаг 3 — Только если CSS не решил:**

- Добавить `useEqualHeight` как fallback
- Scope измерения:
  - **Измеряемый DOM-узел**: inner wrapper (`div` внутри `CarouselItem`, ref на каждый)
  - **Куда ставится `minHeight**`: на тот же inner wrapper через inline style
  - **Исключение Embla clones**: при `loop: true` Embla добавляет clone-ы с `data-embla-clone` — фильтровать по этому атрибуту
  - **Когда пересчёт**: initial render, `ResizeObserver` на контейнере, при изменении `items.length`

### STOP-guards: active card НЕ может отличаться геометрией

Запрещено для active/center/selected карточки:

- `scale` / `scaleX` / `scaleY`
- `translateY` / вертикальный offset
- Изменение `font-size`
- Изменение `padding` / `margin`
- Изменение `border-width`
- Изменение `min-height` / `max-height`
- `shadow` или `ring`, визуально меняющие perceived height за счёт extra spacing

Допустимо: `opacity`, `ring`/`border-color` без изменения width, `box-shadow` без изменения spacing.

### Ревизия внутренних зон TariffCard

Нужно проверить по коду, что ни одна зона не создаёт скрытое различие высот:


| Зона                               | Текущий CSS                    | Что проверить                                         |
| ---------------------------------- | ------------------------------ | ----------------------------------------------------- |
| Title (`text-center mb-4`)         | Фиксированный margin           | Нет скрытого min-height                               |
| Price (`text-center mb-4`)         | Фиксированный margin           | old_price добавляет строку — не должно ломать соседей |
| Description (`text-sm mb-4`)       | Фиксированный margin           | Длинный текст растягивает зону                        |
| Features (`space-y-2 mb-6 flex-1`) | `flex-1` забирает пространство | Без features блок отсутствует — CTA поднимается       |
| CTA (`space-y-2 mt-auto`)          | `mt-auto` прибивает к низу     | OK если outer height одинаковый                       |


### Стратегия line-clamp

Решение: **не использовать line-clamp** для title и description.

- Title: обычно 1-2 строки, clamp обрежет важную информацию
- Description: обычно 1-3 строки, обрезка нежелательна
- Equal-height через flex-stretch компенсирует разницу: `flex-1` на features zone забирает свободное пространство, `mt-auto` на CTA выравнивает кнопки

Если при visual proof окажется, что конкретный description слишком длинный (5+ строк) — можно добавить `line-clamp-3` точечно, но это решение принимается по факту, не заранее.

### Обязательные test-cases


| Кейс                            | Что проверяется                                          |
| ------------------------------- | -------------------------------------------------------- |
| Badge / no badge                | Badge `absolute -top-3` — не влияет на внутреннюю высоту |
| Old price / no old price        | Доп. строка в price zone                                 |
| Длинный title (2+ строки)       | Title zone растягивается                                 |
| Длинное description (3+ строки) | Description растягивается                                |
| Много features (5+)             | Features zone `flex-1` компенсирует                      |
| Без features                    | CTA поднимается, `mt-auto` работает                      |


### Preview и public чинятся одним PATCH

Нельзя исправить public и оставить preview "на потом". Оба режима исправляются одновременно одними и теми же CSS-правилами. `TariffCarouselGrid` — единый layout owner для обоих.

---

## PATCH C — Carousel interaction UX

### Embla opts: конкретные изменения


| Параметр         | БЫЛО           | БУДЕТ           | Почему                                                                                                 |
| ---------------- | -------------- | --------------- | ------------------------------------------------------------------------------------------------------ |
| `dragFree`       | `true`         | `**false**`     | `dragFree` давал "болтание" и полу-позиции. `false` = чёткий snap                                      |
| `loop`           | `true`         | `true`          | Без изменений                                                                                          |
| `duration`       | не задан (~25) | **tuning-pass** | Не фиксировать 20 как догму. Проверить 18, 20, 22. Зафиксировать финальное значение после visual proof |
| `align`          | `"center"`     | `"center"`      | Без изменений                                                                                          |
| `slidesToScroll` | `1`            | `1`             | Без изменений                                                                                          |


### Tuning-pass для duration

1. Установить `duration: 20`, проверить ощущение
2. Попробовать `duration: 18` (быстрее) и `duration: 22` (плавнее)
3. Выбрать значение без дёрганья и тормозов
4. Зафиксировать финальное после visual proof

### Click-vs-drag DoD (отдельный блок)


| Проверка                                              | Ожидание                                  |
| ----------------------------------------------------- | ----------------------------------------- |
| Быстрый клик по CTA внутри карточки                   | Открывается оплата, drag не перехватывает |
| Drag по карточке → отпускание                         | Snap к ближайшему слайду, CTA не сработал |
| Быстрые последовательные клики по стрелкам (3-4 раза) | Карусель плавно проматывает без дёрганья  |
| Dots после drag                                       | Корректно показывают текущий слайд        |
| Dots после arrows                                     | Корректно обновляются                     |


### Active/inactive state

- Active: `opacity-100`
- Adjacent: `opacity-[0.92]` — лёгкое затухание, текст читаем
- Rest: `opacity-[0.85]` — заметное, но не "мёртвое"

Если при visual proof 0.92/0.85 слишком бледно или слишком однородно — допустима корректировка значений. Но запрещено менять геометрию (см. STOP-guards).

### Wheel/trackpad scroll

**Не является обязательным deliverable текущего PATCH.**
Base acceptance criteria должны быть достигнуты без wheel-plugin.
Если после закрытия PATCH B+C останется явный UX-gap — вынести wheel/trackpad enhancement отдельным follow-up PATCH.

---

## Файлы


| Файл                                                 | Изменение                                                            |
| ---------------------------------------------------- | -------------------------------------------------------------------- |
| `src/components/landing/TariffCarouselGrid.tsx`      | Убрать `scale`; смягчить opacity; `dragFree: false`; duration tuning |
| `src/components/landing/UniversalPricingSection.tsx` | `className="h-full"` на `AnimatedSection` L120                       |
| `src/hooks/useEqualHeight.ts`                        | **Только если CSS не решил** — fallback хук                          |


### НЕ трогаем (FROZEN)

- `src/lib/resolveTariffDisplayConfig.ts`
- `src/components/landing/TariffCard.tsx` (suffix logic)
- `src/lib/tariffCardViewModel.ts`
- Edge Functions
- `carousel.tsx`

---

## Proof-cases (обязательные)


| Кейс                        | Тип                     | Что показать                                  |
| --------------------------- | ----------------------- | --------------------------------------------- |
| Consultation (4 карточки)   | Carousel — **основной** | Одинаковая высота, CTA baseline, suffix "BYN" |
| Club (3 карточки)           | Grid — **regression**   | Grid layout не сломан                         |
| Бизнес-тренинг (1 карточка) | Single — **regression** | Single-card layout не сломан                  |


Для каждого — **три viewport**: admin preview desktop, public desktop, public mobile (375px).

В каждом отдельно подписать:

- Высота карточек одинакова ✓/✗
- CTA на одной горизонтальной линии ✓/✗
- Характер перелистывания (для carousel)
- Suffix не сломан повторно ✓/✗

---

## Запреты

1. Suffix/config-driven patch повторно не ломать — **FROZEN**
2. Active card не может отличаться геометрией (scale/translateY/padding/font-size/border-width)
3. `dragFree: true` не использовать как дефолт
4. Два разных layout-механизма для preview и public запрещены
5. Wheel-plugin — не обязательный deliverable, только follow-up
6. `useEqualHeight` — только fallback после proof что CSS не решил
7. `duration` — не фиксировать без tuning-pass