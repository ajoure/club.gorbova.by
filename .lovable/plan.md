## да, согласен, с учетом правок:

Да, согласен, с учетом правок.

План финального закрытия PATCH-STRIPE-UI-INTEGRATION-CLEANUP-V1 через UI-proof принят.

Код и миграции не трогать. Только read-only SQL, UI-скрины и обновление proof.

---

# **Обязательные правки к плану**

## **1. Не закрывать PATCH только по текстовому отчёту**

Финальный статус:

```text
PATCH = CLOSED
```

можно ставить только если proof содержит:

- SQL-снапшоты;
- after-скрины;
- ссылки на скрины;
- финальную таблицу Stage 1 / 2A / 2B / 2C / 2D / 2E;
- список backlog carried over.

Если хотя бы один скрин противоречит логике — PATCH не закрывать, а открыть точечный fix.

---

## **2. Уточнить пункт про 12 скринов**

Не обязательно именно 12 отдельных файлов, если один скрин покрывает несколько пунктов.

Но в proof должны быть закрыты все проверки:

```text
карточка контакта
PublicPayPage
PaymentsTable Stripe $2
PaymentsTable Stripe +5 BYN
PaymentsTable Stripe refund -5 BYN
bePaid payment regression
Stripe payment document
Stripe refund document
bePaid document regression
Unified Subscriptions
AutoRenewals
SQL cohort explanation
```

Можно делать один скрин на несколько пунктов, но в proof явно подписать, какие пункты он закрывает.

---

## **3. По AutoRenewals не требовать Stripe-строку, если её нет в когорте**

Для AutoRenewals proof должен честно показать:

```text
Stripe active recurring row сейчас отсутствует по SQL, потому что нет active/trialing/past_due + auto_renew=true + sub_* + next_charge_at.
```

Это не FAIL, если SQL подтверждает отсутствие подходящей Stripe-подписки.

Но layout и bePaid regression показать обязательно.

---

## **4. По карточке контакта Сергея**

Так как Stripe-подписка Сергея уже отменена, в активном блоке её быть не должно.

Proof должен показать:

- активной Stripe-подписки в карточке нет;
- доступ не отозван;
- если есть блок доступа/entitlement — он сохранён до `access_end_at`;
- `Следующее списание` не подменено через `access_end_at`.

Если в карточке нет активной подписки, не требовать дату следующего списания именно по отменённой подписке. Достаточно показать, что логика не врёт.

---

## **5. По PaymentsTable payer/card**

Обязательно отдельно зафиксировать:

- `$2 Stripe` может показывать «Карта не определена», если в историческом meta нет card-data;
- `+5 BYN Stripe` должен показывать `VISA **** 3587`, если данные есть;
- `-5 BYN refund` должен наследовать карту parent payment;
- bePaid строки показывают карты как раньше.

Если `$2` без card-data — это не FAIL, а backlog:

```text
PATCH-STRIPE-CARD-DATA-ENRICHMENT-V2
```

---

## **6. По Stripe documents**

Proof должен не просто показать кнопку, а подтвердить фактическое открытие URL.

Минимум:

- скрин таблицы с кнопкой;
- скрин открытой Stripe hosted page / receipt / invoice;
- подпись, какой row открыл какой URL.

Важно:

```text
payment row не открывает refund-документ
refund row не пишет «документ ещё не получен», если fallback URL есть
```

---

## **7. По PublicPayPage**

Нужно использовать актуальную Stripe subscription payment link.

Proof должен показать:

- provider = Stripe;
- payment_type = subscription;
- нет disabled bePaid saved card;
- нет текста «Белорусская карта»;
- есть Stripe/Apple Pay hint;
- CTA ведёт в Stripe Checkout.

Не выполнять реальную оплату.

---

# **Исправленный финальный DoD**

PATCH-STRIPE-UI-INTEGRATION-CLEANUP-V1 = CLOSED, если:

1. Все Stage 1 / 2A / 2B / 2C / 2D / 2E отмечены PASS.
2. SQL-снапшоты добавлены в proof.
3. UI-скрины добавлены в proof.
4. Stripe и bePaid в одной таблице «Подписки».
5. AutoRenewals layout исправлен и SQL объясняет отсутствие Stripe-строк, если их нет.
6. PaymentsTable:
  - Stripe документы через единую кнопку;
  - Stripe payer/card отображается корректно или честно указано отсутствие card-data;
  - bePaid не сломан.
7. PublicPayPage Stripe subscription clean от bePaid-текстов.
8. «Проблемы с оплатой» скрыта из nav.
9. Backlog перенесён:
  - `PATCH-STRIPE-BULK-CANCEL-V2`;
  - `PATCH-STRIPE-BILLING-PERIOD-MODE-V2`;
  - `PATCH-STRIPE-CARD-DATA-ENRICHMENT-V2`;
  - `PATCH-STRIPE-DOCUMENTS-DRAWER-V2`.
10. Не было code/migration changes в этом финальном proof-step.

---

# **Команда**

Выполняй финальный UI-proof.

Код не менять.

Если на любом скрине обнаружится расхождение — остановиться и дать отдельный план точечного фикса, не ставить `PATCH = CLOSED`.

&nbsp;

План: финальное закрытие PATCH-STRIPE-UI-INTEGRATION-CLEANUP-V1 через UI-proof

Цель — собрать фактические скрины/SQL-факты по 6 чек-пунктам ревью и обновить `.lovable/proofs/stripe_ui_provider_parity_cleanup_v1.md`. Кода не трогаем — все Stage 1 / 2A–2E уже PASS по логике.

### Этап 1. Diagnose — собрать SQL-факты (read-only)

Через `supabase--read_query` зафиксировать в proof ровно те значения, которые отрисуются на скринах:

1. Stripe subscription Сергея (`sub_1TgWoO...`) — `provider_subscriptions` + `subscriptions_v2.meta.stripe.current_period_end`, `status`, `access_end_at`.
2. Stripe $2 payment (`pi_3TgWoM...`) — `payments_v2.meta.stripe` (подтвердить отсутствие card data → ожидаем «Карта не определена»).
3. Stripe +5 BYN payment и -5 BYN refund — `payments_v2` parent/refund pair, проверить `card_brand/card_last4` или `meta.stripe.payment_method_details.card`.
4. bePaid контрольная строка — взять одну активную и одну с receipt для регресс-скрина.
5. AutoRenewals когорта — SQL по `subscriptions_v2 WHERE meta->'recurring'->>'is_recurring'='true' AND provider='stripe' AND status IN ('active','past_due')` → подтвердить пустой набор, обосновать отсутствие Stripe-строки.

### Этап 2. UI-proof — скрины через preview (`/admin/payments`, карточка контакта, PublicPayPage)

Для каждого скрина: `browser--navigate_to_url` → при необходимости логин «Login as Developer» (`123456`) → `browser--screenshot`. Файлы складываем в `/mnt/documents/proofs/stripe_ui_cleanup_v1/` и линкуем из proof-файла.

Перечень обязательных скринов (1 файл = 1 пункт ревью):

```text
01_contact_card_sergey.png        — карточка контакта Сергея
                                    • «Следующее списание: …» и «Доступ до: …» раздельно
                                    • cancelled Stripe-sub НЕ в активном блоке
                                    • access сохранён
02_public_pay_page_stripe.png     — PublicPayPage для Stripe-tariff
                                    • нет disabled bePaid card
                                    • нет «Белорусская карта»
                                    • есть Stripe/Apple Pay hint
                                    • CTA → Stripe Checkout
03a_payments_table_stripe_2usd.png   — строка $2 Stripe sub payment → «Карта не определена»
03b_payments_table_stripe_5byn.png   — строка +5 BYN → VISA **** XXXX
03c_payments_table_stripe_refund.png — строка -5 BYN refund → карта от parent
03d_payments_table_bepaid_regression.png — bePaid-строка с картой как раньше
04a_documents_stripe_payment.png  — клик «документ» на Stripe payment → открывается receipt
04b_documents_stripe_refund.png   — клик «документ» на refund → receipt/hosted page с refund info
04c_documents_bepaid_regression.png — bePaid receipt UX
05_unified_subscriptions_all.png  — таблица «Подписки», bePaid+Stripe вместе, фильтр provider, Stripe cancelled видна в «Все» и «Отменена»
06_auto_renewals_layout.png       — AutoRenewals: layout цел, provider-badge есть, bePaid строки, отсутствие Stripe объяснено SQL из Этапа 1
```

### Этап 3. Обновить proof-файл

`.lovable/proofs/stripe_ui_provider_parity_cleanup_v1.md`:

- секция «Final UI Proof» со ссылками на 12 скринов выше и краткой подписью к каждой;
- секция «SQL Snapshots» с выводами из Этапа 1 (с timestamp запроса);
- финальная таблица статусов: Stage 1, 2A, 2B, 2C, 2D, 2E = PASS, PATCH = CLOSED;
- блок «Backlog carried over»:
  - PATCH-STRIPE-BULK-CANCEL-V2
  - PATCH-STRIPE-BILLING-PERIOD-MODE-V2
  - PATCH-STRIPE-CARD-DATA-ENRICHMENT-V2
  - PATCH-STRIPE-DOCUMENTS-DRAWER-V2
- ссылка-плейсхолдер на `.lovable/proofs/stripe_master_sprint_final_closure_v1.md` (будет создан отдельным шагом, не в этом PATCH).

### Этап 4. Verify (DoD)

PATCH считается CLOSED только если:

- все 12 скринов лежат в `/mnt/documents/proofs/stripe_ui_cleanup_v1/` и отрендерены как `<presentation-artifact>`;
- proof-файл обновлён и содержит SQL-снэпшоты + ссылки на скрины;
- ни один скрин не противоречит логике Stage 2A–2E;
- bePaid-регрессия (скрины 03d, 04c, 05, 06) визуально идентична до-патч поведению.

### Технические детали

- Кода и миграций не пишем; только чтение БД и скриншоты.
- Для скринов используем preview URL (`/admin/payments`, карточка контакта по deep-link, `/pay/<token>` для PublicPayPage). При необходимости проходим «Login as Developer» с паролем `123456`.
- Если какой-то скрин выявит расхождение с логикой Stage 2D/2E — НЕ закрываем PATCH, открываем точечный фикс отдельным сообщением (формат «План: …»).

### Out of scope (в backlog, не делаем сейчас)

- enrichment card data для исторических Stripe-платежей (PATCH-STRIPE-CARD-DATA-ENRICHMENT-V2);
- bulk cancel, billing period mode, documents drawer (отдельные PATCH'и);
- мастер-закрытие Stripe sprint (`stripe_master_sprint_final_closure_v1.md`).