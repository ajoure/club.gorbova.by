да, согласен, с учетом правок:

1. **Разделить задачи и приоритет**

Сейчас есть две разные задачи:

```text
P0: PATCH-DEMO-TRIAL-NO-CARD-ACTIVATION
Hygiene: PATCH-PREORDER-CONVERT-AUDIT-FIX runtime-proof
```

Приоритет должен быть такой:

```text
1. Сначала починить активацию demo/trial без карты.
2. Потом закрывать audit-proof по preorder convert.
```

Потому что на скрине видно, что пользовательский flow всё ещё сломан:

```text
Не удалось продолжить оплату.
Попробуйте ещё раз или оплатите другой картой.
```

Для trial 0 BYN это неверное поведение: **никакой карты и никакой оплаты быть не должно**.

---

2. **Audit synthetic-proof можно выполнять, но не вместо P0**

План по `PATCH-PREORDER-CONVERT-AUDIT-FIX` в целом допустим:

- synthetic-прогон;
- rollback;
- proof audit row;
- proof idempotency no-duplicate;
- проверка отсутствия synthetic-остатков.

Но это **не чинит** ошибку «Активировать демо-доступ».

Поэтому подрядчику нужно явно написать:

```text
Audit-proof не закрывает P0. Даже если audit PASS, trial no-card activation всё ещё требует отдельного fix.
```

---

3. **По synthetic rollback — осторожно**

Идея с `RAISE EXCEPTION` для rollback допустима, но нужно проверить, что внутри DO-блока exception действительно откатывает всю транзакцию, а не ловится так, что изменения остаются.

Безопаснее:

```sql
BEGIN;
-- synthetic inserts
-- RPC call #1
-- RPC call #2
-- proof SELECT
ROLLBACK;
```

Если используется `DO $$ ... RAISE EXCEPTION ... $$`, то после выполнения обязательно proof:

```sql
select count(*) from course_preregistrations where meta->>'_synthetic_test' = 'PATCH-PREORDER-CONVERT-AUDIT-FIX';
select count(*) from orders_v2 where meta->>'_synthetic_test' = 'PATCH-PREORDER-CONVERT-AUDIT-FIX';
select count(*) from audit_logs where metadata->>'_synthetic_test' = 'PATCH-PREORDER-CONVERT-AUDIT-FIX';
```

Ожидание:

```text
0 / 0 / 0
```

---

4. **Не использовать реального super_admin как actor_user_id без необходимости**

Если audit actor — system, то лучше:

```text
actor_type='system'
actor_user_id = null
actor_label='convert_preorder_on_pay_atomic'
```

Если схема требует `actor_user_id`, можно использовать service/system actor, но в отчёте не светить персональные данные. Достаточно:

```text
actor_user_id = <system/test actor uuid>
```

---

5. **Главный P0: trial 0 BYN должен обходить bePaid полностью**

Подрядчику нужно вернуться к:

```text
PATCH-DEMO-TRIAL-NO-CARD-ACTIVATION
```

Требуемое поведение:

```text
isTrial=true
paymentAmount=0
requires_card_tokenization=false
```

→ значит:

- не создавать bePaid token;
- не открывать оплату;
- не требовать карту;
- не попадать в legacy subscription guard;
- не показывать «оплатите другой картой»;
- создать/обновить один `orders_v2`;
- поставить `status='paid'`;
- `is_trial=true`;
- `paid_amount=0`;
- `trial_end_at = now() + trial_days`;
- `meta.source='trial_no_card'`;
- вызвать `grant-access-for-order`;
- вернуть frontend:

```json
{
  "success": true,
  "isTrialNoCard": true,
  "redirectUrl": "/cabinet?trial=activated&order=<id>"
}
```

---

6. **Ошибка на скрине должна быть отдельным root cause**

В отчёте по P0 обязательно показать:

```text
Root cause: trial 0 BYN попадал в bePaid/subscription/tokenization path вместо no-card activation branch.
```

И доказать, что после fix больше нет:

```text
bepaid.subscription.create_blocked
BLOCKED: legacy subscription path attempted without explicit choice
```

---

7. **PaymentDialog должен различать “payment error” и “trial activation”**

На скрине сейчас сообщение говорит про оплату картой. Для demo 0 BYN это неверно.

В `PaymentDialog` нужно:

- если `isTrialNoCard=true` → success toast + redirect;
- если `alreadyUsedTrial=true` → понятный текст «Демо-доступ уже использован»;
- если ошибка backend для trial no-card → не писать «оплатите другой картой», а показывать фактическую причину.

---

8. **Проверка после P0**

DoD для P0:

```text
SITE-000018 / «Активировать демо-доступ»:
- карта не запрашивается;
- bePaid token не создаётся;
- orders_v2 создаётся/обновляется ровно 1 строка;
- status='paid';
- is_trial=true;
- paid_amount=0;
- meta.source='trial_no_card';
- grant-access-for-order вызван;
- access_grant_ledger имеет запись;
- доступ к «База знаний» открыт на 24 часа;
- вебинары/эфиры не открыты;
- повторная попытка тем же email не создаёт второй order/grant и возвращает alreadyUsedTrial=true.
```

---

9. **Не трогать платные flow**

В P0 нельзя ломать:

- bePaid pay_now;
- bePaid recurring;
- Stripe checkout;
- provider-side subscriptions;
- preorder Phase A/B;
- CRM hide;
- audit-fix.

No-card ветка должна быть строго ограничена:

```ts
isTrial && paymentAmount === 0 && requiresCardTokenization === false
```

---

10. **Что отправить подрядчику как итог**

Коротко:

```text
План audit-proof принимается, но он не закрывает главную пользовательскую ошибку. Сначала нужно починить PATCH-DEMO-TRIAL-NO-CARD-ACTIVATION: trial 0 BYN без card tokenization должен активироваться напрямую через orders_v2 + grant-access-for-order, без bePaid и без сообщения “оплатите другой картой”. После P0 можно закрывать PATCH-PREORDER-CONVERT-AUDIT-FIX runtime-proof.
```

## **Итоговый статус**

```text
PATCH-PREORDER-CONVERT-AUDIT-FIX proof plan: APPROVED with rollback/cleanup cautions
PATCH-DEMO-TRIAL-NO-CARD-ACTIVATION: P0 REQUIRED, NOT DONE
Current user-facing trial activation: FAIL

План: Runtime-proof PATCH-PREORDER-CONVERT-AUDIT-FIX
```

## Контекст

- Код-фикс уже задеплоен: `convert_preorder_on_pay_atomic` пишет `actor_user_id` + `actor_type='system'` + `actor_label='convert_preorder_on_pay_atomic'`, при ошибке аудита — `RAISE WARNING` (не глушится).
- В `audit_logs` 0 строк с `action='preorder.convert_on_pay'` — единственная фактическая конверсия (preorder `11b4fd8c…` → order `ea7daf45…`, 2026-06-27) произошла ДО фикса, упала на старом `actor_id` и была молча проглочена прежним `EXCEPTION WHEN OTHERS`.
- Свежих неконвертированных пар preorder+paid order для естественного триггера сейчас нет.

Нужен прямой runtime-proof обеих веток: «audit row written» и «idempotency no-duplicate».

## Что сделаем

### Шаг 1. Контролируемый synthetic-прогон в одной миграции

Одна транзакция, всё внутри `DO $$ … $$` с явным `RAISE EXCEPTION` в конце для авто-rollback (никаких остаточных данных в проде):

```text
BEGIN
  test_user_id := <реальный super_admin uid>
  test_preorder_id := gen_random_uuid()
  test_order_id    := gen_random_uuid()

  INSERT course_preregistrations(id, user_id, product_code, status,
        meta={'_synthetic_test':'PATCH-PREORDER-CONVERT-AUDIT-FIX', ...})
  INSERT orders_v2(id, user_id, status='paid', amount=0,
        meta={'_synthetic_test':'…', preorder_id:test_preorder_id})

  -- 1й вызов: должен записать audit-строку
  r1 := convert_preorder_on_pay_atomic(test_order_id)
  ASSERT r1.noop = false

  cnt1 := count(audit_logs where action='preorder.convert_on_pay'
                and meta->>'paid_order_id' = test_order_id::text)
  ASSERT cnt1 = 1
  -- читаем строку и логируем actor_user_id/actor_type/actor_label/meta
  RAISE NOTICE 'AUDIT_ROW_PROOF: %', <row>

  -- 2й вызов: идемпотентность, новой строки быть не должно
  r2 := convert_preorder_on_pay_atomic(test_order_id)
  ASSERT r2.noop = true

  cnt2 := count(audit_logs where action='preorder.convert_on_pay'
                and meta->>'paid_order_id' = test_order_id::text)
  ASSERT cnt2 = 1   -- НЕ 2

  RAISE NOTICE 'IDEMPOTENCY_PROOF: noop=true, audit_rows_total=%', cnt2

  -- форс-rollback, чтобы прод-БД осталась чистой
  RAISE EXCEPTION 'SYNTHETIC_TEST_OK_FORCE_ROLLBACK';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'SYNTHETIC_TEST_OK_FORCE_ROLLBACK' THEN
    RAISE NOTICE 'TEST PASSED, rolled back as expected';
  ELSE
    RAISE;
  END IF;
END
```

Это не «миграция» в смысле schema change — это read-only прогон через RPC с гарантированным откатом synthetic-данных. Никаких остатков в `course_preregistrations` / `orders_v2` / `audit_logs` не остаётся.

### Шаг 2. Captures и отчёт

Из логов миграции забираем строки `NOTICE`:

- `AUDIT_ROW_PROOF: …` (JSON со всеми полями audit-строки) — закрывает `audit row written: PASS`.
- `IDEMPOTENCY_PROOF: noop=true, audit_rows_total=1` — закрывает `idempotency audit no-duplicate: PASS`.

### Шаг 3. Отчёт пользователю

Формат строго:

```text
Отчет о выполненной работе: PATCH-PREORDER-CONVERT-AUDIT-FIX

audit schema fix:                PASS (код)
audit warning path:              PASS (код)
audit row written:               PASS (runtime, synthetic-прогон)
  actor_user_id = <uid super_admin, инициировавшего тест>
  actor_type    = 'system'
  actor_label   = 'convert_preorder_on_pay_atomic'
  meta          = { preorder_id, paid_order_id, … }
idempotency audit no-duplicate:  PASS (runtime, 2й вызов → noop=true, audit_rows=1)
preorder convert logic unchanged: PASS

PATCH-PREORDER-CONVERT-AUDIT-FIX: PASS (full)
```

## Технические детали / safety

- Synthetic-данные помечаются `meta->>'_synthetic_test'='PATCH-PREORDER-CONVERT-AUDIT-FIX'` — если по какой-то причине rollback не сработает, эти строки тривиально находятся и удаляются.
- Триггеры на `orders_v2` (grant-access и т.п.): `amount=0`, `status='paid'` создаётся сразу как итог — `grant-access-for-order` это edge-функция, она НЕ зовётся из DB-триггера, риска побочных выдач прав нет. Если в `orders_v2` обнаружится DB-триггер, который что-то записывает наружу — план корректируется: synthetic-вставка orders_v2 заменяется на pre-existing test-order и зовётся только RPC.
- Никаких изменений в логике `convert_preorder_on_pay_atomic` — только наблюдение.
- Никаких изменений UI/frontend.
- Заголовок отчёта будет `Отчет о выполненной работе:` (формальное замечание учтено).

## DoD

- В чате присутствуют JSON audit-строки с актуальными `actor_user_id` / `actor_type` / `actor_label`.
- Подтверждено: повторный вызов по тому же `paid_order_id` → `noop=true`, новая строка в `audit_logs` НЕ создана.
- Прод-БД без synthetic-остатков (verify `SELECT count(*) FROM course_preregistrations WHERE meta->>'_synthetic_test' IS NOT NULL` = 0; то же для `orders_v2` и `audit_logs`).