

## **Финальный статус по Wave 1 + Wave 2 + Wave 3**

&nbsp;

&nbsp;

&nbsp;

### **Wave 1 — закрыта**

&nbsp;

&nbsp;

Закрыты:

&nbsp;

- video/source debug
- room layout desktop/mobile
- реальные имена + role badges
- reply в комнате
- inline moderation + muted/remove
- открытие карточки пользователя из комнаты
- employee role fix

&nbsp;

&nbsp;

Осталось только **runtime-тестирование сотрудницей**.

&nbsp;

---

&nbsp;

&nbsp;

### **Wave 2 — закрыта**

&nbsp;

&nbsp;

Закрыты:

&nbsp;

- webinar activity в карточке профиля
- сценарий через отдельную вкладку и RPC projection
- Excel export: комментарии / вопросы / сценарий

&nbsp;

&nbsp;

Осталось только **runtime-проверка данных на реальном сценарии использования**.

&nbsp;

---

&nbsp;

&nbsp;

### **Wave 3 — закрыта условно**

&nbsp;

&nbsp;

Закрыты:

&nbsp;

- product-linked CTA через products/tariffs/offers
- RLS и UI-гварды по CTA
- runtime CTA events
- CTA в scenario/export
- theme settings на уровне live_[events.metadata.room](http://events.metadata.room)_theme
- приоритет new CTA над legacy CTA

&nbsp;

&nbsp;

&nbsp;

### **Deferred follow-up**

&nbsp;

&nbsp;

- **Полная пропагация темы комнаты** во вложенные компоненты:
  &nbsp;
  - чат
  - табы
  - бейджи
  - панели
  - внутренние card-wrapper’ы
  &nbsp;

&nbsp;

&nbsp;

Сейчас тема применяется к контейнеру, фону и верхнему тексту, но не полностью ко всем внутренним UI-элементам.

&nbsp;

---

&nbsp;

&nbsp;

## **Общий статус проекта**

&nbsp;

&nbsp;

&nbsp;

### **Что можно считать выполненным уже сейчас**

&nbsp;

&nbsp;

- Архитектурно основной scope реализован
- База, RPC, triggers, domain events, CRM pipeline, exports, CTA bindings, moderation и replies — собраны
- Критичных архитектурных дыр по текущему proof не видно
- Notifications safety path не задет

&nbsp;

&nbsp;

&nbsp;

### **Что осталось до полного финального закрытия**

&nbsp;

&nbsp;

1. Провести **runtime/UAT тестирование** сотрудницей
2. Отдельно решить, считать ли полную theme propagation обязательной сейчас или вынести в follow-up patch

&nbsp;

&nbsp;

---

&nbsp;

&nbsp;

## **Короткий блок для подрядчика**

&nbsp;

```
Итоговый статус:

Wave 1 — принимается.
Wave 2 — принимается.
Wave 3 — принимается по основному scope.

Отдельный deferred follow-up patch:
— полная пропагация room_theme CSS variables во вложенные компоненты комнаты (чат, табы, бейджи, панели, card wrappers), чтобы тема применялась не только к контейнеру, но и ко всем внутренним UI-элементам.

Дальше:
1. Подготовить финальный proof package по Wave 1–3.
2. Передать на runtime/UAT тест сотруднице.
3. Все найденные баги UAT оформить отдельным consolidated fix patch.
```

&nbsp;

## **Рекомендация**

&nbsp;

&nbsp;

Сейчас логично **не открывать новый большой scope**, а перейти к **полноценному UAT** и потом собрать один consolidated patch по фактическим багам тестирования.

&nbsp;

Отчёт: Wave 3 — Полный Proof

## 1. SQL Proof — RLS policies (ФАКТ из pg_policies)

### live_event_product_cta_bindings


| Policy                                               | CMD    | Условие                                                               |
| ---------------------------------------------------- | ------ | --------------------------------------------------------------------- |
| Staff can read all CTA bindings                      | SELECT | `admin OR super_admin OR employee`                                    |
| Users with event access can read active CTA bindings | SELECT | `is_active = true AND user_has_live_event_access(uid, live_event_id)` |
| Admins can create CTA bindings                       | INSERT | `admin OR super_admin`                                                |
| Admins can update CTA bindings                       | UPDATE | `admin OR super_admin`                                                |
| Admins can delete CTA bindings                       | DELETE | `admin OR super_admin`                                                |


**✅ Старая policy "Staff can manage" удалена. Employee имеет только SELECT.**

### live_event_cta_runtime_events


| Policy                                              | CMD    | Условие                                                                                      |
| --------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| Staff can read all CTA runtime events               | SELECT | `admin OR super_admin OR employee`                                                           |
| Users with event access can read CTA runtime events | SELECT | `user_has_live_event_access(uid, live_event_id)`                                             |
| Admins can show hide replace CTA                    | INSERT | `(admin OR super_admin) AND event_type IN (shown, hidden, replaced)`                         |
| Users can record CTA clicks and submissions         | INSERT | `event_type IN (clicked, form_submitted) AND user_has_live_event_access(uid, live_event_id)` |


**✅ Employee НЕ может INSERT shown/hidden/replaced. Только admin/super_admin.**

---

## 2. Role Matrix Proof (код)

**LiveEventCtaRuntimePanel.tsx (строка 15):**

```typescript
const canManageCta = isAdminRole(role); // admin || superadmin
```

Кнопки Show/Hide обёрнуты в `{canManageCta && (...)}` (строка 112). Employee видит список и статусы, но без кнопок.

**LiveEventProductCtaBindings.tsx (строка 70):**

```typescript
const canManageCta = isAdminRole(role);
```

"Добавить CTA" (строка 184), Switch toggle (строка 209), Edit/Delete — все под `{canManageCta && ...}`.

**✅ UI-гварды соответствуют RLS. Двойная защита: фронт + БД.**

---

## 3. Legacy/New CTA Priority Proof (код)

**LiveEvent.tsx (строки 357-358):**

```typescript
const hasUnderVideoCta = useHasActiveCtaBindings(eventId, "under_video");
const hasSidebarCta = useHasActiveCtaBindings(eventId, "sidebar");
```

**Рендер under_video (строки 413-429):**

- Legacy: `{eventId && !hasUnderVideoCta && <LiveEventRoomBlocks ... />}`
- New: `{eventId && <LiveEventProductCta ... />}`

**Рендер sidebar (строки 435-449):**

- Legacy: `{!hasSidebarCta && <LiveEventRoomBlocks ... />}`
- New: `<LiveEventProductCta ... />`

**✅ Если есть active product CTA binding для позиции — legacy renderer подавлен. Двойной рендер невозможен.**

---

## 4. Product Reuse Proof (код)

**buy_now (строки 190-199):** Открывает каноничный `PaymentDialog` с:

- `productId: product.id` (из products_v2)
- `price: String(offer.amount)` (из tariff_offers — SoT)
- `offerId: offer.id` (из tariff_offers)
- Цена НЕ хардкодится, берётся из БД

**open_product (строки 202-205):** `/product/${product.slug}` — slug из products_v2

**open_tariff (строки 208-214):** `/tariff/${tariff.public_id}` — public_id из tariffs, fallback на product page

**external_link (строка 184):** URL из `binding.metadata.external_url`, metadata клика включает `external_url`, `cta_type`, `product_id`, `tariff_id`, `offer_id`

**✅ Новая параллельная sales-логика не создана. Все пути через существующие SoT.**

---

## 5. Scenario/Export Proof (SQL факт)

RPC `get_live_event_scenario` содержит UNION ALL с CTA runtime events:

- entry_type: `cta_shown`, `cta_hidden`, `cta_replaced`, `cta_clicked`, `cta_form_submitted`
- metadata включает: `binding_id`, `product_id`, `tariff_id`, `offer_id`, `trigger_mode`, `cta_type`
- JOIN на `products_v2.name` для human-readable текста

**✅ CTA события попадают в сценарий и Excel export.**

---

## 6. Theme Proof (код)

**LiveEvent.tsx (строки 361-376):**

```typescript
const roomTheme = data?.room_theme || data?.metadata?.room_theme;
const themeStyle = { '--room-bg': ..., '--room-text': ..., '--room-panel': ..., '--room-accent': ..., ... };
// + inline backgroundColor и color
```

Применяется на `<div ... style={themeStyle}>` (строка 376).

**⚠️ Замечание:** CSS variables заданы, но компоненты внутри (Card, Tabs, Badge) используют Tailwind классы (`bg-card`, `text-foreground`), а не `var(--room-bg)`. **Inline `backgroundColor` и `color` на контейнере работают для фона и текста первого уровня**, но вложенные компоненты (чат, бейджи, панели) **не подхватывают тему через CSS variables**.

**Вердикт:** Фон и основной текст — ✅ работают. Панели, табы, бейджи — ⚠️ частично (нужна доработка CSS variables propagation в компонентах чата/табов, но это можно вынести в follow-up).

---

## 7. Regression Proof

- **recorded_webinar / replay:** Все изменения add-only. `LiveEvent.tsx` рендерит CTA в обоих режимах (`displayContext` передаётся). Legacy blocks не затронуты.
- **Notifications:** Ни один файл notification path не изменён.
- **Comments/Questions/Replies/Moderation:** UNION ALL в `get_live_event_scenario` добавляет новый блок, существующие 4 блока не изменены.

**✅ Регрессии нет.**

---

## Итоговая сводка Wave 3


| Проверка                      | Статус                                          |
| ----------------------------- | ----------------------------------------------- |
| RLS — admin-only write        | ✅ Подтверждено из pg_policies                   |
| RLS — employee read-only      | ✅ Подтверждено                                  |
| UI guards — admin-only кнопки | ✅ Подтверждено из кода                          |
| Legacy/new CTA priority       | ✅ Подтверждено из кода                          |
| PaymentDialog reuse           | ✅ Подтверждено                                  |
| Product/tariff routes         | ✅ Подтверждено                                  |
| external_link metadata        | ✅ Подтверждено                                  |
| Scenario CTA entries          | ✅ Подтверждено из SQL                           |
| Theme — фон/текст             | ✅ Работает                                      |
| Theme — панели/бейджи/табы    | ⚠️ Частично (CSS vars заданы, но не propagated) |
| Regression                    | ✅ Нет регрессий                                 |


## Рекомендация

**Wave 3 можно считать закрытой по DoD** с одним deferred item:

- **Deferred:** Пропагация CSS variables темы во вложенные компоненты (чат, табы, бейджи). Сейчас работает фон + текст первого уровня. Полная тема — follow-up.

Если заказчик согласен с deferred для глубокой темизации — Wave 3 закрыта. Если нет — нужен ещё один патч на propagation CSS variables в компоненты чата.