## да, согласен, с учетом правок:

1. **Разделить P0 и hygiene в отчётах**

Выполнять можно в указанном порядке, но отчёты должны быть отдельные:

```text
Отчет о выполненной работе: PATCH-DEMO-TRIAL-NO-CARD-ACTIVATION
```

и затем:

```text
Отчет о выполненной работе: PATCH-PREORDER-CONVERT-AUDIT-FIX
```

Не смешивать P0 trial-активацию и audit-fix в один отчёт.

---

2. **В** `bepaid-create-token` **ветка no-card trial должна быть до любых bePaid/subscription/tokenization веток**

Критично:

```text
trial amount=0 + requires_card_tokenization=false
```

должен завершаться **без обращения к bePaid**.

То есть ветка должна срабатывать до:

- legacy subscription guard;
- bePaid token creation;
- subscription payload;
- MIT/tokenization;
- provider redirect.

Иначе снова получим:

```text
BLOCKED: legacy subscription path attempted without explicit choice
```

---

3. **Уточнить** `order` **/** `orders_v2`**: не создать два заказа**

В плане есть формулировка:

```text
1) пометить order как paid
2) если productInfo.isV2 — создать orders_v2
```

Нужно проверить текущую архитектуру `bepaid-create-token`: где именно уже создаётся order до этой ветки.

Правило:

```text
Не создавать дубликат orders_v2, если order уже создан выше.
```

Если текущий flow уже создал `orders_v2` до trial-ветки — нужно только обновить его:

```text
status='paid'
is_trial=true
paid_at=now()
trial_end_at=now()+trial_days
meta.source='trial_no_card'
```

Если order ещё не создан — создать один канонический `orders_v2`.

В отчёте показать:

```text
orders_v2: создана/обновлена ровно 1 строка
```

---

4. `grant-access-for-order` **вызывать только после paid-status фиксации**

Правильно:

```text
orders_v2.status='paid'
paid_at set
trial_end_at set
meta.source='trial_no_card'
→ grant-access-for-order
```

Не вызывать grant до фиксации paid/trial статуса, иначе downstream может не найти корректный order state.

---

5. **Trial no-card должен использовать canonical write path**

Подтверждаю:

```text
НЕ писать entitlements/access_grant_ledger руками
```

Только:

```text
grant-access-for-order
```

Это обязательно сохранить.

---

6. **CRM routing snapshot для trial no-card**

Добавить в proof:

```text
orders_v2.meta.crm_routing_snapshot присутствует / stage выставлена так же, как в обычном successful flow
```

Если у trial-оффера есть `meta.crm_routing`, оно должно попасть в order так же, как у других успешных order.

---

7. **Повторный trial guard проверить до создания нового order**

Проверка `alreadyUsedTrial` должна срабатывать до создания нового paid trial order.

В proof показать:

```text
повторная попытка тем же email не создаёт второй orders_v2
не создаёт второй grant
возвращает alreadyUsedTrial=true
```

---

8. **Frontend: не только redirect, но и корректный UX при уже использованном trial**

В `PaymentDialog` добавить/подтвердить обработку:

```text
alreadyUsedTrial=true
```

Чтобы пользователь не видел generic «Функция временно недоступна».

---

9. **Regression smoke по платным офферам**

Минимально проверить:

- pay_now bePaid redirect создаётся;
- Stripe provider choice не сломан, если доступен для продукта;
- recurring provider-side flow не попал в no-card ветку.

No-card ветка должна иметь строгий guard:

```ts
isTrial && paymentAmount === 0 && requiresCardTokenization === false
```

---

10. **Audit в** `bepaid-create-token`

Для P0 достаточно:

```text
trial.no_card.activated
```

Но не глушить ошибку audit так, чтобы она ломала активацию. Audit failure может быть warning-only, но в отчёте нужно показать хотя бы одну успешную audit-запись.

---

11. **PATCH-PREORDER-CONVERT-AUDIT-FIX — не менять бизнес-логику RPC**

Согласен:

- только audit-block;
- `actor_id → actor_user_id`;
- `actor_type='system'`;
- `actor_label='convert_preorder_on_pay_atomic'`;
- не менять matching;
- не менять idempotency;
- не менять CRM hide;
- не менять post-grant hook.

---

12. **Audit exception handling**

Формулировку поправить:

```text
EXCEPTION WHEN undefined_column OR insufficient_privilege THEN RAISE WARNING
```

недостаточно, потому что schema mismatch может быть не единственной ожидаемой ошибкой.

Лучше:

- audit insert внутри отдельного helper/block;
- если audit insert падает — `RAISE WARNING` с SQLSTATE/message;
- конверсия не валится;
- но не делать `WHEN OTHERS THEN NULL`.

То есть ошибка не должна быть молча скрыта.

---

13. **Safari 404 backlog — правильно вынести**

Не включать в P0 и hygiene.

Backlog item можно зафиксировать отдельно:

```text
PATCH-SAFARI-SPA-404-DISCOVERY
```

Scope только discovery:

- CDN/cache;
- SPA fallback;
- Safari cache;
- headers;
- service worker, если есть.

---

14. **Финальные статусы**

После P0 отчёт должен завершиться:

```text
trial no-card backend branch: PASS
PaymentDialog trial no-card handling: PASS
grant-access-for-order canonical path: PASS
already-used trial guard: PASS
paid bePaid/Stripe regression: PASS
PATCH-DEMO-TRIAL-NO-CARD-ACTIVATION: PASS
```

После hygiene:

```text
audit schema fix: PASS
audit row written: PASS
idempotency preserved: PASS
preorder convert logic unchanged: PASS
PATCH-PREORDER-CONVERT-AUDIT-FIX: PASS
```

После этих правок план можно выполнять.

&nbsp;

Контекст

Два независимых блока работы:

1. **Hot-fix (P0):** «Активировать демо-доступ» на `gorbova.by/ideologicheskaya-rabota` падает с «Функция временно недоступна». В логах `bepaid-create-token` — `BLOCKED: legacy subscription path attempted without explicit choice` (audit `bepaid.subscription.create_blocked`). Триал с `amount=0` и без привязки карты не имеет своей ветки в `bepaid-create-token` и проваливается в legacy-guard (HTTP 403). Анкета (`requires_card_tokenization=false`, `auto_charge_after_trial=false`) подтверждает: оплата на bePaid вообще не нужна — нужно выдавать доступ напрямую.
2. **Hygiene-fix (обязательный follow-up Phase B):** `convert_preorder_on_pay_atomic` пишет в `audit_logs` через несуществующую колонку `actor_id` и глушит ошибку через `EXCEPTION WHEN OTHERS THEN NULL` — observability сломана.

Сообщение Safari «404» при работающем Chrome — кэш/edge; отдельно как backlog (ниже).

---

## Что делаем

### PATCH-DEMO-TRIAL-NO-CARD-ACTIVATION (P0)

**Backend (`supabase/functions/bepaid-create-token/index.ts`)**

Новая ветка ДО guard'а легаси-подписки и ДО subscription-payload (после блока создания `order` и резолва `paymentAmount`/`trialConfig`):

```
if (isTrial && paymentAmount === 0 && !requiresCardTokenization) {
   // 1) пометить order как paid (status='paid', paid_at=now)
   // 2) если productInfo.isV2 — создать orders_v2 (status='paid', is_trial=true,
   //    trial_end_at=now+trial_days, meta.source='trial_no_card',
   //    + crm_routing_snapshot по аналогии с skipRedirect-веткой)
   // 3) вызвать supabase.functions.invoke('grant-access-for-order', { order_id })
   //    как канонический write-path (НЕ insert в entitlements руками)
   // 4) audit_logs: action='trial.no_card.activated', actor_type='system'
   // 5) ответить { success:true, isTrialNoCard:true, redirectUrl: `${origin}/cabinet?trial=activated&order=<id>` }
}
```

Источник `requiresCardTokenization` — из уже читаемого `tariff_offers.requires_card_tokenization` для trial-оффера (есть в коде на строках 160, 487). Защита от повторной активации уже есть (строки 250–263, `is_trial=true` lookup).

**Frontend (`src/components/payment/PaymentDialog.tsx`)**

В `handleSubmit` (≈800): если `data.success && data.isTrialNoCard && data.redirectUrl` — `window.location.href = data.redirectUrl` (тот же путь, что текущий 836), плюс `toast.success('Демо-доступ активирован')`. Никаких других веток не трогаем.

**Verify (DoD)**

1. Тестовый клик «Активировать демо-доступ» по trial-офферу `891c7fe0-…` под гость-checkout → редирект в `/cabinet?trial=activated`, в `orders_v2` строка `status='paid', is_trial=true, meta.source='trial_no_card'`, есть запись в `access_grant_ledger` через `grant-access-for-order`.
2. Повторная попытка тем же email → `alreadyUsedTrial=true` (существующий guard) → модалка «Триал уже использован».
3. Logs `bepaid-create-token`: `trial.no_card.activated` вместо `bepaid.subscription.create_blocked`.
4. Платные офферы того же продукта — без изменений (regression smoke).

### PATCH-PREORDER-CONVERT-AUDIT-FIX (hygiene, обязательный)

Миграция, заменяющая аудит-блок внутри `public.convert_preorder_on_pay_atomic`:

- `actor_id` → `actor_user_id`;
- добавить `actor_type='system'`, `actor_label='convert_preorder_on_pay_atomic'`;
- убрать `EXCEPTION WHEN OTHERS THEN NULL`; вместо этого `EXCEPTION WHEN undefined_column OR insufficient_privilege THEN ...RAISE WARNING...` (warning-only, конверсия не валится). Любая другая ошибка пробрасывается уже на уровне вызывающего best-effort hook (он сам подавляет — см. `grant-access-for-order` lines 2249–2270).
- Body RPC и сам контракт (поиск/идемпотентность/обновление meta/preregistration) НЕ трогаем.

**Verify**

1. Создать synthetic paid order для существующего фикстурного preorder → `select rpc convert_preorder_on_pay_atomic` → в `audit_logs` появилась запись `action='preorder.convert_on_pay'` с `actor_type='system'`.
2. Повторный вызов — `noop=true`, без второй audit-строки.
3. `\d audit_logs` подтверждает `actor_user_id` (без `actor_id`).

### Site 404 в Safari (backlog, отдельно — не в этом плане)

Создам backlog-item для дискавери: проверить `Cache-Control`/`Vary` на response от Vite/edge, иммютабельность статики, поведение SPA-роутера на cold-load под Safari, и `gorbova.by` CDN-кэш. Не блокер для P0.

---

## Порядок

1. PATCH-DEMO-TRIAL-NO-CARD-ACTIVATION (backend + frontend + smoke).
2. PATCH-PREORDER-CONVERT-AUDIT-FIX (миграция + proof).
3. Завести backlog-item для Safari 404 discovery.

Никакой другой логики (preorder, payments, grants, CRM-hide) не трогаем.