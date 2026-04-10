# Да, согласен, с учетом правок:

&nbsp;

1. **Не вводить новый display_scope для product CTA.**
  В плане сейчас смешаны display_mode и display_scope. Для новой product-linked модели оставить **одну** логику показа:
  &nbsp;
  - manual
  - after_minutes
  - at_datetime
  - always
    Не плодить вторую параллельную семантику.
  &nbsp;
2. **Не завязываться на выдуманные URL-роуты для покупки.**
  В рендерере CTA нельзя хардкодить переходы вида /pay/{product_id}?offer={offer_id}, если это не подтверждено текущим кодом.
  Нужно:
  &nbsp;
  - сначала найти и reuse **реальный** path/launcher checkout из проекта;
  - если в проекте каноничный путь — через PaymentDialog, то CTA buy_now должен открывать **именно его**;
  - переходы на продукт/тариф делать только через **существующие** маршруты и публичные идентификаторы, которые уже используются в проекте.
  &nbsp;
3. **lead_form / preorder не должны жить в webinar binding как новая форма.**
  Binding не хранит структуру формы.
  Он хранит только ссылку на уже существующую product-level конфигурацию:
  &nbsp;
  - product_id
  - tariff_id
  - offer_id
  - optional form_config_id / submission_target_id — только если такой SoT уже есть в платформе
    Если такого SoT нет — зафиксировать как deferred, а не придумывать новый mini form-builder внутри эфиров.
  &nbsp;
4. **Автопоказ CTA нельзя делать через useEffect interval в админском браузере.**
  Это ненадёжно. Показы зависят от открытой вкладки админа.
  Нужно сделать server-driven / data-driven механику:
  &nbsp;
  - либо room при загрузке сам вычисляет, какой CTA должен быть видим по времени и runtime events;
  - либо отдельный серверный scheduler/runtime path;
  - но не зависеть от того, открыт ли у админа браузер.
  &nbsp;
5. **RLS для live_event_cta_runtime_events нельзя оставлять “authenticated select for all”.**
  Нужен доступ только тем, у кого есть доступ к конкретному live_event_id, либо через RPC/resolver.
  Иначе любой authenticated user сможет читать CTA-события чужих эфиров.
6. **live_event_product_cta_bindings — это binding layer, а не новый каталог продаж.**
  Прямо зафиксировать в ТЗ:
  &nbsp;
  - products_v2 / tariffs / tariff_offers остаются SoT;
  - binding хранит только привязку эфира и presentation overrides;
  - никакой новой цены, новой бизнес-логики продажи, нового тарифа в webinar domain не появляется.
  &nbsp;
7. **Legacy live_event_room_blocks не оставлять как вторую активную архитектуру.**
  Нужно явно определить режим:
  &nbsp;
  - либо legacy read-only + compat adapter на переходный период;
  - либо миграция данных в новую binding-модель;
  - но нельзя, чтобы в room одновременно жили две равноправные системы CTA.
  &nbsp;
8. **Для binding добавить явный приоритет связи.**
  Зафиксировать правило:
  &nbsp;
  - product_id — обязателен всегда
  - tariff_id — optional
  - offer_id — optional, но если указан, имеет приоритет для checkout CTA
    И все три — только UUID FK.
  &nbsp;
9. **external_link оставить только как controlled exception.**
  Для него нужен отдельный guard:
  &nbsp;
  - external_url хранить только в metadata
  - использовать только если нет каноничного product/tariff action
  - логировать отдельно в audit/domain events
  &nbsp;
10. **Timeline enrichment должен включать не только show/hide, но и source binding reference.**
  В projection по CTA-событиям обязательно выводить:
  &nbsp;
  - binding_id
  - product_id
  - tariff_id
  - offer_id
  - trigger_mode
  - shown_by
    Иначе сценарий будет плохо пригоден для повторного использования и аналитики.
  &nbsp;
11. **Theme settings — только в live_[events.metadata.room](http://events.metadata.room)_theme, без новой theme table.**
  Это правильный путь. Зафиксировать как обязательное решение текущей волны, без разрастания схемы.
12. **Admin UI: не делать отдельную вкладку “Продающие блоки” как новый коммерческий каталог в рамках этой реализации.**
  В этой волне достаточно:
  &nbsp;
  - в карточке эфира вкладка CTA
  - там выбор существующего продукта/тарифа/оффера
  - настройка показа
  - preview
    Если позже понадобится отдельный reusable preset layer, это отдельный follow-up после proof.
  &nbsp;
13. **В DoD добавить обязательный proof product reuse.**
  Подрядчик должен показать:
  &nbsp;
  - CTA привязан к реальному product_id
  - CTA использует существующий tariff/offer
  - checkout/open product/form идут через уже существующий flow
  - новая параллельная sales-логика не создана
  &nbsp;
14. **В discovery обязателен отдельный вывод по PaymentDialog и site-form-submit.**
  Нужен фактический ответ:
  &nbsp;
  - можно ли безопасно открывать PaymentDialog прямо из webinar room;
  - как именно правильно вызвать site-form-submit из CTA без нового form subsystem;
  - какие параметры являются каноничными.
  &nbsp;
15. **Порядок исполнения скорректировать так:**
  &nbsp;
  - discovery product-domain reuse
  - schema/binding layer
  - renderer CTA
  - runtime show/hide logic
  - theme
  - scenario enrichment
  - admin decomposition
  - regression + notifications safety proof
  &nbsp;

&nbsp;

&nbsp;

Если хочешь, я сейчас соберу это уже в **чистый финальный блок для вставки в [Lovable.dev](http://Lovable.dev)**, без комментариев и пояснений.

&nbsp;

План: Wave 3 — Product-linked Webinar CTA + Theme + Timeline

## Discovery (завершён)

### Что найдено

**Product domain SoT:**

- `products_v2` — основной каталог продуктов (id, name, slug, category, is_active)
- `tariffs` — тарифы, FK на product
- `tariff_offers` — офферы (pay_now, trial, installment), FK на tariff. Содержит amount, button_label, offer_type, is_active
- `PaymentDialog` — канонический checkout component (1230 строк). Принимает productId, productName, price, offerId

**Existing CTA/form paths:**

- `PaymentDialog` — buy_now / trial / subscription
- `site-form-submit` edge function — lead form / preorder (принимает product_id, tariff_id, fields)
- `FormSection.tsx` — renderer формы, вызывает `site-form-submit`
- Страницы: `/pay/:id`, `/tariff/:publicId`, `/product/:slug` — existing routes

**Existing room blocks:**

- `live_event_room_blocks` — 1 запись в БД (banner). Схема: id, live_event_id, block_type, position, config (jsonb), display_scope, sort_order
- `LiveEventRoomBlocks.tsx` — renderer (button/banner)
- `LiveEventRoomBlocksEditor.tsx` — admin editor

**live_events:**

- Уже имеет `product_id` (nullable), `metadata` (jsonb)
- `metadata.room_theme` — зарезервировано по архитектуре

**Scenario RPC `get_live_event_scenario`:**

- UNION ALL: comments + questions + replies + moderation
- Расширяется добавлением нового UNION ALL блока

### Архитектурное решение

**Legacy `live_event_room_blocks`:** оставить как есть (1 запись, legacy). Новый product-linked CTA идёт через новую таблицу `live_event_product_cta_bindings`. Старый renderer `LiveEventRoomBlocks` сохраняется для обратной совместимости.

**Отдельный каталог CTA не нужен.** Достаточно bindings (product_id + overrides). Продукт/тариф/оффер — уже каталог.

---

## Порядок выполнения

### PATCH 10 — DB: CTA bindings + runtime events

**Migration 1:** Создать `live_event_product_cta_bindings`:

- id, public_id, live_event_id (FK), product_id (FK products_v2), tariff_id (FK nullable), offer_id (FK nullable)
- cta_type (CHECK: buy_now, open_product, open_tariff, lead_form, preorder, external_link)
- display_mode (CHECK: manual, after_minutes, at_datetime, always)
- position (CHECK: under_video, sidebar, sticky)
- show_after_minutes, show_at, title_override, description_override, button_text_override, image_override, theme_override (jsonb)
- is_active, sort_order, created_by, updated_by, created_at, updated_at, metadata
- RLS: admin CRUD, authenticated read

**Migration 2:** Создать `live_event_cta_runtime_events`:

- id, live_event_id (FK), binding_id (FK), event_type (CHECK: shown, hidden, replaced, clicked, form_submitted), trigger_mode (CHECK: manual, scheduled, automatic), shown_by (nullable), created_at, metadata
- RLS: admin insert/select, authenticated select (для room query)

**Migration 3:** Расширить `get_live_event_scenario` — добавить UNION ALL блок для CTA runtime events (entry_type: cta_shown, cta_hidden, etc.)

### PATCH 11 — Room CTA renderer

Создать `src/components/live/LiveEventProductCta.tsx`:

- Принимает liveEventId, position, displayContext
- Запрашивает active bindings по live_event_id + position + is_active
- Фильтрует по display_scope / runtime state (какой CTA сейчас shown)
- Рендерит карточку CTA: image, title (override или product.name), description, кнопка
- Кнопка действия по cta_type:
  - `buy_now` → открыть PaymentDialog или navigate to `/pay/{product_id}?offer={offer_id}`
  - `open_product` → navigate to product page
  - `open_tariff` → navigate to tariff page
  - `lead_form` → invoke `site-form-submit` (reuse FormSection logic)
  - `external_link` → window.open

Интегрировать в `LiveEvent.tsx` рядом с legacy `LiveEventRoomBlocks`.

### PATCH 12 — Manual/scheduled show controls

Создать `src/components/admin/live/LiveEventCtaRuntimePanel.tsx`:

- Показывает список bindings для текущего эфира
- Кнопки: Show / Hide / Replace
- При клике — insert в `live_event_cta_runtime_events` + domain_event + audit_log
- Scheduled: фоновая проверка `show_after_minutes` / `show_at` через useEffect interval

В room: query runtime events чтобы определить текущий visible CTA (last shown/hidden event wins).

Realtime: использовать existing supabase realtime channel на `live_event_cta_runtime_events`.

### PATCH 13 — Room theme

В карточке эфира добавить секцию "Тема комнаты":

- Создать `src/components/admin/live/LiveEventThemeEditor.tsx`
- Поля: background_color, primary_text_color, secondary_text_color, panel_color, accent_color, admin_badge_color, employee_badge_color
- Сохранять в `live_events.metadata.room_theme` (update metadata jsonb)
- В `LiveEvent.tsx`: читать metadata.room_theme, применять через CSS variables на контейнере

**Нет новых таблиц.** Только metadata.

### PATCH 14 — Timeline enrichment

Расширить RPC `get_live_event_scenario` новым UNION ALL:

```sql
SELECT r.id, r.event_type::text, r.shown_by, NULL, r.event_type || ': ' || COALESCE(b.title_override, ''), NULL, r.created_at, r.metadata
FROM live_event_cta_runtime_events r
LEFT JOIN live_event_product_cta_bindings b ON b.id = r.binding_id
WHERE r.live_event_id = _live_event_id
```

Обновить `LiveEventScenario.tsx` — добавить entry_type labels для cta_shown, cta_hidden и т.д.

Обновить `LiveEventExportButtons.tsx` — CTA events попадают в Excel export.

### PATCH 15 — Admin UI decomposition

Создать отдельные компоненты (вынести из AdminLiveEvents.tsx):

- `LiveEventProductCtaBindings.tsx` — CRUD bindings в карточке эфира
- `LiveEventCtaRuntimePanel.tsx` — manual show/hide during live
- `LiveEventThemeEditor.tsx` — theme settings

В AdminLiveEvents.tsx добавить 2 новые вкладки:

- "CTA" → LiveEventProductCtaBindings + LiveEventCtaRuntimePanel
- "Тема" → LiveEventThemeEditor

### Domain events & Audit

Новые события: `live_product_cta_shown`, `live_product_cta_hidden`, `live_product_cta_replaced`, `live_product_cta_clicked`, `live_product_cta_form_submitted`.

Audit logs: actor_type=user, actor_user_id из JWT, action=cta_shown/hidden/replaced.

---

## Файлы

**Новые:**

- `src/components/live/LiveEventProductCta.tsx`
- `src/components/admin/live/LiveEventProductCtaBindings.tsx`
- `src/components/admin/live/LiveEventCtaRuntimePanel.tsx`
- `src/components/admin/live/LiveEventThemeEditor.tsx`
- 3 SQL migrations

**Изменяемые:**

- `src/pages/LiveEvent.tsx` — добавить ProductCta renderer + theme CSS vars
- `src/pages/admin/AdminLiveEvents.tsx` — добавить вкладки CTA/Тема
- `src/components/live/LiveEventScenario.tsx` — новые entry_type labels
- `src/components/live/LiveEventExportButtons.tsx` — CTA в export

**Не трогаем:**

- `live_event_room_blocks` / `LiveEventRoomBlocks.tsx` — legacy, сохраняется
- PaymentDialog — только вызываем
- site-form-submit — только вызываем
- Notifications / job #42 / kill-switch

---

## Что не делаем

- Отдельный каталог "продающих блоков" — не нужен, products_v2 уже каталог
- Новый form subsystem
- Новый checkout
- Дублирование цен / тарифов
- Rich editor / timer presets / analytics → deferred