# да, согласен, с учетом правок:

&nbsp;

1. **Исправить URL-архитектуру: отказаться от поддоменов как primary path.**
  В плане явно зафиксировать, что canonical public URL для продуктовых/тарифных страниц строится через основной домен и slug страницы:
  &nbsp;
  - gorbova.by/<page-slug>
  - gorbova.by/<page-slug>#tariffs
    Поддомены оставить только как legacy/fallback, не как основную модель.
  &nbsp;
2. **Связать site builder и pricing/product system через page-level canonical binding.**
  Не просто показывать тарифы на отдельной slug-странице, а сделать единую модель:
  &nbsp;
  - страница в конструкторе может быть canonical page продукта
  - pricing block на этой странице должен подтягивать тарифы именно связанного продукта
  - canonical pricing URL продукта всегда должен вычисляться от slug этой страницы
  &nbsp;
3. **Добавить двустороннюю ручную привязку product ↔ site page.**
  Обязательно в обе стороны:
  &nbsp;
  - в карточке продукта можно указать site_page_id
  - в карточке/настройках страницы можно указать product_id
  &nbsp;
4. **Сделать ID видимыми и пригодными для ручной связки.**
  В обеих сущностях должно быть:
  &nbsp;
  - отображение собственного ID
  - копирование ID
  - отображение связанной сущности
  - кнопка перехода на связанную сущность
  &nbsp;
5. **Один canonical source of truth для связи.**
  Не допускать двух несинхронных связей.
  Нужно прямо прописать, какая таблица и какое поле являются единственным owner relation.
  Базово: site_pages.product_id как canonical binding, а UI продукта просто управляет этой же связью.
6. **Явно зафиксировать кардинальность связи.**
  По умолчанию принять:
  &nbsp;
  - **1 product ↔ 1 canonical page**
    Если подрядчик хочет оставить many pages → 1 product, то это допустимо только как secondary/non-canonical pages, но canonical pricing URL у продукта всё равно должен быть один.
  &nbsp;
7. **Добавить обязательные валидации ручной привязки.**
  &nbsp;
  - проверка существования введённого ID
  - запрет привязки к архивной/удалённой сущности
  - ошибка, если продукт уже привязан к другой canonical page
  - confirm при перепривязке
  - защита от циклов/рассинхрона
  &nbsp;
8. **Если сайта у продукта нет — всё равно должен существовать public pricing page.**
  Это нужно зафиксировать отдельно:
  &nbsp;
  - при отсутствии полноценной страницы сайта система должна уметь создать canonical public page для тарифов продукта
  - URL должен быть на основном домене через slug, а не на localhost и не на временном тех-домене
  - такая страница должна поддерживать #tariffs
  &nbsp;
9. **Если страница сайта есть — pricing block должен быть встраиваемым и переиспользуемым.**
  Нужно описать два сценария:
  &nbsp;
  - canonical page целиком
  - встраиваемый pricing block внутри любой страницы конструктора
    И в обоих случаях тарифы должны подтягиваться от одного и того же product binding.
  &nbsp;
10. **Уточнить anchor policy.**
  Сейчас в плане и коде должен использоваться один canonical anchor.
  Если уже принят #tariffs, то закрепить его как единый стандарт и не плодить параллельно #prices.
  Если нужен alias #prices для legacy-ботов/старых ссылок — добавить редирект/scroll alias, но canonical оставить один.
11. **Добавить legacy compatibility для уже существующих ссылок.**
  Если сейчас в ботах/рассылках уже используются ссылки вида:
  &nbsp;
  - club.gorbova.by/#prices
  - или другие legacy-варианты
    то в плане должен быть отдельный блок:
  - как они продолжают работать
  - делается ли redirect на новый canonical path
  - как не сломать старые ссылки в сообщениях
  &nbsp;
12. **Нужен отдельный proof-block по site builder integration.**
  Проверить оба сценария:
  &nbsp;
  - сначала создан сайт/страница → потом привязали продукт
  - сначала создан продукт → потом привязали страницу
    В обоих случаях должен получаться одинаковый canonical pricing URL и одинаковый pricing block.
  &nbsp;
13. **PATCH C не считать закрытым без реального browser-proof carousel на desktop и mobile.**
  В план нужно добавить, что визуальное “стало лучше” недостаточно. Нужны доказательства:
  &nbsp;
  - desktop: arrows, drag, dots, click-vs-drag по CTA
  - mobile: swipe, видимость того, что карточки можно листать, корректность CTA
  - preview и public должны вести себя одинаково
  &nbsp;
14. **Для mobile добавить явный affordance листания.**
  Сейчас это не доказано. В плане потребовать конкретное решение:
  &nbsp;
  - либо частично видимый соседний слайд
  - либо fade/gradient hint
  - либо стрелки/подсказка на mobile
    Но пользователь должен сразу понимать, что карточки листаются.
  &nbsp;
15. **Не ограничиваться только консультацией.**
  Все изменения по URL, binding, pricing block и carousel должны работать одинаково для:
  &nbsp;
  - текущих продуктов
  - новых продуктов
  - новых страниц конструктора
    Без special-case по consultation/club/business.
  &nbsp;

&nbsp;

&nbsp;

Копируемый блок для Lovable:

```
Дополни план правками:

1. Зафиксируй новую canonical URL-модель: основной путь через основной домен и slug страницы, а не через поддомены.
Canonical:
- `gorbova.by/<page-slug>`
- `gorbova.by/<page-slug>#tariffs`

2. Поддомены оставить только как legacy/fallback. Они не должны быть primary architecture.

3. Добавь двустороннюю ручную привязку `product ↔ site page`:
- из карточки продукта можно указать `site_page_id`;
- из карточки страницы можно указать `product_id`.

4. Сделай ID обеих сущностей видимыми и копируемыми:
- `product id`
- `site/page id`

5. Зафиксируй один canonical source of truth для связи.
Нельзя делать две независимые ссылки, которые могут разъехаться.
Базово использовать один owner relation, например `site_pages.product_id`, а UI продукта должен управлять этой же связью.

6. Явно опиши кардинальность связи.
Базовый ожидаемый вариант:
- `1 product ↔ 1 canonical page`
Если допускаются дополнительные страницы, это должны быть secondary pages, но canonical pricing URL у продукта должен быть один.

7. Для ручной привязки добавь обязательные валидации:
- ID существует;
- сущность не архивная/не удалённая;
- если уже есть старая привязка — warning/confirm;
- защита от рассинхрона и конфликтов.

8. Если у продукта нет готового сайта, система всё равно должна уметь создать canonical public pricing page на основном домене через slug.
Не localhost, не временный тех-домен.

9. Если страница сайта уже существует, pricing block должен быть встраиваемым внутрь страницы конструктора и подтягивать тарифы связанного продукта.
Нужны оба сценария:
- standalone canonical page;
- embedded pricing block внутри существующей страницы.

10. Уточни anchor policy.
Если уже используем `#tariffs`, закрепить его как canonical anchor.
Не плодить параллельно `#prices`.
Если нужен legacy alias для старых ссылок — добавить alias/redirect, но canonical anchor оставить один.

11. Добавь legacy compatibility для уже отправленных ссылок из бота/рассылок.
Нужно отдельно описать:
- какие старые ссылки продолжают работать;
- какие редиректятся на новый canonical path;
- как не ломаются уже отправленные пользователям ссылки.

12. Добавь отдельный proof-block по двусторонней связке:
- сначала создан сайт/страница → потом привязан продукт;
- сначала создан продукт → потом привязана страница;
- в обоих случаях canonical pricing URL и блок тарифов работают одинаково.

13. PATCH C (carousel UX) не считать закрытым без browser-proof:
- desktop: arrows, drag, dots, click-vs-drag по CTA;
- mobile: swipe, явный affordance листания, корректный CTA;
- preview и public должны вести себя одинаково.

14. Для mobile обязательно добавить явный affordance, что карточки листаются:
- частично видимый соседний слайд и/или
- fade/gradient hint и/или
- mobile arrows / indicator.
Сейчас это должно быть отдельно доказано.

15. Все изменения должны быть универсальными для всех продуктов и новых страниц конструктора.
Без special-case по consultation/club/business.

16. Всё это добавить add-only поверх уже существующих PATCH A/B/C/D.
Ничего из уже утверждённой config-driven pricing логики, equal-height и site-builder integration не удалять.
```

&nbsp;

&nbsp;

# План: PATCH D — Product ↔ Site Page привязка, anchor `#tariffs`, carousel proof

## Статус PATCHей


| PATCH                                                  | Статус                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------- |
| A — suffix/config-driven rendering                     | **CLOSED**                                                    |
| B — equal-height layout                                | **PARTIALLY VERIFIED** — визуально улучшен, нужен final proof |
| C — carousel interaction UX                            | **OPEN** — drag/scroll/mobile не доказаны browser-proof       |
| D — product↔page binding + anchors + mobile affordance | **NEW**                                                       |


---

## Discovery: что уже есть

### Связь product ↔ site_page

- Таблица `site_pages` уже имеет колонку `product_id` (FK → `products_v2.id`)
- `SitePageService.createPage()` и `updatePage()` уже принимают `product_id`
- Связь `isOneToOne: false` — сейчас допускается many pages → 1 product
- **НО**: в admin UI продукта (`AdminProductDetailV2`) нет поля для выбора/привязки страницы
- **НО**: в admin UI конструктора (`PricingBlockEditor`) привязка идёт на уровне блока (`content.product_id`), а не страницы

### Anchor

- `UniversalPricingSection` рендерит `<section id="tariffs">` — anchor уже `#tariffs`, не `#prices`
- `PricingSection` (site-builder wrapper) добавляет свой `<section className="py-12 px-6">` поверх — anchor `id="tariffs"` находится внутри, но доступен для scroll
- **Нигде нет** smooth-scroll обработки при загрузке с hash

### Routing

- Публичные страницы доступны по `/:slug` через `SitePageBySlug`
- На `gorbova.by` нужно чтобы `gorbova.by/club` → страница с slug `club`
- `gorbova.by/club#tariffs` должен открыть страницу и прокрутить к тарифам

### Кардинальность

- Базовая модель: **1 product ↔ 1 canonical page** (для pricing URL)
- `site_pages.product_id` уже есть как FK, но `isOneToOne: false` — нужно добавить UNIQUE constraint или обрабатывать программно
- Pricing block на странице привязывается к product через `content.product_id` — это уровень блока, не страницы
- Страничный `product_id` нужен для обратной связи: "какая страница canonical для этого продукта"

---

## PATCH D — Изменения

### D1. Двусторонняя привязка product ↔ site page

**БД:**

- Добавить UNIQUE index на `site_pages.product_id` (WHERE product_id IS NOT NULL) — гарантирует 1 product ↔ 1 canonical page
- Это не сломает существующие данные (сейчас product_id либо null, либо уникален де-факто)

**Admin UI продукта (`AdminProductDetailV2.tsx`):**

- Добавить секцию "Страница сайта" с:
  - Dropdown со списком страниц из site_pages (или поле для ввода page ID)
  - Отображение: slug страницы, canonical URL, кнопка "Перейти в конструктор"
  - Если страница привязана — показать `gorbova.by/<slug>#tariffs` как canonical pricing URL с кнопкой копирования
  - Если не привязана — кнопка "Создать страницу" (создаёт минимальную страницу с pricing block, привязанным к этому продукту)

**Admin UI конструктора страниц:**

- В настройках страницы добавить поле "Привязанный продукт" с dropdown из products_v2
- Показать product ID для копирования
- Валидации:
  - Проверка существования ID
  - Предупреждение если product уже привязан к другой странице
  - Запрет привязки к удалённому/неактивному продукту

**Единый source of truth:** колонка `site_pages.product_id`. Запись идёт через один и тот же update path:

- Из продукта: `SitePageService.updatePage(pageId, { product_id })` или отвязка старой + привязка новой
- Из конструктора: тот же `updatePage(pageId, { product_id })`
- Нет двух независимых ссылок — один FK, одна точка записи

### D2. Anchor scroll при загрузке с hash

**Файл: `src/pages/SitePageBySlug.tsx**`

- После загрузки страницы и рендера блоков — проверить `window.location.hash`
- Если hash есть (например `#tariffs`) — выполнить `document.getElementById('tariffs')?.scrollIntoView({ behavior: 'smooth' })`
- Задержка ~300ms после рендера, чтобы pricing data успела загрузиться

**Файл: `src/components/site-renderer/blocks/PricingSection.tsx**`

- Добавить `id="tariffs"` на внешний `<section>` — сейчас anchor внутри `UniversalPricingSection`, но wrapper PricingSection добавляет свой div поверх. Нужно убедиться, что `id="tariffs"` доступен на уровне, до которого scroll дойдёт корректно

### D3. Canonical pricing URL — config-driven

**Новый утилитный файл: `src/lib/productCanonicalUrl.ts**`

```typescript
function getCanonicalPricingUrl(product: { primary_domain?: string }, pageSlug?: string): string {
  // Если есть привязанная страница в конструкторе
  if (pageSlug) return `https://gorbova.by/${pageSlug}#tariffs`;
  // Fallback на primary_domain (legacy)
  if (product.primary_domain) return `https://${product.primary_domain}/#tariffs`;
  return '';
}
```

Используется в admin UI для отображения canonical URL.

### D4. Mobile carousel affordance

**Файл: `src/components/landing/TariffCarouselGrid.tsx**`

- На mobile показать частично видимый соседний слайд (уже `basis-[88%]` — 12% видно). Проверить, достаточно ли этого визуально
- Добавить gradient fade на краях карусели на mobile: `bg-gradient-to-r from-transparent via-transparent to-background/60` справа
- Dots уже есть — они являются основным индикатором

### D5. Browser-proof для carousel (закрытие PATCH C)

Обязательная проверка в браузере:

- Desktop: drag мышкой, стрелки, dots
- Desktop: trackpad horizontal scroll (если работает нативно через Embla — ОК, если нет — не ломать)
- Mobile (375px): swipe, dots, CTA click
- Click-vs-drag: CTA не срабатывает при drag, стрелки работают подряд

---

## Файлы


| Файл                                                                       | Изменение                                        |
| -------------------------------------------------------------------------- | ------------------------------------------------ |
| `src/pages/SitePageBySlug.tsx`                                             | Hash scroll после рендера                        |
| `src/components/site-renderer/blocks/PricingSection.tsx`                   | `id="tariffs"` на wrapper                        |
| `src/pages/admin/AdminProductDetailV2.tsx`                                 | Секция "Страница сайта" с двусторонней привязкой |
| `src/components/admin/site-builder/SiteBlockEditor.tsx` или settings panel | Поле "Привязанный продукт" на уровне страницы    |
| `src/lib/productCanonicalUrl.ts`                                           | **Новый** — canonical URL builder                |
| `src/components/landing/TariffCarouselGrid.tsx`                            | Mobile gradient hint                             |
| БД: migration                                                              | UNIQUE index на `site_pages.product_id`          |


### FROZEN (не трогаем)

- `resolveTariffDisplayConfig.ts`, EF, suffix logic (PATCH A)
- Equal-height measurement logic (PATCH B)
- Embla opts (PATCH C — только browser-proof, не код)

---

## DoD

1. **Привязка product→page**: из карточки продукта можно выбрать/создать страницу, видно slug и canonical URL
2. **Привязка page→product**: из конструктора можно указать product_id, видна обратная связь
3. **UNIQUE constraint**: один продукт = одна canonical страница, валидация при конфликте
4. **Anchor**: `gorbova.by/<slug>#tariffs` открывает страницу и скроллит к тарифам
5. **Canonical URL**: автоматически вычисляется из page slug, показывается в admin
6. **Mobile affordance**: gradient hint или иной визуальный признак карусели
7. **Browser-proof PATCH C**: desktop drag/arrows/dots + mobile swipe/CTA — скриншоты/видео
8. **Suffix не сломан**: hosted/public/preview показывают одинаковый config-driven результат

### Proof-cases

- `gorbova.by/club#tariffs` → скролл к тарифам клуба
- Создать новый тестовый продукт → привязать страницу → canonical URL работает
- Привязка из продукта и из конструктора даёт одинаковый результат
- Mobile 375px — карусель очевидно листается