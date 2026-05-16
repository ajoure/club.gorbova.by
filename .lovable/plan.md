## да, согласен, с учетом правок:

1. **Не писать несуществующую сигнатуру** `grant-access-for-order(orderId, { ... })`**.**  
Использовать фактический invoke-body:

```ts
supabase.functions.invoke('grant-access-for-order', {
  body: {
    orderId,
    source: 'bepaid_webhook',
    context: {
      branch: 'webhook_subscription' | '3ds_finalize' | 'legacy_one_time',
      provider: 'bepaid'
    }
  }
})
```

Если `context` не поддерживается текущей функцией — не добавлять его в body, а передавать branch/source через audit/meta, которые уже поддерживаются.

2. **В 3DS finalize осторожно с “order_id доступен в контексте”.**  
Перед заменой write-блоков нужно доказать, что в каждой ветке есть валидный `orderId`.  
Если `orderId` не найден или неоднозначен — STOP/manual_review, без прямого access-write.
3. `next_charge_at` **и** `auto_renew` **оставить только как provider-sync.**  
В proof явно подписать: они не считаются доказательством активного доступа и не используются как основание для UI-статуса доступа.
4. `extended_by_orders` **не трогать в H2.1, если это access-lineage.**  
В плане он указан как provider-sync, но фактически это access/grant lineage. Лучше:
  - не добавлять новую логику `extended_by_orders` в webhook;
  - любые изменения `extended_by_orders` только внутри `grant-access-for-order`;
  - race-safe RPC — отдельно H2b.
5. **Static check по regex может быть ненадёжным.**  
Оставить grep, но дополнить ручным inventory:
  - все оставшиеся `from('subscriptions_v2').update/upsert`;
  - все оставшиеся `from('entitlements').insert/upsert/update`;
  - для каждого — access-write / provider-sync / revoke / unrelated.
6. **Тесты: не только unit, но и contract test по каждой ветке.**  
Минимум для каждой из 3 веток:
  - `grant ok` → прямых access writes нет;
  - `grant skip/error` → no fallback write;
  - missing/ambiguous orderId → manual_review, no access write.
7. **Deploy только после** `deno check` **+ tests.**  
В proof добавить:
  - `deno check` passed;
  - все tests passed;
  - deploy success.
8. **H2.1 не должен менять** `grant-access-for-order`**.**  
Если при реализации выяснится, что canonical writer не поддерживает нужный сценарий 3DS/legacy — остановиться и вынести отдельный план, а не добавлять обход в webhook.

После этих правок план можно выполнять. Это blocker перед любым `BEPAID_REBILL_MATERIALIZATION=on`.

&nbsp;

PATCH H2.1 — Canonical-only enforcement для оставшихся веток bepaid-webhook

Цель: довести до 100% инвариант «`bepaid-webhook` не пишет access-grant поля напрямую» в трёх оставшихся ветках. После закрытия H2.1 — снять последний блокер перед mode=on (отдельным H4).

### Stop-list (строгие границы)

- production DML = 0
- migrations = 0
- `BEPAID_REBILL_MATERIALIZATION` остаётся `dry_run`, mode=on НЕ включаем
- никаких backfill/repair уже задетых подписок (это H3)
- `forceExtend=true` не вводим
- никаких атомарных RPC для `extended_by_orders` (это H2b)
- PATCH G ведётся параллельно как read-only, в H2.1 не вмешиваемся

### Затронутые ветки (inventory, по proof H2)

1. **WEBHOOK-SUBSCRIPTION renewal** (`supabase/functions/bepaid-webhook/index.ts` ≈ строки 1500–1650):
  - прямой write `subscriptions_v2.access_start_at` / `access_end_at` (1540–1541);
  - прямой upsert `entitlements.expires_at` (1607–1640);
  - сценарий: bePaid `subscription_charge.success` для recurring подписок.
2. **3DS finalize** (≈ строки 4541–4950):
  - прямой write `subscriptions_v2.access_start_at` / `access_end_at` (4794–4795, 4765);
  - прямой upsert `entitlements.expires_at` + `access_end_at` (4854–4947);
  - сценарий: 3DS challenge confirmed → доступ выдаётся пользователю.
3. **Legacy одноразовый path** (≈ строки 5820–6070):
  - прямой write `subscriptions_v2.access_start_at` / `access_end_at` (5899, 5921–5922);
  - прямой upsert `entitlements.expires_at` (6039, 6062);
  - сценарий: исторический one-time order path до canonical writer.

`bepaid.webhook.access_end_at_skipped_overshoot` guard (≈ 3000–3330) — НЕ access-grant write, остаётся как есть.

### Шаги

**Шаг 1. Read-only inventory.**
Для каждой ветки выписать в proof:

- какие поля писались;
- access-grant write или provider-sync;
- какой провайдерский сценарий обслуживает;
- какой `order_id` / `subscription_id` доступен в контексте для вызова canonical writer.

**Шаг 2. Замена access-grant writes на `grant-access-for-order`.**
В каждой из трёх веток:

- удалить прямой UPDATE `subscriptions_v2.access_*`;
- удалить INSERT/UPDATE `entitlements.expires_at` / `status`;
- удалить любые `telegram_access*` writes (если встретятся);
- вызвать `grant-access-for-order(orderId, { source: 'bepaid_webhook', context: '<branch>' })`;
- обработать результат:
  - `ok` → продолжить с provider-sync технических полей (`billing_type`, `auto_renew`, `meta.bepaid_*`);
  - `skip_*` / `error` / `manual_review` / `sbs_mismatch` → audit `bepaid.webhook.grant_skipped_no_fallback` + return 200 `{ processed: true, materialized: false, reason }`. Никаких прямых access writes.

**Шаг 3. Сохранить provider-sync.**
Технические поля (`billing_type`, `auto_renew`, `meta.bepaid_subscription_id`, `next_charge_at`, дедуп `extended_by_orders`) — оставить как provider-sync, доказав в proof, что они не выдают доступ.

**Шаг 4. Tests.**
В `supabase/functions/bepaid-webhook/*.test.ts` добавить по 3 unit-теста на ветку:

- happy-path: canonical writer вызван 1 раз, прямых access writes нет;
- skip: grant вернул `skip_*` → audit записан, access не изменён;
- sbs_mismatch / manual_review: webhook возвращает 200, прямых writes нет.

**Шаг 5. Static check.**
`rg -n "subscriptions_v2.*\.update\(\{[^}]*access_(start|end)_at" supabase/functions/bepaid-webhook/index.ts` → 0 матчей.
`rg -n "from\('entitlements'\)[\s\S]{0,200}(insert|upsert|update)" supabase/functions/bepaid-webhook/index.ts` → 0 матчей.
`rg -n "from\('telegram_access" supabase/functions/bepaid-webhook/index.ts` → 0 матчей вне revoke.

**Шаг 6. Deploy.**
Только `bepaid-webhook`. `grant-access-for-order` не трогаем (закрыт в H2).

**Шаг 7. Proof.**
`.lovable/proofs/patch_h2_1_canonical_writer_full_enforcement_2026_05.md`:

- inventory 3 веток (before/after);
- diff-сводка;
- static-check вывод (0/0/0);
- test output;
- подтверждение: production DML=0, migrations=0, mode остался dry_run.

### DoD

- 0 прямых access-grant writes во всех 4 ветках webhook (LINK-ORDER уже закрыт, +3 новые);
- canonical writer = единственный writer access;
- skip/error/manual_review → audit без fallback;
- тесты зелёные;
- static check зелёный;
- deploy выполнен;
- proof создан;
- production DML=0, migrations=0, `BEPAID_REBILL_MATERIALIZATION=dry_run`.

### После H2.1 (отдельные патчи, не в этом скоупе)

- **H2b** — atomic append `extended_by_orders` через RPC (только если race замечен).
- **H3** — data-repair дублей и расхождений на уже задетых подписках.
- **H4** — preconditions + `BEPAID_REBILL_MATERIALIZATION=on`.
- **PATCH G** — read-only bonus/secondary discovery (идёт параллельно).