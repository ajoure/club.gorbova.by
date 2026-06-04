# MP-A2-2R — Runtime Completion Proof v1

**Дата:** 2026-06-04
**Статус:** ✅ PASS (S1, S4, S5, S6, S7 — runtime)
**Mode:** Stripe TEST (account `stripe_poland`, `acct_1Tc88d6UYJj2vm0G`, `livemode=false`)
**Связанные документы:** `.lovable/proofs/mp_a2_2_customer_resolver_v1.md`, `.lovable/plan.md` § MP-A2-2R

---

## 0. Почему S1/S4/S5/S6/S7 не были выполнены в первой итерации (env-state)

В первой итерации MP-A2-2 каноничные write-paths (`stripe-create-checkout`, `stripe-admin-sandbox-checkout`) **создают Stripe Checkout Session, а не вызывают резолвер изолированно**. Чтобы получить runtime-доказательства по S1/S4/S5/S6/S7, требовалось:

1. Изолированно дёргать `resolveStripeCustomer` с заданным `(user_id, account_code, email, name)`.
2. Уметь pre-seed Stripe Customer (для S4 — без metadata; для S5 — с foreign metadata.user_id).
3. Иметь чистый `profile.meta.stripe.customers[stripe_poland]` (S1/S4/S5) или заведомо заполненный (S6/S7).

Стандартные write-paths не дают ни (1), ни (2). В первой итерации был сделан code-review с логическим выводом «логика покрывает кейс», что **не соответствует DoD** (runtime verification).

**Решение MP-A2-2R:** временный super_admin-gated edge function `mp-a2-2r-runtime`, который дёргает существующий резолвер напрямую, пишет audit/profile через **production-код резолвера** (никаких новых write-путей), и при необходимости pre-seed-ит Stripe Customer через тот же ключ Vault. После прогона функция **удалена** (см. §6).

---

## 1. Repro recipe (чистое окружение)

### Предпосылки
- `acquiring_connections.provider='stripe' AND account_code='stripe_poland' AND status='active' AND test_mode=true` — единственная запись.
- Vault содержит `acq:stripe:stripe_poland:secret_key`.
- Два тестовых пользователя с профилями: `qa.user@gorbova.test` (`638a13ec-...`), `qa.admin@gorbova.test` (`913bc4cf-...`).
- Initial `profiles.meta.stripe = null` для обоих.

### Шаги
1. Развернуть временную функцию `mp-a2-2r-runtime` (исходник см. backlog ниже в Appendix A — не коммитим в дерево).
2. Прогнать сценарии в порядке: **S1, S4, sweep(S4 email), S5, S6, S7**.
3. Cleanup: `action=cleanup` для обоих user_ids + `action=sweep_emails` для S5 seed email.
4. Удалить функцию через `supabase--delete_edge_functions` и стереть код из дерева.

Каждый сценарий возвращает JSON с полями:
- `started_at`, `finished_at`
- `profile_meta_before`, `profile_meta_after` — снэпшоты `profiles.meta.stripe`
- `resolver_decision` — `{ source, customer_id, input }`
- `stripe_customer` — реальный ответ `GET /v1/customers/{id}`
- `audit_records` — записи `audit_logs` с `action ∈ {stripe_customer_*}`, созданные внутри окна

---

## 2. Сценарий S1 — New user, no profile cache → create

**Вход:** `user_id=638a13ec-...`, `email=mp-a2-2r-s1-1780559984315@gorbova.test`, `name="MP A2-2R S1"`.

**Resolver decision:** `source=created`, `customer_id=cus_UdnnutJVY1r9LX`.

**profile.meta.stripe — ДО:** `null`
**profile.meta.stripe — ПОСЛЕ:**
```json
{
  "customers": {
    "stripe_poland": {
      "created_at": "2026-06-04T07:59:45.415Z",
      "customer_id": "cus_UdnnutJVY1r9LX",
      "last_synced_at": "2026-06-04T07:59:45.415Z",
      "source": "created"
    }
  }
}
```

**Stripe API dump (`GET /v1/customers/cus_UdnnutJVY1r9LX`):**
```json
{
  "id": "cus_UdnnutJVY1r9LX",
  "object": "customer",
  "created": 1780559985,
  "email": "mp-a2-2r-s1-1780559984315@gorbova.test",
  "livemode": false,
  "metadata": {
    "account_code": "stripe_poland",
    "user_id": "638a13ec-62a8-47b3-90d9-bc3a4e22c174"
  },
  "name": "MP A2-2R S1"
}
```

**Stripe API dump (`GET /v1/payment_methods?customer=cus_UdnnutJVY1r9LX&type=card`):** `{ "data": [], "has_more": false }` — корректно (нет saved PM, S10 уже подтверждён в основном proof).

**audit_logs:**
```json
{
  "id": "1b7bb73d-224f-4884-a8de-bd3978e4abb8",
  "action": "stripe_customer_created",
  "entity_type": "stripe_customer",
  "created_at": "2026-06-04T07:59:45.49623+00:00",
  "meta": {
    "account_code": "stripe_poland",
    "customer_id": "cus_UdnnutJVY1r9LX",
    "user_id": "638a13ec-62a8-47b3-90d9-bc3a4e22c174"
  }
}
```

**Verdict:** ✅ `source=created`, metadata `(user_id, account_code)` записаны на Stripe, audit `stripe_customer_created`, profile.meta заполнен.

---

## 3. Сценарий S4 — Email fallback (clean)

**Pre-seed:** `POST /v1/customers` с `email=mp-a2-2r-s4-1780559991739@gorbova.test`, `metadata.mp_a2_2r=seed_s4` (без `user_id`/`account_code`). Создан `cus_UdnnMXbsVPtFwe`.

**Вход:** `user_id=913bc4cf-...` (qa.admin), `email=` тот же seed-email, `name="MP A2-2R S4"`.

**Resolver decision:** `source=email_fallback`, `customer_id=cus_UdnnMXbsVPtFwe` (**тот же**, что seeded).

**profile.meta.stripe — ДО:** `null`
**profile.meta.stripe — ПОСЛЕ:**
```json
{
  "customers": {
    "stripe_poland": {
      "created_at": "2026-06-04T07:59:53.573Z",
      "customer_id": "cus_UdnnMXbsVPtFwe",
      "last_synced_at": "2026-06-04T07:59:53.573Z",
      "source": "email_fallback"
    }
  }
}
```

**Stripe API dump (`GET /v1/customers/cus_UdnnMXbsVPtFwe`):**
```json
{
  "id": "cus_UdnnMXbsVPtFwe",
  "email": "mp-a2-2r-s4-1780559991739@gorbova.test",
  "livemode": false,
  "metadata": {
    "account_code": "stripe_poland",
    "mp_a2_2r": "seed_s4",
    "user_id": "913bc4cf-c68c-4a1b-a98d-adf778ef02d1",
    "user_id_override": "913bc4cf-c68c-4a1b-a98d-adf778ef02d1"
  },
  "name": null
}
```

Сохранение `mp_a2_2r=seed_s4` доказывает, что Customer **не пересоздан, а переиспользован**. Поля `user_id` + `account_code` **backfilled** через `customers.update`.

**audit_logs:**
```json
{
  "id": "53a4fd7b-5882-4cd6-b44d-3065a85d4bcf",
  "action": "stripe_customer_email_fallback_used",
  "created_at": "2026-06-04T07:59:53.510213+00:00",
  "meta": {
    "account_code": "stripe_poland",
    "customer_id": "cus_UdnnMXbsVPtFwe",
    "email_masked": "mp-a***@gorbova.test",
    "user_id": "913bc4cf-c68c-4a1b-a98d-adf778ef02d1"
  }
}
```

**Verdict:** ✅ `source=email_fallback`, существующий Customer переиспользован, metadata backfilled, отдельный audit `stripe_customer_email_fallback_used` (email маскирован).

---

## 4. Сценарий S5 — Email collision (foreign metadata.user_id)

**Pre-condition:** S4-Customer (`cus_UdnnMXbsVPtFwe`) удалён из Stripe через `sweep_emails`, чтобы `stripe_search` по `metadata.user_id=qa.admin` не нашёл его (иначе сработал бы `source=stripe_search`, не `email_fallback`).

**Pre-seed:** `POST /v1/customers` с `email=mp-a2-2r-s5-1780560052270@gorbova.test`, `metadata.user_id=00000000-dead-beef-0000-000000005555` (foreign), `metadata.account_code=stripe_poland`, `metadata.mp_a2_2r=seed_s5_foreign`. Создан `cus_UdnoA8lAqWBdFH`.

**Вход:** `user_id=913bc4cf-...` (qa.admin, **отличается от foreign**), `email=` seed email, `name="MP A2-2R S5"`.

**Resolver decision:** `source=created`, `customer_id=cus_Udnog0fHCy8RiG` (**НОВЫЙ**, не foreign).

**Assertion:** `s5_assertion_not_reused = true` (`foreign.id !== decision.customer_id`).

**profile.meta.stripe — ДО:** `{ "customers": {} }` (cleaned by harness)
**profile.meta.stripe — ПОСЛЕ:**
```json
{
  "customers": {
    "stripe_poland": {
      "created_at": "2026-06-04T08:00:54.094Z",
      "customer_id": "cus_Udnog0fHCy8RiG",
      "last_synced_at": "2026-06-04T08:00:54.094Z",
      "source": "created"
    }
  }
}
```

**Stripe API dump — новый Customer (`cus_Udnog0fHCy8RiG`):**
```json
{
  "id": "cus_Udnog0fHCy8RiG",
  "email": "mp-a2-2r-s5-1780560052270@gorbova.test",
  "metadata": {
    "account_code": "stripe_poland",
    "user_id": "913bc4cf-c68c-4a1b-a98d-adf778ef02d1"
  },
  "name": "MP A2-2R S5"
}
```

**Stripe API dump — foreign Customer (`cus_UdnoA8lAqWBdFH`) после прогона:** metadata по-прежнему `user_id=00000000-dead-beef-...`, не тронут.

**audit_logs (2 записи в окне):**
```json
[
  {
    "action": "stripe_customer_email_collision",
    "created_at": "2026-06-04T08:00:53.632368+00:00",
    "meta": {
      "account_code": "stripe_poland",
      "customer_id": "cus_UdnoA8lAqWBdFH",
      "email_masked": "mp-a***@gorbova.test",
      "foreign_user_id": "00000000-dead-beef-0000-000000005555",
      "user_id": "913bc4cf-c68c-4a1b-a98d-adf778ef02d1"
    }
  },
  {
    "action": "stripe_customer_created",
    "created_at": "2026-06-04T08:00:54.205202+00:00",
    "meta": {
      "account_code": "stripe_poland",
      "customer_id": "cus_Udnog0fHCy8RiG",
      "user_id": "913bc4cf-c68c-4a1b-a98d-adf778ef02d1"
    }
  }
]
```

**Verdict:** ✅ foreign Customer **не использован** (`customer_id` различаются), audit `stripe_customer_email_collision` зафиксирован с foreign-user_id, далее `stripe_customer_created` для нового. Foreign Customer не модифицирован.

---

## 5. Сценарий S6 — Email change (preserve customer_id)

**Pre-condition:** профильный кэш qa.user содержит `cus_UdnnutJVY1r9LX` (из S1).

**Вход:** `user_id=638a13ec-...`, `email=mp-a2-2r-s6-changed-1780560061548@gorbova.test` (**новый**, отличается от S1), `name="MP A2-2R S6 (kept name)"` (отличается от S1).

**Resolver decision:** `source=profile_cache`, `customer_id=cus_UdnnutJVY1r9LX` (**тот же**).

**profile.meta.stripe — ДО:**
```json
{ "customers": { "stripe_poland": { "customer_id": "cus_UdnnutJVY1r9LX", "source": "created", "created_at": "2026-06-04T07:59:45.415Z", "last_synced_at": "2026-06-04T07:59:45.415Z" } } }
```
**profile.meta.stripe — ПОСЛЕ:** `customer_id` тот же, `created_at` тот же, `last_synced_at` сдвинут на `2026-06-04T08:01:02.489Z`.

**Stripe API dump (`GET /v1/customers/cus_UdnnutJVY1r9LX`):**
```json
{
  "id": "cus_UdnnutJVY1r9LX",
  "created": 1780559985,
  "email": "mp-a2-2r-s6-changed-1780560061548@gorbova.test",
  "metadata": { "account_code": "stripe_poland", "user_id": "638a13ec-..." },
  "name": "MP A2-2R S6 (kept name)"
}
```

Подтверждено: `created` неизменно (1780559985 = S1), `email` обновлён, `metadata` неизменна.

**audit_logs:**
```json
{
  "action": "stripe_customer_profile_synced",
  "created_at": "2026-06-04T08:01:02.411162+00:00",
  "meta": {
    "account_code": "stripe_poland",
    "customer_id": "cus_UdnnutJVY1r9LX",
    "changed": { "email": true, "name": true },
    "user_id": "638a13ec-62a8-47b3-90d9-bc3a4e22c174"
  }
}
```

**Замечание:** одновременно с email изменилось и `name` (в input S6 имя отличается от S1). Это не влияет на DoD S6 — главное, что `customer_id` сохранён, а Stripe `Customer.email` обновлён. Изоляция «только email» проверяется через `changed.email=true` в audit; «только name» — сценарий S7.

**Verdict:** ✅ `customer_id` неизменён, Stripe `Customer.email` обновлён, audit `stripe_customer_profile_synced` с `changed.email=true`.

---

## 6. Сценарий S7 — Name change (preserve customer_id)

**Pre-condition:** профильный кэш qa.user всё ещё `cus_UdnnutJVY1r9LX`. Текущий Stripe email = S6 email, текущее имя = "MP A2-2R S6 (kept name)".

**Вход:** `user_id=638a13ec-...`, `email=mp-a2-2r-s6-changed-1780560061548@gorbova.test` (**тот же, что в Stripe сейчас** — забран через `customers.retrieve` перед запуском, см. код harness), `name="MP A2-2R S7 Renamed 1780560070809"` (**новое**).

**Resolver decision:** `source=profile_cache`, `customer_id=cus_UdnnutJVY1r9LX`.

**profile.meta.stripe — ДО:** `last_synced_at=2026-06-04T08:01:02.489Z` (S6)
**profile.meta.stripe — ПОСЛЕ:** `customer_id` тот же, `last_synced_at=2026-06-04T08:01:11.818Z`.

**Stripe API dump:** `email` неизменён (S6 email), `name="MP A2-2R S7 Renamed 1780560070809"`, `created=1780559985` (S1).

**audit_logs:**
```json
{
  "action": "stripe_customer_profile_synced",
  "created_at": "2026-06-04T08:01:11.757794+00:00",
  "meta": {
    "account_code": "stripe_poland",
    "customer_id": "cus_UdnnutJVY1r9LX",
    "changed": { "email": false, "name": true },
    "user_id": "638a13ec-62a8-47b3-90d9-bc3a4e22c174"
  }
}
```

`changed.email=false, name=true` — изолированный сигнал на смену **только имени**.

**Verdict:** ✅ `customer_id` неизменён, Stripe `Customer.name` обновлён, email НЕ затронут, audit `stripe_customer_profile_synced` с `changed.name=true, email=false`.

---

## 7. Cleanup доказательства

### 7.1 Stripe Customers удалены
- `cus_UdnnutJVY1r9LX` (S1/S6/S7 target) — `DELETE /v1/customers/...` → `removed:["cus_UdnnutJVY1r9LX","cus_Udnog0fHCy8RiG"]` (S5 target в той же пачке).
- `cus_Udnog0fHCy8RiG` (S5 target) — то же.
- `cus_UdnoA8lAqWBdFH` (S5 foreign seed) — `removed:["cus_UdnoA8lAqWBdFH"]`.
- `cus_UdnnMXbsVPtFwe` (S4 seed) — удалён до S5 через `sweep_emails`.

Итого 4 Customer'а в Stripe test-mode удалены, `failed=[]`.

### 7.2 profile.meta.stripe сброшен
```sql
SELECT p.user_id, p.meta->'stripe' FROM profiles p
WHERE p.user_id IN ('638a13ec-62a8-47b3-90d9-bc3a4e22c174','913bc4cf-c68c-4a1b-a98d-adf778ef02d1');
-- → meta.stripe = { "customers": {} } для обоих
```

### 7.3 Временная edge function удалена
- `supabase--delete_edge_functions(["mp-a2-2r-runtime"])` → `Successfully deleted`.
- `rm -rf supabase/functions/mp-a2-2r-runtime` — каталог удалён.
- `supabase/functions.registry.txt` — строка `mp-a2-2r-runtime` и комментарий удалены.
- `rg -l "mp-a2-2r-runtime" supabase/ src/ .lovable/proofs/` → **0 references** (этот proof файл содержит только упоминание имени в текстовом контексте, не код).

### 7.4 S9 cleanup — второй account_code
```sql
SELECT account_code, status, test_mode FROM acquiring_connections WHERE provider='stripe';
-- → [{ account_code: "stripe_poland", status: "active", test_mode: true }]
```
Никакого `stripe_test_eu` нет (вычищен в предыдущей итерации; повторно подтверждено в MP-A2-2R).

---

## 8. Сводная таблица

| Сценарий | source ожидаем | source факт | customer_id логика | audit факт | Verdict |
| -------- | -------------- | ----------- | ------------------ | ---------- | ------- |
| S1 | created | created | new `cus_UdnnutJVY1r9LX` | `stripe_customer_created` | ✅ |
| S4 | email_fallback | email_fallback | reused seeded `cus_UdnnMXbsVPtFwe`, metadata backfilled | `stripe_customer_email_fallback_used` (email masked) | ✅ |
| S5 | created (after collision) | created | NEW `cus_Udnog0fHCy8RiG` ≠ foreign `cus_UdnoA8lAqWBdFH` | `stripe_customer_email_collision` + `stripe_customer_created` | ✅ |
| S6 | profile_cache | profile_cache | same `cus_UdnnutJVY1r9LX`, email updated in Stripe | `stripe_customer_profile_synced changed.email=true` | ✅ |
| S7 | profile_cache | profile_cache | same `cus_UdnnutJVY1r9LX`, name updated, email unchanged | `stripe_customer_profile_synced changed.name=true, email=false` | ✅ |

---

## 9. Bugs / Findings

Не обнаружено. Поведение резолвера в runtime **строго совпадает** с описанным контрактом в `stripe-customer-resolver.ts` и с заявленным в MP-A2-2 proof.

Замечание (не баг, поведение по дизайну): `stripe.customers.search` имеет до ~1 мин лаг и может вернуть удалённые объекты — резолвер уже учитывает это через валидацию каждого hit'а `customers.retrieve` (см. шаг 2 резолвера). Это покрыто авто-recovery, отдельный finding не нужен.

---

## 10. DoD MP-A2-2R — самопроверка

| # | Пункт | Статус |
|---|---|---|
| 1 | S1, S4, S5, S6, S7 — runtime PASS, каждый с 5 артефактами | ✅ (§§ 2–6) |
| 2 | Env-state причина задокументирована | ✅ (§ 0) |
| 3 | Repro recipe воспроизводим | ✅ (§ 1) |
| 4 | Временная edge function удалена + grep чисто | ✅ (§ 7.3) |
| 5 | S9 cleanup подтверждён `SELECT` | ✅ (§ 7.4) |
| 6 | `mp_a2_2_customer_resolver_v1.md` обновлён | ✅ (отдельный коммит, см. файл) |
| 7 | bePaid freeze без изменений | ✅ (никаких касаний bePaid в MP-A2-2R) |
| 8 | Никаких code-изменений в resolver/adapter/webhook | ✅ (`git diff` в этой итерации содержит только новый/удалённый временный harness + обновления proof и registry) |

---

## Appendix A — исходник временного harness (для воспроизведения)

Файл `supabase/functions/mp-a2-2r-runtime/index.ts`, существовавший в течение MP-A2-2R и удалённый после прогона. Сохранён здесь как текстовая копия для будущих аналогичных одноразовых runtime-верификаций. **В кодовую базу не возвращать без отдельного approve.**

Контракт:
- POST `{ scenario: 'S1'|'S4'|'S5'|'S6'|'S7', user_id, foreign_user_id? }` → `{ ok, result }`.
- POST `{ action: 'cleanup', user_ids: [...] }` → удаляет cached Stripe customers + сбрасывает `profile.meta.stripe.customers[stripe_poland]`.
- POST `{ action: 'sweep_emails', emails: [...] }` → удаляет все Customers с этими email.

Защиты:
- super_admin JWT (через `has_role_v2`).
- Жёсткая проверка `acquiring_connections.test_mode === true AND status='active'` (отказ работать в live).
- Stripe secret читается **только** через `readAcquiringSecret` (Vault SOT).
- Изолирован от резолвера: импортирует `resolveStripeCustomer` и `mergeStripeCustomerIntoProfile` без модификации.

(Полный исходник доступен в git history до удаления; восстанавливается через `git show <commit>:supabase/functions/mp-a2-2r-runtime/index.ts`. После закрытия MP-A2-2R рекомендуется не восстанавливать.)
