да, согласен, с учетом правок:

1. **Исправить технические опечатки в Step Static check.**  
Сейчас блок сломан текстом:

atic check

k 'NR>=ZONE2_START...

идание...

огнать...

Должно быть нормально оформлено:

awk 'NR>=ZONE2_START && NR<=ZONE2_END' supabase/functions/bepaid-webhook/index.ts \

  | grep -E "from\('subscriptions_v2'\)\.(insert|update|upsert)|from\('entitlements'\)\.(insert|update|upsert)|from\('subscriptions'\)\.update|functions\.invoke\('telegram-grant-access'"

Ожидание: 0 совпадений по write/invoke-паттернам.

2. **Static check не должен запрещать read-only SELECT.**  
Проверять именно:
  - insert/update/upsert в subscriptions_v2;
  - insert/update/upsert в entitlements;
  - update в legacy subscriptions;
  - telegram-grant-access invoke;
  - entitlement_orders insert/update/upsert, если встречается.
3. **Zone 2 retirement должен срабатывать только для legacy zone 2.**  
Не ставить общий early-return слишком высоко, чтобы не перехватить:
  - canonical link_order;
  - 3DS finalize;
  - subscription webhook;
  - zone 1 materialization-only.
4. **В audit добавить максимум идентификаторов для ручной проверки.**  
В bepaid.webhook.legacy_one_time_retired_manual_review включить:

transaction_uid

tracking_id

subscription_id

customer_email

amount

currency

legacy_order_id

legacy_order_number

product_code

product_v2_id

tariff_code

reason

5. **Response HTTP 200 должен быть безопасным для bePaid.**  
Оставить ok:true, status:'manual_review', чтобы bePaid не ретраил бесконечно.
6. **Zone 1 regression важен.**  
Тест должен подтвердить: zone 1 по-прежнему делает только materialization/payment record, но не выдаёт access.
7. **Не деплоить в этом проходе.**  
План правильно указывает deploy pending approve. После code+tests+proof нужен отдельный короткий deploy approve.
8. **DoD добавить явную строку: H2.1c closed только после deploy.**  
Сейчас после code/tests будет статус:

H2.1c-i code+tests — ready for deploy

H2.1c-i fully closed — after deploy verification

9. **После H2.1c-i всё равно не включать mode=on автоматически.**  
Следующий этап — только:

H4 preconditions for BEPAID_REBILL_MATERIALIZATION=on

С этими правками план можно выполнять как **code+tests+proof без deploy**.

&nbsp;

# План: PATCH H2.1c-i — retire legacy one-time access writes

## Цель

Безопасно вывести legacy zone 2 (`bepaid-webhook/index.ts` ≈5274–6285) из access-write логики. Никакого bridge `orders → orders_v2`, никакого расширения `grant-access-for-order` под `legacy_order_id`. Если legacy payload неожиданно прилетит — audit + HTTP 200 + manual_review, **без** access/Telegram writes.

Основание: H2.1c analysis (`patch_h2_1c_legacy_one_time_analysis_2026_05.md`) — 0 paid за 90 дней, 100% live one-time идёт через canonical `link_order` (закрытый H2.1b-ii).

## Scope

### IN

- `supabase/functions/bepaid-webhook/index.ts` — zone 2 (legacy one-time, region ≈5274–6285):
  - удалить блок INSERT/UPDATE `subscriptions_v2` (≈5546, 5561, 5576);
  - удалить upsert `entitlements` (≈5696, `product_code`-based);
  - удалить UPDATE legacy `public.subscriptions` v1 (≈5721);
  - удалить два `functions.invoke('telegram-grant-access', …)` (≈5614, ≈5755);
  - удалить запись в `entitlement_orders`, если она есть в этом регионе;
  - заменить весь блок на единственную ветку **retired**:
    ```ts
    await writeAudit('bepaid.webhook.legacy_one_time_retired_manual_review', {
      transaction_uid, tracking_id, customer_email, raw_amount,
      reason: 'legacy_one_time_path_retired_h2_1c_i',
    });
    return new Response(JSON.stringify({
      ok: true, status: 'manual_review',
      reason: 'legacy_one_time_path_retired',
    }), { status: 200, headers: corsHeaders });
    ```
- Zone 1 (`!orderId && !subscriptionId && status='successful' && transactionUid`, ≈5015–5269) — оставить как есть. Analysis подтвердил: пишет только `payments_v2` + amoCRM, **не** трогает access. Повторно verify static-check'ом.

### OUT (не трогаем)

- `grant-access-for-order` (writer + index) — без изменений.
- canonical `link_order` ветка webhook — без изменений.
- 3DS finalize ветка (H2.1b-ii closed) — без изменений.
- legacy `public.orders` / `public.subscriptions` (v1) / `entitlements.product_code` — без миграций и без data-repair.
- secrets, в т.ч. `BEPAID_REBILL_MATERIALIZATION` — без изменений (остаётся `dry_run`).
- `mode=on` — не включаем.
- Рабчевская / другие data-repair — не трогаем.

## Hard safety gates

- Production DML = 0
- Migrations = 0
- `BEPAID_REBILL_MATERIALIZATION` = `dry_run` (не меняем)
- `mode=on` НЕ включается
- Deploy только после зелёных тестов и approve

## Steps

1. **Read & locate**: точные line ranges legacy zone 2 в `bepaid-webhook/index.ts`, отметить все 4 группы writes (subv2 / entitlements / subv1 / telegram).
2. **Edit**: вырезать zone 2 writes, оставить short-circuit retired-branch (audit + HTTP 200).
3. **Tests** (`supabase/functions/bepaid-webhook/`):
  - новый файл `legacy_one_time_retirement_test.ts`:
  1. legacy zone 2 payload (`!orderId`, `status='successful'`, есть `tariff_code` + `product_v2_id` в meta) → HTTP 200, body `status:'manual_review'`, audit `bepaid.webhook.legacy_one_time_retired_manual_review`;
  2. **0** вызовов `from('subscriptions_v2').insert|update` в этой ветке (mock-counter);
  3. **0** вызовов `from('entitlements').upsert|insert|update`;
  4. **0** вызовов `from('subscriptions').update` (v1);
  5. **0** вызовов `functions.invoke('telegram-grant-access')`;
  6. canonical `link_order` payload (orderId присутствует) → проходит как раньше, не задет (regression guard);
  7. zone 1 materialization-only payload → по-прежнему пишет только `payments_v2`, access НЕ затронут.
    atic check (грep-тест, как в H2.1b-ii):
    `k 'NR>=ZONE2_START && NR<=ZONE2_END' bepaid-webhook/index.ts \ | grep -E "subscriptions_v2|entitlements|telegram-grant-access|from\('subscriptions'\)"`
    идание: **0 совпадений** (кроме, возможно, read-only SELECT — если останется, обосновать).
    огнать существующие `canonical_writer_enforcement_test.ts` / `rebill_*` — должны остаться 44/44.
4. **Verify**: `deno check` + полный test run по `bepaid-webhook` и `grant-access-for-order` (42/42 + 44+N/44+N green).
5. **Proof**: `.lovable/proofs/patch_h2_1c_i_legacy_retirement_2026_05.md`:
  - diff summary (что удалено / что осталось);
  - static-check вывод;
  - test results;
  - подтверждение DML=0, migrations=0, secrets unchanged, mode=on не включался;
  - rollback note (git revert одной правки).
6. **Update plan**: `.lovable/plan.md` — H2.1c-i → `closed (code+tests)`, deploy pending approve.
7. **Stop**. Deploy и любые data-repair — отдельным approve.

## DoD

- zone 2 содержит 0 access writes (subv2/entitlements/subv1/entitlement_orders) и 0 telegram invokes;
- legacy payload → audit + HTTP 200 + manual_review, без побочных эффектов;
- canonical link_order ветка не задета (regression test green);
- zone 1 по-прежнему пишет только `payments_v2` (regression test green);
- `deno check` чистый, `bepaid-webhook` тесты зелёные (44 existing + новые), `grant-access-for-order` 42/42 не сломаны;
- static-check по zone 2 = 0 запрещённых паттернов;
- proof-файл создан и заполнен;
- `plan.md` обновлён;
- production DML = 0, migrations = 0, `BEPAID_REBILL_MATERIALIZATION = dry_run`, `mode=on` не включался;
- deploy НЕ выполнен (ждём отдельного approve).

## Risks & mitigations


| Риск                                                                               | Митigation                                                                                                        |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Реальный paid legacy webhook прилетит в окно retirement → клиент не получит доступ | За 90 дней = 0 кейсов. Manual_review audit ловится моментально, fallback — ручная выдача через admin. Acceptable. |
| Случайно зацепили canonical link_order ветку                                       | Regression test #6 + 44 existing tests.                                                                           |
| Случайно сломали zone 1 (materialization-only)                                     | Regression test #7 + static check, что zone 1 не редактировалась.                                                 |
| `auto_renew=true` гэп (G8)                                                         | Закрывается автоматически — zone 2 больше ничего не пишет в subv2.                                                |


## После H2.1c-i

→ H4 preconditions для `BEPAID_REBILL_MATERIALIZATION=on` (отдельный план + approve). До закрытия H2.1c-i `mode=on` остаётся запрещён.