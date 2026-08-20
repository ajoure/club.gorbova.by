# PLAN-ONLY / STRICT READ-ONLY — merged SHA cc5aeb89 (PR #346, CB21 module matrix)

Изменений не вносилось: код не редактировался, коммиты не создавались, миграции не применялись, SQL-записи, RLS, данные, секреты, cron, deploy функций и Publish не выполнялись.

## VERDICT: PASS — блокер PR #345 устранён, миграция готова к EXECUTE

## 1) SHA и паритет

- Managed HEAD = `cc5aeb89aa1f45dea44df2d02f65f26e96f49889` — «fix(cb21): preserve add-on delivery settings (#346)». Точное совпадение с указанным merged SHA.
- `git status --porcelain` пусто → полный byte-identical паритет.
- Миграция `20260820154000_cb21_copy_composable_module_matrix.sql` присутствует в дереве.

## 2) Миграция ещё НЕ применена

`supabase_migrations.schema_migrations` за 20260820 содержит только: `110414`, `110603`, `111005`, `111202`, `111541`. Версии `20260820154000` нет → **не применена**.

## 3) Что изменил PR #346

Удалён жёсткий preflight `access_delivery_mode <> 'immediate'` (бывшие строки 191–199), заблокировавший PR #345. Вместо hard-code добавлен комментарий (строки 210–212) и **read-back-проверка равенства source ↔ target** (строки 344–360) по трём полям: `access_delivery_mode`, `access_opens_at`, `access_duration_days`. INSERT/UPDATE копируют эти поля из source verbatim (строки 276–278, 298–300).

## 4) Preflight против live-данных — все проверки проходят

| Проверка миграции | Требование | Факт | Итог |
|---|---|---|---|
| tariff map | 3 | T-000076→085, T-000077→089, T-000078→086 | PASS |
| active offers на тариф (source и target, все 6) | 4 | 4 (`card`, `two_payments`, `invoice`, `bank_installment`) | PASS |
| distinct offer_key на тариф | 4 | 4 | PASS |
| `_cb21_offer_map` | 12 | 12 (3 тарифа × 4 семантических ключа) | PASS |
| source active offer_addons на тариф | 36 | 36 / 36 / 36 | PASS |
| source distinct addon products на тариф | 9 | 9 / 9 / 9 | PASS |
| T-000076 / T-000077 pricing | `offer_price`, discount NULL | 36 / 36 | PASS |
| T-000078 pricing | `percent_discount`, 50 | 36 | PASS |
| delivery-mode hard-check | **удалён в #346** | source = `manual` (108) — больше не блокирует | PASS |

## 5) Target CB21 сейчас

`offer_addons` для T-000085 / T-000089 / T-000086 — **0 строк вообще** (ни активных, ни неактивных). Deactivate-шаг (строки 224–238) затронет 0 строк; `ON CONFLICT` не сработает — только чистые INSERT.

## 6) Dry-run проекция (read-only, ничего не записано)

| target | projected links | distinct products | distinct conflict keys | pct 50% | offer_price | delivery_mode | opens_at set | duration set |
|---|---|---|---|---|---|---|---|---|
| T-000085 Бухгалтер | 36 | 9 | 36 | 0 | 36 | `manual` | 0 | 0 |
| T-000089 Главный бухгалтер | 36 | 9 | 36 | 0 | 36 | `manual` | 0 | 0 |
| T-000086 Бизнес-леди | 36 | 9 | 36 | **36** | 0 | `manual` | 0 | 0 |
| **Итого** | **108** | 9 уникальных | 108 | | | | | |

- `distinct conflict keys` = 36 на тариф → коллизий по `offer_addons_unique_offer (parent_offer_id, addon_offer_id)` внутри INSERT нет.
- `access_delivery_mode` = `manual`, `access_opens_at` = NULL, `access_duration_days` = NULL — копируются 1-в-1, read-back §5 миграции пройдёт.
- 9 addon-продуктов: PRD-000005 Производство, PRD-000011 Общепит, PRD-000012 ПВТ, PRD-000015 Розничная торговля, PRD-000016 Маркетплейсы, PRD-000017 Учёт у ИП, PRD-000018 Строительство, PRD-000022 Грузо-/пассажироперевозки, PRD-000043 Посредничество. Все addon product/tariff/offer активны → `public-product` выставит `has_available_addons=true`.

## 7) Orders / payments / contacts / entitlements

Миграция обращается ровно к 4 объектам: `offer_addons` (UPDATE is_active + INSERT/UPSERT), `tariff_offers` (только чтение), `tariffs` (только чтение), `products_v2` (только чтение) + 2 temp-таблицы `ON COMMIT DROP`. Ни `orders`, ни `payments_v2`, ни `contacts`/`profiles`, ни `entitlements`/`access_grant_ledger` не упоминаются. **0 изменений.**

## 8) Gates

- `npx tsgo --noEmit` — PASS.
- `bunx vitest run src/lib/composableCheckoutGate.test.ts` — PASS 5/5.
- `npm run build` — PASS.
- Security scan — новых critical findings в scope нет. Единственный `error` (`entitlements_manage_permission_overreach`) в статусе `ignored_by_user`, к PR #346 не относится.

## 9) EXACT EXECUTE PLAN

1. **Preflight.** Read-back HEAD = `cc5aeb89aa1f45dea44df2d02f65f26e96f49889`, дерево чистое (допустимы только `.lovable/` plan-markdown). Подтвердить, что `20260820154000` отсутствует в `schema_migrations`. Любое расхождение — STOP.
2. **Migration.** Применить ровно один файл, байт-в-байт: `supabase/migrations/20260820154000_cb21_copy_composable_module_matrix.sql`. Он транзакционен и самопроверяем: при дрейфе source выбросит `CB21 add-ons preflight failed`, при неточном target — `CB21 add-ons read-back failed`, и откатится целиком.
3. **Read-back (SQL, read-only).** Подтвердить для T-000085 / T-000089 / T-000086: 36 active links, 9 distinct addon products, T-000086 = 36 × `percent_discount` 50%, остальные = 36 × `offer_price` с `discount_percent IS NULL`; `access_delivery_mode`/`access_opens_at`/`access_duration_days` идентичны source; source CB20 остался 36/9 на тариф без изменений.
4. **Invariants.** Подтвердить неизменность counts по `orders`, `payments_v2`, `entitlements`, `contacts` до/после.
5. **Frontend Publish.** Опубликовать frontend ровно на этом SHA. Отчёт: публичный URL + effective SHA.
6. **Acceptance (без транзакций).** `/cb`, desktop 1280 и mobile 390: порядок карточек Бухгалтер → Главный бухгалтер → Бизнес-леди; в каждой 4 кнопки 100% картой → банк → 2 платежа → счёт ЮЛ; кнопка открывает `ComposableCheckoutDialog` со списком 9 модулей; в Бизнес-леди модули со скидкой 50%. Проверка останавливается до submit — реальные payment/order/contact/message не создаются.

Не выполняются: другие миграции, изменения RLS/GRANT, правки orders/payments/entitlements, секреты, cron, deploy Edge Functions, Storage, отправка писем/Telegram.

## Hard stop conditions

- HEAD ≠ `cc5aeb89…` или грязное дерево (кроме `.lovable`) — STOP.
- `20260820154000` уже присутствует в `schema_migrations` — STOP (повторное применение не требуется).
- Любой `RAISE EXCEPTION` из миграции — STOP, откат автоматический, Publish не выполняется.
- Read-back ≠ 108/36/9 или расхождение delivery-полей — STOP.
- Ненулевая дельта по orders/payments/entitlements/contacts — STOP.
- Новый critical security finding — STOP.

## ИТОГ: PLAN PASS — ожидаю «EXECUTE APPROVED».
