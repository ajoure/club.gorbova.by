да, согласен, с учетом правок:

1. Proof обязателен до любого нового execute.

    Сначала закрыть reconciliation по Казачек, потому что она показала, что H5-refresh v2 пропустил явный майский платеж.

2. b458870d должен стать контрольным кейсом для всех будущих H5 batch.

    Добавить в DoD:

если `b458870d` не попадает в green May batch — batch запрещён до объяснения причины

3. Не делать новый H5-refresh v3 “вообще”, пока не найдена причина пропуска.

    Сначала выяснить точный фильтр, который отсеял b458870d:

refund guard

already_materialized

sbs_unresolved

recurring SOT

split signal

parent_would_be_orphaned

CSV/export bug

4. По Казачек вывод уже понятен:

    * ffb88444 — исправлен корректно;

    * b458870d — не исправлен, должен быть отдельной майской REBILL-сделкой;

    * 0f854c28 — refund/edge, отдельно.

5. После proof следующий шаг должен быть не “майский batch на 69 строк”, а H5-refresh v3 с контрольными assert.

    Обязательные asserts:

b458870d -> green

ffb88444 -> skip_done

0f854c28 -> manual_review:refund_related

b9d946d4 -> manual_review:refund_or_tariff_upgrade_flow

6bfead3b -> manual_review:parent_would_be_orphaned

6. Команда Lovable:

План H5-Kazachek reconciliation подтверждаю.

Выполни строго read-only:

- построить payment→deal таблицу по Казачек;

- проверить b458870d;

- проверить, почему b458870d не попал в H5-refresh v2 green;

- подтвердить, что ffb88444 реально перепривязан к REBILL;

- подтвердить, что 0f854c28 refund-related и не должен идти в green;

- создать proof.

Запрещено:

- DML;

- любые UPDATE/INSERT/DELETE;

- grant-access-for-order;

- provider API;

- Telegram;

- secrets/mode changes.

Proof:

.lovable/proofs/h5_kazachek_payment_to_deal_reconciliation_2026_[05.md](http://05.md)

После proof:

- не запускать execute;

- дать точную причину пропуска b458870d;

- предложить H5-refresh v3 с обязательным assert, что b458870d попадает в green.

Коротко: этот план правильный. Сначала фиксируем доказательство, почему майский платеж Казачек потерялся, потом пересобираем общий H5 список уже с контрольными проверками.

&nbsp;

План: H5-Kazachek payment-to-deal reconciliation (read-only)

Цель
Построить read-only proof «платёж → сделка» по всем bePaid-платежам Натальи Казачек (`profile_id = 82ffd5ca-70fb-4551-bc9f-eb0f235773ca`) за 2026 и явно идентифицировать склеенные платежи без отдельной сделки. DML строго запрещён.

Что уже подтверждено read-only запросами (snapshot 2026-05-17 ~12:00 Minsk)

Все успешные bePaid-платежи Казачек за 2026:


| #   | payment_id (короткий) | paid_at Minsk        | amount  | order_number            | order_date Minsk | is_rebill | succ_pay_on_order | verdict                                                                                       |
| --- | --------------------- | -------------------- | ------- | ----------------------- | ---------------- | --------- | ----------------- | --------------------------------------------------------------------------------------------- |
| 1   | `a4f8ad68`            | 2026-01-06 18:54     | 250     | PAY-26-MKOBO8E3         | 2026-01-06       | –         | 1                 | ✅ correct                                                                                     |
| 2   | `97463c5c`            | 2026-02-05 19:00     | 1.00    | — (orphan)              | —                | —         | —                 | card-check, no deal expected                                                                  |
| 3   | `5f8b16dd`            | 2026-02-05 19:00     | 1.00    | — (orphan)              | —                | —         | —                 | card-check, no deal expected                                                                  |
| 4   | `2d840b97`            | 2026-02-06 17:01     | 250     | ORD-26-MLAYEWNS         | 2026-02-06       | –         | 1                 | ✅ correct                                                                                     |
| 5   | `6d24707a`            | 2026-03-09 12:27     | 250     | SUB-LINK-MMIZ52FC       | 2026-03-09       | –         | 3                 | ✅ correct (parent initial)                                                                    |
| 6   | `0f812d75`            | 2026-04-09 16:48     | 250     | SUB-26-MNRJ58S9J89C     | 2026-04-09       | –         | 1                 | ✅ correct (separate Apr deal)                                                                 |
| 7   | `ffb88444`            | 2026-04-10 06:00     | 250     | **REBILL-ffb88444-c5d** | 2026-04-10       | ✅         | 1                 | ✅ correct — H5.1b-Apr execute сработал                                                        |
| 8   | `0f854c28`            | 2026-04-10 15:55     | 250     | SUB-LINK-MMIZ52FC       | 2026-03-09       | –         | 3                 | ⚠️ refund-related (парный refund 250 на parent от 2026-04-10 12:55 «переплата») — H5.2 manual |
| 9   | `**b458870d**`        | **2026-05-08 12:31** | **250** | **SUB-LINK-MMIZ52FC**   | **2026-03-09**   | –         | 3                 | ❌ **СКЛЕЕНО — нет майской сделки**                                                            |


Ответы на вопросы пользователя

1. ffb88444 — execute сработал. Платёж перепривязан к `REBILL-ffb88444-c5d` (order id `6042768c-c6ad-4a2d-a818-7e5c6e3e1d07`, deal_date 2026-04-10).
2. Платёж 08.05.2026 250 BYN = `b458870d-cfad-4828-8e2a-d5e0b8cb5e5c` (provider_payment_id `a4872944-b2a8-41b5-92bd-e55f84ddc18a`). Сейчас висит на мартовском parent `SUB-LINK-MMIZ52FC`. Отдельной майской сделки НЕТ — UI прав, это и есть склейка.
3. На parent `SUB-LINK-MMIZ52FC` сейчас 3 succeeded платежа: March-initial `6d24707a` (корректно), April-refund-twin `0f854c28` (H5.2), May-rebill `b458870d` (должен быть REBILL за май).

Почему `b458870d` не попал в H5-refresh v2 green=73 — гипотезы для верификации в proof

- snapshot v2 был сделан 2026-05-17 09:35 UTC, платёж от 2026-05-08 — должен был попасть; нужно явно проверить, есть ли `b458870d` в `.lovable/proofs/h5_refresh_v2_frozen_candidates_2026_05.csv` и под каким guard_status.
- Если отсутствует — проверить, какой именно фильтр отсёк (refund_present? sbs_unresolved? already_materialized? parent_would_be_orphaned уже не сработает — на parent 3 succ).
- Это даёт точную причину «UI показывает 08.05 payment без майской сделки».

Шаги (только read-only)

1. Read-only SQL по `payments_v2 ⨝ orders_v2` для profile_id Казачек 2026 (уже выполнено, данные выше).
2. Read-only по parent `SUB-LINK-MMIZ52FC`: список всех payments (succ/failed/refund), parent.meta.bepaid_refund, sbs, payment_flow.
3. Read-only по `b458870d`: payment.meta (bepaid_subscription_id, refunded_amount, recurring markers), guard-проверка по канону v2 (split signal, recurring SOT, sbs_resolved, non_refund_succ_on_parent после гипотетического move, refund_present, already_materialized).
4. Read-only grep по frozen CSV v2 — есть ли `b458870d` и под каким статусом; если нет — какой именно guard его отсёк (восстановить решение).
5. Read-only по `0f854c28` — подтвердить refund-twin (paired refund 250 BYN на parent, `bepaid_refund.parent_uid` mapping).
6. Сгенерировать proof-файл со всей таблицей и итоговыми выводами.

Файлы

- Новый: `.lovable/proofs/h5_kazachek_payment_to_deal_reconciliation_2026_05.md`
- Только чтение: `.lovable/proofs/h5_refresh_v2_frozen_candidates_2026_05.csv`, `.lovable/proofs/h5_1b_apr_historical_rebill_execute_2026_05.md`

Итоговые выводы (предварительно, будут зафиксированы в proof)

1. Корректные отдельные сделки: `a4f8ad68` (Jan), `2d840b97` (Feb), `6d24707a` (Mar parent), `0f812d75` (Apr separate), `ffb88444` (Apr REBILL after H5.1b execute).
2. Склеено: `**b458870d` (08.05.2026, 250 BYN)** — кандидат на REBILL-May, должен быть включён в next H5 batch.
3. Refund/edge: `0f854c28` (Apr-10 12:55) — refund-twin, H5.2 manual review, в green не идёт.
4. Orphan без сделки: два card-check платежа по 1 BYN от 2026-02-05 — не требуют сделок.
5. Отсутствует майская сделка именно потому, что H5-refresh v2 либо пропустил `b458870d`, либо отсёк его guard'ом — точная причина будет указана в proof после verify шага 4.
6. Рекомендация после proof: переоткрыть H5-refresh v3 c явной включающей проверкой по Казачек и пересобрать майский batch до любого нового execute.

Запреты

- DML запрещён.
- Никаких изменений `orders_v2`, `payments_v2`, `subscriptions_v2`, `entitlements`, `access_rules`, Telegram, provider_subscriptions, refunds.
- `grant-access-for-order` не вызывается.
- secrets/mode не меняются.
- H5 execute по любым старым выборкам ОСТАНОВЛЕН до закрытия этого proof.

DoD

- Файл `.lovable/proofs/h5_kazachek_payment_to_deal_reconciliation_2026_05.md` создан и содержит:
  - полную таблицу payment→deal (9 строк выше);
  - явный verdict по `b458870d` (склеено, нет May-сделки);
  - явный verdict по `ffb88444` (execute сработал);
  - объяснение, почему `b458870d` не оказался в H5-refresh v2 green;
  - список payment_id, которые нужно перенести (минимум `b458870d`);
  - подтверждение, что DML не выполнялся.