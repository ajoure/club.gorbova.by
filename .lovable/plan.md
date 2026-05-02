&nbsp;

Да, согласен, с учетом правок:

1. Перед backfill сделать **read-only dry-run**:
  - сколько orders_v2 будет обновлено по каждому продукту;
  - сколько офферов получит meta.crm_routing;
  - список продуктов, которые останутся вне mapping.
2. Backfill orders_v2 делать только при доказуемом mapping:
  - product_id → pipeline_id;
  - status='paid' → closed_won / Успешно;
  - status IN ('pending','new') → первая open stage;
  - failed/canceled/refunded → closed_lost / Отказ.
3. Не трогать сделки, где pipeline_id уже заполнен, если только нет отдельного dry-run с доказательством неправильной воронки.
4. В audit_logs обязательно:
  - actor_type='system';
  - actor_user_id=NULL;
  - actor_label='crm-routing-backfill';
  - rowcount по orders_v2 и tariff_offers.
5. Для tariff_offers.meta.crm_routing добавить не только pipeline_id, но и pipeline_code/name в meta для диагностики, если это уже принято в проекте.
6. Landing-продукты без mapping не оставлять молча: в отчёте отдельный блок **“Unmapped products / требует решения”**.
7. После миграции обязательно проверить:
  - orders_v2.pipeline_id IS NULL;
  - orders_v2.pipeline_stage_id IS NULL;
  - офферы без meta.crm_routing;
  - канбан по каждой воронке, не только Gorbova Club.
8. Новый payment-flow проверить не тестовым заказом в проде, а безопасным dry-run/тестовой оплатой только если есть тестовый режим. Если тестового режима нет — проверить по следующему реальному заказу через audit/log proof.

Можно выполнять после dry-run-таблицы с rowcount.

## Отчёт о диагностике

**Корень проблемы (ID-First, не эвристика):**

1. **На офферах не заполнен `meta.crm_routing`.** Из 26 активных pay_now/trial офферов **18 без routing** (в т.ч. Club BUSINESS, Club FULL, БкБ, ЦБ 1 ступень и все её модули, Подоходный с ФЛ, ЗАКРОЙ ГОД-trial и др.).
2. Edge-функция `_shared/crm-routing.ts → resolveOfferRoutingWithFallback` в этом случае возвращает `routing_disabled_or_missing` или `no_offer_for_tariff`, заказ создаётся с `pipeline_id = NULL`, в `meta.crm_routing_snapshot` пишется negative-snapshot.
3. UI-правило "Default Pipeline Scope" показывает все сделки с `pipeline_id = NULL` в дефолтной воронке «Основная» — отсюда визуальная картинка на скриншоте.

**Текущее состояние данных (NULL pipeline_id):**


| Продукт                 | NULL-сделок |
| ----------------------- | ----------- |
| Gorbova Club            | 1085        |
| Бухгалтерия как бизнес  | 37          |
| ЦБ 1 ступень + модули   | ~30         |
| Подоходный ИП           | 8           |
| Подоходный ФЛ           | 3           |
| ЗАКРОЙ ГОД              | 4           |
| **Итого ≈ 1170 сделок** | &nbsp;      |


Стадии во всех воронках унифицированы: `Новая/Регистрация` (open) → `В работе` (open) → `Успешно` (closed_won) → `Отказ` (closed_lost).

---

## План исправления

### Шаг 1. Backfill существующих сделок (миграция)

Одна SQL-миграция, которая обновляет `orders_v2 SET pipeline_id, pipeline_stage_id` для всех записей с `pipeline_id IS NULL` через mapping `product_id → pipeline_id`.

Mapping (детерминирован, взят из доминирующих явных привязок):

```text
Gorbova Club                       → Gorbova Club
Бухгалтерия как бизнес             → Бухгалтерия как бизнес
Ценный бухгалтер | 1 ступень 2.0   → ЦБ | 1 ступень |  (включая все 8 модулей)
Ценный бухгалтер | 2 ступень       → ЦБ | 2 ступень |
ЗАКРОЙ ГОД                         → Закрой год
Подоходный налог с физлиц          → Подоходный налог с ФЛ
Подоходный налог ИП                → Подоходный налог ИП
Платная консультация               → Платная консультация
Тестовый продукт для админов       → Тестовый продукт для админов
```

Правила расстановки стадий:

- `payment_status = 'paid'` → `closed_won` (Успешно)
- `payment_status IN ('failed','cancelled','refunded')` → `closed_lost` (Отказ)
- остальные (`pending`, `processing`, NULL) → `order_index = 0` стадия (Новая/Регистрация)

Гарантии:

- **Не трогаем** сделки, у которых `pipeline_id IS NOT NULL` (ручные перемещения сохраняются).
- Продукты не из mapping (БЕЗОПАСНОСТЬ, Налоговый кодекс-2026, ФСЗН — маркетинговые landing-офферы без своей воронки) **не мигрируем** — они корректно остаются в «Без воронки» / «Основной».
- Аудит-запись `crm_pipeline_backfill_2026_05` с количеством, breakdown по продуктам и timestamp.

### Шаг 2. Авто-заполнение `crm_routing` на офферах (insert-операция)

UPDATE `tariff_offers SET meta = jsonb_set(...)` для 18 активных pay_now/trial-офферов без routing. Каждому офферу прописываем:

```json
{
  "enabled": true,
  "pipeline_id": "<воронка продукта>",
  "stage_on_pending": "<стадия order_index=0>",
  "stage_on_success": "<closed_won>",
  "stage_on_failed":  "<closed_lost>"
}
```

Только для офферов, чей продукт есть в mapping. Для landing-офферов (БЕЗОПАСНОСТЬ, ФСЗН, Налоговый кодекс) `crm_routing` не проставляем — нужна осознанная привязка к новой воронке.

После этого все новые оплаты будут идти строго по `crm-routing.ts` → snapshot positive → правильная воронка/стадия.

### Шаг 3. Verify (read-only)

После применения:

1. `SELECT COUNT(*) FROM orders_v2 WHERE pipeline_id IS NULL GROUP BY product_id` — должны остаться только продукты вне mapping.
2. `SELECT COUNT(*) FROM tariff_offers WHERE is_active AND offer_type IN ('pay_now','trial') AND (meta->'crm_routing'->>'enabled') IS NULL` — должны остаться только landing-офферы.
3. Скриншот канбана `/admin/deals` (вид «Воронка», «Gorbova Club») — колонки «Регистрация / Успешно» вместо «Без стадии».

### Шаг 4. Memory-rule (новая запись)

Добавить в `mem://commercial-logic/crm/product-pipeline-mapping-canon` правило: «Каждому продукту с активной воронкой ОБЯЗАТЕЛЬНО проставлять `meta.crm_routing` на всех его pay_now/trial-офферах. Отсутствие routing → визуальный дефолт в "Основную" (антипаттерн)». Index обновим.

---

## Что НЕ входит в этот патч

- UI-валидатор «оффер без routing» в админке Продуктов — отдельная follow-up задача.
- Landing-продукты без своей воронки (БЕЗОПАСНОСТЬ, ФСЗН и др.) — нужно отдельное решение от тебя: создавать им воронки или оставлять в «Основной».
- Триггер «при создании оффера автоматически заполнять routing воронкой продукта» — обсудим позже, чтобы не сломать кастомные сценарии.

---

## DoD

- Миграция backfill применена, аудит записан.
- 18 офферов получили `meta.crm_routing`.
- `pipeline_id IS NULL` остаётся только для landing-продуктов вне mapping.
- Канбан «Gorbova Club» показывает 2258 сделок (1173 + 1085) распределённых по стадиям.
- Новый payment-flow проверен на одном тестовом заказе → snapshot `enabled:true`.
- Memory-правило добавлено.