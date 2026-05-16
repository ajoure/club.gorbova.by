# да, согласен, с учетом правок:

1. **В Step 2 не удалять blindly** `next_charge_at`**,** `status`**,** `auto_renew`**.**  
Нужно разделить:
  - access-grant поля — запрещены для прямой записи из webhook;
  - provider-sync поля — допустимы только после явной классификации.
  Исправить формулировку:

```text
Webhook не должен напрямую менять:
- subscriptions_v2.access_start_at;
- subscriptions_v2.access_end_at;
- entitlements.expires_at;
- entitlements.status;
- telegram access.

subscriptions_v2.next_charge_at/status/auto_renew можно трогать только если это технический provider-sync и не используется как выдача/продление доступа. Каждый такой блок должен быть описан в inventory.
```

2. **Убрать** `forceExtend=true`**.**  
Это новый скрытый обход guard-логики. Правильнее:

```text
Если recurring payment имеет доказанный tariff_id match + bepaid_subscription_id match, stale-guard не должен блокировать extend.
Если match не доказан — manual_review.
```

3. **Не обещать** `FOR UPDATE` **без RPC.**  
Через обычный Supabase client это может быть недоступно. Заменить:

```text
Если row-level lock / atomic append невозможен без RPC, в H2 делаем best-effort dedupe, а полноценный race-safe append выносим в отдельный PATCH H2b с RPC/migration.
```

4. **Static check сделать по access-полям, а не по любому** `subscriptions_v2.update`**.**  
Иначе можно случайно запретить легитимный provider-sync. В proof нужно показать:

```text
нет прямых write payload, содержащих:
- access_end_at;
- access_start_at;
- expires_at;
- entitlement status;
- telegram grant.
```

А все оставшиеся `subscriptions_v2.update` должны быть перечислены и классифицированы как non-access provider-sync.

5. **Тесты уточнить по race.**  
Тест №6 “параллельные callback’и → ровно 1 append” допустим только если реально реализован atomic/CAS механизм. Если нет — заменить на:

```text
best-effort duplicate callback with same order_id → duplicate ignored
race-safe guarantee → deferred to PATCH H2b if RPC required
```

6. `grant-access-for-order(orderId, { source, context })` **заменить на фактический invoke body.**

```ts
supabase.functions.invoke('grant-access-for-order', {
  body: { orderId, source: 'bepaid_webhook', context }
})
```

И только если `context` реально поддерживается. Если нет — context писать в audit.

7. **Добавить code rollback section.**

```text
Rollback:
- если после деплоя webhook ломается, откатить H2 commit;
- env оставить dry_run;
- mode=on не включать;
- data-repair не выполнять.
```

8. **H2 можно запускать только как code+tests patch.**  
Без data repair Алёны, без перепривязки платежей, без исправления уже созданных дублей в production.

После этих правок план можно выполнять. H2 — blocker перед любым `BEPAID_REBILL_MATERIALIZATION=on`.

План: PATCH H2 — remove direct webhook access writes and enforce canonical grant path

## Цель

Убрать из `bepaid-webhook` прямое обновление `subscriptions_v2.access_end_at` / `next_charge_at` и оставить **единственный** канонический путь продления доступа:

```text
bepaid-webhook
  └─> grant-access-for-order
        └─> subscriptions_v2 / entitlements / telegram-grant-access
```

Если canonical writer вернул `skip` / `error` / `manual_review` / `sbs_mismatch` — webhook **не имеет права** сам двигать даты. Случай уходит в `manual_review` + audit, а не в скрытый bypass.

## Strict Stop-list

- production DML = 0
- migrations = 0
- `BEPAID_REBILL_MATERIALIZATION` остаётся `dry_run` (не переключать на `on` до закрытия H2)
- ничего не чиним по уже задетым подпискам (Алёна Богинская и др.) — отдельный PATCH H3 на data-repair
- PATCH G (bonus/secondary discovery) — read-only, может идти параллельно, но не блокирует и не блокируется H2

## Scope (только код + тесты)

### Step 1 — Inventory direct-write блоков в `bepaid-webhook/index.ts`

Найти и задокументировать все места, где webhook сам пишет в `subscriptions_v2` / `entitlements` помимо `grant-access-for-order`:

- `bepaid.webhook.link_order_dates_updated` (главный нарушитель, обнаружен в PATCH H)
- любые другие `supabase.from('subscriptions_v2').update(...)` / `.from('entitlements').update(...)`
- любые `.upsert` на тех же таблицах
- любые места, где webhook напрямую дёргает `telegram-grant-access` минуя `grant-access-for-order`

Зафиксировать список в proof.

### Step 2 — Запрет direct UPDATE access dates

В каждом найденном direct-write блоке:

1. Удалить запись/upsert `access_end_at`, `next_charge_at`, `status`, `auto_renew` в `subscriptions_v2` из webhook.
2. Удалить запись `expires_at` в `entitlements` из webhook.
3. На месте write-блока — вызов `grant-access-for-order(orderId, { source: 'bepaid_webhook', context })`.
4. Если writer вернул `skip_*` / `error` / `manual_review` / `primary_entitlement_*_failed` / `sbs_mismatch`:
  - webhook **не** падает в fallback с прямым UPDATE;
  - пишет `audit_logs` `bepaid.webhook.grant_skipped_no_fallback` c { decision, reason, orderId, paymentId, subscriptionId };
  - возвращает HTTP 200 с `processed: true, materialized: false, manual_review: <reason>` (webhook не должен ретраить бесконечно).

### Step 3 — Idempotency `meta.extended_by_orders`

Проблема H: `[68e2c243, 68e2c243]` — дубль того же `order_id`.

Канонизировать append-операцию в `grant-access-for-order` (это единственное место, где она теперь будет жить):

1. Чтение текущего `meta.extended_by_orders` (default `[]`).
2. `if (arr.includes(orderId)) { audit('extend.duplicate_ignored'); return existing; }`
3. Иначе append + UPDATE.
4. Использовать row-level lock (`FOR UPDATE`) или CAS через `updated_at` чтобы не было race между параллельными webhook callback'ами.
5. Audit:
  - `extend.applied` — нормальный путь;
  - `extend.duplicate_ignored` — повторный заход того же `order_id`;
  - оба содержат `subscription_id`, `order_id`, `previous_access_end_at`, `new_access_end_at`.

### Step 4 — Ревизия `patch-12.2-skip-stale-guard`

В PATCH H выяснили: guard блокировал расширение, потому что existing `access_end_at` < `expected_min_end`. Это означает, что **canonical writer отказывался продлевать** даже когда webhook знал правильный target.

Задачи:

1. Прочитать текущую логику guard.
2. Сформулировать корректное условие: guard должен срабатывать только если:
  - оплата НЕ соответствует tariff/sbs текущей подписки **и**
  - existing access уже истёк и нет основания extend.
3. Если match по `tariff_id` + `sbs` подтверждён, recurring rebill — `forceExtend=true` пропускает guard.
4. Если решение — НЕ extend, writer возвращает явный `skip_blocked_stale_access` с причиной; webhook (см. Step 2) уходит в manual_review без прямого UPDATE.

Возможные результаты:

- guard работает корректно → оставить как есть, доработать только сообщение/audit;
- guard ошибочно блокирует tariffMatch recurring rebill → исправить условие;
- в любом случае: НИКАКОГО fallback в webhook.

### Step 5 — Tests (Deno, под `supabase/functions/*/index_test.ts`)

Добавить и прогнать через `supabase--test_edge_functions`:

`bepaid-webhook`:

1. Recurring success, `grant=ok` → 1 вызов grant, 0 прямых UPDATE на subscriptions_v2/entitlements.
2. Recurring success, `grant=skip_already_fulfilled` → 0 прямых UPDATE, ответ `processed: true, materialized: false`.
3. Recurring success, `grant=skip_blocked_stale_access` → 0 прямых UPDATE, audit `grant_skipped_no_fallback`, response `manual_review`.
4. Recurring success, `grant=sbs_mismatch` → manual_review, 0 прямых UPDATE.
5. Двойной webhook callback с тем же `order_id` → `extended_by_orders` остаётся длиной 1, audit `extend.duplicate_ignored`.
6. Параллельные callback'и (race) → ровно 1 append.

`grant-access-for-order`:
7. Idempotency `extended_by_orders` — повторный вызов с тем же orderId не удлиняет массив.
8. tariffMatch + sbsMatch + recurring → не блокируется stale-guard (если Step 4 потребовал правки).
9. `skip_blocked_stale_access` — ответ structured, без частичного UPDATE entitlements/sub.

### Step 6 — Static guard

Добавить grep-guard в репозитории (комментарий + ESLint-disable-rule или простой `rg` chec в CI later):

- В `supabase/functions/bepaid-webhook/index.ts` запрещены строки:
  - `from('subscriptions_v2').update`
  - `from('subscriptions_v2').upsert`
  - `from('entitlements').update`
  - `from('entitlements').upsert`
  - `from('telegram_access').update/upsert`
- Если найдено — комментарий с обоснованием обязателен, иначе review-блок.

(В этом PATCH добавить только комментарий-маркер `// CANONICAL-WRITER-ONLY: no direct subscriptions_v2/entitlements writes here` сверху файла; полноценный CI-guard — отдельный backlog item.)

## Proof (после выполнения)

Файл: `.lovable/proofs/patch_h2_canonical_writer_enforced_2026_05.md`

Содержание:

1. **Inventory** найденных direct-write блоков (до правки).
2. **Diff-summary** — какие блоки удалены / заменены на `grant-access-for-order` call.
3. **Stale-guard verdict** — корректен / исправлен (с описанием правки).
4. **Idempotency** — описание dedupe-логики + audit-actions.
5. **Test report** — 9 тестов, все passed, имена + результат.
6. **Static check** — `rg "from\('subscriptions_v2'\)\.update" supabase/functions/bepaid-webhook/` → 0 совпадений.
7. **Counters**: production DML = 0, migrations = 0, `BEPAID_REBILL_MATERIALIZATION` = `dry_run` (не менялось).
8. **Untouched**: одноразовые платежи checkout-flow, installment public-link writer, autoweb, telegram queue manual sources.

## DoD

- В `bepaid-webhook` нет ни одного прямого UPDATE/UPSERT на `subscriptions_v2`, `entitlements`, `telegram_access` (grep-проверка приложена).
- Все extend / renew пути идут через `grant-access-for-order`.
- При `skip / error / manual_review / sbs_mismatch` webhook НЕ продлевает даты, пишет audit, отвечает 200 с `manual_review`.
- `extended_by_orders` dedupe покрыт тестом, дубль игнорируется + audit.
- Stale-guard либо подтверждён корректным, либо исправлен с тестом.
- 9 тестов passed.
- Production DML = 0, migrations = 0, `BEPAID_REBILL_MATERIALIZATION` = `dry_run`.
- Proof `.lovable/proofs/patch_h2_canonical_writer_enforced_2026_05.md` создан.

## После закрытия H2 — что остаётся отдельными задачами

- **PATCH H3** — data-repair уже задетых записей (Алёна Богинская, дубль `extended_by_orders`), только после H2.
- **PATCH H4** — preconditions check + переключение `BEPAID_REBILL_MATERIALIZATION=on`, отдельным dry-run → execute циклом.
- **PATCH G** — read-only discovery bonus/secondary access (можно параллельно с H2).
- **Group D** (51 date mismatches) — read-only план уже на очереди.
- **INV-22 Юлия Рабчевская**, manual_review duplicates, `d0a995aa` — без изменений.