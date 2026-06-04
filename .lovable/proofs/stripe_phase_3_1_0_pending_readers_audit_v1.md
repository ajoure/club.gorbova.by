# Phase 3.1.0 — Pending Enum Readers Audit (Stage A, dry-run) v1

**Status:** `ALL_READERS_SAFE: true` (с двумя контрактными условиями, см. §5).
**Цель:** проверить, что добавление значения `'pending'` в enum `public.subscription_status` не приведёт ни одного reader'а к интерпретации pending как `active`/grantable/conflict-blocking.

---

## 1. Методология

Grep по всему репо (`supabase/functions`, `src`) + интроспекция `pg_proc`/`pg_views` по 6 опасным паттернам:

```
status\s*(!=|<>)\s*'canceled'
status\s+not\s+in
\.neq\(['"]status['"]
\.not\(['"]status['"]
status\s*!==\s*['"]canceled['"]
status\s+IN\s*\(...whitelist...\)
```

Все совпадения, относящиеся к `subscriptions_v2.status`, классифицированы по 5 меткам из плана.

Baseline counts (snapshot перед миграцией):
```
active=370  trial=1  past_due=85  canceled=119  expired=417  superseded=241  expired_reentry=0
TOTAL=1233
```

Текущие enum values: `active, trial, past_due, canceled, expired, superseded, expired_reentry` (7).

---

## 2. Whitelist-readers (метка `ignores_unknown`) — БЕЗОПАСНО

Используют `.in('status', [...])` или `status IN (...)` с явным списком. Pending автоматически исключён.

### 2.1 Edge functions (whitelist `['active','trial','past_due']` или подмножество)
| Файл | Стр. | Whitelist |
|---|---|---|
| `_shared/resolve-effective-access.ts` | 93, 246 | `active,trial,past_due` |
| `_shared/accessValidation.ts` | 159, 331, 551, 707 | `active,trial,past_due` |
| `_shared/access-resolver.ts` | 276 | `active,past_due` |
| `_shared/entitlement-sync.ts` | 110 | `active,trial` |
| `_shared/subscription-conflict.ts` | 38, 107 | **CONFLICTING_STATUSES=`['active','trial']`** |
| `grant-access-for-order/index.ts` | 932, 2002 | `active,trial,past_due` / `active,past_due` |
| `grant-access-for-order/three_ds_writer.ts` | 401 | `active,past_due,trialing` |
| `subscription-renewal-reminders/index.ts` | 1203 | `active,trial` |
| `subscription-grace-reminders/index.ts` | 344, 370 | `active,past_due,trial` |
| `subscriptions-reconcile/index.ts` | 125, 196 | `trial,active` / `active,past_due` |
| `subscription-charge/index.ts` | — | `active,trial,past_due` (см. bepaid-audit ref) |
| `direct-charge/index.ts` | 388 | `active,trial` |
| `payment-method-verify-recurring/index.ts` | 1088 | `active,trial` |
| `telegram-send-reminders/index.ts` | 71, 254 | `active,trial,past_due,canceled` / `active,trial` |
| `telegram-send-notification/index.ts` | 145, 378 | `active,trial,past_due` |
| `telegram-revoke-access/index.ts` | 116 | `active,trial` |
| `telegram-club-members/index.ts` | 530 | `active,trial,past_due` |
| `telegram-check-expired/index.ts` | 289 | `active,trial,past_due` |
| `telegram-webhook/index.ts` | 885 | `active,trial` |
| `telegram-ai-support/index.ts` | 403, 744 | `active,trialing,past_due` / `active,trialing` |
| `live-event-notifications-cron/index.ts` | 170, 195 | `active,trial` |
| `live-resolve/index.ts` | 214, 284 | `active,trial` |
| `live-token-validate/index.ts` | 278 | `active,trial` |
| `nightly-payments-invariants/index.ts` | 146 | `active,trial,past_due` |
| `rules-retroapply/index.ts` | 395 | `active,past_due` |
| `bepaid-webhook/index.ts` | 5767 | `active,trial,grace` (grace не в enum — отдельный baseline-issue, не блокер) |
| `bepaid-get-subscription-details/index.ts` | 313, 343 | `active,trial,past_due` |
| `bepaid-subscription-audit*` | 65,105,145,187,309,358,398 | `active,trial[,past_due]` |
| `sync-payments-with-statement/index.ts` | 561, 688, 1044, 1093 | `active,trial` |
| `admin-legacy-cards-report/index.ts` | 99, 221 | `active,trial,past_due` |
| `admin-bepaid-backfill/index.ts` | 276 | `active,trial,past_due` |
| `admin-fix-false-payments/index.ts` | 172 | `active,trial` |
| `admin-fix-club-billing-dates/index.ts` | 173 | `active,trial,past_due` |
| `admin-backfill-2026-orders/index.ts` | 196 | `active,trial,grace` |
| `cancel-trial/index.ts` | — | целевой `trial` |
| `monitor-rebill-no-extension/index.ts` | — | whitelist (`active`-only checks) |

### 2.2 Frontend (whitelist)
| Файл | Стр. | Whitelist |
|---|---|---|
| `src/hooks/useTrainingContentRules.ts` | 193 | `active,trial` |
| `src/hooks/useSidebarModules.ts` | 105 | `active,trial` |
| `src/hooks/useTelegramIntegration.tsx` | 824 | `active,trial,past_due` |
| `src/pages/settings/PaymentMethods.tsx` | 186 | `active,trial` |

### 2.3 RPC / DB-функции / views (whitelist)
| Объект | Whitelist по `subscriptions_v2.status` |
|---|---|
| `align_billing_dates(...)` | `active,trial,past_due` |
| `cascade_order_cancellation(...)` | `active,trial,past_due` |
| `fn_close_superseded_subscriptions()` (trigger) | gated `NEW.status NOT IN ('active','trial')` + outer `active,trial,past_due` — pending не триггерит supersede |
| `find_misaligned_subscriptions(...)` | `active,trial,past_due` |
| `get_user_section_access(...)` | `active,trial` |
| `has_valid_access_for_club(...)` | `active,trial,past_due` |
| `inv22_subscription_desync(...)` | `active` only |
| `user_has_access_to_rule(...)` | `active,trialing,past_due` |
| `user_has_live_event_access(...)` | `active,past_due` |
| `resolve_broadcast_audience_user_ids(...)` | `active,trial,past_due` |
| `resolve_broadcast_audience_contacts(...)` | `active,trial,past_due` |
| view `subscriptions_v2_safe` | passthrough без фильтра — UI/admin, не выдаёт доступ |

**Вердикт §2:** все whitelist-readers безопасны. Pending не попадает ни в access, ни в reminders, ни в conflict, ни в кики.

---

## 3. `.neq('status','canceled')` на `subscriptions_v2` — БЕЗОПАСНО ПО КОНТРАКТУ

Все 6 совпадений в access-/reconcile-цепочке гейтятся вторичным date-фильтром, который пустой pre-created pending-row не пройдёт.

| Файл | Стр. | Контекст | Secondary gate | Метка |
|---|---|---|---|---|
| `_shared/resolve-effective-access.ts` | 157 | billing-day protection | `gte(next_charge_at, todayStart) & lt(next_charge_at, todayEnd)` + `billing_type='provider_managed'` | `safe_due_to_secondary_filter` |
| `_shared/resolve-effective-access.ts` | 288 | то же, по одному product | то же | `safe_due_to_secondary_filter` |
| `_shared/accessValidation.ts` | 84 | billing-day protection (single) | то же | `safe_due_to_secondary_filter` |
| `_shared/accessValidation.ts` | 477 | billing-day protection (batch) | то же | `safe_due_to_secondary_filter` |
| `_shared/accessValidation.ts` | 770 | billing-day protection (no-telegram) | то же | `safe_due_to_secondary_filter` |
| `subscriptions-reconcile/index.ts` | 53 | автокенцел по `cancel_at` | `lt(cancel_at, now)` | `safe_due_to_secondary_filter` |

**Контракт (Conditional CR-1)** для MVP-execute (Phase 3.1):
> Pre-created `subscriptions_v2` row со статусом `pending` обязан иметь `next_charge_at = NULL` и `cancel_at = NULL`. Любое отклонение делает pending видимым для billing-day-protection / auto-cancel reconcile. Это контракт `stripe-create-subscription-checkout`, проверяется в Runtime Proof G3.

---

## 4. UI-label-readers — БЕЗОПАСНО

| Файл | Стр. | Поведение |
|---|---|---|
| `src/lib/subscriptionStatusLabels.ts` | весь | уже содержит `pending → "В обработке"` (`kind: warning`). Лейбл готов. |
| `src/components/user/UserSubscriptions.tsx` | 197 | `status !== 'canceled'` — рендерит баннер «next_charge_at» только если оно есть. Pending row с `next_charge_at=NULL` → баннер скрыт. Косметика, не access. |
| `src/components/admin/payments/BepaidSubscriptionsTabContent.tsx` | 661, 664, 1686 | select-all чекбокс исключает `canceled`. С pending попадёт в «selectable». Admin UI, не access. Допустимо. |
| `bepaid-list-subscriptions/index.ts` | 550 | классификация «без карты» — `status !== 'canceled' && status !== 'terminated'`. Pending попадёт в «no_card warning». Admin-репорт, не access. Допустимо. |

---

## 5. STOP-условия — ВСЕ ОТСУТСТВУЮТ

| STOP | Результат |
|---|---|
| Reader = `treats_as_active` (unknown→active без whitelist) | НЕТ |
| Reader = `treats_as_grantable` | НЕТ |
| Conflict guard ловит pending как active-конфликт | НЕТ (`CONFLICTING_STATUSES=['active','trial']`) |
| Reconcile/INV-22 пытается отозвать доступ для pending без TTL | НЕТ (gated `cancel_at`, INV-22 только `status='active'`) |
| Reminders/Telegram включают pending | НЕТ (все whitelist `active,trial[,past_due]`) |

**`ALL_READERS_SAFE = true`** при соблюдении двух контрактов:

- **CR-1 (data):** pre-created pending row имеет `next_charge_at = NULL` и `cancel_at = NULL`. Owner — `stripe-create-subscription-checkout`. Verify — Runtime Proof G3.
- **CR-2 (duplicate guard gap):** текущий `subscription-conflict.ts` НЕ блокирует второй pending checkout того же user+product. В рамках этого mini-plan **не исправляется**. Митигация (любая из):
  - (a) Phase 3.1.0-B Pending Cleanup Worker (TTL 24h → `expired`) — отдельный mini-plan;
  - (b) явный admin/manual cleanup путь;
  - (c) расширение CONFLICTING_STATUSES до `['active','trial','pending']` в Phase 3.1 MVP plan (предпочтительно, но требует отдельного approve и контракта «pending-конфликт самопогашается через TTL/manual_review»).
  Текущий mini-plan фиксирует CR-2 как известный gap; разрешение — в Phase 3.1.0-B / Phase 3.1.

---

## 6. Затронутые / не затронутые домены

**Не затронуты этим аудитом (за scope):**
- `support_tickets`, `email_inbox`, `corporate_draft_sessions`, `site_form_submissions`, `instagram_*`, `news_*` — другие таблицы со своим `status` columns. Их `.neq('status','canceled')` не относятся к `subscriptions_v2`.
- `payment_methods.status`, `provider_subscriptions.state`, `telegram_access*.status`, `entitlements.status` — отдельные enum'ы, тоже не относятся.

---

## 7. Вердикт

`ALL_READERS_SAFE = true`. Stage B (single `ALTER TYPE ADD VALUE IF NOT EXISTS 'pending'`) разрешён к подаче. CR-1 и CR-2 переносятся в Phase 3.1 MVP plan и Runtime Proof.
