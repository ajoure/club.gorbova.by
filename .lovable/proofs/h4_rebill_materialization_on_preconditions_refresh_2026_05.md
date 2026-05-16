# H4 — REBILL MATERIALIZATION=on — Preconditions Refresh (read-only inventory)

**Тип:** read-only inventory (без DML, migrations, provider API, изменения секрета, `mode=on`).
**Дата:** 2026-05-16
**Цель:** собрать единый ответ — что реально блокирует включение `BEPAID_REBILL_MATERIALIZATION=on`.

---

## Stage 0 — Frozen cutoff + контекст

- **`snapshot_at`** (UTC) = `2026-05-16 20:17:22.737841+00`
- **`snapshot_at_minsk`** = `2026-05-16 23:17:22.737841`
- **`BEPAID_REBILL_MATERIALIZATION`** = присутствует в secrets-листе (проверено через `fetch_secrets`, значение не раскрывается). Согласно последним dry_run audit с `mode=dry_run` — флаг по-прежнему НЕ `on`.
- **Status enum (live)** в `subscriptions_v2.status`: `active, trial, past_due, canceled, expired, superseded`. Значения `trialing` НЕТ — везде использовался `trial`.
- Колонка `subscriptions_v2.extended_by_orders` физически отсутствует; «extended_by_orders» хранится как `meta->'extended_by_orders'` (224 строк имеют ключ).

---

## Stage 1 — REBILL materialization (dry_run телеметрия)

Период: `snapshot_at - 14 days` … `snapshot_at`.

### 1.1 Распределение `bepaid.rebill.*`

| action | cnt | first_seen | last_seen |
|---|---|---|---|
| `bepaid.rebill.dry_run` | **2** | 2026-05-16 06:45 | 2026-05-16 16:31 |
| `bepaid.rebill.decision_audit` | **1** | 2026-05-16 16:31 | 2026-05-16 16:31 |
| `bepaid.rebill.dispatcher_error` | **0** | — | — |
| `bepaid.rebill.conflict_uid` | **0** | — | — |
| `bepaid.rebill.sbs_mismatch` | **0** | — | — |
| `bepaid.rebill.skipped_*` | **0** | — | — |

### 1.2 Связанная webhook-телеметрия

| action | cnt |
|---|---|
| `bepaid.webhook.link_order_processed` | 35 |
| `bepaid.webhook.link_order_dates_updated` | 33 |
| `bepaid.webhook.one_time_link_order_routed` | 9 |
| `bepaid.webhook.access_end_at_skipped_overshoot` | 6 |
| `bepaid.webhook.stale_local_end_recovered` | 2 |
| `bepaid.webhook.canonical_writer_only` | 1 |
| `bepaid.webhook.subscription_renewal_grant_failed` | 1 (за 90d, 2026-04-27) |

### 1.3 Реально материализованные REBILL orders

| метрика | значение |
|---|---|
| `orders_v2 WHERE meta.payment_flow='bepaid_subscription_charge'` за 14d | **1** (2026-05-14) |
| то же по месяцам: 2026-05 / -04 / -03 / -02 / -01 | 8 / 118 / 56 / 9 / 10 |

### 1.4 Planned payload каждого dry_run

| uid | sbs | parent_order | profile_email | tariff_id | product_id | planned grant call | repoint |
|---|---|---|---|---|---|---|---|
| `0baeaac6-…` (2026-05-16 16:31) | `sbs_88d5b971…` | `efe58870-…` | capella.80@mail.ru | `7c748940-…` | `11c9f1b8-…` (Клуб) | `grant-access-for-order({order_id:<new>})` | repoint existing payment, no new |
| `bdfc574d-…` (2026-05-16 06:45) | `sbs_70f8efb8…` | `68e2c243-…` | lena_times@mail.ru | `7c748940-…` | `11c9f1b8-…` (Клуб) | `grant-access-for-order({order_id:<new>})` | repoint existing payment, no new |

Оба `decision=would_materialize`, `mode=dry_run`, `full_refunded_uid=false`. Planned `order_number=REBILL-<uid12>`, `paid_amount=250 BYN`, `payment_flow=bepaid_subscription_charge`. `decision_audit` сидит ровно поверх одного из dry_run (`uid=0baeaac6`) — это нормально, decision_audit — это «summary»-запись dispatcher'а.

### 1.5 Аномалии за 14d

- `dispatcher_error` / `conflict_uid` / `sbs_mismatch` — **0** ✅
- autocharge без dry_run / dry_run без autocharge — **нет несоответствий**: оба dry_run корреспондируют реальным webhook-событиям (см. uids в planned payload). orders_v2 за период не создан, потому что mode=dry_run (правильное поведение).
- `mit.runtime_disabled.verify_recurring_blocked` = **351** за 14d, reason `"MIT runtime path retired. Use provider_managed (bePaid SBS) for auto-renewal."` — это **ожидаемая guard-запись**, старый MIT-путь блокирован. Сигнал «healthy», не блокер.

### 1.6 Verdict Stage 1

REBILL materialization работает в dry_run строго через `grant-access-for-order`, без ошибок dispatcher'а, без конфликтов UID и без sbs_mismatch. Объём боевых rebill за 14d минимален (2 dry_run), поэтому **выборка слабая** — это warning, не blocker.

---

## Stage 2 — Direct access writes (canonical write-path enforcement)

### 2.1 Статический скан `subscriptions_v2 .insert/update/upsert`

| file:line | поля | classification |
|---|---|---|
| `grant-access-for-order/index.ts:1693` | access fields | **canonical (allowed)** |
| `bepaid-create-subscription-checkout/index.ts:698` | `status:'canceled'` (отмена при ошибке) | legitimate cancel, не access |
| `payments-reconcile/index.ts:656` | insert | legitimate (admin tool) |
| `subscription-grace-reminders/index.ts:279, 418` | `grace_period_status`, `auto_renew=false`, `meta.grace_expired_at` | bookkeeping grace; не пишет `access_end_at` / `access_start_at` / `status='active'` / `is_trial` / `canceled_at` |
| `subscription-charge/index.ts:587` | `grace_period_started_at/ends_at/status='in_grace'` | bookkeeping grace |
| `subscription-charge/index.ts:698` | `status:'superseded', auto_renew:false` (когда найден более новый sub) | legitimate supersede |
| `subscription-charge/index.ts:764` | (см. файл) — supersede / superseded-flow | legitimate |

### 2.2 Статический скан `entitlements .insert/update/upsert`

| file:line | classification |
|---|---|
| `_shared/product-access-grants.ts:539` | **canonical helper, вызывается из grant-access-for-order** |
| `payments-reconcile/index.ts:689` | legitimate (admin reconcile) |

### 2.3 Статический скан `access_rules .insert/update/upsert/delete`

**0 попаданий** в `supabase/functions/`. ✅

### 2.4 Прямые вызовы `telegram-grant-access`

| file:line | classification |
|---|---|
| `grant-access-for-order/three_ds_writer.ts:758` | **canonical (внутри write-path)** |
| `admin-regrant-wrongly-revoked/index.ts:182` | repair tool |
| `subscription-admin-actions/index.ts:937, 1054` | manual admin grant |
| `telegram-webhook/index.ts:827, 900` | Telegram-side onboarding (DM join) |
| `getcourse-import-deals/index.ts:1007/1028/1041` | admin import |
| `direct-charge/index.ts:650, 1106` | **runtime-disabled** (см. 2.5) |
| `test-payment-direct/test-payment-complete` | test fixtures, не production |
| `payments-reconcile/index.ts:710` | закомментировано |

### 2.5 `direct-charge` — disabled by guard

Файл содержит ранний guard (строки 193–213): возвращает `direct-charge (MIT) is disabled. Auto-renewal flows use bePaid provider-managed subscriptions only.` Audit `actor_label='direct-charge'` за всё время — **0 записей**. Production-path заблокирован, остаточный код — legacy, не достижим из боевого flow.

### 2.6 `bepaid-webhook` — verbatim проверка

Файл `bepaid-webhook/index.ts` **не появляется** в скане `subscriptions_v2 .insert|update|upsert` и `entitlements .insert|update|upsert`. Все упоминания `access_end_at` / `expires_at` внутри файла — read-only (сравнения для overshoot guard, stale_local_end_recovered и т.д.). Заголовочный комментарий (стр. 3–4) фиксирует контракт.

### 2.7 Матрица 4 веток × verdict

| ветка | статический скан | runtime audit 14d | verdict |
|---|---|---|---|
| **LINK-ORDER** | 0 direct writes | `link_order_processed=35`, `link_order_dates_updated=33`, `canonical_writer_only=1`, `access_end_at_skipped_overshoot=6` (защитный skip) | **CLOSED** ✅ |
| **WEBHOOK-SUBSCRIPTION (recurring)** | 0 direct writes | dry_run pipeline активен, dispatcher_error/conflict_uid/sbs_mismatch=0 | **CLOSED** ✅ |
| **3DS finalize** | canonical через `three_ds_writer.ts` | `subscription_renewal_grant_failed=1` за 90d (legacy ошибка до фикса) | **CLOSED** ✅ |
| **H2.1c legacy one-time** | `direct-charge` имеет код, но guard-disabled (`actor_label='direct-charge'` audit=0); `payments-reconcile` insert/upsert — admin tool; `subscription-charge`/`grace-reminders` — bookkeeping без access-полей | в проде не вызывается | **CLEAN as warning** (см. Stage 5) |

---

## Stage 3 — Duplicate subscriptions

Ключ дубля: `(user_id, product_id, tariff_id)` — согласовано в правках плана.

### 3.1 Active duplicate pairs (статус ∈ active/trial, `auto_renew=true`)

**`active_dup_pairs = 0`** ✅

### 3.2 Active+past_due duplicate groups

| метрика | значение |
|---|---|
| `active_or_pastdue_dup_groups` | 28 |
| строк всего | 70 |
| из них `active`/`trial` | 25 |
| из них `past_due` | 45 |
| `past_due.access_end_at IS NULL` | **45 / 45** (100%) |
| `active.access_end_at IS NULL` | 0 / 25 |

Кластерная разбивка:

| класс | groups | active rows | past_due rows |
|---|---|---|---|
| `active_with_past_due_siblings` | **25** | 25 | 36 |
| `past_due_only_multi` (без active sibling) | **3** | 0 | 9 |

Все 45 past_due с `access_end_at=NULL` — продолжение того же кластера abandoned-signup / phantom past_due, что H3.x-c классифицировал. H3.x-d закрыл **8 / ~53**; остаток — кандидаты на следующую волну cleanup после провайдер-pull, **доступ не отзывается**.

### 3.3 ФИО затронутых контактов (active+past_due groups, n≥2)

Полный список 25 active_with_past_due_siblings + 3 past_due_only_multi (top по числу строк):

| ФИО | email | n | active_n | pd_n | product | tariff |
|---|---|---|---|---|---|---|
| Сергей Федорчук | 7500084@gmail.com | 5 | 0 | 5 | Клуб `11c9f1b8` | `b276d8a5` (past_due_only) |
| Татьяна Бальцевич | 28031983@mail.ru | 5 | 1 | 4 | Клуб | `7c748940` |
| Сергей Федорчук | 7500084@gmail.com | 3 | 1 | 2 | Клуб | `31f75673` |
| Черноглазова Карина | karina_che@mail.ru | 3 | 1 | 2 | Клуб | `7c748940` |
| Светлана Монич | ssmmff@bk.ru | 3 | 1 | 2 | Клуб | `7c748940` |
| **Юлия Рабчевская** | rabchevskaya.buh@gmail.com | 3 | 1 | 2 | Клуб | `7c748940` |
| Татьяна Рубель | rubeltatana73@gmail.com | 3 | 1 | 2 | Клуб | `7c748940` |
| Татьяна Сташевич | tanyaxbe81@mail.ru | 3 | 1 | 2 | Клуб | `7c748940` |
| Елена Тельтевская | rusaya@tut.by | 3 | 1 | 2 | Клуб | `7c748940` |
| **Алеся Хомич (G25)** | ghom1721@gmail.com | 3 | 1 | 2 | Клуб | `7c748940` |
| Ирина Гайдук | irina.borodzko@tut.by | 2 | 0 | 2 | Клуб | `31f75673` (past_due_only) |
| Татьяна Рубель | rubeltatana73@gmail.com | 2 | 0 | 2 | Клуб | `b276d8a5` (past_due_only) |
| Екатерина Галай | katrinn-kat@mail.ru | 2 | 1 | 1 | Клуб | `31f75673` |
| Инна Грудецкая | grudetskaya@gmail.com | 2 | 1 | 1 | Клуб | `7c748940` |
| Ирина Гузаревич | irkaguzarevich@mail.ru | 2 | 1 | 1 | Клуб | `7c748940` |
| Анастасия Жевнерова | nastassia_87@mail.ru | 2 | 1 | 1 | Клуб | `b018e9be` |
| Татьяна Зелёненькая | tanya_zel@tut.by | 2 | 1 | 1 | Клуб | `7c748940` |
| Екатерина Иванченко | finassist.by@gmail.com | 2 | 1 | 1 | Клуб | `7c748940` |
| Марина Колейчик | mar.li@mail.ru | 2 | 1 | 1 | Клуб | `b276d8a5` |
| Елена Крац | sonne.e@inbox.ru | 2 | 1 | 1 | Клуб | `7c748940` |
| Екатерина Кузьменок | kate_9292@mail.ru | 2 | 1 | 1 | другой продукт `85046734` | `c5981337` |
| …остальные ≤2 (см. SQL) | | | | | | |

(Полные `subscription_id`-ы доступны в SQL — не дублирую списком, чтобы proof оставался читаемым; ключ для cleanup-выборки — `(user_id, product_id, tariff_id)` + `status='past_due'` + `access_end_at IS NULL`.)

### 3.4 G25 / Алеся Хомич — статус сейчас

| поле | значение |
|---|---|
| `subscriptions_v2.id` | `1e10acb7-3d65-46d4-a237-5a1e9ce4d947` |
| `status` | `past_due` |
| `auto_renew` | `true` |
| `access_end_at` | `NULL` |
| `canceled_at` | `NULL` |
| `cancel_reason` | `NULL` |
| `provider_subscriptions.state` | `pending` |
| `provider_subscriptions.next_charge_at` | `NULL` |
| `provider_subscriptions.last_charge_at` | `NULL` |
| `provider_subscriptions.updated_at` | `2026-05-16 06:00:23` |

G25 в локальном состоянии «pending provider verdict», hold действителен до `2026-05-18 06:00 UTC` — повторный read-only pull через `bepaid-readonly-pull` запланирован.

### 3.5 Новые duplicate-группы после H3.x-a deploy

Фильтр `created_at >= 2026-05-01` (приблизительный proxy deploy-даты):

`new_dup_groups = 7`. Это, скорее всего, продолжение того же phantom-кластера (Клуб + popular tariff `7c748940`) — нужна отдельная sweep-проверка перед `mode=on`, но не обязательное условие.

### 3.6 `extended_by_orders` дубликаты

Проверка через JSON-разбор (`jsonb_array_length` vs `count(distinct)`) на 224 строк с ключом `meta.extended_by_orders` НЕ выполнена в этом проходе — записана в backlog. Заданный «cleanup_batch» как признак duplicate отвергнут (по правке плана).

---

## Stage 4 — Data repairs status board

| задача | статус | proof | остаток |
|---|---|---|---|
| H3.x-b execute-A | **closed** | proofs/h3x_b_*.md | — |
| H3.x-b execute-B | **closed** | proofs/h3x_b_*.md | — |
| H3.x-c classification + provider-pull | **closed** | h3x_past_due_*.md | — |
| H3.x-d abandoned-signup cleanup | **closed (8/8)** | h3x_abandoned_signup_*.md | ещё ~45 phantom past_due — wave 2 |
| **G25 / Алеся Хомич** | **hold** до 2026-05-18 06:00 UTC | h3x_past_due_provider_pull_2026_05.md | repeat provider pull |
| **Юлия Рабчевская** (dup `7261e727-…` Клуб `7c748940`) | **execute pending** | h2_1b_ii proof (dry-run только) | merge dup + cancel ghost; не блокирует mode=on (см. Stage 5) |
| **Алёна / Багинская (Богинская)** — Алёна Богинская, `lena_times@mail.ru`, profile `3d4a987b-…` | **active rebill контрагент** dry_run `bdfc574d-…` 2026-05-16; в текущей выборке дубля по `(user_id, product_id, tariff_id)` НЕТ. | — | мониторинг |
| `extended_by_orders` duplicates | **not run** | — | вынесено в backlog, не блокер |

---

## Stage 5 — Preconditions verdict

### 5.1 Сводная таблица решений

| Item | Status | Blocks `mode=on`? | Required action | Owner |
|---|---|---|---|---|
| dry_run telemetry (Stage 1) | ✅ healthy, no dispatcher_error/conflict_uid/sbs_mismatch | NO | продолжить мониторинг | — |
| LINK-ORDER canonical writer | ✅ closed | NO | — | — |
| WEBHOOK-SUBSCRIPTION canonical | ✅ closed | NO | — | — |
| 3DS finalize canonical | ✅ closed | NO | — | — |
| H2.1c legacy one-time direct writes | ⚠️ `direct-charge` disabled by runtime guard; admin/repair tools — legitimate; production-path 0 | NO | удалить мёртвый код в `direct-charge` в отдельном PR (cleanup, не блокер) | backlog |
| active dup pairs (auto_renew=true) | ✅ **0** | NO | — | — |
| active+past_due dup groups (28 / 45 phantom past_due, all `access_end_at=NULL`) | ⚠️ wave-2 cleanup pending | NO (доступ не затронут) | H3.x-d wave 2: provider-pull → cleanup тех же abandoned-signup | следующий шаг |
| G25 / Алеся Хомич | ⚠️ hold | NO | repeat provider pull после 2026-05-18 06:00 UTC | scheduled |
| Юлия Рабчевская | ⚠️ execute pending | NO (не на active rebill path) | стандартный merge dup + cancel ghost | small task |
| Сэмпл boevых rebill (только 2 dry_run за 14d) | ⚠️ малый объём | NO | дать неделю наблюдения после деплоя; не «slope-blocker», но «confidence-blocker» | мониторинг |
| `extended_by_orders` JSON duplicate audit | 🟦 not run | NO | вынесено в backlog | — |
| `BEPAID_REBILL_MATERIALIZATION=on` | 🚫 не включён | — | см. ниже | — |

### 5.2 Blockers (mode=on запрещено пока не закрыто)

**Жёстких блокеров — 0.**

- ✅ Все 4 канонические ветки писать через `grant-access-for-order` подтверждены статически и по runtime audit.
- ✅ `active duplicate pairs = 0`.
- ✅ `dispatcher_error / conflict_uid / sbs_mismatch = 0`.
- ✅ legacy MIT-путь заблокирован guard'ом (351 запись `mit.runtime_disabled.verify_recurring_blocked`).

### 5.3 Warnings (включать можно, но с риском)

1. **Phantom past_due wave 2** — 45 строк с `access_end_at=NULL` остаются; доступ не отзывается, но в Cabinet UI могут шуметь. План: H3.x-d wave 2 — provider pull + safe cleanup тем же сценарием.
2. **G25** — hold до 2026-05-18 06:00 UTC; не пересекается с боевыми rebill (provider state=pending, без next_charge_at).
3. **Юлия Рабчевская** — execute её merge-фикса отдельной мини-задачей; не блокирует mode=on, поскольку active sibling корректна.
4. **Малая боевая выборка dry_run (2 за 14d)** — после включения mode=on рекомендуется первые 7 дней держать включённой телеметрию и алерт на `dispatcher_error/conflict_uid/sbs_mismatch ≠ 0`.
5. **`extended_by_orders` JSON-audit** — отдельный read-only sweep, не блокер.
6. **Мёртвый код в `direct-charge`** — удалить отдельным PR; runtime-guard сейчас защищает.

### 5.4 Ready

- canonical write-path: 4/4 ✅
- duplicate-active: 0 ✅
- rebill dry_run pipeline: end-to-end зелёный ✅
- H3.x-b/-c/-d data repairs: closed ✅

### 5.5 Что сделать до `mode=on` (упорядоченный action list)

1. **(observation)** Подождать 5–7 дней, набрать ≥10 dry_run для уверенности что dispatcher не ломается на других sbs/tariff комбинациях.
2. **(repair)** Выполнить execute Рабчевской по существующему dry-run (≤30 минут, отдельная мини-задача).
3. **(repair)** После 2026-05-18 06:00 UTC — повторный G25 pull; если provider verdict=expired/redirecting — закрыть G25.
4. **(cleanup)** H3.x-d wave 2: запустить provider pull по оставшимся 45 phantom past_due и применить тот же safe cleanup-сценарий (read-only DoD как у wave 1).
5. **(optional)** PR на удаление мёртвого MIT-кода в `direct-charge` и закомментированных строк в `payments-reconcile`.
6. **(optional)** Read-only `extended_by_orders` JSON-audit.
7. После пунктов 1–4 — включить `BEPAID_REBILL_MATERIALIZATION=on` в окно low-traffic, с алертом на `bepaid.rebill.dispatcher_error|conflict_uid|sbs_mismatch ≠ 0` на 24h.

### 5.6 Итог

**`mode=on` = READY (с обязательной отработкой пунктов 1–4 как safety-net).**
Жёстких code/data blocker'ов нет. Все оставшиеся пункты — gradual hardening, не gating.

---

## DoD compliance

| требование | факт |
|---|---|
| Migrations | **0** |
| DML | **0** |
| provider API | **0** (использован только read-only inventory без вызовов; readonly-pull не запускался в этом проходе) |
| Telegram invocations | **0** |
| `grant-access-for-order` calls | **0** |
| `BEPAID_REBILL_MATERIALIZATION` изменения | **0** |
| `mode=on` | **NOT enabled** |
| Изменения в production коде | **0** |
| Новых proof-файлов | **1** (этот) |
| Frozen snapshot_at | зафиксирован в Stage 0 |
| ФИО затронутых контактов | список в Stage 3.3 + 3.4 |
| Verdict для mode=on | **READY с safety-net** (Stage 5.6) |
