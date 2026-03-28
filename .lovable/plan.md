# да, согласен, с учетом правок:

&nbsp;

1. В список deploy добавь **все entrypoint functions, которые используют _shared/create-payment-checkout.ts**, а не только те, где ты правил insert напрямую.
  Минимум перепроверь и включи:
  &nbsp;
  - bepaid-create-token
  - public-checkout
  - все остальные entrypoints, которые импортируют _shared/create-payment-checkout
    Иначе shared snapshot builder может остаться недеплоенным в каноничном checkout path.
  &nbsp;
2. В proof после deploy нужен не просто “есть snapshot”, а **proof нового формата snapshot**.
  Обязательно показать хотя бы 1 свежий order, где в purchase_snapshot есть именно новые поля:
  &nbsp;
  - product_id
  - product_public_id
  - tariff_id
  - tariff_public_id
  - offer_id
  - price
  - currency
  - planned_access_start_at
  - planned_access_end_at
  - snapshot_created_at
    Иначе можно случайно принять старый ad-hoc snapshot за новый контракт.
  &nbsp;
3. Smoke-test лучше разбить на **2 обязательных сценария**, а не один:
  &nbsp;
  - каноничный checkout path
  - non-checkout path (admin-manual-charge или direct-charge)
    Потому что сейчас главный риск именно в том, что каноничный _shared/create-payment-checkout не задеплоен.
  &nbsp;
4. В proof-пакет добавь отдельную проверку:
  &nbsp;
  - **legacy order без snapshot**
  - **legacy order со старым ad-hoc snapshot**
  - **новый order с полным snapshot contract**
    Чтобы было видно три состояния данных и было понятно, что backward compat реально нужен.
  &nbsp;

&nbsp;

&nbsp;

В остальном план правильный:

&nbsp;

- причина найдена точно,
- проблема не в коде, а в deploy,
- proof через свежие orders из БД обязателен.

&nbsp;

&nbsp;

План: Deploy edge functions для PATCH 0.5 + proof

## Диагностика

**Факт**: код `buildPurchaseSnapshot` добавлен во все 12 файлов (8 edge functions + shared). Но **ни одна edge function не была переразвёрнута** после изменений.

**Доказательство**:

- 1799 orders всего, 82 имеют snapshot
- Все 82 snapshot — **старый ad-hoc формат** (только 4 поля: `access_days, product_name, tariff_code, tariff_name`)
- Все orders после коммита (28 марта) — `purchase_snapshot = NULL`
- Новый формат с `product_id, tariff_id, offer_id, currency, planned_access_*` — **ни разу не записан**

## Что нужно сделать

### Шаг 1: Deploy всех затронутых edge functions

Переразвернуть 10 edge functions:

1. `bepaid-webhook`
2. `bepaid-auto-process`
3. `bepaid-archive-import`
4. `bepaid-create-subscription-checkout`
5. `bepaid-report-import`
6. `direct-charge`
7. `admin-manual-charge`
8. `subscription-charge`
9. `getcourse-import-deals`
10. `getcourse-import-file`

### Шаг 2: Smoke-test через invoke

После deploy — вызвать хотя бы один checkout flow (e.g. `admin-manual-charge` или `direct-charge` с тестовыми данными) и проверить, что `purchase_snapshot` записался в новом формате.

### Шаг 3: Proof-пакет из БД

Запросить свежие orders и показать:

- JSON snapshot целиком с новыми полями (`product_id`, `product_public_id`, `tariff_id`, `offer_id`, `price`, `currency`, `access_days`, `planned_access_start_at`, `reconcile_source`, `snapshot_created_at`)
- Сравнение с legacy snapshot (4 поля) для backward compat
- Order без snapshot для legacy fallback

### Риск

- Deploy 10 functions — последовательно, с проверкой логов после каждой
- Shared module `_shared/build-purchase-snapshot.ts` — деплоится вместе с каждой function автоматически