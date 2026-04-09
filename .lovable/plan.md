# да, согласен, с учетом правок:

&nbsp;

1. **Убрать режим partial только после фактического полного runtime**
  Недостаточно просто убрать плашку в UI. Нужно:
  &nbsp;
  - завершить SectionLockedState;
  - вывести список всех продуктов/тарифов, открывающих секцию;
  - подключить это к реальным section_access rules;
  - после этого перевести getRuntimeSupport('section_access') из "partial" в "full";
  - убрать warning-плашку из формы создания правила.
  &nbsp;
2. **Не делать отдельный новый RPC, если можно расширить текущий read-model**
  Лучше не плодить два почти одинаковых источника (get_user_section_access и get_section_access_catalog), а расширить текущий read-side так, чтобы UI получал:
  &nbsp;
  - has_access
  - is_public
  - is_active
  - section_label
  - short_description
  - features_json
  - массив available_via_rules[] с product/tariff данными
    Это снизит риск рассинхрона между guard, sidebar и locked-screen.
  &nbsp;
3. **Locked-screen должен показывать все правила доступа, не только первое**
  Для секции нужно вернуть **все** активные section_access rules:
  &nbsp;
  - product-level
  - tariff-level
  - без потери дублей/вариантов
    UI должен группировать:
  - “Доступно по тарифам”
  - “Доступно по продуктам”
  &nbsp;
4. **SectionGuard рендерить внутри shell платформы**
  Исправление нужно делать именно архитектурно:
  &nbsp;
  - deny/error/inactive state должны рендериться внутри DashboardLayout;
  - sidebar, breadcrumbs, header сохраняются;
  - никаких голых пустых экранов без оболочки.
  &nbsp;
5. **Добавить маркетинговые данные секции в app_sections**
  Поддерживаю add-only расширение таблицы:
  &nbsp;
  - short_description text
  - features_json jsonb
  - cta_label text
  - опционально purchase_route text
    Это лучше, чем хардкодить описание секции в компоненте.
  &nbsp;
6. **Ссылки CTA должны быть детерминированными**
  В plan нужно явно зафиксировать порядок:
  &nbsp;
  - если у тарифа есть публичная страница → ссылка на тариф;
  - иначе если у продукта есть публичная страница → ссылка на продукт;
  - иначе fallback на /products.
    Нельзя оставлять “как-нибудь потом подберём”.
  &nbsp;
7. **Для inactive и gated сделать два разных сценария**
  &nbsp;
  - is_active=false → “Раздел временно недоступен”
  - is_public=false && !has_access → paywall/locked-state
    Тексты и CTA должны различаться.
  &nbsp;
8. **Убрать warning “частичная поддержка” в админке правил**
  После полного внедрения:
  &nbsp;
  - удалить warning-блок под селектором section_access;
  - заменить его на обычный нейтральный helper-text;
  - в карточке rules section_access должен отображаться как обычный fully-supported тип.
  &nbsp;
9. **DoD расширить**
  Добавить обязательные proof:
  &nbsp;
  - /ai deny внутри shell;
  - sidebar остаётся;
  - breadcrumbs остаются;
  - locked-screen показывает описание;
  - locked-screen показывает все доступные тарифы/продукты;
  - CTA реально ведут на покупку;
  - warning “частичная поддержка” исчез из формы;
  - getRuntimeSupport('section_access') === "full".
  &nbsp;
10. **Отдельный STOP-guard**
  Не закрывать патч, пока не выполнены одновременно:
  &nbsp;
  - UI deny внутри layout;
  - read-model возвращает все access rules для секции;
  - warning про partial support убран;
  - хотя бы по ai есть живой browser-proof для non-admin.
  &nbsp;

&nbsp;

&nbsp;

&nbsp;

### **Копируемый блок для Lovable**

&nbsp;

```
Дополни план правками:

1. Не просто убрать warning “частичная поддержка”, а сначала завершить полный runtime для section_access:
- locked-screen внутри shell платформы
- список всех продуктов/тарифов, открывающих секцию
- CTA на покупку
- только после этого перевести getRuntimeSupport('section_access') в "full" и убрать warning из UI

2. Не плодить второй почти дублирующий RPC без необходимости.
Предпочтительно расширить существующий read-model section access так, чтобы он возвращал:
- has_access
- is_public
- is_active
- section_label
- short_description
- features_json
- available_via_rules[] со всеми product/tariff access rules

3. Locked-screen должен показывать не одно лучшее правило, а все активные правила доступа к секции.
Сгруппировать в UI:
- доступно по тарифам
- доступно по продуктам

4. Исправление SectionGuard сделать архитектурно:
deny/error/inactive state рендерятся внутри DashboardLayout, а не как голый экран.
Sidebar, breadcrumbs, page shell должны сохраняться.

5. Добавить в app_sections add-only поля:
- short_description text
- features_json jsonb default '[]'
- cta_label text
- optional purchase_route text

6. Явно зафиксировать порядок CTA:
- сначала ссылка на тариф, если есть
- затем ссылка на продукт, если есть
- fallback на /products

7. Разделить сценарии:
- is_active=false → “Раздел временно недоступен”
- is_public=false && !has_access → paywall/locked-state

8. После полного внедрения убрать warning-блок “Частичная поддержка...” из формы section_access и заменить его обычным helper-text.
section_access должен отображаться как fully-supported тип.

9. Расширить DoD:
- /ai deny внутри layout
- sidebar и breadcrumbs видны
- есть описание секции
- есть список всех продуктов/тарифов доступа
- есть CTA на покупку
- getRuntimeSupport('section_access') = "full"
- warning “частичная поддержка” исчез из UI
- browser-proof для non-admin

10. STOP-guard:
патч не считается завершённым, пока одновременно не выполнены:
- deny inside shell
- полный access catalog для секции
- warning про partial support убран
- живой proof на /ai

План: Section Locked Experience V2
```

## Проблема

SectionGuard рендерит deny-экран **вместо** страницы. Но каждая страница сама оборачивается в `<DashboardLayout>` (sidebar, breadcrumbs, header). Когда SectionGuard блокирует — `DashboardLayout` не вызывается, пользователь видит голый экран без shell платформы.

Дополнительно: deny-экран показывает только общий текст «доступен по подписке», без описания раздела, без списка продуктов/тарифов, без CTA на покупку.

## Архитектурное решение

SectionGuard при deny должен рендерить `<DashboardLayout>` + новый компонент `<SectionLockedState>` внутри, вместо голого div.

```text
Сейчас (deny):
  Route → ProtectedRoute → SectionGuard → <div>Доступ ограничен</div>
  (DashboardLayout не вызывается, sidebar/breadcrumbs пропадают)

После (deny):
  Route → ProtectedRoute → SectionGuard → <DashboardLayout><SectionLockedState /></DashboardLayout>
  (sidebar, breadcrumbs, header сохраняются)
```

## Что будет сделано

### 1. Миграция: добавить поля описания в `app_sections`

Add-only, 3 новых колонки:

- `short_description text` — краткое описание раздела
- `features_json jsonb DEFAULT '[]'` — массив возможностей раздела
- `cta_label text` — текст CTA-кнопки (опционально)

Заполнить данные для секции `ai` (единственная `is_public=false`):

- short_description: «AI-помощник для бизнеса и бухгалтерии»
- features_json: `["Общение с AI-помощником", "Помощь по бухгалтерским и юридическим вопросам", "Подготовка и анализ документов", "Ускорение рутинных задач"]`

### 2. Новый RPC: `get_section_access_catalog`

Возвращает ВСЕ правила доступа для конкретной секции (не одно лучшее, как сейчас):

- section_code, section_label, short_description, features_json
- Массив правил: product_id, product_name, tariff_id, tariff_name

Это read-side каталог для locked-screen. Отдельный от `get_user_section_access` (который отвечает за факт доступа).

### 3. Новый хук: `useSectionCatalog(sectionCode)`

- Вызывает `get_section_access_catalog` 
- Возвращает описание секции + список продуктов/тарифов для покупки
- staleTime: 5 минут (редко меняется)

### 4. Новый компонент: `SectionLockedState`

```text
Props:
  - sectionCode: string
  - sectionLabel: string
  - isInactive?: boolean  (для is_active=false — другой текст)

Внутри:
  - Иконка замка
  - Название раздела (h1)
  - Описание раздела (из catalog)
  - Список возможностей (features) — маркированный список
  - Блок «Доступно по продуктам/тарифам» — карточки/бейджи
  - CTA-кнопки: «Перейти к покупке» → /products (fallback)
  - Для inactive: упрощённый текст «Раздел временно недоступен»
```

### 5. Изменение `SectionGuard`

При deny (gated + no access) и при inactive:

- Вместо голого `<div>` → `<DashboardLayout><SectionLockedState ... /></DashboardLayout>`
- При isError → тоже оборачивать в `<DashboardLayout>`

Порядок проверок не меняется. Admin bypass не меняется.

### 6. CTA-ссылки

- Если у продукта есть страница `/pricing/:slug` — ссылка на неё
- Если у тарифа есть `public_id` → `/pricing/tariff/:publicId`
- Fallback: `/products`

Для определения ссылки: RPC возвращает product_id, можно проверить наличие slug/pricing. На первом этапе — безопасный fallback на `/products`.

## Файлы


| Файл                                             | Действие                                   |
| ------------------------------------------------ | ------------------------------------------ |
| Миграция                                         | ADD колонки в app_sections + данные        |
| Миграция                                         | CREATE FUNCTION get_section_access_catalog |
| `src/hooks/useSectionCatalog.ts`                 | Новый хук                                  |
| `src/components/sections/SectionLockedState.tsx` | Новый компонент                            |
| `src/components/layout/SectionGuard.tsx`         | Обернуть deny в DashboardLayout            |


## Что НЕ меняется

- `useSectionAccess` — без изменений
- `get_user_section_access` RPC — без изменений
- AppSidebar — без изменений
- Admin bypass — без изменений
- Money.tsx / LiveEvents.tsx внутренний gating — без изменений
- Роуты в App.tsx — без изменений
- money и live остаются `is_public=true`

## Ограничения

- money и live: перевод в `is_public=false` запрещён без отдельного proof
- SectionGuard — внешний фильтр, не заменяет внутренние проверки страниц
- На первом этапе CTA = fallback на `/products`, точные product landing — follow-up

## DoD

1. `/ai` при deny → locked-screen внутри DashboardLayout (sidebar виден, breadcrumbs видны)
2. Locked-screen показывает название и описание раздела
3. Locked-screen показывает список возможностей (features)
4. Locked-screen показывает продукты/тарифы, через которые открывается доступ
5. Locked-screen содержит CTA-кнопку перехода на покупку
6. `is_active=false` → упрощённый locked-screen внутри layout
7. isError → error UI внутри layout
8. Admin bypass работает — locked-screen не показывается
9. Existing money/live/knowledge внутренний gating не сломан