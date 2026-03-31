# да, согласен, с учетом правок:

&nbsp;

1. **Не смешивай v23.1.9D и v23.1.10 в одну реализацию без общего helper/SoT.**
  Нужен один общий entitlement-sync helper с едиными правилами:
  &nbsp;
  - вход: user_id, profile_id, product_id, product_code, access_end_at, source
  - поведение: INSERT/UPDATE по ON CONFLICT (user_id, product_code)
  - правило срока: **никогда не уменьшать** expires_at, только max(existing_expires_at, new_access_end_at)
  - единый audit/meta
    И уже этот helper вызывать из:
  - handle_new_user
  - subscription-charge
  - subscription-admin-actions
  &nbsp;
2. **Для handle_new_user запрети hardcoded и тяжёлую бизнес-логику внутри триггера.**
  Триггер не должен сам заново вычислять сложный canonical order для всех продуктов.
  В плане зафиксируй:
  &nbsp;
  - generic sync по **active subscriptions** — прямо в trigger/через helper
  - для order-based deferred хвоста (CB20, 69 archived profiles) — либо через отдельный post-claim worker/edge вызов, либо через отдельную SQL/queue-логику по уже подготовленному source of truth
    То есть:
  - **sub-based deferred** можно закрывать сразу при claim
  - **CB20 order-based deferred** — только через уже утверждённый canonical dataset, не “пересчитывать на лету” в trigger
  &nbsp;
3. **subscription-admin-actions не должен слепо ревокать entitlement.**
  Добавь guard:
  &nbsp;
  - перед expired/revoked проверить, нет ли **другого активного источника доступа** на тот же user_id + product_code
  - учитывать:
    &nbsp;
    - другую active subscription по тому же продукту
    - active entitlement, пришедший не из subscription-path
    - order-based доступ, если продукт курсный, а не подписочный
      Иначе можно случайно снять доступ, который выдан по другому основанию.
    &nbsp;
  &nbsp;
4. **Раздели продукты на 2 режима прямо в плане.**
  Это обязательно, иначе патч сломает CB20:
  &nbsp;
  - **subscription-based sync**: club, buh_business, cb_module_ip, prd_0d01a2fdc477, course_close_year, 1769009596189-398a
  - **order-based deferred only**: cb20
    Для subscription-charge и subscription-admin-actions entitlement-sync применяется только там, где продукт реально subscription-based.
    Для cb20 через subscription-flow ничего не создавать и не ревокать.
  &nbsp;
5. **Зафиксируй mapping product_id → product_code как обязательный слой, без хардкода в бизнес-логике.**
  Можно использовать products_v2.code, но:
  &nbsp;
  - не предполагать, что code всегда идеален
  - для legacy кейсов (cb_2_step) явно делать skip_legacy_code_mismatch
  - никаких auto-normalize в этих патчах
    Это должно остаться в v23.1.9C.
  &nbsp;
6. **Добавь явный split для deferred-хвоста.**
  Сейчас в плане 87 deferred объединены, но по факту это 2 разных класса:
  &nbsp;
  - missing_user_id_archived_profile — 69 CB20 profiles without auth user
  - ghost_user_id_in_subscription — 18 sub-based rows, где subscriptions_v2.user_id не существует в auth.users
    Для второго класса нужен отдельный guard и отдельный follow-up:
  - либо repair user linkage
  - либо перевод в pending profile-based queue
    Не обещай, что handle_new_user автоматически закроет все 87 — это неверно.
  &nbsp;
7. **Для subscription-charge добавь точный DoD на renewal.**
  Не просто “обновить entitlement”, а:
  &nbsp;
  - successful renewal → subscriptions_v2.access_end_at обновлён
  - matching entitlement найден/создан
  - entitlements.expires_at >= subscriptions_v2.access_end_at
  - повторный запуск идемпотентен
  - записан audit_logs с actor_type='system', actor_user_id=NULL, actor_label заполнен
    Это нужно явно зафиксировать как обязательный proof.
  &nbsp;
8. **Для handle_new_user тоже нужен отдельный DoD с фактами.**
  Минимум:
  &nbsp;
  - archived profile claimed
  - profiles.user_id установлен
  - orders_v2/subscriptions_v2/entitlements.user_id перепривязаны
  - для sub-based products entitlement создан/обновлён
  - для CB20 order-based deferred создан не entitlement, а запись/маркер deferred-recovery для follow-up path
  - есть реальный audit proof
  &nbsp;
9. **Не называй это “fix root cause” целиком, пока не покрыты все creation paths.**
  Сейчас реально закрываются:
  &nbsp;
  - renewal path
  - claim path
  - admin sub status path
    Но если есть ещё import/admin/manual creation flows вне них — это не полный root-cause fix.
    Поэтому в плане точнее назвать:
  - v23.1.9D — deferred issuance after claim
  - v23.1.10 — entitlement sync for renewal/admin/claim paths
    А не “все root cause закрыты”.
  &nbsp;
10. **Добавь explicit deferred storage / queue contract.**
  Для v23.1.9D нужно заранее зафиксировать, где хранится pending-хвост:

&nbsp;

&nbsp;

&nbsp;

- отдельная таблица / existing audit/meta / deterministic recompute by profile_id + product_id + canonical_order_id
- без этого “выдадим потом при login” остаётся декларацией
  Нужен конкретный технический носитель и proof, что запись создаётся/читается.

&nbsp;

&nbsp;

&nbsp;

11. **Stop-guard по revoke path.**
  Execute запрещён, если в subscription-admin-actions нет pre-check:

&nbsp;

&nbsp;

&nbsp;

- “есть ли другой активный источник доступа на этот же product_code”
  Это критично.

&nbsp;

&nbsp;

&nbsp;

12. **Добавь отдельный deferred список в deliverables.**
  На выходе патча должен быть не только код, но и таблица:

&nbsp;

&nbsp;

&nbsp;

- resolved_now
- deferred_missing_user_id
- deferred_ghost_user_id
- skipped_legacy_code_mismatch
  Иначе потом снова потеряется хвост.

&nbsp;

&nbsp;

Если подрядчик внесёт эти правки, план уже можно утверждать.

&nbsp;

План: v23.1.9D + v23.1.10 — Entitlement sync helper + deferred issuance + root cause fix

## Статус: Утверждается

---

## Архитектурное решение: общий entitlement-sync helper

### Новый файл: `supabase/functions/_shared/entitlement-sync.ts`

**Контракт:**

```text
syncEntitlement({
  supabase,
  user_id,
  profile_id,
  product_id,
  product_code,
  access_end_at,
  source,           // 'subscription_renewal' | 'profile_claim' | 'admin_action' | ...
  order_id?,
  subscription_id?,
  actor_label,
  batch_id?,
})
```

**Поведение:**

- `INSERT ... ON CONFLICT (user_id, product_code) DO UPDATE`
- Правило срока: `expires_at = GREATEST(existing.expires_at, new.access_end_at)` — **никогда не уменьшать**
- `status = 'active'` при upsert
- `product_id` заполняется обязательно
- `meta` содержит `source`, `source_patch`, `actor_label`
- Единый audit_logs запись: `actor_type='system'`, `actor_label` заполнен, `action='entitlement.synced'`
- Возврат: `{ action: 'inserted' | 'updated' | 'skipped', entitlement_id }`
- Skip если `product_code` не передан или пуст → не crash

**Режимы продуктов (зашитый guard):**


| Режим                | product_codes                                                                                         | Правило                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `subscription_based` | `club`, `buh_business`, `cb_module_ip`, `prd_0d01a2fdc477`, `course_close_year`, `1769009596189-398a` | sync при renewal/claim/admin                                                       |
| `order_based_only`   | `cb20`                                                                                                | **НЕ sync из subscription-charge/admin-actions**; только через deferred claim path |


Helper должен принимать опциональный `mode_filter` и отказывать в sync для `cb20` при вызове из subscription paths.

---

## v23.1.9D — Deferred entitlement issuance after profile→user claim

### Изменение 1: `handle_new_user` trigger (SQL migration)

**Текущее поведение** (строки 301-341 последней миграции):

- Claim archived/imported profile → set `user_id`
- Перенос `orders_v2.user_id`, `subscriptions_v2.user_id`, `entitlements.user_id`
- **Hardcoded**: создаёт entitlement только для `club` (`product_id = '11c9f1b8...'`)

**Новое поведение:**

1. После переноса `user_id` → цикл по **всем active subscriptions** нового user:
  - Для каждой sub с `status IN ('active', 'trial')` → вызвать inline entitlement upsert (SQL-версия syncEntitlement)
  - `expires_at = sub.access_end_at`
  - `ON CONFLICT (user_id, product_code) DO UPDATE SET expires_at = GREATEST(...), status = 'active'`
  - Пропускать если `product_code IS NULL` (нет mapping через `products_v2.code`)
  - **НЕ обрабатывать** order-based deferred (cb20) — это другой path
2. Убрать hardcoded club entitlement creation
3. Audit log с `actor_label = 'handle_new_user'`, кол-вом созданных entitlements

**Запрещено в trigger:**

- Тяжёлая бизнес-логика (canonical order lookup, tariff resolution)
- Вызов edge functions
- Обработка order-based deferred хвоста

### Изменение 2: Order-based deferred (CB20, 69 profiles)

**Подход**: НЕ в trigger. Отдельная edge function или расширение `admin-entitlement-backfill-v23`:

- При первом login archived profile → `handle_new_user` переносит `user_id` на orders/subs/entitlements
- Для CB20 order-based deferred: **cron/queue-based worker** проверяет `profiles` где `status` перешёл из `archived/imported` в `active` и `user_id IS NOT NULL`
- Worker берёт canonical order из уже утверждённого dataset (orders_v2 с tariff_id, max access_days)
- Создаёт entitlement через `syncEntitlement` helper

**Deferred storage contract:**


| Носитель                               | Описание                                                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `orders_v2` + `products_v2`            | Source of truth уже есть — canonical order определён в v23.1.9A                                          |
| `profiles.status` + `profiles.user_id` | Триггер для recompute: `status = 'active' AND user_id IS NOT NULL`                                       |
| Нет отдельной pending-таблицы          | Deterministic recompute по `profile_id + product_id + canonical_order_id` через LEFT JOIN `entitlements` |


То есть pending-хвост определяется **динамически**: `profiles с user_id AND orders_v2 paid на cb20 AND NO matching entitlement`. Отдельной pending-таблицы не создаём — source of truth уже есть.

### Деление deferred-хвоста (87 total)


| Класс                              | Count | Механизм закрытия                                                                                                                                                                                                                           |
| ---------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `missing_user_id_archived_profile` | 69    | При claim → `handle_new_user` → sub-based sync автоматически. CB20 order-based → cron/worker по canonical dataset                                                                                                                           |
| `ghost_user_id_in_subscription`    | 18    | **Отдельный follow-up**: repair user linkage (если user существовал и был удалён из auth.users) ИЛИ перевод sub.user_id → правильный auth user. `handle_new_user` **НЕ закроет** эти 18 автоматически — нужен отдельный диагностический шаг |


---

## v23.1.10 — Entitlement sync for renewal/admin/claim paths

### Изменение 1: `subscription-charge/index.ts`

После successful renewal (когда `access_end_at` обновлён):

- Вызвать `syncEntitlement` с `source = 'subscription_renewal'`
- `product_code` берётся из `products_v2.code` через join (уже есть в subscription fetch)
- `mode_filter = 'subscription_based'` → cb20 автоматически пропускается
- `actor_label = 'subscription-charge'`

**DoD на renewal:**

1. successful renewal → `subscriptions_v2.access_end_at` обновлён
2. matching entitlement найден/создан
3. `entitlements.expires_at >= subscriptions_v2.access_end_at`
4. повторный запуск идемпотентен
5. audit_logs: `actor_type='system'`, `actor_user_id=NULL`, `actor_label='subscription-charge'`

### Изменение 2: `subscription-admin-actions/index.ts`

**Ветки `cancel` и `revoke_access`:**

Добавить **pre-revoke guard** перед изменением entitlement status:

```text
Перед expired/revoked → проверить:
1. Есть ли другая active subscription по тому же user_id + product_code?
2. Есть ли active entitlement с другим source (не subscription-path)?
3. Является ли продукт order-based (cb20)? → не ревокать entitlement

Если хотя бы одно условие true → skip entitlement revoke, записать audit 'skipped_has_other_source'
```

**Ветки `extend`, `set_end_date`, `grant_access`:**

- Вызвать `syncEntitlement` с обновлённым `access_end_at`
- Это синхронизирует entitlement при продлении/изменении даты

**Stop-guard по revoke path:**
Execute запрещён если в `subscription-admin-actions` нет pre-check: "есть ли другой активный источник доступа на этот же product_code".

### Изменение 3: `subscription-actions/index.ts` (user self-service)

Аналогично: при `resume` → `syncEntitlement`; при `cancel` → не трогать entitlement (access сохраняется до `cancel_at`).

---

## Mapping product_id → product_code

**Правило**: через `products_v2.code` (уже есть join в subscription-charge и subscription-admin-actions).


| Guard                        | Правило                                    |
| ---------------------------- | ------------------------------------------ |
| `product_code IS NULL`       | skip sync, не crash                        |
| `product_code = 'cb_2_step'` | `skip_legacy_code_mismatch` — v23.1.9C     |
| Без auto-normalize           | Никаких переименований в v23.1.9D/v23.1.10 |


---

## Изменяемые компоненты


| Компонент                                                | Изменение                                           |
| -------------------------------------------------------- | --------------------------------------------------- |
| `supabase/functions/_shared/entitlement-sync.ts`         | **Новый**: общий helper                             |
| `handle_new_user` trigger (SQL migration)                | Generic sub-based sync вместо hardcoded club        |
| `supabase/functions/subscription-charge/index.ts`        | Вызов syncEntitlement после renewal                 |
| `supabase/functions/subscription-admin-actions/index.ts` | Pre-revoke guard + syncEntitlement при extend/grant |
| `supabase/functions/subscription-actions/index.ts`       | syncEntitlement при resume                          |
| `.lovable/plan.md`                                       | Обновление статусов v23.1.9D, v23.1.10              |


---

## Что НЕ меняется

- `grant-access-for-order` — уже работает корректно
- `payments-reconcile` — уже создаёт entitlements
- CB20 order-based deferred — не в этих патчах (cron worker — отдельный deliverable)
- Legacy code normalization — v23.1.9C
- Product naming — v23.1.11
- 18 ghost user_ids — отдельный диагностический follow-up

---

## DoD

### v23.1.9D:

1. `handle_new_user`: при claim archived profile → entitlements создаются для **всех active subscriptions** (не только club)
2. Hardcoded club entitlement creation удалён, заменён generic loop
3. CB20 order-based deferred: NOT в trigger, определяется динамически через LEFT JOIN, worker — отдельный deliverable
4. Для 18 ghost_user_id: зафиксировано что `handle_new_user` НЕ закроет их; нужен отдельный repair
5. Audit log с `actor_label='handle_new_user'`, count созданных entitlements

### v23.1.10:

1. При subscription renewal → `entitlements.expires_at >= subscriptions_v2.access_end_at`
2. Повторный renewal идемпотентен
3. При admin cancel/revoke → pre-check на другой активный источник доступа
4. При admin extend/grant → entitlement синхронизирован
5. `audit_logs`: `actor_type='system'`, `actor_user_id=NULL`, `actor_label` заполнен
6. cb20 не затронут из subscription paths (mode_filter guard)

---

## Stop-guards


| Guard                                                 | Правило         |
| ----------------------------------------------------- | --------------- |
| `handle_new_user` не ломает existing claim flow       | Обязательно     |
| `syncEntitlement` никогда не уменьшает `expires_at`   | Обязательно     |
| `ON CONFLICT (user_id, product_code)` — без дублей    | Обязательно     |
| `product_code IS NULL` → skip, не crash               | Обязательно     |
| `cb20` не sync из subscription-charge / admin-actions | Обязательно     |
| `cb_2_step` → `skip_legacy_code_mismatch`             | Обязательно     |
| revoke path: pre-check другой активный источник       | **Обязательно** |


---

## Deliverables на выходе


| Категория                      | Count                            |
| ------------------------------ | -------------------------------- |
| `resolved_now` (v23.1.9B)      | 254                              |
| `deferred_missing_user_id`     | 69 (CB20 archived profiles)      |
| `deferred_ghost_user_id`       | 18 (sub-based, отдельный repair) |
| `skipped_legacy_code_mismatch` | 8 (v23.1.9C)                     |


---

## Уточнение naming

- **v23.1.9D** = deferred entitlement issuance after profile→user claim
- **v23.1.10** = entitlement sync for renewal/admin/claim paths (НЕ "все root cause закрыты" — остаются import/manual/bulk creation flows вне scope)