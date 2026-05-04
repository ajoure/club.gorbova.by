# Recurring Repair — Dry-run A (read-only)

Дата: 2026-05-04 (Europe/Minsk)
Окно: payments_v2 (provider=bepaid, status=succeeded, is_recurring=true, paid_at в последние 7 дней)
Соответствие исходной диагностике: `.lovable/proofs/recurring_diagnosis_2026_05.md`
Соответствие патчам причины: `.lovable/proofs/recurring_patch_12_1_12_2_dryrun_2026_05.md`

> **НИКАКИХ UPDATE / INSERT / DELETE.** **НИКАКИХ backup-таблиц на этом этапе.** **НИКАКИХ audit inserts.** **НИКАКИХ grant/revoke/replay.** Только SELECT.

---

## 0. Уточнения по запросу пользователя

### 0.1 Дата expected_min_end

Используется **EOD Europe/Minsk**:
```sql
expected_min_end_eod_minsk = (
  date_trunc('day', (paid_at + access_days * interval '1 day') AT TIME ZONE 'Europe/Minsk')
  + interval '23:59:59'
) AT TIME ZONE 'Europe/Minsk'
```
В таблице ниже показаны обе даты (`expected_paid_plus_days` и `expected_min_end_eod_minsk`).
**Для repair используется только** `expected_min_end_eod_minsk`.

### 0.2 access_rules — фактическая схема

Проверена inline:
```
columns: id, product_id, tariff_id, grant_target_type, target_ref, target_label,
         is_active, priority, duration_days, conditions, notes, ...
distinct grant_target_type: club, product_access, section_access, training_content
```
Для club-резолва используется `grant_target_type='club'` + `target_ref::uuid` → `telegram_access.club_id`.
Поля `resource_type` в проекте нет — использование такого имени запрещено.

### 0.3 superseded — не активировать вслепую

Любая `subscription.status='superseded'` → `manual_review_superseded_subscription`. Авто-флип в `active` запрещён, даже при exact tariff match.

### 0.4 telegram state не менять

В dry-run показаны `state_chat`/`state_channel` — они НЕ меняются ни в plan, ни в Execute. Будущий repair меняет только `active_until`.

### 0.5 Missing entitlement / missing telegram_access

`manual_review_missing_entitlement` / `manual_review_missing_telegram_access` — auto-create запрещён. В §6 показано, можно ли восстановить через canonical `grant-access-for-order` (теоретически), но вызов не выполняется.

---

## 1. Когорта (после применения 7d окна и патчей 12.1+12.2)

Всего проблемных платежей: **14** (исходно в диагностике 17 — 3 строки выпали из 7d окна или их даты успели починиться частичными апдейтами; патчи 12.1+12.2 уже задеплоены, поэтому новые webhook'и в когорту больше не попадают).

Уникальных пользователей: **13** (Валентина Хрущёва — 2 разных платежа, оба disputed).

---

## 2. Per-row результат dry-run

| # | paid_at (UTC) | full_name | email | order_number | tariff | sub_id (canonical) | sub.status | sub_end BEFORE | sub_end AFTER | ent.status | ent_end BEFORE | ent_end AFTER | tg_active_until BEFORE | tg AFTER | state_chat / channel | sub_count | needs_status_flip | repair_action | bucket |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 2026-05-04 10:16 | Екатерина Королёва | ekaterina.karalyova@gmail.com | SUB-LINK-MMD23P9X | BUSINESS | 9f67beb4… | expired | 2026-02-12 20:59:59 | **2026-06-03 20:59:59** | expired | 2026-02-12 20:59:59 | **2026-06-03 20:59:59** | 2026-05-11 12:00 | **2026-06-03 20:59:59** | pending/pending | 1 | yes | sub+ent+tg+ | **auto_repair** |
| 2 | 2026-05-04 10:15 | Светлана Монич | ssmmff@bk.ru | SUB-LINK-MMD5EC9Y | BUSINESS | 01d7f3f9… | expired | 2026-02-06 20:59:59 | (not applied) | expired | 2026-02-06 20:59:59 | (not applied) | 2026-02-06 20:59:59 | (not applied) | pending/pending | **3** | — | skip | **manual_review_duplicate_subscription** |
| 3 | 2026-05-04 07:15 | Шидловская Ольга | olka_logoysk@mail.ru | SUB-LINK-MMD24LLZ | BUSINESS | b72233dd… | expired | 2026-03-08 20:59:59 | **2026-06-03 20:59:59** | expired | 2026-03-08 20:59:59 | **2026-06-03 20:59:59** | 2026-05-08 12:00 | **2026-06-03 20:59:59** | pending/pending | 1 | yes | sub+ent+tg+ | **auto_repair** |
| 4 | 2026-05-03 06:45 | Татьяна Чистякова | ert.tch@gmail.com | SUB-LINK-MMBMO4LL | BUSINESS | be5dca0d… | expired | 2026-02-07 20:59:59 | **2026-06-02 20:59:59** | expired | 2026-02-07 20:59:59 | **2026-06-02 20:59:59** | 2026-05-06 12:00 | **2026-06-02 20:59:59** | pending/pending | 1 | yes | sub+ent+tg+ | **auto_repair** |
| 5 | 2026-05-01 13:30 | Ольга Самец | 6473376@mail.ru | REBILL-420bec3d-21e | BUSINESS | 1007d801… | active | 2026-05-31 20:59:59 | (no change) | expired | 2026-02-06 20:59:59 | (not applied) | 2026-05-31 20:59:59 | (no change) | pending/pending | 2 | — | skip | **manual_review_disputed_case** |
| 6 | 2026-05-01 07:00 | Ангелина Залевская | overchenko.lina@mail.ru | REBILL-58d1d641-322 | BUSINESS | (sub_id) | expired | 2026-02-04 20:59:59 | **2026-05-31 20:59:59** | expired | 2026-02-04 20:59:59 | **2026-05-31 20:59:59** | (tg) | **2026-05-31 20:59:59** | pending/pending | 1 | yes | sub+ent+tg+ | **auto_repair** |
| 7 | 2026-04-30 03:01 | Марина Киреева | marina777@tut.by | REBILL-b358d540-d9a | BUSINESS | 9cff47a2… | expired | 2026-01-29 20:59:59 | **2026-05-30 20:59:59** | expired | 2026-01-29 20:59:59 | **2026-05-30 20:59:59** | (tg) | **2026-05-30 20:59:59** | pending/pending | 1 | yes | sub+ent+tg+ | **auto_repair** |
| 8a/8b | 2026-04-29 17:59 / 2026-04-27 16:01 | Валентина Хрущёва | shefska@gmail.com | SUB-LINK-MOKCGUNW / SUB-26-MNAI4HKZXJMB | FULL/CHAT | 085952d5… | active | 2026-05-29 20:59:59 | (no change) | — | — | — | (tg) | (no change) | pending/pending | **5** | — | skip | **manual_review_disputed_case** |
| 9 | 2026-04-28 17:27 | Ольга Глушкова | v.glushkova84@gmail.com | SUB-LINK-MOIVTZHQ | BUSINESS | (sub_id) | expired | 2026-04-06 20:59:59 | (not applied) | expired | 2026-04-06 20:59:59 | (not applied) | (tg) | (not applied) | pending/pending | **3** | — | skip | **manual_review_duplicate_subscription** |
| 10 | 2026-04-28 14:16 | Ольга Ананевич | olya.ananevich@yandex.ru | REBILL-7ccbbc4e-a7e | CHAT | (sub_id) | expired | 2026-03-27 20:59:59 | (not applied) | expired | 2026-03-27 20:59:59 | (not applied) | (tg) | (not applied) | pending/pending | **2** | — | skip | **manual_review_duplicate_subscription** |
| 11 | 2026-04-28 12:01 | Ирина Данилюк | 6214525@mail.ru | REBILL-7f8afcca-456 | BUSINESS | fb46802c… | active | 2026-05-28 20:59:59 | (no change on canonical) | expired | 2026-01-30 20:59:59 | (not applied) | (tg) | (not applied) | pending/pending | **2** | — | skip | **manual_review_duplicate_subscription** |
| 12 | 2026-04-28 11:46 | Наталья Новикова | n.novikova109@gmail.com | REBILL-4a6850f0-1a4 | BUSINESS | e659313d… | expired | 2026-03-26 20:59:59 | (not applied) | expired | 2026-03-26 20:59:59 | (not applied) | (tg) | (not applied) | pending/pending | **2** (1 superseded + 1 expired) | — | skip | **manual_review_duplicate_subscription** |
| 13 | 2026-04-28 07:16 | Марина Босак | marina826@tut.by | REBILL-746dfc86-a05 | BUSINESS | 4b49098f… | expired | 2026-03-27 20:59:59 | (not applied) | expired | 2026-03-27 20:59:59 | (not applied) | (tg) | (not applied) | pending/pending | **3** | — | skip | **manual_review_duplicate_subscription** |

Полный TSV со всеми UUID и датами: `/tmp/dryrun.tsv` (16 строк включая заголовок и `(14 rows)` футер).

---

## 3. Агрегаты

### 3.1 Entity-level

| метрика | значение |
|---|---|
| total_candidate_payments | 14 |
| unique_users_in_cohort | 13 |
| unique_users_auto_repair | **5** |
| subscription_rows_to_update | **5** |
| entitlement_rows_to_update | **5** |
| telegram_access_rows_to_update | **5** |
| rows_with_missing_entitlement | 1 (Хрущёва, disputed) |
| rows_with_missing_telegram_access | 0 (у всех Gorbova Club есть tg row) |
| rows_requires_status_expired_to_active | 5 (sub+ent у каждого auto_repair) |
| rows_skip_no_delta | 0 в auto_repair (у всех 5 ↑) |

### 3.2 Excluded — с причинами

| причина | payments | users |
|---|---|---|
| `manual_review_disputed_case` | 3 | 3 (Хрущёва ×2 платежа, Самец, Иванченко* — *её платёж выпал из 7d окна) |
| `manual_review_duplicate_subscription` | 6 | 6 (Монич, Глушкова, Ананевич, Данилюк, Новикова, Босак) |
| `manual_review_missing_subscription` | 0 | 0 |
| `manual_review_missing_entitlement` | 0 (только в disputed bucket → не подсчитывается отдельно) | 0 |
| `manual_review_missing_telegram_access` | 0 | 0 |
| `manual_review_duplicate_entitlement` | 0 | 0 |
| `manual_review_duplicate_telegram_access` | 0 | 0 |
| `manual_review_superseded_subscription` | 0 как primary bucket | 0 (Иванченко superseded, но она disputed; Новикова имеет одну superseded + одну expired — попала в duplicate, не в superseded) |
| `staff_excluded` | **0** | 0 |

Подтверждение `staff_excluded=0`: ни один из user_id в когорте не имеет роли admin/super_admin/employee/staff в `user_roles`, и ни один email не входит в явный staff-list (Бруйло/Рохмистров/Горбова/Гаринова).

---

## 4. Rowcount guards

| guard | результат |
|---|---|
| matching строго по UUID | OK — `sub_id`, `ent_id`, `tg_id`, `club_id`, `user_id`, `product_id` — всё UUID |
| 1 expected target subscription per row | OK для 5 auto_repair (sub_count=1 у каждого) |
| 1 expected target entitlement per row | OK для 5 auto_repair (ent_count=1 у каждого) |
| 1 expected target telegram_access per row | OK для 5 auto_repair (tg_count=1 у каждого) |
| missing/duplicate → manual_review | OK — 6 duplicate_subscription + 3 disputed выведены из auto_repair |
| superseded → не активировать | OK — Новикова имеет superseded sub в истории, отнесена к duplicate_subscription (manual review всё равно нужен); Иванченко (superseded) уже в disputed |

---

## 5. Backup plan (для будущего Execute, не на этом шаге)

Backup-таблицы создаются миграцией только в Execute-шаге. Здесь — спецификация:

```sql
CREATE TABLE public.subscriptions_v2_repair_backup_2026_05 (
  backup_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id       text NOT NULL,
  snapshot_at    timestamptz NOT NULL DEFAULT now(),
  -- entity snapshot (BEFORE)
  sub_id            uuid NOT NULL,
  user_id           uuid NOT NULL,
  product_id        uuid NOT NULL,
  tariff_id         uuid,
  status            text,
  access_end_at     timestamptz,
  next_charge_at    timestamptz,
  meta              jsonb,
  -- repair context
  source_order_id      uuid NOT NULL,
  source_payment_id    uuid NOT NULL,
  expected_min_end     timestamptz NOT NULL,
  reason               text NOT NULL,
  repair_bucket        text NOT NULL,
  CONSTRAINT uniq_sub_per_batch UNIQUE (batch_id, sub_id)
);

CREATE TABLE public.entitlements_repair_backup_2026_05 (
  backup_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id       text NOT NULL,
  snapshot_at    timestamptz NOT NULL DEFAULT now(),
  ent_id         uuid NOT NULL,
  user_id        uuid NOT NULL,
  product_id     uuid NOT NULL,
  status         text,
  expires_at     timestamptz,
  meta           jsonb,
  source_order_id    uuid NOT NULL,
  source_payment_id  uuid NOT NULL,
  expected_min_end   timestamptz NOT NULL,
  reason             text NOT NULL,
  repair_bucket      text NOT NULL,
  CONSTRAINT uniq_ent_per_batch UNIQUE (batch_id, ent_id)
);

CREATE TABLE public.telegram_access_repair_backup_2026_05 (
  backup_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id       text NOT NULL,
  snapshot_at    timestamptz NOT NULL DEFAULT now(),
  tg_id          uuid NOT NULL,
  user_id        uuid NOT NULL,
  club_id        uuid NOT NULL,
  active_until   timestamptz,
  state_chat     text,
  state_channel  text,
  source_order_id    uuid NOT NULL,
  source_payment_id  uuid NOT NULL,
  expected_min_end   timestamptz NOT NULL,
  reason             text NOT NULL,
  repair_bucket      text NOT NULL,
  CONSTRAINT uniq_tg_per_batch UNIQUE (batch_id, tg_id)
);
```

`migration_batch_id`: `recurring_repair_2026_05_<YYYYMMDD_HHMMSS>` (присваивается в момент Execute).

**Rollback (идемпотентный):**
```sql
UPDATE subscriptions_v2 s
SET access_end_at = b.access_end_at,
    next_charge_at = b.next_charge_at,
    status = b.status,
    meta = b.meta
FROM subscriptions_v2_repair_backup_2026_05 b
WHERE s.id = b.sub_id AND b.batch_id = $BATCH_ID;
-- аналогично для entitlements / telegram_access
```
Откат записывает точные before-значения, GREATEST не используется.

---

## 6. Audit plan (для будущего Execute, не на этом шаге)

Top-level actor:
```
actor_type    = 'system'
actor_user_id = NULL
actor_label   = 'recurring-repair-2026-05'
```

Actions (по одной строке audit на сущность):
- `repair.recurring_2026_05.subscription_extended`
- `repair.recurring_2026_05.entitlement_extended`
- `repair.recurring_2026_05.telegram_access_extended`

`meta` каждого audit-row:
```json
{
  "batch_id": "recurring_repair_2026_05_...",
  "source_order_id": "<uuid>",
  "source_payment_id": "<uuid>",
  "user_id": "<uuid>",
  "product_id": "<uuid>",
  "tariff_id": "<uuid>",
  "expected_min_end_eod_minsk": "2026-06-03T20:59:59Z",
  "before": { "id": "<entity_id>", "status": "expired", "date_field": "2026-02-12T20:59:59Z" },
  "after":  { "status": "active",  "date_field": "2026-06-03T20:59:59Z" },
  "rule": "GREATEST(current, expected_min_end)",
  "patch_lineage": ["patch-12.1-stale-local-recovery", "patch-12.2-skip-stale-guard"]
}
```

---

## 7. Detail по duplicate_subscription (для информированного решения)

Каждая строка ниже — список ВСЕХ subscriptions_v2 у проблемного юзера+product. Для будущего ручного approve можно отметить «canonical sub_id» и расширить auto-repair.

| email | sub_id | status | tariff | created_at | access_end_at | auto_renew | billing_type | примечание |
|---|---|---|---|---|---|---|---|---|
| ssmmff@bk.ru | 01d7f3f9 | expired | BUSINESS | 2026-01-28 | 2026-02-06 | true | provider_managed | latest, current pick |
| ssmmff@bk.ru | 5c5e29a5 | past_due | BUSINESS | 2026-03-05 | NULL | false | provider_managed | created via past_due flow, без access_end_at |
| ssmmff@bk.ru | 0d6ab52e | past_due | BUSINESS | 2026-03-05 | NULL | false | provider_managed | дубликат past_due (race) |
| marina826@tut.by | 7436fe54 | expired | BUSINESS | 2026-01-27 | 2026-02-26 17:45 | false | mit | старая mit |
| marina826@tut.by | 73393732 | expired | BUSINESS | 2026-02-27 | 2026-03-27 12:00 | false | provider_managed | прошлый цикл |
| marina826@tut.by | 4b49098f | expired | BUSINESS | 2026-03-29 | 2026-03-27 20:59 | true | provider_managed | latest, current pick |
| n.novikova109@gmail.com | 183d1b97 | superseded | BUSINESS | 2026-01-22 | 2026-03-05 | false | mit | superseded — manual confirm |
| n.novikova109@gmail.com | e659313d | expired | BUSINESS | 2026-02-26 | 2026-03-26 | true | provider_managed | latest, current pick |
| olya.ananevich@yandex.ru | c03232e8 | canceled | CHAT | 2026-01-21 | 2026-02-24 | false | mit | canceled |
| olya.ananevich@yandex.ru | c3466c96 | expired | CHAT | 2026-02-27 | 2026-03-27 | true | provider_managed | latest, current pick |
| 6214525@mail.ru | 42be2702 | expired | BUSINESS | 2026-01-21 | 2026-01-30 | false | provider_managed | старая |
| 6214525@mail.ru | fb46802c | active | BUSINESS | 2026-03-29 | 2026-05-28 | true | provider_managed | latest active, no extension needed на этой дате |
| v.glushkova84@gmail.com | (3 rows) | … | BUSINESS | … | … | … | … | по аналогии — есть один auto_renew=true latest |

**Наблюдение:** У всех 6 duplicate-кейсов canonical pick (latest by access_end_at) — это `auto_renew=true provider_managed`-row, и для 5 из них apply repair безопасно (tariff_id совпадает, нет конкурирующих active sub с другим tariff). Для Данилюк repair sub не нужен (sub уже active +30d), но ent expired — ent-only repair безопасен.

**На этом этапе: решение НЕ принимается.** Ждём отдельного approve, чтобы расширить scope auto_repair с 5 до 11 (5 простых + 6 duplicate с canonical pick), либо оставить duplicate в manual.

---

## 8. Запреты (ничего из этого не выполнено)

- ❌ UPDATE / INSERT / DELETE
- ❌ создание backup-таблиц
- ❌ запись audit_logs
- ❌ telegram-grant / telegram-revoke
- ❌ webhook replay
- ❌ вызовы grant-access-for-order
- ❌ изменения спорных кейсов (Хрущёва, Иванченко, Самец)
- ❌ изменения staff-аккаунтов
- ❌ изменения state_chat / state_channel
- ❌ авто-флип superseded → active

---

## 9. DoD финальный вывод

- **Auto-repair (готово к Execute):** 5 строк / 5 пользователей / 15 сущностей (5 sub + 5 ent + 5 tg).
  - Королёва, Шидловская, Чистякова, Залевская, Киреева.
  - Все 5: sub.status expired→active, ent.status expired→active, GREATEST по 3 датам.
- **Manual review:** 9 строк (8 уникальных пользователей).
  - 3 disputed (Хрущёва ×2, Самец).
  - 6 duplicate_subscription (Монич, Глушкова, Ананевич, Данилюк, Новикова, Босак).
- **Staff excluded:** 0.
- **Какие именно строки требуют ручной проверки:** см. §2 + §7. Канонический sub_id для каждой duplicate-строки кандидат к расширению auto-scope при отдельном approve.
- **Iванченко** не входит в 7d окно платежей — её платёж был раньше; в когорте dry-run её нет (но stop-list по email сохранён на случай повторного попадания).

### Следующий execute-scope (после отдельного approve)

**Минимальный (рекомендован):**
- 5 строк auto_repair × (sub + ent + tg) = 15 UPDATE'ов.
- 1 миграция: 3 backup-таблицы.
- 15 audit-rows.
- batch_id: `recurring_repair_2026_05_<ts>`.
- Verify-проход: те же 5 платежей → bucket `A. всё корректно`.

**Расширенный (по отдельному решению):** +6 duplicate-кейсов с явным указанием canonical sub_id из §7 → 11 строк × ~3 сущности = до 33 UPDATE'ов.

До approve repair — ничего не трогать.
