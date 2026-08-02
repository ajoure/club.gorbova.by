# План: восстановление клубного доступа A/B и forensic C

PLAN-ONLY. Ничего не изменено. Ниже — установленные факты и безопасный EXECUTE-план.

## Установленные факты (read-only)

Продукт клуба: `11c9f1b8-0355-4753-bd74-40b42aa53616`.

### A1 — REBILL-0a9136f0 `0bce577f-5f72-4f4a-9c4b-626b6d40bccd`
- user `856cb856…`, tariff `31f75673…`, provider bepaid, order.bepaid_subscription_id `sbs_22844aa83eb93781`
- единственный live succeeded payment `037fe3aa-6857-44a9-9dde-5718812bd1fa`, 100.00 BYN, provider_payment_id `0a9136f0-4c0b-443d-b901-7d8f0f335708`, paid_at 2026-08-01 12:45:19Z
- ledger по order_id: **0** записей (grant не применялся)
- каноническая активная подписка: `9235d996-a1b0-4318-bc47-3a5f9d3e4cdd` (active, access_end 2026-08-02 12:00)
- entitlement `9caedebf…` — **expired** 2026-08-02 12:00
- provider link `377b4588…` (`sbs_22844aa83eb93781`) указывает на **superseded** `8e561d97…` → тот же класс, что ранее исправленный A#1 linkage conflict
- ожидаемое окно после продления: 2026-08-02 12:00 → **2026-09-02 12:00** (месячный шаг цепочки 07-02→08-02)

### A2 — REBILL-2185eb2a `f524ffd5-3af7-4b91-aac9-b563103aab68`
- user `7d773d71…`, tariff `7c748940…`, `sbs_6688b8c07114fdf4`
- live payment `56506c8a-ed74-4f32-853f-c229f847db8f`, 250.00 BYN, ppid `2185eb2a-b708-4b2f-906f-3bc6c0aa8817`, paid_at 2026-08-01 13:30:12Z
- ledger: **0**
- каноническая активная подписка `cf84f19a-d207-4aa3-a99d-1f545cba0539` (access_end 2026-08-02 12:00)
- entitlement `a62af725…` — **expired** 2026-08-02 12:00
- provider link `8beb7007…` указывает на **superseded** `09ee2e16…` (linkage conflict)
- ожидаемое окно: 2026-08-02 12:00 → **2026-09-02 12:00**

### B — REBILL-4eb06ce2 `ca5c13a2-ed0e-4a44-b1ed-f51dc2af113a`
- user `31f317b3…`, `sbs_6eb6a4dc6af8ac17`, live payment `64d6b81b-afe9-4b33-937e-a15e5f2852de`, 250.00 BYN, ppid `4eb06ce2-6a3e-45e5-b070-e929177ed18a`, paid_at 2026-07-31 09:15:12Z, ledger: **0**
- активная подписка `59993729…` (access_end 2026-08-03 12:00), entitlement `849e0ef5…` active до 2026-08-03 12:00
- provider link `c5b621df…` указывает на **expired** `5a909ae1…` (access_end 2026-07-31, next_charge 2026-08-30)
- у пользователя исторически две параллельные цепочки одного тарифа → без дополнительного доказательства нельзя утверждать, что оплата 31.07 ещё не отражена в окне до 03.08
- поэтому B выполняется **только** после отдельного доказательства (см. шаг 3), иначе STOP

### C — user `09f6350e…` (forensic, без изменений)
- две active подписки одного продукта и одного тарифа `b276d8a5…`: `6afe0bbf…` (создана 2026-03-21, order `018cda34…`, access_end 2026-08-18 20:59:59) и `d6e8229d…` (создана 2026-07-20, order `bc22b0a3…`, access_end 2026-08-19 20:59:59)
- активный entitlement один: `7a5143f0…` до 2026-08-20 12:00, привязан к order `bc22b0a3…`
- в цепочке также `200ca8d5…` past_due (20.07) и `517c30f3…` canceled — признак пересоздания цепочки, а не второй законной покупки

## EXECUTE-план (после отдельного одобрения)

1. **Preflight A (STOP при любом расхождении).** Перепроверить для A1 и A2: order.status=paid, ровно 1 live succeeded payment с указанным ppid, ledger по order_id = 0, entitlement expired 2026-08-02 12:00, каноническая active подписка одна.
2. **CAS repair provider link (до grant, recoverable, по одному на пользователя).**
   - A1: `provider_subscriptions` `377b4588…` → `subscription_v2_id` с `8e561d97…` (superseded) на canonical active `9235d996…`.
   - A2: `provider_subscriptions` `8beb7007…` → с `09ee2e16…` (superseded) на canonical active `cf84f19a…`.
   - CAS WHERE строго: id ссылки, текущий `subscription_v2_id` = точный superseded id, `provider='bepaid'`, `provider_subscription_id` = `sbs_22844aa83eb93781` / `sbs_6688b8c07114fdf4`, `user_id` совпадает у ссылки и целевой подписки, целевая подписка того же продукта `11c9f1b8…` и в статусе active; дополнительно проверить, что другого active-линка на этот `provider_subscription_id` нет.
   - Ожидаемый rowcount = 1 на каждый UPDATE, иначе STOP. Новые подписки не создаются, старые строки не удаляются (откат = обратный CAS).
3. **Grant A.** После успешного repair вызвать канонический `grant-access-for-order` (код после PR #257) ровно один раз на каждый order (`0bce577f…`, `f524ffd5…`), идемпотентный ключ = order_id. Продлевается существующая каноническая подписка; ожидаемое окно до 2026-09-02 12:00.
4. **B — доказательство, затем один grant или documented no-op.** Read-only сверка для `ca5c13a2…`: соответствует ли окно до 2026-08-03 оплате от 31.07 (шаг цепочки, `next_charge_at`, история ledger и предыдущих rebill-окон, привязка `sbs_6eb6a4dc…`). Если доказано, что оплата ещё не продлила окно — один вызов `grant-access-for-order`; иначе — задокументированный no-op. Неопределённость B не блокирует и не откатывает A.
5. **Read-back A/B.** По каждому обработанному заказу: ledger по order_id = 1, entitlement active, expires_at соответствует ожидаемому окну, число подписок пользователя по продукту не выросло; агрегатно — missing active contractual access = 0.
6. **Telegram.** Только тем пользователям, кому доступ реально восстановлен на шаге 3/4 и кому invite/DM ранее не отправлялся (проверка лога уведомлений перед отправкой). Email/GetCourse/AmoCRM/charge/refund/void — нет.

6. **Финальная сверка.** INV-20 actionable=0; INV-25 processing>2ч=0; paid orders окна без активного договорного доступа=0; отдельным безопасным выводом — список duplicate active subscriptions по продукту (ожидается только `09f6350e…`), без изменений.
7. **C.** Только отчёт: дубль одной цепочки или две покупки; решение о слиянии — отдельной задачей.

## Вне scope
Код, коммиты, миграции, deploy, Publish; любые денежные операции; изменение подписок вручную; правка данных пользователя `09f6350e…`.
