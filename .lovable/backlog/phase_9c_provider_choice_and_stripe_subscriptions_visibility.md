# Backlog: Phase 9-C — provider_choice_source + Stripe subscriptions visibility

**Создано:** 2026-06-09 (по итогам Phase 10 Final Regression PASS)
**Статус:** BACKLOG / not started
**Trigger to start:** отдельный approve пользователя

---

## Контекст

Phase 9-B (Minimal Admin Visibility) принят как PASS в утверждённом minimal-scope. Следующие пункты были deferred, потому что требуют расширения RPC / view / writer-логики — это было прямо запрещено в Phase 9-B scope. Phase 10 Final Regression подтвердил, что текущая система работает корректно без этих visibility-пунктов; они не блокеры.

---

## Scope Phase 9-C

### 1. `provider_choice_source` в UI

**Что:** показать в `LinkDetailsDrawer` и таблице ссылок, как была определена пара (provider, payment_type) при создании ссылки:
- `auto` — резолвер выбрал по настройкам tariff_offer/acquiring;
- `explicit` — админ явно зафиксировал в форме создания ссылки;
- `customer_choice` — выбор оставлен покупателю.

**Где лежит:** `payment_links.meta->>'provider_choice_source'` (writer уже пишет, но RPC/view не пробрасывает).

**Что нужно:**
- расширить `get_admin_payment_links_v1` (или соответствующий view `payment_links_enriched_v`) — отдавать `provider_choice_source` как top-level поле;
- обновить `usePaymentLinks` hook / TypeScript типы;
- отрендерить в `LinkDetailsDrawer.tsx` + (опц.) колонка в `LinksTabContent.tsx`.

### 2. `payment_type_admin_override` badge

**Что:** показать badge «Admin override» когда recurring tariff_offer был принудительно сконвертирован в `one_time` через UI создания ссылки.

**Что нужно:**
- подтвердить / добавить writer-side флаг в `admin-create-public-link`: записывать `meta.payment_type_admin_override=true` когда `tariff_offers.meta.recurring.is_recurring=true` && `payment_type='one_time'`;
- проверить через audit `payment_link.payment_type_promoted_recurring` (если writer уже пишет — только UI);
- badge в `LinkDetailsDrawer.tsx` и опц. tooltip в `LinksTabContent.tsx`.

### 3. Full Stripe subscriptions visibility

**Что:** решить модель отображения Stripe-подписок в админке.

**Варианты:**
- (A) Unified tab «Подписки» — bePaid + Stripe в одной таблице с фильтром по provider;
- (B) Отдельная вкладка «Stripe Subscriptions» рядом с bePaid;
- (C) Видимость только через payment/order details (текущее состояние).

**Что нужно:**
- Discovery: какие поля показывать (status / next_invoice_at / cancel_at_period_end / hosted_portal_url / customer_id / subscription_id / billing_cycles);
- решение по архитектуре чтения (новый RPC vs расширение существующего `subscriptions_v2_admin_v`);
- UI design.

### 4. Audit drill-down

**Что:** показать последние 5–10 audit-rows по конкретному order / payment / link / subscription прямо в drawer'е (read-only, для диагностики).

**Что нужно:**
- read-only RPC `get_admin_audit_by_subject(subject_type, subject_id, limit)` (или расширение существующих read-RPC);
- UI-секция «Журнал событий» в существующих drawer'ах.

---

## Что НЕ входит в Phase 9-C

- ❌ repair / retry / regrant / backfill actions — отдельным спринтом;
- ❌ изменения webhook lifecycle / grant-access-for-order;
- ❌ новая канониkа подписок;
- ❌ live Stripe production gate — отдельный спринт.

---

## DoD Phase 9-C

- `provider_choice_source` виден в UI;
- admin override badge работает на recurring+one_time ссылках;
- Stripe subscriptions visibility model реализована по выбранному варианту;
- audit drill-down доступен в payment/order/link drawer;
- proof `.lovable/proofs/phase_9_c_*_v1.md`;
- нет изменений lifecycle / webhook / grant.
