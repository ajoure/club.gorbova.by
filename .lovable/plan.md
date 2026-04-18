# да, согласен, с учетом правок:

&nbsp;

1. **Фазу 0 усилить обязательным discovery-пакетом до любого execution.**
  До начала работ подрядчик должен приложить отдельный proof-блок:
  &nbsp;
  - текущий порядок резолва в DomainRouter.tsx
  - proof, что builder-page уже/ещё не проверяется раньше hardcoded
  - карту канонического pricing flow: site_pages.product_id → useSitePricingData → PricingSection → PaymentDialog → checkout
  - inventory текущих block types и уже существующих styling controls
  - proof всех мест использования features
  - proof текущих site_domain_bindings для [consultation.gorbova.by](http://consultation.gorbova.by) и [cons.gorbova.by](http://cons.gorbova.by)
  - поиск, нет ли уже блока stats/metrics/achievements под другим именем
    Без этого Фаза 1 не стартует.
  &nbsp;
2. **Явно зафиксировать: DomainRouter.tsx не трогаем по умолчанию.**
  Менять его можно только если discovery покажет, что builder реально не имеет нужного приоритета.
  Если builder уже стоит раньше legacy/hardcoded, пункт про изменение порядка удалить из плана полностью.
3. **Фаза 1 должна быть не только про “styling controls”, а про reusable design system внутри конструктора.**
  Нужно прямо написать, что цель — собрать не Consultation, а **универсальный конструктор для подобных посадочных**, где потом без кода можно делать:
  &nbsp;
  - консультации
  - мини-лендинги курсов
  - страницы продажи продукта
  - страницы с динамическими тарифами
  - страницы с CTA/FAQ/соцдоказательствами
    Consultation — только proof-case.
  &nbsp;
4. **Расширение BlockSettings сделать осторожно и только там, где это действительно block-agnostic.**
  Разделить настройки на:
  &nbsp;
  - **глобальные**: padding, background, maxWidth, mobile overrides, titleAlignment
  - **карточные**: cardStyle, radius, shadow, borderOpacity
  - **сеточные**: columns/gap/breakpoints
  - **элементные**: itemAlignment, iconMode
    И зафиксировать, что карточные и сеточные настройки применяются только к тем блокам, где это логично, а не “ко всем подряд”.
  &nbsp;
5. **features-блок расширять, но не превращать в свалку.**
  В плане добавить guard:
  &nbsp;
  - layout=grid — текущий режим
  - layout=card-list — вертикальные карточки
  - layout=numbered-list — шаги
    Но не добавлять туда лишние page-specific настройки.
    Если для Consultation потребуется что-то сверх этого — сначала вернуть это в reusable discovery, а не пихать прямо в features.
  &nbsp;
6. **По stats-блоку добавить constraint: только generic renderer, без Consultation-логики.**
  В плане прямо указать:
  &nbsp;
  - никаких зашитых цветов/отступов/размеров под одну страницу
  - все параметры только через schema и editor controls
  - renderer должен использовать существующие design tokens и текущую систему классов проекта
  - никаких кастомных inline-стилей “как на Consultation” без общего параметра
  &nbsp;
7. **Фаза 4 (“сборка Consultation”) должна идти как UI-first, а seed — только как fallback.**
  Правильно, что страница создаётся через UI. Но в плане надо жёстко записать:
  &nbsp;
  - сначала попытка собрать страницу целиком через UI вручную
  - если UI-сборка невозможна из-за объёма/риска человеческой ошибки, допустим controlled seed
  - seed только в формате валидных block schemas
  - после seed страница должна открываться и редактироваться без ошибок, warning и “unknown props”
  &nbsp;
8. **Добавить отдельный discovery по product binding и domain binding в UI.**
  Нужно не только прочитать таблицы, но и подтвердить:
  &nbsp;
  - где в админке реально задаётся site_pages.product_id
  - где в UI создаётся site_domain_bindings
  - есть ли уже workflow “страница как home для домена”
  - не создаст ли Consultation конфликт с уже существующими bindings
    Это важно, потому что здесь чаще всего и ломается пилот.
  &nbsp;
9. **Фазу 5 (E2E pricing matrix) расширить ещё двумя проверками.**
  Добавить:
  &nbsp;
  - **E9:** если на странице нет product_id, pricing block не должен идти по новому пути и не должен показывать чужие тарифы
  - **E10:** если у продукта нет активных тарифов, builder-страница должна показывать корректное пустое состояние, а не ломаться
    Это защитит канонический pricing flow от скрытых регрессий.
  &nbsp;
10. **Rollback plan дополнить проверкой “фактический rollback”.**
  В DoD добавить:
  &nbsp;
  - после draft/unpublish реально открывается legacy Consultation
  - после удаления domain binding реально открывается legacy Consultation
  - rollback подтверждён не теоретически, а скрином/видео/URL proof на обоих доменах
  &nbsp;
11. **Отдельно зафиксировать, что hardcoded Consultation остаётся эталоном сравнения, а не источником логики.**
  То есть:
  &nbsp;
  - как референс по контенту/визуалу — да
  - копировать оттуда бизнес-логику в builder — нет
  - pricing/checkout/product flow — только из текущего канонического builder/commerce path
  &nbsp;
12. **В финальный discovery-пакет добавить “gap table”.**
  Перед implementation подрядчик должен показать таблицу:
  &nbsp;
  - что уже есть в конструкторе
  - чего не хватает для Consultation
  - что будет добавлено reusable-способом
  - что сознательно не делаем в этом спринте
    Это сильно снизит риск расползания scope.
  &nbsp;
13. **Финальный DoD усилить пунктом про отсутствие нового параллельного пути.**
  Добавить отдельный критерий:
  &nbsp;
  - **не создано ни одного нового checkout flow**
  - **не создано ни одного нового источника тарифов**
  - **не создано ни одного page-specific special case для Consultation**
  - **не создана отдельная логика доменного резолва под пилот**, если discovery не доказал необходимость
  &nbsp;
14. **Запрос к подрядчику по окружению и документации.**
  До execution пусть приложит:
  &nbsp;
  - текущее окружение, где будет пилотироваться Consultation
  - доступный URL builder preview
  - доступные домены/поддомены для теста
  - есть ли уже внутренняя документация/архитектурные заметки по site_pages, site_domain_bindings, PricingBlock
  - proof, что его работа будет идти поверх текущих canonical contracts, а не “по памяти”
  &nbsp;
15. **Рекомендация по фазированию исполнения.**
  Делать в таком порядке:
  &nbsp;
  - Discovery пакет
  - Reusable controls
  - Расширение features
  - stats только если discovery подтвердит отсутствие аналога
  - Сборка Consultation
  - Domain binding
  - E2E pricing matrix
  - Rollback proof
    Не смешивать всё в один заход.
  &nbsp;

&nbsp;

&nbsp;

Итог:

план стал существенно лучше и уже выглядит рабочим. Главный акцент надо сохранить на трёх вещах: **discovery-first**, **reusable-first**, **no new commerce/domain path**. После этих уточнений план можно отдавать в реализацию.

&nbsp;

План v2: миграция хардкод-сайтов в конструктор. Reusable-first, discovery-first

## Принцип

Это **не миграция страницы Consultation**. Это **расширение конструктора reusable-настройками блоков**, после которого Consultation (и любой похожий лендинг) собирается без кода и без page-specific хаков. Pricing/checkout/domain flow остаются нетронутыми и подтверждаются discovery до execution.

---

## Фаза 0. Discovery (read-only, до любых изменений)

Обязательный пакет proof-документов перед execution. Ничего не меняем, пока не зафиксированы факты.

**0.1. DomainRouter — порядок резолва**

- `src/components/layout/DomainRouter.tsx` — фактический порядок `if`-веток
- `SiteRenderService.resolveByDomainAndPath` — что именно резолвит и в каком приоритете
- **Вердикт:** если builder-page уже проверяется ДО hardcoded-веток (`isCourseDomain`/`isConsultationDomain`) — пункт «изменить порядок» удаляется из плана полностью. Не трогаем то, что работает.

**0.2. Pricing / Product / Domain canonical flow**
Карта текущего канонического потока (read-only):

- `site_pages.product_id` — связь страница→продукт
- `site_domain_bindings` — связь страница→домен (UI domain bindings)
- `PricingBlock` (admin editor) → `useSitePricingData` → `PricingSection` (renderer)
- `UniversalPricingSection` → `PaymentDialog` → `bepaid-create-token` (одноразовый checkout per `checkout-one-time-contract`)
- CTA в тарифной карточке → существующий guest-checkout flow
- **Зафиксировать в плане:** никакого нового пути оплаты, никакого нового источника тарифов, только reuse.

**0.3. Block types inventory**

- Полный список текущих `BLOCK_TYPES` из `SiteBlockEditor.tsx`
- Какие styling controls уже есть в `BlockSettings` (paddingTop/Bottom, backgroundColor, maxWidth, fullWidth, hideOnMobile/Desktop)
- Какие настройки уже есть в content-схемах отдельных блоков
- Это покажет gap: что добавлять, что уже есть.

**0.4. features-блок — где используется**

- Текущая schema `featuresContentSchema` в `src/services/sitePages/types.ts`
- Все страницы в `site_pages`, использующие блок `features` (SQL по `blocks @> '[{"type":"features"}]'`)
- Подтвердить: добавление опционального `layout` с default = текущему поведению не ломает ни одну существующую страницу.

**0.5. Stats/metrics/achievements — есть ли уже**

- Поиск по `BLOCK_TYPES` и `blockContentSchemas` на наличие чего-то похожего (counters, metrics, numbers, achievements). Если есть — переиспользуем, новый блок не создаём.

**0.6. Текущее состояние Consultation в БД**

- Уже есть ли `site_pages` со `product_id` = consultation product UUID?
- Текущие `site_domain_bindings` для `consultation.gorbova.by` / `cons.gorbova.by` — если есть, в каком статусе?
- Это покажет: создаём с нуля или дополняем существующее.

**Deliverable:** discovery-отчёт перед началом execution. Без него фаза 1 не стартует.

---

## Фаза 1. Reusable styling controls (универсальное расширение, не под Consultation)

Все настройки идут через **существующие схемы** `BlockSettings` и content-schemas, никаких ad-hoc пропсов.

**1.1. Расширение `BlockSettings` (общее для всех блоков)**
Add-only поля (опциональные, default = текущее поведение):

- `containerMaxWidth`: переиспользовать существующий `maxWidth` (уже есть)
- `mobilePaddingTop` / `mobilePaddingBottom` — overrides
- `cardStyle`: `"plain" | "bordered" | "glass" | "filled"` — для блоков, использующих card-обёртки
- `cardRadius`: `"none" | "sm" | "md" | "lg" | "xl"`
- `cardShadow`: `"none" | "sm" | "md" | "lg"`
- `borderOpacity`: число 0-100 (применяется как `border-border/{n}`)
- `itemAlignment`: `"left" | "center" | "right"`
- `titleAlignment`: `"left" | "center" | "right"`

**1.2. Расширение grid-блоков (features, columns, gallery, pricing, stats)**
Reusable secondary schema `gridLayoutSchema`:

- `columnsDesktop`: 1-6
- `columnsTablet`: 1-4
- `columnsMobile`: 1-2
- `gap`: `"sm" | "md" | "lg" | "xl"`

**1.3. Icon mode (для features и stats)**

- `iconMode`: `"none" | "circle" | "square" | "numbered"`
- `numbered` = автоматический порядковый номер вместо иконки (закрывает кейс «После оплаты: 1, 2, 3»)
- `circle` / `square` = форма обёртки иконки

**1.4. Backward-compat гарантии (зафиксировано в DoD)**

- Все новые поля **опциональные**.
- Дефолты подобраны так, что старые страницы рендерятся **без визуальных изменений**.
- Smoke-test: открыть 3-5 существующих страниц `site_pages` после деплоя — diff = 0.

**Файлы:**

- `src/services/sitePages/types.ts` — расширить `BlockSettings`, добавить `gridLayoutSchema`, расширить content-схемы
- `src/components/admin/site-builder/blocks/BlockSettingsEditor.tsx` — UI для новых reusable полей
- Затронутые renderer-блоки (`FeaturesSection`, `ColumnsSection`, `GallerySection`, etc.) — поддержка новых опций с fallback на текущее поведение

---

## Фаза 2. features-блок — generic layout режимы

Только после discovery 0.4.

**2.1. Расширение схемы**

- Добавить `layout: "grid" | "card-list" | "numbered-list"` (опциональное, default = `"grid"` = текущее поведение)
- Добавить `iconMode` (см. 1.3)
- Использовать reusable `gridLayoutSchema` (см. 1.2)

**2.2. Backward-compat**

- Старые блоки без `layout` → рендерятся как раньше (grid).
- Старые блоки без `iconMode` → текущая иконка-emoji.
- Прямое подтверждение: ни одна страница из discovery 0.4 не меняет вид.

**Файлы:**

- `src/services/sitePages/types.ts` — расширить `featuresContentSchema`
- `src/components/admin/site-builder/blocks/FeaturesBlockEditor.tsx` — селекторы layout/iconMode
- `src/components/site-renderer/blocks/FeaturesSection.tsx` (или inline в `SitePageRenderer`) — поддержка трёх режимов

---

## Фаза 3. stats-блок — generic, не «под Consultation»

Только если discovery 0.5 подтвердит, что блока ещё нет.

**3.1. Schema (generic-first)**

```ts
statsContentSchema = {
  title?: string,
  subtitle?: string,
  items: [{
    number: string,        // "500+", "$100k", "24/7"
    suffix?: string,       // опциональный отдельный суффикс
    label: string,         // подпись
    description?: string,  // опциональное второе описание
    icon?: string          // опциональная иконка
  }],
  // grid через reusable gridLayoutSchema (1.2)
  // cardStyle/iconMode/alignment через BlockSettings (1.1, 1.3)
}
```

**3.2. Покрытие use-cases (generic scope)**

- Optional title/subtitle ✓
- 2/3/4 columns desktop + mobile overrides через reusable grid ✓
- Optional icon + iconMode (none/circle/square/numbered) ✓
- card / plain / glass / bordered через cardStyle ✓
- alignment через titleAlignment/itemAlignment ✓
- number + suffix + description ✓

**Файлы:**

- `src/services/sitePages/types.ts` — `statsContentSchema`, регистрация
- `src/components/site-renderer/blocks/StatsSection.tsx` — create
- `src/components/admin/site-builder/blocks/StatsBlockEditor.tsx` — create
- `src/components/admin/site-builder/SiteBlockEditor.tsx` — регистрация в `BLOCK_TYPES`, `getDefaultContent`, switch
- `src/components/site-renderer/SitePageRenderer.tsx` — case `"stats"`

---

## Фаза 4. Сборка пилота Consultation (без page-specific хаков)

Цель — **доказать, что новых возможностей достаточно**. Если в процессе сборки что-то требует кода — возвращаемся в фазу 1-3 и расширяем reusable-контролы, **не делаем спецкейс под страницу**.

**4.1. Создание страницы**

- Через UI `/admin/sites` → New page как обычную страницу
- title/slug/product_id (consultation product UUID) → status: draft

**4.2. Seed blocks (controlled)**

- Допустимо: программный seed `blocks` через тот же schema contract (валидация против `blockContentSchemas`)
- Запрещено: «сырой» JSON в обход валидации
- Результат: страница потом свободно редактируется в UI без артефактов и предупреждений

**4.3. Состав блоков (только из существующего + добавленного reusable)**

- `hero` + CTA (scroll_to_anchor → tariffs)
- `features` (layout=card-list, iconMode=circle) — «Кому подходит»
- `stats` (variant=card, columns=4) — достижения
- `features` (layout=card-list) — список результатов
- `pricing` — product_id consultation, anchorId=`tariffs`
- `features` (layout=numbered-list, iconMode=numbered) — «После оплаты»

**4.4. Domain binding**

- Через UI domain-bindings: `consultation.gorbova.by` (is_home, is_primary), `cons.gorbova.by` (is_home)
- Проверка: `SiteRenderService.resolveByDomainAndPath` находит страницу первой (подтверждено в discovery 0.1)

---

## Фаза 5. E2E pricing matrix (отдельный блок DoD)

Каждый пункт — самостоятельная проверка, фиксируется отдельно:


| #   | Проверка                                                                               | Метод           |
| --- | -------------------------------------------------------------------------------------- | --------------- |
| E1  | Страница привязана к продукту через `site_pages.product_id`                            | SQL + UI        |
| E2  | `pricing` блок подхватывает тарифы именно этого продукта                               | preview + DOM   |
| E3  | Кнопка тарифа открывает **существующий** checkout (PaymentDialog)                      | клик в браузере |
| E4  | Успешная оплата идёт по канон. flow (`bepaid-create-token` + `grant-access-for-order`) | edge logs       |
| E5  | После unpublish страницы → fallback на hardcoded работает                              | toggle + reload |
| E6  | После remove domain binding → builder-страница не отдаётся, hardcoded работает         | toggle + reload |
| E7  | Копирование страницы через UI → дубль редактируется                                    | UI clone        |
| E8  | Старые страницы (5 шт. из discovery 0.4) рендерятся без визуального diff               | preview each    |


---

## Фаза 6. Rollback plan (explicit)

Не «просто unpublish». Полный набор уровней отката:

1. **L1: page status → draft** — builder-страница не отдаётся, fallback автоматический
2. **L2: domain binding disable/remove** — то же на уровне домена
3. **L3: hardcoded fallback intact** — `Consultation.tsx` / `CourseAccountant.tsx` / `Landing.tsx` физически не трогаются в этом спринте
4. **L4: revert схемы** — все новые поля `BlockSettings` опциональные, default safe; revert не требует data migration

**Запрещено в этом спринте:** удаление legacy кода, изменение порядка веток в `DomainRouter` (если discovery 0.1 не покажет, что это критически нужно).

---

## Что НЕ делаем в этом спринте

- Не удаляем `Consultation.tsx`, `CourseAccountant.tsx`, `Landing.tsx`
- Не меняем `DomainRouter.tsx` без явного результата discovery 0.1
- Не трогаем `PricingSection`, `useSitePricingData`, `PaymentDialog`, payment flow
- Не делаем page-specific компоненты — только reusable-расширение
- Не мигрируем Course и Landing — они отдельным тикетом после стабильности Consultation

---

## DoD (финальный)

- Discovery-отчёт по фазе 0 приложен и зафиксирован
- DomainRouter не изменён (или изменение явно обосновано discovery)
- Все новые настройки блоков **generic и reusable**, не page-specific
- Старые страницы (5 шт. на выбор из БД) — визуальный diff = 0
- Consultation собран без code-hacks, только из существующих + добавленных reusable-блоков
- E2E pricing matrix (E1-E8) пройдена полностью
- Rollback plan проверен на L1 и L2 фактически (не «теоретически»)
- Builder-версия Consultation визуально сопоставима с hardcoded (4 скрина: builder/hardcoded × desktop/mobile)
- Страницу можно скопировать через UI и редактировать дубль без артефактов
- Pricing/checkout идут по существующему каноническому пути (подтверждено edge logs)

---

## Список файлов (итого)


| Файл                                                                   | Действие                                                                                                       | Фаза    |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------- |
| `src/services/sitePages/types.ts`                                      | edit — `BlockSettings` reusable поля, `gridLayoutSchema`, `featuresContentSchema.layout`, `statsContentSchema` | 1, 2, 3 |
| `src/components/admin/site-builder/blocks/BlockSettingsEditor.tsx`     | edit — UI для reusable styling controls                                                                        | 1       |
| `src/components/site-renderer/blocks/FeaturesSection.tsx` (или inline) | edit — layout режимы                                                                                           | 2       |
| `src/components/admin/site-builder/blocks/FeaturesBlockEditor.tsx`     | edit — селектор layout/iconMode                                                                                | 2       |
| `src/components/site-renderer/blocks/StatsSection.tsx`                 | create                                                                                                         | 3       |
| `src/components/admin/site-builder/blocks/StatsBlockEditor.tsx`        | create                                                                                                         | 3       |
| `src/components/admin/site-builder/SiteBlockEditor.tsx`                | edit — регистрация stats                                                                                       | 3       |
| `src/components/site-renderer/SitePageRenderer.tsx`                    | edit — case stats, поддержка новых reusable опций в существующих блоках                                        | 1, 3    |
| `src/components/layout/DomainRouter.tsx`                               | **only if discovery 0.1 требует** — иначе НЕ трогаем                                                           | 0       |
