

# Отчёт о выполнении: Скорректированная итоговая документация

## Статус и scope

**Завершено:** Интеграция форм конструктора сайтов с CRM и сделками — форма → заявка → профиль → сделка (при успешном CRM resolve и валидной product-привязке).

**Не завершено:** Публичный рендер блока `pricing` на сайтах — `pricingData` не передаётся в `SitePageRenderer` из `DomainRouter`, `SitePageBySlug`, `SitePreview`. Это отдельный незавершённый поток, не backlog.

---

## Что реализовано

Сквозной поток: отправка формы на сайте → создание заявки → CRM resolve профиля → создание или переиспользование сделки в `orders_v2`. **Сделка создаётся не всегда**, а только при одновременном выполнении условий:
- в форме задан `product_id`
- продукт и тариф (если указан) прошли серверную валидацию (`is_active = true`)
- CRM resolve вернул ровно один профиль (matched или created ghost)

При ambiguous match, отсутствии идентификаторов клиента или невалидном продукте — submission создаётся, сделка не создаётся, причина фиксируется в `domain_executions` и `audit_logs`.

---

## Таблицы и их роли

| Таблица | Роль | Изменения в этом scope |
|---|---|---|
| `products_v2` | Каноническая таблица продуктов (SoT) | Без изменений |
| `tariffs` | Тарифы продукта | Без изменений |
| `tariff_offers` | Коммерческие предложения (цена) | Без изменений |
| `tariff_features` | Фичи тарифа для отображения | Без изменений |
| `orders_v2` | Каноническая таблица заказов/сделок | Без изменений |
| `profiles` | CRM-профили клиентов | Без изменений |
| `site_pages` | Страницы конструктора (blocks JSON) | Без изменений |
| `site_domain_bindings` | Привязка доменов к страницам | Не затрагивалась в этом scope (доработка `is_home` для многостраничного домена — отдельный поток) |
| `site_form_submissions` | Заявки с форм сайта | **+1 колонка: `order_id UUID REFERENCES orders_v2(id)`** |
| `domain_events` / `domain_executions` / `audit_logs` | Каноническая event-инфраструктура | Без изменений (reuse) |

---

## Изменённые файлы

| Файл | Что сделано |
|---|---|
| SQL миграция | `ALTER TABLE site_form_submissions ADD COLUMN order_id UUID REFERENCES orders_v2(id)` |
| `FormBlockEditor.tsx` | Секция «Привязка к продукту» — Select продукта из `products_v2`, Select тарифа из `tariffs`, кнопка сброса |
| `FormSection.tsx` | Извлечение `product_id`/`tariff_id` из content, передача в payload |
| `site-form-submit/index.ts` | Валидация product/tariff → submission INSERT → CRM resolve → order create/reuse → audit |

---

## STOP-guards (верифицировано по коду)

| Условие | Результат | Верификация |
|---|---|---|
| `product_id` не найден / `is_active=false` | HTTP 400, submission НЕ создаётся | Строки 103-114: валидация **до** INSERT submission (строка 152) |
| `tariff_id` не принадлежит `product_id` | HTTP 400, submission НЕ создаётся | Строки 117-129: валидация **до** INSERT |
| `generate_order_number` fail | Order НЕ создаётся, execution=failed | Строки 490-508 |
| Ambiguous profile (>1 match) | Order НЕ создаётся, audit записан | Строки 269-291 |
| Нет идентификаторов клиента | Profile=skipped, order=skipped | Строки 204-205 |
| INSERT order failed | Execution=failed, submission сохранена | Строки 562-576 |

---

## Anti-duplication proof (завершённый поток: формы + CRM + сделки)

| Проверка | Результат |
|---|---|
| Таблица продуктов | Канонические `products_v2` — 0 новых таблиц |
| Таблица тарифов | Канонические `tariffs` — 0 новых |
| Цены | Канонические `tariff_offers` — 0 новых |
| Заказы | Канонические `orders_v2` — 0 новых |
| Номер заказа | Каноническая RPC `generate_order_number` без fallback — 0 новых RPC |
| CRM-профили | Канонические `profiles` — 0 новых |
| Event-инфраструктура | `domain_events` / `domain_executions` / `audit_logs` — 0 новых |
| Edge functions | Расширена существующая `site-form-submit` — 0 новых EF |

**Примечание по UI-компонентам тарифов:** `UniversalPricingSection`, `TariffCard` архитектурно переиспользуются конструктором (через `PricingSection`), но публичный поток данных для них не доведён до рабочего состояния — см. раздел «Незавершённый поток».

---

## Незавершённый поток: публичный рендер pricing block

**Суть разрыва:** `SitePageRenderer` принимает параметр `pricingData`, но в точках публичного рендера он не передаётся:

| Файл | pricingData | Статус |
|---|---|---|
| `DomainRouter.tsx` (строка 85-89) | Не передан | ❌ Не работает |
| `SitePageBySlug.tsx` (строка 42-46) | Не передан | ❌ Не работает |
| `SitePreview.tsx` (строка 13) | Не передан | ❌ Не работает |

**Результат:** Блок `pricing` в конструкторе сайтов возвращает `null` на публичных страницах.

**Требуется:** Hook `useSitePricingData(blocks)` — сканирует блоки на `product_id`, загружает данные через EF `public-product`, передаёт `PricingDataMap` в рендерер.

Это **отдельная задача**, не minor backlog.

---

## Deferred backlog

1. Индекс на `site_form_submissions.order_id` — при частых lookups
2. Фильтр `reconcile_source='site_form'` в AdminDeals/AdminOrdersV2
3. UI связи submission → order в админке заявок
4. `flow_id` auto-resolve после оплаты
5. Аналитика конверсии по site_form submissions
6. Доработка `is_home` для многостраничного домена (отдельный поток)

---

## Полная архитектурная схема

**Завершённый поток (формы → CRM → сделки):**
```text
Admin ЛК → products_v2 → tariffs → tariff_offers
                │              │
                ▼              ▼
FormBlockEditor: content.product_id, content.tariff_id
                │
                ▼
FormSection → payload → site-form-submit EF
                │
     ┌──────────┼──────────────────┐
     ▼          ▼                  ▼
  Валидация   Submission        CRM resolve
  product/    INSERT            email→phone→tg
  tariff                           │
  (до INSERT)               ┌─────┼─────┐
                             ▼     ▼     ▼
                          matched ghost ambiguous
                             │     │     │
                             ▼     ▼     ▼
                          profileId    order skip
                             │
                             ▼
                    Dedup (NULL-safe tariff_id)
                      │              │
                   reuse           create
                      │              │
                      ▼              ▼
              submission.order_id = orders_v2.id
              audit_logs + domain_executions
```

**Незавершённый поток (pricing block на публике):**
```text
site_pages.blocks[type=pricing].content.product_id
    │
    ▼
SitePageRenderer.pricingData[productId] → ❌ undefined
    │
    ▼
PricingSection → product=undefined → return null
```

