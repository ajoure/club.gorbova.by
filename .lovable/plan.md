

# План: Обновление документации Live Events v2 после Wave 1–3

## Что есть сейчас

Два документа уже существуют и зарегистрированы в `systemDocsRegistry.ts`:
- `docs/live-events-v2-architecture.md` — техдок, версия 2026-04-08, **не содержит** Wave 3 (product CTA, theme, CTA runtime events, приоритет new/legacy CTA)
- `docs/live-events-v2-testing-guide.md` — инструкция для сотрудника, версия 2026-04-08, **не содержит** тестов CTA, темы, inline moderation, Excel export, scenario CTA events, role badges, desktop/mobile layout

Домены `live_events` и `live_events_testing` уже есть в registry — новые создавать не нужно.

## Что нужно сделать

### 1. Обновить `docs/live-events-v2-architecture.md`

Версия → 2026-04-10, статус → Wave 1–3 completed.

**Добавить/обновить разделы:**

- **§1 Таблицы** — добавить:
  - `live_event_product_cta_bindings` (полная схема: product_id FK, tariff_id, offer_id, cta_type, display_mode, position, overrides, theme_override, metadata)
  - `live_event_cta_runtime_events` (схема: binding_id, event_type, trigger_mode, shown_by, metadata; realtime enabled)

- **§2 Edge Functions** — без изменений (CTA не добавляет новых edge functions)

- **§2a Триггеры** — без изменений

- **§3 Access Logic → Scenario RPC** — обновить описание `get_live_event_scenario`: теперь включает CTA events (cta_shown, cta_hidden, cta_replaced, cta_clicked, cta_form_submitted) с metadata (binding_id, product_id, tariff_id, offer_id, trigger_mode, cta_type)

- **Новый §3a: Product-linked CTA Architecture** — описать:
  - Архитектурный принцип: binding layer, не каталог
  - products_v2 / tariffs / tariff_offers = SoT
  - binding хранит только presentation overrides
  - cta_type enum, display_mode enum, position enum
  - Правило приоритета: product CTA > legacy room blocks (useHasActiveCtaBindings)
  - Runtime events: shown/hidden/replaced/clicked/form_submitted
  - buy_now → каноничный PaymentDialog
  - open_product → /product/:slug
  - open_tariff → /tariff/:publicId
  - external_link → controlled exception, URL из metadata
  - RLS: admin/super_admin = CRUD bindings + show/hide; employee = read-only; user = read active with access
  - Domain events: live_product_cta_shown/hidden/replaced/clicked/form_submitted

- **Новый §3b: Room Theme** — описать:
  - Хранение в live_events.metadata.room_theme
  - Поля: background_color, primary_text_color, secondary_text_color, panel_color, accent_color, tabs_color, admin_badge_color, employee_badge_color
  - Применение через CSS variables + inline styles
  - Deferred: полная пропагация во вложенные компоненты

- **§7 UI Structure** — обновить:
  - Вкладки карточки эфира: добавить **CTA** и **Тема**
  - `/live/:slug`: добавить role badges (admin/employee), inline moderation, product CTA renderer, reply tree
  - Desktop layout: video flex-[2.5], chat calc(100vh-120px)
  - Mobile: sticky input, sticky tabs
  - Excel export: комментарии, вопросы, сценарий (включая CTA events)

- **§9 Known Limitations** — добавить:
  - Полная пропагация room_theme CSS variables во вложенные компоненты (deferred)
  - Legacy `live_event_room_blocks` сохранён как compat fallback

- **§10 Что нельзя ломать** — добавить product CTA priority rule

- **§11** — обновить: Wave 1–3 завершены, notification guardrails и job #42 не затрагивались

### 2. Обновить `docs/live-events-v2-testing-guide.md`

Версия → 2026-04-10.

**Добавить новые шаги:**

- **Шаг 6a: Desktop/mobile layout** — чеклист по layout
- **Шаг 7 (обновить)**: добавить проверку имён и role badges (admin/employee бейджи)
- **Шаг 7a (обновить)**: inline reply из комнаты (не только из админки)
- **Шаг 7b (обновить)**: inline moderation — delete message, mute, remove, restore прямо из комнаты; открытие карточки пользователя
- **Шаг 7c (обновить → переименовать)**: Legacy room blocks — пометить как legacy
- **Новый Шаг 7g: Product CTA** — чеклист:
  - CTA привязан к реальному продукту/тарифу/офферу
  - show/hide вручную (admin only)
  - employee не видит кнопки управления CTA
  - нет двойного CTA (legacy подавлен)
  - buy_now открывает checkout
  - CTA events в сценарии
  - CTA events в Excel export
- **Новый Шаг 7h: Тема комнаты** — чеклист:
  - Задать тему в админке
  - Проверить фон, текст, панели
  - Если тема не применяется ко всем элементам — зафиксировать как deferred баг
- **Шаг 7d (обновить)**: сценарий теперь включает CTA events
- **Новый Шаг 7i: Excel export** — чеклист: комментарии, вопросы, сценарий (включая CTA)
- **Новый Шаг 7j: Webinar activity в профиле** — проверить CRM карточку
- Обновить **шаблон отчёта** — добавить пункты CTA, тема, inline moderation, export, layout

### 3. Файлы и scope

**Изменяемые файлы:**
- `docs/live-events-v2-architecture.md`
- `docs/live-events-v2-testing-guide.md`

**Не трогаем:**
- Код (ни один .ts/.tsx файл)
- SQL / миграции
- `systemDocsRegistry.ts` (домены уже зарегистрированы)
- Логику эфиров, CRM, notifications

