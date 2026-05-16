да, согласен, с учетом правок:

1. **Не утверждать заранее, что canonical writer “не покрывает сценарий”.**  
В шаге 7 формулировать как гипотезу до проверки кода:

```text
Проверить, покрывает ли grant-access-for-order следующие сценарии...
Если не покрывает — зафиксировать gap.
```

2. `writer extend-ориентирован` **не писать как факт до code review.**  
Нужно подтвердить по коду. Иначе можно ошибочно заложить лишний refactor.
3. `nextChargeAt writer возвращает в response` **— это уже изменение контракта.**  
Для discovery можно описать как proposal, но не как обязательное решение. Формулировка:

```text
Возможный контракт: writer возвращает nextChargeAt или webhook рассчитывает provider-sync отдельно, но не меняет access fields.
```

4. **Осторожно с** `status` **в provider-sync.**  
В шаге 6 правильно указано, что `status` нельзя менять, если это active/trial/past_due transition. Добавить:

```text
Любое изменение subscriptions_v2.status, влияющее на платформенный доступ, должно идти только через writer.
```

5. **Добавить проверку связи с payment_method/card token.**  
Если 3DS finalize создаёт или подтверждает payment_method, нужно явно отделить:
  &nbsp;
  - payment method/tokenization state;
  - access grant state.  
  Tokenization может оставаться в webhook, access — только writer.
6. **Добавить output “минимальный execution strategy”.**  
В proof после анализа нужно дать один из вариантов:

&nbsp;

```text
A. grant-access-for-order уже покрывает 3DS finalize → заменить webhook writes на вызов writer.
B. grant-access-for-order покрывает частично → сначала доработать writer, потом заменить webhook.
C. grant-access-for-order не покрывает → нужен отдельный writer-extension patch.
```

7. `.lovable/plan.md` **обновлять только статусом, без изменения scope.**  
Чтобы не потерять предыдущие задачи:

```text
H2.1b = analysis_complete
H2.1c = pending
H3/H4/G = unchanged
```

8. **Добавить no-loss mapping.**  
В proof нужна таблица:

```text
old 3DS finalize behavior
→ target canonical writer behavior
→ provider-sync remains in webhook
→ removed direct access write
```

9. **Добавить explicit blocker для mode=on.**

```text
Даже после H2.1b analysis mode=on остаётся запрещён, пока H2.1b execution и H2.1c не закрыты.
```

После этих правок можно запускать H2.1b как read-only/code-discovery. Код и данные не менять.

&nbsp;

План: PATCH H2.1b — 3DS finalize canonical writer analysis (read-only)

## Scope и stop-list

- Только read-only/code-discovery. 0 production DML. 0 migrations.
- `BEPAID_REBILL_MATERIALIZATION` остаётся `dry_run`. `mode=on` не включается.
- Никаких изменений canonical writer или webhook кода в рамках этого патча — только диагностика и письменный proof.
- Legacy one-time/orphan recovery (H2.1c, ≈5820–6070) не трогаем — отдельный план позже.
- Никакого repair Багинской/Насимовой/Матук и других пользователей.

## Цель

Зафиксировать в виде proof-документа полную карту 3DS finalize ветки `bepaid-webhook` (≈4500–4951), её прямые access-writes, и спецификацию изменений в `grant-access-for-order`, необходимых чтобы эта ветка могла полностью идти через canonical writer без потери поведения (proration, trial bootstrap, multi-candidate guard, tariff change).

## Шаги (read-only)

1. **Идентификация ветки.** Зафиксировать точные границы 3DS finalize блока в `supabase/functions/bepaid-webhook/index.ts`: триггер (status `successful`/3DS notification, payment_v2 уже создан), входные условия (`productV2 && tariff`), guard `orderV2.status === 'paid'`. Указать строки.
2. **Order discovery.** Описать, где и как находится `orderV2`/`paymentV2` (lookup по `payment_v2.order_id`/`bepaid_uid`), какие поля читаются: `is_trial`, `trial_end_at`, `created_at`, `user_id`, `product_id`, `tariff_id`, `meta`, `status`, `customer_email`.
3. **Payment method / card token.** Где сохраняется `bepaid_card_token` / payment_method (вне 3DS finalize, до этой ветки в `WEBHOOK-TRANSACTION`/`LINK-ORDER`). Подтвердить, что 3DS finalize сам по себе токен не создаёт, только потребляет.
4. **Subscription bootstrap логика.** Подробно перечислить специфические шаги, которых сейчас НЕТ в canonical writer:
  - `existingSub` поиск по `(user_id, product_id, status ∈ {active,trial,past_due}, canceled_at IS NULL)` с порядком по `access_end_at DESC` (строка 4541–4551).
  - Multi-candidate STOP-guard + audit `subscription_multi_candidate_review` (4554–4575).
  - past_due без `order_id` → attach текущий order + `status=active` + audit `subscription_order_attached` (4578–4607).
  - Proration при смене тарифа: `oldPaidAmount / oldTariff.access_days × remainingDays / newDailyRate → bonusDays` (4612–4659).
  - `baseAccessDays`: для trial — diff между `trial_end_at` и `created_at`, иначе `tariff.access_days || 30` (4661–4666).
  - `extendFromDate` — продление от `existingSub.access_end_at` только при `isSameTariff && !is_trial` (4668).
  - `nextChargeAt` расчёт: trial+autoCharge → end−1d, recurring non-trial → end−3d (4674–4682).
  - Классификатор `isRecurringSubscription` (offer.meta.recurring.is_recurring || installment || trial+autoCharge) — соответствует Product Type SOT.
5. **Прямые access-writes, которые нужно убрать.** Точный inventory (read-only, со строками):
  - 4761 — `subscriptions_v2.access_end_at` (update extend ветка).
  - 4790–4791 — `subscriptions_v2.access_start_at` / `access_end_at` (insert new sub ветка).
  - 4852–4876 — `entitlements` select + update с GREATEST(`expires_at`).
  - 4880–4892 — `entitlements` insert (`expires_at`, прочие поля).
  - 4926 — `subscriptions_v2.access_end_at` (повторный update?).
  - 4943 — entitlement expires_at в follow-up upsert.
  - Все эти ветки сегодня дублируют функции `grant-access-for-order`.
6. **Provider-sync поля, которые можно оставить за webhook.** То же что и в WEBHOOK-SUBSCRIPTION renewal:
  - `subscriptions_v2`: `billing_type`, `next_charge_at`, `auto_renew`, `meta.bepaid_subscription_id`, `meta.bepaid_*`, `updated_at`.
  - `orders_v2.meta`: gc_sync_*, telegram_access_pending, payment_method_token references.
  - НИ ОДНО из: `access_start_at`, `access_end_at`, `status` (active/trial/past_due transitions), `entitlements.*`, `telegram_access.*`.
7. **Почему canonical writer сегодня не покрывает сценарий.** Зафиксировать gaps в `supabase/functions/grant-access-for-order/index.ts`:
  - Нет bootstrap-ветки «создать subscriptions_v2 с нуля по paid order, если её ещё не существует» (writer extend-ориентирован).
  - Нет proration-калькулятора при смене tariff_id внутри одного product_id.
  - Нет multi-candidate STOP-guard с audit `subscription_multi_candidate_review`.
  - Нет past_due→active reattach со стороны нового order_id.
  - Нет trial-bootstrap (расчёт access_days из `trial_end_at − created_at`, `nextChargeAt = end−1d`).
  - Нет логики выбора `extendFromDate` vs `now` в зависимости от `isSameTariff`.
8. **Спецификация изменений canonical writer (proposal-only, без кода).** Для каждого gap из шага 7 — короткое описание API/контракта:
  - Новый источник вызова `source: 'bepaid_webhook'`, `context: '3ds_finalize'`.
  - Outcomes: `ok` | `skip_*` | `error` | `bootstrap_created` | `manual_review_multi_candidate`.
  - Контракт: writer САМ решает create-vs-extend по `(user_id, product_id, tariff_id)`; webhook не передаёт `accessEndAt`.
  - Proration считается внутри writer по тем же формулам (port 1-в-1, чтобы дни не разошлись).
  - Trial detection — по `orders_v2.is_trial` + `trial_end_at`.
  - `nextChargeAt` writer возвращает в response, webhook записывает в provider-sync update.
  - Audit события сохраняют те же имена (`subscription_multi_candidate_review`, `subscription_order_attached`) — переезжают внутрь writer.
9. **План тестов (без выполнения).** Перечислить контрактные тесты, которые нужно будет добавить в H2.1b execution:
  - 3DS finalize → writer вызван ровно 1 раз с правильным `source/context`.
  - При `outcome=skip_*` — 0 прямых access writes, audit `bepaid.webhook.grant_skipped_no_fallback`.
  - При смене tariff_id — proration считается writer'ом, бонусные дни сохранены.
  - Multi-candidate → writer возвращает `manual_review_multi_candidate`, webhook не пишет.
  - Trial bootstrap → writer создаёт subscriptions_v2 с access_end_at = trial_end_at.
  - past_due reattach → writer переводит в active с новым order_id.
  - Static check: 0 матчей по `from('subscriptions_v2').update.*access_(start|end)_at` и `from('entitlements').(insert|update|upsert).*expires_at` в 3DS finalize диапазоне.
10. **Proof и DoD.**
  - Файл: `.lovable/proofs/patch_h2_1b_3ds_finalize_analysis_2026_05.md`.
    - Содержит: точные строки, inventory access-writes, gap-list, спецификация изменений writer, план тестов, явное подтверждение «0 DML, 0 migrations, mode=on не менялся, код webhook/writer не изменён».
    - Update `.lovable/plan.md`: статус H2.1b = analysis_complete, готов к execution (отдельный план/патч).

## Что НЕ делается в этом патче

- Код canonical writer не изменяется.
- Код webhook не изменяется.
- Тесты не пишутся (только список).
- Legacy path (H2.1c) не анализируется.
- Никакие production данные не правятся.
- `BEPAID_REBILL_MATERIALIZATION` не трогается.

## DoD

- proof-файл создан и содержит все 10 разделов выше.
- `.lovable/plan.md` обновлён со статусом H2.1b.
- Подтверждено: 0 правок в `supabase/functions/bepaid-webhook/index.ts`, 0 правок в `supabase/functions/grant-access-for-order/index.ts`, 0 migrations, 0 production DML.
- Следующий шаг (после approve этого discovery) — отдельный план «PATCH H2.1b execution» с кодовыми изменениями canonical writer и заменой 3DS finalize ветки.