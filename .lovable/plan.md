Да, согласен, с учетом правок:

1. **UI-фикс выполнить первым**, но только если он действительно presentation-only.  
Обязательный guard: перед правкой подтвердить, что группировка сейчас идёт не по `product_id`, а по имени/префиксу/родительскому имени. Если уже по `product_id`, сначала остановиться и дать новый диагноз.
2. **PATCH 1 dry-run — не смешивать с execute.**  
На первом проходе только:
  - cohort;
  - buckets;
  - source priority;
  - список `safe_to_fix`;
  - список `manual_review`;
  - список `skip_*`;
  - никаких UPDATE.
3. `skip_scope_limited` **оставить жёстким.**  
`module_scope_only`, `no_scope`, `union_scope` не чинить автоматически, даже если найден один `tariff_id`. Они могут менять смысл доступа.
4. **Для** `safe_to_fix` **добавить обязательный стоп-гард:**
  - один `entitlement_id`;
  - один доказуемый `tariff_id`;
  - один источник;
  - нет конфликта между `orders_v2`, `subscriptions_v2`, `access_rules`, `audit_logs`;
  - если конфликт — только `manual_review`.
5. **PATCH 2 диагностику GIFT/admin_grant делать до execute PATCH 1**, чтобы не замазать первопричину.  
Правильный порядок:
  - UI-фикс;
  - PATCH 2 read-only диагностика writer-path;
  - PATCH 1 dry-run;
  - approve;
  - PATCH 1 execute;
  - verify.
6. **В PATCH 2 обязательно отделить два случая:**
  - `orders_v2.tariff_id IS NULL` → проблема upstream при создании GIFT-order;
  - `orders_v2.tariff_id IS NOT NULL`, но `entitlements.meta.tariff_id IS NULL` → проблема writer’а.
7. **Grep gate по новым артефактам обязателен.**  
В новых proof/plan/memory/audit labels не использовать legacy product code/slug. Только UUID + `product_name`.
8. **UI-verify по Екатерине Иванченко:**  
Проверить не только родитель/модуль, но и что старые сделки не попадают в чужие карточки из-за prefix-группировки.

Итоговый порядок после правок:

```text
1. UI-фикс группировки сделок по product_id.
2. PATCH 2 — read-only диагностика GIFT/admin_grant writer-path.
3. PATCH 1 — dry-run backfill meta.tariff_id.
4. Отдельный approve safe_to_fix.
5. PATCH 1 execute только по safe_to_fix.
6. Verify + proof.
```

Execute PATCH 1 без отдельного dry-run approve не запускать.

&nbsp;

План:

# Три задачи (раздельно, не смешивать)

## PATCH 1 — Backfill `meta.tariff_id` у active entitlements

**Scope:** только `entitlements.meta` (read+write на одно поле) + `audit_logs`. Никаких касаний `subscriptions_v2`, `orders_v2`, `payments_v2`, `access_rules`, writers (`grant-access-for-order`, `retroapply`, `rule_engine`).

### Шаг 1 — Diagnose / Dry-run (read-only)

1. Найти все active entitlements без `meta.tariff_id`:
  ```sql
   SELECT id, user_id, product_id, expires_at,
          meta->>'scope_resolution_mode' AS scope_mode,
          source_type, source_rule_id, created_at, meta
   FROM entitlements
   WHERE status='active'
     AND (meta->>'tariff_id') IS NULL
     AND product_id IS NOT NULL;
  ```
2. Для каждой строки определить `tariff_id` через приоритеты:
  - **P1:** `orders_v2` со связкой `(user_id, product_id)`, `status='paid'` или `source='admin_grant'`, у которых `tariff_id IS NOT NULL`. Если ровно один уникальный `tariff_id` — кандидат.
  - **P2:** `subscriptions_v2` `(user_id, product_id)`, `status IN ('active','trial','canceled')` — `tariff_id`. Если ровно один — кандидат.
  - **P3:** `access_rules` где `product_id` совпадает и `tariff_id IS NOT NULL` и применимо к этому entitlement (через `source_rule_id`, если есть).
  - **P4:** `audit_logs` lineage `grant-access-for-order` по этому `entitlement_id`/`order_id`.
3. Buckets:
  - `safe_to_fix` — ровно один доказуемый `tariff_id` из P1/P2/P3/P4 (P1 имеет приоритет).
  - `manual_review` — несколько разных `tariff_id` из источников.
  - `skip_no_tariff_source` — никаких источников.
  - `skip_scope_limited` — `scope_resolution_mode IN ('module_scope_only','no_scope','union_scope')` (backfill может изменить поведение P4.5/scope-логики). Они НЕ обновляются на этом шаге, идут отдельным review.
4. Артефакт: `.lovable/proofs/entitlement_tariff_id_backfill_dryrun_2026_05.md` с counts по бакетам и полным списком `safe_to_fix` (entitlement_id → tariff_id + источник).

### Шаг 2 — Execute (только `safe_to_fix`)

- Backup: `.lovable/proofs/entitlement_tariff_id_backfill_backup_2026_05.json` со всеми `meta` до изменения.
- Миграция (`supabase--migration`): UPDATE только `meta = jsonb_set(meta, '{tariff_id}', to_jsonb(<uuid>))` + `meta.tariff_id_backfilled_at`, `meta.tariff_id_backfill_source` (P1/P2/P3/P4).
- Не трогать: `status`, `expires_at`, `scope_resolution_mode`, `product_id`, `user_id`, `source_type`, `source_rule_id`.
- Audit row на каждую строку:
  - `action='training_content.entitlement_tariff_id_backfilled'`
  - `actor_type='system'`
  - `actor_label='entitlement_tariff_id_backfill_2026_05'`
  - `meta = { entitlement_id, user_id, product_id, tariff_id, source }`

### Шаг 3 — Verify

- Counts active entitlements без `meta.tariff_id` до/после.
- `audit rows = updated rows`.
- Sample 5 affected user_id: симуляция `useTrainingContentRules` — карточки не исчезли, `module_scope_only` не превратился во `full`, P4.5 fallback не используется там, где теперь есть `tariff_id`.
- `manual_review` и `skip_*` перечислены отдельно (не пытаемся фиксить).
- Артефакт: `.lovable/proofs/entitlement_tariff_id_backfill_execute_2026_05.md`.

### DoD PATCH 1

- 4 артефакта: dryrun, backup, execute, verify.
- `audit_count = updated_count`.
- Нет writes вне `entitlements.meta` + `audit_logs`.
- Нет вызовов grant/revoke/retroapply/rule_engine.
- Grep gate: запрещённые legacy product code/slug = 0 в новых артефактах.

---

## PATCH 2 — Read-only диагностика GIFT / admin_grant writer path

**Scope:** только чтение БД + чтение кода. Никаких write.

### Шаги

1. Выгрузить все `orders_v2` где `source='admin_grant' OR order_number LIKE 'GIFT-%'`:
  `order_id, order_number, user_id, product_id, tariff_id, status, created_at, meta`.
2. Для каждого ордера join с `entitlements` по `(user_id, product_id)`:
  `entitlement_id, status, expires_at, meta->>'tariff_id', meta->>'scope_resolution_mode', source_type, source_rule_id, created_at`.
3. По каждому order — `audit_logs` события:
  - `grant-access-for-order` (entry/success/skip/failed/fallback);
  - `recurring_snapshot_*`, `extend_*`, `tariff_mismatch_*`;
  - какой writer был actor.
4. Чтение кода:
  - `supabase/functions/grant-access-for-order/index.ts` (резолв `tariff_id` для admin_grant ветки);
  - upstream: где создаётся GIFT order (admin UI / RPC) и какие поля передаются в `grant-access-for-order` payload;
  - entitlement writer внутри `grant-access-for-order` — точное место, где `meta.tariff_id` либо пишется, либо нет.
5. Корреляция:
  - admin_grant с `tariff_id IS NULL` в `orders_v2` → entitlement без `meta.tariff_id` (writer корректен, проблема upstream);
  - admin_grant с `tariff_id IS NOT NULL` → entitlement без `meta.tariff_id` (writer теряет поле — root cause в writer).
6. Артефакт `.lovable/proofs/gift_admin_grant_entitlement_diagnostic_2026_05.md`:
  - таблица affected orders;
  - таблица entitlements без `meta.tariff_id`;
  - audit timeline по 3-5 примерам;
  - **точная root-cause гипотеза** (файл:строка);
  - **отдельный план writer-fix** (без выполнения).

### DoD PATCH 2

- Только proof, без write.
- Точная root-cause локализация.
- План фикса writer'а отдельным документом, ждёт approve.

---

## UI-фикс — модуль скрыл родителя у Екатерины Иванченко

**Симптом (по скриншоту):** в карточке сделок продукт `"Ценный бухгалтер | 1 ступень 2.0 | Модуль: Маркетплейсы"` (модуль) и продукт `"Ценный бухгалтер | 1 ступень 2.0"` (родитель) рендерятся внутри одной карточки — модуль "поглотил" родителя. Это UI-группировка, бизнес-данные раздельные.

### Diagnose

1. Найти компонент, рендерящий список сделок в правой панели контакт-центра (вероятно `src/components/contacts/...` / `ContactDealsTab` / аналог).
2. Найти логику группировки сделок по продукту: где сделки склеиваются в одну "коробку" (по `product_id`? по `product_name` startsWith? по `parent_product_id`?).
3. Подтвердить, что `"...| Модуль: Маркетплейсы"` и `"Ценный бухгалтер | 1 ступень 2.0"` имеют **разные** `product_id` в `orders_v2.product_id` / `purchase_snapshot.product_id` — тогда это чистый UI-баг группировки.

### Fix

- Группировка строго по `product_id` (UUID), не по `product_name` / startsWith / common prefix.
- Каждый `product_id` = отдельная карточка-аккордеон в списке сделок.
- Сортировка карточек: по последней сделке `created_at desc`.

### Verify

- На экране у `finassist.by@gmail.com`: `"Ценный бухгалтер | 1 ступень 2.0"` — отдельная карточка, `"... | Модуль: Маркетплейсы"` — отдельная карточка, `Бизнес-леди` (одна из старых сделок) — внутри своей правильной карточки, не подмешана в Маркетплейсы.

### Scope guard

- Только presentation-слой (компонент списка сделок).
- Никаких изменений в `orders_v2`, `entitlements`, writers, resolver.

---

## Порядок исполнения и approve gates

1. **UI-фикс модуля** — выполняю сразу после approve плана (минимальный риск, presentation-only).
2. **PATCH 2 (диагностика)** — выполняю read-only, выдаю proof.
3. **PATCH 1 шаг 1 (dry-run)** — выдаю proof + список `safe_to_fix`.
4. **PATCH 1 шаг 2 (execute)** — только после явного approve dry-run.
5. **PATCH 1 шаг 3 (verify)** — proof.

Каждый шаг с write-действием = отдельный approve. План writer-fix из PATCH 2 — отдельным сообщением, ждёт approve.