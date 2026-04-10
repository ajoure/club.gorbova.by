# Да, согласен, с учетом правок:

&nbsp;

1. **PATCH 10.1 — права на CTA привести к матрице ролей**
  &nbsp;
  - Сейчас это реализовано неверно: employee имеет full CRUD и может show/hide CTA.
  - Исправить RLS:
    &nbsp;
    - live_event_product_cta_bindings:
      &nbsp;
      - SELECT — admin/super_admin/employee + users с доступом к эфиру
      - INSERT/UPDATE/DELETE — только admin/super_admin
      &nbsp;
    - live_event_cta_runtime_events:
      &nbsp;
      - SELECT — admin/super_admin/employee + users с доступом к эфиру
      - INSERT для shown/hidden/replaced — только admin/super_admin
      - INSERT для clicked/form_submitted — room runtime / authenticated user with access
      &nbsp;
    &nbsp;
  - Исправить UI:
    &nbsp;
    - LiveEventCtaRuntimePanel — employee только read-only, без show/hide
    - LiveEventProductCtaBindings — employee только просмотр, без create/edit/delete
    &nbsp;
  &nbsp;
2. **PATCH 10.2 — убрать двойной рендер legacy/new CTA**
  &nbsp;
  - Сейчас в LiveEvent.tsx одновременно рендерятся:
    &nbsp;
    - legacy LiveEventRoomBlocks
    - new LiveEventProductCta
    &nbsp;
  - Это создаёт риск двойного CTA в одной позиции.
  - Нужен явный приоритет:
    &nbsp;
    - если для позиции (under_video / sidebar / sticky) есть активный product CTA binding, legacy renderer для этой позиции не рендерить;
    - legacy оставить только как fallback/compat mode.
    &nbsp;
  - Это нужно сделать и документировать явно.
  &nbsp;
3. **PATCH 13.1 — тема комнаты сейчас только сохраняется, но не применяется**
  &nbsp;
  - LiveEventThemeEditor пишет в live_[events.metadata.room](http://events.metadata.room)_theme, но LiveEvent.tsx не использует тему в UI.
  - Нужно применить тему через CSS variables/style props на контейнере комнаты:
    &nbsp;
    - background_color
    - primary_text_color
    - secondary_text_color
    - panel_color
    - accent_color
    - tabs_color
    - admin_badge_color
    - employee_badge_color
    &nbsp;
  - Theme proof считать закрытым только после фактического применения в room UI.
  &nbsp;
4. **PATCH 10.3 — external_link click enrichment**
  &nbsp;
  - При external_link сейчас пишется общий clicked, но без явной фиксации URL.
  - Добавить в metadata runtime event:
    &nbsp;
    - cta_type
    - external_url
    - product_id
    - tariff_id
    - offer_id
    &nbsp;
  - То же при audit/domain event, чтобы потом была нормальная аналитика.
  &nbsp;
5. **PATCH 10.4 — proof по product reuse зацементировать в DoD**
  &nbsp;
  - Для buy_now показать, что используется именно каноничный PaymentDialog:
    &nbsp;
    - productId из products_[v2.id](http://v2.id)
    - offerId из tariff_[offers.id](http://offers.id)
    - цена из tariff_offers.amount
    - без хардкода
    &nbsp;
  - Для open_product/open_tariff подтвердить реальные существующие маршруты:
    &nbsp;
    - /product/:slug
    - /tariff/:publicId
    &nbsp;
  - Это включить в обязательный proof-блок.
  &nbsp;
6. **PATCH 14.1 — scenario/export proof закрепить как обязательный**
  &nbsp;
  - Недостаточно того, что UNION ALL есть в SQL.
  - Нужен proof:
    &nbsp;
    - cta_shown
    - cta_hidden
    - cta_replaced
    - cta_clicked
    - cta_form_submitted
      реально возвращаются из get_live_event_scenario
    &nbsp;
  - И что LiveEventExportButtons действительно выгружает эти записи в Excel.
  &nbsp;
7. **Wave 3 не считать закрытой до выполнения этих фиксов**
  &nbsp;
  - Сейчас Wave 3 = **частично выполнена**, но не закрыта.
  - Закрытие только после:
    &nbsp;
    - SQL proof по новым RLS
    - runtime proof CTA
    - proof отсутствия двойного рендера
    - theme applied proof
    - regression proof
    &nbsp;
  &nbsp;

&nbsp;

&nbsp;

Готовый блок для вставки подрядчику:

```
Дополни Wave 3 правками:

1. Исправить права CTA по матрице ролей.
- Сейчас employee ошибочно имеет full CRUD и может show/hide CTA.
- Нужно:
  - live_event_product_cta_bindings:
    - SELECT: admin/super_admin/employee + users с доступом
    - INSERT/UPDATE/DELETE: только admin/super_admin
  - live_event_cta_runtime_events:
    - SELECT: admin/super_admin/employee + users с доступом
    - INSERT для shown/hidden/replaced: только admin/super_admin
    - INSERT для clicked/form_submitted: runtime room flow / authenticated user with access

2. Исправить UI-гварды.
- LiveEventCtaRuntimePanel:
  - employee = только просмотр
  - admin/super_admin = show/hide
- LiveEventProductCtaBindings:
  - employee = только просмотр
  - admin/super_admin = create/edit/delete

3. Убрать конфликт legacy/new CTA.
- Сейчас в LiveEvent.tsx одновременно рендерятся legacy LiveEventRoomBlocks и new LiveEventProductCta.
- Ввести явный приоритет:
  - если есть active product CTA binding для позиции, legacy renderer для этой позиции не рендерить;
  - legacy оставить только как compat fallback.
- Нужен proof, что двойного CTA в одной позиции больше нет.

4. Применить тему комнаты в реальном UI.
- Сейчас тема сохраняется в live_events.metadata.room_theme, но не применяется в LiveEvent.tsx.
- Нужно применить CSS variables / style props на room container:
  - background_color
  - primary_text_color
  - secondary_text_color
  - panel_color
  - accent_color
  - tabs_color
  - admin_badge_color
  - employee_badge_color

5. Обогатить external_link click metadata.
- В runtime event / audit / domain event добавить:
  - external_url
  - cta_type
  - product_id
  - tariff_id
  - offer_id

6. Зацементировать proof по product reuse.
- buy_now должен открывать каноничный PaymentDialog:
  - productId из products_v2.id
  - offerId из tariff_offers.id
  - price из tariff_offers.amount
  - без хардкода
- open_product / open_tariff должны использовать реальные existing routes.

7. Scenario/export proof сделать обязательным.
- Показать, что get_live_event_scenario реально возвращает:
  - cta_shown
  - cta_hidden
  - cta_replaced
  - cta_clicked
  - cta_form_submitted
- И что Excel export реально включает эти записи.

8. Wave 3 не закрывать до полного proof:
- SQL proof новых RLS
- runtime proof CTA
- proof отсутствия двойного рендера
- theme applied proof
- regression proof recorded_webinar / replay / notifications safety
```

Если нужно, следующим сообщением соберу уже **финальное полное ТЗ Wave 3 в формате backend / DB / frontend / proof / DoD** без воды.

&nbsp;

Wave 3 — Proof и обязательные исправления

## SQL Proof (подтверждено)

### Таблицы — существуют в БД

- ✅ `live_event_product_cta_bindings` — создана, FK на `products_v2(id)`, `tariffs(id)`, `tariff_offers(id)`
- ✅ `live_event_cta_runtime_events` — создана, FK на bindings, realtime включён
- ✅ `get_live_event_scenario` — обновлён, содержит UNION ALL с CTA events (cta_shown, cta_hidden, cta_replaced, cta_clicked, cta_form_submitted), metadata включает binding_id, product_id, tariff_id, offer_id, trigger_mode, cta_type

### RLS — ⚠️ НАРУШЕНИЕ МАТРИЦЫ ПРАВ

**Факт из БД:**

- `live_event_product_cta_bindings`: policy "Staff can manage CTA bindings" — FOR ALL — admin OR super_admin OR **employee**
- `live_event_cta_runtime_events`: policy "Staff can manage CTA runtime events" — FOR ALL — admin OR super_admin OR **employee**
- Read-only для пользователей с доступом к эфиру — корректно (через `user_has_live_event_access`)

**Факт из матрицы прав (`liveRoomRoles.ts`, строка 14):**

> Admin = staff + remove/restore from room, **show/hide sales blocks**

**Противоречие:** Employee сейчас может CRUD bindings и show/hide CTA через RLS. По матрице — **не должен**.

### Необходимое исправление (PATCH 10.1)

1. **RLS**: Разделить policies:
  - `live_event_product_cta_bindings`: CRUD — только admin/super_admin. SELECT — staff (employee) + users с доступом
  - `live_event_cta_runtime_events`: INSERT (shown/hidden/replaced) — только admin/super_admin. INSERT (clicked/form_submitted) — authenticated с доступом. SELECT — staff + users с доступом
2. **UI**: `LiveEventCtaRuntimePanel` — добавить guard `isAdminRole(role)`. Employee видит статус CTA (read-only), но не может show/hide
3. **UI**: `LiveEventProductCtaBindings` — добавить guard. Employee видит список bindings (read-only), но не может create/edit/delete

---

## Проверка Legacy CTA coexistence

**Факт из `LiveEvent.tsx` (строки 394-410):**

```
{/* Room blocks — under_video (legacy) */}
<LiveEventRoomBlocks ... position="under_video" />
{/* Product CTA — under_video */}
<LiveEventProductCta ... position="under_video" />
```

Аналогично для sidebar (строки 417-428).

**Проблема:** Оба рендерера активны одновременно для одной и той же позиции. Если в legacy `live_event_room_blocks` есть active block на позиции `under_video` и в new `live_event_product_cta_bindings` тоже есть binding на `under_video` — пользователь увидит **двойной CTA**.

### Необходимое исправление (PATCH 10.2)

В `LiveEvent.tsx`: если для данной позиции есть active product CTA bindings — не рендерить legacy `LiveEventRoomBlocks` для этой позиции. Product CTA имеет приоритет.

---

## Product reuse proof (код)

**PaymentDialog:** `LiveEventProductCta.tsx` строки 164-174 — корректно:

- Передаёт `productId: product.id`, `productName`, `price: String(offer.amount)`, `offerId: offer.id`
- Цена берётся из `tariff_offers.amount` (SoT), не хардкодится
- Используется каноничный `PaymentDialog` component

**Product/tariff navigation:** строки 177-195:

- `open_product` → `/product/${product.slug}` — использует slug из `products_v2`
- `open_tariff` → `/tariff/${tariff.public_id}` — использует public_id из `tariffs`
- Fallback на product page если нет public_id

**external_link:** строка 199 — URL берётся из `binding.metadata.external_url`, не из отдельного поля. ✅

**Замечание:** Нет audit log при external_link click. Клик записывается как general `clicked` event в runtime_events, но нет отдельной метки что это external. Минорно, но стоит добавить `url` в metadata клика.

---

## Scenario/Export proof (код + SQL)

- ✅ `get_live_event_scenario` в БД содержит CTA UNION ALL блок — подтверждено SQL proof выше
- ✅ `LiveEventScenario.tsx` содержит labels: cta_shown, cta_hidden, cta_replaced, cta_clicked, cta_form_submitted
- ✅ `LiveEventExportButtons.tsx` вызывает тот же RPC и включает CTA labels в Excel export
- ✅ metadata в scenario содержит binding_id, product_id, tariff_id, offer_id, trigger_mode, cta_type

---

## Theme proof (код)

- ✅ `LiveEventThemeEditor.tsx` сохраняет в `live_events.metadata.room_theme`
- ⚠️ **Проблема:** В `LiveEvent.tsx` нет кода применения theme CSS variables. Theme сохраняется, но **не применяется в room UI**.

### Необходимое исправление (PATCH 13.1)

В `LiveEvent.tsx`: загрузить `metadata.room_theme` из данных эфира и применить CSS variables на контейнере комнаты:

```typescript
const roomTheme = data?.metadata?.room_theme;
// Apply as style={{ '--room-bg': roomTheme?.background_color, ... }}
```

---

## Сводка обязательных исправлений


| #          | Что                                                        | Приоритет   |
| ---------- | ---------------------------------------------------------- | ----------- |
| PATCH 10.1 | RLS: CTA CRUD/show-hide → admin only, employee → read only | Критический |
| PATCH 10.2 | Legacy CTA: приоритет product CTA, не двойной рендер       | Высокий     |
| PATCH 13.1 | Theme: применить CSS variables в room UI                   | Высокий     |
| Minor      | external_link click: добавить url в metadata клика         | Низкий      |


## Regression safety

- `recorded_webinar` и `replay` — не затронуты (все изменения add-only)
- Notifications — не затронуты (ни один файл notification path не изменён)
- Existing comments/questions/replies/moderation — не затронуты (UNION ALL добавляет, не меняет существующие блоки)
- `live_event_room_blocks` — сохранён как legacy, не изменён

## Файлы для изменения

1. **SQL migration** — пересоздать RLS policies на обеих CTA таблицах (admin CRUD, staff read, user read with access)
2. `src/components/admin/live/LiveEventCtaRuntimePanel.tsx` — role guard (admin only для кнопок)
3. `src/components/admin/live/LiveEventProductCtaBindings.tsx` — role guard (admin only для create/edit/delete)
4. `src/pages/LiveEvent.tsx` — (a) legacy CTA priority logic, (b) theme CSS variables application
5. `src/components/live/LiveEventProductCta.tsx` — добавить url в metadata при external_link click