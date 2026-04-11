да, согласен, с учетом правок:

&nbsp;

1. Добавь в PATCH 1 явный owner для telegram_access.active_until.  
Сейчас план правильно описывает риск false revoke, но не фиксирует, кто именно обновляет это поле при renewal.  
Нужно одно из двух:

&nbsp;

&nbsp;

&nbsp;

- либо webhook inline обновляет telegram_access.active_until вместе с subscriptions_v2.access_end_at и entitlements.expires_at;
- либо отдельно доказать, почему это поле может оставаться stale и система всё равно считается корректной.  
Пока это не доказано, Telegram-path считается закрытым не полностью.

&nbsp;

&nbsp;

&nbsp;

2. Убери оценку ~15 активных SUB-LINK подписок и замени на точный dry-run report:

&nbsp;

&nbsp;

&nbsp;

- exact count;
- exact list ids;
- exact segmentation по типам расхождений.  
Нужны числа, а не приблизительная оценка.

&nbsp;

&nbsp;

&nbsp;

3. Нормализуй названия path/tracking-format строго по фактическим строкам из кода.  
Сейчас в тексте местами смешиваются link_order, link:order:{UUID}, link:{UUID} как смысловые ярлыки.  
Нужно единообразно:

&nbsp;

&nbsp;

&nbsp;

- фактический формат tracking_id;
- branch / handler;
- create/reuse order;
- initial/renewal поведение.  
Без свободного переименования.

&nbsp;

&nbsp;

&nbsp;

4. В broken cohort report добавь 4 отдельные оси проблемы, а не один общий список:

&nbsp;

&nbsp;

&nbsp;

- stale subscriptions_v2.access_end_at;
- stale entitlements.expires_at;
- stale telegram_access.active_until;
- missing / stale GetCourse sync.  
Итоговый отчет должен показывать:
- сколько записей только с проблемой дат подписки;
- сколько только с entitlement;
- сколько с Telegram;
- сколько с GC;
- сколько комбинированных кейсов.

&nbsp;

&nbsp;

&nbsp;

5. По GetCourse добавь жёсткий антидубль блок.  
Недостаточно написать «вызвать sendToGetCourse».  
Нужно указать:

&nbsp;

&nbsp;

&nbsp;

- откуда берётся canonical gc_offer_id;
- при каких условиях renewal должен слать GC sync;
- как избежать повторной отправки / дублей;
- какой audit / meta proof подтверждает, что sync реально произошёл.

&nbsp;

&nbsp;

&nbsp;

6. Добавь отдельный раздел «Все callsites создания/обновления access после денег» с grep-proof.  
Не только webhook handlers, а вообще все места, где после денег или около денег меняются:

&nbsp;

&nbsp;

&nbsp;

- subscriptions_v2;
- entitlements;
- Telegram access;
- GetCourse sync;
- access_grant_ledger.  
Нужно доказать, что после патча не остаётся второго старого path с другой логикой.

&nbsp;

&nbsp;

&nbsp;

7. В PATCH 2 repair раздели на preview → execute максимально жёстко:

&nbsp;

&nbsp;

&nbsp;

- preview: exact cohort + before-state;
- execute: только stale rows;
- after-state: exact before/after proof по каждой записи;
- отдельный audit для repair-path.  
Никаких массовых blind updates.

&nbsp;

&nbsp;

&nbsp;

8. В DoD добавь отдельные обязательные proof-пункты:

&nbsp;

&nbsp;

&nbsp;

- сразу после успешного webhook link-order renewal обновлены subscriptions_v2.access_end_at;
- сразу обновлены entitlements.expires_at;
- сразу обновлён Telegram owner-field (telegram_access.active_until) или отдельно доказано, почему он не нужен;
- сразу выполнен GC sync или отдельно доказано, что для данного кейса он не нужен;
- UI показывает активный доступ без ожидания sync/cron;
- нет дубля выдачи и нет ложного revoke.

&nbsp;

&nbsp;

&nbsp;

9. Добавь блок «не использовать legacy-коды как source of truth».  
В этом плане и в исполнении всё должно быть через:

&nbsp;

&nbsp;

&nbsp;

- product_id;
- tariff_id;
- order_id;
- subscription_v2_id;
- provider_subscription_id.  
Без опоры на старые буквенные обозначения как на бизнес-ключ.

&nbsp;

&nbsp;

&nbsp;

10. В follow-up backlog добавь ещё один обязательный пункт:  
вынести общий post-payment renewal/update helper, чтобы subv2 и PATCH-LINK не жили с ручной 1:1 parity в двух местах бесконечно.  
Иначе после этого патча снова появится расхождение.

&nbsp;

&nbsp;

Присылай его обновлённый план.

&nbsp;

# Полная карта платёжных путей + устранение задержки обновления доступа

## Scope

**Часть 1:** Полная инвентаризация всех путей: деньги → заказ → подписка → entitlement → Telegram → GetCourse → revoke/sync.
**Часть 2:** Execution: PATCH 1 (runtime fix) + PATCH 2 (broken cohort repair).

---

## ЧАСТЬ 1: ПОЛНАЯ ИНВЕНТАРИЗАЦИЯ ВСЕХ ПУТЕЙ

### 1A. Money ingress → order creation → access issuance → side-effects

```text
┌───┬─────────────────────────┬───────────────────────────┬──────────────────────────┬────────────────┬────────────────┬────────────────┬─────────┬────────────┬─────────────────┬──────────────────────┐
│ # │ Ingress path            │ Tracking/source           │ Кто создаёт order        │ sub.access_end │ ent.expires_at │ grant-access?  │ TG      │ GC         │ Skip/lag/race   │ Owner дат            │
├───┼─────────────────────────┼───────────────────────────┼──────────────────────────┼────────────────┼────────────────┼────────────────┼─────────┼────────────┼─────────────────┼──────────────────────┤
│ 1 │ subv2 initial           │ subv2:{sub}:order:{id}    │ create-payment-checkout  │ INLINE (1521)  │ INLINE (1585)  │ Да (secondary) │ via GA  │ INLINE(1733)│ НЕТ            │ Webhook inline       │
│ 2 │ subv2 renewal           │ subv2:{sub}:order:{id}    │ Reuses existing          │ INLINE         │ INLINE GREATEST│ Да (secondary) │ via GA  │ INLINE     │ НЕТ            │ Webhook inline       │
│ 3 │ LINK_ORDER SUB          │ link:order:{UUID}         │ admin-create-payment-link│ ❌ НЕТ         │ ❌ НЕТ         │ Да→skip renew  │ via GA  │ ❌ НЕТ     │ ЕСТЬ: 48ч+ lag │ ❌ Нет owner         │
│ 4 │ link_order one-time     │ link:order:{UUID}         │ admin-create-payment-link│ N/A            │ via GA (first) │ Да             │ via GA  │ via GA     │ НЕТ            │ grant-access         │
│ 5 │ link legacy             │ link:{UUID}               │ Pre-created              │ N/A            │ via GA         │ Да             │ via GA  │ via GA     │ НЕТ            │ grant-access         │
│ 6 │ direct-charge           │ {payment_v2_id}           │ subscription-charge      │ INLINE         │ syncEntitlement│ Нет (inline)   │ sub-chg │ Нет        │ НЕТ            │ sub-charge inline    │
│ 7 │ orphan auto-create      │ Unrecognized              │ createOrderFromWebhook   │ via GA         │ via GA         │ Да             │ via GA  │ via GA     │ НЕТ            │ grant-access         │
│ 8 │ PUBLIC-CHECKOUT SUB     │ link:order:{UUID}         │ public-checkout          │ ❌ ТА ЖЕ ДЫРА  │ ❌ НЕТ         │ Да→skip renew  │ via GA  │ ❌ НЕТ     │ ЕСТЬ           │ ❌ Нет owner         │
│ 9 │ bepaid-get-sub-details  │ N/A (sync)                │ N/A                      │ ✅ из API      │ ✅ PATCH-C     │ Нет            │ PATCH-C3│ Нет        │ Compensating   │ Sync (delayed)       │
│10 │ admin manual edit       │ N/A                       │ N/A                      │ Прямое         │ Прямое         │ Нет            │ Нет     │ Нет        │ НЕТ            │ Admin                │
│11 │ retroapply              │ N/A                       │ N/A                      │ Нет            │ Да (rules)     │ Нет            │ Нет     │ Нет        │ НЕТ            │ retroapply           │
└───┴─────────────────────────┴───────────────────────────┴──────────────────────────┴────────────────┴────────────────┴────────────────┴─────────┴────────────┴─────────────────┴──────────────────────┘
GA = grant-access-for-order
```

### 1B. Все пути создания заказов после платежа


| Payment source            | Функция создания order                        | Tracking format            | Create/reuse       | Доступ после          |
| ------------------------- | --------------------------------------------- | -------------------------- | ------------------ | --------------------- |
| admin-create-payment-link | `create-payment-checkout`                     | `link:order:{UUID}`        | Creates new        | ✅ initial / ❌ renewal |
| public-checkout           | `public-checkout` → `create-payment-checkout` | `link:order:{UUID}`        | Creates new        | ✅ initial / ❌ renewal |
| subv2 checkout            | `create-payment-checkout`                     | `subv2:{sub}:order:{UUID}` | Creates new        | ✅ always              |
| subscription-charge       | Inline в sub-charge                           | `{payment_v2_id}`          | Creates per charge | ✅ inline              |
| Orphan webhook            | `createOrderFromWebhook`                      | From bePaid data           | Creates new        | ✅ via grant-access    |


### 1C. Все пути выдачи доступов


| Путь                           | Canonical?         | Verdict      | Known bugs                                               |
| ------------------------------ | ------------------ | ------------ | -------------------------------------------------------- |
| **Initial payment** (subv2)    | **YES**            | must_keep    | Нет                                                      |
| **Renewal** (subv2)            | **YES**            | must_keep    | Нет                                                      |
| **Renewal** (PATCH-LINK)       | **BROKEN**         | **must_fix** | access_end_at/expires_at не обновляются, GC не синкается |
| **Retry after failed charge**  | YES                | must_keep    | Нет                                                      |
| **Admin manual edit**          | YES (manual)       | must_keep    | Нет                                                      |
| **Retroapply**                 | YES                | must_keep    | Нет                                                      |
| **Repair/backfill** (sync)     | YES (compensating) | must_keep    | Delayed, not real-time                                   |
| **Orphan recovery**            | YES (recovery)     | must_keep    | Нет                                                      |
| **Telegram-only / club-only**  | YES                | must_keep    | False revoke risk при stale dates                        |
| **Training/product via rules** | YES                | must_keep    | Product-scoped tariff (уже fix)                          |


---

### 1D. 72h Grace Period: intended vs actual behavior


| Место в коде                                                                                                           | Intended                                           | Actual                                                                                                                 | Касается успешного платежа? |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `accessValidation.ts` стр.17: `GRACE_PERIOD_MS = 72h` — `hasValidAccess()` считает sub valid 72ч после `access_end_at` | Защита от false revoke при **failed** charge retry | **Маскирует** stale `access_end_at` при PATCH-LINK renewal. Пользователь «valid» 72ч после **старого** `access_end_at` | **ДА — ошибочно**           |
| `resolve-effective-access.ts` стр.23: та же логика                                                                     | Same                                               | Same                                                                                                                   | Same                        |
| `grant-access-for-order` стр.539, 641: `grace_hours: 72`                                                               | Конфиг recurring_snapshot для retry                | OK — не касается stale данных                                                                                          | Нет                         |
| `subscription-charge` стр.740: `graceHours || 72`                                                                      | Запуск grace при access_end_at < now               | OK                                                                                                                     | Нет                         |
| `subscription-grace-reminders` стр.409                                                                                 | Рассылка уведомлений                               | OK                                                                                                                     | Нет                         |


**Жёсткий вывод:** После **успешной** оплаты 72h grace НЕ ДОЛЖЕН задерживать ни `subscriptions_v2.access_end_at`, ни `entitlements.expires_at`, ни Telegram, ни GetCourse, ни UI. Grace предназначен ТОЛЬКО для периода retry при неудачном списании. Текущий lag при PATCH-LINK маскируется grace до 72ч, после чего — false revoke.

---

### 1E. Telegram side-effect analysis


| Сценарий                               | Что происходит                                                                                            | Риск            |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------- |
| **Initial grant**                      | `grant-access-for-order` → `telegram-grant-access` если club rule. Синхронно                              | НЕТ             |
| **Renewal without duplicate**          | grant-access → `already_fulfilled` → Telegram не дублируется                                              | OK              |
| **Revoke on expiry**                   | `telegram-check-expired` (15мин cron) проверяет `telegram_access.active_until < now` → `hasValidAccess()` | —               |
| **Restore after renewal**              | PATCH-LINK: grant-access → skip → **НЕТ restore**. `telegram_access.active_until` stale                   | ❌               |
| **False revoke risk**                  | Если PATCH-LINK renewal lag >72ч: `hasValidAccess()` returns false → **КИКАЕТ оплатившего**               | **КРИТИЧЕСКИЙ** |
| **Может ли cron кикнуть оплатившего?** | **ДА** — подтверждено анализом кода                                                                       | ❌               |


### 1F. GetCourse verdict


| Path                   | GC sync?                                    | Evidence                          |
| ---------------------- | ------------------------------------------- | --------------------------------- |
| subv2 handler          | **Да**, inline `sendToGetCourse` (стр.1733) | OK                                |
| **PATCH-LINK handler** | **❌ НЕТ**                                   | Вызов отсутствует (стр.1895-2654) |
| grant-access-for-order | Да (initial, если gc_offer_id)              | Для renewal: skip → нет           |
| bepaid-get-sub-details | **НЕТ**                                     | Sync не вызывает GC               |


**Вывод:** При PATCH-LINK renewal GC sync не вызывается. Отдельный gap.

---

### 1G. Почему раньше работало

**По текущему коду:** PATCH-LINK handler (стр.1895-2654) не содержит inline update для `access_end_at`, `expires_at`, GC.

**По данным:** Первые SUB-LINK подписки созданы ~март 2026. Первые renewals — апрель 2026.

**Git blame не проводился.** Формулировка: «по текущему коду PATCH-LINK handler не содержит inline update; по данным первые renewals SUB-LINK совпали с появлением жалоб».

---

### 1H. Broken cohort

SQL: ~15 активных SUB-LINK подписок (billing_type=provider_managed). Ближайшие access_end_at: 12.04–22.04. Текущие даты синхронизированы (bepaid-get-sub-details отработал), но при следующем renewal gap повторится.

---

## ЧАСТЬ 2: EXECUTION

### Инвариант

**Ни один успешный платёж не может зависеть от последующего sync/cron для активации доступа.** Sync/reconcile — только compensating (repair, audit, compensation после transient failure).

### Canonical owner обновления дат


| Сущность                         | Primary owner                                  | Compensating                    |
| -------------------------------- | ---------------------------------------------- | ------------------------------- |
| `subscriptions_v2.access_end_at` | **Webhook inline**                             | bepaid-get-sub-details          |
| `entitlements.expires_at`        | **Webhook inline**                             | bepaid-get-sub-details PATCH-C  |
| Telegram access                  | grant-access (initial) + webhook inline extend | bepaid-get-sub-details PATCH-C3 |
| GetCourse                        | **Webhook inline** / grant-access (initial)    | —                               |


### PATCH 1: Inline update в PATCH-LINK handler

**Файл:** `supabase/functions/bepaid-webhook/index.ts`
**Место:** После `grant-access-for-order` (стр.2507), перед admin notification (стр.2571)

**Parity checklist 1:1 с subv2 handler:**


| Действие                                                                           | subv2 (стр.) | PATCH-LINK (добавить)                       |
| ---------------------------------------------------------------------------------- | ------------ | ------------------------------------------- |
| Извлечь `active_to` / `renew_at`                                                   | 1495-1496    | ✅                                           |
| `endOfDayAppTz(active_to)`                                                         | 1500         | ✅                                           |
| Fallback `+accessDays` с audit                                                     | 1503-1511    | ✅                                           |
| `sub_v2.update({status:'active', access_end_at, next_charge_at, auto_renew:true})` | 1515-1531    | ✅                                           |
| `entitlements` GREATEST update/create                                              | 1574-1617    | ✅                                           |
| `sendToGetCourse` если gc_offer_id                                                 | 1706-1796    | ✅                                           |
| Audit log                                                                          | 1798-1813    | ✅ `bepaid.webhook.link_order_dates_updated` |


### PATCH 2: Broken cohort repair (отдельный этап)

**Dry-run:**

- SQL: все active SUB-LINK подписки
- Сверить: `access_end_at` vs `provider_subscriptions.raw_data.active_to`, `entitlements.expires_at`, Telegram membership, GC sync status
- Consolidated report

**Execute (после dry-run proof):**

- bepaid-get-sub-details для stale записей
- GC sync batch для missing
- Audit: `bepaid.repair.link_order_cohort_sync`
- Proof до/после

### Anti-regression matrix


| Path                    | Затронут?                              |
| ----------------------- | -------------------------------------- |
| subv2 initial/renewal   | НЕТ — отдельный handler                |
| **link_order renewal**  | **ДА — ФИКС**                          |
| link_order initial      | НЕТ — grant-access создаёт             |
| One-time payment        | НЕТ — другая ветка (PATCH-LINK-LEGACY) |
| **public-checkout sub** | **ДА — тот же handler**                |
| direct-charge           | НЕТ                                    |
| Manual admin grant      | НЕТ                                    |
| Retroapply              | НЕТ                                    |
| Orphan recovery         | НЕТ                                    |
| SaaS billing            | НЕТ                                    |
| Telegram issue/revoke   | НЕТ (side-effect)                      |
| Provider sync           | НЕТ (compensating)                     |


## Файлы


| Файл                                         | Изменение                                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `supabase/functions/bepaid-webhook/index.ts` | PATCH-LINK handler: inline update access_end_at + entitlement.expires_at + GC sync (parity 1:1 с subv2) |


## DoD

1. При webhook link_order renewal: `access_end_at` + `expires_at` + GC обновлены **сразу**
2. **UI сразу после платежа показывает активный доступ**
3. **Нет зависимости от cron/sync** для активации оплаченного доступа
4. Telegram и GetCourse не отстают от subscription/entitlement
5. Broken cohort: dry-run → repair с proof до/после (PATCH 2)
6. Anti-regression: все paths не затронуты
7. Parity 1:1 PATCH-LINK ↔ subv2: date transforms, audit, safeguards, GC, status restoration

## Формулировка по Татьяне Трубниковой

- Платёж прошёл 09.04, `grant-access-for-order` → `skip_already_fulfilled`
- `access_end_at` и `expires_at` **не обновились** в webhook (PATCH-LINK не содержит inline update)
- GC sync **не вызван**
- bepaid-get-sub-details (ручной sync) обновил через **48 часов**
- 72h grace маскировал проблему, false revoke не произошёл
- При следующем renewal gap **повторится** без PATCH 1

## Follow-up (явный backlog)

1. **Объединение subv2 и PATCH-LINK** в shared helper — устранение дублирования
2. **Cron для bepaid-get-sub-details** — автоматизация compensating sync
3. **Устранение overlapping logic** между webhook, grant-access, reconcile — единый canonical owner-path
4. **Git blame** PATCH-LINK handler — regression или исходный дефект