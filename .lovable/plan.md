# да, согласен, с учетом правок:

&nbsp;

1. **В блоке C structured meta добавь ещё subscription_id в subscription-renewal-reminders.**
  &nbsp;
  - В финальном наборе полей для **обоих** writers должен быть один и тот же полный контракт:
  - subscription_id, product_id, product_name, club_id, club_name, effective_end_at, amount, currency, pricing_mode, source
  - Сейчас в твоём тексте для renewal reminders subscription_id не перечислен явно.
  &nbsp;
2. **В блоке B живой proof по email нужно строить не только по telegram_logs.**
  &nbsp;
  - Основной источник proof для email — именно email outbox / send log / delivery log, если он есть.
  - telegram_logs допустим только как вспомогательный источник для сопоставления событий, но не как основной proof email-отправки.
  - Это нужно прямо зафиксировать в плане, чтобы потом не закрыли email proof по Telegram-логам.
  &nbsp;
3. **В блоке D явно зафиксируй правило про passthrough surfaces.**
  &nbsp;
  - Чтобы потом не было спора, допиши:
  - generate-renewal-ctas, public-checkout, admin-create-payment-link, email/TG price text **не принимают pricing decision**, а только используют уже рассчитанную цену.
  - Поэтому их proof — это не “читают product_reentry_pricing напрямую”, а “не содержат собственной pricing-логики и получают amount извне”.
  - Это важное уточнение для финальной матрицы.
  &nbsp;
4. **В блоке A3/A4 добавь обязательный audit для corrective notifications и shortened CSV.**
  &nbsp;
  - Нужен отдельный actor_label, batch_id, counts:
    &nbsp;
    - сколько auto-notify отправлено;
    - сколько попало в shortened manual review;
    - сколько minor skipped.
    &nbsp;
  - Иначе corrective tail потом будет трудно доказать.
  &nbsp;
5. **В блоке A2 по wrongly_removed / valid_not_in_chat добавь явный post-check.**
  &nbsp;
  - Не только “обработан”, а:
  - сколько queued;
  - сколько skipped как duplicates;
  - сколько ушло в manual_review.
  - Это нужно для конечного before/after summary.
  &nbsp;
6. **В блоке E final architecture proof добавь отдельную строку по subscription-charge.**
  &nbsp;
  - Сейчас у тебя есть Telegram renewal как поверхность, но лучше явно выделить:
  - subscription-charge = источник renewal execution, pricing_mode/source, notification trigger.
  - Иначе центральная функция теряется внутри общей строки.
  &nbsp;
7. **pending-live-proof зафиксируй в DoD как допустимый исход только для одного пункта.**
  &nbsp;
  - То есть:
  - весь патч может считаться выполненным с пометкой pending-live-proof только по first live renewal proof;
  - остальные пункты должны быть закрыты фактически, не “по коду”.
  - Это лучше написать прямо в финальном разделе.
  &nbsp;
8. **В финальном отчёте потребуй раздельный итог по фазам:**
  &nbsp;
  - done
  - manual_review
  - pending-live-proof
  - not-needed / passthrough
  - Так будет проще принять план без повторных уточнений.
  &nbsp;

&nbsp;

&nbsp;

В остальном план собран правильно: он уже сфокусирован именно на незакрытых хвостах и логично отделяет corrective tail, email proof, pricing coverage, structured meta и architecture proof.

&nbsp;

План: PATCH-FINAL-CLEANUP v2 — доотчёт по незакрытым пунктам

---

## Контекст

Уже сделано и принято: product-scoped reentry pricing, anti-stale guard для superseded, частичная structured meta. Нужно закрыть оставшиеся пункты одним проходом.

---

## Блок A: PHASE 1 — corrective tail (one-off SQL + data)

### A1. Mirror missing

- SQL dry-run: найти пары user_id+club_id где `telegram_access` row отсутствует, но canonical access валиден
- Execute: создать row или queue grant
- After-query: подтвердить mirror_missing = 0

### A2. Wrongly removed + valid_not_in_chat

- SQL dry-run: два отдельных списка с полями user_id, club_id, effective_end_at, valid_source, membership_state, recommended_action
- Idempotency guard: проверить pending/processing в telegram_access_queue
- Execute: queue_regrant если effective_end_at > now + 1d, иначе manual_review
- After-query: оба списка закрыты или вынесены в manual_review файл

### A3. Corrective notifications

- Собрать affected users (old_mirror vs new_effective, diff > 1 day)
- Extended > 1d → auto-notify per-club, template: «ℹ️ Уточнён срок доступа к {club_name}. Актуальный срок: до {date} (по Минску).»
- Shortened → manual_review list (отдельный CSV)
- After: подтвердить counts auto-sent / manual-review

### A4. Shortened list

- Отдельный файл `/mnt/documents/corrective_shortened_manual_review.csv`
- Поля: user_id, club_id, club_name, old_date, new_date, diff_days, reason

---

## Блок B: PHASE 2 — email stale-reminders живой proof

- SQL по `email_send_log` + `telegram_logs` после даты деплоя anti-stale guard
- Найти все renewal/grace email events, сверить sent_at с текущим access_end_at подписки
- Показать: count valid / count stale / count skipped_superseded
- Если stale = 0 → зафиксировать как живой proof
- Если stale > 0 → добавить pre-send recheck

---

## Блок C: PHASE 4 — дополнить structured meta

### Текущее состояние

- `subscription-renewal-reminders` meta: есть product_id, product_name, amount, currency, source. **Нет**: club_id, club_name, effective_end_at, pricing_mode
- `subscription-grace-reminders` meta: есть subscription_id, product_name, club_id, club_name, amount, currency, source. **Нет**: product_id, effective_end_at, pricing_mode
- `subscription-charge` renewal notification: нет structured meta в telegram_logs (логи идут через другой путь)

### Фикс

Дополнить meta во всех трёх файлах полным набором:
`subscription_id, product_id, product_name, club_id, club_name, effective_end_at, amount, currency, pricing_mode, source`

Затронутые файлы:

- `supabase/functions/subscription-renewal-reminders/index.ts` — строка ~398: добавить club_id, club_name, effective_end_at, pricing_mode
- `supabase/functions/subscription-grace-reminders/index.ts` — строка ~194: добавить product_id, effective_end_at, pricing_mode

Деплой обоих функций после правки.

---

## Блок D: PHASE 3 — pricing surfaces coverage proof

### Матрица покрытия

Все pricing surfaces и их статус reentry pricing:


| Поверхность                  | Использует product_reentry_pricing    | Статус                          |
| ---------------------------- | ------------------------------------- | ------------------------------- |
| `public-product`             | Да (строка 40-97)                     | Переведён                       |
| `public-product-by-slug`     | Да (строка 32-77)                     | Переведён                       |
| `public-tariff-by-public-id` | Да (строка 96-120)                    | Переведён                       |
| `generate-renewal-ctas`      | Нет — принимает amount извне          | Не нужен (passthrough)          |
| `public-checkout`            | Нет — берёт amount из order/offer     | Не нужен (amount уже определён) |
| `admin-create-payment-link`  | Нет — админ задаёт amount             | Не нужен                        |
| Email/TG price text          | Amount берётся из subscription/tariff | Не нужен (amount уже определён) |


Вывод: все 3 pricing-определяющие поверхности переведены. Остальные — passthrough (используют уже определённую цену).

Code proof: grep `was_club_member` в pricing surfaces → остался только в `markAsExpiredReentry` (legacy backward compat flag), не используется для pricing decision.

---

## Блок E: PHASE 6 — final architecture proof матрица

Собрать и показать итоговую таблицу:


| Поверхность                  | Источник даты                                    | Источник цены                      | Per-club/product isolation         | Proof                                  |
| ---------------------------- | ------------------------------------------------ | ---------------------------------- | ---------------------------------- | -------------------------------------- |
| UI карточка                  | subscriptions_v2.access_end_at                   | tariff_offers.amount               | per-product                        | Читает canonical DB                    |
| Telegram renewal             | resolveEffectiveClubAccess                       | tariff_offers.amount (passthrough) | per-club via product_club_mappings | subscription-charge:1790               |
| Email renewal                | subscriptions_v2.access_end_at                   | tariff_offers.amount               | per-product                        | subscription-renewal-reminders         |
| Email grace                  | subscriptions_v2.access_end_at                   | tariff_offers.amount               | per-product                        | subscription-grace-reminders           |
| Telegram grace               | resolveEffectiveClubAccess                       | tariff_offers.amount               | per-club                           | subscription-grace-reminders           |
| Revoke/kick                  | resolveEffectiveClubAccess + hasValidAccessBatch | N/A                                | per-club                           | telegram-kick-violators, check-expired |
| Public pricing (3 endpoints) | N/A                                              | product_reentry_pricing            | per-product                        | PATCH-FINAL code                       |
| Payment links/CTA            | N/A                                              | amount from tariff/offer           | per-product                        | generate-renewal-ctas passthrough      |


---

## Блок F: batch results summary

Собрать итоговую таблицу по всем batches:


| Batch                    | actor_label                  | batch_id                     | Affected  | Status  |
| ------------------------ | ---------------------------- | ---------------------------- | --------- | ------- |
| Mirror backfill          | patch_mirror_backfill        | (from prev run)              | count     | done    |
| Membership repair        | patch_wrongly_removed_repair | (from prev run)              | 11 queued | done    |
| Reentry pricing repair   | reentry_repair_20260401_0930 | reentry_repair_20260401_0930 | 36 reset  | done    |
| Mirror missing           | patch_mirror_missing         | (new)                        | TBD       | execute |
| Corrective notifications | patch_corrective_notify      | (new)                        | TBD       | execute |


Before/after diff по reconciliation: повторить dry-run запрос, показать counts по категориям.

---

## Порядок выполнения

1. SQL dry-run: mirror_missing, wrongly_removed, valid_not_in_chat, corrective notifications
2. Execute corrective tail (A1-A4)
3. Email stale-reminder live proof (B)
4. Дополнить structured meta в 2 файлах (C) + deploy
5. Собрать pricing coverage proof (D) — read-only
6. Собрать architecture proof матрицу (E) — read-only
7. Собрать batch results summary (F) — SQL
8. Финальный отчёт с before/after

---

## Изменяемые файлы


| Файл                                      | Изменение                                                          |
| ----------------------------------------- | ------------------------------------------------------------------ |
| `subscription-renewal-reminders/index.ts` | Дополнить meta: club_id, club_name, effective_end_at, pricing_mode |
| `subscription-grace-reminders/index.ts`   | Дополнить meta: product_id, effective_end_at, pricing_mode         |


Остальное — SQL queries, one-off data fixes, proof reports.

## DoD

- mirror_missing = 0 (с SQL proof)
- wrongly_removed / valid_not_in_chat: закрыты или в manual_review
- corrective auto-notify отправлен (extended > 1d)
- shortened list в отдельном CSV
- email stale proof: живой (не code-only)
- structured meta: все 10 полей во всех notification writers
- pricing surfaces: матрица покрытия с proof
- architecture proof: итоговая матрица
- batch summary: before/after
- pending-live-proof: зафиксирован отдельно