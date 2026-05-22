## План принимаю. Блок bePaid receipts НЕ закрыт, продолжай в этом же loop.

Подтверждаю порядок:

1. Сначала диагностика 404 read-only:

- взять 5 missing-with-UID из 2026-05 и 5 из 2026-01;

- по каждому проверить payments_v2.provider_response, provider_payment_id, order_id, orders_v2.meta;

- определить, к какому shop_id относится транзакция;

- сравнить с текущими BEPAID_SHOP_ID/SECRET_KEY;

- если есть мульти-shop — добавить fallback на subscription/legacy shop credentials.

Важно:

не спрашивай владельца о секретах, если они уже есть в Supabase secrets/env. Сначала проверь доступные env/secrets в edge runtime. Если отдельного секрета нет — тогда в отчёте явно указать, какой именно secret нужен.

2. Исправить cron, чтобы он реально двигался:

- 404 Record not found НЕ должен считаться 5xx-streak;

- 404 должен помечать конкретную строку reason`bepaid_endpoint_not_found` / `shop_mismatch_possible` и переходить дальше;

- выборка не должна снова брать уже обработанные строки с terminal reason;

- добавить стабильный ORDER BY created_at ASC / paid_at ASC;

- исключить уже классифицированные terminal rows из следующих запусков, если они не требуют retry;

- retry оставлять только для 5xx/timeout/rate-limit.

3. Если подтвердится multi-shop:

- `_shared/bepaid-receipt-fetch.ts` должен пробовать credentials по порядку:

  a) primary shop;

  b) subscription/legacy shop;

- в meta сохранить:

  - receipt_backfill_endpoint;

  - receipt_backfill_shop_source;

  - receipt_backfill_reason;

  - receipt_backfill_at.

- если receipt найден через второй shop — заполнить receipt_url.

4. Write-scope остаётся прежним:

- можно менять только payments_v2.receipt_url;

- provider_response.transaction.receipt_url;

- meta.receipt_backfill_*.

Нельзя менять amount/status/order_id/subscriptions/access.

5. После фикса запустить 12–20 cron runs или ручной controlled batch и дать финальный verify:

- eligible amount > 50;

- filled before;

- filled after;

- remaining missing;

- missing by reason:

  no_uid / transaction_not_found / no_receipt_in_transaction / api_5xx / timeout / shop_mismatch / manual_review;

- sample 10 filled;

- sample 10 missing with reason;

- confirmation amount <= 50 не попадают;

- confirmation no amount/status/order/access changes.

6. UI /purchases:

проверить 2–3 реальных платежа, где receipt_url был подтянут, что появилась кнопка «Скачать чек».

7. Proof обновить:

`.lovable/proofs/bepaid_receipts_2026_backfill_v2_2026_05_22.md`

добавить:

- After-cron verify;

- Multi-shop diagnostics;

- Cron movement fix;

- Final missing classification;

- UI confirmation.

DoD:

- cron больше не топчется на одних и тех же 404;

- по всем eligible платежам есть либо receipt_url, либо terminal reason;

- receipt_url подтянуты для всех доступных чеков;

- остаток missing объяснён бизнесово и технически;

- суммы/статусы/доступы не менялись.

&nbsp;

Отчет о выполнении (read-only verify)

Текущее состояние cron `bepaid-receipts-2026-backfill-cron` (schedule_id=50, `*/5 * * * *`, active=true). Cron HTTP-вызовы: 6 succeeded в окне 11:50–12:15 UTC. **Backfill НЕ завершен, блок закрывать рано.**

### 1. Cohort (origin='bepaid' OR 'bepaid_subscription', succeeded, ≥2026-01-01, amount>50)


| метрика                                      | value             |
| -------------------------------------------- | ----------------- |
| eligible total                               | **2 998**         |
| with receipt_url                             | **313** (10.4%)   |
| missing receipt_url                          | **2 685** (89.6%) |
| из missing: без provider_payment_id (no UID) | 40                |
| из missing: с UID (eligible для API)         | 2 645             |


### 2. Разбивка missing по reason


| reason                                          | count                     |
| ----------------------------------------------- | ------------------------- |
| `bepaid_endpoint_not_found` (404 gateway+beyag) | 50                        |
| без маркера (cron ещё не дошёл)                 | 2 635                     |
| API error (5xx, timeout)                        | 0                         |
| no UID                                          | 40 (отдельная подкогорта) |
| skipped / manual_review                         | 0                         |


### 3. По месяцам


| month   | total | filled | missing |
| ------- | ----- | ------ | ------- |
| 2026-01 | 2 314 | 206    | 2 108   |
| 2026-02 | 183   | 98     | 85      |
| 2026-03 | 178   | 7      | 171     |
| 2026-04 | 192   | 2      | 190     |
| 2026-05 | 131   | 0      | 131     |


`with_receipt=313` ≈ 233 пре-существующих + 80 от ручного first batch v2. **Cron-фоном после first batch fill = 0.**

### 4. Подтверждения

- amount ≤ 50 / amount = 1 в текущий scope не попадают (фильтр `.gt('amount', 50)` в edge function, подтверждено query — 0 строк с amount ≤ 50 имеют новый маркер `bepaid_receipts_2026_backfill`).
- payments_v2.amount / status / order_id, subscriptions_v2, entitlements, access_rules — не менялись.

### 5. Найденные проблемы

**Проблема A — массовые 404 от bePaid.** Логи `bepaid-receipts-2026-backfill-cron` (12:17–12:18 UTC): и `gateway.bepaid.by/transactions/{uid}`, и `beyag.bepaid.by` возвращают 404 `Record not found` практически на каждый UID из старого Jan-cohort. Это объясняет, почему май (131) — 0 fills, апрель (192) — 2, март (178) — 7.

Гипотеза: эти `provider_payment_id` относятся к **другому bePaid shop** (например, subscription-shop или legacy-shop), не к тому, чьи `BEPAID_SHOP_ID/SECRET_KEY` подгружает текущий хелпер. Часть UID в pre-2026 / новых записях успешно резолвится — значит, не credentials в целом сломаны, а конкретный shop scoping.

**Проблема B — cron почти не двигается.** За 6 успешных cron runs (по 25 строк/run = max 150) маркер `bepaid_endpoint_not_found` стоит только на 50 строках. Из 2 645 eligible с UID необработанных остаётся 2 635 (cron «топчется» по тому же хвосту, либо ранний exit). Нужно дочитать функцию и устранить корень — иначе фон не сойдётся даже за сутки.

### 6. Sample

10 успешно подтянутых receipt_url (период 2026-01..02, amount 75–250 BYN): receipts вида `https://merchant.bepaid.by/customer/transactions/...` (живые).

10 missing с UID и `reason=bepaid_endpoint_not_found` (Jan 2026, 100–250 BYN, оба endpoint = 404 Record not found).

### 7. UI /purchases

Хук `useOrderDocuments` и компонент `OrderDocuments` уже читают данные по orderId; кнопка «Скачать чек» в `/purchases` рендерится строго от наличия `payments_v2.receipt_url` — для 313 платежей кнопка есть, для 2 685 пока нет.

---

## План закрытия блока

### Шаг 1 — диагностика 404 (read-only, ~1 правка)

1. Выбрать 5 missing-with-UID из 2026-05 (где >99% 404) и 5 missing-with-UID из 2026-01.
2. По каждому посмотреть `payments_v2.provider_response` и `orders_v2.meta` — какой именно shop/secret использовался при создании транзакции (payment_link vs subscription vs прямой checkout).
3. Сверить `BEPAID_SHOP_ID` в secrets с тем shop_id, который реально возвращал транзакцию (если в provider_response есть).
4. Если подтвердится мульти-shop сценарий — добавить fallback `BEPAID_SUBSCRIPTION_SHOP_ID/SECRET_KEY` в `_shared/bepaid-receipt-fetch.ts` (попытка 1: primary shop, попытка 2: subscription shop).

### Шаг 2 — расследовать «cron не двигается»

1. Прочитать текущий `bepaid-receipts-2026-backfill-cron/index.ts`: пройтись по early-exit веткам (race-guard, hard cap, abort на streak).
2. Проверить, что выборка не возвращает каждый раз один и тот же набор (нужен `ORDER BY created_at ASC` + игнор уже маркированных или smaller-than batch exit).
3. Если виноват «5+ подряд 5xx/4xx → abort» — 404 от bePaid не должен считаться 5xx-streak'ом. Поправить условие.

### Шаг 3 — повторить cron 1–2 часа

После фиксов: дождаться 12–20 cron runs, повторить тот же verify-блок.

### Шаг 4 — закрыть блок

- Если remaining missing после фиксов <50 и все они классифицированы (no_uid + bepaid_no_receipt + endpoint_not_found_after_multi_shop) — закрываем блок, обновляем proof.
- Если 404 системные для целой когорты — фиксируем как «historical no-receipt», добавляем backlog: «manual import чеков из bePaid merchant CSV», обновляем proof.

### Шаг 5 — обновить proof

`.lovable/proofs/bepaid_receipts_2026_backfill_v2_2026_05_22.md`: добавить секции `After-cron verify`, `Multi-shop diagnostics`, `Final missing classification`, `UI confirmation`.

### DoD

- Корневая причина 404 названа (single-shop vs multi-shop vs UID-mismatch).
- Cron реально обрабатывает 25 строк/run без early-exit на 404.
- Финальная разбивка missing по reason с понятными бизнес-формулировками.
- amount/status/order_id/subscriptions/access не менялись (re-verify).
- Кнопка «Скачать чек» в /purchases подтверждена на 2–3 реальных кейсах.
- Proof обновлён.

### Технические детали

- Файлы под правку: `supabase/functions/_shared/bepaid-receipt-fetch.ts` (мульти-shop fallback), `supabase/functions/bepaid-receipts-2026-backfill-cron/index.ts` (early-exit логика).
- Секреты для уточнения у владельца: есть ли отдельные `BEPAID_SUBSCRIPTION_SHOP_ID/SECRET_KEY` или дополнительный shop.
- Никаких изменений по amount/status/order_id/subscriptions_v2/entitlements/access_rules — write-scope строго `payments_v2.receipt_url` + `provider_response.transaction.receipt_url` + `meta.receipt_backfill_*`.