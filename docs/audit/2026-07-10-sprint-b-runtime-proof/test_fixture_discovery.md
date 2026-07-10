# Test fixture discovery — RR installment initiate

Дата: 2026-07-10
Gate: A (только discovery; создание fixture — отдельным согласованным шагом)

## 1. Обязательные поля таблиц

### `products_v2`

- `id uuid NOT NULL DEFAULT gen_random_uuid()`
- `name text NOT NULL`
- `is_active boolean NOT NULL`
- `status text NOT NULL`
- `currency text NOT NULL DEFAULT 'BYN'`
- прочее — nullable
- **`workspace_id` — колонки НЕТ.** Fixture-guard по workspace здесь неприменим.
- `slug text UNIQUE` (soft), `public_id text` — можно использовать стабильный маркер `rr_test_fixture_2026_07`.

### `tariffs`

- `product_id uuid NOT NULL`
- `code text NOT NULL`
- `name text NOT NULL`
- `access_days int NOT NULL`
- `trial_enabled boolean NOT NULL`
- `is_active boolean NOT NULL`

### `tariff_offers`

- `tariff_id uuid NOT NULL`
- `offer_type text NOT NULL`
- `button_label text NOT NULL`
- `amount numeric NOT NULL`
- **`workspace_id` — колонки НЕТ.**

### `orders_v2` (для cleanup)

- FK/reference на оффер: **колонка `offer_id`**, НЕ `tariff_offer_id`.

## 2. Ограничения РР

**Минимальная сумма РР не подтверждена документацией.** Значение 1 BYN — предположение. Требуется:

- (а) подтверждение в интеграционных мануалах РР или у пользователя;
- (б) либо использовать заведомо допустимое значение (например, 100 BYN).

Без такого подтверждения fixture с amount=1 может дать `createOrder failure`, что сорвёт happy-path тесты.

## 3. Существующие механизмы «test/hidden»

Проверено:

- `products_v2.status` — нет enum-значения `test`; значения `draft|active|archived` (по данным `landing_config`).
- `tariff_offers.visible_from/visible_to` — годятся для «скрытия» оффера, если оставить `visible_from` в будущем.
- Отдельного `is_test`/`is_fixture` флага нет.

## 4. Рекомендация по среде

Приоритет из ревью:

1. **Отдельная preview/test БД** — предпочтительно. Позволяет не мутировать production-объекты и не хранить fixture в основной БД.
2. **Только при невозможности (1)** — скрытый fixture в production DB с:
   - `products_v2.status='draft'` (не попадает в публичные каталоги, если фильтруются по status),
   - `tariffs.is_active=false` для listing-логики, `tariff_offers.is_active=true` для инициализации через `tariff_offer_id`,
   - маркеры в `meta`:
     ```json
     { "test_fixture": true, "test_fixture_run": "2026-07-rr-sprint-b" }
     ```
   - server-side guard в public flow: edge-функция должна отклонять fixture-запросы с внешних IP (доступ только через service-role / тестовые IP whitelist), либо fixture должен быть недоступен через site_pages / catalog.
3. **`meta.rr.force_fail=true` в публичном flow ЗАПРЕЩЁН** — согласовано.

## 5. Что должно быть предъявлено на согласование ДО миграции fixture

- (а) выбранная опция среды (preview или скрытый fixture);
- (б) подтверждённая минимально допустимая сумма РР для test mode;
- (в) стабильный SoT id (`public_id`) для идемпотентной миграции;
- (г) явный test-only guard в edge-функции ИЛИ доказательство, что fixture не попадает ни в один публичный listing.

Пока эти пункты не согласованы, миграция fixture не выполняется.

## 6. Cleanup contract

Скрипт `cleanup_test_fixture.sql` — только dry-run по умолчанию. Требования:

- параметризация по `test_fixture_run` marker + exact `offer_id` UUID;
- удаление child-строк раньше parent-строк (`provider_events` → `orders_v2`);
- транзакционность;
- в БД остаются `provider_events` типа `webhook_bad_signature`/`webhook_unknown_order` для аудита — они удаляются только отдельной командой после сохранения proof.
