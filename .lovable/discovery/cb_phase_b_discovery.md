# Phase B discovery — /cb dynamic buttons

Date: 2026-07-15
Related plan: `.lovable/plan.md` (Phase B).

## 1. HTML snapshot

- `site_pages.id` = `d5a5c2e0-9e4c-4e6c-b9bc-1e4bd264d656`
- Single block, `type=html`, path `blocks[0].content.code`.
- Snapshot: `/mnt/documents/cb_phase_b/cb_html.html`, 3 042 331 B, md5 `bd5e0e3213b3e55dcf8d023231ffc7f5` — идентичен pre-миграции rebind.

## 2. Существующая разметка кнопок

Всего 15 `data-lovable-action`, 15 `data-tariff-key`. Комбинации (tariff_key, action):

| tariff_key | payment | installment | invoice | bank_installment | lead |
|---|---|---|---|---|---|
| buh | 1 | 1 | 1 | 1 | **3** |
| gl_buh | 1 | 1 | 1 | 1 | 0 |
| biz-l | 1 | 1 | 1 | 1 | 0 |

**Замеченные аномалии в исходной Tilda-разметке:**
1. У `buh` три `open-lead` кнопки. Скорее всего — все три «Оставить заявку» с разных карточек, но помеченные одним и тем же `tariff_key="buh"` при экспорте. Визуально они, вероятно, лежат на разных карточках, а атрибут не соответствует реальному тарифу.
2. `gl_buh` и `biz-l` вообще не имеют кнопки `open-lead`, хотя в БД lead-offers у них есть и активны.
3. Каждый тариф имеет только 1 `open-installment`, а у `gl_buh` **два активных `internal_installment` offer'а**: «Оплатить в два этапа» (1 950 BYN) и «Рассрочка на 3 месяца» (2 000 BYN). В HTML физически нет второго слота.

## 3. Структура wrapper'а кнопки (Tilda t396 absolute layout)

Кнопки лежат внутри `<div class="t396__elem tn-elem …">` с **абсолютным позиционированием**: атрибуты `data-field-top-*`, `data-field-left-*` для 5 брейкпоинтов (320/480/640/960/desktop), `style="top:…px; left:…px; width:…px; height:…px;"`. Пример (gl_buh, «Оплата в два платежа»):

```html
<div class="t396__elem tn-elem tn-elem__…" data-elem-id="…" data-elem-type="button"
     data-field-top-value="…" data-field-left-value="…"
     data-field-top-res-320-value="2235" data-field-left-res-320-value="35"
     …
     style="top: 2652px; left: 305.5px; width: 280px; height: 62px;">
  <a class="tn-atom" href="#" data-lovable-action="open-installment" data-tariff-key="gl_buh">
    <div class="tn-atom__button-content">
      <span class="tn-atom__button-text">Оплата в два платежа</span>
    </div>
    <span class="tn-atom__button-border"></span>
  </a>
</div>
```

## 4. Архитектурное последствие абсолютной раскладки

Требование п.24 «включил кнопку — она автоматически появилась» **несовместимо с текущим HTML** без добавления нового `<div class="t396__elem">` wrapper со всеми `data-field-*-res-*` координатами. Причины:

- Tilda позиционирует каждую кнопку по фиксированным координатам на 5 breakpoint'ах. Без готового wrapper новая кнопка не имеет позиции — она либо наложится, либо будет вне viewport.
- Клонировать существующий wrapper и «сдвинуть top на +72px» безопасно только если ниже нет других absolute-элементов. У Tilda всё абсолютно, и такая сдвижка перекроет описания/иконки/следующую карточку.
- Требование п.6 плана прямо это ограничивает: если раскладка absolute — распределять активные offers по существующим позициям, либо fail-closed.

**Практическое следствие для Phase B:**

Есть три реалистичных варианта — нужен ваш выбор одного:

### Вариант A. Слоты по существующим позициям + fail-closed на новые offers
- Разметить **существующие 15 позиций** как слоты (по одной на роль).
- Если админ отключает offer — соответствующий слот исчезает (visibility hidden + display none).
- Если админ переименовывает `button_label` — текст обновляется.
- Если админ меняет `sort_order` — визуальный порядок **не меняется** (координаты жёсткие; поменять порядок = поменять содержимое двух слотов местами, что часто визуально бессмысленно, потому что слот покрашен под свою функцию — банковская рассрочка под другой цвет и т.д.). Sort_order применяется только там, где две кнопки одинакового `site_button_variant` живут в одной колонке (у нас такого нет).
- Если админ добавляет новый offer с ролью, которой нет в HTML — kнопка **не появляется**, в админке пишется warning «Позиции на /cb нет; добавьте слот-контейнер в HTML».
- Это ~80% требования пользователя, без правки HTML на каждый новый offer.

### Вариант B. Замена absolute-раскладки на flow-контейнер только для action-групп
- Перекроить у каждой карточки блок кнопок: убрать `t396__elem` absolute у 4–5 кнопок этой карточки, вложить их в один `<div class="lovable-actions-flow">` с CSS `display:flex; flex-direction:column; gap:12px;`.
- Дизайн каждой кнопки сохраняется (внутренности `.tn-atom`, `.tn-atom__button-content`, границы — не трогаем).
- Позволяет реальный sort_order + автодобавление новых кнопок.
- Визуальная регрессия неизбежна: высота карточки станет динамической, соседние absolute-элементы карточки (цена, «Идёт набор», список пунктов) могут сместиться. Требует ручной проверки каждой карточки в 5 breakpoint'ах.
- Это ~100% требования, но **дизайн /cb перестаёт быть pixel-perfect копией текущего Tilda-экспорта**. Обещание плана «дизайн не меняется» нарушается для action-области карточек.

### Вариант C. Слоты + template-контейнер на каждой карточке
- Разметить существующие позиции как слоты (как в варианте A).
- Дополнительно добавить в каждую карточку **один невидимый normal-flow контейнер** `data-lovable-actions-extra` под action-стеком, куда клонируются только новые offers, которых нет в existing позициях.
- Существующие 15 слотов работают как в A: sort_order по абсолютной раскладке — no-op, rename/hide — работают.
- Новые offers появляются в extra-контейнере (вертикальный стек flex, стилизованный под соседей).
- Визуально: обычно extra-контейнер пуст. Появляется только если админ добавил offer с ролью, которой нет в HTML. Тогда карточка становится длиннее — это допустимый визуальный сдвиг.

## 5. Frozen offer manifest (для backfill `meta.slot_role` + `meta.site_button_variant`)

Все 16 offers PRD-000039. Backfill — **строго по UUID**, без fuzzy-match:

| offer_id | tariff | button_label | offer_type / method | active | slot_role | site_button_variant |
|---|---|---|---|---|---|---|
| `390a5196-8143-4c8f-9bb6-ca84654918c8` | Бухгалтер | Оплата картой | pay_now/full_payment | ✓ | `payment_card` | `primary` |
| `b6476800-cc42-4332-836d-5e63ccc83c47` | Бухгалтер | Оплатить от ЮЛ | pay_now/full_payment | ✓ | `payment_invoice` | `legal_entity` |
| `ba6d162c-d9c4-4fb9-99cd-71a6b3f91b92` | Бухгалтер | Оплатить в рассрочку от банка | bank_installment | ✓ | `installment_bank` | `installment` |
| `7ce395b0-d2b8-4128-b4e2-b00021c5ba3b` | Бухгалтер | Оставить заявку | lead | ✗ | `lead` | `lead` |
| `b2b533e1-0ce3-4ba2-bcfe-ddacc7df30da` | Бухгалтер | Оплатить в рассрочку | pay_now/internal_installment=3 | ✗ | `installment_3` | `installment` |
| `8d10f0c1-8af7-41a1-ac34-791e0e844132` | Главный бухгалтер | Оплатить обучение | pay_now/full_payment | ✓ | `payment_card` | `primary` |
| `d749583b-86ba-44cc-9d9c-bd0e38a70137` | Главный бухгалтер | Оплатить от ЮЛ | pay_now/full_payment | ✓ | `payment_invoice` | `legal_entity` |
| `52091c22-3b1e-412a-a96e-26ad54c02a26` | Главный бухгалтер | Оплатить в два этапа | pay_now/internal_installment=3 (2 платежа, 1950) | ✓ | `installment_2` | `installment` |
| `2bef1db8-b4b6-44bb-b62e-72cd0d713550` | Главный бухгалтер | Рассрочка на 3 месяца | pay_now/internal_installment=3 (2000) | ✓ | `installment_3` | `installment` |
| `58de9fea-808f-40e0-a5ef-f3c5ee14414f` | Главный бухгалтер | Заявка на рассрочку | bank_installment | ✓ | `installment_bank` | `installment` |
| `0067b672-fde9-412c-8b78-0e7d589ec8ba` | Главный бухгалтер | Оставить заявку | lead | ✓ | `lead` | `lead` |
| `27774500-973b-46da-91fd-9feb59bde522` | Бизнес-леди | Оплатить обучение | pay_now/full_payment | ✓ | `payment_card` | `primary` |
| `4c6d6110-5c9b-419c-82ef-524dfe44ecc1` | Бизнес-леди | Оплатить от ЮЛ | pay_now/full_payment | ✓ | `payment_invoice` | `legal_entity` |
| `26f6ed06-69fb-4aaf-964a-2f3668a2085b` | Бизнес-леди | Оплатить в рассрочку | pay_now/internal_installment=3 | ✓ | `installment_3` | `installment` |
| `136a1076-eadf-4e5a-8443-5856f85c2d90` | Бизнес-леди | Заявка на рассрочку | bank_installment | ✓ | `installment_bank` | `installment` |
| `6bd271a7-f716-4996-810c-f401b8d5f97d` | Бизнес-леди | Оставить заявку | lead | ✓ | `lead` | `lead` |

Замечание: у «Главный бухгалтер» реально `installment_2` имеет `installment_count=3` в БД (2 платежа, 1950 BYN) — это данные админа, не наша интерпретация. Роль `installment_2` отражает **бизнес-роль слота**, а не количество платежей.

## 6. Разметка слотов в HTML — карта замен

При выборе Варианта A/C, каждая существующая `<a class="tn-atom" data-lovable-action="…" data-tariff-key="…">` меняется атомарно (14 замен, три `open-lead|buh` требуют отдельного решения):

Fixed replacements table (14 предсказуемых пар):

```
(open-payment,          buh)    → slot="payment_card"       variant="primary"       tariff_id=38ee08c4-...
(open-invoice,          buh)    → slot="payment_invoice"    variant="legal_entity"  tariff_id=38ee08c4-...
(open-installment,      buh)    → slot="installment_3"      variant="installment"   tariff_id=38ee08c4-...  (offer inactive → скрыт)
(open-bank-installment, buh)    → slot="installment_bank"   variant="installment"   tariff_id=38ee08c4-...
(open-payment,          gl_buh) → slot="payment_card"       variant="primary"       tariff_id=a18df7a7-...
(open-invoice,          gl_buh) → slot="payment_invoice"    variant="legal_entity"  tariff_id=a18df7a7-...
(open-installment,      gl_buh) → slot="installment_2"      variant="installment"   tariff_id=a18df7a7-...  (в HTML стоит «Оплатить в два платежа» — совпадает)
(open-bank-installment, gl_buh) → slot="installment_bank"   variant="installment"   tariff_id=a18df7a7-...
(open-payment,          biz-l)  → slot="payment_card"       variant="primary"       tariff_id=767bb895-...
(open-invoice,          biz-l)  → slot="payment_invoice"    variant="legal_entity"  tariff_id=767bb895-...
(open-installment,      biz-l)  → slot="installment_3"      variant="installment"   tariff_id=767bb895-...
(open-bank-installment, biz-l)  → slot="installment_bank"   variant="installment"   tariff_id=767bb895-...
```

**Три `open-lead|buh` (уникальная проблема):** ни один из них скорее всего не принадлежит tariff «Бухгалтер»; лид у buh в БД inactive. Гипотеза: это lead-кнопки трёх карточек, ошибочно все получившие `tariff_key="buh"`. Точное сопоставление невозможно без визуального осмотра HTML в браузере (Playwright screenshot всех трёх). Решение до этого сопоставления: пометить эти три как `slot="lead"` c placeholder `data-lovable-tariff-id` в TBD и **скрыть в manifest** до подтверждения. После сопоставления — один UPDATE, три конкретных tariff_id.

## 7. Что заблокировано до вашего выбора

1. **Выбор варианта A / B / C** для sort_order + add-new-offer.
2. Подтверждение frozen manifest выше (16 offers, роли).
3. Разрешение на **отдельный визуальный аудит трёх `open-lead|buh`** через Playwright screenshot до HTML-миграции.
4. Механизм live-update: `refetchInterval=30_000`, Realtime по `tariff_offers`, или refresh-only. План п.16.

## 8. Что можно начинать сразу после ответов на п.7

- Schema migration: partial unique expr index по `(tariff_id, meta->>'slot_role') WHERE meta->>'slot_role' IS NOT NULL`.
- Backfill migration: 16 UPDATE'ов по UUID из таблицы п.5 (`meta = meta || jsonb '{"slot_role":…,"site_button_variant":…}'`).
- Код parent: `SitePageBySlug` формирует manifest, прокидывает через `SitePageRenderer` → `HtmlSection` → `HtmlIframePreview` новым prop'ом `siteActionManifest`.
- Bridge script v7: handshake `lovable-bridge-ready`, приём manifest, замена текста/скрытие/reorder-в-нормализованной-раскладке.
- Admin UI: два поля в форме offer — `slot_role` (regex `^[a-z0-9_]{2,64}$`), `site_button_variant` (enum). Валидация серверная (CHECK constraint) + клиентская.
- HTML slot migration: 14 фиксированных замен `<a class="tn-atom" data-lovable-action="X" data-tariff-key="Y" …>` → тот же тег с `data-lovable-slot`, `data-lovable-tariff-id`, `data-lovable-offer-role`, `data-lovable-button-variant`, плюс атрибут на wrapper `data-lovable-offer-wrapper` и label-нода `data-lovable-offer-label`. Три `open-lead|buh` — отдельно после аудита.
